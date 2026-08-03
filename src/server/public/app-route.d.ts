/**
 * Type declaration for the browser UMD module app-route.js so the vitest suite
 * (a .ts file) can import the pure route-parsing helpers without tripping `pnpm
 * typecheck` (TS7016 — no declaration file). Kept in lockstep with the .js.
 */
export const DEFAULT_ROUTE: string;

/** Full nested route from a pathname, e.g. "/app/leads/QF-123" → "leads/QF-123". */
export function fullRoute(pathname: string | null | undefined): string;

/** Top-level segment of a route, e.g. "leads/QF-123" → "leads". */
export function baseSegment(route: string | null | undefined): string;

/** Sub-path after a base, e.g. subPath("leads/QF-123", "leads") → "QF-123". */
export function subPath(route: string | null | undefined, base: string): string;

declare const _default: {
  DEFAULT_ROUTE: string;
  fullRoute: typeof fullRoute;
  baseSegment: typeof baseSegment;
  subPath: typeof subPath;
};
export default _default;
