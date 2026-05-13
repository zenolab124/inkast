import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { masterKey } from "./runtime.js";

/**
 * Provider API keys are encrypted at rest using AES-256-GCM with a per-row
 * random IV. The auth tag is stored separately so tampering is detectable.
 */

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

export function decryptSecret(enc: EncryptedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), enc.iv);
  decipher.setAuthTag(enc.tag);
  const plaintext = Buffer.concat([decipher.update(enc.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Mask a secret for safe display in API responses. We never echo the raw
 * key — only show enough to help the user identify which one they entered.
 */
export function maskKey(plain: string): string {
  if (plain.length <= 8) return "•".repeat(plain.length);
  return `${plain.slice(0, 4)}${"•".repeat(Math.max(4, plain.length - 8))}${plain.slice(-4)}`;
}
