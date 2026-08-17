import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  filterProviderPoolByAllowlist,
} from "../src/drivers/image/openai-compatible.js";
import {
  ImageGenError,
  type ImageGenAttempt,
  type ImageGenInput,
  type ImageGenOutcome,
} from "../src/drivers/image/types.js";
import {
  driveWithRewriteFallback,
  type RewriteDependencies,
} from "../src/domain/generate/with-rewrite.js";
import { loadPluginConfigsFromDir } from "../src/plugins/loader.js";

const enabledPool = [
  { provider: { id: "approved-a" } },
  { provider: { id: "unapproved-b" } },
];

test("plugin overlay distinguishes omitted allowlist from explicit empty kill switch", () => {
  const dir = mkdtempSync(join(tmpdir(), "inkast-provider-allowlist-"));
  try {
    writeFileSync(
      join(dir, "legacy.json"),
      JSON.stringify({
        id: "legacy",
        name: "Legacy",
        imageDefaults: {},
      }),
    );
    writeFileSync(
      join(dir, "closed.json"),
      JSON.stringify({
        id: "closed",
        name: "Closed",
        imageDefaults: {},
        imageProviderIds: [],
      }),
    );
    writeFileSync(
      join(dir, "hybrid-output.json"),
      JSON.stringify({
        id: "hybrid-output",
        name: "Trusted direct URL with resized fallbacks",
        imageDefaults: {},
        imageProviderIds: ["gpt", "cloudbase", "bafang"],
        imageProviderOrder: "allowlist",
        outputDimensions: { width: 622, height: 866 },
        upstreamImageUrlPassthrough: {
          allowedOrigins: ["https://img.example.com"],
        },
      }),
    );

    const plugins = loadPluginConfigsFromDir(dir);
    const legacy = plugins.find(plugin => plugin.id === "legacy");
    const closed = plugins.find(plugin => plugin.id === "closed");
    assert.equal(legacy?.imageProviderIds, undefined);
    assert.deepEqual(closed?.imageProviderIds, []);
    assert.deepEqual(
      plugins.find(plugin => plugin.id === "hybrid-output")?.outputDimensions,
      { width: 622, height: 866 },
    );
    assert.equal(
      plugins.find(plugin => plugin.id === "hybrid-output")?.imageProviderOrder,
      "allowlist",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provider allowlist is exact and empty/missing/disabled IDs fail closed", () => {
  assert.deepEqual(
    filterProviderPoolByAllowlist(enabledPool, undefined).map(x => x.provider.id),
    ["approved-a", "unapproved-b"],
    "omitting the field must preserve legacy full-pool behavior",
  );
  assert.deepEqual(
    filterProviderPoolByAllowlist(enabledPool, ["approved-a"]).map(x => x.provider.id),
    ["approved-a"],
  );
  assert.deepEqual(filterProviderPoolByAllowlist(enabledPool, []), []);
  assert.deepEqual(filterProviderPoolByAllowlist(enabledPool, ["does-not-exist"]), []);
  assert.deepEqual(
    filterProviderPoolByAllowlist(
      enabledPool,
      ["disabled-provider"],
    ),
    [],
    "disabled capabilities are absent from the enabled pool and cannot be selected",
  );
});

test("explicit provider allowlist order overrides global pool priority", () => {
  const globallyOrderedPool = [
    { provider: { id: "cloudbase" } },
    { provider: { id: "gpt" } },
    { provider: { id: "bafang" } },
  ];

  assert.deepEqual(
    filterProviderPoolByAllowlist(
      globallyOrderedPool,
      ["gpt", "cloudbase", "bafang"],
      true,
    ).map(x => x.provider.id),
    ["gpt", "cloudbase", "bafang"],
  );
});

test("allowlist keeps global priority unless caller opts into local order", () => {
  const globallyOrderedPool = [
    { provider: { id: "cloudbase" } },
    { provider: { id: "gpt" } },
    { provider: { id: "bafang" } },
  ];

  assert.deepEqual(
    filterProviderPoolByAllowlist(
      globallyOrderedPool,
      ["gpt", "cloudbase", "bafang"],
    ).map(x => x.provider.id),
    ["cloudbase", "gpt", "bafang"],
  );
});

test("private providers require an explicit caller allowlist", () => {
  const pool = [
    {
      provider: { id: "shared-provider" },
      capability: { extras: null },
    },
    {
      provider: { id: "private-seedream" },
      capability: { extras: { explicitAllowlistOnly: true } },
    },
  ];

  assert.deepEqual(
    filterProviderPoolByAllowlist(pool, undefined).map(x => x.provider.id),
    ["shared-provider"],
    "legacy callers must not discover private providers",
  );
  assert.deepEqual(
    filterProviderPoolByAllowlist(pool, ["private-seedream"]).map(x => x.provider.id),
    ["private-seedream"],
    "an explicitly approved caller can use the private provider",
  );
  assert.deepEqual(filterProviderPoolByAllowlist(pool, []), []);
});

test("rewrite rounds retain the same provider allowlist and cannot escape", async () => {
  const allowlistsSeen: Array<readonly string[] | undefined> = [];
  const providerOrdersSeen: Array<"allowlist" | undefined> = [];
  const attemptedProviderIds: string[] = [];
  let driverCall = 0;

  const dependencies: RewriteDependencies = {
    generateImage: async (input: ImageGenInput): Promise<ImageGenOutcome> => {
      allowlistsSeen.push(input.allowedProviderIds);
      providerOrdersSeen.push(input.providerOrder);
      const eligible = filterProviderPoolByAllowlist(
        enabledPool,
        input.allowedProviderIds,
        input.providerOrder === "allowlist",
      );
      assert.equal(eligible.length, 1);
      const providerId = eligible[0]!.provider.id;
      attemptedProviderIds.push(providerId);
      driverCall += 1;

      const attempt: ImageGenAttempt = {
        providerId,
        providerName: providerId,
        ok: driverCall === 3,
        ...(driverCall === 3
          ? {}
          : { errorCode: "provider_blocked_content" as const, errorMessage: "blocked" }),
        durationMs: 1,
      };
      input.onAttempt?.(attempt);

      if (driverCall < 3) {
        throw new ImageGenError(
          "all_providers_failed",
          "approved provider rejected this round",
          [attempt],
        );
      }
      return {
        imageB64: "aW1hZ2U=",
        format: "png",
        providerId,
        providerName: providerId,
        attempts: [attempt],
        totalDurationMs: 1,
      };
    },
    rewriteBlockedPrompt: async input => ({
      rewrittenPromptText: `rewrite-${input.round}`,
      characterKey: null,
      usedImageUrls: [],
      llmDurationMs: 1,
      analysis:
        input.round === 1
          ? {
              body_anchors: "body",
              palette_anchors: "palette",
              character_archetype: "archetype",
            }
          : null,
    }),
  };

  const outcome = await driveWithRewriteFallback(
    {
      promptText: "original",
      allowedProviderIds: ["approved-a"],
      providerOrder: "allowlist",
    },
    { maxRound: 2 },
    undefined,
    dependencies,
  );

  assert.equal(outcome.successRound, 2);
  assert.deepEqual(attemptedProviderIds, ["approved-a", "approved-a", "approved-a"]);
  assert.deepEqual(allowlistsSeen, [
    ["approved-a"],
    ["approved-a"],
    ["approved-a"],
  ]);
  assert.deepEqual(providerOrdersSeen, ["allowlist", "allowlist", "allowlist"]);
});
