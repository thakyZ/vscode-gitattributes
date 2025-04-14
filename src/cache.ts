/**
 * Simple in-memory cache
 *
 * There are probably a lot of existing and much more advanced packages in npm,
 * but I had too much fun in implementing it on my own.
 */

import type { GitAttributesFile } from "./extension.js";

export class CacheItem {
  private _key: string;
  private _value: GitAttributesFile[];
  private storeDate: Date;

  public get key(): string {
    return this._key;
  }

  public get value(): GitAttributesFile[] {
    return this._value;
  }

  public constructor(key: string, value: GitAttributesFile[]) {
    this._key = key;
    this._value = value;
    this.storeDate = new Date();
  }

  public isExpired(expirationInterval: number): boolean {
    return this.storeDate.getTime() + expirationInterval * 1000 < Date.now();
  }
}

export class Cache {
  /**
   * The key value store (a simple JavaScript object)
   */
  private _store: Record<string, CacheItem>;
  /**
   * Cache expiration interval in seconds
   */
  private _cacheExpirationInterval: number;

  public constructor(cacheExpirationInterval: number) {
    this._store = {};
    this._cacheExpirationInterval = cacheExpirationInterval;
  }

  public add(item: CacheItem): void {
    this._store[item.key] = item;
  }

  public get(key: string): GitAttributesFile[] | undefined {
    const item: CacheItem = this._store[key];

    // Check expiration
    if (item === undefined || item.isExpired(this._cacheExpirationInterval)) {
      return undefined;
    }

    return item.value;
  }

  public getCacheItem(key: string): CacheItem | undefined {
    const item: CacheItem = this._store[key];

    // Check expiration
    if (item === undefined || item.isExpired(this._cacheExpirationInterval)) {
      return undefined;
    }

    return item;
  }
}
