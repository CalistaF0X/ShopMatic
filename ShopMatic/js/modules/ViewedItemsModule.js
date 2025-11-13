/**
 * ViewedItemsModule
 * @author Calista Verner
 *
 * This module is responsible for loading and rendering a list of recently viewed
 * products into the DOM. It leverages the provided StorageService to fetch
 * stored items from localStorage and, if possible, enriches them with
 * availability information via productService.fetchById.
 * 
 * Date: 2025-11-01
 * License: MIT
 */

export class ViewedItemsModule {
  /**
   * Create a new ViewedItemsModule.
   *
   * @param {Object} deps
   * @param {StorageService} deps.storageService - Instance of StorageService.
   * @param {Object} [deps.renderer] - Optional renderer with renderCards() and/or other methods.
   * @param {string|HTMLElement} deps.container - DOM container or selector where items should be rendered.
   * @param {Object} [deps.opts] - Optional configuration overrides.
   *   maxItems: maximum number of viewed items to display (default from storageService.maxViewedItems).
   *   concurrency: number of concurrent fetches for availability (default from storageService.defaultConcurrency).
   *   noItemsMessage: message to display when no items were viewed.
   */
  constructor({ storageService, renderer = null, container, opts = {} }) {
    if (!storageService) throw new Error('ViewedItemsModule requires a storageService.');
    this._storage = storageService;
    this._renderer = renderer;
    this._container = (typeof container === 'string') ? document.querySelector(container) : container;
    if (!this._container) {
      throw new Error('ViewedItemsModule: container element not found.');
    }
    const defaults = {
      maxItems: Number.isFinite(Number(storageService?.maxViewedItems)) ? Number(storageService.maxViewedItems) : 20,
      concurrency: Number.isFinite(Number(storageService?.defaultConcurrency)) ? Number(storageService.defaultConcurrency) : 6,
      noItemsMessage: 'Нет просмотренных товаров.'
    };
    this._opts = Object.assign({}, defaults, opts);
  }

  /**
   * Load the viewed items from storage, enrich them with availability info,
   * and render them into the container.
   * This method is idempotent and can be called multiple times to refresh the UI.
   */
  async load() {
    // Clear existing content
    this._container.innerHTML = '';

    // Fetch raw viewed items from storage
    let raw = [];
    try {
      raw = this._storage.loadViewed?.() || [];
    } catch (e) {
      console.warn('ViewedItemsModule: failed to load viewed items', e);
      raw = [];
    }

    // If nothing to show, render a friendly message and return
    if (!Array.isArray(raw) || raw.length === 0) {
      this._renderEmpty();
      return;
    }

    // Sort by viewedAt descending (newest first) and limit the number of items
    const itemsToLoad = raw
      .slice() // shallow copy to avoid mutating original
      .sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0))
      .slice(0, this._opts.maxItems);

    // Attempt to enrich items with availability using StorageService._loadWithAvailability
    let enriched = itemsToLoad;
    try {
      if (typeof this._storage._loadWithAvailability === 'function') {
        enriched = await this._storage._loadWithAvailability(itemsToLoad, { concurrency: this._opts.concurrency });
      }
    } catch (e) {
      console.warn('ViewedItemsModule: _loadWithAvailability failed', e);
      // fall back to raw items
      enriched = itemsToLoad;
    }

    // Render the list
    await this._render(enriched);
  }

  /**
   * Render the list of items into the container. If a renderer is provided, use
   * it to render product cards; otherwise, fall back to a simple list. This
   * method handles errors gracefully and falls back to fallback rendering if
   * renderer fails.
   *
   * @param {Array} items - Array of item objects.
   */
  async _render(items) {
    if (!this._container) return;
    try {
      // If a custom renderer exists and has renderCards, use it.
      if (this._renderer && typeof this._renderer.renderCards === 'function') {
        // Create a temporary container for rendering
        const tmp = document.createElement('div');
        const renderResult = this._renderer.renderCards(tmp, items, this._renderer.foxEngine);
        if (renderResult && typeof renderResult.then === 'function') {
          await renderResult;
        }
        // Clear existing content and append rendered content
        this._container.innerHTML = '';
        this._container.appendChild(tmp);
        return;
      }
    } catch (e) {
      console.warn('ViewedItemsModule: renderer.renderCards failed', e);
      // fall through to fallback
    }
    // Fallback: simple list rendering
    this._renderFallback(items);
  }

  /**
   * Render a simple list of viewed items as an unordered list. Each list item
   * contains a thumbnail (if available) and a link to the product page. This
   * method does not rely on external renderer.
   *
   * @param {Array} items - Array of item objects.
   */
  _renderFallback(items) {
    // Create list container
    const ul = document.createElement('ul');
    ul.className = 'viewed-items-list';

    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'viewed-item';

      // Wrapper for the image and text
      const itemContent = document.createElement('div');
      itemContent.className = 'viewed-item__content';

      // Thumbnail image
      if (it.picture) {
        const img = document.createElement('img');
        img.src = String(JSON.parse(it.picture).at(0));
        img.loading = 'lazy';
        img.width = 80;
        img.height = 80;
        img.className = 'viewed-item__image';
        itemContent.appendChild(img);
      }

      // Product link
      const link = document.createElement('a');
      link.href = `#product/${encodeURIComponent(it.name || '')}`;
      link.textContent = String(it.fullname || it.name || '');
      link.className = 'viewed-item__link';
      itemContent.appendChild(link);

      // Availability indicator (optional)
      const available = this._storage.shopMatic.cart.isAvailable(it);
      const status = document.createElement('span');
      status.className = 'viewed-item__status';
      status.textContent = available ? 'В наличии' : 'Нет в наличии';
      status.style.marginLeft = '8px';
      itemContent.appendChild(status);

      // Add content to list item
      li.appendChild(itemContent);

      // Optional: Add a "View" button for better interaction
      const viewButton = document.createElement('button');
      viewButton.className = 'viewed-item__button';
      viewButton.textContent = 'Посмотреть';
      viewButton.onclick = () => window.location.href = link.href;
      li.appendChild(viewButton);

      ul.appendChild(li);
    }

    // Clear container and insert list
    this._container.innerHTML = '';
    this._container.appendChild(ul);

    // Add "Clear History" button
    this._addClearHistoryButton();
  }

  /**
   * Add "Clear History" button at the bottom of the list.
   */
  _addClearHistoryButton() {
    const clearButtonHtml = `
      <div class="clearViewed">
        <a href="javascript:void(0)" onclick="foxEngine.shopMatic.storage.clearViewed()">Очистить историю</a>
      </div>
    `;
    this._container.insertAdjacentHTML('beforeend', clearButtonHtml);
  }

  /**
   * Render an empty state when there are no viewed items.
   */
  _renderEmpty() {
    const p = document.createElement('p');
    p.className = 'viewed-items-empty';
    p.textContent = String(this._opts.noItemsMessage);
    this._container.appendChild(p);
  }

  /**
   * Synchronize viewed items with the latest storage data and re-render.
   */
  async sync() {
    await this.load(); // Reload the items from storage
  }
}
