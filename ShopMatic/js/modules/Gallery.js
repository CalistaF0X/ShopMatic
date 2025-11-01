/*
 * Enhanced and optimized version of the Gallery class.
 *
 * This implementation focuses on improving performance and reducing memory
 * overhead by adopting event delegation for thumbnail interaction and
 * guarding against multiple listener registrations. It also includes
 * minor fixes and quality of life improvements such as preventing
 * duplicate navigation bindings and more robust cleanup in destroy().
 */

export class Gallery {
  /**
   * Create a Gallery instance.
   *
   * The constructor mirrors the API of the original Gallery class but adds
   * several optimizations:
   *  - Uses a dedicated flag (`_navInitialized`) to avoid redundant nav
   *    element creation and event binding in `_ensureNav()`.
   *  - Tracks whether thumbnail handlers are bound via `_thumbHandlersBound` to
   *    prevent attaching duplicate listeners on every re-render.
   *
   * @param {HTMLElement} rootEl The root element hosting the gallery.
   * @param {Array|Object|string} images An array or data structure describing images.
   * @param {Object} options Optional configuration.
   */
  constructor(rootEl, images = [], options = {}) {
    if (!rootEl) throw new Error('Gallery root element required');

    const defaults = {
      thumbContainerSelector: '.gallery-thumbs',
      thumbSelector: '[data-thumb]',
      mainSelector: '#product-main-image',
      mainFrameSelector: '.main-frame',
      modalId: 'galleryModal',
      circular: true,
      preloadAdjacent: 1,
      swipeThreshold: 40,
      transitionMs: 180,
      renderThumbs: true,
      placeholder: '',
      nav: true,
      navPrevClass: 'gallery-nav-prev',
      navNextClass: 'gallery-nav-next',
      navWrapperClass: 'gallery-nav',
      thumbScrollClass: 'gallery-thumb-scroll',
      thumbScrollIconClass: 'fa fa-chevron-down',
      animation: 'slide'
    };

    // Merge defaults with user options. Avoid mutating defaults to keep
    // consistent behaviour across instances.
    this.options = Object.assign({}, defaults, options);
    this.root = rootEl;
    this.mainImg = this.root.querySelector(this.options.mainSelector);
    this.mainFrame = this.root.querySelector(this.options.mainFrameSelector);
    this.modal = document.getElementById(this.options.modalId) || null;
    this.modalImg = this.modal ? this.modal.querySelector('.gallery-main-img') : null;

    // Event listener bookkeeping. Each call to `_addListener()` returns
    // a unique id stored in `_listeners` for later removal.
    this._listeners = new Map();
    this._listenerId = 0;

    this._thumbContainer = this.root.querySelector(this.options.thumbContainerSelector) || null;
    this._thumbs = [];
    this.images = [];
    this.current = 0;
    this._prevIndex = -1;
    this._animating = false;
    this._animDuration = Math.max(40, Number(this.options.transitionMs) || 180);
    this._tmpImage = null;

    // Thumbnail scroll and focus handling
    this._thumbScrollBtn = null;
    this._thumbScrollObserver = null;
    this._thumbScrollRAF = null;
    this._thumbScrollAttached = false;

    // Swipe and drag state
    this._drag = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      lastDX: 0,
      targetIndex: null,
      direction: null,
      moved: false
    };
    this._pointerHandlers = {};
    this._suppressClick = false;
    this._clickSuppressMs = 250;
    this._suppressClickTimer = null;

    // Internal flags to avoid duplicate handler bindings
    this._navInitialized = false;
    this._thumbHandlersBound = false;

    // Ensure the main frame is correctly styled for animations
    if (this.mainFrame) {
      const csPos = window.getComputedStyle(this.mainFrame).position;
      if (csPos === 'static' || !csPos) this.mainFrame.style.position = 'relative';
      this.mainFrame.style.overflow = 'hidden';
      if (!this.mainFrame.style.zIndex) this.mainFrame.style.zIndex = '0';
      try { this.mainFrame.style.touchAction = this.mainFrame.style.touchAction || 'pan-y'; } catch (e) {}
    }

    // Configure the main image element with initial styles
    if (this.mainImg) {
      const objFit = this.mainImg.style.objectFit || 'contain';
      this.mainImg.style.objectFit = objFit;
      this.mainImg.style.transition = `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration/2)}ms ease`;
      this.mainImg.style.transform = 'translateX(0)';
      this.mainImg.style.zIndex = '1';
      this.mainImg.draggable = false;
      this.mainImg.style.willChange = 'transform, opacity';
    }

    // Bind root-level handlers upfront
    this._bound = {
      _onMainClick: (e) => this._onMainClick(e),
      _onRootKey: (e) => this._onRootKey(e)
    };
    this._bindHandlers();

