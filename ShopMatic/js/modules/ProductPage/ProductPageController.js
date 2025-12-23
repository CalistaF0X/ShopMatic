// ProductPage/ProductPageController.js
import { MobileProductActionsBar } from "./MobileProductActionsBar.js";
export class ProductPageController {
  constructor(context, view) {
    this.ctx = context;
    this.view = view;

    this._bound = {
      onAddClick: this.onAddClick.bind(this),
      onFavClick: this.onFavClick.bind(this),
      onQtyInput: this.onQtyInput.bind(this),
      onQtyIncr: this.onQtyIncr.bind(this),
      onQtyDecr: this.onQtyDecr.bind(this),
      onWishlistClick: this.onWishlistClick.bind(this),
      onBackClick: this.onBackClick.bind(this),
      onCartUpdated: this.onCartUpdated.bind(this),
      onBuyNowClick: this.onBuyNowClick.bind(this),
    };
  }

  async render(productId, container) {
    const el = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!el) throw new Error('container element required');

    this.view.attach(el, productId);
    this.ctx.log('render: fetching product', productId);

    const product = await this.ctx.fetchProduct(productId);
    if (!product) {
      this.ctx.log('render: product not found', productId);
      await this.view.renderNotFound();
      this.bindBackOnly();
      return;
    }

    try {
      this.ctx.cart?.loadFromStorage?.();
    } catch {}

    const cartItem = this.ctx.getCartItem(productId);
    const qtyFromCart = cartItem ? Number(cartItem.qty || 0) : 0;

    await this.view.renderMain(product, qtyFromCart);

    try {
      this.view.setQtyControlHandlers(
        this._bound.onAddClick,
        this._bound.onBuyNowClick,
      );
      this.view.syncFavButton();
      this.view.syncQtyControls();
      this.view.syncWishlistButton();
      this.bindListeners();
    } catch (e) {
      console.error('UI sync/bind error', e);
    }

