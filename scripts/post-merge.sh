#!/usr/bin/env bash
set -euo pipefail

# Reconcile an isolated task-agent merge with the development environment.
# Production schema changes remain owned by Replit's Publish flow.
pnpm install --frozen-lockfile
pnpm db:push
pnpm build