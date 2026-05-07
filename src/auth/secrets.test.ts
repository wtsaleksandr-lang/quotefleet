/**
 * Round-trip test for the encryption helper used to store per-tenant
 * Anthropic keys. Catches regressions in nonce handling, base64 framing,
 * or AES-GCM mode.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';

// SESSION_SECRET must be set BEFORE we import the secrets module
// (loadEnv() is called eagerly inside encrypt/decrypt for the key).
beforeAll(() => {
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = randomBytes(32).toString('hex');
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
  if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = 'sk-test';
});

describe('secrets.encrypt / decrypt', () => {
  it('round-trips arbitrary strings', async () => {
    const { encrypt, decrypt } = await import('./secrets.js');
    const inputs = [
      'sk-ant-api03-aaaaaaaa',
      'unicode 🚀 🎯 — ñoño',
      'a'.repeat(10_000),
    ];
    for (const s of inputs) {
      const enc = encrypt(s);
      expect(enc).not.toBe(s);
      expect(decrypt(enc)).toBe(s);
    }
  });

  it('produces different ciphertext for the same plaintext (random nonce)', async () => {
    const { encrypt } = await import('./secrets.js');
    const a = encrypt('hello');
    const b = encrypt('hello');
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext', async () => {
    const { encrypt, decrypt } = await import('./secrets.js');
    const enc = encrypt('hello');
    // Flip a byte in the ciphertext segment (third part of "iv:tag:ct")
    const [iv, tag, ct] = enc.split(':');
    const ctBuf = Buffer.from(ct, 'base64url');
    ctBuf[0] ^= 0xff;
    const tampered = `${iv}:${tag}:${ctBuf.toString('base64url')}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});
