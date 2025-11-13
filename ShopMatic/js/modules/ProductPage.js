/*
 * ProductPage - optimized and improved.
 *
 * This module provides a modernized implementation of a product detail page. It
 * refactors the original code to use modern JavaScript features such as
 * destructuring, optional chaining, arrow functions, and default parameters.
 * Repetitive logic has been extracted into helper methods, and error
 * handling has been streamlined. The objective is to retain full functionality
 * while improving readability and maintainability.
 */

import { makeSpecHtmlPreview } from './utils.js';
import { Gallery } from './Gallery.js';

// Default messages for notifications, labels and badges used by ProductPage. These can be
// overridden via the `opts.messages` parameter when constructing a ProductPage.
const DEFAULT_MESSAGES = {
  // Notification shown when attempting to add to cart but stock is zero
  addToCartDisabled: 'Невозможно добавить: нет доступного остатка.',
  // Notification shown when an unexpected error occurs while adding to cart
  addToCartError: 'Ошибка при добавлении в корзину',
  // Notification shown after toggling favourite state to "added"
  favoriteAdded: 'Товар добавлен в избранное',
  // Notification shown after toggling favourite state to "removed"
  favoriteRemoved: 'Товар удалён из избранного',
  // Shown when wishlist module is missing
  wishlistNotConfigured: 'Вишлист не настроен',
  // Notification shown after updating the wishlist
  wishlistUpdated: 'Обновлено в вишлисте',
  // Template for notifying maximum available quantity; {count} will be replaced with a number
  maxAvailableTemplate: 'Максимум доступно: {count}',
  // Notification shown when an item is removed from the cart
  itemRemovedFromCart: 'Товар удалён из корзины',
  // Favourite button label when item is not in favourites
  favLabelAdd: '<i class="fa-heart fa-solid"></i> В избранное',
  // Favourite button label when item is in favourites
  favLabelIn: '<i class="fa-heart fa-solid active"></i> В избранном',
  // Wishlist button label when item is not in wishlist
  wishlistLabelAdd: 'В вишлист',
  // Wishlist button label when item is in wishlist
  wishlistLabelIn: 'В вишлисте',
  // Badge shown when product is in stock
  badgeInStock: 'В наличии',
  // Badge shown when product is on order/out of stock
  badgeOutOfStock: 'Под заказ',
  // Label for the "Add to cart" button
  addToCartButton: 'В Корзину',
  // Label for the button that navigates to the cart
  goToCartButton: 'Корзина'
};

export class ProductPage {
  constructor(shop, opts = {}) {
    if (!shop) throw new Error('ProductPage requires ShopMatic instance');
    // Destructure frequently used services from shop
    const {
      productService,
      cart,
      favorites,
      renderer,
      notifications,
      wishlistModule: wishlist,
    } = shop;
    this.shop = shop;
    this.productService = productService;
    this.cart = cart;
    this.favorites = favorites;
    this.renderer = renderer;
    this.notifications = notifications;
    this.wishlist = wishlist || null;

    // Merge default options with provided options. Additional config
    // parameters can be passed through opts.messages and opts.debug.
    const {
      messages = {},
      debug = false,
      ...rest
    } = opts;

    this.opts = {
      templateId: null,
      relatedLimit: 6,
      cardTemplateKey: 'cardVertical',
      ...rest,
    };

    // Store messages and debug flag. Messages override the defaults defined at
    // module top. Debug enables verbose logging for this class.
    this.messages = Object.assign({}, DEFAULT_MESSAGES, messages);
    this.debug = !!debug;

    // WeakMap to manage timers for the stripe animation
    this._stripeTimers = new WeakMap();
    this.container = null;
    this.currentProductId = null;

    // Bound event handlers
    this._bound = {
      onAddClick: this._onAddClick.bind(this),
      onFavClick: this._onFavClick.bind(this),
      onQtyInput: this._onQtyInput.bind(this),
      onQtyIncr: this._onQtyIncr.bind(this),
      onQtyDecr: this._onQtyDecr.bind(this),
      onWishlistClick: this._onWishlistClick.bind(this),
      onBackClick: this._onBackClick.bind(this),
      onCartUpdated: this._onCartUpdated.bind(this),
    };
  }

