/**
 * MobileProductActionsBar — sticky mobile actions on product page:
 *  - "В корзину"
 *  - "Купить сейчас"
 *
 * Style/approach matches CheckoutController mobile block:
 *  - idempotent injection into footer container (.menu__content)
 *  - visible only on product route + mobile breakpoint
 *  - uses Card services / cart module (no inline onclick)
 *
 * @author Calista Verner
 */
export class MobileProductActionsBar {
  constructor(ctx, opts = {}) {
    if (!ctx) throw new Error('[MobileProductActionsBar] ctx is required');
    this.ctx = ctx;

    this.opts = {
      breakpointPx: Number.isFinite(Number(opts.breakpointPx)) ? Number(opts.breakpointPx) : 768,
      footerSelector: typeof opts.footerSelector === 'string' ? opts.footerSelector : '.menu__content',
      blockId: typeof opts.blockId === 'string' ? opts.blockId : 'mobileProductActionsBar',
      debug: !!opts.debug,

      // route matcher (customizable)
      // default: hash contains "product"
      isProductRoute: typeof opts.isProductRoute === 'function'
        ? opts.isProductRoute
        : (hash) => String(hash || '').includes('product'),

      // how to get current product id on product page
      // 1) ctx.currentProductId
      // 2) ctx.productId
      // 3) document [data-product-id] on product root
      getProductId: typeof opts.getProductId === 'function'
        ? opts.getProductId
        : () => null,
    };

    this._handler = null;
    this._attachedTo = null;
    this._hashHandler = null;

    this._mql = null;
    this._onMqlChange = null;

    this._block = null;
    this._btnAdd = null;
    this._btnBuyNow = null;

    this._lastProductId = null;

    // subscribe to domain events to refresh state
    this._unsubCart = null;

    this._initMediaQuery();
    this._initBusSubscription();
  }

  /* ---------------- logging ---------------- */

  _warn(msg, meta) {
    const l = this.ctx.logger;
    if (l && typeof l.warn === 'function') l.warn(`[MobileProductActionsBar] ${msg}`, meta);
    else if (this.opts.debug) console.warn(`[MobileProductActionsBar] ${msg}`, meta || '');
  }

  _err(msg, e, meta) {
    const l = this.ctx.logger;
    if (l && typeof l.error === 'function') l.error(`[MobileProductActionsBar] ${msg}`, e, meta);
    else console.error(`[MobileProductActionsBar] ${msg}`, e || '', meta || '');
  }

  /* ---------------- public ---------------- */

  bind(container = document.body) {
    if (!container) return;

    // idempotent
    if (this._handler && this._attachedTo === container) {
      this._ensureBlock(container);
      this._applyVisibility();
      this.refresh();
      return;
    }

    if (this._handler) this.unbind(this._attachedTo);

    this._attachedTo = container;

    this._hashHandler = () => {
      try {
        this._ensureBlock(container);
        this._applyVisibility();
        this.refresh();
      } catch (e) {
        this._err('hashchange handler failed', e);
      }
    };

    try { window.addEventListener('hashchange', this._hashHandler); }
    catch (e) { this._warn('addEventListener(hashchange) failed', { err: e }); }

    this._handler = (ev) => this._handleClick(ev, container);

    try { container.addEventListener('click', this._handler, { passive: false }); }
    catch (e) { this._err('container.addEventListener(click) failed', e); }

    this._ensureBlock(container);
    this._applyVisibility();
    this.refresh();
  }

  unbind(container) {
    if (!this._handler) return;

    try { if (container) container.removeEventListener('click', this._handler); }
    catch (e) { this._warn('removeEventListener(click) failed', { err: e }); }

    this._handler = null;
    this._attachedTo = null;

    try { if (this._hashHandler) window.removeEventListener('hashchange', this._hashHandler); }
    catch (e) { this._warn('removeEventListener(hashchange) failed', { err: e }); }

    this._hashHandler = null;

    // keep DOM, just hide
    try {
      const block = this._getBlock();
      if (block) block.style.display = 'none';
    } catch (e) {
      this._warn('hide block failed', { err: e });
    }
  }

  destroy() {
    this.unbind(this._attachedTo);

    this._destroyMediaQuery();
    this._destroyBusSubscription();

    this._block = null;
    this._btnAdd = null;
    this._btnBuyNow = null;
  }

