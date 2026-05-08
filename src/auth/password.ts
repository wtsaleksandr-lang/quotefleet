/**
 * bcrypt password hashing. Cost 12 ≈ 250ms on a modern node — slow
 * enough to deter offline cracking, fast enough that a login still
 * completes well under a second.
 */
import bcrypt from 'bcryptjs';

const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
