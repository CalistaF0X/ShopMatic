/**
 * Catalog module encapsulates all logic related to displaying and filtering the
 * product list. It loads products, categories and brands from the underlying
 * ProductService, populates the filter controls, renders product cards via
 * Renderer and keeps card controls and favorite state in sync.
 * @author Calista Verner
 * @date [13.11.25]
 *
 * The class is intentionally decoupled from the rest of ShopMatic; it expects
 * a parent `shop` instance exposing `productService`, `renderer`, `favorites`,
 * `notifications`, and `card`. See ShopMatic for usage.
 */
 import { debounce } from './utils.js';

/**
 * Catalog module:
 *  - загружает список товаров через ProductService
 *  - наполняет фильтры (категории / бренды)
 *  - применяет поиск / сортировку
 *  - рендерит карточки через renderer
 */
export class Catalog {
  static UI_MESSAGES = Object.freeze({
    PRODUCT_LIMIT_DEFAULT: 'У вас уже максимум в корзине',
    PRODUCT_LIMIT_REACHED: 'Вы достигли максимального количества этого товара',
    NO_STOCK_TEXT: 'Товара нет в наличии',
    CANNOT_ADD_NO_STOCK: 'Невозможно добавить: нет доступного остатка.',
    ADDED_PARTIAL: 'В корзину добавлено {added} шт. (доступно {available}).',
    FAVORITES_UNAVAILABLE: 'Модуль избранного недоступен.',
    PRODUCT_LEFT: 'Остаток: {left}',

    CATALOG_LOAD_ERROR: 'Не удалось загрузить товары',
    CATALOG_ALL_OPTION: 'Все',
    CATALOG_NO_RESULTS: 'По текущим опциям нет товаров',
    CATALOG_NO_RESULTS_HINT: 'Попробуйте изменить фильтры, удалить сортировку или сбросить поиск.'
  });

  constructor({
    shop, rootId, catFilterId, brandFilterId, searchId, sortId, searchBtnId, productsCountId
  }) {
    if (!shop) throw new Error('Catalog requires a shop instance');

    this.shop = shop;
    this.opts = {
      rootId,
      catFilterId,
      brandFilterId,
      searchId,
      sortId,
      searchBtnId,
      productsCountId
    };

    this.root = null;
    this.catFilter = null;
    this.brandFilter = null;
    this.search = null;
    this.sort = null;
    this.searchBtn = null;
    this.resetBtn = null;         // кнопка сброса
    this.productsCount = null;

    this._bound = {
      onSearchInput: debounce(this.onSearchInput.bind(this), 300),
      onCatChange: this.onCatChange.bind(this),
      onBrandChange: this.onBrandChange.bind(this),
      onSortChange: this.onSortChange.bind(this),
      onSearchBtn: this.onSearchBtn.bind(this),
      onResetFilters: this.onResetFilters.bind(this)
    };
  }

  _msg(key, fallback = '') {
    if (this.shop && typeof this.shop._msg === 'function') {
      const val = this.shop._msg(key);
      if (val != null && val !== key) return val;
    }

    const i18n = this.shop?.i18n;
    if (i18n && typeof i18n.t === 'function') {
      const val = i18n.t(key);
      if (val != null && val !== key) return val;
    }

    return Catalog.UI_MESSAGES[key] || fallback;
  }

  async init(_request = {}) {
    this._cacheDomElements();

    const ps = this.shop.productService;
    if (!ps) return;

    try {
      await ps.loadProductsSimple();
    } catch (err) {
      console.error('Catalog.init: loadProductsSimple failed', err);
      this._showNotification(this._msg('CATALOG_LOAD_ERROR', 'Не удалось загрузить товары'));
    }

    this._bindEvents();
  }

  async loadCatalog({ request = null } = {}) {
    const ps = this.shop.productService;
    if (!ps) return [];

    const selectedCategory = request?.category ?? '';
    const selectedBrand = request?.brand ?? '';

    this._setLocationHash('#page/catalog');

    await Promise.all([
      this.catFilter
        ? this._populateFilter(
            this.catFilter,
            ps,
            'fillCategories',
            'fetchCategories',
            selectedCategory
          )
        : Promise.resolve(),
      this.brandFilter
        ? this._populateFilter(
            this.brandFilter,
            ps,
            'fillBrands',
            'fetchBrands',
            selectedBrand
          )
        : Promise.resolve()
    ]);

    if (this.catFilter && selectedCategory) {
      this.catFilter.value = selectedCategory;
    }
    if (this.brandFilter && selectedBrand) {
      this.brandFilter.value = selectedBrand;
    }

    await this.applyFilters();

    const list = ps.getProducts?.();
    return Array.isArray(list) ? [...list] : [];
  }

