/**
 * Card UI helper for ShopMatic — refactored
 * Author: Calista Verner
 * Refactor: Calista + assistant
 * Version: 1.3.1-refactor
 *
 * Сохранена исходная логика и публичные точки интеграции.
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

  constructor(shopMatic = {}) {
    this.shopMatic = shopMatic;
    // WeakMap: container -> { clickHandler, inputHandler }
    this._delegationHandlers = new WeakMap();
    // Backwards-compat: some code expects shopMatic._delegationHandlers as Map
    if (!this.shopMatic._delegationHandlers) this.shopMatic._delegationHandlers = new Map();

    this._limitMsgClass = 'product-limit-msg';
  }

  _msg(key, vars = {}) {
    const pool = (this.constructor && this.constructor.UI_MESSAGES) || {};
    const tpl = pool[key] ?? '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }

  _sel(root, selector) {
    return root?.querySelector?.(selector) ?? null;
  }

  _toggleDisabled(el, disabled) {
    if (!el) return;
    el.disabled = !!disabled;
    if (el.toggleAttribute) el.toggleAttribute('aria-disabled', !!disabled);
  }

  _createLimitMsg(text) {
    const d = document.createElement('div');
    d.className = this._limitMsgClass;
    d.textContent = text;
    // leave styling to CSS; small inline fallback
    d.style.cssText = 'transition:opacity .25s ease;opacity:0;';
    return d;
  }

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
    return el?.dataset?.productId || el?.dataset?.id || el?.dataset?.name || null;
  }

  _getCardSelectors(card) {
    return {
      leftNum: this._sel(card, '.leftNum'),
      stock: this._sel(card, '.stock'),
      buyBtn: this._sel(card, '[data-role="buy"], [data-action="buy"], .btn-buy'),
      incrBtn: this._sel(card, '[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]'),
      decrBtn: this._sel(card, '[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]'),
      qtyInput: this._sel(card, '[data-role="qty-input"], .qty-input, input[type="number"]'),
      controlsWrapper: this._sel(card, '.card-controls') || card
    };
  }

  _computeAvailableStock(id) {
    if (!id) return 0;
    try {
      const prod = this.shopMatic?.productService?.findById?.(id);
      if (prod && typeof prod.then === 'function') return 0;
      const totalStock = Number(prod?.stock || 0);
      const inCartQty = this._findCartQtyById(id);
      return Math.max(0, totalStock - inCartQty);
    } catch (e) {
      return 0;
    }
  }

  _findCartQtyById(id) {
    try {
      const cartModule = this.shopMatic?.cart;
      const cartArray = Array.isArray(cartModule?.cart) ? cartModule.cart : (Array.isArray(cartModule) ? cartModule : []);
      if (!Array.isArray(cartArray)) return 0;
      const keys = ['id', 'productId', 'name', 'cartId', 'itemId'];
      for (const it of cartArray) {
        if (!it) continue;
        for (const k of keys) {
          if (it[k] != null && String(it[k]) === String(id)) return Number(it.qty ?? it.quantity ?? 0) || 0;
        }
        if (String(it) === String(id)) return Number(it.qty ?? 0) || 0;
      }
    } catch (e) { /* ignore */ }
    return 0;
  }

  _syncCardControlsState(card) {
    if (!card) return;
    const id = this._getIdFromElement(card);
    if (!id) return;

    const s = this._getCardSelectors(card);
    const available = this._computeAvailableStock(id);
    const hasAvailable = available > 0;

    requestAnimationFrame(() => {
      if (s.leftNum) s.leftNum.textContent = String(available);
      if (s.stock) {
        s.stock.textContent = String(this._msg('PRODUCT_LEFT', { left: available }));
        if (hasAvailable) s.stock.removeAttribute?.('hidden'); else s.stock.setAttribute?.('hidden', 'true');
      }

      this._toggleDisabled(s.buyBtn, !hasAvailable);

      if (s.qtyInput) {
        if (!hasAvailable) {
          s.qtyInput.value = '0';
          s.qtyInput.disabled = true;
          s.qtyInput.setAttribute('aria-disabled', 'true');
        } else {
          s.qtyInput.disabled = false;
          s.qtyInput.removeAttribute?.('aria-disabled');
          const val = this._clampQty(s.qtyInput.value || '1', 1, available);
          s.qtyInput.value = String(val);
        }
      }

      const curVal = s.qtyInput ? Math.max(0, parseInt(s.qtyInput.value || '0', 10)) : 0;
      this._toggleDisabled(s.incrBtn, !hasAvailable || curVal >= available);
      this._toggleDisabled(s.decrBtn, curVal <= 1);

      const existing = card.querySelector?.(`.${this._limitMsgClass}`);
      if (!hasAvailable) {
        if (!existing) {
          const msg = this._createLimitMsg(this._msg('PRODUCT_LIMIT_DEFAULT'));
          (s.controlsWrapper || card).appendChild(msg);
          requestAnimationFrame(() => (msg.style.opacity = '1'));
        }
      } else if (existing) {
        existing.style.opacity = '0';
        setTimeout(() => existing?.parentNode?.removeChild(existing), 300);
      }
    });
  }

  /**
   * Attach delegated listeners to container. Safe: duplicates are ignored.
   */
  _bindCardDelegation(container = this.shopMatic?.root) {
    if (!container) return;
    if (!this.shopMatic._delegationHandlers) this.shopMatic._delegationHandlers = new Map();
    if (this.shopMatic._delegationHandlers.has(container)) return; // already attached

    const findQtyControls = (el) => ({
      input: el?.querySelector?.('[data-role="qty-input"], .qty-input, input[type="number"]'),
      incr: el?.querySelector?.('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]'),
      decr: el?.querySelector?.('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]'),
      buy: el?.querySelector?.('[data-role="buy"], [data-action="buy"], .btn-buy')
    });

    // single declaration for clampAndApplyQty (no duplicates)
    const clampAndApplyQty = (inputEl, id) => {
      if (!inputEl) return;
      const available = this._computeAvailableStock(id);
      const v = this._clampQty(inputEl.value || '1', 1, Math.max(0, available));
      inputEl.value = String(v);

      const parent = inputEl.closest('[data-product-id], [data-id], [data-name], .cart-row, li') || inputEl.parentElement;
      const { incr, buy } = findQtyControls(parent);
      if (incr) this._toggleDisabled(incr, Math.max(0, available) === 0 || v >= available);
      if (buy) this._toggleDisabled(buy, Math.max(0, available) === 0);
      return v;
    };

    const clickHandler = (ev) => {
      const t = ev.target;
      const card = t.closest?.('[data-product-id], [data-id], [data-name], [data-cart-id], [data-item-id]') || null;
      const idFromCard = this._getIdFromElement(card);

      // favorite toggle
      const favBtn = t.closest?.('[data-role="fav"], .fav-btn');
      if (favBtn && container.contains(favBtn)) {
        ev.stopPropagation();
        const id = this._getIdFromElement(favBtn.closest('[data-product-id], [data-id], [data-name], [data-cart-id], [data-item-id]')) || idFromCard;
        try {
          if (!this.shopMatic?.favorites) throw new Error('no favorites');
          const res = this.shopMatic.favorites.toggle(id);
          this.shopMatic.renderer?.updateProductCardFavState?.(container, id, this.shopMatic.favorites.isFavorite?.(id));
          if (typeof this.shopMatic._updateWishUI === 'function') {
            try { this.shopMatic._updateWishUI(); } catch (_) { /* ignore */ }
          }
          const icon = favBtn.querySelector?.('i');
          if (icon) {
            icon.classList.add('animate-pop');
            setTimeout(() => icon.classList.remove('animate-pop'), 380);
          }
          if (res && typeof res.then === 'function') res.catch(() => {});
        } catch (err) {
          this.shopMatic?.notifications?.show?.(this._msg('FAVORITES_UNAVAILABLE'), { type: 'error' });
        }
        return;
      }

      // buy button
      const buyBtn = t.closest?.('[data-role="buy"], [data-action="buy"], .btn-buy');
      if (buyBtn && container.contains(buyBtn)) {
        ev.stopPropagation();
        const id = this._getIdFromElement(buyBtn.closest('[data-product-id], [data-id], [data-name]')) || idFromCard;
        const { input } = findQtyControls(card);
        const desired = input ? Math.max(1, parseInt(input.value || '1', 10)) : 1;
        const available = this._computeAvailableStock(id);
        if (available <= 0) {
          this.shopMatic.notifications?.show?.(this._msg('CANNOT_ADD_NO_STOCK'), { duration: this.shopMatic.opts?.notificationDuration });
          this.shopMatic._syncAllCardsControls?.();
          return;
        }
        const qtyToAdd = Math.min(desired, available);
        if (qtyToAdd < desired) {
          this.shopMatic.notifications?.show?.(this._msg('ADDED_PARTIAL', { added: qtyToAdd, available }), { duration: (this.opts?.notificationDuration || this.shopMatic.opts?.notificationDuration) });
        }
        const res = this.shopMatic.cart?.add?.(id, qtyToAdd);
        if (res && typeof res.then === 'function') {
          res.then(() => this._syncCardControlsState(card)).catch(() => this._syncCardControlsState(card));
        } else {
          this._syncCardControlsState(card);
        }
        return;
      }

      // decrement qty
      const decrBtn = t.closest?.('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]');
      if (decrBtn && container.contains(decrBtn)) {
        ev.stopPropagation();
        const row = decrBtn.closest('[data-product-id], [data-id], [data-name], .cart-row') || decrBtn.closest('li') || decrBtn.parentElement;
        const id = this._getIdFromElement(row) || idFromCard;
        const { input, incr } = findQtyControls(row);
        if (!input) return;
        let newVal = Math.max(1, parseInt(input.value || '1', 10) - 1);
        const available = this._computeAvailableStock(id);
        const maxStock = Number.isFinite(available) ? Math.max(0, available) : 0;
        if (newVal > maxStock) newVal = maxStock;
        input.value = String(newVal);
        if (incr) this._toggleDisabled(incr, maxStock === 0 || newVal >= maxStock);
        const changeRes = this.shopMatic.changeQty?.(id, newVal);
        if (changeRes && typeof changeRes.then === 'function') changeRes.catch(() => {});
        this._syncCardControlsState(row);
        return;
      }

      // increment qty
      const incrBtn = t.closest?.('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]');
      if (incrBtn && container.contains(incrBtn)) {
        ev.stopPropagation();
        const row = incrBtn.closest('[data-product-id], [data-id], [data-name], .cart-row') || incrBtn.closest('li') || incrBtn.parentElement;
        const id = this._getIdFromElement(row) || idFromCard;
        const { input } = findQtyControls(row);
        if (!input) return;
        const available = this._computeAvailableStock(id);
        const maxStock = Number.isFinite(available) ? Math.max(0, available) : 0;
        let newVal = Math.min(maxStock, parseInt(input.value || '1', 10) + 1);
        if (isNaN(newVal) || newVal < 1) newVal = 1;
        input.value = String(newVal);
        this._toggleDisabled(incrBtn, maxStock === 0 || newVal >= maxStock);
        const { buy } = findQtyControls(row);
        if (buy) this._toggleDisabled(buy, maxStock === 0);
        const changeRes = this.shopMatic.changeQty?.(id, newVal);
        if (changeRes && typeof changeRes.then === 'function') changeRes.catch(() => {});
        this._syncCardControlsState(row);
        return;
      }
    };

    const inputHandler = (ev) => {
      const input = ev.target;
      if (!input?.matches?.('[data-role="qty-input"], .qty-input, input[type="number"]')) return;
      const row = input.closest('[data-product-id], [data-id], [data-name], .cart-row') || input.parentElement;
      const id = this._getIdFromElement(row);
      const clamped = clampAndApplyQty(input, id);
      if (clamped !== undefined) {
        const changeRes = this.shopMatic.changeQty?.(id, clamped);
        if (changeRes && typeof changeRes.then === 'function') changeRes.catch(() => {});
        this._syncCardControlsState(row);
      }
    };

    // attach listeners and keep references (WeakMap + shopMatic Map for compat)
    try {
      container.addEventListener('click', clickHandler, { passive: true });
      container.addEventListener('input', inputHandler);
      const handlers = { clickHandler, inputHandler };
      this._delegationHandlers.set(container, handlers);
      this.shopMatic._delegationHandlers.set(container, handlers);
    } catch (e) {
      if (this.shopMatic?.opts?.debug) console.error('[Card] attach listeners failed', e);
    }
  }

  destroyDelegation(container = null) {
    try {
      if (!this.shopMatic._delegationHandlers) return;

      if (container) {
        const h = this.shopMatic._delegationHandlers.get(container);
        if (h) {
          try { container.removeEventListener('click', h.clickHandler); } catch (_) {}
          try { container.removeEventListener('input', h.inputHandler); } catch (_) {}
          this.shopMatic._delegationHandlers.delete(container);
        }
        try { this._delegationHandlers.delete(container); } catch (_) {}
        return;
      }

      for (const [cont, h] of Array.from(this.shopMatic._delegationHandlers.entries())) {
        try { cont.removeEventListener('click', h.clickHandler); } catch (_) {}
        try { cont.removeEventListener('input', h.inputHandler); } catch (_) {}
        this.shopMatic._delegationHandlers.delete(cont);
      }
      this._delegationHandlers = new WeakMap();
    } catch (e) {
      if (this.shopMatic?.opts?.debug) console.error('[Card] destroyDelegation failed', e);
    }
  }

  _syncAllCardsIn(container = this.shopMatic?.root) {
    if (!container) return;
    const cards = container.querySelectorAll?.('[data-product-id], [data-id], [data-name], .product-card, .catalog-item') || [];
    for (const c of cards) {
      try { this._syncCardControlsState(c); } catch (_) {}
    }
  }
}