  /**
   * Internal logger for ProductPage. When debug is enabled, messages passed
   * to this method are forwarded to the shop's logger if available, or to
   * console.debug otherwise. This helper helps avoid scattering debug
   * conditionals throughout the code.
   * @param {...any} args
   */
  _log(...args) {
    if (!this.debug) return;
    try {
      const msg = args.join(' ');
      this.shop?.foxEngine?.log?.(`ProductPage: ${msg}`, 'DEBUG');
    } catch (_) {
      // eslint-disable-next-line no-console
      console.debug('ProductPage:', ...args);
    }
  }

  /**
   * Initialize the product image gallery. This should be called after the
   * DOM has rendered the gallery root element. It uses the Gallery class to
   * display a carousel of product images.
   */
  _initGallery() {
    if (!this.container) return;
    const galleryRoot = this.container.querySelector('.product-gallery');
    if (!galleryRoot) return;
    // Attempt to parse the product's pictures from JSON stored in the product
    // object. If parsing fails, fall back to an empty array.
    const product = this.productService.findById(this.currentProductId) ?? {};
    let photos = [];
    try {
      photos = Array.isArray(product.images)
        ? product.images.slice()
        : JSON.parse(product.picture || '[]');
    } catch (_) {
      photos = [];
    }
    // Initialize the Gallery instance
    try {
      this.gallery = new Gallery(galleryRoot, photos);
    } catch (err) {
      console.warn('Gallery initialization failed', err);
    }
  }

  /**
   * Render the product page into the specified container. This method handles
   * loading the product data, rendering the template, and wiring up UI
   * interactions. It also renders related products.
   *
   * @param {string|number} productId - The unique identifier of the product
   * @param {HTMLElement|string} container - DOM element or CSS selector where
   *   the product page should be rendered
   */
  async render(productId, container = this.shop.foxEngine.replaceData.contentBlock) {
    // Ensure the page template is loaded only once
    if (!this.pageTemplate) {
      const tplPath = `/templates/${this.shop.foxEngine.replaceData.template}/foxEngine/product/productPage.tpl`;
      this.pageTemplate = await this.shop.foxEngine.loadTemplate(tplPath);
    }
    // Resolve container element from selector or direct reference
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) throw new Error('container element required');
    this.container = el;
    this.currentProductId = String(productId);

    // Attempt to fetch the product data
    this._log('render: fetching product', productId);
    let product = null;
    try {
      product = await this.productService.fetchById(productId);
    } catch {
      product = null;
    }
    // If the product is not found, render a not-found page and exit
    if (!product) {
      this._log('render: product not found', productId);
      await this._renderNotFound();
      return;
    }
    // Synchronize cart from storage if possible
    try {
      this.cart?.loadFromStorage?.();
    } catch (_) {}

