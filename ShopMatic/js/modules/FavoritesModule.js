/**
 * FavoritesModule for ShopMatic
 *
 * Author: Calista Verner
 * Version: 1.3.0
 * Date: 2025-10-14
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
  /**
   * @param {object} params.storage - объект-хранилище с методами loadFavs() и saveFavs(iterable)
   * @param {object} [params.opts]
   * @param {number} [params.opts.max] - максимальное число избранного (0 = без лимита)
   * @param {('reject'|'drop_oldest')} [params.opts.overflow='reject'] - поведение при достижении лимита
   * @param {boolean} [params.opts.sync=true] - слушать window.storage для синхронизации вкладок
   * @param {number} [params.opts.saveDebounceMs=200] - дебаунс для сохранения
   * @param {Array|string[]} [params.opts.initial] - начальные id (опционально)
   * @param {string} [params.opts.storageKey] - (опционально) ключ storage, если storage не предоставляет его
   */
  constructor({ storage, opts = {} } = {}) {
    if (!storage || typeof storage.loadFavs !== 'function' || typeof storage.saveFavs !== 'function') {
      throw new Error('FavoritesModule requires storage with loadFavs() and saveFavs() methods');
    }

    this.storage = storage;
    this._max = Number.isFinite(opts.max) && opts.max > 0 ? Math.floor(opts.max) : 0;
    this._overflow = (opts.overflow === 'drop_oldest') ? 'drop_oldest' : 'reject';
    this._sync = opts.sync !== undefined ? Boolean(opts.sync) : true;
    this._saveDebounceMs = Number.isFinite(opts.saveDebounceMs) ? Math.max(0, opts.saveDebounceMs) : 200;

    // optional explicit storage key to listen for cross-tab events; fallback to storage.favStorageKey
    this._storageKey = opts.storageKey || this.storage.favStorageKey || this.storage.storageKey || null;

    // internal structures: array preserves insertion order, set — O(1) lookup
    this._list = [];      // ['id1','id2', ...] — newest appended at end
    this._set = new Set(); // mirrors _list

    // subscribers: functions(event)
    this._subs = new Set();

    // debounce timer
    this._saveTimer = null;
    this._destroyed = false;

    // bind handler
    this._onStorageEvent = this._onStorageEvent.bind(this);

    // optionally load initial list (persist=false to avoid writing immediately)
    if (Array.isArray(opts.initial) && opts.initial.length) {
      this.importFromArray(opts.initial, { replace: true, persist: false });
    }

    // load from storage (try/catch)
    //this.loadFromStorage();

    // auto-sync across tabs
    if (this._sync && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', this._onStorageEvent);
    }
  }

  /* ===================== internal helpers ===================== */

  _emit(event) {
    // event: { type, id = null, reason? }
    const payload = {
      type: event.type,
      id: event.id === undefined ? null : event.id,
      reason: event.reason === undefined ? null : event.reason,
      list: this.exportToArray(),
      count: this.getCount()
    };
    for (const cb of Array.from(this._subs)) {
      try {
        cb(payload);
      } catch (e) {
        // подписчики не должны ломать модуль
        // eslint-disable-next-line no-console
        console.warn('FavoritesModule subscriber error', e);
      }
    }
  }

  _scheduleSave() {
    if (this._saveDebounceMs <= 0) {
      // immediate
      this._doSave();
      return;
    }
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._doSave();
    }, this._saveDebounceMs);
  }

  async _doSave() {
    try {
      // save array — preserves order in storage
      const res = this.storage.saveFavs(this._list);
      // поддержка промисов на случай асинхронного storage
      if (res && typeof res.then === 'function') await res;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('FavoritesModule: save to storage failed', e);
    }
  }

