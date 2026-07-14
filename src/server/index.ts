/**
 * Server entry point. Loads env, creates the Express app, listens.
 */
import { loadEnv } from '../config.js';
import { createApp } from './app.js';
import { startMarketplaceCron } from '../marketplace/cron.js';
import { startLifecycleEmailCron } from '../email/lifecycleCron.js';
import { startWeeklyDigestCron } from '../email/weeklyDigestCron.js';
import { startFuelSurchargeCron } from '../eia/dieselPrice.js';

async function main() {
  const env = loadEnv();
  const app = createApp();
  app.listen(env.PORT, env.HOST, () => {
    console.log(`[server] QuoteFleet listening on http://${env.HOST}:${env.PORT}`);
    console.log(`[server] Public base URL: ${env.PUBLIC_BASE_URL}`);
  });
  startMarketplaceCron();
  startLifecycleEmailCron();
  startWeeklyDigestCron();
  startFuelSurchargeCron();
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