    // Build HTML for the product page using the product data
    let html;
    try {
      html = await this._buildHtml(product);
      this.container.innerHTML = html;
      this._log('render: HTML injected into container', productId);
    } catch (e) {
      console.error('_buildHtml error', e);
      await this._renderNotFound();
      return;
    }
    // Update UI state and bind event listeners
    try {
      this._syncFavButton();
      this._syncQtyControls();
      this._syncWishlistButton();
      this._bindListeners();
    } catch (e) {
      console.error('UI sync/bind error', e);
    }
    // Render related products
    try {
      await this._renderRelated(product);
    } catch (e) {
      console.error('_renderRelated error', e);
    }
  }

  /**
   * Remove event listeners and clear the current page state. Should be called
   * when navigating away from the product page to avoid memory leaks.
   */
  destroy() {
    if (!this.container) return;
    this._unbindListeners();
    this.container = null;
    this.currentProductId = null;
  }

  /**
   * Render a fallback page when the product is not found. This method also
   * binds the back button to allow navigation to the previous page.
   */
  async _renderNotFound() {
    if (!this.container) return;
    const tplPath = `/templates/${this.shop.foxEngine.replaceData.template}/foxEngine/product/notFound.tpl`;
    this.container.innerHTML = await this.shop.foxEngine.loadTemplate(tplPath);
    const back = this.container.querySelector('[data-action="back"]');
    back?.addEventListener('click', this._bound.onBackClick);
  }

  /**
   * Build the HTML for the product page based on the provided product data.
   * This method normalizes image data, assembles template data, and then
   * performs token replacement using the loaded template. If the host engine
   * supports its own replacement function, it will be used; otherwise
   * manual replacement is performed.
   *
   * @param {Object} p - Product data
   * @returns {string} - HTML string
   */
  async _buildHtml(p) {
    // Mark product as viewed in storage (best effort)
    try {
      this.shop.storage.addViewed?.(p);
    } catch (_) {}
    // Determine quantity from cart if already added
    const cartItem = Array.isArray(this.cart?.cart)
      ? this.cart.cart.find(item => String(item.name) === String(p.name))
      : null;
    const qtyFromCart = cartItem ? Number(cartItem.qty || 0) : 0;
    // Normalize photos/images array
    const photos = Array.isArray(p.images)
      ? p.images.slice()
      : p.image
        ? [p.image]
        : p.picture
          ? [p.picture]
          : [];
    const mainImage = photos[0] ?? p.picture ?? p.image ?? '';
    // Prebuild thumbs HTML for image gallery
    const thumbsHtml = photos.length
      ? photos
          .map((src, i) => {
            const esc = this._escapeAttr(src);
            const active = i === 0 ? ' active' : '';
            return `<button class="thumb-btn${active}" data-thumb-index="${i}" aria-label="thumb-${i}"><img src="${esc}" alt="" loading="lazy" /></button>`;
          })
          .join('')
      : '';
    // Ensure categories are loaded (non-blocking)
    try {
      await this.productService.fetchCategories?.();
    } catch (_) {}
    // Assemble template data with safe defaults and formatting
    const tplData = {
      name: p.name ?? '',
      fullname: p.title ?? p.name ?? p.fullname ?? '',
      price: this._formatPrice(p.price),
      oldPrice: p.oldPrice ? this._formatPrice(p.oldPrice) : '',
      short: p.short ?? '',
      long: p.long ?? '',
      qty: qtyFromCart > 0 ? qtyFromCart : 1,
      mainImage,
      images: photos,
      picture: p.picture ?? mainImage,
      discountPercent: '', // reserved for future features
      thumbs: thumbsHtml,
      brandName: p.brandName ?? '',
      categoryName: p.categoryName ? `<small>${p.categoryName}</small>` : '',
      brand: p.brand ?? '',
      category: p.category ?? '',
      specs: typeof makeSpecHtmlPreview === 'function' ? makeSpecHtmlPreview(p.specs || {}) : '',
    };
    // Attempt to use the host engine's template replacement if available
    const fox = this.shop.foxEngine;
    try {
      if (this.opts.templateId) {
        const t = document.getElementById(this.opts.templateId);
        if (t?.content) {
          const raw = t.innerHTML || '';
          return this._replaceTokens(raw, tplData);
        }
      }
      if (fox?.replaceTextInTemplate) {
        const replaced = await fox.replaceTextInTemplate(this.pageTemplate, tplData);
        if (typeof replaced === 'string' && replaced.length) return replaced;
      }
    } catch (e) {
      console.warn('ProductPage: template replacement failed', e);
    }
    // Manual replacement fallback
    const pictureToken = this._escapeAttr(tplData.picture || tplData.mainImage);
    const nameToken = this._escapeAttr(tplData.name);
    const fullnameHtml = escapeHtml(tplData.fullname);
    const priceToken = tplData.price || '';
    const oldPriceToken = tplData.oldPrice || '';
    const stockToken = String(p.stock ?? p.qty ?? 0);
    const qtyToken = String(tplData.qty);
    const specsHtml = tplData.specs || '';
    const thumbsToken = tplData.thumbs || '';
    const noticesToken = '';
    return this.pageTemplate
      .replace(/\{name\}/g, nameToken)
      .replace(/\{fullname\}/g, fullnameHtml)
      .replace(/\{picture\}/g, pictureToken)
      .replace(/\{price\}/g, priceToken)
      .replace(/\{oldPrice\}/g, oldPriceToken)
      .replace(/\{stock\}/g, stockToken)
      .replace(/\{qty\}/g, qtyToken)
      .replace(/\{specs\}/g, specsHtml)
      .replace(/\{thumbs\}/g, thumbsToken)
      .replace(/\{notices\}/g, noticesToken);
  }

  /**
   * Bind DOM event listeners to UI controls on the product page. Listeners are
   * bound to specific selectors and use the pre-bound handler functions. The
   * gallery is initialized after thumbs are rendered.
   */
  _bindListeners() {
    if (!this.container) return;
    // Helper to add event listener if element exists
    const addListener = (selector, event, handler) => {
      const el = this.container.querySelector(selector);
      if (el) el.addEventListener(event, handler);
    };
    addListener('[data-action="add-to-cart"], .add-to-cart, .btn-yellow', 'click', this._bound.onAddClick);
    addListener('.fav-toggle', 'click', this._bound.onFavClick);
    addListener('.wishlist-toggle', 'click', this._bound.onWishlistClick);
    addListener('.qty-input', 'input', this._bound.onQtyInput);
    this.container.querySelectorAll('.qty-incr').forEach(btn => btn.addEventListener('click', this._bound.onQtyIncr));
    this.container.querySelectorAll('.qty-decr').forEach(btn => btn.addEventListener('click', this._bound.onQtyDecr));
    addListener('[data-action="back"]', 'click', this._bound.onBackClick);
    // Delegate thumb button clicks to update main image
    this.container.querySelectorAll('.thumb-btn').forEach(btn =>
      btn.addEventListener('click', ev => {
        const idx = parseInt(ev.currentTarget.getAttribute('data-thumb-index'), 10) || 0;
        const product = this.productService.findById(this.currentProductId) || {};
        const photos = Array.isArray(product.images) ? product.images : [];
        const src = photos[idx];
        const main = this.container.querySelector('.product-main-img');
        if (main && src) main.src = src;
      })
    );
    // Size buttons toggle active class
    this.container.querySelectorAll('.size-btn').forEach(btn =>
      btn.addEventListener('click', ev => {
        this.container.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
        ev.currentTarget.classList.add('active');
      })
    );
    // Listen for cart update event
    window.addEventListener('cart:updated', this._bound.onCartUpdated);
    // Initialize gallery for rendered thumbs
    try {
      this._initGallery();
    } catch (e) {
      console.warn('gallery init failed', e);
    }
  }

  /**
   * Unbind all event listeners from the DOM. Listeners are removed to prevent
   * memory leaks and stale state when leaving the product page.
   */
  _unbindListeners() {
    if (!this.container) return;
    const removeListener = (selector, event, handler) => {
      const el = this.container.querySelector(selector);
      if (el) el.removeEventListener(event, handler);
    };
    removeListener('[data-action="add-to-cart"], .add-to-cart, .btn-yellow', 'click', this._bound.onAddClick);
    removeListener('.fav-toggle', 'click', this._bound.onFavClick);
    removeListener('.wishlist-toggle', 'click', this._bound.onWishlistClick);
    removeListener('.qty-input', 'input', this._bound.onQtyInput);
    this.container.querySelectorAll('.qty-incr').forEach(btn => btn.removeEventListener('click', this._bound.onQtyIncr));
    this.container.querySelectorAll('.qty-decr').forEach(btn => btn.removeEventListener('click', this._bound.onQtyDecr));
    removeListener('[data-action="back"]', 'click', this._bound.onBackClick);
    // Remove thumb and size listeners by cloning nodes (fast reset)
    this.container.querySelectorAll('.thumb-btn').forEach(t => t.replaceWith(t.cloneNode(true)));
    this.container.querySelectorAll('.size-btn').forEach(b => b.replaceWith(b.cloneNode(true)));
    window.removeEventListener('cart:updated', this._bound.onCartUpdated);
  }

  // Event handlers
  _onAddClick() {
    const pid = this.currentProductId;
    if (!pid) return;
    try {
      const qtyEl = this.container.querySelector('.qty-input');
      const qty = Math.max(1, parseInt(qtyEl?.value || '1', 10));
      const available = this.cart && typeof this.cart._computeAvailableStock === 'function'
        ? this.cart._computeAvailableStock(pid)
        : this.productService.findById(pid)?.stock || 0;
      if (available <= 0) {
        this.notifications.show('Невозможно добавить: нет доступного остатка.', { duration: 3000 });
        return;
      }
      const toAdd = Math.min(qty, available);
      this.cart?.add?.(pid, toAdd);
      this._syncQtyControls();
    } catch (err) {
      console.error('_onAddClick error', err);
      this.notifications.show('Ошибка при добавлении в корзину', { duration: 3000 });
    }
  }

  _onFavClick() {
    try {
      const pid = this.currentProductId;
      if (!pid || !this.favorites?.toggle) return;
      this.favorites.toggle(pid);
      this._syncFavButton();
      const isFav = this.favorites.isFavorite?.(pid);
      this.notifications.show(isFav ? 'Товар добавлен в избранное' : 'Товар удалён из избранного', { duration: 1500 });
    } catch (err) {
      console.warn(err);
    }
  }

  _onWishlistClick() {
    const pid = this.currentProductId;
    if (!pid) return;
    if (!this.wishlist) {
      this.notifications.show('Вишлист не настроен', { duration: 1400 });
      return;
    }
    try {
      if (this.wishlist.toggle) this.wishlist.toggle(pid);
      else if (this.wishlist.add) this.wishlist.add(pid);
      this._syncWishlistButton();
      this.notifications.show('Обновлено в вишлисте', { duration: 1200 });
    } catch (err) {
      console.warn(err);
    }
  }

  _onQtyInput(e) {
    const qty = parseInt(e.target.value || '1', 10) || 1;
    const pid = this.currentProductId;
    const product = this.productService.findById(pid);
    const available = product ? product.stock ?? product.qty ?? 0 : 0;
    if (qty > available) {
      e.target.value = String(available || 1);
      this.notifications.show(`Максимум доступно: ${available}`, { duration: 1400 });
    }
    const cartItem = Array.isArray(this.cart?.cart)
      ? this.cart.cart.find(i => String(i.name) === String(pid))
      : null;
    if (cartItem && typeof this.cart?.changeQty === 'function') {
      const newQty = Math.max(1, Math.min(available || 1, parseInt(e.target.value || '1', 10)));
      try {
        this.cart.changeQty(pid, newQty);
      } catch (err) {
        console.warn(err);
      }
    }
    this._syncQtyControls();
  }

  _onQtyIncr(e) {
    try {
      const ctrl = e.currentTarget?.closest?.('.qty-controls') || null;
      const qtyEl = ctrl?.querySelector('.qty-input') || this.container.querySelector('.qty-input');
      if (!qtyEl) return;
      const pid = this.currentProductId;
      const product = this.productService.findById(pid);
      const stock = product ? product.stock ?? product.qty ?? 0 : 0;
      let cur = parseInt(qtyEl.value || '1', 10) || 1;
      const target = Math.min(stock || cur + 1, cur + 1);
      if (target > cur) {
        qtyEl.value = String(target);
        this.cart?.changeQty?.(pid, target);
      }
      this._syncQtyControls();
      this._log('_onQtyIncr: increment qty', pid, 'new qty', qtyEl?.value);
    } catch (err) {
      console.error('_onQtyIncr', err);
    }
  }

  _onQtyDecr(e) {
    try {
      const ctrl = e.currentTarget?.closest?.('.qty-controls') || null;
      const qtyEl = ctrl?.querySelector('.qty-input') || this.container.querySelector('.qty-input');
      if (!qtyEl) return;
      const pid = this.currentProductId;
      let cur = parseInt(qtyEl.value || '1', 10) || 1;
      const target = Math.max(0, cur - 1);
      qtyEl.value = String(target);
      if (target === 0) {
        // Remove item from cart or local state
        try {
          if (this.cart?.remove) {
            this.cart.remove(String(pid));
          } else if (Array.isArray(this.cart?.cart)) {
            const idx = this.cart.cart.findIndex(i => String(i.name) === String(pid));
            if (idx >= 0) {
              this.cart.cart.splice(idx, 1);
              this.cart.save?.();
            }
          }
          // Notify that the item was removed from the cart using a configurable message
          this.notifications.show(this.messages.itemRemovedFromCart, { duration: 1500 });
          this._log('_onQtyDecr: item removed from cart', pid);
        } catch (err) {
          console.warn('cart.remove threw', err);
        }
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: { changedIds: [pid] } }));
      } else {
        try {
          this.cart?.changeQty?.(String(pid), Number(target));
        } catch (err) {
          console.warn('cart.changeQty threw', err);
        }
        if (Array.isArray(this.cart?.cart)) {
          const idx = this.cart.cart.findIndex(i => String(i.name) === String(pid));
          if (idx >= 0) {
            this.cart.cart[idx].qty = Number(target);
            this.cart.save?.();
            window.dispatchEvent(new CustomEvent('cart:updated', { detail: { changedIds: [pid] } }));
          }
        }
      }
      this._syncQtyControls();
    } catch (err) {
      console.error('_onQtyDecr', err);
    }
  }

  _onBackClick() {
    if (window.history && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (this.container) this.container.innerHTML = '';
  }

  _onCartUpdated() {
    this._syncQtyControls();
  }

  // Sync UI state methods

  _syncFavButton() {
    if (!this.container || !this.favorites) return;
    const btn = this.container.querySelector('.fav-toggle');
    if (!btn) return;
    const isFav = this.favorites.isFavorite?.(String(this.currentProductId)) ?? false;
    // Update favourite button label based on favourite state
    btn.innerHTML = isFav ? this.messages.favLabelIn : this.messages.favLabelAdd;
  }

  _animateStripes(btn, duration = 1800) {
    if (!btn || !(btn instanceof HTMLElement)) return;
    const timers = this._stripeTimers;
    const prev = timers.get(btn);
    if (prev) {
      clearTimeout(prev);
      timers.delete(btn);
    }
    btn.classList.add('with-stripes', 'active');
    btn.classList.remove('hidden');
    const t = setTimeout(() => {
      btn.classList.add('hidden');
      const cleanup = setTimeout(() => {
        btn.classList.remove('with-stripes', 'hidden');
        timers.delete(btn);
        clearTimeout(cleanup);
      }, 300);
      timers.delete(btn);
    }, duration);
    timers.set(btn, t);
  }

  _syncWishlistButton() {
    if (!this.container || !this.wishlist) return;
    const btn = this.container.querySelector('.wishlist-toggle');
    if (!btn) return;
    let isIn = false;
    try {
      isIn = this.wishlist.isIn?.(this.currentProductId) || this.wishlist.has?.(this.currentProductId) || false;
    } catch (_) {}
    // Update wishlist button label based on wishlist state
    btn.textContent = isIn ? this.messages.wishlistLabelIn : this.messages.wishlistLabelAdd;
  }

  _syncQtyControls() {
    if (!this.container) return;
    const pid = this.currentProductId;
    const product = this.productService.findById(pid);
    const stock = product ? Number(product.stock ?? product.qty ?? 0) : 0;
    const stockEl = this.container.querySelector('.stock-count');
    if (stockEl) stockEl.textContent = String(stock);
    const controlBar = this.container.querySelector('.qty-controls');
    const qtyEl = this.container.querySelector('.qty-input');
    const btnPlus = this.container.querySelector('.qty-incr');
    const btnMinus = this.container.querySelector('.qty-decr');
    const addBtn = this.container.querySelector('[data-action="add-to-cart"], .add-to-cart, .btn-yellow');
    const buyNowBtn = this.container.querySelector('[data-action="buy-now"]');
    // Determine quantity in cart
    const cartItem = Array.isArray(this.cart?.cart) ? this.cart.cart.find(i => String(i.name) === String(pid)) : null;
    const cartQty = cartItem ? Number(cartItem.qty || 0) : 0;
    if (qtyEl) {
      qtyEl.setAttribute('min', '1');
      qtyEl.setAttribute('max', String(Math.max(1, stock)));
      let cur = parseInt(qtyEl.value || (cartQty > 0 ? String(cartQty) : '1'), 10) || 1;
      if (cartQty > 0) {
        // If already in cart, show cart controls
        cur = cartQty;
        buyNowBtn && (buyNowBtn.style.display = 'none');
        controlBar && (controlBar.style.display = 'flex');
        if (addBtn) {
          try { addBtn.removeEventListener('click', this._bound.onAddClick); } catch (_) {}
          addBtn.onclick = () => {
            try { this.shop.foxEngine?.page?.loadPage('cart'); } catch (_) {}
          };
          addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" class="_1w4N_" width="16" height="16"><path fill="#21201F" fill-rule="evenodd" d="M0 5.752a.5.5 0 0 1 .5-.5h8.65L5.304 1.406a.5.5 0 0 1 0-.707l.342-.343a.5.5 0 0 1 .708 0L12 6.002 6.354 11.65a.5.5 0 0 1-.708 0l-.342-.343a.5.5 0 0 1 0-.707L9.15 6.752H.5a.5.5 0 0 1-.5-.5v-.5Z" clip-rule="evenodd"></path></svg> ${this.messages.goToCartButton}`;
        }
      } else {
        // Not in cart yet; show buy button
        buyNowBtn && (buyNowBtn.style.display = 'flex');
        controlBar && (controlBar.style.display = 'none');
        if (addBtn) {
          addBtn.onclick = null;
          addBtn.addEventListener('click', this._bound.onAddClick);
        addBtn.innerHTML = this.messages.addToCartButton;
        }
      }
      // Ensure quantity does not exceed stock
      if (stock <= 0) {
        qtyEl.value = '0';
        qtyEl.disabled = true;
        if (addBtn) {
          addBtn.disabled = true;
          addBtn.classList.add('disabled');
        }
      } else {
        if (cur > stock) cur = stock;
        qtyEl.value = String(cur);
        qtyEl.disabled = false;
        if (addBtn) {
          addBtn.disabled = false;
          addBtn.classList.remove('disabled');
        }
      }
    }
    try {
      const current = qtyEl ? parseInt(qtyEl.value || '1', 10) || 1 : 1;
      if (btnPlus) {
        const disablePlus = stock <= 0 || current >= stock;
        btnPlus.disabled = disablePlus;
        disablePlus ? btnPlus.setAttribute('aria-disabled', 'true') : btnPlus.removeAttribute('aria-disabled');
      }
      if (btnMinus) {
        const disableMinus = current <= 0;
        btnMinus.disabled = disableMinus;
        disableMinus ? btnMinus.setAttribute('aria-disabled', 'true') : btnMinus.removeAttribute('aria-disabled');
      }
    } catch (e) {}
  }

  async createCard(product = {}) {
    const p = product || {};
    const id = String(p.name ?? p.id ?? p.productId ?? '');
    const priceText = this._formatPrice(p.price ?? 0);
    const hasOldPrice = p.oldPrice && Number(p.oldPrice) > 0;
    // Use customizable badge text based on stock
    const badgeText = Number(p.stock) > 0 ? this.messages.badgeInStock : this.messages.badgeOutOfStock;
    const specsHtml = makeSpecHtmlPreview ? makeSpecHtmlPreview(p.specs || p.attributes || {}) : '';
    const data = {
      id,
      fullname: p.fullname ?? p.title ?? p.name ?? '',
      img: p.picture ?? p.image ?? '/assets/no-image.png',
      short: p.short ?? '',
      price: priceText,
      oldPrice: hasOldPrice ? this._formatPrice(p.oldPrice) : '',
      badgeText,
      stock: Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0,
      specsHtml,
    };
    let html = '';
    const fox = this.shop.foxEngine;
    try {
      if (fox?.templateCache?.[this.opts.cardTemplateKey]) {
        html = await fox.replaceTextInTemplate(fox.templateCache[this.opts.cardTemplateKey], data);
      }
    } catch (e) {
      fox?.log?.('ProductPage.createCard template error: ' + e, 'ERROR');
      html = '';
    }
    if (!html) {
      const escTitle = escapeHtml(data.fullname);
      const escImg = escapeHtml(data.img);
      const escPrice = escapeHtml(data.price);
      const escOld = escapeHtml(data.oldPrice);
      const escShort = escapeHtml(data.short);
      const escSpecs = data.specsHtml || '';
      html = `
        <article class="card product-card" data-product-id="${escapeHtml(id)}">
          <div class="card__media"><img src="${escImg}" alt="${escTitle}" loading="lazy"></div>
          <div class="card__body p-2">
            <h3 class="card__title small">${escTitle}</h3>
            <div class="card__price">${escPrice}${hasOldPrice ? ' <small class="old">' + escOld + '</small>' : ''}</div>
            <div class="card__short small text-muted">${escShort}</div>
            <div class="card__specs small">${escSpecs}</div>
            <div class="card__controls mt-2"><button data-role="buy" class="btn btn-sm btn-outline-primary">${this.messages.addToCartButton}</button></div>
          </div>
        </article>`;
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const node = wrapper.firstElementChild || wrapper;
    try {
      node?.setAttribute('data-product-id', String(id));
    } catch (_) {}
    return node;
  }

  async _renderCartVertical(list = [], rootEl) {
    if (!rootEl) return;
    rootEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    const cards = await Promise.all((Array.isArray(list) ? list : []).map(p => this.createCard(p)));
    for (const card of cards) {
      if (!card) continue;
      card.style.opacity = '0';
      card.style.transition = 'opacity .22s ease';
      frag.append(card);
      requestAnimationFrame(() => {
        card.style.opacity = '1';
      });
    }
    rootEl.append(frag);
  }

  updateProductCardFavState(rootEl, id, isFav) {
    if (!rootEl || !id) return;
    const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/"/g, '\\"');
    const selector = `[data-product-id="${esc}"]`;
    const card = rootEl.querySelector(selector);
    if (!card) return;
    const favBtn = card.querySelector('.fav-btn, .fav-toggle, [data-role="fav"]');
    if (!favBtn) return;
    favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    favBtn.title = isFav ? 'В избранном' : 'Добавить в избранное';
    favBtn.classList.toggle('is-fav', Boolean(isFav));
    const icon = favBtn.querySelector('i');
    if (icon) {
      icon.classList.remove('fa-regular', 'fa-solid');
      icon.classList.add(isFav ? 'fa-solid' : 'fa-regular');
      if (!icon.classList.contains('fa-heart')) icon.classList.add('fa-heart');
    }
  }

  async _renderRelated(product) {
    if (!this.container) return;
    const relatedRoot = this.container.querySelector('[data-related]');
    if (!relatedRoot) return;
    try {
      const all = Array.isArray(this.productService.getProducts()) ? this.productService.getProducts() : [];
      let related = all.filter(p => p && p.id != product.id && p.category === product.category);
      if (!related.length) related = all.filter(p => p && p.id != product.id);
      related = related.slice(0, this.opts.relatedLimit);
      await this._renderCartVertical(related, relatedRoot);
      related.forEach(p => {
        const isFav = this.favorites?.isFavorite?.(String(p.id)) ?? false;
        this.updateProductCardFavState(relatedRoot, p.id, isFav);
      });
    } catch (err) {
      console.warn('renderRelated failed', err);
    }
  }

  _replaceTokens(template, data = {}) {
    return String(template).replace(/\{\{\s*([^}]+)\s*\}\}/g, (m, key) => {
      const v = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : '';
      return v == null ? '' : String(v);
    });
  }

  _formatPrice(v) {
    if (v == null) return '';
    if (typeof v === 'number') {
      try {
        return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v);
      } catch (e) {
        return String(v);
      }
    }
    return String(v);
  }

  _escape(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _escapeAttr(str) {
    if (str == null) return '';
    return String(str).replace(/"/g, '&quot;');
  }
}

// Helper function to escape HTML in plain strings
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}