  /**
   * Force state recompute (qty/stock/inCart).
   * Call this on product page render and on cart changes.
   */
  refresh() {
    try {
      const id = this._resolveProductId();
      this._lastProductId = id;

      this._applyVisibility();

      // if not visible or no id => stop
      if (!this._block || this._block.style.display === 'none') return;
      if (!id) return;

      this._syncButtonsState(id);
    } catch (e) {
      this._err('refresh failed', e);
    }
  }

  /* ---------------- internals: routing/mobile ---------------- */

  _initMediaQuery() {
    try {
      this._mql = window.matchMedia(`(max-width: ${this.opts.breakpointPx}px)`);
      this._onMqlChange = () => {
        try {
          this._ensureBlock(this._attachedTo || document.body);
          this._applyVisibility();
          this.refresh();
        } catch (e) {
          this._err('mql change failed', e);
        }
      };

      if (typeof this._mql.addEventListener === 'function') this._mql.addEventListener('change', this._onMqlChange);
      else if (typeof this._mql.addListener === 'function') this._mql.addListener(this._onMqlChange);
    } catch (e) {
      this._warn('matchMedia init failed', { err: e });
      this._mql = null;
      this._onMqlChange = null;
    }
  }

  _destroyMediaQuery() {
    if (!this._mql || !this._onMqlChange) return;
    try {
      if (typeof this._mql.removeEventListener === 'function') this._mql.removeEventListener('change', this._onMqlChange);
      else if (typeof this._mql.removeListener === 'function') this._mql.removeListener(this._onMqlChange);
    } catch (e) {
      this._warn('matchMedia remove failed', { err: e });
    }
    this._mql = null;
    this._onMqlChange = null;
  }

  _isMobileNow() {
    return !!(this._mql && this._mql.matches);
  }

  _isProductRoute() {
    try { return !!this.opts.isProductRoute(window.location.hash); }
    catch (e) { this._warn('isProductRoute failed', { err: e }); return false; }
  }

  _resolveProductId() {
    // 1) explicit ctx fields
    if (this.ctx.currentProductId) return String(this.ctx.currentProductId).trim();
    if (this.ctx.productId) return String(this.ctx.productId).trim();

    // 2) callback override
    try {
      const custom = this.opts.getProductId();
      if (custom) return String(custom).trim();
    } catch (e) {
      this._warn('getProductId() failed', { err: e });
    }

    // 3) DOM heuristic: product root contains data-product-id
    try {
      const el = document.querySelector('[data-page="product"][data-product-id], .product-page [data-product-id], [data-product-id].product');
      if (el) {
        const pid = el.getAttribute('data-product-id') || el.getAttribute('data-id');
        if (pid) return String(pid).trim();
      }
    } catch (e) {
      this._warn('DOM product id resolve failed', { err: e });
    }

    return null;
  }

  _applyVisibility() {
    const block = this._getBlock();
    if (!block) return;

    const visible = this._isMobileNow() && this._isProductRoute();
    block.style.display = visible ? 'block' : 'none';
  }

  /* ---------------- internals: DOM lifecycle ---------------- */

  _getBlock() {
    if (this._block && this._block.isConnected) return this._block;

    try {
      const el = document.getElementById(this.opts.blockId);
      this._block = el || null;

      if (this._block) {
        this._btnAdd = this._block.querySelector('[data-role="mp-add"]');
        this._btnBuyNow = this._block.querySelector('[data-role="mp-buy"]');
      }

      return this._block;
    } catch (e) {
      this._err('getBlock failed', e);
      this._block = null;
      return null;
    }
  }

