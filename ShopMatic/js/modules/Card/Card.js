import { CardDomHelper } from './card-dom-helper.js';
import { CardStockHelper } from './card-stock-helper.js';
import { CardCartHelper } from './card-cart-helper.js';
import { CardDelegationManager } from './card-delegation-manager.js';
import { VerticalCardRenderer } from "./Renderers/VerticalCardRenderer.js";
import { HorizontalCardRenderer } from "./Renderers/HorizontalCardRenderer.js";

/**
 * Card — Card factory + registry + reactive syncing via event bus + premium batching.
 * @author Calista Verner
 */
export class Card {
  static UI_MESSAGES = Object.freeze({
    PRODUCT_LIMIT_DEFAULT: 'У вас уже максимум в корзине',
    PRODUCT_LIMIT_REACHED: 'Вы достигли максимального количества этого товара',
    NO_STOCK_TEXT: 'Товара нет в наличии',
    CANNOT_ADD_NO_STOCK: 'Невозможно добавить: нет доступного остатка.',
    ADDED_PARTIAL: 'В корзину добавлено {added} шт. (доступно {available}).',
    FAVORITES_UNAVAILABLE: 'Модуль избранного недоступен.',
    PRODUCT_LEFT: 'Остаток: {left}'
  });

  constructor(shopMatic) {
    this.shopMatic = shopMatic;

    if (!this.shopMatic._delegationHandlers) {
      this.shopMatic._delegationHandlers = new Map();
    }

    this._limitMsgClass = 'product-limit-msg';

    this.verticalCardRenderer = new VerticalCardRenderer(shopMatic);
    this.horizontalCardRenderer = new HorizontalCardRenderer(shopMatic);

    this._dom = new CardDomHelper(this);
    this._stock = new CardStockHelper(this);
    this._cart = new CardCartHelper(this, this._dom, this._stock);
    this._delegation = new CardDelegationManager(this, this._dom, this._cart);

    /** @type {Map<string, ProductCard>} */
    this._registry = new Map();

    /**
     * DOM index for fast point-updates:
     * id -> Set<cardRootElement>
     * @type {Map<string, Set<Element>>}
     */
    this._domIndexById = new Map();

    /* ---------------- Premium batching ---------------- */

    /** @type {Set<string>} */
    this._pendingIds = new Set();
    this._microtaskScheduled = false;
    this._rafScheduled = false;

    /** @type {()=>void|null} */
    this._unsubBus = null;

    this._initBusSubscriptions();
  }

  /* ==================== Event Bus ==================== */

  _initBusSubscriptions() {
    const bus = this.shopMatic?.eventBus;
    if (!bus || typeof bus.on !== 'function') return;

    const u1 = bus.on('cart:changed', (p) => this._scheduleFromPayload(p));
    const u2 = bus.on('favorites:changed', (p) => this._scheduleFromPayload(p));
    const u3 = bus.on('cards:sync', (p) => this._scheduleFromPayload(p));

    this._unsubBus = () => {
      try { u1?.(); } catch {}
      try { u2?.(); } catch {}
      try { u3?.(); } catch {}
    };
  }

  _scheduleFromPayload(p) {
    const ids = normalizeIdsPayload(p);
    if (ids?.length) this._scheduleSyncIds(ids);
    else if (p?.id) this._scheduleSyncId(p.id);
  }

  destroy() {
    try { this._unsubBus?.(); } catch {}
    this._unsubBus = null;

    this._registry.clear();
    this._domIndexById.clear();

    this._pendingIds.clear();
    this._microtaskScheduled = false;
    this._rafScheduled = false;
  }

  /* ==================== Premium batching (microtask -> rAF) ==================== */

  _scheduleSyncId(id) {
    const clean = String(id ?? '').trim();
    if (!clean) return;
    this._pendingIds.add(clean);
    this._scheduleMicrotask();
  }

