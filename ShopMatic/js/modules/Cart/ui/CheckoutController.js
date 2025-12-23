/**
 * @author Calista Verner
 *
 * CheckoutController — isolated checkout / hash logic (hardened).
 * Responsibilities:
 *  - Bind/unbind checkout click
 *  - Mobile checkout block lifecycle + data update
 *  - Show only on cart route
 *  - No cart mutations; reads state only via ctx
 */
export class CheckoutController {
  constructor(ctx, opts = {}) {
    if (!ctx) throw new Error('[CheckoutController] ctx is required');
    this.ctx = ctx;

    this.opts = {
      breakpointPx: Number.isFinite(Number(opts.breakpointPx)) ? Number(opts.breakpointPx) : 768,
      footerSelector: typeof opts.footerSelector === 'string' ? opts.footerSelector : '.menu__content',
      blockId: typeof opts.blockId === 'string' ? opts.blockId : 'mobileCheckoutBlock',
      debug: !!opts.debug
    };

    this._handler = null;
    this._attachedTo = null;
    this._hashHandler = null;

    this._mql = null;
    this._onMqlChange = null;

    // cached dom refs
    this._block = null;
    this._countEl = null;
    this._wordEl = null;
    this._priceEl = null;

    this._last = { cartItemsCount: 0, includedCount: 0, sum: 0 };

    this._initMediaQuery();
  }

  /* ---------------- logging ---------------- */

  _warn(msg, meta) {
    const l = this.ctx.logger;
    if (l && typeof l.warn === 'function') l.warn(`[CheckoutController] ${msg}`, meta);
    else if (this.opts.debug) console.warn(`[CheckoutController] ${msg}`, meta || '');
  }

  _err(msg, e, meta) {
    const l = this.ctx.logger;
    if (l && typeof l.error === 'function') l.error(`[CheckoutController] ${msg}`, e, meta);
    else console.error(`[CheckoutController] ${msg}`, e || '', meta || '');
  }

  /* ---------------- public API ---------------- */

  bind(container = document.body) {
    if (!container) return;

    // idempotent bind
    if (this._handler && this._attachedTo === container) {
      // still ensure lifecycle correctness
      this._ensureMobileCheckoutBlock(container);
      this._applyVisibilityPolicy();
      this._applyDataToDom();
      return;
    }

    if (this._handler) this.unbind(this._attachedTo);

    this._attachedTo = container;

    // Ensure mobile block exists if needed
    this._ensureMobileCheckoutBlock(container);

    // Hash listener: only controls visibility, does NOT unbind.
    this._hashHandler = () => {
      try {
        this._ensureMobileCheckoutBlock(container);
        this._applyVisibilityPolicy();
      } catch (e) {
        this._err('hashchange handler failed', e);
      }
    };

    try {
      window.addEventListener('hashchange', this._hashHandler);
    } catch (e) {
      this._warn('window.addEventListener(hashchange) failed', { err: e });
    }

    this._handler = (ev) => this._handleCheckoutClick(ev, container);

    try {
      container.addEventListener('click', this._handler, { passive: false });
    } catch (e) {
      this._err('container.addEventListener(click) failed', e);
    }

    // Apply current state
    this._applyVisibilityPolicy();
    this._applyDataToDom();
  }

  unbind(container) {
    if (!this._handler) return;

    try {
      if (container) container.removeEventListener('click', this._handler);
    } catch (e) {
      this._warn('removeEventListener(click) failed', { err: e });
    }

    this._handler = null;
    this._attachedTo = null;

    try {
      if (this._hashHandler) window.removeEventListener('hashchange', this._hashHandler);
    } catch (e) {
      this._warn('removeEventListener(hashchange) failed', { err: e });
    }
    this._hashHandler = null;

    // Do not delete DOM — just hide
    try {
      const block = this._getBlock();
      if (block) block.style.display = 'none';
    } catch (e) {
      this._warn('hide block on unbind failed', { err: e });
    }
  }

