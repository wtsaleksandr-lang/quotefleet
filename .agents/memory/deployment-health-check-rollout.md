---
name: Deployment health check rollout
description: How Replit deployment health-check settings take effect.
---

Configure the dedicated health-check path before publishing, then verify the first deployment’s health logs after the publish completes. Restarting the development workflow does not update the already-published deployment’s probe configuration.

**Why:** Development workflow and production deployment lifecycles are separate; a workflow restart can still show the currently published deployment’s former probe path in deployment logs.

**How to apply:** When changing readiness configuration, validate the endpoint locally, publish the configuration, then inspect the new deployment’s startup logs for the configured probe path.