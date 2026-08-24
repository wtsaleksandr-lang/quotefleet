---
name: Production startup reliability
description: Prevent readiness failures caused by startup-time database schema operations.
---

Bind the HTTP listener before optional background work that may wait on database locks. Keep liveness paths independent of database work, and make detached startup tasks catch and log their own errors.

**Why:** On 2026-08-24, production schema-repair operations blocked before port 5000 opened. The deployment supervisor repeatedly restarted the process after its readiness timeout, resulting in sustained 0% uptime.

**How to apply:** Use Replit's Publish database-diff flow for planned production schema changes. Keep boot work limited to configuration, app construction, and listening; run legacy schema safeguards, seeding, refreshes, and backfills after readiness without allowing them to reject unhandled.
