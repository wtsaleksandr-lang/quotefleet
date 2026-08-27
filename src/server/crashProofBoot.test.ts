/**
 * CRASH-PROOF BOOT — the core acceptance test for "a background failure can
 * never crash-loop prod".
 *
 * It spawns the COMPILED production server (dist/server/index.js) exactly as
 * Replit runs it, then uses the CRASHPROOF_SELFTEST=1 chaos probe to raise a
 * SIMULATED background uncaughtException shortly AFTER the server is listening —
 * i.e. the precise failure class that used to exit the process and crash-loop
 * (a stray synchronous throw escaping background work). The test asserts the
 * process SURVIVES it: the child does NOT exit, and /healthz keeps returning 200
 * before AND after the fault.
 *
 * The DB is a blackhole (accepts the TCP connection, never speaks Postgres) so
 * the boot is hermetic and the ONLY fault under test is the injected background
 * throw — background DB work simply stalls harmlessly behind the blackhole.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();
const BUDGET_MS = 8_000;

async function unusedLocalPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not determine an available local port');
  }
  const { port } = address;
  server.close();
  await once(server, 'close');
  return port;
}

async function startDatabaseBlackhole(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: TcpServer = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    // Accept the connection but never send a Postgres protocol response.
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not determine the database blackhole port');
  }
  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
}

async function requestHealth(port: number, timeoutMs: number): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Drain the body so the socket is released.
  await response.text();
  return response.status;
}

async function waitForHealth(port: number, budgetMs: number): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await requestHealth(port, Math.max(1, deadline - Date.now()));
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`Health endpoint did not respond within ${budgetMs}ms: ${String(lastError)}`);
}

describe('crash-proof boot: a background fault never crash-loops the process', () => {
  it('survives a post-listen background uncaughtException and keeps /healthz at 200', async () => {
    const port = await unusedLocalPort();
    const databaseBlackhole = await startDatabaseBlackhole();
    const child = spawn(process.execPath, [resolve(rootDir, 'dist/server/index.js')], {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HOST: '127.0.0.1',
        DATABASE_URL: `postgresql://crashproof:crashproof@127.0.0.1:${databaseBlackhole.port}/unavailable`,
        ANTHROPIC_API_KEY: '',
        PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
        SESSION_SECRET: 'crashproof-boot-test-only',
        DOPPLER_TOKEN: '',
        DOPPLER_SERVICE_TOKEN: '',
        // Arm the chaos probe: raise a simulated background uncaughtException
        // ~200ms after listen. Disable every real cron so nothing else competes.
        CRASHPROOF_SELFTEST: '1',
        AGGREGATES_CRON_DISABLED: '1',
        LIFECYCLE_EMAIL_DISABLED: '1',
        WEEKLY_DIGEST_DISABLED: '1',
        FUEL_CRON_DISABLED: '1',
        DISABLE_WEEKLY_REINGEST: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (c: Buffer) => (output += c.toString()));
    child.stderr?.on('data', (c: Buffer) => (output += c.toString()));

    let exited = false;
    child.on('exit', () => (exited = true));

    try {
      // 1. Server comes up and healthz is 200 (before the fault).
      const before = await waitForHealth(port, BUDGET_MS);
      expect(before).toBe(200);
      expect(output).toContain('QuoteFleet listening');

      // 2. Wait past the probe's 200ms delay so the background throw has fired.
      await new Promise((r) => setTimeout(r, 800));

      // 3. The guard must have caught it and SURVIVED — not exited.
      expect(output).toContain('UNCAUGHT EXCEPTION after listen (non-fatal, surviving');
      expect(output).toContain('[crashproof-selftest] simulated background uncaughtException');
      expect(exited).toBe(false);
      expect(child.exitCode).toBeNull();

      // 4. /healthz STILL returns 200 after the background fault — the route did
      //    not crash-loop; the process degraded and kept serving.
      const after = await waitForHealth(port, BUDGET_MS);
      expect(after).toBe(200);
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 1_000))]);
      }
      await databaseBlackhole.close();
    }
  }, BUDGET_MS + 6_000);
});