  destroy() {
    this._removeEventListeners();
    this.root = null;
    this.catFilter = null;
    this.brandFilter = null;
    this.search = null;
    this.sort = null;
    this.searchBtn = null;
    this.resetBtn = null;
    this.productsCount = null;
  }

  // --- DOM / events --------------------------------------------------------

  _cacheDomElements() {
    const {
      rootId,
      catFilterId,
      brandFilterId,
      searchId,
      sortId,
      searchBtnId,
      productsCountId
    } = this.opts;

    this.root = document.getElementById(rootId) || null;
    this.catFilter = document.getElementById(catFilterId) || null;
    this.brandFilter = document.getElementById(brandFilterId) || null;
    this.search = document.getElementById(searchId) || null;
    this.sort = document.getElementById(sortId) || null;
    this.searchBtn = document.getElementById(searchBtnId) || null;
    this.productsCount = document.getElementById(productsCountId) || null;

    // кнопка сброса ищется по фиксированному id, без изменения API
    this.resetBtn = document.getElementById('resetFilters') || null;
  }

  _bindEvents() {
    if (this.search) this.search.addEventListener('input', this._bound.onSearchInput);
    if (this.catFilter) this.catFilter.addEventListener('change', this._bound.onCatChange);
    if (this.brandFilter) this.brandFilter.addEventListener('change', this._bound.onBrandChange);
    if (this.sort) this.sort.addEventListener('change', this._bound.onSortChange);
    if (this.searchBtn) this.searchBtn.addEventListener('click', this._bound.onSearchBtn);
    if (this.resetBtn) this.resetBtn.addEventListener('click', this._bound.onResetFilters);
  }

  _removeEventListeners() {
    if (this.search) this.search.removeEventListener('input', this._bound.onSearchInput);
    if (this.catFilter) this.catFilter.removeEventListener('change', this._bound.onCatChange);
    if (this.brandFilter) this.brandFilter.removeEventListener('change', this._bound.onBrandChange);
    if (this.sort) this.sort.removeEventListener('change', this._bound.onSortChange);
    if (this.searchBtn) this.searchBtn.removeEventListener('click', this._bound.onSearchBtn);
    if (this.resetBtn) this.resetBtn.removeEventListener('click', this._bound.onResetFilters);
  }

  _setLocationHash(hash) {
    if (typeof window !== 'undefined' && window.location) {
      window.location.hash = hash;
    }
  }

  _showNotification(message) {
    try {
      this.shop.notifications.show(message, {
        duration: this.shop.opts?.notificationDuration ?? 3000
      });
    } catch (_) {}
  }

  // --- filters / data ------------------------------------------------------

  async _populateFilter(filterElement, ps, fillMethod, fetchMethod, selectedValue = '') {
    if (!filterElement || !ps) return;

    try {
      if (typeof ps[fillMethod] === 'function') {
        await ps[fillMethod](filterElement, { selected: selectedValue });

        if (selectedValue && filterElement.value !== selectedValue) {
          filterElement.value = selectedValue;
        }
        return;
      }

      if (typeof ps[fetchMethod] === 'function') {
        await ps[fetchMethod]();
      }

      const getterName = `get${fillMethod.replace('fill', '')}`;
      const items = typeof ps[getterName] === 'function'
        ? (ps[getterName]() || [])
        : [];

      const allLabel = this._msg('CATALOG_ALL_OPTION', 'Все');
      filterElement.innerHTML = `<option value="">${allLabel}</option>`;

      for (const item of items) {
        if (!item) continue;
        const option = document.createElement('option');
        option.value = item.id ?? item.name ?? '';
        option.textContent = item.fullname ?? item.name ?? item.id ?? '';
        if (selectedValue && option.value === selectedValue) {
          option.selected = true;
        }
        filterElement.appendChild(option);
      }

      if (selectedValue) {
        filterElement.value = selectedValue;
      }
    } catch (err) {
      console.warn(`Catalog._populateFilter: ${fillMethod} failed`, err);
    }
  }

