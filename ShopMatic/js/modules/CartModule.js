/**
 * Cart module for ShopMatic
 *
 * @author Calista Verner
 * Version: 1.3.2
 * Date: 2025-10-28
 * License: MIT
 *
 * Responsibilities:
 *  - manage cart model (add/remove/change qty), persistence and events
 *  - synchronize UI pieces: header counters, mini-cart, cart grid
 *  - perform efficient partial updates and fallbacks when renderer/productService vary
 */
import { MiniCart } from './MiniCart.js';

export class CartModule {
  static UI_MESSAGES = Object.freeze({
    NOT_ENOUGH_STOCK: 'Недостаточно товара на складе.',
    ONLY_X_LEFT: 'В наличии только {stock} шт.',
    ADDED_TO_CART_HTML: 'Товар ({title}) x{qty} добавлен в корзину <a href="#page/cart">Перейти в корзину</a>',
    ADDED_TO_CART_PLAIN: 'Товар "{title}" x{qty} добавлен в корзину.',
    FAVORITES_UNAVAILABLE: 'Модуль избранного недоступен.',
    INSUFFICIENT_STOCK_ADD: 'Недостаточно на складе. Доступно: {max}.',
    INSUFFICIENT_STOCK_CHANGEQTY: 'Недостаточно на складе. Доступно: {stock}.',
    PRODUCT_OUT_OF_STOCK: 'Товар отсутствует на складе.',
    REACHED_MAX_STOCK_LIMIT_NOTIFY: 'Достигнут максимальный лимит по остатку.',
    PRODUCT_LIMIT_DEFAULT: 'У вас уже максимум в корзине',
    PRODUCT_LIMIT_REACHED: 'Вы достигли максимального количества этого товара',
    NO_STOCK_TEXT: 'Товара нет в наличии'
  });