    // Initialize images if provided
    if (images != null) this.setImages(images, { showFirst: true, renderThumbs: this.options.renderThumbs });
  }

  /**
   * Register an event listener and track it for later removal.
   *
   * @param {HTMLElement} el Element to attach listener to.
   * @param {string} evt Event name.
   * @param {Function} fn Event handler.
   * @param {Object} opts Optional addEventListener options.
   * @returns {number|null} ID used for deregistration.
   */
  _addListener(el, evt, fn, opts = {}) {
    if (!el || !fn) return null;
    const id = ++this._listenerId;
    el.addEventListener(evt, fn, opts);
    this._listeners.set(id, { el, evt, fn, opts });
    return id;
  }

  /**
   * Remove a previously registered listener by id.
   *
   * @param {number} id ID returned by `_addListener()`.
   */
  _removeListener(id) {
    const rec = this._listeners.get(id);
    if (!rec) return;
    try { rec.el.removeEventListener(rec.evt, rec.fn, rec.opts); } catch (e) {}
    this._listeners.delete(id);
  }

  /**
   * Remove all registered listeners. Useful during teardown.
   */
  _removeAllListeners() {
    for (const id of Array.from(this._listeners.keys())) this._removeListener(id);
  }

  /**
   * Normalize a variety of input formats into a standardized array of image objects.
   *
   * This helper replicates the logic of the original Gallery class but has been
   * slightly refactored for clarity. It accepts strings, arrays, or objects,
   * attempts to parse JSON strings, and extracts `src`, `thumb`, and `alt`
   * fields in a flexible manner.
   *
   * @param {Array|Object|string|null} images Input describing images.
   * @returns {Array} Array of normalized image objects.
   */
  _normalizeImages(images) {
    if (images == null) return [];
    if (typeof images === 'string') {
      const s = images.trim();
      if (!s) return [];
      try { return this._normalizeImages(JSON.parse(s)); } catch (e) { return this._normalizeImages([s]); }
    }
    if (!Array.isArray(images) && typeof images === 'object') {
      if (Array.isArray(images.images)) return this._normalizeImages(images.images);
      const maybe = ['gallery','files','pictures','photos'];
      for (const k of maybe) if (Array.isArray(images[k])) return this._normalizeImages(images[k]);
      const single = this._extractSrc(images);
      return single ? [{ id: null, src: single, thumb: single, alt: '' }] : [];
    }
    if (Array.isArray(images)) {
      const out = [];
      for (let i = 0; i < images.length; i++) {
        const norm = this._normalizeImageItem(images[i], i);
        if (norm && norm.src) out.push(norm);
      }
      // Deduplicate by src using a Set
      const seen = new Set();
      const unique = [];
      for (const it of out) {
        if (!seen.has(it.src)) {
          seen.add(it.src);
          unique.push(it);
        }
      }
      return unique;
    }
    return [];
  }

  /**
   * Normalize a single image item into an object with at least a `src` field.
   *
   * @param {any} item The item to normalize.
   * @param {number} idx Index in the original array (if applicable).
   * @returns {Object|null} A normalized image or null if invalid.
   */
  _normalizeImageItem(item, idx = 0) {
    if (!item && item !== 0) return null;
    if (typeof item === 'string') {
      const s = item.trim();
      return s ? { id: null, src: s, thumb: s, alt: '' } : null;
    }
    if (Array.isArray(item)) {
      for (const it of item) {
        const n = this._normalizeImageItem(it, idx);
        if (n && n.src) return n;
      }
      return null;
    }
    if (typeof item === 'object') {
      const fields = ['src','url','path','file','location','image'];
      const thumbFields = ['thumb','thumbnail','preview'];
      let src = '';
      for (const f of fields) if (item[f]) { src = this._extractSrc(item[f]); if (src) break; }
      if (!src) {
        const numericKeys = Object.keys(item).filter(k=>String(Number(k))===k).sort((a,b)=>Number(a)-Number(b));
        for (const k of numericKeys) { const c = this._extractSrc(item[k]); if (c) { src = c; break; } }
      }
      let thumb = '';
      for (const f of thumbFields) if (item[f]) { thumb = this._extractSrc(item[f]); if (thumb) break; }
      if (!thumb) thumb = src || '';
      const alt = item.alt || item.title || item.name || '';
      const id = item.id ?? item.key ?? null;
      if (!src) return null;
      return { id, src, thumb, alt };
    }
    return null;
  }

  /**
   * Extract a source string from various possible structures (string, array, object).
   *
   * @param {any} val Input to extract from.
   * @returns {string} Source string or empty if none found.
   */
  _extractSrc(val) {
    if (val == null) return '';
    if (typeof val === 'string') {
      const s = val.trim();
      if (!s) return '';
      if ((s[0] === '[' || s[0] === '{')) {
        try { return this._extractSrc(JSON.parse(s)); } catch (e) { return s; }
      }
      return s;
    }
    if (Array.isArray(val)) {
      for (const v of val) { const c = this._extractSrc(v); if (c) return c; }
      return '';
    }
    if (typeof val === 'object') {
      const fields = ['src','url','path','file','location','thumb','thumbnail'];
      for (const f of fields) if (val[f]) { const c = this._extractSrc(val[f]); if (c) return c; }
      const ks = Object.keys(val).sort((a,b)=>Number(a)-Number(b));
      for (const k of ks) if (!isNaN(Number(k))) { const c = this._extractSrc(val[k]); if (c) return c; }
      return '';
    }
    return '';
  }

  /**
   * Render thumbnail buttons based on current images.
   *
   * This method detaches any existing thumb listeners before regenerating the
   * thumb elements. Event delegation is used for click and keyboard events
   * to reduce the overhead of per-thumb listeners.
   */
  renderThumbs() {
    if (!this._thumbContainer) return;
    // Detach any existing thumb handlers to avoid duplicates
    this._unbindThumbHandlers();
    this._thumbContainer.innerHTML = '';
    const frag = document.createDocumentFragment();
    this.images.forEach((it, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gallery-thumb';
      btn.setAttribute('aria-label', it.alt || `Изображение ${i+1}`);
      btn.dataset.index = String(i);
      btn.setAttribute('role','button');
      btn.tabIndex = 0;
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = it.thumb || it.src || this.options.placeholder || '';
      img.alt = it.alt || '';
      btn.appendChild(img);
      frag.appendChild(btn);
    });
    this._thumbContainer.appendChild(frag);
    this._collectThumbs();
    this._bindThumbHandlers();
    if (this.images.length) this._markActive(this.current);
    this._ensureThumbScroll();
  }

  /**
   * Collect current thumbnail elements.
   */
  _collectThumbs() {
    if (this._thumbContainer) {
      this._thumbs = Array.from(this._thumbContainer.querySelectorAll('.gallery-thumb'));
      if (!this._thumbs.length) this._thumbs = Array.from(this.root.querySelectorAll(this.options.thumbSelector));
    } else {
      this._thumbs = Array.from(this.root.querySelectorAll(this.options.thumbSelector));
    }
  }

  /**
   * Ensure thumbnails have the correct source and attributes after a refresh.
   */
  _normalizeThumbSrcs() {
    const placeholder = this.options.placeholder || '';
    this._thumbs.forEach((t, i) => {
      try {
        let img = t.querySelector('img');
        const expected = (this.images[i] && (this.images[i].thumb || this.images[i].src)) || placeholder;
        t.dataset.index = String(i);
        if (img) {
          if (!img.src || img.src !== expected) img.src = expected;
          if (!img.alt) img.alt = this.images[i]?.alt || '';
        } else {
          img = document.createElement('img');
          img.loading = 'lazy';
          img.decoding = 'async';
          img.src = expected;
          img.alt = this.images[i]?.alt || '';
          t.appendChild(img);
        }
      } catch (e) {}
    });
  }

  /**
   * Public method to set new images on the gallery. Optionally re-renders
   * thumbnails and shows the first image immediately.
   *
   * @param {Array|Object|string} images The new images to display.
   * @param {Object} opts Options controlling behaviour.
   */
  setImages(images, { showFirst = true, renderThumbs = true } = {}) {
    this._unbindThumbHandlers();
    this.images = this._normalizeImages(images);
    if (renderThumbs && this._thumbContainer) this.renderThumbs();
    else { this._collectThumbs(); this._normalizeThumbSrcs(); this._bindThumbHandlers(); }
    if (this.images.length && showFirst) this.show(0, { emit: false });
  }

  /**
   * Refresh the gallery in-place, re-binding thumb handlers and scroll logic.
   */
  refresh() {
    this._unbindThumbHandlers();
    this._collectThumbs();
    this._normalizeThumbSrcs();
    this._bindThumbHandlers();
    this._ensureThumbScroll();
  }

  /**
   * Determine the direction of transition based on previous and target indices.
   *
   * @param {number} prev Previous index.
   * @param {number} index Target index.
   * @returns {string} 'left', 'right', or 'none'.
   */
  _getDirection(prev, index) {
    const n = this.images.length;
    if (!Number.isFinite(prev) || prev < 0 || prev === index || n <= 1) return 'none';
    if (!this.options.circular) return index > prev ? 'right' : 'left';
    const forward = (index - prev + n) % n;
    const backward = (prev - index + n) % n;
    return forward <= backward ? 'right' : 'left';
  }

  /**
   * Display a specific image by index or from a thumbnail element. Performs
   * animated transitions when appropriate.
   *
   * @param {number|HTMLElement} indexOrThumb Index or thumb element.
   * @param {Object} options Options controlling emission of events.
   */
  show(indexOrThumb, options = {}) {
    if (!this.images.length) return;
    let index;
    if (typeof indexOrThumb === 'number') index = this._clampIndex(indexOrThumb);
    else if (indexOrThumb && indexOrThumb.dataset && indexOrThumb.dataset.index) {
      const di = Number(indexOrThumb.dataset.index);
      index = Number.isFinite(di) ? this._clampIndex(di) : this._clampIndex(this._thumbs.indexOf(indexOrThumb));
    } else index = this._clampIndex(0);

    const item = this.images[index];
    const src = item?.src;
    if (!src) return;
    if (index === this.current && this.mainImg && this.mainImg.src === src) return;

    const prevIndex = this.current;
    const direction = this._getDirection(this._prevIndex >= 0 ? this._prevIndex : prevIndex, index);
    this._prevIndex = prevIndex;
    this.current = index;

    // Update thumbnail active states
    this._thumbs.forEach((t, i) => {
      const is = i === index;
      t.classList.toggle('active', is);
      if (is) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
      t.dataset.index = String(i);
    });

    // Update modal if open
    if (this.modal && !this.modal.hidden && this.modalImg) this.modalImg.src = src;
    // Preload adjacent images
    this._preload(index);
    if (options.emit !== false) this._emit('gallery:change', { index, src, item });
    this._markActive(index);
    this._ensureThumbVisible(index);

    // Fallback to simple swap when no animations or direction is none
    if (!this.mainImg || !this.mainFrame || direction === 'none' || this.options.animation !== 'slide') {
      this._simpleSwap(src, index, item);
      return;
    }

    // If an animation is already running, abort it and reset state
    if (this._animating) {
      const prevTmp = this._tmpImage;
      if (prevTmp && prevTmp.parentNode) prevTmp.parentNode.removeChild(prevTmp);
      this._animating = false;
      this._tmpImage = null;
      try { this.mainImg.style.transform = 'translateX(0)'; this.mainImg.style.opacity = '1'; } catch (e) {}
    }

    this._doAnimatedSwap(index, direction);
  }

  /**
   * Swap the main image without animation.
   *
   * @param {string} src Source URL.
   * @param {number} index Target index.
   * @param {Object} item Image object containing alt text.
   */
  _simpleSwap(src, index, item) {
    if (!this.mainImg) return;
    this.mainImg.classList.add('is-loading');
    const onLoad = () => {
      this.mainImg.classList.remove('is-loading');
      this.mainImg.removeEventListener('load', onLoad);
      this._emit('gallery:loaded', { index, src });
    };
    const onError = () => {
      this.mainImg.classList.remove('is-loading');
      this.mainImg.removeEventListener('error', onError);
      if (this.options.placeholder) this.mainImg.src = this.options.placeholder;
      this._emit('gallery:error', { index, src });
    };
    this.mainImg.addEventListener('load', onLoad, { once: true });
    this.mainImg.addEventListener('error', onError, { once: true });
    // Delay swap by transition duration to avoid abrupt cutoff on quick successive calls
    setTimeout(() => {
      this.mainImg.src = src;
      this.mainImg.dataset.index = String(index);
      this.mainImg.alt = item.alt || '';
      if (this.mainImg.complete) onLoad();
    }, this.options.transitionMs);
  }

  /**
   * Perform an animated image swap using temporary overlay image.
   *
   * @param {number} index Target index.
   * @param {string} direction 'left' or 'right'.
   */
  _doAnimatedSwap(index, direction) {
    const item = this.images[index];
    const src = item?.src;
    if (!src || !this.mainImg || !this.mainFrame) return;
    this.mainImg.classList.add('is-loading');
    this._animating = true;

    const tmp = document.createElement('img');
    this._tmpImage = tmp;
    tmp.decoding = 'async';
    tmp.loading = 'eager';
    tmp.alt = item.alt || '';
    tmp.draggable = false;
    Object.assign(tmp.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      objectFit: this.mainImg.style.objectFit || 'contain',
      transition: `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration/2)}ms ease`,
      zIndex: '2',
      opacity: '1'
    });

    const fromPct = direction === 'right' ? 100 : -100;
    tmp.style.transform = `translateX(${fromPct}%)`;

    this.mainImg.style.zIndex = '1';
    this.mainImg.style.transition = `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration/2)}ms ease`;
    this.mainImg.style.transform = 'translateX(0)';
    this.mainImg.style.opacity = '1';

    this.mainFrame.appendChild(tmp);

    const handleLoad = () => {
      tmp.removeEventListener('load', handleLoad);
      // Force a reflow before applying transitions
      tmp.offsetHeight;
      requestAnimationFrame(() => {
        const mainTarget = direction === 'right' ? -100 : 100;
        this.mainImg.style.transform = `translateX(${mainTarget}%)`;
        this.mainImg.style.opacity = '0';
        tmp.style.transform = 'translateX(0%)';
      });

      const cleanup = () => {
        try { if (tmp.parentNode) tmp.parentNode.removeChild(tmp); } catch (e) {}
        this.mainImg.style.transition = '';
        this.mainImg.style.transform = 'translateX(0)';
        this.mainImg.style.opacity = '1';
        this.mainImg.src = src;
        this.mainImg.dataset.index = String(index);
        this.mainImg.alt = item.alt || '';
        this.mainImg.classList.remove('is-loading');
        this._emit('gallery:loaded', { index, src });
        this._animating = false;
        this._tmpImage = null;
      };

      const onTransEnd = (e) => {
        if (e && e.target !== tmp) return;
        tmp.removeEventListener('transitionend', onTransEnd);
        cleanup();
      };
      tmp.addEventListener('transitionend', onTransEnd);
      setTimeout(() => {
        if (this._animating) {
          try { tmp.removeEventListener('transitionend', onTransEnd); } catch (e) {}
          cleanup();
        }
      }, this._animDuration + 70);
    };

    const handleError = () => {
      if (tmp.parentNode) tmp.parentNode.removeChild(tmp);
      this.mainImg.classList.remove('is-loading');
      if (this.options.placeholder) this.mainImg.src = this.options.placeholder;
      this._emit('gallery:error', { index, src });
      this._animating = false;
      this._tmpImage = null;
    };

    tmp.addEventListener('load', handleLoad, { once: true });
    tmp.addEventListener('error', handleError, { once: true });
    tmp.src = src;
  }

  /**
   * Ensure the active thumbnail is visible within the scrollable container.
   *
   * @param {number} index Index of the active thumbnail.
   */
  _ensureThumbVisible(index) {
    if (!this._thumbContainer || !this._thumbs || !this._thumbs[index]) return;
    const el = this._thumbs[index];
    const container = this._thumbContainer;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (elTop < viewTop) container.scrollTo({ top: elTop - 8, behavior: 'smooth' });
    else if (elBottom > viewBottom) container.scrollTo({ top: elBottom - container.clientHeight + 8, behavior: 'smooth' });
  }

  /**
   * Navigate to the next image.
   */
  next() { this.show(this._clampIndex(this.current + 1)); }

  /**
   * Navigate to the previous image.
   */
  prev() { this.show(this._clampIndex(this.current - 1)); }

  /**
   * Open the modal view of the gallery.
   */
  openModal() {
    if (!this.modal || !this.modalImg) return;
    const src = this.images[this.current]?.src || this.mainImg?.src;
    if (src) this.modalImg.src = src;
    this._lastFocused = document.activeElement;
    this.modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    this._trapFocus();
    this.modal.setAttribute('aria-hidden', 'false');
    this._emit('gallery:open', { index: this.current, src });
    // Ensure navigation controls are present on first open
    if (this.options.nav) this._ensureNav();
  }

  /**
   * Close the modal view.
   */
  closeModal() {
    if (!this.modal) return;
    this.modal.hidden = true;
    if (this.modalImg) this.modalImg.src = '';
    document.documentElement.style.overflow = '';
    this._releaseFocusTrap();
    if (this._lastFocused && typeof this._lastFocused.focus === 'function') this._lastFocused.focus();
    this.modal.setAttribute('aria-hidden', 'true');
    this._emit('gallery:close', { index: this.current });
  }

  /**
   * Fully destroy the gallery instance, unbinding all listeners and
   * nullifying internal references.
   */
  destroy() {
    this._removeAllListeners();
    if (this._thumbScrollBtn) {
      try { this._thumbScrollBtn.remove(); } catch (e) {}
      this._thumbScrollBtn = null;
    }
    if (this._thumbScrollObserver) {
      try { this._thumbScrollObserver.disconnect(); } catch (e) {}
      this._thumbScrollObserver = null;
    }
    if (this._thumbScrollRAF) cancelAnimationFrame(this._thumbScrollRAF);
    if (this._dragRAF) cancelAnimationFrame(this._dragRAF);
    if (this._suppressClickTimer) { clearTimeout(this._suppressClickTimer); this._suppressClickTimer = null; }
    if (this._tmpImage && this._tmpImage.parentNode) try { this._tmpImage.parentNode.removeChild(this._tmpImage); } catch (e) {}
    this._tmpImage = null;
    this._thumbs = [];
    this.images = [];
    this.mainImg = null;
    this.modal = null;
    this.modalImg = null;
  }

  /**
   * Handler for clicks on the main image area. Opens the modal unless click
   * suppression is in effect (e.g., after a drag gesture).
   *
   * @param {Event} e The click event.
   */
  _onMainClick(e) {
    if (this._suppressClick) {
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      return;
    }
    if (e.target.closest && e.target.closest('button, a, input')) return;
    this.openModal();
  }

  /**
   * Root-level key handling for navigating images.
   *
   * @param {KeyboardEvent} e Key event.
   */
  _onRootKey(e) {
    if (this.modal && !this.modal.hidden) return;
    if (e.key === 'ArrowRight') this.next();
    if (e.key === 'ArrowLeft') this.prev();
  }

  /**
   * Attach core handlers to the main frame, root element, and modal. Also
   * initiates swipe handling on the main frame.
   */
  _bindHandlers() {
    if (this.mainFrame) this._addListener(this.mainFrame, 'click', this._bound._onMainClick);
    if (this.modal) {
      const closeBtn = this.modal.querySelector('.gallery-close');
      const overlay = this.modal.querySelector('.gallery-modal-overlay');
      if (closeBtn) this._addListener(closeBtn, 'click', () => this.closeModal());
      if (overlay) this._addListener(overlay, 'click', () => this.closeModal());
      this._addListener(this.modal, 'keydown', (e) => {
        if (this.modal.hidden) return;
        if (e.key === 'Escape') this.closeModal();
        if (e.key === 'ArrowRight') this.next();
        if (e.key === 'ArrowLeft') this.prev();
      });
    }
    if (this.mainFrame) this._bindPointerSwipe();
    this._addListener(this.root, 'keydown', (e) => this._onRootKey(e));
    if (!this.root.hasAttribute('tabindex')) this.root.setAttribute('tabindex', '0');
  }

  /**
   * Attach delegated handlers for thumbnails. Ensures that handlers are
   * bound only once per instance, even if called multiple times via
   * `renderThumbs()` or `refresh()`.
   */
  _bindThumbHandlers() {
    // Avoid duplicate bindings when called repeatedly
    if (this._thumbHandlersBound) return;
    if (!this._thumbContainer) return;
    const clickHandler = (e) => {
      const btn = e.target.closest('.gallery-thumb');
      if (!btn) return;
      e.preventDefault();
      this.show(btn);
      btn.focus();
    };
    const keyHandler = (e) => {
      const btn = e.target.closest('.gallery-thumb');
      if (!btn) return;
      const i = Number(btn.dataset.index);
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.show(btn);
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = this._thumbs[(i+1) % this._thumbs.length];
        next && next.focus();
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = this._thumbs[(i-1+this._thumbs.length) % this._thumbs.length];
        prev && prev.focus();
      }
    };
    // Store listener IDs for removal later
    this._thumbClickListenerId = this._addListener(this._thumbContainer, 'click', clickHandler);
    this._thumbKeyListenerId = this._addListener(this._thumbContainer, 'keydown', keyHandler);
    this._thumbHandlersBound = true;
    // Assign role and tabindex to thumbnails
    this._thumbs.forEach((thumb) => {
      if (!thumb.hasAttribute('role')) thumb.setAttribute('role', 'button');
      if (!thumb.hasAttribute('tabindex')) thumb.tabIndex = 0;
    });
  }

  /**
   * Remove delegated thumbnail handlers. This cleans up only the handlers
   * attached to the thumb container to avoid removing unrelated listeners.
   */
  _unbindThumbHandlers() {
    if (!this._thumbHandlersBound) return;
    if (this._thumbClickListenerId) this._removeListener(this._thumbClickListenerId);
    if (this._thumbKeyListenerId) this._removeListener(this._thumbKeyListenerId);
    this._thumbClickListenerId = null;
    this._thumbKeyListenerId = null;
    this._thumbHandlersBound = false;
  }

  /**
   * Bind pointer and touch swipe handlers for navigation on the main frame.
   */
  _bindPointerSwipe() {
    if (!this.mainFrame) return;

    const down = (e) => {
      if (e.button && e.button !== 0) return;
      if (this._animating) return;
      if (e.target.closest && e.target.closest('button, a, input, textarea, select')) return;
      this._drag.active = true;
      this._drag.pointerId = e.pointerId ?? 'touch';
      this._drag.startX = e.clientX;
      this._drag.startY = e.clientY;
      this._drag.lastDX = 0;
      this._drag.targetIndex = null;
      this._drag.direction = null;
      this._drag.moved = false;
      try { e.currentTarget && e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
      document.body.style.userSelect = 'none';
    };

    const move = (e) => {
      if (!this._drag.active || (e.pointerId !== undefined && e.pointerId !== this._drag.pointerId)) return;
      const dx = e.clientX - this._drag.startX;
      const dy = e.clientY - this._drag.startY;
      if (!this._drag.moved && Math.abs(dx) > 6) this._drag.moved = true;
      if (!this._drag.direction && Math.abs(dx) > 6) this._drag.direction = dx < 0 ? 'left' : 'right';
      this._drag.lastDX = dx;
      const width = this.mainFrame.clientWidth || this.mainImg.clientWidth || (window.innerWidth / 2);
      const sign = dx < 0 ? -1 : 1;
      const targetIdx = this._clampIndex(this.current + (sign < 0 ? 1 : -1));
      if (this.images.length <= 1 || targetIdx === this.current) {
        const damp = dx * 0.35;
        this._applyDragTransforms(damp, null, width);
        return;
      }
      if (this._drag.targetIndex !== targetIdx || !this._tmpImage) {
        if (this._tmpImage && this._tmpImage.parentNode) try { this._tmpImage.parentNode.removeChild(this._tmpImage); } catch (_) {}
        const tmp = document.createElement('img');
        this._tmpImage = tmp;
        tmp.decoding = 'async';
        tmp.loading = 'eager';
        tmp.draggable = false;
        Object.assign(tmp.style, {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          objectFit: this.mainImg.style.objectFit || 'contain',
          transition: 'none',
          zIndex: '2',
          willChange: 'transform, opacity'
        });
        const initialOffset = sign < 0 ? width : -width;
        tmp.style.transform = `translateX(${initialOffset}px)`;
        this.mainFrame.appendChild(tmp);
        const candidate = this.images[targetIdx];
        if (candidate && candidate.src) tmp.src = candidate.src;
        this._drag.targetIndex = targetIdx;
      }
      this._applyDragTransforms(dx, this._tmpImage, width);
      if (Math.abs(dx) > 8) e.preventDefault && e.preventDefault();
    };

    const up = (e) => {
      if (!this._drag.active || (e && e.pointerId !== undefined && e.pointerId !== this._drag.pointerId)) return;
      const dx = this._drag.lastDX;
      const abs = Math.abs(dx);
      const width = this.mainFrame.clientWidth || this.mainImg.clientWidth || (window.innerWidth / 2);
      try { e.currentTarget && e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
      document.body.style.userSelect = '';
      if (this._drag.moved) {
        this._suppressClick = true;
        clearTimeout(this._suppressClickTimer);
        this._suppressClickTimer = setTimeout(() => { this._suppressClick = false; this._suppressClickTimer = null; }, this._clickSuppressMs);
      }
      const sign = dx < 0 ? -1 : 1;
      const targetIdx = (this._drag.targetIndex != null) ? this._drag.targetIndex : this._clampIndex(this.current + (sign < 0 ? 1 : -1));
      const threshold = Math.min(this.options.swipeThreshold, Math.round(width * 0.18));
      if (this.images.length > 1 && abs > threshold && targetIdx !== this.current) {
        this._animateDragToComplete(sign, targetIdx, dx, width);
      } else {
        this._animateDragRollback();
      }
      this._drag.active = false;
      this._drag.pointerId = null;
      this._drag.lastDX = 0;
      this._drag.targetIndex = null;
      this._drag.direction = null;
      this._drag.moved = false;
    };

    const cancel = (e) => {
      if (!this._drag.active) return;
      try { e.currentTarget && e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
      document.body.style.userSelect = '';
      this._drag.active = false;
      this._drag.pointerId = null;
      this._drag.direction = null;
      this._drag.targetIndex = null;
      this._drag.moved = false;
      this._animateDragRollback();
    };

    this._pointerHandlers.down = down;
    this._pointerHandlers.move = move;
    this._pointerHandlers.up = up;
    this._pointerHandlers.cancel = cancel;

    this._addListener(this.mainFrame, 'pointerdown', down);
    this._addListener(this.mainFrame, 'pointermove', move);
    this._addListener(this.mainFrame, 'pointerup', up);
    this._addListener(this.mainFrame, 'pointercancel', cancel);

    const touchStart = (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      down({ pointerId: 'touch', clientX: t.clientX, clientY: t.clientY, currentTarget: this.mainFrame, target: e.target, button: 0 });
    };
    const touchMove = (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      move({ pointerId: 'touch', clientX: t.clientX, clientY: t.clientY, currentTarget: this.mainFrame, target: e.target, preventDefault: () => e.preventDefault() });
    };
    const touchEnd = (e) => {
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      up({ pointerId: 'touch', clientX: t ? t.clientX : 0, clientY: t ? t.clientY : 0, currentTarget: this.mainFrame, target: e.target });
    };

    this._addListener(this.mainFrame, 'touchstart', touchStart, { passive: true });
    this._addListener(this.mainFrame, 'touchmove', touchMove, { passive: false });
    this._addListener(this.mainFrame, 'touchend', touchEnd, { passive: true });
  }

  /**
   * Apply drag transforms to the main image and optional temporary image during swipe.
   *
   * @param {number} dx Horizontal delta.
   * @param {HTMLElement|null} tmpEl The temporary image element.
   * @param {number} width Width of the swipe area.
   */
  _applyDragTransforms(dx, tmpEl, width) {
    if (!this.mainImg) return;
    const resistance = this._drag.active && Math.abs(dx) > (width * 0.6) ? (width * 0.6) * Math.sign(dx) : dx;
    this.mainImg.style.transition = 'none';
    this.mainImg.style.transform = `translateX(${resistance}px)`;
    this.mainImg.style.opacity = String(Math.max(0.35, 1 - Math.abs(resistance) / (width * 1.2)));
    if (tmpEl) {
      tmpEl.style.transition = 'none';
      const sign = resistance < 0 ? 1 : -1;
      const baseOffset = sign > 0 ? width : -width;
      tmpEl.style.transform = `translateX(${baseOffset + resistance}px)`;
      tmpEl.style.opacity = '1';
    }
  }

  /**
   * Roll back a drag gesture when it doesn't meet the threshold to change images.
   */
  _animateDragRollback() {
    if (!this.mainImg) return;
    this.mainImg.style.transition = `transform ${Math.round(this._animDuration/1.5)}ms ease, opacity ${Math.round(this._animDuration/2)}ms ease`;
    this.mainImg.style.transform = 'translateX(0)';
    this.mainImg.style.opacity = '1';
    if (this._tmpImage) {
      const tmp = this._tmpImage;
      tmp.style.transition = `transform ${Math.round(this._animDuration/1.5)}ms ease, opacity ${Math.round(this._animDuration/2)}ms ease`;
      const width = this.mainFrame.clientWidth || this.mainImg.clientWidth || (window.innerWidth/2);
      const currentTransform = this._getTranslateXValue(tmp);
      const sign = currentTransform >= 0 ? 1 : -1;
      const final = sign > 0 ? width : -width;
      tmp.style.transform = `translateX(${final}px)`;
      tmp.style.opacity = '0';
      const cleanup = () => {
        if (tmp.parentNode) try { tmp.parentNode.removeChild(tmp); } catch (e) {}
        if (this._tmpImage === tmp) this._tmpImage = null;
      };
      tmp.addEventListener('transitionend', function once() { tmp.removeEventListener('transitionend', once); cleanup(); });
      setTimeout(cleanup, this._animDuration + 120);
    }
  }

  /**
   * Complete a drag gesture by animating to the next or previous image.
   *
   * @param {number} sign Direction sign (-1 or 1).
   * @param {number} targetIdx Target index.
   * @param {number} dx Delta x.
   * @param {number} width Width of the swipe area.
   */
  _animateDragToComplete(sign, targetIdx, dx, width) {
    if (!this.mainImg) return;
    if (this._animating) return;
    this._animating = true;
    const tmp = this._tmpImage;
    const dur = Math.round(this._animDuration * 0.9);
    this.mainImg.style.transition = `transform ${dur}ms cubic-bezier(.2,.9,.2,1), opacity ${Math.round(dur/2)}ms ease`;
    this.mainImg.style.transform = `translateX(${sign < 0 ? -width : width}px)`;
    this.mainImg.style.opacity = '0';
    if (tmp) {
      tmp.style.transition = `transform ${dur}ms cubic-bezier(.2,.9,.2,1), opacity ${Math.round(dur/2)}ms ease`;
      tmp.style.transform = 'translateX(0px)';
      tmp.style.opacity = '1';
    }
    const finish = () => {
      if (tmp && tmp.parentNode) try { tmp.parentNode.removeChild(tmp); } catch (e) {}
      this._tmpImage = null;
      const item = this.images[targetIdx];
      if (item && item.src) {
        this.mainImg.src = item.src;
        this.mainImg.dataset.index = String(targetIdx);
        this.mainImg.alt = item.alt || '';
      }
      this.mainImg.style.transition = '';
      this.mainImg.style.transform = 'translateX(0)';
      this.mainImg.style.opacity = '1';
      this._prevIndex = this.current;
      this.current = targetIdx;
      this._animating = false;
      this._emit('gallery:change', { index: this.current, src: this.mainImg.src, item: this.images[this.current] });
      this._emit('gallery:loaded', { index: this.current, src: this.mainImg.src });
      this._markActive(this.current);
      this._ensureThumbVisible(this.current);
    };
    let handled = false;
    const onEnd = () => {
      if (handled) return;
      handled = true;
      this.mainImg.removeEventListener('transitionend', onEnd);
      finish();
    };
    this.mainImg.addEventListener('transitionend', onEnd);
    setTimeout(() => { if (!handled) { handled = true; try { this.mainImg.removeEventListener('transitionend', onEnd); } catch (e) {} finish(); } }, dur + 150);
  }

  /**
   * Extract the current translateX value of an element. Used during drag rollback.
   *
   * @param {HTMLElement} el Element to inspect.
   * @returns {number} The computed translateX value.
   */
  _getTranslateXValue(el) {
    try {
      const s = getComputedStyle(el).transform;
      if (!s || s === 'none') return 0;
      const m = s.match(/matrix\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map(p=>parseFloat(p.trim()));
        return parts[4] || 0;
      }
      const m3 = s.match(/matrix3d\(([^)]+)\)/);
      if (m3) {
        const parts = m3[1].split(',').map(p=>parseFloat(p.trim()));
        return parts[12] || 0;
      }
    } catch (e) {}
    return 0;
  }

  /**
   * Trap keyboard focus within the modal when open.
   */
  _trapFocus() {
    if (!this.modal) return;
    const focusables = this.modal.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
    this._focusables = Array.from(focusables);
    if (!this._focusables.length) return;
    this._modalKeyHandler = (e) => {
      if (e.key !== 'Tab') return;
      const first = this._focusables[0];
      const last = this._focusables[this._focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    this.modal.addEventListener('keydown', this._modalKeyHandler);
    this._focusables[0].focus();
  }

  /**
   * Release focus trap when closing the modal.
   */
  _releaseFocusTrap() {
    if (!this.modal || !this._modalKeyHandler) return;
    this.modal.removeEventListener('keydown', this._modalKeyHandler);
    this._modalKeyHandler = null;
    this._focusables = null;
  }

  /**
   * Ensure navigation buttons exist in the modal. Only binds events once
   * per instance, preventing listener duplication. Called on first
   * `openModal()` if navigation is enabled.
   */
  _ensureNav() {
    if (!this.modal || this._navInitialized) return;
    const modalContent = this.modal.querySelector('.gallery-modal-content') || this.modal;
    if (!modalContent) return;
    if (!this.modal.querySelector(`.${this.options.navWrapperClass}`)) {
      const wrap = document.createElement('div');
      wrap.className = this.options.navWrapperClass;
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = this.options.navPrevClass;
      prev.setAttribute('aria-label', 'Предыдущее изображение');
      prev.innerHTML = '<i class="fa fa-chevron-left" aria-hidden="true"></i>';
      const next = document.createElement('button');
      next.type = 'button';
      next.className = this.options.navNextClass;
      next.setAttribute('aria-label', 'Следующее изображение');
      next.innerHTML = '<i class="fa fa-chevron-right" aria-hidden="true"></i>';
      wrap.appendChild(prev); wrap.appendChild(next); modalContent.appendChild(wrap);
      this._navWrap = wrap;
      this._navPrev = prev;
      this._navNext = next;
      this._addListener(prev, 'click', (e) => { e.preventDefault(); this.prev(); });
      this._addListener(next, 'click', (e) => { e.preventDefault(); this.next(); });
      this._addListener(prev, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.prev(); } });
      this._addListener(next, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.next(); } });
    } else {
      this._navWrap = this.modal.querySelector(`.${this.options.navWrapperClass}`);
      this._navPrev = this._navWrap.querySelector(`.${this.options.navPrevClass}`);
      this._navNext = this._navWrap.querySelector(`.${this.options.navNextClass}`);
      if (this._navPrev) this._addListener(this._navPrev, 'click', (e) => { e.preventDefault(); this.prev(); });
      if (this._navNext) this._addListener(this._navNext, 'click', (e) => { e.preventDefault(); this.next(); });
    }
    this._navInitialized = true;
  }

  /**
   * Manage the visibility of the thumbnail scroll button based on overflow.
   */
  _ensureThumbScroll() {
    if (!this._thumbContainer) return;
    if (!this._thumbScrollBtn) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = this.options.thumbScrollClass;
      btn.setAttribute('aria-label', 'Прокрутить миниатюры вниз');
      btn.innerHTML = `<i class="${this.options.thumbScrollIconClass}" aria-hidden="true"></i>`;
      this._thumbContainer.appendChild(btn);
      this._thumbScrollBtn = btn;
      this._thumbScrollHandler = (e) => { e.preventDefault(); const scrollAmount = Math.max(this._thumbContainer.clientHeight * 0.85, 120); this._thumbContainer.scrollBy({ top: scrollAmount, behavior: 'smooth' }); };
      this._addListener(btn, 'click', this._thumbScrollHandler);
    }

    const update = () => {
      if (!this._thumbContainer) return;
      const needsScroll = this._thumbContainer.scrollHeight > this._thumbContainer.clientHeight + 1;
      if (!this._thumbScrollBtn) return;
      const atBottom = this._thumbContainer.scrollTop + this._thumbContainer.clientHeight >= this._thumbContainer.scrollHeight - 2;
      this._thumbScrollBtn.hidden = !needsScroll || atBottom;
    };

    if (!this._thumbScrollAttached) {
      this._addListener(this._thumbContainer, 'scroll', () => { if (this._thumbScrollRAF) cancelAnimationFrame(this._thumbScrollRAF); this._thumbScrollRAF = requestAnimationFrame(update); });
      this._addListener(window, 'resize', () => { if (this._thumbScrollRAF) cancelAnimationFrame(this._thumbScrollRAF); this._thumbScrollRAF = requestAnimationFrame(update); });
      this._thumbScrollAttached = true;
    }

    if (this._thumbScrollObserver) this._thumbScrollObserver.disconnect();
    this._thumbScrollObserver = new MutationObserver(() => { if (this._thumbScrollRAF) cancelAnimationFrame(this._thumbScrollRAF); this._thumbScrollRAF = requestAnimationFrame(update); });
    this._thumbScrollObserver.observe(this._thumbContainer, { childList: true, subtree: true });
    requestAnimationFrame(update);
  }

  /**
   * Mark the active thumbnail. Updates ARIA attributes appropriately.
   *
   * @param {number} index Index of the active thumbnail.
   */
  _markActive(index) {
    if (!this._thumbs || !this._thumbs.length) return;
    this._thumbs.forEach((t, i) => {
      const is = i === index;
      t.classList.toggle('active', is);
      if (is) t.setAttribute('aria-current','true');
      else t.removeAttribute('aria-current');
    });
  }

  /**
   * Dispatch a custom event on the root element.
   *
   * @param {string} name Event name.
   * @param {Object} detail Event payload.
   */
  _emit(name, detail = {}) {
    try { this.root.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) {}
  }

  /**
   * Clamp an index according to circular or non-circular behaviour.
   *
   * @param {number} idx Desired index.
   * @returns {number} Clamped index.
   */
  _clampIndex(idx) {
    const n = this.images.length;
    if (n === 0) return 0;
    if (this.options.circular) return ((idx % n) + n) % n;
    return Math.max(0, Math.min(idx, n-1));
  }

  /**
   * Preload adjacent images to improve perceived performance when navigating.
   *
   * @param {number} index Index of the current image.
   */
  _preload(index) {
    const n = this.images.length;
    if (!n || this.options.preloadAdjacent <= 0) return;
    for (let d = 1; d <= this.options.preloadAdjacent; d++) {
      [index + d, index - d].forEach(i => {
        const j = this._clampIndex(i);
        const src = this.images[j]?.src;
        if (src) { const img = new Image(); img.src = src; }
      });
    }
  }
}