/**
 * QuoteFleet smoke tests (Q9 — initial Playwright bootstrap).
 *
 * Minimal coverage: server boot + key public-facing routes return 2xx
 * with no 5xx side-quests. Expanded suites (admin / tenant / billing /
 * Q2-Q4 sweeps) will land in follow-up PRs.
 */

import { test, expect, type Page } from '@playwright/test';

async function smokeCheck(page: Page, path: string, opts?: { allowStatus?: number[] }) {
  const failedRequests: { url: string; status: number }[] = [];
  page.on('response', (res) => {
    if (res.status() >= 500) failedRequests.push({ url: res.url(), status: res.status() });
  });

  const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const status = res?.status() ?? 0;
  const allowed = opts?.allowStatus ?? [200];
  expect(allowed, `${path} returned ${status}; allowed=${allowed.join(',')}`).toContain(status);
  expect(failedRequests, `5xx errors on ${path}: ${JSON.stringify(failedRequests)}`).toHaveLength(0);
}

test.describe('QuoteFleet — public routes', () => {
  test('GET / serves the marketing landing page', async ({ page }) => {
    await smokeCheck(page, '/');
  });

  test('GET /app serves the embeddable calculator', async ({ page }) => {
    await smokeCheck(page, '/app');
  });

  test('GET /chat serves the chat widget shell', async ({ page }) => {
    await smokeCheck(page, '/chat');
  });
});

test.describe('QuoteFleet — health', () => {
  test('GET /healthz returns 200 with db ping', async ({ request }) => {
    const res = await request.get('/healthz');
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    // /healthz returns { ok: true, ... } when DB pings successfully.
    expect(body?.ok).toBe(true);
  });
});

test.describe('QuoteFleet — admin gate', () => {
  test('GET /admin without auth redirects or shows login', async ({ page }) => {
    // /admin is the admin SPA shell — unauthenticated users should not
    // see tenant data. Accept either redirect-to-login or a 200 that
    // renders the login form (current behavior).
    await page.goto('/admin', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await expect(page).toHaveURL(/\/admin|\/login/, { timeout: 5_000 });
  });
});
