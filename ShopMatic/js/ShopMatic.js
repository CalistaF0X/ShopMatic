import { Card } from './modules/Card.js';
import { ProductService } from './modules/ProductService.js';
import { StorageService } from './modules/StorageService.js';
import { Notifications } from './modules/Notifications.js';
import { Renderer } from './modules/Renderer.js';
import { CartModule } from './modules/CartModule.js';
import { FavoritesModule } from './modules/FavoritesModule.js';
import { WishlistModule } from './modules/WishlistModule.js';
import { ProductPage } from './modules/ProductPage.js';
import { ViewedItemsModule } from './modules/ViewedItemsModule.js';
import { Catalog } from './modules/Catalog.js';
import { CheckoutPage } from './modules/CheckoutPage.js';

/**
 * ShopMatic orchestrates all modules of the shop and exposes a high level API
 * for cart management, favourites and product navigation. The actual product
 * listing, filtering and rendering logic is delegated to the Catalog class
 * which encapsulates all DOM events related to searching and sorting.
 */
export class ShopMatic {
  /**
   * Create a new ShopMatic instance.
   * @param {Object} foxEngine Host engine providing template loading and routing.
   * @param {Object} opts Optional configuration overrides.
   */
  constructor(foxEngine, opts = {}) {
    if (!foxEngine) throw new Error('foxEngine is required');
    this.foxEngine = foxEngine;
    // Merge default options with any overrides
    this.opts = Object.assign({
      itemsId: 'items',
      categoryFilterId: 'categoryFilter',
      brandFilterId: 'brandFilter',
      searchId: 'search',
      sortId: 'sort',
      searchBtnId: 'searchBtn',
      cartGridId: 'cart-grid',
	  checkoutGridId: 'checkout-grid',
      cartCountInlineId: 'cart-count-inline',
      cartTotalId: 'cart-total',
      miniCartTotalId: 'miniCartTotal',
      miniCartListId: 'miniCart',
      headerCartNumId: 'cartNum',
      miniCartHeaderTitleId: 'miniCartHeaderTitle',
      productsCountId: 'productsCount',
      storageKey: 'gribkov_cart_v1',
      favStorageKey: 'gribkov_favs_v1',
      notificationDuration: 3000,
      debug: false
    }, opts);
    // Core modules
    this.productService = new ProductService(this.foxEngine);
    this.card = new Card(this);
    this.storage = new StorageService(this, { storageKey: this.opts.storageKey, favStorageKey: this.opts.favStorageKey });
    this.notifications = new Notifications();
    // Favourites with central sync
    this.favorites = new FavoritesModule({ storage: this.storage, opts: { sync: false } });
    this.renderer = new Renderer({ foxEngine: this.foxEngine, productService: this.productService, favorites: this.favorites });
    this.cart = new CartModule({
      storage: this.storage,
      productService: this.productService,
      renderer: this.renderer,
      notifications: this.notifications,
      favorites: this.favorites,
      opts: this.opts
    });
    this.productPage = new ProductPage(this);
	
	
	this.viewedModule = new ViewedItemsModule({
      storageService: this.storage,
      renderer: null,
      container: '#viewed-items'
    });
	
    // Wishlist module (constructed lazily in init)
    this.wishlistModule = null;
    // Create catalog for product list and filters
    this.catalog = new Catalog({
      shop: this,
      rootId: this.opts.itemsId,
      catFilterId: this.opts.categoryFilterId,
      brandFilterId: this.opts.brandFilterId,
      searchId: this.opts.searchId,
      sortId: this.opts.sortId,
      searchBtnId: this.opts.searchBtnId,
      productsCountId: this.opts.productsCountId
    });
	
	this.checkoutPage = new CheckoutPage(this.cart);
    // Subscription handle for favourites updates
    this._favsUnsub = null;
    // Bound handlers for global events
    this._bound = {
      onStorage: this._onStorageEvent.bind(this),
      onCartUpdated: this._onCartUpdated.bind(this)
    };
    // Delegation handlers registry (unused now)
    this._delegationHandlers = new WeakMap();
    // DOM refs (for backwards compatibility; assigned after catalog.init())
    this.root = null;
    this.catFilter = null;
    this.brandFilter = null;
    this.search = null;
    this.sort = null;
    this.searchBtn = null;
    this.productsCount = null;
  }