_normalizeId(id) {
  if (id === null || id === undefined) return null;
  try {
    // если передали объект с полями, попробуем извлечь его идентификатор
    if (typeof id === 'object') {
      const candidate = id.name ?? id.id ?? id.productId ?? id._missingId ?? null;
      if (candidate === null || candidate === undefined) return null;
      const s = String(candidate).trim();
      return s === '' ? null : s;
    }
    const s = String(id).trim();
    return s === '' ? null : s;
  } catch (e) {
    return null;
  }
}


  _applyMaxTruncate() {
    if (this._max <= 0) return false;
    if (this._list.length <= this._max) return false;
    // keep last _max elements (assume newest at end)
    this._list = this._list.slice(-this._max);
    this._set = new Set(this._list);
    return true;
  }

  /* ===================== persistence ===================== */

  /**
   * Загружает фавориты из storage и обновляет внутреннее состояние.
   * Возвращает текущий массив (копия).
   */
async loadFromStorage() {
  try {
    // сначала попробуем более "богатый" метод, если он есть; иначе — базовый loadFavs()
    let raw;
    if (typeof this.storage.loadFavsWithAvailability === 'function') {
      raw = await this.storage.loadFavsWithAvailability();
    } else if (typeof this.storage.loadFavs === 'function') {
      raw = await this.storage.loadFavs();
    } else {
      // ничего не делать — storage контракт был проверен в конструкторе, но на всякий случай
      raw = null;
    }

    // debug: не выводим в prod консоль, но можно включить логи через опцию (не реализовано здесь)
     console.log('FavoritesModule.loadFromStorage raw:', raw);

    if (!Array.isArray(raw)) {
      // nothing or invalid — keep current list if present, else empty
      if (!this._list.length) {
        this._list = [];
        this._set = new Set();
      }
      this._emit({ type: 'load', id: null });
      return this.exportToArray();
    }

    // нормализуем: поддерживаем случаи, когда элемент — строка или объект { name, ... }
    const normalized = [];
    const seen = new Set();
    for (const el of raw) {
      try {
        // если элемент — объект, выберем возможные поля-идентификаторы
        const candidate = (typeof el === 'object' && el !== null)
          ? (el.name ?? el.id ?? el.productId ?? el._missingId ?? null)
          : el;
        const sid = this._normalizeId(candidate);
        if (!sid) continue;
        if (seen.has(sid)) continue;
        seen.add(sid);
        normalized.push(sid);
      } catch { /* skip invalid */ }
    }

    this._list = normalized;
    this._set = new Set(normalized);

    // если есть лимит — обрезаем старые элементы (с начала) чтобы сохранить последние добавленные
    if (this._applyMaxTruncate()) {
      // persist truncated version
      this._scheduleSave();
    }

    this._emit({ type: 'load', id: null });
    return this.exportToArray();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('FavoritesModule.loadFromStorage error', e);
    return this.exportToArray();
  }
}


  /**
   * Принудительная синхронная запись в storage (без дебаунса)
   */
  saveToStorage() {
    if (this._destroyed) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    // не ждём результат — сохраняем и продолжаем
    this._doSave();
  }

  /* ===================== public API ===================== */

  has(id) {
    return this.isFavorite(id);
  }

  isFavorite(id) {
    const sid = this._normalizeId(id);
    if (!sid) return false;
    return this._set.has(sid);
  }

  getAll() {
    // возвращаем копию (по умолчанию — от старых к новым)
    return Array.from(this._list);
  }

  getCount() {
    return this._list.length;
  }

  /**
   * Добавить элемент. Возвращает true если добавлен, false если уже был или отказано (лимит/ошибка).
   * При overflow === 'drop_oldest' будет удалять старейший элемент и добавлять новый.
   */
  add(id) {
    if (this._destroyed) return false;
    const sid = this._normalizeId(id);
    if (!sid) return false;

    if (this._set.has(sid)) return false;

    if (this._max > 0 && this._list.length >= this._max) {
      if (this._overflow === 'drop_oldest') {
        // удаляем самый старый (с начала)
        const removed = this._list.shift();
        if (removed !== undefined) this._set.delete(removed);
        // продолжаем добавление
      } else {
        // reject
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
   * Удалить элемент. Возвращает true если удалён, false если не найден.
   */
  remove(id) {
    if (this._destroyed) return false;
    const sid = this._normalizeId(id);
    if (!sid) return false;
    if (!this._set.has(sid)) return false;

    // удалить из массива и сет
    this._list = this._list.filter(x => x !== sid);
    this._set.delete(sid);
    this._scheduleSave();
    this._emit({ type: 'remove', id: sid });
    return true;
  }

  /**
   * Переключает состояние. Возвращает true если после вызова элемент находится в favs, false если не в favs.
   */
  toggle(id) {
    if (this._destroyed) return false;
    const sid = this._normalizeId(id);
    if (!sid) return false;
    if (this._set.has(sid)) {
      this.remove(sid);
      return false;
    } else {
      const ok = this.add(sid);
      return Boolean(ok);
    }
  }

  /**
   * Очищает избранное
   */
  clear() {
    if (this._destroyed) return;
    if (this._list.length === 0) return;
    this._list = [];
    this._set.clear();
    this._scheduleSave();
    this._emit({ type: 'clear', id: null });
  }

  /**
   * Импорт массива id.
   * opts.replace = true  -> заменить текущую коллекцию новым массивом
   * opts.persist = true|false -> вызвать сохранение в storage (по умолчанию true)
   * Возвращает итоговый массив.
   */
  importFromArray(arr = [], { replace = false, persist = true } = {}) {
    if (!Array.isArray(arr)) return this.exportToArray();
    const normalized = [];
    const seen = new Set();
    for (const el of arr) {
      const sid = this._normalizeId(el);
      if (!sid) continue;
      if (seen.has(sid)) continue;
      seen.add(sid);
      normalized.push(sid);
    }
    if (replace) {
      // respect max: keep last _max if needed
      let final = normalized;
      if (this._max > 0 && final.length > this._max) final = final.slice(-this._max);
      this._list = final;
      this._set = new Set(final);
    } else {
      // add missing preserving existing order
      for (const sid of normalized) {
        if (this._set.has(sid)) continue;
        if (this._max > 0 && this._list.length >= this._max) {
          if (this._overflow === 'drop_oldest') {
            // remove oldest to make room
            const removed = this._list.shift();
            if (removed !== undefined) this._set.delete(removed);
          } else {
            break; // stop adding
          }
        }
        this._list.push(sid);
        this._set.add(sid);
      }
    }
    if (persist) this._scheduleSave();
    this._emit({ type: 'import', id: null });
    return this.exportToArray();
  }

  exportToArray() {
    return Array.from(this._list);
  }

  /**
   * Подписка на события изменений.
   * cb(event) — получает { type, id, list, count }
   * Возвращает функцию отписки.
   */
  subscribe(cb, { immediate = true } = {}) {
    if (typeof cb !== 'function') throw new Error('subscribe requires a function');
    this._subs.add(cb);
    // немедленно отправить текущее состояние
    if (immediate) {
      try { cb({ type: 'load', id: null, list: this.exportToArray(), count: this.getCount() }); } catch (e) {}
    }
    return () => { this._subs.delete(cb); };
  }

  /* ===================== cross-tab sync ===================== */

async _onStorageEvent(e) {
  try {
    if (!e) return;
    const favKey = this._storageKey || (this.storage && (this.storage.favStorageKey || this.storage.storageKey)) || null;
    if (!favKey) return;

    // если ключ совпадает (или null при clear) — перезагрузим список и дождёмся результата
    if (e.key === null || e.key === String(favKey) || e.key === favKey) {
      const prev = this.exportToArray();
      await this.loadFromStorage(); // теперь ждём завершения
      const curr = this.exportToArray();
      const changed = prev.length !== curr.length || prev.some((v, i) => v !== curr[i]);
      if (changed) this._emit({ type: 'sync', id: null });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('FavoritesModule._onStorageEvent error', err);
  }
}


  /* ===================== lifecycle ===================== */

  /**
   * Перестаёт слушать storage и отменяет отложенные операции.
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
	
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._sync && typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('storage', this._onStorageEvent);
    }
    this._subs.clear();
  }

  /* ===================== convenience iterators ===================== */

  [Symbol.iterator]() {
    return this._list[Symbol.iterator]();
  }

  toSet() {
    return new Set(this._set);
  }
}