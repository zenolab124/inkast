import sharp from "sharp";
import type { ImagePrompt } from "@inkast/shared";

import { draftPrompt } from "../prompt-engine/index.js";
import { driveWithRewriteFallback } from "../generate/with-rewrite.js";
import { reviewAndMaybeEdit } from "../post-review-edit/index.js";
import { ImageGenError } from "../../drivers/image/types.js";
import { putImage, R2UploadError } from "../../drivers/storage/r2.js";
import {
  listRegisteredPlugins,
  resolveLlmBackend,
} from "../../plugins/registry.js";
import type { InkastPlugin, PluginImageStorage } from "../../plugins/types.js";
import { toOpenAiError } from "../../plugins/errors.js";
import {
  createPluginTask,
  getPluginTask,
  gcOldPluginTasks,
  incrementCallbackAttempt,
  markCallbackLost,
  markTaskFailed,
  markTaskRunning,
  markTaskSucceeded,
  updateTaskProgress,
  reaperInflightPluginTasks,
  type PluginTaskRow,
} from "../../storage/plugin-tasks.js";
import { backfillPluginGalleryFromTasks } from "../../storage/plugin-gallery.js";

/**
 * v2 异步协议的核心。负责:
 *   - submit 入口(synchronous,立刻返 task_id,不阻塞 LLM/image 调用)
 *   - 后台 worker(in-memory queue + concurrency cap)
 *   - JPEG transcode(image driver 输出 PNG → JPEG q80 缩减 callback payload)
 *   - callback 推送 + 5s/30s/5min × 3 重试
 *   - startup recovery(interrupted tasks 立即 callback)
 *   - 24h GC(每小时跑一次 + startup 一次)
 *
 * 与 Web UI 通道完全隔离(Web UI 走 domain/generate,plugin 走本模块),
 * 共享底层 LLM driver + image provider 池 + image transcode 工具(sharp)。
 *
 * 状态机:queued → running → succeeded | failed → callback retry → final terminal
 */

const MAX_CONCURRENT = 25;
const CALLBACK_DELAYS_MS = [5_000, 30_000, 300_000];      // 5s / 30s / 5min
const MAX_CALLBACK_ATTEMPTS = 1 + CALLBACK_DELAYS_MS.length;  // 4 = 1 immediate + 3 retries

const GC_INTERVAL_MS = 60 * 60 * 1000;                    // 1h
const TASK_RETENTION_MS = 24 * 60 * 60 * 1000;            // 24h

// In-memory FIFO queue. We don't poll the DB; submit + recovery push here.
const queuedTaskIds: string[] = [];
let activeCount = 0;