  /**
   * Initialise all modules, load persisted state, bind events and perform
   * initial rendering. This should be called once after constructing the
   * ShopMatic instance.
   */
  async init() {
    // Collect cart related DOM elements
    const cartGridEl = document.getElementById(this.opts.cartGridId);
    const cartCountInlineEl = document.getElementById(this.opts.cartCountInlineId);
    const cartTotalEl = document.getElementById(this.opts.cartTotalId);
    const miniCartTotalEl = document.getElementById(this.opts.miniCartTotalId);
    const miniCartListEl = document.getElementById(this.opts.miniCartListId);
    const headerCartNumEl = document.getElementById(this.opts.headerCartNumId);
    const miniCartHeaderTitleEl = document.getElementById(this.opts.miniCartHeaderTitleId);
    // Pass references to cart module
    try {
      this.cart.setDomRefs({
        headerCartNum: headerCartNumEl,
        miniCartList: miniCartListEl,
        miniCartHeaderTitle: miniCartHeaderTitleEl,
        cartGrid: cartGridEl,
        cartCountInline: cartCountInlineEl,
        cartTotal: cartTotalEl,
        miniCartTotal: miniCartTotalEl
      });
    } catch (err) {
      console.warn('cart.setDomRefs failed', err);
    }
    // Initialise catalog (loads products, categories & brands, binds filter events, renders)
    await this.catalog.init();
    // Copy references from catalog for backward compatibility
    this.root = this.catalog.root;
    this.catFilter = this.catalog.catFilter;
    this.brandFilter = this.catalog.brandFilter;
    this.search = this.catalog.search;
    this.sort = this.catalog.sort;
    this.searchBtn = this.catalog.searchBtn;
    this.productsCount = this.catalog.productsCount;
    // Load persisted favourites and cart items
    try { await this.favorites.loadFromStorage(); } catch (e) { console.warn('favorites.loadFromStorage failed', e); }
    try { await this.cart.loadFromStorage(); } catch (e) { console.warn('cart.loadFromStorage failed', e); }
    // Sync UI to loaded favourites
    this._updateWishUI();
    // Subscribe to favourites changes
    try {
      this._favsUnsub = this.favorites.subscribe(() => {
        if (this.catalog && this.catalog.root) {
          const allCards = this.catalog.root.querySelectorAll('[data-product-id]');
          allCards.forEach(card => {
            const pid = card.getAttribute('data-product-id');
            this.renderer.updateProductCardFavState(this.catalog.root, pid, this.favorites.isFavorite(pid));
          });
        }
        this._updateWishUI();
      });
    } catch (err) {
      console.warn('favorites.subscribe failed', err);
    }
    // Bind global events
    window.addEventListener('storage', this._bound.onStorage);
    window.addEventListener('cart:updated', this._bound.onCartUpdated);
    // Delegated card actions (favourites toggling, add to cart)
    this.card._bindCardDelegation();
    // Ensure quantity controls reflect initial cart state
    this._syncAllCardsControls();
    // Instantiate wishlist module and load viewed items
    this.wishlistModule = new WishlistModule();
    await this.viewedModule.load();
    // Update cart UI after loading persisted state
    await this.cart.updateCartUI();
  }

