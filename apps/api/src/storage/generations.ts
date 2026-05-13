import { randomUUID } from "node:crypto";
import type { ImagePrompt } from "@inkast/shared";
import { db } from "./db.js";

export interface Generation {
  id: string;
  promptSnapshot: ImagePrompt;
  promptText: string;
  imagePath: string;
  imageFormat: string;
  size: string;
  quality: string;
  providerId: string | null;
  durationMs: number | null;
  createdAt: number;
}

export interface CreateGenerationInput {
  promptSnapshot: ImagePrompt;
  promptText: string;
  imagePath: string;
  imageFormat?: string;
  size: string;
  quality: string;
  providerId?: string;
  durationMs?: number;
}

interface GenerationRow {
  id: string;
  prompt_snapshot: string;
  prompt_text: string;
  image_path: string;
  image_format: string;
  size: string;
  quality: string;
  provider_id: string | null;
  duration_ms: number | null;
  created_at: number;
}

function rowToGeneration(row: GenerationRow): Generation {
  return {
    id: row.id,
    promptSnapshot: JSON.parse(row.prompt_snapshot) as ImagePrompt,
    promptText: row.prompt_text,
    imagePath: row.image_path,
    imageFormat: row.image_format,
    size: row.size,
    quality: row.quality,
    providerId: row.provider_id,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

export function createGeneration(input: CreateGenerationInput): Generation {
  const id = randomUUID();
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO generations
       (id, prompt_snapshot, prompt_text, image_path, image_format,
        size, quality, provider_id, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      JSON.stringify(input.promptSnapshot),
      input.promptText,
      input.imagePath,
      input.imageFormat ?? "png",
      input.size,
      input.quality,
      input.providerId ?? null,
      input.durationMs ?? null,
      now,
    );
  return {
    id,
    promptSnapshot: input.promptSnapshot,
    promptText: input.promptText,
    imagePath: input.imagePath,
    imageFormat: input.imageFormat ?? "png",
    size: input.size,
    quality: input.quality,
    providerId: input.providerId ?? null,
    durationMs: input.durationMs ?? null,
    createdAt: now,
  };
}

export function listGenerations(limit = 100): Generation[] {
  const rows = db()
    .prepare(
      `SELECT id, prompt_snapshot, prompt_text, image_path, image_format,
              size, quality, provider_id, duration_ms, created_at
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
      `SELECT id, prompt_snapshot, prompt_text, image_path, image_format,
              size, quality, provider_id, duration_ms, created_at
       FROM generations WHERE id = ?`,
    )
    .get(id) as GenerationRow | undefined;
  return row ? rowToGeneration(row) : null;
}
