---
name: Production startup reliability
description: Avoid web-service downtime caused by schema operations in the runtime startup path.
---

Do not run Drizzle migrations, `CREATE TABLE`, `ALTER TABLE`, or other production schema changes from the application process. Bind the HTTP listener first and keep post-listen tasks non-destructive and independently error-handled.

**Why:** On 2026-08-24, runtime schema-repair work waited on database locks and caused deployment probes to time out even after the service had started.

**How to apply:** Apply production schema changes through Replit's Publish database-diff flow. Keep liveness paths free of migrations and DDL; background refreshes and seeds must not reject into the main server process.