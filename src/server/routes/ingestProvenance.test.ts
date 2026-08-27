/**
 * Rate-sheet ingest PROVENANCE surfacing (audit display gap).
 *
 * The pipeline already STORES who an email-sourced rate draft came from
 * (`ingest_jobs.source_email`, system-owned rows with a null userId, and the
 * retained raw email in `storage_ref`). The gap was purely DISPLAY: the list +
 * detail ingest APIs dropped it, so the operator couldn't tell an email draft
 * from a manual upload. These tests lock the API contract that closes that gap:
 *   - `source` is derived ('email' | 'upload') and correct for both origins,
 *   - `sourceEmail` is returned (null for manual uploads — no false positives),
 *   - the detail view extracts the email SUBJECT from a body-email storage_ref.
 * The DB is mocked; we assert only the response shape the UI reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriveJobSource, emailSubjectFromStorageRef } from './ingest.js';

const h = vi.hoisted(() => {
  const state = { rows: [] as Record<string, unknown>[] };
  return { state };
});

vi.mock('../../db/client.js', () => {
  function chain() {
    const c: Record<string, unknown> = {
      select() { return c; },
      from() { return c; },
      where() { return c; },
      orderBy() { return c; },
      limit() { return Promise.resolve(h.state.rows); },
    };
    return c;
  }
  return { db: () => chain() };
});
// The real syncTenantToMarketplace returns Promise<void>; apply chains .catch()
// on it (ingest.ts:783), so the mock MUST resolve a promise, not bare undefined.
vi.mock('../../marketplace/sync.js', () => ({ syncTenantToMarketplace: vi.fn().mockResolvedValue(undefined) }));

type Handler = (req: MockReq, res: MockRes) => unknown;
interface MockReq { params: { id: string }; tenant: { id: number }; user: { id: number } }
class MockRes {
  statusCode = 200;
  body: any = undefined;
  status(c: number) { this.statusCode = c; return this; }
  json(o: unknown) { this.body = o; return this; }
}

async function getHandlers(): Promise<{ detail: Handler; list: Handler }> {
  const { registerIngestRoutes } = await import('./ingest.js');
  const handlers: Record<string, Handler> = {};
  const fakeApp = {
    get: (path: string, ...rest: unknown[]) => { handlers[path] = rest[rest.length - 1] as Handler; },
    post: () => {},
  } as unknown as import('express').Express;
  registerIngestRoutes(fakeApp);
  return { detail: handlers['/api/tenant/ingest/:id'], list: handlers['/api/tenant/ingest'] };
}

function req(): MockReq { return { params: { id: '7' }, tenant: { id: 1 }, user: { id: 1 } }; }

beforeEach(() => { h.state.rows = []; });

describe('deriveJobSource', () => {
  it('marks a job with a sourceEmail as email', () => {
    expect(deriveJobSource({ sourceEmail: 'dispatch@acmecarrier.com', userId: null })).toBe('email');
  });
  it('marks a system-owned job (null userId, no sourceEmail) as email', () => {
    expect(deriveJobSource({ sourceEmail: null, userId: null })).toBe('email');
  });
  it('marks an operator upload (userId set, no sourceEmail) as upload', () => {
    expect(deriveJobSource({ sourceEmail: null, userId: 42 })).toBe('upload');
  });
});

describe('emailSubjectFromStorageRef', () => {
  it('extracts the Subject line from a body-email storage_ref', () => {
    const raw = 'Subject: October lane rates\n\nHere are our updated rates.';
    const b64 = Buffer.from(raw, 'utf8').toString('base64');
    expect(emailSubjectFromStorageRef(b64)).toBe('October lane rates');
  });
  it('returns null for opaque attachment/upload bytes (no Subject header)', () => {
    const b64 = Buffer.from('%PDF-1.7 binary attachment bytes here', 'utf8').toString('base64');
    expect(emailSubjectFromStorageRef(b64)).toBeNull();
  });
  it('returns null for null / short input', () => {
    expect(emailSubjectFromStorageRef(null)).toBeNull();
    expect(emailSubjectFromStorageRef('')).toBeNull();
  });
});

describe('GET /api/tenant/ingest/:id — provenance in detail', () => {
  it('returns source=email, the sender, and the parsed subject for an email job', async () => {
    const b64 = Buffer.from('Subject: Q4 rates\n\nbody', 'utf8').toString('base64');
    h.state.rows = [{
      id: 7, tenantId: 1, userId: null, filename: 'Q4 rates.txt', mimeType: 'text/plain',
      sizeBytes: 20, status: 'ready_for_review', parsedJson: {}, errorMessage: null,
      appliedAt: null, createdAt: new Date('2026-08-06T14:14:00Z'),
      sourceEmail: 'dispatch@acmecarrier.com', storageRef: b64,
    }];
    const { detail } = await getHandlers();
    const res = new MockRes();
    await detail(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.job.source).toBe('email');
    expect(res.body.job.sourceEmail).toBe('dispatch@acmecarrier.com');
    expect(res.body.job.subject).toBe('Q4 rates');
  });

  it('returns source=upload and null provenance for a manual upload (no false positive)', async () => {
    h.state.rows = [{
      id: 8, tenantId: 1, userId: 42, filename: 'ratesheet.pdf', mimeType: 'application/pdf',
      sizeBytes: 1000, status: 'ready_for_review', parsedJson: {}, errorMessage: null,
      appliedAt: null, createdAt: new Date(), sourceEmail: null,
      storageRef: Buffer.from('%PDF binary', 'utf8').toString('base64'),
    }];
    const { detail } = await getHandlers();
    const res = new MockRes();
    await detail(req(), res);
    expect(res.body.job.source).toBe('upload');
    expect(res.body.job.sourceEmail).toBeNull();
    expect(res.body.job.subject).toBeNull();
  });
});

describe('GET /api/tenant/ingest — provenance in list', () => {
  it('tags each row with source + sourceEmail', async () => {
    h.state.rows = [
      { id: 7, filename: 'Q4 rates.txt', mimeType: 'text/plain', sizeBytes: 20, status: 'ready_for_review', appliedAt: null, createdAt: new Date(), sourceEmail: 'dispatch@acmecarrier.com', userId: null },
      { id: 8, filename: 'ratesheet.pdf', mimeType: 'application/pdf', sizeBytes: 1000, status: 'applied', appliedAt: new Date(), createdAt: new Date(), sourceEmail: null, userId: 42 },
    ];
    const { list } = await getHandlers();
    const res = new MockRes();
    await list(req(), res);
    expect(res.statusCode).toBe(200);
    const [emailJob, uploadJob] = res.body.jobs;
    expect(emailJob.source).toBe('email');
    expect(emailJob.sourceEmail).toBe('dispatch@acmecarrier.com');
    expect(uploadJob.source).toBe('upload');
    expect(uploadJob.sourceEmail).toBeNull();
    // userId must NOT leak into the list response (selected only to derive source).
    expect('userId' in uploadJob).toBe(false);
  });
});
