import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function generateSlug(length = 8): string {
  const bytes = randomBytes(length * 2);
  let slug = "";

  for (const byte of bytes) {
    slug += ALPHABET[byte % ALPHABET.length];
    if (slug.length >= length) {
      break;
    }
  }

  return slug;
}

export function sanitizeSlug(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("%")) {
    return null;
  }

  if (!/^[a-z0-9_-]+$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}
