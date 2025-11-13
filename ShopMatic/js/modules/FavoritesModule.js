/**
 * FavoritesModule for ShopMatic
 *
 * @author Calista Verner
 * Version: 1.4.0
 * Date: 2025-11-04
 * License: MIT
 *
 * Responsibilities:
 *  - manage favorites list (preserve insertion order, O(1) lookup)
 *  - persist to provided storage, with optional debounce
 *  - enforce optional maximum and overflow behaviour
 *  - subscribe/unsubscribe model for UI updates
 *  - optional cross-tab sync via window.storage events
 *
 */
export class FavoritesModule {
  constructor({ storage, opts = {} } = {}) {
    if (!storage || typeof storage.loadFavs !== 'function' || typeof storage.saveFavs !== 'function') {
      throw new Error('FavoritesModule requires storage with loadFavs() and saveFavs() methods');
    }

    this.storage = storage;
    this._max = Math.max(0, Number.isFinite(opts.max) ? Math.floor(opts.max) : 0);
    this._overflow = opts.overflow === 'drop_oldest' ? 'drop_oldest' : 'reject';
    this._sync = opts.sync !== undefined ? Boolean(opts.sync) : true;
    this._saveDebounceMs = Math.max(0, Number.isFinite(opts.saveDebounceMs) ? opts.saveDebounceMs : 200);
    this._storageKey = opts.storageKey || this.storage.favStorageKey || this.storage.storageKey || null;
    this._list = [];
    this._set = new Set();
    this._subs = new Set();
    this._saveTimer = null;
    this._destroyed = false;
    this._onStorageEvent = this._onStorageEvent.bind(this);

    if (Array.isArray(opts.initial) && opts.initial.length) {
      this.importFromArray(opts.initial, { replace: true, persist: false });
    }

    if (this._sync && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', this._onStorageEvent);
    }
  }

  // --- Internal Helpers ---

  /**
   * Emit an event to all subscribers.
   * @private
   */
  _emit(event) {
    const payload = {
      type: event.type,
      id: event.id || null,
      reason: event.reason || null,
      list: this.exportToArray(),
      count: this.getCount(),
    };
    for (const cb of this._subs) {
      try {
        cb(payload);
      } catch (e) {
        console.warn('FavoritesModule subscriber error', e);
      }
    }
  }