  destroy() {
    this.unbind(this._attachedTo);
    this._destroyMediaQuery();
    this._block = null;
    this._countEl = null;
    this._wordEl = null;
    this._priceEl = null;
  }

  /**
   * Called from CartUI after every _updateCartUI().
   * includedCount = totalCount (qty-based) for included items
   */
  updateMobileCheckout({ cartItemsCount = 0, includedCount = 0, sum = 0 } = {}) {
    this._last = {
      cartItemsCount: Number(cartItemsCount) || 0,
      includedCount: Number(includedCount) || 0,
      sum: Number(sum) || 0
    };

    // Update data + visibility
    this._applyVisibilityPolicy();
    this._applyDataToDom();
  }

  /**
   * Optional: “adult” entrypoint for checkout navigation.
   */
  openCheckout() {
    try {
      const sm = this.ctx.shopMatic;
      if (sm && sm.router && typeof sm.router.go === 'function') {
        sm.router.go('#page/checkout');
        return;
      }
      if (this.ctx.foxEngine && this.ctx.foxEngine.page && typeof this.ctx.foxEngine.page.loadPage === 'function') {
        this.ctx.foxEngine.page.loadPage('checkout');
        return;
      }
      if (location.hash !== '#page/checkout') location.hash = '#page/checkout';
      else window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (e) {
      this._err('openCheckout failed', e);
      try { window.location.href = '/checkout'; } catch {}
    }
  }

  /* ---------------- internals ---------------- */

  _initMediaQuery() {
    try {
      this._mql = window.matchMedia(`(max-width: ${this.opts.breakpointPx}px)`);
      this._onMqlChange = () => {
        try {
          this._ensureMobileCheckoutBlock(this._attachedTo || document.body);
          this._applyVisibilityPolicy();
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

  _isCartRoute() {
    const h = String(window.location.hash || '');
    // keep compatible with your routing
    return h.includes('cart');
  }

  _shouldHideByData() {
    const cartEmpty = this._last.cartItemsCount <= 0;
    const noneSelected = this._last.includedCount <= 0;
    const sumZero = this._last.sum <= 0;
    return cartEmpty || noneSelected || sumZero;
  }

  _applyVisibilityPolicy() {
    const block = this._getBlock();
    if (!block) return;

    // Show only on mobile + on cart route + data allows
    const visible =
      this._isMobileNow() &&
      this._isCartRoute() &&
      !this._shouldHideByData();

    block.style.display = visible ? 'block' : 'none';
  }

  _getBlock() {
    if (this._block && this._block.isConnected) return this._block;

    try {
      const el = document.getElementById(this.opts.blockId);
      this._block = el || null;

      if (this._block) {
        // refresh field refs
        this._countEl = document.getElementById('mobileProductCount');
        this._wordEl = document.getElementById('mobileProductWord');
        this._priceEl = document.getElementById('mobileTotalPrice');
      }

      return this._block;
    } catch (e) {
      this._err('getBlock failed', e);
      this._block = null;
      return null;
    }
  }

  _ensureMobileCheckoutBlock(container = document.body) {
    // Only inject if:
    // - mobile breakpoint matches
    // - we're on cart route (so it won't appear on other pages)
    // - footer exists
    if (!this._isMobileNow()) return;
    if (!this._isCartRoute()) return;

    const footer = this._resolveFooter(container);
    if (!footer) return;

    // If exists, just cache refs
    if (document.getElementById(this.opts.blockId)) {
      this._getBlock();
      return;
    }

    try {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <section class="mobileBottomBlock" id="${this.opts.blockId}">
          <a href="#page/checkout" class="btn btn-primary" data-target="checkout">
            <ul>
              <li class="mobileProducts">
                <span id="mobileProductCount"></span>
                <span id="mobileProductWord"></span>
              </li>
              <li><b>К оформлению</b></li>
              <li class="mobilePrice">
                <span id="mobileTotalPrice">0</span>
              </li>
            </ul>
          </a>
        </section>
      `;
      footer.insertBefore(wrap, footer.firstChild);

      // cache refs
      this._getBlock();

      // Apply current state after inject
      this._applyDataToDom();
      this._applyVisibilityPolicy();
    } catch (e) {
      this._err('ensureMobileCheckoutBlock inject failed', e);
    }
  }

  _resolveFooter(container) {
    try {
      if (!container) return null;
      const sel = this.opts.footerSelector;
      const el = container.querySelector(sel);
      return el || null;
    } catch (e) {
      this._warn('resolveFooter failed', { err: e, selector: this.opts.footerSelector });
      return null;
    }
  }

  _applyDataToDom() {
    const block = this._getBlock();
    if (!block) return;

    try {
      if (this._countEl) this._countEl.textContent = String(Math.max(0, this._last.includedCount));
      if (this._wordEl) this._wordEl.textContent = this._pluralizeGoods(Math.max(0, this._last.includedCount));
      if (this._priceEl) this._priceEl.textContent = this._formatPrice(Math.max(0, this._last.sum));
    } catch (e) {
      this._err('applyDataToDom failed', e);
    }

    // aria semantics on link
    try {
      const link = block.querySelector('a.btn-primary');
      if (link) {
        const disabled = this._shouldHideByData();
        link.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        if (disabled) link.setAttribute('tabindex', '-1');
        else link.removeAttribute('tabindex');
      }
    } catch (e) {
      this._warn('aria sync failed', { err: e });
    }
  }

  _formatPrice(sum) {
    // prefer shared util if ctx exposes it
    try {
      if (typeof this.ctx._formatPrice === 'function') return this.ctx._formatPrice(sum);
    } catch (e) {
      this._warn('_formatPrice failed', { err: e });
    }

    // fall back to global util if present
    try {
      if (typeof window.formatPrice === 'function') return window.formatPrice(sum);
    } catch {}

    return String(sum);
  }

  _pluralizeGoods(n) {
    const forms = ['товар', 'товара', 'товаров'];
    const num = Math.abs(Number(n) || 0);
    const n10 = num % 10;
    const n100 = num % 100;

    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
    return forms[2];
  }

  _handleCheckoutClick(ev, container) {
    const c = this.ctx;
    if (!ev) return;

    let btn = null;
    try {
      btn = ev.target && ev.target.closest ? ev.target.closest('.btn-primary') : null;
    } catch (e) {
      this._warn('closest(.btn-primary) failed', { err: e });
      return;
    }

    if (!btn) return;
    if (container && !container.contains(btn)) return;

    ev.preventDefault();
    ev.stopPropagation();

    // hard remove inline onclick if present
    try {
      if (btn.getAttribute && btn.getAttribute('onclick')) btn.removeAttribute('onclick');
    } catch (e) {
      this._warn('remove onclick failed', { err: e });
    }

    const cart = Array.isArray(c.cart) ? c.cart : [];
    const isEmpty = cart.length === 0;

    // included selection check (prefer service)
    let hasSelected = false;
    try {
      if (c.included && typeof c.included.countSelected === 'function') {
        hasSelected = c.included.countSelected(cart) > 0;
      } else {
        for (let i = 0; i < cart.length; i++) {
          const it = cart[i];
          if (it && it.included) { hasSelected = true; break; }
        }
      }
    } catch (e) {
      this._warn('hasSelected compute failed', { err: e });
      hasSelected = false;
    }

    const warn = (msg) => {
      try {
        if (c.notifications && typeof c.notifications.show === 'function') {
          c.notifications.show(msg, { type: 'warn' });
          return;
        }
      } catch (e) {
        this._warn('notifications.show failed', { err: e });
      }
      try { alert(msg); } catch {}
    };

    if (isEmpty) { warn('Ваша корзина пуста!'); return; }
    if (!hasSelected) { warn('Не выбран ни один товар для оформления!'); return; }

    // use adult entrypoint
    this.openCheckout();
  }
}