  _ensureBlock(container = document.body) {
    // inject only on mobile+product route to avoid flashing on other pages
    if (!this._isMobileNow()) return;
    if (!this._isProductRoute()) return;

    if (document.getElementById(this.opts.blockId)) {
      this._getBlock();
      return;
    }

    const footer = this._resolveFooter(container);
    if (!footer) return;

    try {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <section class="mobileBottomBlock" id="${this.opts.blockId}">
          <div class="mobileProductActions__inner">
		    <button type="button" class="btn btn-primary" data-role="mp-buy">Купить сейчас</button>
            <button type="button" class="btn btn-secondary" data-role="mp-add">В корзину</button>  
          </div>
        </section>
      `;



      footer.insertBefore(wrap, footer.firstChild);
      this._getBlock();
    } catch (e) {
      this._err('ensureBlock inject failed', e);
    }
  }

  _resolveFooter(container) {
    try {
      const el = container.querySelector(this.opts.footerSelector);
      return el || null;
    } catch (e) {
      this._warn('resolveFooter failed', { err: e, selector: this.opts.footerSelector });
      return null;
    }
  }

  /* ---------------- internals: actions ---------------- */

  _initBusSubscription() {
    // optional: listen to cart changes to refresh state
    const sm = this.ctx.shopMatic;
    if (!sm || !sm.eventBus || typeof sm.eventBus.on !== 'function') return;

    try {
      // canonical event name from your Events.js
      const EVT = (sm.Events && sm.Events.DOMAIN_CART_CHANGED) ? sm.Events.DOMAIN_CART_CHANGED : 'domain.cart.changed';
      this._unsubCart = sm.eventBus.on(EVT, () => this.refresh());
    } catch (e) {
      this._warn('eventBus subscribe failed', { err: e });
    }
  }

  _destroyBusSubscription() {
    try { if (typeof this._unsubCart === 'function') this._unsubCart(); }
    catch (e) { this._warn('eventBus unsubscribe failed', { err: e }); }
    this._unsubCart = null;
  }

  _handleClick(ev, container) {
    if (!ev) return;
    const block = this._getBlock();
    if (!block || block.style.display === 'none') return;

    // clicks only inside this block
    let addBtn = null;
    let buyBtn = null;
    try {
      const t = ev.target;
      addBtn = t && t.closest ? t.closest('[data-role="mp-add"]') : null;
      buyBtn = t && t.closest ? t.closest('[data-role="mp-buy"]') : null;
    } catch (e) {
      this._warn('closest failed', { err: e });
      return;
    }

    if (!addBtn && !buyBtn) return;
    if (container && !container.contains(block)) return;

    ev.preventDefault();
    ev.stopPropagation();

    const id = this._resolveProductId();
    if (!id) return;

    if (addBtn) {
      this._actionAddToCart(id, addBtn);
      return;
    }
    if (buyBtn) {
      this._actionBuyNow(id, buyBtn);
    }
  }

  _actionAddToCart(id, btn) {
    try {
      // Prefer Card actions if present (adult). Else fallback to ctx.cart.add.
      const card = this.ctx.shopMatic && this.ctx.shopMatic.card;
      if (card && typeof card._addToCart === 'function') {
        card._addToCart(id, 1, btn);
      } else if (this.ctx.add && typeof this.ctx.add === 'function') {
        this.ctx.add(id, 1);
      } else if (this.ctx.cart && typeof this.ctx.cart.add === 'function') {
        this.ctx.cart.add(id, 1);
      } else {
        this._warn('No addToCart handler found', { id });
      }
      this.refresh();
    } catch (e) {
      this._err('actionAddToCart failed', e, { id });
    }
  }

  _actionBuyNow(id, btn) {
    try {
      // Buy now = add to cart then open checkout (or direct)
      this._actionAddToCart(id, btn);

      const checkout = this.ctx.checkout;
      if (checkout && typeof checkout.openCheckout === 'function') {
        checkout.openCheckout();
        return;
      }

      // fallback: hash
      if (location.hash !== '#page/checkout') location.hash = '#page/checkout';
      else window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (e) {
      this._err('actionBuyNow failed', e, { id });
    }
  }

  _syncButtonsState(id) {
    // If you have stock helper in Card -> compute available, inCart qty, etc.
    const card = this.ctx.shopMatic && this.ctx.shopMatic.card;
    if (!card || typeof card.computeState !== 'function') return;

    const st = card.computeState(id);
    if (!st) return;

    // Out of stock = disable both
    const out = st.totalStock <= 0;
    if (this._btnAdd) {
      this._btnAdd.disabled = out;
      this._btnAdd.setAttribute('aria-disabled', out ? 'true' : 'false');
      this._btnAdd.textContent = out ? 'Нет в наличии' : (st.inCart ? 'В корзине' : 'В корзину');
    }

    if (this._btnBuyNow) {
      this._btnBuyNow.disabled = out;
      this._btnBuyNow.setAttribute('aria-disabled', out ? 'true' : 'false');
      this._btnBuyNow.textContent = out ? 'Нет в наличии' : 'Купить сейчас';
    }
  }
}