  _msg(key, vars = {}) {
    const pool = (this.constructor && this.constructor.UI_MESSAGES) || {};
    const tpl = pool[key] ?? '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }

  constructor({ storage, productService, renderer, notifications, favorites = null, opts = {} }) {
    this.storage = storage;
    this.productService = productService;
    this.renderer = renderer;
    this.notifications = notifications;
    this.favorites = favorites;

    this.opts = Object.assign({
      saveDebounceMs: 200,
      debug: false,
      parallelProductFetch: true,
      productFetchBatchSize: 20,
      stockCacheTTL: 5000
    }, opts || {});

    this.cart = [];
    this._idIndex = new Map(); // id -> index
    this._pendingChangedIds = new Set();
    this._saveTimeout = null;

    // DOM refs
    this.headerCartNum = null;
    this.cartGrid = null;
    this.cartCountInline = null;
    this.cartTotal = null;
    this.miniCartTotal = null;

    this.miniCart = new MiniCart({ renderer: this.renderer, notifications: this.notifications, opts: opts.miniCart || {} });

    // grid listeners
    this._gridHandler = null;
    this._gridInputHandler = null;
    this._gridListenersAttachedTo = null;

    // row-sync guard & source map
    this._rowsSyncing = new WeakSet();
    this._changeSourceMap = new Map();

    this._cssEscape = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
      ? CSS.escape
      : (s => String(s).replace(/["\\]/g, '\\$&'));
  }

  _logError(...args) {
    if (this.opts.debug) console.error('[CartModule]', ...args);
  }

  // --- Id normalization & index management (incremental) ---
  _normalizeId(id) {
    if (id === undefined || id === null) return '';
    if (typeof id === 'object') {
      return String(id.id ?? id.name ?? id.productId ?? id.cartId ?? id.itemId ?? '').trim();
    }
    return String(id).trim();
  }
  _normalizeIdKey(id) { return String(this._normalizeId(id)); }

  _rebuildIndex() {
    this._idIndex.clear();
    for (let i = 0; i < this.cart.length; i++) {
      const key = this._normalizeIdKey(this.cart[i].name);
      if (key) this._idIndex.set(key, i);
    }
  }
  
  getCartItems () {
	  return this.cart;
  }

  _updateIndexOnInsert(id, index) {
    // when inserting at index, increment indices >= index
    try {
      const key = this._normalizeIdKey(id);
      if (!key) return;
      // shift existing indices
      for (const [k, idx] of Array.from(this._idIndex.entries())) {
        if (idx >= index) this._idIndex.set(k, idx + 1);
      }
      this._idIndex.set(key, index);
    } catch (e) { this._rebuildIndex(); }
  }

  _updateIndexOnRemove(index) {
    // remove item at index and shift indices > index down
    try {
      if (index === undefined || index === null) { this._rebuildIndex(); return; }
      let removedKey = null;
      for (const [k, idx] of Array.from(this._idIndex.entries())) {
        if (idx === index) { removedKey = k; break; }
      }
      if (removedKey) this._idIndex.delete(removedKey);
      for (const [k, idx] of Array.from(this._idIndex.entries())) {
        if (idx > index) this._idIndex.set(k, idx - 1);
      }
    } catch (e) { this._rebuildIndex(); }
  }

  _findCartIndexById(id) {
    const sid = this._normalizeIdKey(id);
    if (!sid) return -1;
    const idx = this._idIndex.get(sid);
    if (typeof idx === 'number' && this.cart[idx] && this._normalizeIdKey(this.cart[idx].name) === sid) return idx;
    // fallback
    for (let i = 0; i < this.cart.length; i++) {
      if (this._normalizeIdKey(this.cart[i].name) === sid) {
        this._rebuildIndex();
        return i;
      }
    }
    return -1;
  }

  _getCartItemById(id) {
    const idx = this._findCartIndexById(id);
    return idx >= 0 ? this.cart[idx] : null;
  }

  _getCartQtyById(id) {
    const it = this._getCartItemById(id);
    return it ? Number(it.qty || 0) : 0;
  }

  _formatPrice(value) {
    try {
      return Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(value || 0));
    } catch (e) {
      return String(value || '0');
    }
  }

  _noteChangedId(id) {
    const k = this._normalizeIdKey(id);
    if (k) this._pendingChangedIds.add(k);
  }

  _clearPendingChanged() { this._pendingChangedIds.clear(); }

  _scheduleSave() {
    if (!this.storage || typeof this.storage.saveCart !== 'function') return;
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      try { this.storage.saveCart(this.cart); } catch (e) { this._logError('saveCart failed', e); }
      this._saveTimeout = null;
    }, Math.max(0, Number(this.opts.saveDebounceMs || 200)));
  }

  _emitUpdateEvent() {
    try {
      const totalCount = this.cart.reduce((s, it) => s + Number(it.qty || 0), 0);
      const totalSum = this.cart.reduce((s, it) => s + (Number(it.price || 0) * Number(it.qty || 0)), 0);
      const changedIds = Array.from(this._pendingChangedIds);
      this._pendingChangedIds.clear();
      const ev = new CustomEvent('cart:updated', { detail: { cart: this.cart.slice(), totalCount, totalSum, changedIds } });
      window.dispatchEvent(ev);
    } catch (e) { this._logError('emitUpdateEvent failed', e); }
  }

  // --- product resolution helpers (handles sync or promise) ---
  _isThenable(v) { return v && typeof v.then === 'function'; }

  /**
   * Try to get product via productService.findById.
   * Returns either the product (sync) or a Promise that resolves to product or null.
   */
  _resolveProduct(id) {
    try {
      const svc = this.productService;
      if (!svc || typeof svc.findById !== 'function') return null;
      const out = svc.findById(id);
      return out;
    } catch (e) {
      return null;
    }
  }

  _mergeProductToItem(item, prod, qtyAdjust = true) {
    if (!item || !prod) return item;
    item.price = Number(prod.price ?? item.price ?? 0);
    item.stock = Number(prod.stock ?? item.stock ?? 0);
    item.fullname = prod.fullname ?? prod.title ?? prod.name ?? item.fullname;
    item.picture = prod.picture ?? prod.image ?? item.picture;
    item.specs = prod.specs ?? item.specs ?? {};
    if (qtyAdjust && Number.isFinite(item.stock) && item.stock >= 0 && item.qty > item.stock) {
      item.qty = Math.max(1, item.stock);
      this._noteChangedId(item.name);
    }
    return item;
  }

  // --- storage load ---
  async loadFromStorage() {
    let raw = [];
    try {
      raw = await (this.storage?.loadCartWithAvailability?.() ?? []);
    } catch (e) {
      this._logError('loadFromStorage: storage.loadCart failed', e);
      raw = [];
    }

    this.cart = (Array.isArray(raw) ? raw : []).map(entry => {
      if (!entry) return null;
      const name = this._normalizeId(entry.name ?? entry.id ?? entry.title ?? entry.fullname ?? entry.productId ?? entry.cartId ?? '');
      let qty = Number(entry.qty ?? entry.quantity ?? 1);
      if (!Number.isFinite(qty) || qty < 1) qty = 1;

      // if productService returns sync product, use its data
      let syncProd = null;
      try { syncProd = this.productService && typeof this.productService.findById === 'function' ? this.productService.findById(name) : null; } catch (e) { syncProd = null; }
      if (this._isThenable(syncProd)) syncProd = null;

      if (syncProd) {
        const stock = Number(syncProd.stock || 0);
        if (stock > 0) qty = Math.min(qty, stock);
        return this._normalizeCartItemFromProduct(syncProd, qty);
      }

      return {
        name,
        fullname: entry.fullname || entry.title || entry.name || entry.productName || 'Товар',
        price: Number(entry.price ?? 0),
        qty,
        picture: entry.picture || entry.image || '/assets/no-image.png',
        stock: Number(entry.stock ?? 0),
        specs: entry.specs || {}
      };
    }).filter(Boolean);

    this._dedupeCart();
    this._rebuildIndex();
    for (const i of this.cart) this._noteChangedId(i.name);
    return this.updateCartUI();
  }

  _normalizeCartItemFromProduct(prod, qty = 1) {
    return {
      name: this._normalizeId(prod.name ?? prod.id ?? prod.title ?? prod.fullname ?? prod.productId ?? ''),
      fullname: prod.fullname ?? prod.title ?? prod.name ?? prod.productName ?? '',
      price: Number(prod.price || 0),
      qty: Number(qty || 1),
      picture: prod.picture || prod.image || '',
      stock: Number(prod.stock || 0),
      specs: prod.specs || {}
    };
  }

  setDomRefs({ headerCartNum, miniCartList, miniCartHeaderTitle, cartGrid, cartCountInline, cartTotal, miniCartTotal } = {}) {
    this.headerCartNum = headerCartNum || this.headerCartNum;
    this.cartGrid = cartGrid || this.cartGrid;
    this.cartCountInline = cartCountInline || this.cartCountInline;
    this.cartTotal = cartTotal || this.cartTotal;
    this.miniCartTotal = miniCartTotal || this.miniCartTotal;

    if (miniCartList || miniCartHeaderTitle) {
      this.miniCart.setDomRefs({ listEl: miniCartList, headerTitleEl: miniCartHeaderTitle });
    }

    if (cartGrid) this._attachGridListeners();
  }

  // --- public mutations: add / remove / changeQty ---
  add(productId, qty = 1) {
    try {
      const id = this._normalizeId(productId);
      if (!id) { this._logError('add: empty productId', productId); return false; }

      const prod = this._resolveProduct(id);
      if (this._isThenable(prod)) {
        // optimistic add placeholder — will be reconciled in updateCartUI
        return this._addRawEntry(id, qty, null);
      }
      return this._addRawEntry(id, qty, prod ?? null);
    } catch (e) {
      this._logError('add failed', e);
      return false;
    }
  }

  _addRawEntry(id, qty, prod) {
    qty = Math.max(1, parseInt(qty || 1, 10));
    const key = this._normalizeId(id);
    if (!key) return false;

    if (prod) {
      const stock = Number(prod.stock || 0);
      if (stock <= 0) {
        this.notifications?.show?.(this._msg('NOT_ENOUGH_STOCK'), { type: 'warning' });
        return false;
      }
      if (qty > stock) {
        this.notifications?.show?.(this._msg('ONLY_X_LEFT', { stock }), { type: 'warning' });
        qty = stock;
      }
    }

    const idx = this._findCartIndexById(key);
    if (idx >= 0) {
      const existing = this.cart[idx];
      const proposed = existing.qty + qty;
      const maxAllowed = prod ? Number(prod.stock || existing.stock || 0) : Number(existing.stock || 0);
      if (maxAllowed > 0 && proposed > maxAllowed) {
        this.notifications?.show?.(this._msg('INSUFFICIENT_STOCK_ADD', { max: maxAllowed }), { type: 'warning' });
        return false;
      }
      existing.qty = proposed;
      this._noteChangedId(key);
    } else {
      if (prod) {
        const item = this._normalizeCartItemFromProduct(prod, qty);
        this.cart.push(item);
        this._updateIndexOnInsert(item.name, this.cart.length - 1);
        this._noteChangedId(item.name);
      } else {
        const item = {
          name: key,
          fullname: key,
          price: 0,
          qty,
          picture: '/assets/no-image.png',
          stock: 0,
          specs: {}
        };
        this.cart.push(item);
        this._updateIndexOnInsert(item.name, this.cart.length - 1);
        this._noteChangedId(item.name);
      }
    }

    // Update UI & notify
    const p = this.updateCartUI();
    try {
      const title = (prod && (prod.fullname || prod.title)) ? (prod.fullname || prod.title) : key;
      try {
        this.notifications?.show?.(this._msg('ADDED_TO_CART_HTML', { title, qty }), { type: 'success', allowHtml: true });
      } catch (_) {
        this.notifications?.show?.(this._msg('ADDED_TO_CART_PLAIN', { title, qty }), { type: 'success' });
      }
    } catch (e) { this._logError('notifications.show failed on add', e); }
    return p;
  }

  remove(productId) {
    const key = this._normalizeId(productId);
    const idx = this._findCartIndexById(key);
    if (idx >= 0) {
      this._noteChangedId(key);
      this.cart.splice(idx, 1);
      this._updateIndexOnRemove(idx);
      return this.updateCartUI();
    }
    return false;
  }

  changeQty(productId, newQty, opts = {}) {
    try {
      const key = this._normalizeId(productId);
      const idx = this._findCartIndexById(key);
      if (idx < 0) return false;
      let qty = parseInt(newQty || 1, 10);
      if (isNaN(qty) || qty < 1) qty = 1;

      const item = this.cart[idx];
      const prod = this._resolveProduct(key);

      if (this._isThenable(prod)) {
        item.qty = qty; // optimistic
      } else if (prod) {
        const stock = Number(prod.stock || item.stock || 0);
        if (stock > 0 && qty > stock) {
          this.notifications?.show?.(this._msg('INSUFFICIENT_STOCK_CHANGEQTY', { stock }), { type: 'warning' });
          qty = stock;
        }
        item.qty = qty;
      } else {
        item.qty = qty;
      }

      // store sourceRow if provided
      try {
        if (opts && opts.sourceRow instanceof Element) {
          this._changeSourceMap.set(this._normalizeIdKey(key), opts.sourceRow);
        }
      } catch (_) {}

      this._noteChangedId(key);
      return this.updateCartUI(productId);
    } catch (e) {
      this._logError('changeQty failed', e);
      return false;
    }
  }

  getCart() { return this.cart.map(i => Object.assign({}, i)); }

  _dedupeCart() {
    if (!Array.isArray(this.cart) || this.cart.length < 2) return;
    const map = new Map();
    for (const item of this.cart) {
      const key = this._normalizeIdKey(item && item.name);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, Object.assign({}, item));
      } else {
        const existing = map.get(key);
        existing.qty = Number(existing.qty || 0) + Number(item.qty || 0);
        if (item.price || item.price === 0) existing.price = Number(item.price);
        if (item.picture) existing.picture = item.picture;
        if (item.fullname) existing.fullname = item.fullname;
        if (Number.isFinite(Number(item.stock))) existing.stock = Number(item.stock);
        existing.specs = Object.assign({}, existing.specs || {}, item.specs || {});
      }
    }
    const merged = Array.from(map.values()).map(it => {
      if (Number.isFinite(it.stock) && it.stock >= 0 && Number(it.qty) > it.stock) {
        it.qty = Math.max(1, it.stock);
      } else {
        it.qty = Math.max(1, Number(it.qty || 1));
      }
      return it;
    });
    this.cart = merged;
    this._rebuildIndex();
  }

  // --- rendering helpers ---
  async _renderItemsToTemp(items) {
    const tmp = document.createElement('div');
    if (typeof this.renderer.renderCards === 'function') {
      await this.renderer.renderCards(tmp, items, this.renderer.foxEngine);
    } else if (typeof this.renderer._renderCartHorizontal === 'function') {
      await this.renderer._renderCartHorizontal(tmp, items);
    } else {
      throw new Error('renderer API missing render function');
    }
    return tmp;
  }

  _findRowFromElement(el) {
    if (!el) return null;
    let node = el;
    while (node && node !== document.documentElement) {
      if (node.classList && node.classList.contains('cart-item')) return node;
      node = node.parentElement;
    }
    return null;
  }

  _getIdFromRow(row) {
    if (!row) return '';
    try {
      let id = row.getAttribute && (row.getAttribute('data-id') || row.getAttribute('data-cart-item'));
      if (id) return this._normalizeIdKey(id);

      const qc = row.querySelector && row.querySelector('.qty-controls[data-id]');
      if (qc) return this._normalizeIdKey(qc.getAttribute('data-id'));

      const rb = row.querySelector && row.querySelector('.remove-btn[data-id]');
      if (rb) return this._normalizeIdKey(rb.getAttribute('data-id'));

      const a = row.querySelector && row.querySelector('a[href*="#product/"]');
      if (a && a.getAttribute('href')) {
        const href = a.getAttribute('href');
        const m = href.match(/#product\/([^\/\?#]+)/);
        if (m) return this._normalizeIdKey(m[1]);
      }

      const anyData = row.querySelector && row.querySelector('[data-id],[data-product-id],[data-cart-id]');
      if (anyData) {
        return this._normalizeIdKey(anyData.getAttribute('data-id') || anyData.getAttribute('data-product-id') || anyData.getAttribute('data-cart-id'));
      }
    } catch (e) { this._logError('_getIdFromRow failed', e); }
    return '';
  }

  _showLimitMsg(row, text = null) {
    if (!row) return;
    try {
      const controls = row.querySelector && (row.querySelector('.cart-item__aside') || row);
      if (!controls) return;
      const msgText = (typeof text === 'string' && text.length) ? text : this._msg('PRODUCT_LIMIT_DEFAULT');
      let m = row.querySelector('.product-limit-msg');
      if (!m) {
        m = document.createElement('div');
        m.className = 'product-limit-msg';
        m.textContent = msgText;
        controls.appendChild(m);
        requestAnimationFrame(() => { m.style.opacity = '1'; });
      } else {
        m.textContent = msgText;
        m.style.opacity = '1';
      }
    } catch (e) { this._logError('_showLimitMsg failed', e); }
  }

  _hideLimitMsg(row) {
    if (!row) return;
    try {
      const m = row.querySelector && row.querySelector('.product-limit-msg');
      if (!m) return;
      m.style.opacity = '0';
      setTimeout(() => {
        const el = row.querySelector && row.querySelector('.product-limit-msg');
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, 320);
    } catch (e) { this._logError('_hideLimitMsg failed', e); }
  }

  _updateFavButtonState(row, id) {
    if (!row || !id || !this.favorites) return;
    try {
      const favBtn = row.querySelector && row.querySelector('.fav-btn');
      if (!favBtn) return;
      let isFav = false;
      try {
        if (typeof this.favorites.isFavorite === 'function') isFav = !!this.favorites.isFavorite(id);
        else if (Array.isArray(this.favorites.getAll && this.favorites.getAll())) isFav = (this.favorites.getAll().indexOf(id) >= 0);
      } catch (e) { isFav = false; }
      favBtn.classList.toggle('is-fav', isFav);
      favBtn.setAttribute('aria-pressed', String(isFav));
      const icon = favBtn.querySelector && favBtn.querySelector('i');
      if (icon) icon.classList.toggle('active', isFav);
    } catch (e) { this._logError('_updateFavButtonState failed', e); }
  }

  _syncRowControls(row, item) {
    if (!row) return;
    if (this._rowsSyncing.has(row)) return;
    try {
      this._rowsSyncing.add(row);

      const qtyInput = row.querySelector && row.querySelector('.qty-input');
      const btnPlus = row.querySelector && (row.querySelector('.qty-btn.qty-incr') || row.querySelector('[data-action="qty-incr"]') || row.querySelector('[data-role="qty-plus"]'));
      const btnMinus = row.querySelector && (row.querySelector('.qty-btn.qty-decr') || row.querySelector('[data-action="qty-decr"]') || row.querySelector('[data-role="qty-minus"]'));

      // pick stock value
      let stock = Number.isFinite(Number(item?.stock)) ? Number(item.stock) : NaN;
      if (!Number.isFinite(stock)) {
        const ds = row.getAttribute && row.getAttribute('data-stock');
        stock = ds !== null ? Number(ds) : NaN;
      }
      if (!Number.isFinite(stock)) {
        const modelItem = item?.name ? this._getCartItemById(item.name) : null;
        stock = modelItem ? Number(modelItem.stock || 0) : 0;
      }

      let qty = Number.isFinite(Number(item?.qty)) ? Number(item.qty) : NaN;
      if (!Number.isFinite(qty)) {
        if (qtyInput) {
          const v = parseInt(qtyInput.value || '0', 10);
          qty = Number.isFinite(v) ? v : NaN;
        }
        if (!Number.isFinite(qty)) {
          const modelItem = item?.name ? this._getCartItemById(item.name) : null;
          qty = modelItem ? Number(modelItem.qty || 0) : 0;
        }
      }

      if (!Number.isFinite(stock)) stock = 0;
      if (!Number.isFinite(qty)) qty = 0;

      let stockWarning = row.querySelector && row.querySelector('.stock-warning');
      if (!stockWarning) {
        stockWarning = document.createElement('div');
        stockWarning.className = 'stock-warning';
        stockWarning.style.cssText = 'color:#c62828;font-size:13px;margin-top:6px;display:none;';
        const right = row.querySelector('.cart-item__aside') || row;
        right.appendChild(stockWarning);
      }

      // qty input
      if (qtyInput) {
        qtyInput.setAttribute('min', '1');
        qtyInput.setAttribute('max', String(stock));
        if (stock <= 0) {
          qtyInput.value = '0';
          qtyInput.disabled = true;
          qtyInput.setAttribute('aria-disabled', 'true');
        } else {
          if (qty > stock) qty = stock;
          qtyInput.value = String(Math.max(1, qty));
          qtyInput.disabled = false;
          qtyInput.removeAttribute('aria-disabled');
        }
      }

      // minus
      if (btnMinus) {
        const disabled = (stock <= 0) || (qty <= 1);
        btnMinus.disabled = disabled;
        btnMinus.toggleAttribute && btnMinus.toggleAttribute('aria-disabled', disabled);
        btnMinus.classList.toggle('disabled', disabled);
      }

      // plus and limit message
      if (btnPlus) {
        const disabled = (stock <= 0) || (qty >= stock);
        btnPlus.disabled = disabled;
        btnPlus.toggleAttribute && btnPlus.toggleAttribute('aria-disabled', disabled);
        btnPlus.classList.toggle('disabled', disabled);

        if (stock > 0 && qty >= stock) this._showLimitMsg(row, this._msg('PRODUCT_LIMIT_REACHED'));
        else this._hideLimitMsg(row);
      } else {
        this._hideLimitMsg(row);
      }

      // out-of-stock visuals
      if (stock <= 0) {
        stockWarning.textContent = this._msg('NO_STOCK_TEXT');
        stockWarning.style.display = '';
        stockWarning.setAttribute('aria-hidden', 'false');
        row.classList.add('out-of-stock');
        if (btnPlus) { btnPlus.disabled = true; btnPlus.setAttribute && btnPlus.setAttribute('aria-disabled', 'true'); btnPlus.classList.add('disabled'); }
        if (btnMinus) { btnMinus.disabled = true; btnMinus.setAttribute && btnMinus.setAttribute('aria-disabled', 'true'); btnMinus.classList.add('disabled'); }
        if (qtyInput) { qtyInput.value = '0'; qtyInput.disabled = true; qtyInput.setAttribute && qtyInput.setAttribute('aria-disabled', 'true'); }
        this._hideLimitMsg(row);
      } else {
        stockWarning.style.display = 'none';
        stockWarning.setAttribute('aria-hidden', 'true');
        row.classList.remove('out-of-stock');
      }

      // non-blocking single-product refresh (if productService async)
      try {
        const id = this._getIdFromRow(row);
        if (id && this.productService && typeof this.productService.findById === 'function') {
          const prod = this._resolveProduct(id);
          if (this._isThenable(prod)) {
            prod.then(resolved => {
              if (!resolved) return;
              const existing = this._getCartItemById(id);
              if (existing) {
                this._mergeProductToItem(existing, resolved, true);
                const mainRow = this._findRowFromElement(row) || row;
                this._syncRowControls(mainRow, existing);
              }
            }).catch(err => this._logError('single product refresh failed', err));
          } else if (prod) {
            const existing = this._getCartItemById(id);
            if (existing) {
              this._mergeProductToItem(existing, prod, true);
              const mainRow = this._findRowFromElement(row) || row;
              this._syncRowControls(mainRow, existing);
            }
          }
        }
      } catch (e) { this._logError('_syncRowControls product refresh failed', e); }

    } catch (e) {
      this._logError('_syncRowControls failed', e);
    } finally {
      try { this._rowsSyncing.delete(row); } catch (_) {}
    }
  }

  async updateCartUI(targetId = null) {
    const overrideIdKey = targetId ? this._normalizeIdKey(targetId) : null;
    const changedIdsSnapshot = overrideIdKey ? [String(overrideIdKey)] : Array.from(this._pendingChangedIds);

    // dedupe & index
    this._dedupeCart();
    this._rebuildIndex();

    // 1) refresh product info (single or all)
    try {
      if (this.productService && typeof this.productService.findById === 'function') {
        if (overrideIdKey) {
          const id = overrideIdKey;
          const item = this._getCartItemById(id);
          if (item) {
            try {
              const prod = this._resolveProduct(id);
              if (this._isThenable(prod)) {
                const resolved = await prod.catch(() => null);
                if (resolved) this._mergeProductToItem(item, resolved, true);
              } else if (prod) this._mergeProductToItem(item, prod, true);
            } catch (e) { this._logError('single product fetch failed', e); }
          }
        } else {
          // bulk refresh
          const tasks = this.cart.map(item => {
            const id = this._normalizeId(item.name);
            try {
              const prod = this._resolveProduct(id);
              if (this._isThenable(prod)) {
                return prod.then(res => ({ id, res })).catch(err => ({ id, res: null, err }));
              } else {
                return Promise.resolve({ id, res: prod || null });
              }
            } catch (e) {
              return Promise.resolve({ id, res: null, err: e });
            }
          });

          if (this.opts.parallelProductFetch) {
            const settled = await Promise.allSettled(tasks);
            for (const r of settled) {
              if (r.status === 'fulfilled' && r.value?.res) {
                const id = r.value.id;
                const resolved = r.value.res;
                const idx = this._findCartIndexById(id);
                if (idx >= 0) {
                  this._mergeProductToItem(this.cart[idx], resolved, true);
                }
              } else if (r.status === 'rejected') {
                this._logError('product fetch failed', r.reason);
              }
            }
          } else {
            for (const t of tasks) {
              try {
                const r = await t;
                if (r?.res) {
                  const idx = this._findCartIndexById(r.id);
                  if (idx >= 0) this._mergeProductToItem(this.cart[idx], r.res, true);
                }
              } catch (e) { this._logError('sequential product refresh failed', e); }
            }
          }
        }
      }
    } catch (e) { this._logError('updateCartUI (product fetch) failed', e); }

    // 2) totals
    let totalCount = 0;
    let totalSum = 0;
    for (const it of this.cart) {
      totalCount += Number(it.qty || 0);
      totalSum += (Number(it.price || 0) * Number(it.qty || 0));
    }

    // 3) header & mini header
    try {
      if (this.headerCartNum) {
        this.headerCartNum.textContent = String(totalCount);
        this.headerCartNum.style.display = totalCount > 0 ? 'inline-flex' : 'none';
        this.headerCartNum.setAttribute('aria-hidden', totalCount > 0 ? 'false' : 'true');
      }
    } catch (e) { this._logError('headerCartNum update failed', e); }

    try { if (this.miniCart && typeof this.miniCart.updateHeader === 'function') this.miniCart.updateHeader(totalCount); } catch (e) { this._logError('miniCart.updateHeader failed', e); }

    // 4) mini cart render
    try {
      if (this.miniCart && typeof this.miniCart.render === 'function') {
        const maybe = this.miniCart.render(this.cart);
        if (this._isThenable(maybe)) await maybe.catch(err => this._logError('miniCart.render failed', err));
      }
    } catch (e) { this._logError('miniCart.render threw', e); }

    // 5) cart grid update (fast-path or partial)
    try {
      if (this.cartGrid && this.renderer) {
        if (overrideIdKey) {
          // fast-path update single id
          const id = String(overrideIdKey);
          this._pendingChangedIds.delete(id);
          const esc = this._cssEscape(String(id));
          let targetRow = null;
          try { targetRow = this.cartGrid.querySelector(`[data-id="${esc}"]`); } catch (_) { targetRow = null; }
          targetRow = this._findRowFromElement(targetRow) || targetRow;
          const item = this._getCartItemById(id);

          if (!item) {
            // remove DOM rows
            const rows = this._findAllRowsByIdInGrid(id);
            for (const r of rows) { try { if (r.parentNode) r.parentNode.removeChild(r); } catch (_) {} }
            if (this.cart.length === 0) { try { if (typeof this.renderer._renderCartHorizontal === 'function') await this.renderer._renderCartHorizontal(this.cartGrid, this.cart); } catch (er) { this._logError('render empty state failed', er); } }
            this._attachGridListeners();
          } else {
            // produce single row via renderer
            let producedRow = null;
            try {
              const tmp = await this._renderItemsToTemp([item]);
              producedRow = tmp.querySelector('.cart-item') || tmp.firstElementChild;
            } catch (err) {
              this._logError('renderer.render failed (fast-path)', err);
              producedRow = null;
            }

            if (producedRow && producedRow.cloneNode) {
              const clone = producedRow.cloneNode(true);
              clone.setAttribute && clone.setAttribute('data-id', String(id));
              if (targetRow && targetRow.parentNode) {
                try { targetRow.parentNode.replaceChild(clone, targetRow); } catch (e) { try { targetRow.parentNode.appendChild(clone); } catch (_) {} }
              } else {
                const rows = this._findAllRowsByIdInGrid(id);
                if (rows.length > 0) {
                  try { rows[0].parentNode.replaceChild(clone, rows[0]); } catch (e) { try { this.cartGrid.appendChild(clone); } catch (_) {} }
                  for (let i = 1; i < rows.length; i++) try { if (rows[i].parentNode) rows[i].parentNode.removeChild(rows[i]); } catch (_) {}
                } else {
                  try { this.cartGrid.appendChild(clone); } catch (_) {}
                }
              }
              const mainRow = this._findRowFromElement(clone) || clone;
              if (mainRow && item) this._syncRowControls(mainRow, item);
              if (mainRow) this._updateFavButtonState(mainRow, id);
              try {
                const src = this._changeSourceMap.get(id);
                if (src instanceof Element) {
                  const q = mainRow.querySelector && mainRow.querySelector('.qty-input');
                  if (q) q.focus();
                }
              } catch (_) {}
              try { this._changeSourceMap.delete(id); } catch (_) {}
              this._attachGridListeners();
            } else {
              // fallback full render
              if (typeof this.renderer._renderCartHorizontal === 'function') {
                try { await this.renderer._renderCartHorizontal(this.cartGrid, this.cart); } catch (er) { this._logError('fallback full render failed (fast-path)', er); }
                this._attachGridListeners();
              }
            }
          }
        } else {
          // partial update for pending ids or full render
          const changedIds = changedIdsSnapshot;
          if (!changedIds.length) {
            if (typeof this.renderer._renderCartHorizontal === 'function') {
              await this.renderer._renderCartHorizontal(this.cartGrid, this.cart);
              this._attachGridListeners();
            }
          } else {
            // prepare render tasks for each changed id
            const tasks = changedIds.map(async id => {
              const item = this._getCartItemById(id);
              if (!item) return { id, removed: true };
              try {
                const tmp = await this._renderItemsToTemp([item]);
                const produced = tmp.querySelector('.cart-item') || tmp.firstElementChild;
                return { id, produced, item };
              } catch (err) {
                return { id, error: err };
              }
            });

            const settled = await Promise.allSettled(tasks);
            let hadFailure = false;
            const apply = [];
            for (const r of settled) {
              if (r.status === 'fulfilled' && r.value) {
                if (r.value.error) { hadFailure = true; this._logError('partial render task error', r.value.error); }
                else apply.push(r.value);
              } else { hadFailure = true; this._logError('partial render promise rejected', r); }
            }

            // apply changes in next animation frame
            await new Promise(resolve => requestAnimationFrame(resolve));
            for (const c of apply) {
              try {
                if (c.removed) {
                  const rows = this._findAllRowsByIdInGrid(c.id);
                  for (const rr of rows) try { if (rr.parentNode) rr.parentNode.removeChild(rr); } catch (_) {}
                  continue;
                }
                if (!c.produced) { hadFailure = true; continue; }
                const produced = c.produced.cloneNode(true);
                if (produced.setAttribute) produced.setAttribute('data-id', String(c.id));
                this._applyProducedRowSafely(c.id, produced, c.existingRow);
                const mainRow = this._findRowFromElement(produced) || produced;
                if (c.item) this._syncRowControls(mainRow, c.item);
                this._updateFavButtonState(mainRow, c.id);
              } catch (e) { hadFailure = true; this._logError('applyChange failed', e); }
            }

            if (hadFailure) {
              try { await this.renderer._renderCartHorizontal(this.cartGrid, this.cart); } catch (e) { this._logError('fallback full render failed', e); }
            } else {
              if (this.cart.length === 0) {
                try { if (typeof this.renderer._renderCartHorizontal === 'function') await this.renderer._renderCartHorizontal(this.cartGrid, this.cart); } catch (e) { this._logError('render empty state failed', e); }
              }
            }
            this._attachGridListeners();
          }
        }
      }
    } catch (e) {
      this._logError('cart grid update failed, attempting full render', e);
      try { if (this.cartGrid && this.renderer && typeof this.renderer._renderCartHorizontal === 'function') { await this.renderer._renderCartHorizontal(this.cartGrid, this.cart); this._attachGridListeners(); } } catch (er) { this._logError('full render fallback failed', er); }
    }

    // 6) totals & inline counters
    try {
      if (this.cartTotal) this.cartTotal.textContent = this._formatPrice(totalSum);
      if (this.miniCartTotal) this.miniCartTotal.textContent = this._formatPrice(totalSum);
      if (this.cartCountInline) this.cartCountInline.textContent = String(totalCount);
    } catch (e) { this._logError('totals update failed', e); }

    // 7) final per-row sync for changed ids
    try {
      if (this.cartGrid && changedIdsSnapshot.length) {
        for (const id of changedIdsSnapshot) {
          const esc = this._cssEscape(String(id));
          let row = null;
          try { row = this.cartGrid.querySelector(`[data-id="${esc}"]`); } catch (err) { row = null; }
          const mainRow = this._findRowFromElement(row) || row;
          const item = this._getCartItemById(id);
          if (mainRow && item) { this._syncRowControls(mainRow, item); this._updateFavButtonState(mainRow, id); }
          else if (mainRow) this._updateFavButtonState(mainRow, id);
        }
      }
    } catch (e) { this._logError('final sync failed', e); }

    this._scheduleSave();
    this._emitUpdateEvent();

    return { cart: this.getCart(), totalCount, totalSum };
  }
  
  /**
   * Проверяет доступность товара по его id.
   * Учитывает количество товара в корзине и его наличие на складе.
   * @param {string} id - Идентификатор товара
   * @returns {boolean} - Доступность товара (true если доступен, false если нет)
   */
  isAvailable(item) {
    const stock = Number(item.stock);
    const qtyInCart = this._getCartQtyById(item.name);
    return stock > 0 && qtyInCart < stock;
  }

  _findAllRowsByIdInGrid(id) {
    if (!this.cartGrid || !id) return [];
    const esc = this._cssEscape(String(id));
    const nodes = [];
    try {
      const q = this.cartGrid.querySelectorAll(`[data-id="${esc}"]`);
      if (q && q.length) {
        for (const n of q) nodes.push(this._findRowFromElement(n) || n);
      } else {
        const rows = this.cartGrid.querySelectorAll && this.cartGrid.querySelectorAll('.cart-item');
        if (rows) {
          for (const r of rows) {
            try { if (this._getIdFromRow(r) === this._normalizeIdKey(id)) nodes.push(r); } catch (_) {}
          }
        }
      }
    } catch (e) {
      const rows = this.cartGrid.querySelectorAll && this.cartGrid.querySelectorAll('.cart-item');
      if (rows) for (const r of rows) try { if (this._getIdFromRow(r) === this._normalizeIdKey(id)) nodes.push(r); } catch (_) {}
    }
    const uniq = [];
    for (const n of nodes) if (n && uniq.indexOf(n) < 0) uniq.push(n);
    return uniq;
  }

  _applyProducedRowSafely(id, produced, existingRow) {
    if (!this.cartGrid || !produced) return;
    const existingRows = this._findAllRowsByIdInGrid(id);
    try {
      if (existingRows.length > 0) {
        const first = existingRows[0];
        if (first && first.parentNode) {
          try { first.parentNode.replaceChild(produced, first); } catch (e) { this.cartGrid.appendChild(produced); }
        } else this.cartGrid.appendChild(produced);
        for (let i = 1; i < existingRows.length; i++) {
          const node = existingRows[i];
          try { if (node && node.parentNode) node.parentNode.removeChild(node); } catch (_) {}
        }
      } else if (existingRow && existingRow.parentNode) {
        try { existingRow.parentNode.replaceChild(produced, existingRow); } catch (e) { this.cartGrid.appendChild(produced); }
      } else {
        this.cartGrid.appendChild(produced);
      }
    } catch (e) {
      try { this.cartGrid.appendChild(produced); } catch (_) {}
    }
  }

  // --- grid listeners attach/detach ---
  _attachGridListeners() {
    if (!this.cartGrid) return;
    if (this._gridListenersAttachedTo && this._gridListenersAttachedTo !== this.cartGrid) this._detachGridListeners();
    if (this._gridHandler) return;

    this._gridHandler = (ev) => {
      const target = ev.target;
      const row = this._findRowFromElement(target);
      if (!row) return;
      const id = this._getIdFromRow(row);
      if (!id) return;

      // fav
      const fav = target.closest && target.closest('.fav-btn, [data-role="fav"]');
      if (fav) {
        ev.preventDefault();
        if (!this.favorites) { this.notifications?.show?.(this._msg('FAVORITES_UNAVAILABLE'), { type: 'error' }); return; }
        try {
          let res;
          if (typeof this.favorites.toggle === 'function') res = this.favorites.toggle(id);
          else if (typeof this.favorites.add === 'function' && typeof this.favorites.remove === 'function') {
            const now = (typeof this.favorites.isFavorite === 'function') ? !!this.favorites.isFavorite(id) : false;
            res = now ? this.favorites.remove(id) : this.favorites.add(id);
          }
          const favBtnEl = row.querySelector && row.querySelector('.fav-btn');
          const isFavNow = (typeof this.favorites.isFavorite === 'function') ? !!this.favorites.isFavorite(id) : false;
          if (favBtnEl) { favBtnEl.classList.toggle('is-fav', isFavNow); favBtnEl.setAttribute('aria-pressed', String(isFavNow)); }
          const wishEl = document.getElementById && document.getElementById('wishNum');
          try { if (wishEl && typeof this.favorites.getCount === 'function') wishEl.textContent = String(this.favorites.getCount()); } catch (_) {}

          if (res && this._isThenable(res)) {
            res.then(() => {
              const finalFav = (typeof this.favorites.isFavorite === 'function') ? !!this.favorites.isFavorite(id) : false;
              if (favBtnEl) favBtnEl.classList.toggle('is-fav', finalFav);
              if (wishEl && typeof this.favorites.getCount === 'function') wishEl.textContent = String(this.favorites.getCount());
            }).catch(err => this._logError('favorites operation failed', err));
          }
        } catch (e) { this._logError('fav handling failed', e); }
        return;
      }

      // plus
      const plus = target.closest && target.closest('.qty-btn.qty-incr, [data-action="qty-incr"], [data-role="qty-plus"]');
      if (plus) {
        ev.preventDefault();
        const item = this._getCartItemById(id);
        if (!item) return;
        const stock = Number(item.stock || 0);
        if (stock <= 0) { this.notifications?.show?.(this._msg('PRODUCT_OUT_OF_STOCK'), { type: 'warning' }); this._syncRowControls(row, item); return; }
        if (item.qty < stock) this.changeQty(id, item.qty + 1, { sourceRow: row });
        else this.notifications?.show?.(this._msg('REACHED_MAX_STOCK_LIMIT_NOTIFY'), { type: 'warning' });
        return;
      }

      // minus
      const minus = target.closest && target.closest('.qty-btn.qty-decr, [data-action="qty-decr"], [data-role="qty-minus"]');
      if (minus) {
        ev.preventDefault();
        const item = this._getCartItemById(id);
        if (!item) return;
        if (item.qty > 1) this.changeQty(id, item.qty - 1, { sourceRow: row });
        return;
      }

      // remove
      const rem = target.closest && target.closest('.remove-btn, [data-action="remove"], [data-role="remove"]');
      if (rem) {
        ev.preventDefault();
        this.remove(id);
        return;
      }
    };

    this._gridInputHandler = (ev) => {
      const input = ev.target;
      if (!input) return;
      if (!(input.matches && (input.matches('.qty-input') || input.matches('[data-role="qty-input"]') || input.matches('input[type="number"]')))) return;
      const row = this._findRowFromElement(input);
      if (!row) return;
      const id = this._getIdFromRow(row);
      if (!id) return;
      let v = parseInt(input.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      const max = parseInt(input.getAttribute('max') || '0', 10);
      if (Number.isFinite(max) && max > 0 && v > max) v = max;
      this.changeQty(id, v, { sourceRow: row });
    };

    try {
      this.cartGrid.addEventListener('click', this._gridHandler);
      this.cartGrid.addEventListener('change', this._gridInputHandler);
      this._gridListenersAttachedTo = this.cartGrid;
    } catch (e) { this._logError('_attachGridListeners failed', e); }
  }

  _detachGridListeners() {
    if (!this._gridListenersAttachedTo) return;
    try {
      this._gridListenersAttachedTo.removeEventListener('click', this._gridHandler);
      this._gridListenersAttachedTo.removeEventListener('change', this._gridInputHandler);
    } catch (e) { this._logError('_detachGridListeners error', e); }
    this._gridHandler = null;
    this._gridInputHandler = null;
    this._gridListenersAttachedTo = null;
  }

  // --- utilities for tests / reset / destroy ---
  clear() {
    for (const i of this.cart) this._noteChangedId(i.name);
    this.cart = [];
    this._rebuildIndex();
    return this.updateCartUI();
  }

  _setCartForTest(cartArray) {
    this.cart = Array.isArray(cartArray) ? cartArray.map(i => Object.assign({}, i)) : [];
    this._rebuildIndex();
    this.cart.forEach(i => this._noteChangedId(i.name));
    return this.updateCartUI();
  }

  destroy() {
    if (this._saveTimeout) { clearTimeout(this._saveTimeout); this._saveTimeout = null; try { if (this.storage?.saveCart) this.storage.saveCart(this.cart); } catch (e) { this._logError('final save failed on destroy', e); } }
    this._detachGridListeners();
    try { if (this.miniCart?.destroy) this.miniCart.destroy(); } catch (e) { this._logError('miniCart.destroy failed', e); }
  }
}