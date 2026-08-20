/**
 * Unguessable token helpers for the multi-carrier RFQ feature.
 *
 * Two token kinds, both minted the same way (they only differ in what they
 * unlock):
 *   - view_token   — on rfq_requests; the shipper's private responses link.
 *   - quote_token  — on rfq_recipients; a single carrier's private quote page +
 *                    one-click opt-out link.
 *
 * Same construction as src/server/emailImport.ts `generateIngestEmailToken`
 * (nanoid customAlphabet over lowercase alphanumerics), widened to 32 chars so a
 * token that IS the auth for a page is infeasible to guess/enumerate.
 */
import { customAlphabet } from 'nanoid';

/** Lowercase alphanumerics — URL-safe, case-insensitive, no ambiguity in email. */
const TOKEN_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 32 chars over a 36-symbol alphabet ≈ 165 bits of entropy — unguessable. */
const makeToken = customAlphabet(TOKEN_ALPHABET, 32);

/** Mint a fresh, unguessable RFQ token (shipper view OR carrier quote). */
export function generateRfqToken(): string {
  return makeToken();
}

/** True iff a string is a syntactically-valid RFQ token (defends the route
 *  params so a malformed token never hits the DB as an odd query). */
export function isValidRfqToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-z]{16,64}$/.test(token);
}
