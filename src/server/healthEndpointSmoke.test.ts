import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();
const STARTUP_READINESS_BUDGET_MS = 5_000;

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

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

async function startDatabaseBlackhole(): Promise<{
  port: number;
  waitForConnection: (timeoutMs: number) => Promise<void>;
  close: () => Promise<void>;
}> {
  const sockets = new Set<Socket>();
  let markConnected: (() => void) | undefined;
  const connected = new Promise<void>((resolveConnection) => {
    markConnected = resolveConnection;
  });
  const server: TcpServer = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    // The child's postgres client is killed mid-connection during teardown,
    // which resets this accepted socket. Without an 'error' listener that
    // ECONNRESET surfaces as an unhandled exception and fails the run.
    socket.on('error', () => {});
    markConnected?.();
    // Intentionally accept PostgreSQL connections but never send a protocol
    // response. This recreates a blocked startup dependency without relying on
    // an external database or a fast connection-refused error.
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
    waitForConnection: (timeoutMs) =>
      new Promise((resolveConnection, rejectConnection) => {
        const timeout = setTimeout(() => {
          rejectConnection(new Error(`Startup work did not connect to the database blackhole within ${timeoutMs}ms`));
        }, timeoutMs);
        void connected.then(() => {
          clearTimeout(timeout);
          resolveConnection();
        });
      }),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
}

type HealthResponse = {
  statusCode: number;
  body: string;
};

function requestHealth(port: number, timeoutMs: number): Promise<HealthResponse> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    request
      .then(async (response) => {
        resolveRequest({
          statusCode: response.status,
          body: await response.text(),
        });
      })
      .catch(rejectRequest);
  });
}

async function waitForHealth(port: number, budgetMs: number): Promise<HealthResponse> {
  const deadline = Date.now() + budgetMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      return await requestHealth(port, Math.max(1, deadline - Date.now()));
    } catch (err) {
      lastError = err;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }

  throw new Error(`Health endpoint did not respond within ${budgetMs}ms: ${String(lastError)}`);
}

describe('production health endpoint', () => {
  it('keeps public health checks mounted without leaking db diagnostics', async () => {
    const app = await read('src/server/app.ts');

    expect(app).toContain("app.get('/healthz'");
    expect(app).toContain("app.get('/api/health'");
    expect(app).toContain("status: 'up'");
    expect(app).toContain("status: 'down'");
    expect(app).toContain("[health] db ping failed");
    expect(app).not.toContain('dbUrlSet');
    expect(app).not.toContain('dbUrlScheme');
    expect(app).not.toContain('dbUrlHasHost');
    expect(app).not.toContain('causeMessage');
  });

  it('configures production probes to use the dedicated health endpoint', async () => {
    const replitConfig = await read('.replit');
    const app = await read('src/server/app.ts');

    expect(replitConfig).toContain('healthcheckPath = "/healthz"');
    expect(replitConfig).not.toContain('healthcheckPath = "/"');
    expect(app).toContain("res.json({ ok: true, status: 'up'");
  });

  it('opens the compiled production listener before post-listen jobs', async () => {
    const index = await read('src/server/index.ts');
    const listenerPosition = index.search(/^[ \t]*app\.listen\(env\.PORT, env\.HOST,/m);
    const postListenJobsPosition = index.search(/^[ \t]*void runPostListenJobs\(\);/m);
    const postListenJobs = index.slice(
      index.indexOf('async function runPostListenJobs'),
      index.indexOf('\nasync function main'),
    );

    expect(listenerPosition).toBeGreaterThanOrEqual(0);
    expect(postListenJobsPosition).toBeGreaterThan(listenerPosition);
    expect(postListenJobs).toContain('await seedDirectoryTerminals()');
    expect(postListenJobs).toContain('void maybeAutoHealCarrierDirectory()');
    expect(postListenJobs).toContain('void maybeBackfillNearestPortCodes()');

    const port = await unusedLocalPort();
    const databaseBlackhole = await startDatabaseBlackhole();
    const child = spawn(process.execPath, [resolve(rootDir, 'dist/server/index.js')], {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HOST: '127.0.0.1',
        DATABASE_URL: `postgresql://readiness-smoke:readiness-smoke@127.0.0.1:${databaseBlackhole.port}/unavailable`,
        ANTHROPIC_API_KEY: '',
        PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
        SESSION_SECRET: 'startup-readiness-smoke-only',
        DOPPLER_TOKEN: '',
        DOPPLER_SERVICE_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    try {
      // Confirm that runBackgroundBoot is actively blocked on the database
      // before verifying the listener's liveness response.
      await databaseBlackhole.waitForConnection(STARTUP_READINESS_BUDGET_MS);
      const health = await waitForHealth(port, STARTUP_READINESS_BUDGET_MS);

      // The blackhole accepts the database connection but never responds. The
      // liveness endpoint must still return within the readiness budget while
      // optional startup work remains stalled behind that connection.
      expect(health.statusCode).toBe(200);
      expect(JSON.parse(health.body)).toMatchObject({
        ok: true,
        status: 'up',
      });
      expect(output).toContain('QuoteFleet listening');
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([
          once(child, 'exit'),
          new Promise((resolveExit) => setTimeout(resolveExit, 1_000)),
        ]);
      }
      await databaseBlackhole.close();
    }
  }, STARTUP_READINESS_BUDGET_MS + 2_000);
});
