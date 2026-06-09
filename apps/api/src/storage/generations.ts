import { randomUUID } from "node:crypto";
import type { ImagePrompt } from "@inkast/shared";
import { db } from "./db.js";

export interface Generation {
  id: string;
  promptSnapshot: ImagePrompt;
  promptText: string;
  imagePath: string;
  imageUrl: string | null;
  imageFormat: string;
  size: string;
  quality: string;
  providerId: string | null;
  durationMs: number | null;
  prose: string | null;
  aiFilledFields: string[] | null;
  createdAt: number;
}

export interface CreateGenerationInput {
  promptSnapshot: ImagePrompt;
  promptText: string;
  imagePath: string;
  imageUrl?: string | null;
  imageFormat?: string;
  size: string;
  quality: string;
  providerId?: string;
  durationMs?: number;
  prose?: string | null;
  aiFilledFields?: string[] | null;
}

interface GenerationRow {
  id: string;
  prompt_snapshot: string;
  prompt_text: string;
  image_path: string;
  image_url: string | null;
  image_format: string;
  size: string;
  quality: string;
  provider_id: string | null;
  duration_ms: number | null;
  prose: string | null;
  ai_filled_fields: string | null;
  created_at: number;
}

function rowToGeneration(row: GenerationRow): Generation {
  let aiFilledFields: string[] | null = null;
  if (row.ai_filled_fields) {
    try {
      const parsed = JSON.parse(row.ai_filled_fields);
      if (Array.isArray(parsed)) aiFilledFields = parsed.filter(s => typeof s === "string");
    } catch {
      aiFilledFields = null;
    }
  }
  return {
    id: row.id,
    promptSnapshot: JSON.parse(row.prompt_snapshot) as ImagePrompt,
    promptText: row.prompt_text,
    imagePath: row.image_path,
    imageUrl: row.image_url,
    imageFormat: row.image_format,
    size: row.size,
    quality: row.quality,
    providerId: row.provider_id,
    durationMs: row.duration_ms,
    prose: row.prose,
    aiFilledFields,
    createdAt: row.created_at,
  };
}

const SELECT_GENERATION_COLUMNS = `id, prompt_snapshot, prompt_text, image_path, image_url, image_format,
        size, quality, provider_id, duration_ms, prose, ai_filled_fields, created_at`;

export function createGeneration(input: CreateGenerationInput): Generation {
  const id = randomUUID();
  const now = Date.now();
  const prose = input.prose ?? null;
  const aiFilledFields = input.aiFilledFields ?? null;
  const aiFilledJson = aiFilledFields ? JSON.stringify(aiFilledFields) : null;
  db()
    .prepare(
      `INSERT INTO generations
       (id, prompt_snapshot, prompt_text, image_path, image_url, image_format,
        size, quality, provider_id, duration_ms, prose, ai_filled_fields, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      JSON.stringify(input.promptSnapshot),
      input.promptText,
      input.imagePath,
      input.imageUrl ?? null,
      input.imageFormat ?? "png",
      input.size,
      input.quality,
      input.providerId ?? null,
      input.durationMs ?? null,
      prose,
      aiFilledJson,
      now,
    );
  return {
    id,
    promptSnapshot: input.promptSnapshot,
    promptText: input.promptText,
    imagePath: input.imagePath,
    imageUrl: input.imageUrl ?? null,
    imageFormat: input.imageFormat ?? "png",
    size: input.size,
    quality: input.quality,
    providerId: input.providerId ?? null,
    durationMs: input.durationMs ?? null,
    prose,
    aiFilledFields,
    createdAt: now,
  };
}

export function listGenerations(limit = 100): Generation[] {
  const rows = db()
    .prepare(
      `SELECT ${SELECT_GENERATION_COLUMNS}
       FROM generations
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as GenerationRow[];
  return rows.map(rowToGeneration);
}

export function getGeneration(id: string): Generation | null {
  const row = db()
    .prepare(
      `SELECT ${SELECT_GENERATION_COLUMNS}
       FROM generations WHERE id = ?`,
    )
    .get(id) as GenerationRow | undefined;
  return row ? rowToGeneration(row) : null;
}