function getPluginById(id: string): InkastPlugin | undefined {
  return listRegisteredPlugins().find(p => p.id === id);
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry: submit
// ─────────────────────────────────────────────────────────────────────────

/**
 * Caller-controllable pipeline policy. Surfaces through the plugin v1 submit
 * endpoint as `pipeline_policy`. All fields optional — see route handler for
 * wire field names + validation.
 */
export interface PipelinePolicy {
  /** Skip round 0 (caller's literal prompt) and start at round 1 (LLM vision rewrite). Useful for obscure characters where the image model doesn't know the IP. */
  skipOriginal?: boolean;
  /** Highest rewrite round allowed. 0 = no rewrite at all; 3 = full chain (default). */
  maxRound?: 0 | 1 | 2 | 3;
  /** Run an LLM-judged post-review + image edit pass after a round-2 or round-3 success. round 0/1 successes are not reviewed. */
  postReviewEdit?: boolean;
}

export interface SubmitInput {
  plugin: InkastPlugin;
  prompt: string;
  callbackUrl: string;
  callbackToken: string;
  pipelinePolicy?: PipelinePolicy;
}

/**
 * In-memory taskId → policy map. Worker picks it up when running the task.
 * Cleared after the task terminates. Not persisted — if inkast restarts mid-
 * flight, the recovered task runs with default policy (the worst case is a
 * task running with too-permissive defaults; the caller's failure-mode
 * preference is then ignored on that specific recovery, which is acceptable).
 */
const taskPolicies = new Map<string, PipelinePolicy>();

/**
 * Persist a task, schedule its async work, return the task row immediately.
 * Caller (route handler) responsible for HTTP 200 + body shape.
 *
 * No LLM / image calls here — submit must finish in < 100ms.
 */
export function submitForPlugin(input: SubmitInput): PluginTaskRow {
  const task = createPluginTask({
    pluginId: input.plugin.id,
    prompt: input.prompt,
    callbackUrl: input.callbackUrl,
    callbackToken: input.callbackToken,
  });
  if (input.pipelinePolicy && Object.keys(input.pipelinePolicy).length > 0) {
    taskPolicies.set(task.id, input.pipelinePolicy);
  }
  console.log(
    `[plugin-async] ▶ submit task=${task.id} plugin=${input.plugin.id} prompt-bytes=${input.prompt.length} callback=${redactUrl(input.callbackUrl)}${input.pipelinePolicy ? ` policy=${JSON.stringify(input.pipelinePolicy)}` : ""}`,
  );
  enqueueTask(task.id);
  return task;
}

// ─────────────────────────────────────────────────────────────────────────
// Worker: queue + concurrency cap
// ─────────────────────────────────────────────────────────────────────────

function enqueueTask(taskId: string): void {
  queuedTaskIds.push(taskId);
  scheduleProcessing();
}

function scheduleProcessing(): void {
  while (activeCount < MAX_CONCURRENT && queuedTaskIds.length > 0) {
    const id = queuedTaskIds.shift()!;
    activeCount++;
    void runTask(id).finally(() => {
      activeCount--;
      scheduleProcessing();
    });
  }
}

async function runTask(taskId: string): Promise<void> {
  const task = getPluginTask(taskId);
  if (!task) {
    console.warn(`[plugin-async] task ${taskId} disappeared before run`);
    return;
  }
  const plugin = getPluginById(task.pluginId);
  if (!plugin) {
    markTaskFailed(taskId, {
      errorCode: "internal_error",
      errorMsg: `plugin not registered: ${task.pluginId}`,
    });
    void deliverCallback(taskId, 0);
    return;
  }

  markTaskRunning(taskId);
  const overallStart = Date.now();
  console.log(`[plugin-async] ▶ running task=${taskId} plugin=${plugin.id}`);

  let llmDurationMs = 0;
  let imageDurationMs = 0;

  try {
    let promptText: string;
    let promptJsonStr: string;

    if (plugin.skipLlmExpansion) {
      // ── Skip-LLM 模式:直接拼用户 prompt + plugin 散文约束 ─────────
      // 跳过 draftPrompt(节省 ~14s + LLM token + 一个失败点)。
      // plugin.skipLlmConstraintsText 应已包含 Marvel IP / safe zone
      // / 无文字 / 无 UI overlay / SFW 等全部硬约束。
      promptText = buildSkipLlmPromptText(task.prompt, plugin);
      promptJsonStr = JSON.stringify({
        _mode: "skip_llm",
        _raw_prompt: task.prompt,
      });
      // llmDurationMs 保持 0
    } else {
      // ── 标准模式:走 LLM 拆解 + enforceFields 覆盖 ────────────────
      // 1. 散文 → JSON(LLM),注入 plugin systemPromptPatch
      const llmStart = Date.now();
      const draftOutcome = await draftPrompt({
        input: task.prompt,
        backend: resolveLlmBackend(plugin),
        lang: plugin.lang ?? "en",
        systemPromptSuffix: plugin.systemPromptPatch,
      });
      llmDurationMs = Date.now() - llmStart;

      // 2. 强制字段浅合并(plugin enforceFields 覆盖 LLM 输出)
      const mergedPrompt = {
        ...draftOutcome.draft.prompt,
        ...(plugin.enforceFields ?? {}),
      } as ImagePrompt;
      promptText = JSON.stringify(mergedPrompt);
      promptJsonStr = promptText;
    }

    // 3. 出图(走 image driver 池)— 两种模式共享
    // driveWithRewriteFallback 会按 pipeline_policy 控制的策略跑 round 0 → 3,
    // 内容相关失败(provider_blocked_content / upstream_safety_rejected /
    // moderation)触发 LLM 改写后重试。policy.skipOriginal 跳过 round 0,
    // policy.maxRound 控制最高轮次。
    const callerPolicy = taskPolicies.get(taskId);
    const imageStart = Date.now();
    let imageOutcome;
    try {
      imageOutcome = await driveWithRewriteFallback(
        {
          promptText,
          size: plugin.imageDefaults.size,
          quality: plugin.imageDefaults.quality,
          format: plugin.imageDefaults.format,
        },
        {
          skipOriginal: callerPolicy?.skipOriginal,
          maxRound: callerPolicy?.maxRound,
        },
        snapshot => updateTaskProgress(taskId, snapshot),
      );
    } finally {
      imageDurationMs = Date.now() - imageStart;
    }

    // 3.5 出图后审查 + 编辑(可选, 仅 round ≥ 2 且 caller 显式开启)
    // round 0/1 出图质量本身就高, 跳过 review 省 token/时间。仅 round 2/3
    // 这种"降级出图"路径才走 review — 如果 LLM 觉得不像参考图, 触发一次
    // image edit (强制 images-mode provider, references=刚生成的图,
    // prompt=LLM 给的"把 X 改成 Y"指令)。edit 失败 fallback 用 review 前
    // 的原图 — 永远不让 review 步骤把成功 task 变成失败 task。
    let postReviewEdited = false;
    if (
      callerPolicy?.postReviewEdit === true &&
      (imageOutcome.successRound === 2 || imageOutcome.successRound === 3)
    ) {
      const reviewOutcome = await reviewAndMaybeEdit({
        originalPromptText: promptText,
        currentImageB64: imageOutcome.imageB64,
        currentImageMime: "image/png",
        imageInputBase: {
          size: plugin.imageDefaults.size,
          quality: plugin.imageDefaults.quality,
          format: plugin.imageDefaults.format,
        },
      });
      if (reviewOutcome.editApplied) {
        // Splice the edit result back into the outcome we'll persist + callback.
        imageOutcome = {
          ...imageOutcome,
          imageB64: reviewOutcome.imageB64,
          attempts: [
            ...imageOutcome.attempts,
            ...(reviewOutcome.editDriverOutcome?.attempts ?? []),
          ],
        };
        imageDurationMs += reviewOutcome.editDurationMs;
        postReviewEdited = true;
      }
      console.log(
        `[post-review] task=${taskId} looks_like_target=${reviewOutcome.looksLikeTarget} editApplied=${reviewOutcome.editApplied}${reviewOutcome.fallbackReason ? ` fallback=${reviewOutcome.fallbackReason}` : ""}`,
      );
    }

    // 4. 出图持久化:按 plugin.imageStorage 分两条路
    //    - "b64"(默认):JPEG transcode(payload 缩 5x)+ DB b64_json 字段
    //    - "r2":可选 resize 后保留 PNG → R2 PUT → DB image_url 字段
    const storage: PluginImageStorage = plugin.imageStorage ?? { kind: "b64" };

    if (storage.kind === "r2") {
      const bodyBytes = await prepareImageForR2(
        imageOutcome.imageB64,
        plugin.outputDimensions,
        storage.contentType,
      );
      const ext =
        storage.contentType === "image/png"
          ? "png"
          : storage.contentType === "image/webp"
            ? "webp"
            : "jpg";
      const key = `${storage.keyPrefix}${taskId}.${ext}`;
      try {
        const r2Out = await putImage({
          bucket: storage.bucket,
          key,
          body: bodyBytes,
          contentType: storage.contentType,
        });
        const imageUrl = `${storage.publicBase.replace(/\/+$/, "")}/${key}`;
        markTaskSucceeded(taskId, {
          kind: "r2",
          imageUrl,
          mime: storage.contentType,
          promptJson: promptJsonStr,
          llmDurationMs,
          imageDurationMs,
          providerId: imageOutcome.providerId,
          providerName: imageOutcome.providerName,
          attempts: imageOutcome.attempts,
          rewrittenPrompts: imageOutcome.rewrittenPromptHistory,
          successRound: imageOutcome.successRound,
          postReviewEdited,
        });
        console.log(
          `[plugin-async] ✓ task=${taskId} llm=${llmDurationMs}ms image=${imageDurationMs}ms r2=${r2Out.durationMs}ms(att=${r2Out.attempts}) total=${Date.now() - overallStart}ms url=${imageUrl}`,
        );
      } catch (err) {
        // R2 上传失败 → 任务标 failed,callback 走 r2_upload_failed,不 fallback b64
        // (避免两套路径并存;snap-ub 端会按 status:failed 自动退能量)
        const isR2Err = err instanceof R2UploadError;
        const msg = err instanceof Error ? err.message : String(err);
        markTaskFailed(taskId, {
          errorCode: isR2Err ? "r2_upload_failed" : "internal_error",
          errorMsg: msg,
          llmDurationMs,
          imageDurationMs,
          // Driver succeeded — its attempt trail is preserved so the dashboard
          // can still show which provider produced the bytes (and any prior
          // failed attempts during failover), even though we couldn't upload.
          attempts: imageOutcome.attempts,
          rewrittenPrompts: imageOutcome.rewrittenPromptHistory,
        });
        console.warn(`[plugin-async] ✗ task=${taskId} r2_upload_failed: ${msg}`);
      }
    } else {
      const { b64Json, mime } = await transcodeToJpeg(
        imageOutcome.imageB64,
        plugin.outputDimensions,
      );
      markTaskSucceeded(taskId, {
        kind: "b64",
        b64Json,
        mime,
        promptJson: promptJsonStr,
        llmDurationMs,
        imageDurationMs,
        providerId: imageOutcome.providerId,
        providerName: imageOutcome.providerName,
        attempts: imageOutcome.attempts,
        rewrittenPrompts: imageOutcome.rewrittenPromptHistory,
        successRound: imageOutcome.successRound,
        postReviewEdited,
      });
      console.log(
        `[plugin-async] ✓ task=${taskId} llm=${llmDurationMs}ms image=${imageDurationMs}ms total=${Date.now() - overallStart}ms`,
      );
    }
  } catch (err) {
    const mapped = toOpenAiError(err);
    // When the image driver exhausted its provider pool it throws ImageGenError
    // with the full attempts array attached — surface it on the task so the
    // dashboard shows the failover trail even on terminal failure.
    const attempts = err instanceof ImageGenError ? err.attempts : undefined;
    // rewrite history is also attached to ImageGenError when the rewrite
    // wrapper threw (all_providers_failed_after_rewrite or LLM mid-flight
    // failure). Persisting it on failure rows is precisely what the operator
    // needs for diagnostics — "what did the rewrite say before giving up".
    const rewrittenPrompts =
      err instanceof ImageGenError ? err.rewrittenPromptHistory : undefined;
    markTaskFailed(taskId, {
      errorCode: mapped.body.error.code,
      errorMsg: mapped.body.error.message,
      llmDurationMs: llmDurationMs || null,
      imageDurationMs: imageDurationMs || null,
      attempts,
      rewrittenPrompts,
    });
    console.warn(
      `[plugin-async] ✗ task=${taskId} ${mapped.body.error.code}: ${mapped.body.error.message}`,
    );
  } finally {
    // Always drop the policy entry once the task reaches a terminal state,
    // even if we hit an unexpected throw. Leaving entries around would slow-
    // leak memory across long-running inkast processes.
    taskPolicies.delete(taskId);
  }

  void deliverCallback(taskId, 0);
}

// ─────────────────────────────────────────────────────────────────────────
// Skip-LLM prompt assembly
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the final prose prompt for skip-LLM mode. Concatenates caller-supplied
 * user prompt with the plugin's prose constraint block, separated by a blank
 * line so the image model treats them as related but distinct sections.
 *
 * If the plugin didn't declare `skipLlmConstraintsText`, falls back to raw
 * user prompt (no constraints attached — caller bears full responsibility).
 */
function buildSkipLlmPromptText(userPrompt: string, plugin: InkastPlugin): string {
  const constraints = plugin.skipLlmConstraintsText?.trim();
  if (!constraints) return userPrompt;
  return `${userPrompt}\n\n${constraints}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Image transcode: PNG/WEBP → JPEG q80
// ─────────────────────────────────────────────────────────────────────────

/**
 * Transcode image bytes to JPEG q80, optionally resizing to a target dimension
 * with `fit: "cover"` (主体居中, 裁切多余) before encoding.
 *
 * Use cases:
 *   - 节省 base64 payload(uniCloud HTTPS 10MB body cap)→ JPEG cuts ~5x vs PNG
 *   - 把图模固定 size(1024×1024 / 1024×1536 / 1536×1024)精确缩放到调用方
 *     期望的卡牌艺术框尺寸(plugin.outputDimensions)
 *
 * Fast path:仅在不需要 resize 且输入已经是 JPEG 时直接 passthrough。
 * 其它路径走 sharp decode + (resize) + JPEG encode。
 */
async function transcodeToJpeg(
  srcB64: string,
  outputDims?: { width: number; height: number },
): Promise<{ b64Json: string; mime: string }> {
  const srcBytes = Buffer.from(srcB64, "base64");

  if (!outputDims) {
    // Fast path: 不需要 resize 且输入已经是 JPEG → passthrough
    if (
      srcBytes.length >= 3 &&
      srcBytes[0] === 0xff &&
      srcBytes[1] === 0xd8 &&
      srcBytes[2] === 0xff
    ) {
      return { b64Json: srcB64, mime: "image/jpeg" };
    }
  }

  let pipeline = sharp(srcBytes);
  if (outputDims) {
    // position: "top" instead of "center" — for portrait-aspect plugin
    // outputs (SnapUB 622×866) the model often returns a taller-than-target
    // image (1024×1536) and "center" cover crops ~33px off both top AND
    // bottom, frequently shaving the character's head/hair. "top" pins to
    // the top edge so only the bottom is cropped — losing feet hurts much
    // less than losing heads in portrait cards.
    pipeline = pipeline.resize(outputDims.width, outputDims.height, {
      fit: "cover",
      position: "top",
    });
  }
  const jpegBytes = await pipeline.jpeg({ quality: 80, progressive: false }).toBuffer();
  return { b64Json: jpegBytes.toString("base64"), mime: "image/jpeg" };
}

// ─────────────────────────────────────────────────────────────────────────
// R2 upload bytes preparation
// ─────────────────────────────────────────────────────────────────────────

/**
 * 为 R2 上传准备字节流:保留 PNG 原图(callback 不再需要 b64 缩 payload),
 * 仅在 plugin 配了 outputDimensions 或目标 contentType ≠ image/png 时
 * 用 sharp 处理(resize cover-fit / format re-encode)。image driver 当前
 * 总是返 PNG,所以 (contentType=png && !resize) 走 passthrough。
 */
async function prepareImageForR2(
  srcB64: string,
  outputDims: { width: number; height: number } | undefined,
  contentType: "image/png" | "image/jpeg" | "image/webp",
): Promise<Buffer> {
  const srcBytes = Buffer.from(srcB64, "base64");
  if (!outputDims && contentType === "image/png") {
    return srcBytes;
  }
  let pipeline = sharp(srcBytes);
  if (outputDims) {
    // See transcodeToJpeg above — same reasoning for "top" over "center".
    pipeline = pipeline.resize(outputDims.width, outputDims.height, {
      fit: "cover",
      position: "top",
    });
  }
  if (contentType === "image/png") return pipeline.png().toBuffer();
  if (contentType === "image/jpeg") return pipeline.jpeg({ quality: 80 }).toBuffer();
  // image/webp — lossy q=85 hits ~5-10x compression vs PNG with no
  // perceivable quality drop for character art / illustrations.
  return pipeline.webp({ quality: 85 }).toBuffer();
}

// ─────────────────────────────────────────────────────────────────────────
// Callback delivery + retry
// ─────────────────────────────────────────────────────────────────────────

/**
 * Schedule callback delivery. attempt is 0-indexed:
 *   0 → immediate (setTimeout 0 = next tick)
 *   1 → 5s later
 *   2 → 30s later
 *   3 → 5min later
 *   ≥ MAX_CALLBACK_ATTEMPTS → give up, mark callback_lost
 *
 * Retry state is in-memory (setTimeout). Across an inkast restart, mid-retry
 * tasks are not resumed — caller falls back to GET /status/:id to pull result.
 */
function deliverCallback(taskId: string, attempt: number): void {
  if (attempt >= MAX_CALLBACK_ATTEMPTS) {
    console.warn(`[plugin-async] ✗✗ callback_lost task=${taskId} after ${attempt} attempts`);
    markCallbackLost(taskId);
    return;
  }
  const delayMs = attempt === 0 ? 0 : CALLBACK_DELAYS_MS[attempt - 1]!;
  setTimeout(() => {
    void attemptCallbackOnce(taskId, attempt);
  }, delayMs);
}

async function attemptCallbackOnce(taskId: string, attempt: number): Promise<void> {
  const task = getPluginTask(taskId);
  if (!task) {
    console.warn(`[plugin-async] callback task ${taskId} gone`);
    return;
  }
  if (task.callbackLost) return;
  incrementCallbackAttempt(taskId);

  const body = buildCallbackBody(task);
  const started = Date.now();
  let ok = false;
  let detail = "";
  try {
    const res = await fetch(task.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Callback-Token": task.callbackToken,
      },
      body: JSON.stringify(body),
    });
    ok = res.ok;
    if (!ok) detail = `HTTP ${res.status}`;
  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
  }
  const elapsed = Date.now() - started;

  if (ok) {
    console.log(
      `[plugin-async] ✓ callback task=${taskId} attempt=${attempt + 1} ok in ${elapsed}ms`,
    );
    return;
  }

  console.warn(
    `[plugin-async] ✗ callback task=${taskId} attempt=${attempt + 1} failed in ${elapsed}ms · ${detail}`,
  );
  deliverCallback(taskId, attempt + 1);
}

interface CallbackBody {
  task_id: string;
  status: "succeeded" | "failed";
  b64_json?: string;
  image_url?: string;
  mime?: string;
  prompt_json?: unknown;
  error_code?: string;
  error_msg?: string;
  completed_at: number;
  /**
   * Which rewrite round produced the final image. Sent only on `succeeded`.
   *   0 = caller's literal prompt (no rewrite happened)
   *   1 = LLM vision rewrite (identity-feature)
   *   2 = fingerprint-degrade
   *   3 = color-only anchor
   * Callers can use this to label the result UX-wise (e.g. round 0 = "精准",
   * round 3 = "风格化").
   */
  success_round?: 0 | 1 | 2 | 3;
  /**
   * True iff the optional post-review edit step (only enabled when the
   * caller passes `pipeline_policy.post_review_edit=true`) actually
   * replaced the image bytes. Sent only on `succeeded`. Lets the caller
   * distinguish "raw round-N output" from "round-N then post-review-edited".
   */
  post_review_edited?: boolean;
}

function buildCallbackBody(task: PluginTaskRow): CallbackBody {
  const completed_at = Math.floor((task.completedAt ?? Date.now()) / 1000);
  if (task.status === "succeeded" && task.mime) {
    const successFields = {
      success_round: task.successRound ?? undefined,
      post_review_edited: task.postReviewEdited ?? undefined,
    } as const;
    // r2 路径:image_url 优先(v2.1 协议)
    if (task.imageUrl) {
      return {
        task_id: task.id,
        status: "succeeded",
        image_url: task.imageUrl,
        mime: task.mime,
        prompt_json: task.promptJson ? safeParseJson(task.promptJson) : undefined,
        completed_at,
        ...successFields,
      };
    }
    // b64 路径(v2 协议)
    if (task.b64Json) {
      return {
        task_id: task.id,
        status: "succeeded",
        b64_json: task.b64Json,
        mime: task.mime,
        prompt_json: task.promptJson ? safeParseJson(task.promptJson) : undefined,
        completed_at,
        ...successFields,
      };
    }
  }
  return {
    task_id: task.id,
    status: "failed",
    error_code: task.errorCode ?? "internal_error",
    error_msg: task.errorMsg ?? "(no error message)",
    completed_at,
  };
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Startup recovery + GC loop
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire-in entry. Called once from `createApp`. Walks the table for stale
 * inflight rows from a previous process, marks them failed, fires final
 * callbacks. Then starts the 24h GC loop.
 */
export function initPluginAsync(): void {
  recoverInterruptedTasks();
  backfillGallery();
  startGcLoop();
}

/**
 * Idempotent one-shot: copy still-resident succeeded r2 tasks into the long-
 * lived gallery table. After the first boot post-deploy this is a no-op
 * (INSERT OR IGNORE on id). Logged at info-level so we can see in journal
 * whether the migration touched anything.
 */
function backfillGallery(): void {
  try {
    const { scanned, inserted } = backfillPluginGalleryFromTasks();
    if (inserted > 0) {
      console.log(
        `[plugin-async] backfilled ${inserted}/${scanned} task(s) into plugin_gallery_items`,
      );
    }
  } catch (err) {
    console.warn(
      `[plugin-async] gallery backfill failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

function recoverInterruptedTasks(): void {
  const reaped = reaperInflightPluginTasks();
  if (reaped.length === 0) return;
  console.log(`[plugin-async] recovered ${reaped.length} interrupted task(s) — firing callbacks`);
  for (const task of reaped) {
    void deliverCallback(task.id, 0);
  }
}

function startGcLoop(): void {
  const tick = (): void => {
    try {
      const n = gcOldPluginTasks(TASK_RETENTION_MS);
      if (n > 0) console.log(`[plugin-async] GC removed ${n} expired task(s) (> 24h)`);
    } catch (err) {
      console.warn(`[plugin-async] GC tick failed:`, err instanceof Error ? err.message : err);
    }
  };
  tick();
  setInterval(tick, GC_INTERVAL_MS).unref();
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Mask query string + token-shaped segments for log lines. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "<malformed>";
  }
}
