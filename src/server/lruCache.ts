/**
 * Tiny in-memory LRU with TTL. Used to cache external API responses
 * (Google Places, Mapbox) so we don't pay per-keystroke for autocomplete.
 *
 * Single-instance only (Reserved VM is single-instance, so fine).
 * For multi-instance, swap to Redis.
 */
export class LruCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // LRU touch — re-insert moves to end of insertion order.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
