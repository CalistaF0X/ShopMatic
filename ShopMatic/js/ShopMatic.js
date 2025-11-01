import { Card } from './modules/Card.js';
import { ProductService } from './modules/ProductService.js';
import { StorageService } from './modules/StorageService.js';
import { Notifications } from './modules/Notifications.js';
import { Renderer } from './modules/Renderer.js';
import { CartModule } from './modules/CartModule.js';
import { FavoritesModule } from './modules/FavoritesModule.js';
import { WishlistModule } from './modules/WishlistModule.js';
import { ProductPage } from './modules/ProductPage.js';
import { debounce } from './modules/utils.js';

export class ShopMatic {
  constructor(foxEngine, opts = {}) {
    if (!foxEngine) throw new Error('foxEngine is required');
    this.foxEngine = foxEngine;
    this.opts = Object.assign({
      itemsId: 'items',
      categoryFilterId: 'categoryFilter',
      brandFilterId: 'brandFilter', // <= added default id for brand select
      searchId: 'search',
      sortId: 'sort',
      searchBtnId: 'searchBtn',
      cartGridId: 'cart-grid',
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

    // modules
    this.productService = new ProductService(this.foxEngine);
    this.card = new Card(this);
    this.storage = new StorageService(this, { storageKey: this.opts.storageKey, favStorageKey: this.opts.favStorageKey });
    this.notifications = new Notifications();

    // disable auto-sync inside FavoritesModule (we handle storage events centrally)
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

    // DOM refs (populated in init)
    this.root = null;
    this.catFilter = null;
    this.brandFilter = null; // <= brand select ref
    this.search = null;
    this.sort = null;
    this.searchBtn = null;
    this.productsCount = null;

    // subscription handle for favorites
    this._favsUnsub = null;

    // delegation handlers (will be set in _bindCardDelegation)
    this._delegationHandler = null;
    this._qtyInputHandler = null;

    // bound handlers
    this._bound = {
      onStorage: this._onStorageEvent.bind(this),
      onSearchInput: debounce(this._onSearchInput.bind(this), 300),
      onCatChange: this._onCatChange.bind(this),
      onBrandChange: this._onBrandChange.bind(this), // <= brand change handler
      onSortChange: this._onSortChange.bind(this),
      onSearchBtn: this._onSearchBtn.bind(this),
      onCartUpdated: this._onCartUpdated.bind(this)
    };

    this.productPage = new ProductPage(this);

    // delegation handlers registry (for safe unbind by container)
    this._delegationHandlers = new WeakMap();
  }

  /* ================== Lifecycle ================== */

  async init() {
    // DOM refs
    this.root = document.getElementById(this.opts.itemsId);
    this.catFilter = document.getElementById(this.opts.categoryFilterId);
    this.brandFilter = document.getElementById(this.opts.brandFilterId); // <= get brand select
    this.search = document.getElementById(this.opts.searchId);
    this.sort = document.getElementById(this.opts.sortId);
    this.searchBtn = document.getElementById(this.opts.searchBtnId);
    const cartGridEl = document.getElementById(this.opts.cartGridId);
    const cartCountInlineEl = document.getElementById(this.opts.cartCountInlineId);
    const cartTotalEl = document.getElementById(this.opts.cartTotalId);
    const miniCartTotalEl = document.getElementById(this.opts.miniCartTotalId);
    const miniCartListEl = document.getElementById(this.opts.miniCartListId);
    const headerCartNumEl = document.getElementById(this.opts.headerCartNumId);
    const miniCartHeaderTitleEl = document.getElementById(this.opts.miniCartHeaderTitleId);
    this.productsCount = document.getElementById(this.opts.productsCountId);

    // pass DOM refs to cart module via unified API
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

    // load products and categories (moved to loadCatalog)
    try {
      // ensure brand select is available to be filled inside loadCatalog
      await this.loadCatalog({ force: false, fillCategories: true, selectEl: this.catFilter, fillBrands: true });
    } catch (err) {
      console.error('loadCatalog failed', err);
      this.notifications.show('Не удалось загрузить товары', { duration: this.opts.notificationDuration });
    }

    // load persisted state
    try { await this.favorites.loadFromStorage(); } catch (e) { console.warn('favorites.loadFromStorage failed', e); }
    try { await this.cart.loadFromStorage(); } catch (e) { console.warn('cart.loadFromStorage failed', e); }

    // ensure wish UI reflects loaded favorites
    this._updateWishUI();

    // subscribe favorites changes -> update UI (cards + wish counter)
    try {
      this._favsUnsub = this.favorites.subscribe((evt) => {
        if (this.root) {
          const allCards = this.root.querySelectorAll('[data-product-id]');
          allCards.forEach(card => {
            const pid = card.getAttribute('data-product-id');
            this.renderer.updateProductCardFavState(this.root, pid, this.favorites.isFavorite(pid));
          });
        }
        this._updateWishUI();
      });
    } catch (err) {
      console.warn('favorites.subscribe failed', err);
    }

    // bind storage events + UI events
    window.addEventListener('storage', this._bound.onStorage);
    window.addEventListener('cart:updated', this._bound.onCartUpdated);
    if (this.search) this.search.addEventListener('input', this._bound.onSearchInput);
    if (this.catFilter) this.catFilter.addEventListener('change', this._bound.onCatChange);
    if (this.brandFilter) this.brandFilter.addEventListener('change', this._bound.onBrandChange); // <= brand change listener
    if (this.sort) this.sort.addEventListener('change', this._bound.onSortChange);
    if (this.searchBtn) this.searchBtn.addEventListener('click', this._bound.onSearchBtn);

    // initial render
    await this.applyFilters();
    await this.cart.updateCartUI();

    // expose for debug (use public API)
    try {
      window._SHOPMATIC = {
        get cart() { return this._cartRef ? this._cartRef.cart : undefined; },
        products: this.productService.products,
        favs: this.favorites.getAll ? this.favorites.getAll() : []
      };
      window._SHOPMATIC._cartRef = this.cart;
    } catch (err) { /* ignore */ }

    // attach delegated UI behavior for cards in root (fav and buy)
    this.card._bindCardDelegation();

    // ensure initial controls state (disable buy when nothing available)
    this._syncAllCardsControls();
    this.wishlistModule = new WishlistModule();
  }

  destroy() {
    window.removeEventListener('storage', this._bound.onStorage);
    window.removeEventListener('cart:updated', this._bound.onCartUpdated);
    if (this.search) this.search.removeEventListener('input', this._bound.onSearchInput);
    if (this.catFilter) this.catFilter.removeEventListener('change', this._bound.onCatChange);
    if (this.brandFilter) this.brandFilter.removeEventListener('change', this._bound.onBrandChange); // <= unbind brand handler
    if (this.sort) this.sort.removeEventListener('change', this._bound.onSortChange);
    if (this.searchBtn) this.searchBtn.removeEventListener('click', this._bound.onSearchBtn);
    try {
      if (this._delegationHandler && this.root) {
        this.root.removeEventListener('click', this._delegationHandler);
      }
      if (this._qtyInputHandler && this.root) {
        this.root.removeEventListener('input', this._qtyInputHandler);
      }
    } catch (e) { /* ignore */ }
    this._delegationHandler = null;
    this._qtyInputHandler = null;

    if (typeof this._favsUnsub === 'function') {
      try { this._favsUnsub(); } catch (e) { /* ignore */ }
      this._favsUnsub = null;
    }
    if (this.favorites && typeof this.favorites.destroy === 'function') {
      try { this.favorites.destroy(); } catch (e) { /* ignore */ }
    }
    if (this.cart && typeof this.cart.destroy === 'function') {
      try { this.cart.destroy(); } catch (e) { /* ignore */ }
    }
  }

  /* ================== New: Catalog loading (moved from init) ================== */

  /**
   * Загружает каталог товаров и (опционально) наполняет селект категорий и брендов.
   *
   * args:
   *   { force = false, request = null, fillCategories = true, selectEl = null, fillBrands = false, brandSelectEl = null }
   *
   * - fillBrands: если true — попробует вызвать productService.fillBrands или выполнит fetchBrands + manual fill
   * - brandSelectEl: опциональный элемент <select> для заполнения брендов (по умолчанию this.brandFilter)
   */
  async loadCatalog({
    force = false,
    request = null,
    fillCategories = true,
    selectEl = null,
    fillBrands = false,
    brandSelectEl = null
  } = {}) {
    // defensive checks
    if (!this.productService) {
      if (this.opts.debug) console.warn('loadCatalog: productService not initialized');
      return [];
    }

    // Attempt to load products (may use request object to force fetch with params)
    try {
      await this.productService.loadProductsSimple({ force, request });
    } catch (err) {
      console.error('loadCatalog: loadProductsSimple failed', err);
      // show friendly notification but continue to try categories/brands
      try { this.notifications.show('Ошибка при загрузке товаров', { duration: this.opts.notificationDuration }); } catch (_) {}
    }

    // Optionally fill categories select and update internal category cache
    if (fillCategories) {
      const sel = selectEl || this.catFilter || null;
      try {
        await this.productService.fillCategories ? this.productService.fillCategories(sel) : this.productService.fetchCategories().then(() => {
          // if fetchCategories returned, ensure we populate the select as fallback
          if (!sel) return;
          sel.innerHTML = `<option value="">Все категории</option>`;
          const cats = this.productService.getCategories ? this.productService.getCategories() : [];
          for (const c of cats) {
            const o = document.createElement('option');
            o.value = String(c.name || c).trim();
            o.textContent = String(c.fullname || c.name || o.value).trim();
            sel.appendChild(o);
          }
        });
      } catch (err) {
        console.warn('loadCatalog: fillCategories failed', err);
      }
    }

    // Optionally fill brands select
    if (fillBrands) {
      const bSel = brandSelectEl || this.brandFilter || null;
      try {
        if (this.productService.fillBrands && typeof this.productService.fillBrands === 'function') {
          // if ProductService implements fillBrands (DOM-aware), use it
          await this.productService.fillBrands(bSel);
        } else {
          // fallback: fetchBrands() and manually populate select
          const brands = await (this.productService.fetchBrands ? this.productService.fetchBrands() : Promise.resolve([]));
          if (bSel) {
            // put an 'all' option
            bSel.innerHTML = `<option value="">Все бренды</option>`;
            // sort brands alphabetically by fullname
            const sorted = Array.isArray(brands) ? brands.slice().sort((a,b) => {
              const an = String(a.fullname ?? a.name ?? a).toLowerCase();
              const bn = String(b.fullname ?? b.name ?? b).toLowerCase();
              return an.localeCompare(bn);
            }) : [];
            for (const b of sorted) {
              try {
                const id = String(b.id ?? b.name ?? b).trim();
                if (!id) continue;
                const label = String(b.fullname ?? b.name ?? id).trim();
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = label;
                bSel.appendChild(opt);
              } catch (e) { /* ignore single brand */ }
            }
          }
        }
      } catch (err) {
        console.warn('loadCatalog: fillBrands failed', err);
      }
    }

    // return cloned product list (public API)
    try {
      return this.productService.getProducts();
    } catch (_) {
      return [];
    }
  }

  /* ================== Helpers ================== */

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

  _syncAllCardsControls(container = this.root) {
    if (!container) return;
    const cards = Array.from(container.querySelectorAll('[data-product-id]'));
    cards.forEach(card => this.card._syncCardControlsState(card));
  }

  _unbindCardDelegation(container = this.root) {
    if (!container || !this._delegationHandlers) return;
    const handlers = this._delegationHandlers.get(container);
    if (!handlers) return;
    try {
      if (handlers.clickHandler) container.removeEventListener('click', handlers.clickHandler);
      if (handlers.inputHandler) container.removeEventListener('input', handlers.inputHandler);
    } catch (e) { /* ignore */ }
    this._delegationHandlers.delete(container);
  }

  openProductPage(product, block){
    this.foxEngine.loadTemplates();
    location.hash = '#product/'+product;
    this.productPage.render(product, block);
  }

  /* ================== Storage / events ================== */

  _onStorageEvent(e) {
    if (!e) return;
    if (e.key === null) {
      try { this.cart.loadFromStorage(); } catch (err) { /* ignore */ }
      try { this.favorites.loadFromStorage(); } catch (err) { /* ignore */ }
      this._updateWishUI();
      this._syncAllCardsControls();
      return;
    }

    if (e.key === this.opts.storageKey) {
      try { this.cart.loadFromStorage(); } catch (err) { /* ignore */ }
      try { this.cart.updateCartUI(); } catch (err) { /* ignore */ }
      this._syncAllCardsControls();
    }
    if (e.key === this.opts.favStorageKey) {
      try { this.favorites.loadFromStorage(); } catch (err) { /* ignore */ }
      if (this.root) {
        const allCards = this.root.querySelectorAll('[data-product-id]');
        allCards.forEach(card => {
          const pid = card.getAttribute('data-product-id');
          this.renderer.updateProductCardFavState(this.root, pid, this.favorites.isFavorite(pid));
        });
      }
      this._updateWishUI();
    }
  }

  _onCartUpdated(e) {
    try {
      const detail = e && e.detail ? e.detail : {};
      const changedIds = Array.isArray(detail.changedIds) ? detail.changedIds : [];
      if (!this.root || !changedIds.length) {
        this._syncAllCardsControls();
        return;
      }
      changedIds.forEach(id => {
        if (!id) return;
        const selector = `[data-product-id="${(typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(id)) : String(id).replace(/"/g, '\\"')}"]`;
        const card = this.root.querySelector(selector);
        if (card) this._syncCardControlsState(card);
      });
    } catch (err) {
      this._syncAllCardsControls();
    }
  }

  /**
   * Показать сообщение в каталоге, когда нет результатов под текущие фильтры.
   * message: string (по умолчанию — русская фраза)
   */
  _renderNoResults(message = 'По текущим опциям нет товаров') {
    if (!this.root) return;
    // keep productsCount updated
    if (this.productsCount) this.productsCount.textContent = '0';

    // build accessible empty state
    const wrapper = document.createElement('div');
    wrapper.className = 'catalog-empty';

    const icon = document.createElement('div');
    icon.className = 'catalog-empty__icon';
    icon.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 6h18v2H3zm0 5h12v2H3zm0 5h6v2H3z"></path></svg>';
    icon.style.opacity = '0.6';
    icon.style.marginBottom = '8px';

    const p = document.createElement('p');
    p.className = 'catalog-empty__text';
    p.textContent = message;
    p.style.margin = '6px 0 12px';
    p.style.color = 'var(--muted)';
    p.style.fontWeight = '600';

    const hint = document.createElement('div');
    hint.className = 'catalog-empty__hint';
    hint.textContent = 'Попробуйте изменить фильтры, удалить сортировку или сбросить поиск.';
    hint.style.fontSize = '13px';
    hint.style.color = 'var(--muted)';
    hint.style.opacity = '0.9';

    wrapper.appendChild(icon);
    wrapper.appendChild(p);
    wrapper.appendChild(hint);

    // replace content of root with the message (renderer would otherwise populate)
    this.root.innerHTML = '';
    this.root.appendChild(wrapper);

    // also update favorites state on cards (there are none) and ensure controls synced
    this._syncAllCardsControls();
  }

  _clearNoResults() {
    if (!this.root) return;
    const found = this.root.querySelector('.catalog-empty');
    if (found) found.remove();
  }

  async applyFilters() {
    // get copy of products
    let list = this.productService.getProducts();
    list = Array.isArray(list) ? [...list] : [];

    // search text
    const s = (this.search && this.search.value || '').trim().toLowerCase();
    if (s) {
      list = list.filter(p => (
        String(p.fullname || p.title || p.name || '').toLowerCase().includes(s) ||
        String(p.short || '').toLowerCase().includes(s) ||
        String(p.category || '').toLowerCase().includes(s) ||
        String(p.brandName || p.brand || '').toLowerCase().includes(s)
      ));
    }

    // category filter (select.value contains category name/key as stored by ProductService)
    const c = (this.catFilter && this.catFilter.value) || '';
    if (c) list = list.filter(p => p.category === c);

    // brand filter — compare by brand id/key or by brandName if select.value stores name
    const b = (this.brandFilter && this.brandFilter.value) || '';
    if (b) {
      list = list.filter(p => {
        const bid = String(p.brand ?? p.brandId ?? p.brandKey ?? '').trim();
        const bname = String(p.brandName ?? '').trim();
        return bid === String(b) || bname === String(b);
      });
    }

    // sorting
    const so = (this.sort && this.sort.value) || '';
    if (so === 'price_asc') list.sort((a, b) => (a.price || 0) - (b.price || 0));
    if (so === 'price_desc') list.sort((a, b) => (b.price || 0) - (a.price || 0));

    if (so === 'brand_asc') {
      list.sort((a, b) => String(a.brandName ?? a.brand ?? '').localeCompare(String(b.brandName ?? b.brand ?? '')));
    }
    if (so === 'brand_desc') {
      list.sort((a, b) => String(b.brandName ?? b.brand ?? '').localeCompare(String(a.brandName ?? a.brand ?? '')));
    }

    // update count
    if (this.productsCount) this.productsCount.textContent = String(list.length);

    // если нет товаров — показать сообщение и выйти
    if (!list.length) {
      // clear any previous renderer output then show empty state
      try { this._renderNoResults('По текущим опциям нет товаров'); } catch (e) { this._log('render no results failed', e); }
      return;
    }

    // есть результаты — очистим сообщение и отрендерим карточки
    this._clearNoResults();
    await this.renderer._renderCartVertical(list, this.root);

    // обновить состояние "в избранном" на карточках
    if (this.root && this.favorites) {
      const allCards = this.root.querySelectorAll('[data-product-id]');
      allCards.forEach(card => {
        const pid = card.getAttribute('data-product-id');
        const isFav = this.favorites.isFavorite(pid);
        this.renderer.updateProductCardFavState(this.root, pid, isFav);
      });
    }

    // синхронизировать контролы (qty, disabled и т.д.)
    this._syncAllCardsControls();
  }

  _onSearchInput() { this.applyFilters(); }
  _onCatChange() { this.applyFilters(); }
  _onBrandChange() { this.applyFilters(); } // <= brand change -> reapply filters
  _onSortChange() { this.applyFilters(); }
  _onSearchBtn() { this.applyFilters(); }

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
    const res = this.cart.add(id, toAdd);
    return res;
  }

  //removeFromCart(id) { return this.cart.remove(id); }
  changeQty(id, qty) { return this.cart.changeQty(id, qty); }
  isFavorite(id) { return this.favorites.isFavorite ? this.favorites.isFavorite(id) : false; }
  toggleFavorite(id) { return this.favorites.toggle ? this.favorites.toggle(id) : false; }

  getFavorites() {
    const ids = (this.favorites.getAll ? this.favorites.getAll() : (this.favorites.exportToArray ? this.favorites.exportToArray() : []));
    return Array.isArray(ids) ? ids.map(id => this.productService.findById(id)).filter(Boolean) : [];
  }

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
}