  _getProductList() {
    const ps = this.shop.productService;
    const list = ps && typeof ps.getProducts === 'function'
      ? ps.getProducts()
      : [];
    return Array.isArray(list) ? [...list] : [];
  }

  _filterAndSort(list) {
    const searchTerm = (this.search?.value || '').trim().toLowerCase();
    const category = this.catFilter?.value || '';
    const brand = this.brandFilter?.value || '';
    const sortOrder = this.sort?.value || '';

    if (searchTerm) {
      list = list.filter(p =>
        (p.fullname || p.title || p.name || '').toLowerCase().includes(searchTerm)
      );
    }

    if (category) {
      list = list.filter(p => p.category === category);
    }

    if (brand) {
      const normalized = brand.toLowerCase();
      list = list.filter(
        p => (p.brand ?? p.brandName ?? '').toLowerCase() === normalized
      );
    }

    if (!sortOrder) return list;

    const arr = [...list];
    switch (sortOrder) {
      case 'price_asc':
        return arr.sort((a, b) => (a.price || 0) - (b.price || 0));
      case 'price_desc':
        return arr.sort((a, b) => (b.price || 0) - (a.price || 0));
      case 'brand_asc':
        return arr.sort((a, b) =>
          (a.brandName || '').localeCompare(b.brandName || '')
        );
      case 'brand_desc':
        return arr.sort((a, b) =>
          (b.brandName || '').localeCompare(a.brandName || '')
        );
      default:
        return list;
    }
  }

  async applyFilters() {
    let list = this._getProductList();
    list = this._filterAndSort(list);

    if (this.productsCount) {
      this.productsCount.textContent = String(list.length);
    }
    if (!this.root) return;

    if (!list.length) {
      this._renderNoResults();
      return;
    }

    this._clearNoResults();
    await this.shop.renderer._renderCartVertical(list, this.root);
    this._updateFavorites(list);
    this.shop._syncAllCardsControls();
  }

  _renderNoResults(message = null) {
    if (!this.root) return;
    if (this.productsCount) this.productsCount.textContent = '0';

    const text = message ?? this._msg('CATALOG_NO_RESULTS', 'По текущим опциям нет товаров');
    const hintText = this._msg(
      'CATALOG_NO_RESULTS_HINT',
      'Попробуйте изменить фильтры, удалить сортировку или сбросить поиск.'
    );

    const wrapper = document.createElement('div');
    wrapper.className = 'catalog-empty';

    const icon = document.createElement('div');
    icon.className = 'catalog-empty__icon';
    icon.innerHTML =
      '<svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M3 6h18v2H3zm0 5h12v2H3zm0 5h6v2H3z"></path>' +
      '</svg>';
    icon.style.opacity = '0.6';

    const p = document.createElement('p');
    p.className = 'catalog-empty__text';
    p.textContent = text;

    const hint = document.createElement('div');
    hint.className = 'catalog-empty__hint';
    hint.textContent = hintText;

    wrapper.appendChild(icon);
    wrapper.appendChild(p);
    wrapper.appendChild(hint);

    this.root.innerHTML = '';
    this.root.appendChild(wrapper);
    this.shop._syncAllCardsControls();
  }

  _clearNoResults() {
    const found = this.root?.querySelector('.catalog-empty');
    if (found) found.remove();
  }

  _updateFavorites(list) {
    if (!this.shop.favorites || !this.root) return;

    list.forEach(product => {
      const card = this.root.querySelector(`[data-product-id="${product.id}"]`);
      if (!card) return;
      const isFav = this.shop.favorites.isFavorite(product.id);
      this.shop.renderer.updateProductCardFavState(this.root, product.id, isFav);
    });
  }

  // --- event handlers ------------------------------------------------------

  onSearchInput() { this.applyFilters(); }
  onCatChange()   { this.applyFilters(); }
  onBrandChange() { this.applyFilters(); }
  onSortChange()  { this.applyFilters(); }
  onSearchBtn()   { this.applyFilters(); }

  onResetFilters() {
    if (this.search) this.search.value = '';
    if (this.catFilter) this.catFilter.value = '';
    if (this.brandFilter) this.brandFilter.value = '';
    if (this.sort) this.sort.value = this.sort.querySelector('option')?.value || '';

    this.applyFilters();
  }
}