    try {
      await this.renderRelated(product);
    } catch (e) {
      console.error('renderRelated error', e);
    }
  }

  destroy() {
    if (!this.view.isAttached()) return;
    this.unbindListeners();
    this.view.detach();
  }

  /* ---------- биндинг событий ---------- */

  bindListeners() {
    const c = this.view.container;
    if (!c) return;

    const add = (selector, event, handler) => {
      const el = c.querySelector(selector);
      if (el) el.addEventListener(event, handler);
    };

    add('[data-action="add-to-cart"], .add-to-cart, .btn-yellow', 'click', this._bound.onAddClick);
    add('.fav-toggle', 'click', this._bound.onFavClick);
    add('.wishlist-toggle', 'click', this._bound.onWishlistClick);
    add('.qty-input', 'input', this._bound.onQtyInput);
    add('[data-action="back"]', 'click', this._bound.onBackClick);
    add('[data-action="buy-now"]', 'click', this._bound.onBuyNowClick);

    c.querySelectorAll('.qty-incr')
      .forEach(btn => btn.addEventListener('click', this._bound.onQtyIncr));

    c.querySelectorAll('.qty-decr')
      .forEach(btn => btn.addEventListener('click', this._bound.onQtyDecr));

    this.view.setThumbHandlers(idx => {
      const product = this.ctx.getProductSync(this.view.currentProductId) || {};
      const photos = Array.isArray(product.images) ? product.images : [];
      const src = photos[idx];
      const main = c.querySelector('.product-main-img');
      if (main && src) main.src = src;
    });

    this.view.setSizeButtonsHandler(btn => {
      c.querySelectorAll('.size-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
	
	this.mobileActions = new MobileProductActionsBar(this.ctx, {
	  breakpointPx: 768,
	  footerSelector: '.menu__content',
	  isProductRoute: (hash) => String(hash || '').includes('product'),
	  // если у тебя есть источник id:
	  getProductId: () => this.view.currentProductId // или this.product?.id
	});

	this.mobileActions.bind(document.body);
	this.ctx.currentProductId = this.view.currentProductId; // чтобы bar мог забрать id
	this.mobileActions.refresh();
    window.addEventListener('cart:updated', this._bound.onCartUpdated);

    try {
      this.view.initGallery();
    } catch (e) {
      console.warn('gallery init failed', e);
    }
  }

  bindBackOnly() {
    const c = this.view.container;
    if (!c) return;
    const back = c.querySelector('[data-action="back"]');
    back?.addEventListener('click', this._bound.onBackClick);
  }

  unbindListeners() {
    const c = this.view.container;
    if (!c) return;

    const remove = (selector, event, handler) => {
      const el = c.querySelector(selector);
      el?.removeEventListener?.(event, handler);
    };

    remove('[data-action="add-to-cart"], .add-to-cart, .btn-yellow', 'click', this._bound.onAddClick);
    remove('.fav-toggle', 'click', this._bound.onFavClick);
    remove('.wishlist-toggle', 'click', this._bound.onWishlistClick);
    remove('.qty-input', 'input', this._bound.onQtyInput);
    remove('[data-action="back"]', 'click', this._bound.onBackClick);
    remove('[data-action="buy-now"]', 'click', this._bound.onBuyNowClick);

    c.querySelectorAll('.qty-incr')
      .forEach(btn => btn.removeEventListener('click', this._bound.onQtyIncr));

    c.querySelectorAll('.qty-decr')
      .forEach(btn => btn.removeEventListener('click', this._bound.onQtyDecr));

    c.querySelectorAll('.thumb-btn')
      .forEach(t => t.replaceWith(t.cloneNode(true)));

    c.querySelectorAll('.size-btn')
      .forEach(b => b.replaceWith(b.cloneNode(true)));

    window.removeEventListener('cart:updated', this._bound.onCartUpdated);
  }

  /* ---------- handlers ---------- */

  onAddClick() {
    const pid = this.view.currentProductId;
    if (!pid) return;

    try {
      const c = this.view.container;
      const qtyEl = c?.querySelector('.qty-input');
      const qty = Math.max(1, parseInt(qtyEl?.value || '1', 10));

      const available = this.ctx.computeAvailableStock(pid);

      if (available <= 0) {
        this.ctx.notify(this.ctx.messages.addToCartDisabled, { duration: 3000 });
        return;
      }

      const toAdd = Math.min(qty, available);
      this.ctx.addToCart(pid, toAdd);
      this.view.syncQtyControls();
    } catch (err) {
      console.error('onAddClick error', err);
      this.ctx.notify(this.ctx.messages.addToCartError, { duration: 3000 });
    }
  }

  onFavClick() {
    const pid = this.view.currentProductId;
    if (!pid) return;

    try {
      this.ctx.toggleFavorite(pid);
      this.view.syncFavButton();

      const isFav = this.ctx.isFavorite(pid);
      this.ctx.notify(
        isFav ? this.ctx.messages.favoriteAdded : this.ctx.messages.favoriteRemoved,
        { duration: 1500 },
      );
    } catch (err) {
      console.warn(err);
    }
  }

  onWishlistClick() {
    const pid = this.view.currentProductId;
    if (!pid) return;

    if (!this.ctx.wishlist) {
      this.ctx.notify(this.ctx.messages.wishlistNotConfigured, { duration: 1400 });
      return;
    }

    try {
      this.ctx.toggleWishlist(pid);
      this.view.syncWishlistButton();
      this.ctx.notify(this.ctx.messages.wishlistUpdated, { duration: 1200 });
    } catch (err) {
      console.warn(err);
    }
  }

  onQtyInput(e) {
    const pid = this.view.currentProductId;
    if (!pid) return;

    const qty = parseInt(e.target.value || '1', 10) || 1;
    const product = this.ctx.getProductSync(pid);
    const available = this.ctx.computeStock(product);

    if (qty > available) {
      e.target.value = String(available || 1);
      const msg = this.ctx.messages.maxAvailableTemplate.replace('{count}', String(available));
      this.ctx.notify(msg, { duration: 1400 });
    }

    const cartItem = this.ctx.getCartItem(pid);

    if (cartItem && typeof this.ctx.cart?.changeQty === 'function') {
      const newQty = Math.max(
        1,
        Math.min(available || 1, parseInt(e.target.value || '1', 10)),
      );
      try {
        this.ctx.changeCartQty(pid, newQty);
      } catch (err) {
        console.warn(err);
      }
    }

    this.view.syncQtyControls();
  }

  onQtyIncr(e) {
    try {
      const c = this.view.container;
      const ctrl = e.currentTarget?.closest?.('.qty-controls') || null;
      const qtyEl = ctrl?.querySelector('.qty-input') || c?.querySelector('.qty-input');
      if (!qtyEl) return;

      const pid = this.view.currentProductId;
      const product = this.ctx.getProductSync(pid);
      const stock = this.ctx.computeStock(product);

      let cur = parseInt(qtyEl.value || '1', 10) || 1;
      const target = Math.min(stock || cur + 1, cur + 1);

      if (target > cur) {
        qtyEl.value = String(target);
        this.ctx.changeCartQty(pid, target);
      }

      this.view.syncQtyControls();
      this.ctx.log('onQtyIncr: increment', pid, '->', qtyEl?.value);
    } catch (err) {
      console.error('onQtyIncr', err);
    }
  }

  onQtyDecr(e) {
    try {
      const c = this.view.container;
      const ctrl = e.currentTarget?.closest?.('.qty-controls') || null;
      const qtyEl = ctrl?.querySelector('.qty-input') || c?.querySelector('.qty-input');
      if (!qtyEl) return;

      const pid = this.view.currentProductId;
      let cur = parseInt(qtyEl.value || '1', 10) || 1;
      const target = Math.max(0, cur - 1);
      qtyEl.value = String(target);

      if (target === 0) {
        try {
          this.ctx.removeFromCart(pid);
          this.ctx.notify(this.ctx.messages.itemRemovedFromCart, { duration: 1500 });
          this.ctx.log('onQtyDecr: removed from cart', pid);
        } catch (err) {
          console.warn('cart.remove threw', err);
        }

        window.dispatchEvent(
          new CustomEvent('cart:updated', { detail: { changedIds: [pid] } }),
        );
      } else {
        try {
          this.ctx.changeCartQty(pid, target);
        } catch (err) {
          console.warn('cart.changeQty threw', err);
        }

        if (Array.isArray(this.ctx.cart?.cart)) {
          const idx = this.ctx.cart.cart.findIndex(i => String(i.name) === String(pid));
          if (idx >= 0) {
            this.ctx.cart.cart[idx].qty = Number(target);
            this.ctx.cart.save?.();
            window.dispatchEvent(
              new CustomEvent('cart:updated', { detail: { changedIds: [pid] } }),
            );
          }
        }
      }

      this.view.syncQtyControls();
    } catch (err) {
      console.error('onQtyDecr', err);
    }
  }

  onBackClick() {
    if (window.history && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (this.view.container) this.view.container.innerHTML = '';
  }

  onCartUpdated() {
    this.view.syncQtyControls();
  }

  onBuyNowClick(e) {
    e.preventDefault();
    const c = this.view.container;
    if (!c) return;

    const pid = this.view.currentProductId;
    const product = this.ctx.getProductSync(pid);
    if (!product) return;

    const qtyEl = c.querySelector('.qty-input');
    const stock = this.ctx.computeStock(product);

    let qty = 1;
    if (qtyEl) {
      const raw = Number(qtyEl.value || 1);
      qty = Number.isFinite(raw) && raw > 0 ? raw : 1;
    }
    if (stock > 0) qty = Math.min(qty, stock);

    const buyNowItem = {
      id: product.id ?? product.productId ?? null,
      name: product.name ?? product.fullname ?? '',
      fullname: product.fullname ?? product.name ?? '',
      price: Number(product.price ?? product.product_price ?? 0),
      qty,
      picture: (() => {
        if (!product.picture) return '[]';
        if (typeof product.picture === 'string') {
          try {
            JSON.parse(product.picture);
            return product.picture;
          } catch {
            return JSON.stringify([product.picture]);
          }
        }
        if (Array.isArray(product.picture)) return JSON.stringify(product.picture);
        return '[]';
      })(),
      specs: product.specs ?? product.description ?? '',
    };

    location.hash = '#page/checkout';

    setTimeout(() => {
      if (this.ctx.shop && this.ctx.shop.checkoutPage) {
        this.ctx.shop.checkoutPage.init('#test', { buyNowItem });
      } else {
        console.warn('[ProductPage] checkoutPage не инициализирован');
      }
    }, 800);
  }

  /* ---------- related ---------- */

  async renderRelated(product) {
    const c = this.view.container;
    if (!c) return;

    const relatedRoot = c.querySelector('[data-related]');
    if (!relatedRoot) return;

    try {
      const all = Array.isArray(this.ctx.productService.getProducts())
        ? this.ctx.productService.getProducts()
        : [];

      let related = all.filter(
        p => p && p.id != product.id && p.category === product.category,
      );
      if (!related.length) {
        related = all.filter(p => p && p.id != product.id);
      }

      related = related.slice(0, this.ctx.opts.relatedLimit);

      await this.view.renderCardsVertical(related, relatedRoot);

      related.forEach(p => {
        const isFav = this.ctx.favorites?.isFavorite?.(String(p.id)) ?? false;
        this.view.updateProductCardFavState(relatedRoot, p.id, isFav);
      });
    } catch (err) {
      console.warn('renderRelated failed', err);
    }
  }
}