  /**
   * Schedule the save to storage with debounce.
   * @private
   */
  _scheduleSave() {
    if (this._saveDebounceMs <= 0) {
      this._doSave();
      return;
    }
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._doSave();
    }, this._saveDebounceMs);
  }

  /**
   * Perform the actual save to storage.
   * @private
   */
  async _doSave() {
    try {
      const result = this.storage.saveFavs(this._list);
      if (result && typeof result.then === 'function') await result;
    } catch (e) {
      console.warn('FavoritesModule: save to storage failed', e);
    }
  }

  /**
   * Normalize an ID into a string.
   * @private
   */
  _normalizeId(id) {
    if (id === null || id === undefined) return null;
    const candidate = id?.name || id?.id || id?.productId || id?._missingId || id;
    const str = String(candidate).trim();
    return str === '' ? null : str;
  }

  /**
   * Apply truncation when exceeding max limit.
   * @private
   */
  _applyMaxTruncate() {
    if (this._max <= 0 || this._list.length <= this._max) return false;
    this._list = this._list.slice(-this._max);
    this._set = new Set(this._list);
    return true;
  }

  // --- Public Methods ---

  /**
   * Load favorites from storage and update the internal list.
   */
  async loadFromStorage() {
    try {
      const raw = await (this.storage.loadFavsWithAvailability ? this.storage.loadFavsWithAvailability() : this.storage.loadFavs());
      const normalized = this._normalizeList(raw);
      this._list = normalized;
      this._set = new Set(normalized);

      if (this._applyMaxTruncate()) this._scheduleSave();
      this._emit({ type: 'load', id: null });
      return this.exportToArray();
    } catch (e) {
      console.warn('FavoritesModule.loadFromStorage error', e);
      return this.exportToArray();
    }
  }

  /**
   * Save the current list immediately.
   */
  saveToStorage() {
    if (this._destroyed) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._doSave();
  }

  /**
   * Check if an ID is in favorites.
   */
  has(id) {
    return this.isFavorite(id);
  }

  /**
   * Check if an ID is in favorites.
   */
  isFavorite(id) {
    return this._set.has(this._normalizeId(id));
  }

  /**
   * Get all favorite IDs as an array.
   */
  getAll() {
    return [...this._list];
  }

  /**
   * Get the number of favorites.
   */
  getCount() {
    return this._list.length;
  }

  /**
   * Add an item to favorites.
   */
  add(id) {
    if (this._destroyed) return false;
    const sid = this._normalizeId(id);
    if (!sid || this._set.has(sid)) return false;

    if (this._max > 0 && this._list.length >= this._max) {
      if (this._overflow === 'drop_oldest') {
        const removed = this._list.shift();
        if (removed !== undefined) this._set.delete(removed);
      } else {
        this._emit({ type: 'limit', id: sid, reason: 'limit_reached' });
        return false;
      }
    }

    this._list.push(sid);
    this._set.add(sid);
    this._scheduleSave();
    this._emit({ type: 'add', id: sid });
    return true;
  }

  /**
   * Remove an item from favorites.
   */
  remove(id) {
    if (this._destroyed) return false;
    const sid = this._normalizeId(id);
    if (!sid || !this._set.has(sid)) return false;

    this._list = this._list.filter(x => x !== sid);
    this._set.delete(sid);
    this._scheduleSave();
    this._emit({ type: 'remove', id: sid });
    return true;
  }

  /**
   * Toggle an item's presence in favorites.
   */
  toggle(id) {
    if (this._destroyed) return false;
    return this.isFavorite(id) ? this.remove(id) : this.add(id);
  }

  /**
   * Clear all favorites.
   */
  clear() {
    if (this._destroyed) return;
    if (!this._list.length) return;

    this._list = [];
    this._set.clear();
    this._scheduleSave();
    this._emit({ type: 'clear', id: null });
  }

  /**
   * Import a list of IDs into the favorites.
   */
  importFromArray(arr = [], { replace = false, persist = true } = {}) {
    if (!Array.isArray(arr)) return this.exportToArray();

    const normalized = this._normalizeList(arr);
    if (replace) {
      this._list = normalized.slice(-this._max);
      this._set = new Set(this._list);
    } else {
      normalized.forEach(sid => {
        if (!this._set.has(sid)) {
          if (this._max > 0 && this._list.length >= this._max) {
            if (this._overflow === 'drop_oldest') {
              const removed = this._list.shift();
              if (removed !== undefined) this._set.delete(removed);
            } else {
              return;
            }
          }
          this._list.push(sid);
          this._set.add(sid);
        }
      });
    }
    if (persist) this._scheduleSave();
    this._emit({ type: 'import', id: null });
    return this.exportToArray();
  }

  /**
   * Normalize and deduplicate a list of IDs.
   * @private
   */
  _normalizeList(arr) {
    const seen = new Set();
    return arr.reduce((normalized, el) => {
      const sid = this._normalizeId(el);
      if (sid && !seen.has(sid)) {
        seen.add(sid);
        normalized.push(sid);
      }
      return normalized;
    }, []);
  }

  /**
   * Return a copy of the favorites array.
   */
  exportToArray() {
    return [...this._list];
  }

  /**
   * Subscribe to favorites events.
   */
  subscribe(cb, { immediate = true } = {}) {
    if (typeof cb !== 'function') throw new Error('subscribe requires a function');
    this._subs.add(cb);
    if (immediate) {
      cb({ type: 'load', id: null, list: this.exportToArray(), count: this.getCount() });
    }
    return () => this._subs.delete(cb);
  }

  /**
   * Respond to storage events (cross-tab sync).
   * @private
   */
  async _onStorageEvent(e) {
    const favKey = this._storageKey || (this.storage && this.storage.favStorageKey) || null;
    if (e?.key === favKey) {
      const prev = this.exportToArray();
      await this.loadFromStorage();
      const curr = this.exportToArray();
      if (prev.length !== curr.length || prev.some((v, i) => v !== curr[i])) {
        this._emit({ type: 'sync', id: null });
      }
    }
  }

  /**
   * Destroy the module and clear all timers and listeners.
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    if (this._sync && window.removeEventListener) {
      window.removeEventListener('storage', this._onStorageEvent);
    }
    this._subs.clear();
  }

  /**
   * Iterate over the favorites list (yields IDs).
   */
  [Symbol.iterator]() {
    return this._list[Symbol.iterator]();
  }

  /**
   * Return a new Set containing all favorites.
   */
  toSet() {
    return new Set(this._set);
  }
}