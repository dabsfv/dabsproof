// Response bodies are kept as SHA-256 and length only. There are no excerpts.
import { createHash } from 'node:crypto';

export interface BodyDigest {
  sha256: string;
  length: number;
}

export function bodyDigest(body: Uint8Array | string): BodyDigest {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), length: bytes.length };
}
