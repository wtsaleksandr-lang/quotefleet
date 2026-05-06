/**
 * Express type augmentation. Adds `req.user` and `req.tenant` set by
 * the auth middleware so route handlers can access them in a typed way.
 */
import type { User, Tenant } from '../db/schema.js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      tenant?: Tenant;
    }
  }
}

export {};
