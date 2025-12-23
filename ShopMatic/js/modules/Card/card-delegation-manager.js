/**
 * CardDelegationManager — event delegation for card actions.
 * @author Calista Verner
 */
export class CardDelegationManager {
  /**
   * @param {Object} card       — Card instance
   * @param {Object} domHelper  — DOM helper (optional)
   * @param {Object} cartHelper — cart helper
   */
  constructor(card, domHelper, cartHelper) {
    this.card = card;
    this.dom = domHelper;
    this.cart = cartHelper;
    this.foxEngine = this.card?.shopMatic?.foxEngine;

    // container -> handlers
    this._delegationHandlers = new WeakMap();
  }

  bindCardDelegation(container = this.card?.shopMatic?.root) {
    this._bindDelegationTarget(container);
  }

  bindCard(cardEl) {
    if (!cardEl) return;
    this._bindDelegationTarget(cardEl);
  }

  destroyDelegation(container = null) {
    const shopMatic = this.card?.shopMatic;
    if (!shopMatic || !shopMatic._delegationHandlers) return;

    try {
      if (container) {
        const h = this._delegationHandlers.get(container) || shopMatic._delegationHandlers.get(container);
        if (h) {
          try { container.removeEventListener('click', h.clickHandler); } catch {}
          try { container.removeEventListener('input', h.inputHandler); } catch {}
          shopMatic._delegationHandlers.delete(container);
          try { this._delegationHandlers.delete(container); } catch {}
        }
        return;
      }

      for (const [cont, h] of Array.from(shopMatic._delegationHandlers.entries())) {
        try { cont.removeEventListener('click', h.clickHandler); } catch {}
        try { cont.removeEventListener('input', h.inputHandler); } catch {}
        shopMatic._delegationHandlers.delete(cont);
      }

      this._delegationHandlers = new WeakMap();
    } catch (e) {
      if (shopMatic?.opts?.debug) console.error('[Card] destroyDelegation failed', e);
    }
  }

