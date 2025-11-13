export class StorageService {
  /**
   * @param {Object} shopMatic - главный сервис, ожидается поле productService
   * @param {Object} opts
   * @param {string} [opts.storageKey]
   * @param {string} [opts.favStorageKey]
   * @param {string} [opts.viewedStorageKey]
   * @param {number} [opts.maxViewedItems]
   * @param {number} [opts.defaultConcurrency]
   */
  constructor(shopMatic, opts = {}) {
    this.shopMatic = shopMatic;
    this.storageKey = opts.storageKey ?? 'gribkov_cart_v1';
    this.favStorageKey = opts.favStorageKey ?? 'gribkov_favs_v1';
    this.viewedStorageKey = opts.viewedStorageKey ?? 'gribkov_viewed_v1';
    this.maxViewedItems = Number(opts.maxViewedItems ?? 20);
    this.defaultConcurrency = Math.max(1, Number(opts.defaultConcurrency ?? 6));
  }

  // -----------------------
  // === Helpers / utils ===
  // -----------------------

  _storageAvailable() {
    try {
      const k = '__storage_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  _safeSetItem(key, value) {
    try {
      if (!this._storageAvailable()) return false;
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`StorageService._safeSetItem error for key="${key}"`, e);
      return false;
    }
  }

  _safeGetItem(key) {
    try {
      if (!this._storageAvailable()) return null;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      console.warn(`StorageService._safeGetItem error for key="${key}"`, e);
      return null;
    }
  }

  _normalizeCartItem(input = {}) {
    return {
      name: String(input.name ?? ''),
      fullname: input.fullname ?? '',
      price: Number(input.price ?? 0),
      qty: Number(input.qty ?? 0),
      picture: input.picture ?? '',
      stock: Number(input.stock ?? 0),
      specs: input.specs ?? {}
    };
  }

  _normalizeFavItem(input) {
    // favs can be strings or objects
    if (typeof input === 'string') {
      return { name: input, fullname: '', price: 0, stock: 0 };
    }
    return {
      name: String(input.name ?? ''),
      fullname: input.fullname ?? '',
      price: Number(input.price ?? 0),
      stock: Number(input.stock ?? 0)
    };
  }

  _getKeyFromItem(it) {
    if (!it) return '';
    if (typeof it === 'string') return String(it).trim();
    return String(it.name ?? it.id ?? it.productId ?? it._missingId ?? '').trim();
  }

  /**
   * Batch-process generic items: fetch product data by key and augment items with
   * { available, missing, stock, fullname?, price? }.
   *
   * @param {Array} items - массив нормализованных объектов (но может быть и строками)
   * @param {Object} options - { concurrency }
   * @param {Function} onMissingCallback - optional (key) => void
   */
  async _loadWithAvailability(items, options = {}, onMissingCallback) {
    try {
      if (!Array.isArray(items) || items.length === 0) return items || [];

      const ps = this.shopMatic?.productService;
      const concurrency = Math.max(1, Number(options.concurrency ?? this.defaultConcurrency));

      // if no productService — just mark availability from item.stock
      if (!ps || typeof ps.fetchById !== 'function') {
        return items.map((item) => {
          const key = this._getKeyFromItem(item);
          const stock = Number((item && item.stock) ?? 0);
          return Object.assign({}, (typeof item === 'string' ? { name: item } : item), {
            available: stock > 0,
            missing: !key,
            stock
          });
        });
      }

      const results = [];
      for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const promises = batch.map(async (rawItem) => {
          const out = Object.assign({}, (typeof rawItem === 'string' ? { name: rawItem } : rawItem));
          const key = this._getKeyFromItem(rawItem);

          if (!key) {
            out.available = false;
            out.missing = true;
            out.stock = 0;
            return out;
          }

          try {
            const product = await ps.fetchById(key);

            if (!product) {
              // product not found — allow callback to handle (e.g. remove favorite)
              console.warn(`StorageService: no product response for id="${key}"`);
              if (typeof onMissingCallback === 'function') {
                try { onMissingCallback(key); } catch (e) { /* swallow */ }
              }
              out.available = false;
              out.missing = true;
              out.stock = 0;
              return out;
            }

            const prodStock = Number(product.stock ?? product._stock ?? product.count ?? product.qty ?? 0);
            out.stock = Number(out.stock || prodStock || 0);
            out.available = prodStock > 0;
            out.missing = false;

            if (!out.fullname && (product.fullname || product.title || product.name)) {
              out.fullname = product.fullname ?? product.title ?? product.name;
            }
            if ((!out.price || out.price === 0) && (product.price != null)) {
              out.price = Number(product.price);
            }
            return out;
          } catch (e) {
            console.warn(`StorageService: fetchById failed for id="${key}"`, e);
            out.available = false;
            out.missing = true;
            out.stock = 0;
            return out;
          }
        });

        // use allSettled to be resilient against single-promise rejections
        const settled = await Promise.allSettled(promises);
        for (const s of settled) {
          if (s.status === 'fulfilled') results.push(s.value);
          else {
            // if something unexpectedly rejected — push a safe fallback
            results.push({ available: false, missing: true, stock: 0 });
          }
        }
      }

      return results;
    } catch (e) {
      console.warn('StorageService._loadWithAvailability error', e);
      return items || [];
    }
  }

  // -----------------------
  // === Cart methods ===
  // -----------------------

  /**
   * Сохраняет корзину (массив объектов) в localStorage в нормализованном виде.
   * @param {Array} cartArr
   * @returns {boolean} успех
   */
  saveCart(cartArr) {
    try {
      const normalized = (Array.isArray(cartArr) ? cartArr : []).map(i => this._normalizeCartItem(i));
      return this._safeSetItem(this.storageKey, normalized);
    } catch (e) {
      console.warn('StorageService.saveCart error', e);
      return false;
    }
  }

  /**
   * Загружает корзину (если есть) или null.
   * @returns {Array|null}
   */
  loadCart() {
    return this._safeGetItem(this.storageKey);
  }

  /**
   * Загружает корзину и асинхронно дополняет данными наличия через productService.fetchById
   * @param {Object} options { concurrency }
   * @returns {Promise<Array>}
   */
  async loadCartWithAvailability(options = {}) {
    const rawCart = this.loadCart();
    if (!Array.isArray(rawCart) || rawCart.length === 0) return rawCart || [];
    return this._loadWithAvailability(rawCart, options);
  }

  // -----------------------
  // === Favorites methods ===
  // -----------------------

  /**
   * Сохраняет избранное — принимает Set/Array/Iterable.
   * @param {Iterable} setLike
   * @returns {boolean}
   */
  saveFavs(setLike) {
    try {
      const arr = Array.from(setLike ?? []);
      return this._safeSetItem(this.favStorageKey, arr);
    } catch (e) {
      console.warn('StorageService.saveFavs error', e);
      return false;
    }
  }

  loadFavs() {
    return this._safeGetItem(this.favStorageKey);
  }

  /**
   * Загружает избранное и проверяет наличие в каталоге аналогично корзине.
   * Поддерживает элементы вида string или object.
   * @param {Object} options { concurrency }
   */
  async loadFavsWithAvailability(options = {}) {
    const rawFavs = this.loadFavs();
    if (!Array.isArray(rawFavs) || rawFavs.length === 0) return rawFavs || [];

    // Подготовим нормализованный массив, сохраняя исходный предмет (строка или объект)
    const normalized = rawFavs.map(item => (typeof item === 'string' ? item : this._normalizeFavItem(item)));

    // Если productService умеет удалять отсутствующие favorites, передадим callback
    const onMissing = (key) => {
      try {
        const ps = this.shopMatic?.productService;
        if (ps && typeof ps.removeFavoriteById === 'function') {
          ps.removeFavoriteById(key);
        }
      } catch (e) {
        // не фейлим основную операцию
        console.warn('StorageService: onMissing callback failed for', key, e);
      }
    };

    return this._loadWithAvailability(normalized, options, onMissing);
  }

  // -----------------------
  // === Viewed items ===
  // -----------------------

  /**
   * Добавляет просмотренный товар (нормализует, убирает дубликаты, ограничивает длину).
   * @param {Object} product
   */
  addViewed(product) {
    try {
      if (!product || !product.name) return;
      const item = {
        name: String(product.name ?? ''),
        fullname: product.fullname ?? '',
        price: Number(product.price ?? 0),
        picture: product.picture ?? '',
        stock: Number(product.stock ?? 0),
        viewedAt: Date.now()
      };

      const viewed = this.loadViewed() ?? [];
      const filtered = viewed.filter(p => p.name !== item.name);
      filtered.unshift(item);
      const limited = filtered.slice(0, this.maxViewedItems);

      this._safeSetItem(this.viewedStorageKey, limited);
	  this.shopMatic.viewedModule.sync();
    } catch (e) {
      console.warn('StorageService.addViewed error', e);
    }
  }

  loadViewed() {
    return this._safeGetItem(this.viewedStorageKey);
  }

  clearViewed() {
    try {
      if (!this._storageAvailable()) return;
      localStorage.removeItem(this.viewedStorageKey);
	  this.shopMatic.viewedModule.sync();
    } catch (e) {
      console.warn('StorageService.clearViewed error', e);
    }
  }
}
