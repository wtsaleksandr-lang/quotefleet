/**
 * OS/OW jurisdiction data catalog.
 *
 * Texas remains the Phase 1 engine registry for backwards compatibility.
 * New research files are registered here in the requested rollout order so
 * data verification and future engine integration have one stable catalog.
 */
export { TEXAS_OSOW_RULES } from './texas.js';
export { OHIO_OSOW_RULES } from './ohio.js';
export { PENNSYLVANIA_OSOW_RULES } from './pennsylvania.js';
export { NEW_YORK_OSOW_RULES } from './newYork.js';
export { ILLINOIS_OSOW_RULES } from './illinois.js';
export { INDIANA_OSOW_RULES } from './indiana.js';
export { MISSOURI_OSOW_RULES } from './missouri.js';
export { OKLAHOMA_OSOW_RULES } from './oklahoma.js';
export { GEORGIA_OSOW_RULES } from './georgia.js';
export { ALABAMA_OSOW_RULES } from './alabama.js';
export { VIRGINIA_OSOW_RULES } from './virginia.js';
export { NORTH_CAROLINA_OSOW_RULES } from './northCarolina.js';

import type { JurisdictionOsowRules } from '../types.js';
import { ALABAMA_OSOW_RULES } from './alabama.js';
import { GEORGIA_OSOW_RULES } from './georgia.js';
import { ILLINOIS_OSOW_RULES } from './illinois.js';
import { INDIANA_OSOW_RULES } from './indiana.js';
import { MISSOURI_OSOW_RULES } from './missouri.js';
import { NEW_YORK_OSOW_RULES } from './newYork.js';
import { NORTH_CAROLINA_OSOW_RULES } from './northCarolina.js';
import { OHIO_OSOW_RULES } from './ohio.js';
import { OKLAHOMA_OSOW_RULES } from './oklahoma.js';
import { PENNSYLVANIA_OSOW_RULES } from './pennsylvania.js';
import { VIRGINIA_OSOW_RULES } from './virginia.js';

/** Jurisdictions added by the OS/OW data-preparation rollout, in task order. */
export const REQUESTED_OSOW_JURISDICTIONS: readonly JurisdictionOsowRules[] = [
  OHIO_OSOW_RULES,
  PENNSYLVANIA_OSOW_RULES,
  NEW_YORK_OSOW_RULES,
  ILLINOIS_OSOW_RULES,
  INDIANA_OSOW_RULES,
  MISSOURI_OSOW_RULES,
  OKLAHOMA_OSOW_RULES,
  GEORGIA_OSOW_RULES,
  ALABAMA_OSOW_RULES,
  VIRGINIA_OSOW_RULES,
  NORTH_CAROLINA_OSOW_RULES,
];