  _bindDelegationTarget(rootEl) {
    const card = this.card;
    const shopMatic = card?.shopMatic;
    if (!rootEl || !card || !shopMatic || !this.cart) return;

    if (!shopMatic._delegationHandlers) shopMatic._delegationHandlers = new Map();
    if (this._delegationHandlers.has(rootEl)) return;
    if (shopMatic._delegationHandlers.has(rootEl)) return;

    const findQtyControls = (el) => this._findQtyControls(el);

    const clickHandler = (ev) => {
      if (!ev || ev.defaultPrevented) return;

      const t = ev.target;
      if (!t || !rootEl.contains(t)) return;

      // resolve card root once
      const cardEl =
        t.closest?.('[data-product-id], [data-id], [data-name], [data-cart-id], [data-item-id]') || null;

      const idFromCard = card._getIdFromElement(cardEl);

      // --- Favorites
      const favBtn = t.closest?.('[data-role="fav"], .fav-btn');
      if (favBtn && rootEl.contains(favBtn)) {
        ev.preventDefault();
        ev.stopPropagation();

        const id =
          card._getIdFromElement(
            favBtn.closest?.('[data-product-id], [data-id], [data-name], [data-cart-id], [data-item-id]')
          ) || idFromCard;

        if (!id) return;

        try {
          const res = shopMatic.favorites?.toggle?.(id);
          try { card._applyFavState(cardEl, shopMatic.isFavorite(id)); } catch {}

          try { shopMatic._updateWishUI?.(); } catch {}

          const icon = favBtn.querySelector?.('i');
          if (icon) {
            icon.classList.add('animate-pop');
            setTimeout(() => icon.classList.remove('animate-pop'), 380);
          }

          if (res && typeof res.then === 'function') res.catch(() => {});
        } catch (e) {
          shopMatic?.notifications?.show?.(card._msg('FAVORITES_UNAVAILABLE'), { type: 'error' });
        }
        return;
      }

      // --- Buy now
      const buyNowBtn = t.closest?.('[data-role="buy-now"], [data-action="buy-now"], .buyNow');
      if (buyNowBtn && rootEl.contains(buyNowBtn)) {
        ev.preventDefault();
        ev.stopPropagation();

        const id =
          card._getIdFromElement(buyNowBtn.closest?.('[data-product-id], [data-id], [data-name]')) || idFromCard;

        this.cart.handleBuyNowClick(ev, { card: cardEl, id });
        return;
      }

      // --- Buy / add to cart
      const buyBtn = t.closest?.('[data-role="buy"], [data-action="buy"], .btn-buy');
      if (buyBtn && rootEl.contains(buyBtn)) {
        ev.preventDefault();
        ev.stopPropagation();

        // If disabled, ignore (cheap guard)
        try { if (buyBtn.disabled) return; } catch {}

        const id =
          card._getIdFromElement(buyBtn.closest?.('[data-product-id], [data-id], [data-name]')) || idFromCard;

        const { input } = findQtyControls(cardEl);
        const desired = input ? Math.max(1, parseInt(input.value || '1', 10)) : 1;

        this.cart.handleBuyAction({ card: cardEl, id, desired, isBuyNow: false });
        return;
      }

      // --- Qty minus
      const decrBtn = t.closest?.('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]');
      if (decrBtn && rootEl.contains(decrBtn)) {
        ev.preventDefault();
        ev.stopPropagation();

        const row =
          decrBtn.closest?.('[data-product-id], [data-id], [data-name], .cart-row') ||
          decrBtn.closest?.('li') ||
          decrBtn.parentElement;

        const id = card._getIdFromElement(row) || idFromCard;
        const { input } = findQtyControls(row);
        if (!input) return;

        let current = parseInt(input.value || '1', 10);
        if (isNaN(current)) current = 1;

        this.cart.applyQtyChange(id, row, current - 1);
        return;
      }

      // --- Qty plus
      const incrBtn = t.closest?.('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]');
      if (incrBtn && rootEl.contains(incrBtn)) {
        ev.preventDefault();
        ev.stopPropagation();

        const row =
          incrBtn.closest?.('[data-product-id], [data-id], [data-name], .cart-row') ||
          incrBtn.closest?.('li') ||
          incrBtn.parentElement;

        const id = card._getIdFromElement(row) || idFromCard;
        const { input } = findQtyControls(row);
        if (!input) return;

        let current = parseInt(input.value, 10);
        if (isNaN(current) || current < 1) current = 1;

        this.cart.applyQtyChange(id, row, current + 1);
      }
    };

    const inputHandler = (ev) => {
      const inputEl = ev.target;
      if (!inputEl?.matches?.('[data-role="qty-input"], .qty-input, input[type="number"]')) return;

      const row =
        inputEl.closest?.('[data-product-id], [data-id], [data-name], .cart-row') || inputEl.parentElement;

      const id = card._getIdFromElement(row);
      let v = parseInt(inputEl.value, 10);
      if (isNaN(v) || v < 0) v = 0;

      this.cart.applyQtyChange(id, row, v);
    };

    try {
      // IMPORTANT: click cannot be passive because we call preventDefault/stopPropagation
      rootEl.addEventListener('click', clickHandler, { passive: false });
      // input can be passive
      rootEl.addEventListener('input', inputHandler, { passive: true });

      const handlers = { clickHandler, inputHandler };
      this._delegationHandlers.set(rootEl, handlers);
      shopMatic._delegationHandlers.set(rootEl, handlers);
    } catch (e) {
      if (shopMatic?.opts?.debug) console.error('[Card] attach listeners failed', e);
    }
  }

  _findQtyControls(el) {
    if (!el?.querySelector) {
      return { input: null, incr: null, decr: null, buy: null, buyNow: null };
    }

    return {
      input: el.querySelector('[data-role="qty-input"], .qty-input, input[type="number"]'),
      incr: el.querySelector('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]'),
      decr: el.querySelector('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]'),
      buy: el.querySelector('[data-role="buy"], [data-action="buy"], .btn-buy'),
      buyNow: el.querySelector('[data-role="buy-now"], [data-action="buy-now"], .buyNow')
    };
  }
}
