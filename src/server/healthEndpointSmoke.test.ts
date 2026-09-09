import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();
/*
 * How long the compiled server gets to answer /healthz while the database is
 * blackholed and never answers.
 *
 * Raised from 5s. What this test proves is a STRUCTURAL property — the listener
 * opens even though startup work is blocked on a database that will never
 * respond — and the failure it guards against is an UNBOUNDED wait, not a slow
 * one. Five seconds also has to cover spawning a Node process and loading the
 * whole compiled app, which under the full suite's parallel load exceeded it for
 * reasons that have nothing to do with the server's design: the test passed
 * alone and failed in the suite.
 *
 * Fifteen seconds keeps the distinction the test exists for (bounded vs never)
 * while not failing on scheduler noise. For scale, production boot was measured
 * at ~24s, so this was never a performance budget in the first place.
 */
const STARTUP_READINESS_BUDGET_MS = 15_000;

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

function requestPath(
  port: number,
  path: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<HealthResponse> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = fetch(`http://127.0.0.1:${port}${path}`, {
      headers,
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
      return await requestPath(port, '/healthz', Math.max(1, deadline - Date.now()));
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

  it('keeps Replit root probes on a database-free loopback path', async () => {
    const replitConfig = await read('.replit');
    const app = await read('src/server/app.ts');

    expect(replitConfig).not.toContain('healthcheckPath');
    expect(app).toContain("userAgent.startsWith('go-http-client/')");
    expect(app.indexOf("app.get('/', (req, res, next)")).toBeLessThan(
      app.indexOf('app.use(hostInfoMiddleware)'),
    );
  });

  it('opens the compiled production listener before post-listen jobs', async () => {
    const index = await read('src/server/index.ts');
    // The listener's return value is now captured (`const server = app.listen(...)`)
    // so the inbound socket timeouts / maxConnections backstop can be set on it;
    // allow that optional assignment prefix. The ordering assertion below — the
    // actual point of this test — is unchanged.
    const listenerPosition = index.search(
      /^[ \t]*(?:const \w+ = )?app\.listen\(env\.PORT, env\.HOST,/m,
    );
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
    /*
     * SCHEMA SELF-HEAL MUST BE FIRE-AND-FORGET, NOT ABSENT.
     *
     * This assertion used to forbid the self-heal calls outright, and that was
     * too broad in a way that cost real protection. The September outage was
     * caused by Replit probing GET / — which went through tenant resolution and
     * could hit the database — not by the self-heal DDL itself. The probe path
     * is now database-free (asserted in the test above), so DDL contention can
     * no longer delay it whatever else is running.
     *
     * Removing the self-heal entirely re-opened two failure modes it was
     * written for, both of which have taken production down before: Replit's
     * publish tool DROPs tables and columns and its deploy skips db:migrate, and
     * `directory_aggregate_cache` never being created is the documented cause of
     * the earlier recurring all-domains-down outage. A boot of the production
     * build against the production database on 2026-09-08 created
     * seasonal_restrictions, ops_alerts and pilot_car_operators — so these are
     * not hypothetical no-ops, they were actively repairing live schema drift.
     *
     * What actually has to hold is that the heal can never DELAY the listener or
     * the probe. That is guaranteed by two things this test already checks — the
     * listener opens before post-listen jobs run, and the jobs are invoked with
     * `void` rather than awaited — so those are what is asserted here instead of
     * the presence or absence of any particular call.
     */
    for (const heal of [
      'ensureSelfHealTables',
      'ensureSelfHealColumns',
      'ensureAuthorityRevalidationColumns',
      'ensureJobRunsTable',
      'ensureOpsAlertsTable',
      'ensureSeasonalRestrictionsTable',
      'ensurePilotCarTable',
    ]) {
      if (!postListenJobs.includes(`${heal}(`)) continue;
      // Never awaited: an awaited heal would serialise boot behind a DDL lock.
      // A plain string check rather than a built RegExp — the first version of
      // this line built the pattern in a template literal, where \s and \( are
      // not valid escapes, and shipped /awaits+ensureSelfHealTables(/ instead.
      expect(
        postListenJobs.includes(`await ${heal}(`),
        `${heal} must not be awaited in the boot path`,
      ).toBe(false);
    }
    // And the whole block stays non-blocking: the heal chain is reached through
    // a `void` statement, so nothing in it can push the listener later.
    expect(postListenJobs.includes('void ensureSelfHealTables()')).toBe(true);

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
      const rootProbe = await requestPath(port, '/', STARTUP_READINESS_BUDGET_MS, {
        'user-agent': 'Go-http-client/1.1',
      });

      // The blackhole accepts the database connection but never responds. The
      // liveness endpoint must still return within the readiness budget while
      // optional startup work remains stalled behind that connection.
      expect(health.statusCode).toBe(200);
      expect(JSON.parse(health.body)).toMatchObject({
        ok: true,
        status: 'up',
      });
      expect(rootProbe).toMatchObject({
        statusCode: 200,
        body: 'ok',
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
