import { describe, it, expect } from 'vitest';
import { LruCache } from './lruCache.js';

describe('LruCache', () => {
  it('returns set values', () => {
    const c = new LruCache<number>(3, 60_000);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
  });

  it('returns undefined for missing keys', () => {
    const c = new LruCache<number>(3, 60_000);
    expect(c.get('nope')).toBeUndefined();
  });

  it('evicts least-recently-used when over size', () => {
    const c = new LruCache<number>(2, 60_000);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // touch a so b is now LRU
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
  });

  it('expires entries after TTL', async () => {
    const c = new LruCache<number>(10, 5);
    c.set('a', 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.get('a')).toBeUndefined();
  });
});
