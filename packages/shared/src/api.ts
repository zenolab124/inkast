import type { ImagePrompt, PromptDraft } from "./prompt.js";

export type LlmBackend = "claude-code" | "openai-compatible";

export interface DraftPromptRequest {
  input: string;
  backend?: LlmBackend;
}

export type DraftPromptResponse = PromptDraft;

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type ImageQuality = "low" | "medium" | "high";

export interface ProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  priority: number;
  keyMasked: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderCreateRequest {
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
  priority?: number;
}

export interface ProviderUpdateRequest {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  priority?: number;
}

export interface GenerationRecord {
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

export interface GenerateImageRequest {
  prompt: ImagePrompt;
  size?: ImageSize;
  quality?: ImageQuality;
  bypassModeration?: boolean;
}

export interface GenerateImageAttempt {
  providerId: string;
  providerName: string;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
}

export interface GenerateImageResponse {
  generation: GenerationRecord;
  driver: {
    providerName: string;
    providerId: string;
    attempts: GenerateImageAttempt[];
    totalDurationMs: number;
  };
}