  _scheduleSyncIds(ids) {
    const arr = Array.isArray(ids) ? ids : [];
    for (const x of arr) {
      const clean = String(x ?? '').trim();
      if (clean) this._pendingIds.add(clean);
    }
    if (this._pendingIds.size) this._scheduleMicrotask();
  }

  _scheduleMicrotask() {
    if (this._microtaskScheduled) return;
    this._microtaskScheduled = true;

    const run = () => {
      this._microtaskScheduled = false;
      this._scheduleRafFlush();
    };

    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  _scheduleRafFlush() {
    if (this._rafScheduled) return;
    this._rafScheduled = true;

    const run = () => {
      this._rafScheduled = false;
      this._flushSyncPremium();
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
  }

  /**
   * Premium flush:
   *  - prune DOM sets once
   *  - single DOM query for missing ids (selector list)
   *  - computeState once per id
   *  - apply to all DOM roots for that id
   *  - update ProductCard objects without double-work
   */
  _flushSyncPremium() {
    if (!this._pendingIds.size) return;

    const ids = Array.from(this._pendingIds);
    this._pendingIds.clear();

    // 1) prune sets + find ids missing from index
    const missing = [];
    for (const id of ids) {
      const set = this._pruneDomSet(id);
      if (!set || set.size === 0) missing.push(id);
    }

    // 2) one targeted querySelectorAll for missing ids (no full scan)
    if (missing.length) {
      try {
        const selector = missing
          .map((id) => `[data-product-id="${cssEscape(id)}"]`)
          .join(',');

        if (selector) {
          const nodes = document.querySelectorAll?.(selector);
          if (nodes?.length) {
            for (const el of nodes) {
              const pid = String(el.getAttribute?.('data-product-id') || '').trim();
              if (!pid) continue;
              this._indexDom(pid, el);
            }
          }
        }
      } catch {}
    }

    // 3) compute state once per id and apply
    for (const id of ids) {
      const set = this._pruneDomSet(id);
      if (!set || set.size === 0) continue;

      let st = null;
      try { st = this.computeState(id); } catch { st = null; }
      if (!st) continue;

      // Apply to all DOM roots
      for (const el of Array.from(set)) {
        try { applyStateToDom(this, el, st); } catch {}
      }

      // Update OOP instance without re-applying/computeState again
      const obj = this._registry.get(id);
      if (obj) {
        try { obj.applyState(st); } catch {}
      }
    }
  }

  /* ==================== Card creation API ==================== */

  _msg(key, vars = {}) {
    const pool = this.constructor?.UI_MESSAGES || {};
    const tpl = pool[key] ?? '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }

  async renderCardList(cartArr, rootEl, type) {
    if (type === "VERTICAL") return this.verticalCardRenderer.renderListVertical(cartArr, rootEl);
    if (type === "HORIZONTAL") return this.horizontalCardRenderer.renderCartHorizontal(rootEl, cartArr);
  }

  async renderSingleCard(item, type) {
    if (type === "VERTICAL") return this.verticalCardRenderer.createCard(item);
    if (type === "HORIZONTAL") return this.horizontalCardRenderer.createCard(item);
  }

  /**
   * Creates (or returns existing) OOP card object and mounts it onto a DOM node.
   * This is the ONLY place where card bindings should happen.
   *
   * @param {Element} el
   * @param {Object} product
   * @param {'VERTICAL'|'HORIZONTAL'} [type='VERTICAL']
   * @returns {ProductCard|null}
   */
  mount(el, product, type = 'VERTICAL') {
    if (!el) return null;

    const id = String(
      product?.name ??
      product?.id ??
      product?.productId ??
      el.getAttribute?.('data-product-id') ??
      el.getAttribute?.('data-id') ??
      ''
    ).trim();

    if (!id) return null;

    // Ensure marker
    try { el.setAttribute('data-product-id', id); } catch {}

    // Index DOM node for point-sync
    this._indexDom(id, el);

    let obj = this._registry.get(id);
    if (!obj) {
      obj = new ProductCard(this, { id, type });
      this._registry.set(id, obj);
    }

    obj.mount(el, product);
    return obj;
  }

  _indexDom(id, el) {
    const clean = String(id ?? '').trim();
    if (!clean || !el) return;

    let set = this._domIndexById.get(clean);
    if (!set) {
      set = new Set();
      this._domIndexById.set(clean, set);
    }
    set.add(el);
  }

  _pruneDomSet(id) {
    const clean = String(id ?? '').trim();
    const set = this._domIndexById.get(clean);
    if (!set) return set;

    for (const el of Array.from(set)) {
      if (!el || !el.isConnected) set.delete(el);
    }
    if (set.size === 0) this._domIndexById.delete(clean);
    return set;
  }

  /* ==================== State ==================== */

  /**
   * Computes full card state from current services.
   * @param {string} id
   */
  computeState(id) {
    const cleanId = String(id ?? '').trim();
    const inCartQty = this._stock.findCartQtyById(cleanId);
    const available = this._stock.computeAvailableStock(cleanId);
    const totalStock = Math.max(0, Number(available) + Number(inCartQty));
    const isFav = !!this.shopMatic?.isFavorite?.(cleanId);
    const inCart = Number(inCartQty) > 0;

    return {
      id: cleanId,
      isFav,
      inCart,
      cartQty: Math.max(0, Number(inCartQty) || 0),
      available: Math.max(0, Number(available) || 0),
      totalStock,
    };
  }

  /**
   * Immediate point sync by id (no batching).
   * If you want batching — emit events or call _scheduleSyncId/_scheduleSyncIds.
   * @param {string} id
   */
  syncById(id) {
    const clean = String(id ?? '').trim();
    if (!clean) return;

    const set = this._pruneDomSet(clean);
    if (!set || set.size === 0) {
      // targeted fallback query
      try {
        const nodes = document.querySelectorAll?.(`[data-product-id="${cssEscape(clean)}"]`);
        if (!nodes?.length) return;
        for (const el of nodes) this._indexDom(clean, el);
      } catch {}
    }

    const readySet = this._pruneDomSet(clean);
    if (!readySet || readySet.size === 0) return;

    const st = this.computeState(clean);
    for (const el of Array.from(readySet)) applyStateToDom(this, el, st);

    const obj = this._registry.get(clean);
    if (obj) obj.applyState(st);
  }

  /**
   * Backward compatible full sync (still available).
   */
  syncMountedIn(container = this.shopMatic?.root) {
    if (!container?.querySelectorAll) return;

    const nodes = container.querySelectorAll('[data-product-id]');
    for (const el of nodes) {
      const id = String(el.getAttribute('data-product-id') || '').trim();
      if (!id) continue;
      this._indexDom(id, el);

      const st = this.computeState(id);
      applyStateToDom(this, el, st);

      const obj = this._registry.get(id);
      if (obj) obj.applyState(st);
    }
  }

  /* ==================== Internal helpers used by other modules ==================== */

  _sel(root, selector) { return this._dom.sel(root, selector); }
  _toggleDisabled(el, disabled) { this._dom.toggleDisabled(el, disabled); }
  _createLimitMsg(text) { return this._dom.createLimitMsg(text); }

  _clampQty(rawVal, min = 1, max = Infinity) {
    let v = parseInt(rawVal ?? '', 10);
    if (isNaN(v) || v < min) v = min;
    if (v > max) v = max;
    return v;
  }

  _getIdFromElement(el) {
    if (!el?.getAttribute) return null;
    const attrs = ['data-product-id', 'data-id', 'data-name', 'data-cart-id', 'data-item-id'];
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (v) return v;
    }
    return (el?.dataset?.productId || el?.dataset?.id || el?.dataset?.name || null);
  }

  _getCardSelectors(card) { return this._dom.getCardSelectors(card); }
  _computeAvailableStock(id) { return this._stock.computeAvailableStock(id); }
  _findCartQtyById(id) { return this._stock.findCartQtyById(id); }

  _removeFromCart(id, cardOrRow) { this._cart.removeFromCart(id, cardOrRow); }
  _syncCardControlsState(card) { this._cart.syncCardControlsState(card); }
  _handleBuyAction(params) { this._cart.handleBuyAction(params); }
  _handleBuyNowClick(e, ctx) { this._cart.handleBuyNowClick(e, ctx); }
  _applyQtyChange(id, row, newVal) { this._cart.applyQtyChange(id, row, newVal); }

  destroyDelegation(container = null) {
    this._delegation.destroyDelegation(container);
  }

  _applyFavState(card, isFav) {
    if (!card) return;

    const fav = !!isFav;
    const favBtn =
      card.querySelector('.fav-btn,[data-fav-btn],[data-role="fav"]') ||
      card.querySelector('[aria-pressed][data-action="fav"]');

    if (favBtn) {
      favBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
      favBtn.title = fav ? 'В избранном' : 'Добавить в избранное';
      favBtn.classList.toggle('is-fav', fav);
      favBtn.classList.toggle('is-favorite', fav);
      favBtn.dataset.fav = fav ? '1' : '0';

      const icon = favBtn.querySelector('i');
      if (icon) {
        icon.classList.remove('fa-regular', 'fa-solid');
        icon.classList.add(fav ? 'fa-solid' : 'fa-regular');
        if (!icon.classList.contains('fa-heart')) icon.classList.add('fa-heart');
      }
    }

    card.dataset.isFav = fav ? '1' : '0';
    card.classList.toggle('is-favorite', fav);
  }

  updateProductCardFavState(cardEl, isFav) {
    if (!cardEl) return;
    this._applyFavState(cardEl, isFav);
  }
}

/**
 * ProductCard — OOP instance of a product card.
 */
class ProductCard {
  constructor(cardFactory, cfg) {
    this.cardFactory = cardFactory;
    this.shopMatic = cardFactory.shopMatic;

    this.id = String(cfg?.id ?? '').trim();
    this.type = cfg?.type === 'HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL';

    /** @type {Element|null} */
    this.el = null;
    /** @type {Object|null} */
    this.product = null;
    /** @type {any} */
    this.state = null;
  }

  mount(el, product) {
    this.el = el;
    this.product = product || this.product;

    try {
      if (this.id && this.el?.setAttribute) this.el.setAttribute('data-product-id', this.id);
    } catch {}

    // Bind actions ONLY for this card root
    try {
      this.cardFactory._delegation.bindCard(this.el);
    } catch {}

    // initial state apply (not batched, because creation should show correct UI immediately)
    const st = this.cardFactory.computeState(this.id);
    this.applyState(st);
  }

  /**
   * Apply already computed state (no computeState inside).
   * @param {Object} st
   */
  applyState(st) {
    if (!this.el || !st) return;
    this.state = st;
    applyStateToDom(this.cardFactory, this.el, st);
  }
}

/**
 * Apply state to DOM for a card root.
 */
function applyStateToDom(cardFactory, el, state) {
  if (!el || !state) return;

  try {
    el.dataset.inCart = state.inCart ? '1' : '0';
    el.dataset.cartQty = String(state.cartQty ?? 0);
    el.dataset.stockTotal = String(state.totalStock ?? 0);
    el.dataset.stockAvailable = String(state.available ?? 0);
  } catch {}

  try { cardFactory._applyFavState(el, state.isFav); } catch {}
  try { cardFactory._cart.syncCardControlsState(el); } catch {}
}

function normalizeIdsPayload(p) {
  if (!p) return null;
  const ids = p.ids || p.items || p.changedIds;
  if (!ids) return null;
  if (Array.isArray(ids)) return ids.map((x) => String(x).trim()).filter(Boolean);
  return null;
}

function cssEscape(s) {
  // minimal escape for selector attribute value
  return String(s).replace(/["\\]/g, '\\$&');
}