  /**
   * Destroy all event listeners and subordinate modules. Should be called
   * when the ShopMatic instance is no longer used.
   */
  destroy() {
    window.removeEventListener('storage', this._bound.onStorage);
    window.removeEventListener('cart:updated', this._bound.onCartUpdated);
    // Destroy catalog and unbind filter events
    if (this.catalog && typeof this.catalog.destroy === 'function') {
      try { this.catalog.destroy(); } catch (_) {}
    }
    // Unsubscribe favourites
    if (typeof this._favsUnsub === 'function') {
      try { this._favsUnsub(); } catch (e) { /* ignore */ }
      this._favsUnsub = null;
    }
    // Destroy modules
    if (this.favorites && typeof this.favorites.destroy === 'function') {
      try { this.favorites.destroy(); } catch (e) { /* ignore */ }
    }
    if (this.cart && typeof this.cart.destroy === 'function') {
      try { this.cart.destroy(); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Update the wish counter in the UI to reflect the number of favourite
   * items. If there are none the element is hidden.
   */
  _updateWishUI() {
    try {
      const wishEl = document.getElementById('wishNum');
      if (!wishEl) return;
      const count = (this.favorites && typeof this.favorites.getCount === 'function') ? this.favorites.getCount() : 0;
      wishEl.style.display = count > 0 ? 'inline-flex' : 'none';
      wishEl.textContent = String(count);
    } catch (e) {
      console.warn('_updateWishUI failed', e);
    }
  }

  /**
   * Synchronise quantity controls and disabled state across all cards. Delegates
   * to Card module for per-card logic. Accepts an optional container; defaults
   * to the catalog root.
   * @param {HTMLElement} container Optional container to sync controls within.
   */
  _syncAllCardsControls(container = null) {
    const root = container || (this.catalog && this.catalog.root);
    if (!root) return;
    const cards = Array.from(root.querySelectorAll('[data-product-id]'));
    cards.forEach(card => this.card._syncCardControlsState(card));
  }

  /**
   * Handle updates from storage. Re-sync cart/favourites and refresh UI.
   * @param {StorageEvent} e Storage event
   */
  _onStorageEvent(e) {
    if (!e) return;
    // Reload both cart and favourites if storage cleared
    if (e.key === null) {
      try { this.cart.loadFromStorage(); } catch (_) {}
      try { this.favorites.loadFromStorage(); } catch (_) {}
      this._updateWishUI();
      this._syncAllCardsControls();
      return;
    }
    // Cart storage changed
    if (e.key === this.opts.storageKey) {
      try { this.cart.loadFromStorage(); } catch (_) {}
      try { this.cart.updateCartUI(); } catch (_) {}
      this._syncAllCardsControls();
    }
    // Favourites storage changed
    if (e.key === this.opts.favStorageKey) {
      try { this.favorites.loadFromStorage(); } catch (_) {}
      if (this.catalog && this.catalog.root) {
        const allCards = this.catalog.root.querySelectorAll('[data-product-id]');
        allCards.forEach(card => {
          const pid = card.getAttribute('data-product-id');
          this.renderer.updateProductCardFavState(this.catalog.root, pid, this.favorites.isFavorite(pid));
        });
      }
      this._updateWishUI();
    }
  }

  /**
   * React to cart updates by refreshing quantity controls for affected products.
   * Expects event.detail.changedIds array of ids that changed.
   * @param {CustomEvent} e Event emitted from CartModule
   */
  _onCartUpdated(e) {
    try {
      const detail = e && e.detail ? e.detail : {};
      const changedIds = Array.isArray(detail.changedIds) ? detail.changedIds : [];
      if (!this.catalog || !this.catalog.root || !changedIds.length) {
        this._syncAllCardsControls();
        return;
      }
      changedIds.forEach(id => {
        if (!id) return;
        const selector = `[data-product-id="${(typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(id)) : String(id).replace(/\"/g, '\\\"')}"]`;
        const card = this.catalog.root.querySelector(selector);
        if (card) this.card._syncCardControlsState(card);
      });
    } catch (err) {
      this._syncAllCardsControls();
    }
  }

  /**
   * Navigate to a product page. Sets the location hash and delegates to
   * ProductPage for rendering.
   * @param {string} product ID of the product to show.
   * @param {HTMLElement|string} block Container in which to render.
   */
  openProductPage(product, block) {
    this.foxEngine.loadTemplates();
    location.hash = '#product/' + product;
    this.productPage.render(product, block);
  }

  /* ================== Public API (delegates) ================== */

  addToCart(id, qty = 1) {
    const desired = Math.max(1, parseInt(qty || 1, 10));
    const available = this.card._computeAvailableStock(id);
    if (available <= 0) {
      this.notifications.show('Невозможно добавить: нет доступного остатка.', { duration: this.opts.notificationDuration });
      this._syncAllCardsControls();
      return false;
    }
    const toAdd = Math.min(desired, available);
    if (toAdd < desired) {
      this.notifications.show(`Добавлено ${toAdd} шт. (доступно ${available}).`, { duration: this.opts.notificationDuration });
    }
    return this.cart.add(id, toAdd);
  }
  changeQty(id, qty) { return this.cart.changeQty(id, qty); }
  
  isFavorite(id) { return this.favorites.isFavorite ? this.favorites.isFavorite(id) : false; }
  
  toggleFavorite(id) { return this.favorites.toggle ? this.favorites.toggle(id) : false; }
  
  getFavorites() {
    const ids = (this.favorites.getAll ? this.favorites.getAll() : (this.favorites.exportToArray ? this.favorites.exportToArray() : []));
    return Array.isArray(ids) ? ids.map(id => this.productService.findById(id)).filter(Boolean) : [];
  }
  removeCartItem(id) {
    this.cart.remove(id);
  }
  
  async loadCatalog(brand = "", category = ""){
	  await this.catalog.loadCatalog({request: {brand: brand, category: category}});
  }
  
  removeWishlistItem(id) {
    if (this.wishlistModule && typeof this.wishlistModule.removeFromFav === 'function') {
      this.wishlistModule.removeFromFav(id);
    }
  }

  /**
   * Render the cart page. Optionally resets cart DOM references.
   */
  renderCartPage() {
    const cartGridEl = document.getElementById(this.opts.cartGridId);
    const cartCountInlineEl = document.getElementById(this.opts.cartCountInlineId);
    const cartTotalEl = document.getElementById(this.opts.cartTotalId);
    this.cart.setDomRefs({
      cartGrid: cartGridEl,
      cartCountInline: cartCountInlineEl,
      cartTotal: cartTotalEl
    });
    this.cart.loadFromStorage();
    this.cart.updateCartUI();
    this._syncAllCardsControls();
  }

  /**
   * Wrapper around Catalog.applyFilters for compatibility with legacy code.
   */
  async applyFilters() {
    return this.catalog.applyFilters();
  }

  // Legacy handlers preserved as wrappers around applyFilters. They are not bound
  // in the new architecture but retained for external callers if needed.
  _onSearchInput() { this.applyFilters(); }
  _onCatChange() { this.applyFilters(); }
  _onBrandChange() { this.applyFilters(); }
  _onSortChange() { this.applyFilters(); }
  _onSearchBtn() { this.applyFilters(); }
}