// ShopMatic/js/modules/Card.js
var Card = class {
  static UI_MESSAGES = Object.freeze({
    PRODUCT_LIMIT_DEFAULT: "\u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0435",
    PRODUCT_LIMIT_REACHED: "\u0412\u044B \u0434\u043E\u0441\u0442\u0438\u0433\u043B\u0438 \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0430 \u044D\u0442\u043E\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0430",
    NO_STOCK_TEXT: "\u0422\u043E\u0432\u0430\u0440\u0430 \u043D\u0435\u0442 \u0432 \u043D\u0430\u043B\u0438\u0447\u0438\u0438",
    CANNOT_ADD_NO_STOCK: "\u041D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C: \u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430.",
    ADDED_PARTIAL: "\u0412 \u043A\u043E\u0440\u0437\u0438\u043D\u0443 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E {added} \u0448\u0442. (\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E {available}).",
    FAVORITES_UNAVAILABLE: "\u041C\u043E\u0434\u0443\u043B\u044C \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D.",
    PRODUCT_LEFT: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A: {left}"
  });
  constructor(shopMatic = {}) {
    this.shopMatic = shopMatic;
    this._delegationHandlers = /* @__PURE__ */ new WeakMap();
    if (!this.shopMatic._delegationHandlers) this.shopMatic._delegationHandlers = /* @__PURE__ */ new Map();
    this._limitMsgClass = "product-limit-msg";
  }
  _msg(key, vars = {}) {
    const pool = this.constructor && this.constructor.UI_MESSAGES || {};
    const tpl = pool[key] ?? "";
    return String(tpl).replace(
      /\{([^}]+)\}/g,
      (m, k) => Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }
  _sel(root, selector) {
    return root?.querySelector?.(selector) ?? null;
  }
  _toggleDisabled(el, disabled) {
    if (!el) return;
    el.disabled = !!disabled;
    if (el.toggleAttribute) el.toggleAttribute("aria-disabled", !!disabled);
  }
  _createLimitMsg(text) {
    const d = document.createElement("div");
    d.className = this._limitMsgClass;
    d.textContent = text;
    d.style.cssText = "transition:opacity .25s ease;opacity:0;";
    return d;
  }
  _clampQty(rawVal, min = 1, max = Infinity) {
    let v = parseInt(rawVal ?? "", 10);
    if (isNaN(v) || v < min) v = min;
    if (v > max) v = max;
    return v;
  }
  _getIdFromElement(el) {
    if (!el?.getAttribute) return null;
    const attrs = ["data-product-id", "data-id", "data-name", "data-cart-id", "data-item-id"];
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (v) return v;
    }
    return el?.dataset?.productId || el?.dataset?.id || el?.dataset?.name || null;
  }
  _getCardSelectors(card) {
    return {
      leftNum: this._sel(card, ".leftNum"),
      stock: this._sel(card, ".stock"),
      buyBtn: this._sel(card, '[data-role="buy"], [data-action="buy"], .btn-buy'),
      incrBtn: this._sel(card, '[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]'),
      decrBtn: this._sel(card, '[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]'),
      qtyInput: this._sel(card, '[data-role="qty-input"], .qty-input, input[type="number"]'),
      controlsWrapper: this._sel(card, ".card-controls") || card
    };
  }
  _computeAvailableStock(id) {
    if (!id) return 0;
    try {
      const prod = this.shopMatic?.productService?.findById?.(id);
      if (prod && typeof prod.then === "function") return 0;
      const totalStock = Number(prod?.stock || 0);
      const inCartQty = this._findCartQtyById(id);
      return Math.max(0, totalStock - inCartQty);
    } catch (e) {
      return 0;
    }
  }
  _findCartQtyById(id) {
    try {
      const cartModule = this.shopMatic?.cart;
      const cartArray = Array.isArray(cartModule?.cart) ? cartModule.cart : Array.isArray(cartModule) ? cartModule : [];
      if (!Array.isArray(cartArray)) return 0;
      const keys = ["id", "productId", "name", "cartId", "itemId"];
      for (const it of cartArray) {
        if (!it) continue;
        for (const k of keys) {
          if (it[k] != null && String(it[k]) === String(id)) return Number(it.qty ?? it.quantity ?? 0) || 0;
        }
        if (String(it) === String(id)) return Number(it.qty ?? 0) || 0;
      }
    } catch (e) {
    }
    return 0;
  }
  _syncCardControlsState(card) {
    if (!card) return;
    const id = this._getIdFromElement(card);
    if (!id) return;
    const s = this._getCardSelectors(card);
    const available = this._computeAvailableStock(id);
    const hasAvailable = available > 0;
    requestAnimationFrame(() => {
      if (s.leftNum) s.leftNum.textContent = String(available);
      if (s.stock) {
        s.stock.textContent = String(this._msg("PRODUCT_LEFT", { left: available }));
        if (hasAvailable) s.stock.removeAttribute?.("hidden");
        else s.stock.setAttribute?.("hidden", "true");
      }
      this._toggleDisabled(s.buyBtn, !hasAvailable);
      if (s.qtyInput) {
        if (!hasAvailable) {
          s.qtyInput.value = "0";
          s.qtyInput.disabled = true;
          s.qtyInput.setAttribute("aria-disabled", "true");
        } else {
          s.qtyInput.disabled = false;
          s.qtyInput.removeAttribute?.("aria-disabled");
          const val = this._clampQty(s.qtyInput.value || "1", 1, available);
          s.qtyInput.value = String(val);
        }
      }
      const curVal = s.qtyInput ? Math.max(0, parseInt(s.qtyInput.value || "0", 10)) : 0;
      this._toggleDisabled(s.incrBtn, !hasAvailable || curVal >= available);
      this._toggleDisabled(s.decrBtn, curVal <= 1);
      const existing = card.querySelector?.(`.${this._limitMsgClass}`);
      if (!hasAvailable) {
        if (!existing) {
          const msg = this._createLimitMsg(this._msg("PRODUCT_LIMIT_DEFAULT"));
          (s.controlsWrapper || card).appendChild(msg);
          requestAnimationFrame(() => msg.style.opacity = "1");
        }
      } else if (existing) {
        existing.style.opacity = "0";
        setTimeout(() => existing?.parentNode?.removeChild(existing), 300);
      }
    });
  }
  /**
   * Attach delegated listeners to container. Safe: duplicates are ignored.
   */
  _bindCardDelegation(container = this.shopMatic?.root) {
    if (!container) return;
    if (!this.shopMatic._delegationHandlers) this.shopMatic._delegationHandlers = /* @__PURE__ */ new Map();
    if (this.shopMatic._delegationHandlers.has(container)) return;
    const findQtyControls = (el) => ({
      input: el?.querySelector?.('[data-role="qty-input"], .qty-input, input[type="number"]'),
      incr: el?.querySelector?.('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]'),
      decr: el?.querySelector?.('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]'),
      buy: el?.querySelector?.('[data-role="buy"], [data-action="buy"], .btn-buy')
    });
    const clampAndApplyQty = (inputEl, id) => {
      if (!inputEl) return;
      const available = this._computeAvailableStock(id);
      const v = this._clampQty(inputEl.value || "1", 1, Math.max(0, available));
      inputEl.value = String(v);
      const parent = inputEl.closest("[data-product-id], [data-id], [data-name], .cart-row, li") || inputEl.parentElement;
      const { incr, buy } = findQtyControls(parent);
      if (incr) this._toggleDisabled(incr, Math.max(0, available) === 0 || v >= available);
      if (buy) this._toggleDisabled(buy, Math.max(0, available) === 0);
      return v;
    };
    const clickHandler = (ev) => {
      const t = ev.target;
      const card = t.closest?.("[data-product-id], [data-id], [data-name], [data-cart-id], [data-item-id]") || null;
      const idFromCard = this._getIdFromElement(card);
      const favBtn = t.closest?.('[data-role="fav"], .fav-btn');
      if (favBtn && container.contains(favBtn)) {
        ev.stopPropagation();
        const id = this._getIdFromElement(favBtn.closest("[data-product-id], [data-id], [data-name], [data-cart-id], [data-item-id]")) || idFromCard;
        try {
          if (!this.shopMatic?.favorites) throw new Error("no favorites");
          const res = this.shopMatic.favorites.toggle(id);
          this.shopMatic.renderer?.updateProductCardFavState?.(container, id, this.shopMatic.favorites.isFavorite?.(id));
          if (typeof this.shopMatic._updateWishUI === "function") {
            try {
              this.shopMatic._updateWishUI();
            } catch (_) {
            }
          }
          const icon = favBtn.querySelector?.("i");
          if (icon) {
            icon.classList.add("animate-pop");
            setTimeout(() => icon.classList.remove("animate-pop"), 380);
          }
          if (res && typeof res.then === "function") res.catch(() => {
          });
        } catch (err) {
          this.shopMatic?.notifications?.show?.(this._msg("FAVORITES_UNAVAILABLE"), { type: "error" });
        }
        return;
      }
      const buyBtn = t.closest?.('[data-role="buy"], [data-action="buy"], .btn-buy');
      if (buyBtn && container.contains(buyBtn)) {
        ev.stopPropagation();
        const id = this._getIdFromElement(buyBtn.closest("[data-product-id], [data-id], [data-name]")) || idFromCard;
        const { input } = findQtyControls(card);
        const desired = input ? Math.max(1, parseInt(input.value || "1", 10)) : 1;
        const available = this._computeAvailableStock(id);
        if (available <= 0) {
          this.shopMatic.notifications?.show?.(this._msg("CANNOT_ADD_NO_STOCK"), { duration: this.shopMatic.opts?.notificationDuration });
          this.shopMatic._syncAllCardsControls?.();
          return;
        }
        const qtyToAdd = Math.min(desired, available);
        if (qtyToAdd < desired) {
          this.shopMatic.notifications?.show?.(this._msg("ADDED_PARTIAL", { added: qtyToAdd, available }), { duration: this.opts?.notificationDuration || this.shopMatic.opts?.notificationDuration });
        }
        const res = this.shopMatic.cart?.add?.(id, qtyToAdd);
        if (res && typeof res.then === "function") {
          res.then(() => this._syncCardControlsState(card)).catch(() => this._syncCardControlsState(card));
        } else {
          this._syncCardControlsState(card);
        }
        return;
      }
      const decrBtn = t.closest?.('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]');
      if (decrBtn && container.contains(decrBtn)) {
        ev.stopPropagation();
        const row = decrBtn.closest("[data-product-id], [data-id], [data-name], .cart-row") || decrBtn.closest("li") || decrBtn.parentElement;
        const id = this._getIdFromElement(row) || idFromCard;
        const { input, incr } = findQtyControls(row);
        if (!input) return;
        let newVal = Math.max(1, parseInt(input.value || "1", 10) - 1);
        const available = this._computeAvailableStock(id);
        const maxStock = Number.isFinite(available) ? Math.max(0, available) : 0;
        if (newVal > maxStock) newVal = maxStock;
        input.value = String(newVal);
        if (incr) this._toggleDisabled(incr, maxStock === 0 || newVal >= maxStock);
        const changeRes = this.shopMatic.changeQty?.(id, newVal);
        if (changeRes && typeof changeRes.then === "function") changeRes.catch(() => {
        });
        this._syncCardControlsState(row);
        return;
      }
      const incrBtn = t.closest?.('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]');
      if (incrBtn && container.contains(incrBtn)) {
        ev.stopPropagation();
        const row = incrBtn.closest("[data-product-id], [data-id], [data-name], .cart-row") || incrBtn.closest("li") || incrBtn.parentElement;
        const id = this._getIdFromElement(row) || idFromCard;
        const { input } = findQtyControls(row);
        if (!input) return;
        const available = this._computeAvailableStock(id);
        const maxStock = Number.isFinite(available) ? Math.max(0, available) : 0;
        let newVal = Math.min(maxStock, parseInt(input.value || "1", 10) + 1);
        if (isNaN(newVal) || newVal < 1) newVal = 1;
        input.value = String(newVal);
        this._toggleDisabled(incrBtn, maxStock === 0 || newVal >= maxStock);
        const { buy } = findQtyControls(row);
        if (buy) this._toggleDisabled(buy, maxStock === 0);
        const changeRes = this.shopMatic.changeQty?.(id, newVal);
        if (changeRes && typeof changeRes.then === "function") changeRes.catch(() => {
        });
        this._syncCardControlsState(row);
        return;
      }
    };
    const inputHandler = (ev) => {
      const input = ev.target;
      if (!input?.matches?.('[data-role="qty-input"], .qty-input, input[type="number"]')) return;
      const row = input.closest("[data-product-id], [data-id], [data-name], .cart-row") || input.parentElement;
      const id = this._getIdFromElement(row);
      const clamped = clampAndApplyQty(input, id);
      if (clamped !== void 0) {
        const changeRes = this.shopMatic.changeQty?.(id, clamped);
        if (changeRes && typeof changeRes.then === "function") changeRes.catch(() => {
        });
        this._syncCardControlsState(row);
      }
    };
    try {
      container.addEventListener("click", clickHandler, { passive: true });
      container.addEventListener("input", inputHandler);
      const handlers = { clickHandler, inputHandler };
      this._delegationHandlers.set(container, handlers);
      this.shopMatic._delegationHandlers.set(container, handlers);
    } catch (e) {
      if (this.shopMatic?.opts?.debug) console.error("[Card] attach listeners failed", e);
    }
  }
  destroyDelegation(container = null) {
    try {
      if (!this.shopMatic._delegationHandlers) return;
      if (container) {
        const h = this.shopMatic._delegationHandlers.get(container);
        if (h) {
          try {
            container.removeEventListener("click", h.clickHandler);
          } catch (_) {
          }
          try {
            container.removeEventListener("input", h.inputHandler);
          } catch (_) {
          }
          this.shopMatic._delegationHandlers.delete(container);
        }
        try {
          this._delegationHandlers.delete(container);
        } catch (_) {
        }
        return;
      }
      for (const [cont, h] of Array.from(this.shopMatic._delegationHandlers.entries())) {
        try {
          cont.removeEventListener("click", h.clickHandler);
        } catch (_) {
        }
        try {
          cont.removeEventListener("input", h.inputHandler);
        } catch (_) {
        }
        this.shopMatic._delegationHandlers.delete(cont);
      }
      this._delegationHandlers = /* @__PURE__ */ new WeakMap();
    } catch (e) {
      if (this.shopMatic?.opts?.debug) console.error("[Card] destroyDelegation failed", e);
    }
  }
  _syncAllCardsIn(container = this.shopMatic?.root) {
    if (!container) return;
    const cards = container.querySelectorAll?.("[data-product-id], [data-id], [data-name], .product-card, .catalog-item") || [];
    for (const c of cards) {
      try {
        this._syncCardControlsState(c);
      } catch (_) {
      }
    }
  }
};

// ShopMatic/js/modules/utils.js
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function debounce(fn, ms = 200) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
function pluralize(n, forms) {
  n = Math.abs(n) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}
function formatPrice(amount, currency = "RUB") {
  if (isNaN(amount) || amount === null) {
    throw new Error("Invalid amount");
  }
  const options = {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    // отображать минимум 2 знака после запятой
    maximumFractionDigits: 2
    // отображать максимум 2 знака после запятой
  };
  const formatter = new Intl.NumberFormat("ru-RU", options);
  return formatter.format(amount);
}
function makeSpecHtmlPreview(specs) {
  if (arguments.length === 0 || specs == null) return "";
  let data = specs;
  if (typeof specs === "string") {
    specs = specs.trim();
    if (!specs) return "";
    try {
      data = JSON.parse(specs);
    } catch {
      return "";
    }
  }
  if (typeof data !== "object" || Array.isArray(data) || !Object.keys(data).length) {
    return "";
  }
  let html = '<strong>\u041E\u0441\u043D\u043E\u0432\u043D\u044B\u0435 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438:</strong><div class="specsBlock">';
  for (const [key, value] of Object.entries(data)) {
    html += `<div class="specsEntry">
  <div class="specsTitle">${escapeHtml(key)}</div>
  <div class="separator" aria-hidden="true"></div>
  <div class="specsValue">${escapeHtml(value)}</div>
</div>
`;
  }
  html += "</div>";
  return html;
}

// ShopMatic/js/modules/ProductService.js
var ProductService = class {
  /**
   * Статические текстовые сообщения для вывода пользователю
   * @type {Readonly<Record<string,string>>}
   */
  static UI_MESSAGES = Object.freeze({
    ERROR_NO_ENGINE: "\u0418\u043D\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u044F \u0441 \u0431\u0435\u043A\u0435\u043D\u0434\u043E\u043C \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430",
    ERROR_TIMEOUT: "\u0417\u0430\u043F\u0440\u043E\u0441 \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u0430 \u043F\u0440\u0435\u0432\u044B\u0441\u0438\u043B \u0432\u0440\u0435\u043C\u044F \u043E\u0436\u0438\u0434\u0430\u043D\u0438\u044F",
    LOAD_PRODUCTS_ERROR: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0441\u043F\u0438\u0441\u043A\u0430 \u0442\u043E\u0432\u0430\u0440\u043E\u0432",
    FETCH_BY_ID_ERROR: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0434\u0430\u043D\u043D\u044B\u0445 \u0442\u043E\u0432\u0430\u0440\u0430",
    FETCH_CATEGORIES_ERROR: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0439",
    FILL_CATEGORIES_WARN: "ProductService.fillCategories: \u043E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0438 select",
    ALL_CATEGORIES_OPTION: "\u0412\u0441\u0435 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438",
    ALL_BRANDS_OPTION: "\u0412\u0441\u0435 \u0431\u0440\u0435\u043D\u0434\u044B",
    SUBSCRIBE_ARG_ERROR: "subscribe \u043E\u0436\u0438\u0434\u0430\u0435\u0442 \u0444\u0443\u043D\u043A\u0446\u0438\u044E",
    UPSERT_ERROR: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F/\u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0442\u043E\u0432\u0430\u0440\u0430"
  });
  /**
   * @param {any} foxEngine Экземпляр движка отправки запросов
   * @param {Object} [opts]
   * @param {Object} [opts.endpoints] Переопределения имён эндпоинтов
   * @param {number} [opts.timeoutMs] Таймаут запросов в миллисекундах
   * @param {boolean} [opts.debug] Включить логирование
   */
  constructor(foxEngine, opts = {}) {
    if (!foxEngine) throw new TypeError("ProductService requires foxEngine");
    this.foxEngine = foxEngine;
    const {
      endpoints = {
        products: "getProducts",
        productById: "getProduct",
        categories: "getCategories",
        brands: "getBrands"
      },
      timeoutMs = 7e3,
      debug = false
    } = opts;
    this.opts = { endpoints, timeoutMs, debug };
    this.products = [];
    this._productMap = /* @__PURE__ */ new Map();
    this._categoriesMap = /* @__PURE__ */ new Map();
    this._brandsMap = /* @__PURE__ */ new Map();
    this._subscribers = /* @__PURE__ */ new Set();
  }
  /* ---------------------- utils ---------------------- */
  /**
   * Подстановка значений в строку сообщений
   * @param {string} key
   * @param {Record<string,string|number>} vars
   * @returns {string}
   */
  _msg(key, vars = {}) {
    const tpl = this.constructor && this.constructor.UI_MESSAGES && this.constructor.UI_MESSAGES[key] || "";
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) => Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m);
  }
  /**
   * Нормализует идентификатор в строку
   * @param {any} v
   * @returns {string}
   */
  _normalizeId(v) {
    if (v === void 0 || v === null) return "";
    return String(v).trim();
  }
  /**
   * Логирование в debug режиме
   * @param {...any} args
   */
  _log(...args) {
    if (!this.opts.debug) return;
    const logger = typeof this.foxEngine.log === "function" ? this.foxEngine.log.bind(this.foxEngine) : console.debug;
    try {
      logger(...args);
    } catch (e) {
      console.debug(...args);
    }
  }
  /**
   * Безопасный вызов удалённого метода с таймаутом
   * @param {any} payload
   * @param {string} expect
   * @returns {Promise<any>}
   */
  async _safeCall(payload = {}, expect = "JSON") {
    const call = this.foxEngine.sendPostAndGetAnswer(payload, expect);
    const timeout = Number(this.opts.timeoutMs) || 7e3;
    if (!timeout || timeout <= 0) return call;
    return Promise.race([
      call,
      new Promise((_, rej) => setTimeout(() => rej(new Error(this._msg("ERROR_TIMEOUT"))), timeout))
    ]);
  }
  /**
   * Извлекает массив из ответа бекенда по предпочтительному списку ключей.
   * @param {any} res
   * @param {Array<string>} prefer
   * @returns {Array<any>}
   */
  _extractArray(res, prefer = ["items", "products", "data", "categories", "brands", "list"]) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (typeof res !== "object") return [];
    for (const k of prefer) if (Array.isArray(res[k])) return res[k];
    for (const k of Object.keys(res)) if (Array.isArray(res[k])) return res[k];
    return [res];
  }
  /**
   * Записывает значение в карту, если ключ существует и не был записан ранее (или если overwrite=true)
   * @param {Map<string,any>} map
   * @param {string} key
   * @param {any} value
   * @param {boolean} [overwrite=false]
   */
  _setCache(map, key, value, overwrite = false) {
    if (!key) return;
    if (overwrite || !map.has(key)) map.set(key, value);
  }
  /**
   * Уведомляет всех подписчиков об изменениях
   * @param {Object} change
   */
  _notifySubscribers(change = { type: "set", changedIds: [] }) {
    for (const fn of this._subscribers) {
      try {
        fn(change);
      } catch (e) {
        this._log("subscriber error", e);
      }
    }
  }
  /* ---------------------- normalization helpers ---------------------- */
  /**
   * Разбирает и нормализует поля категории из сырого продукта
   * @param {Object} raw
   * @returns {{ key: string, name: string }}
   */
  _parseCategory(raw) {
    const rawCat = raw.category ?? raw.cat ?? raw.categoryId ?? "";
    const key = this._normalizeId(rawCat);
    const name = String(raw.categoryName ?? raw.categoryFullname ?? "").trim();
    return { key, name };
  }
  /**
   * Разбирает и нормализует поля бренда из сырого продукта
   * @param {Object} raw
   * @returns {{ key: string, name: string }}
   */
  _parseBrand(raw) {
    let rawBrand = raw.brand ?? raw.brandId ?? "";
    if (typeof rawBrand === "object") rawBrand = rawBrand.id ?? rawBrand.key ?? rawBrand.name ?? "";
    const key = this._normalizeId(rawBrand);
    const name = String(raw.brandName ?? raw.brandFullname ?? "").trim();
    return { key, name };
  }
  /**
   * Гарантирует наличие человеческих имён для категории и бренда (асинхронно)
   * @param {string} categoryKey
   * @param {string} brandKey
   * @param {string} fallbackCategory
   * @param {string} fallbackBrand
   * @returns {Promise<[string,string]>}
   */
  async _resolveBrandAndCategoryNames(categoryKey, brandKey, fallbackCategory = "", fallbackBrand = "") {
    const ensureBrandName = async () => {
      if (!brandKey) return "";
      const fetched = await this.fetchBrandNameById(brandKey);
      return fetched;
    };
    const ensureCatName = async () => {
      if (!categoryKey) return "";
      const fetched = await this.fetchCatById(categoryKey);
      return fetched;
    };
    const [brandNameResolved, catNameResolved] = await Promise.all([ensureBrandName(), ensureCatName()]);
    const finalBrandName = fallbackBrand || brandNameResolved || brandKey;
    const finalCatName = fallbackCategory || catNameResolved || categoryKey;
    return [finalCatName, finalBrandName];
  }
  /**
   * Нормализует одну запись продукта. Пополняет кэш категорий и брендов.
   * @param {any} raw
   * @returns {Promise<Object|null>}
   */
  async _normalizeProduct(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = this._normalizeId(raw.name ?? raw.id ?? raw.title ?? raw.fullname ?? raw.sku);
    if (!name) return null;
    const title = String(raw.fullname ?? raw.title ?? raw.name ?? "").trim();
    const price = Number(raw.price ?? raw.cost ?? 0);
    const oldPrice = Number(raw.oldPrice ?? raw.price_old ?? 0);
    const stock = Number(raw.stock ?? raw.count ?? raw.qty ?? 0);
    const picture = String(raw.picture ?? raw.image ?? raw.img ?? "/assets/no-image.png");
    const { key: categoryKey, name: categoryNameInput } = this._parseCategory(raw);
    const { key: brandKey, name: brandNameInput } = this._parseBrand(raw);
    const [resolvedCatName, resolvedBrandName] = await this._resolveBrandAndCategoryNames(categoryKey, brandKey, categoryNameInput, brandNameInput);
    if (categoryKey && resolvedCatName) this._setCache(this._categoriesMap, categoryKey, resolvedCatName);
    if (brandKey && resolvedBrandName) this._setCache(this._brandsMap, brandKey, resolvedBrandName);
    return {
      _raw: raw,
      name,
      fullname: title,
      title,
      price,
      oldPrice,
      stock,
      picture,
      category: categoryKey,
      categoryName: resolvedCatName,
      brand: brandKey,
      brandName: resolvedBrandName,
      short: raw.short ?? raw.description ?? "",
      specs: raw.specs ?? raw.properties ?? raw.attributes ?? {}
    };
  }
  /* ---------------------- products API ---------------------- */
  /**
   * Возвращает список продуктов. По умолчанию возвращает копию.
   * @param {Object} [param0]
   * @param {boolean} [param0.clone=true]
   * @returns {Array<any>}
   */
  getProducts({ clone = true } = {}) {
    return clone ? this.products.map((p) => Object.assign({}, p)) : this.products;
  }
  /**
   * Находит продукт по нормализованному id
   * @param {any} id
   * @returns {any|null}
   */
  findById(id) {
    const sid = this._normalizeId(id);
    return sid ? this._productMap.get(sid) || null : null;
  }
  /**
   * Загружает список товаров. Можно указать force=true для принудительного обновления.
   * @param {Object} [options]
   * @param {boolean} [options.force=false]
   * @param {any} [options.request=null] Переопределение запроса
   * @returns {Promise<Array<any>>}
   */
  async loadProductsSimple({ force = false, request = null } = {}) {
    const defaultEndpoint = this.opts.endpoints.products;
    let endpoint = defaultEndpoint;
    let payload = { sysRequest: endpoint };
    if (request) {
      if (typeof request === "string") {
        endpoint = request;
        payload.sysRequest = endpoint;
      } else {
        const { endpoint: reqEndpoint, sysRequest: reqSys, payload: reqPayload, params: reqParams, ...extra } = request;
        endpoint = reqEndpoint ?? reqSys ?? defaultEndpoint;
        payload = Object.assign({}, reqParams ?? {}, reqPayload ?? {}, extra ?? {}, { sysRequest: endpoint });
      }
    }
    try {
      const res = await this._safeCall(payload, "JSON");
      const items = this._extractArray(res, ["items", "products", "data"]);
      const normalized = await Promise.all(items.map((i) => this._normalizeProduct(i)).filter(Boolean));
      this.products = normalized;
      this._rebuildMaps();
      for (const p of this.products) {
        if (p.category && !this._categoriesMap.has(p.category)) this._categoriesMap.set(p.category, p.categoryName || p.category);
        if (p.brand && !this._brandsMap.has(p.brand)) this._brandsMap.set(p.brand, p.brandName);
      }
      this._notifySubscribers({ type: "reload", changedIds: this.products.map((p) => p.name) });
      return this.getProducts();
    } catch (err) {
      this._log(this._msg("LOAD_PRODUCTS_ERROR"), err);
      this.products = this.products || [];
      this._rebuildMaps();
      return this.getProducts();
    }
  }
  /**
   * Загружает продукт по ID (если нет в кеше).
   * @param {any} id
   * @returns {Promise<any|null>}
   */
  async fetchById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return null;
    const existing = this.findById(sid);
    if (existing) return existing;
    const endpoint = this.opts.endpoints.productById;
    try {
      const res = await this._safeCall({ sysRequest: endpoint, id: sid }, "JSON");
      const items = this._extractArray(res, ["product", "items", "products", "data"]);
      const raw = items.length ? items[0] : res.product ?? res;
      if (!raw) return null;
      const normalized = await this._normalizeProduct(raw);
      if (!normalized) return null;
      this.products.push(normalized);
      this._productMap.set(normalized.name, normalized);
      if (normalized.category) this._setCache(this._categoriesMap, normalized.category, normalized.categoryName || normalized.category);
      if (normalized.brand) this._setCache(this._brandsMap, normalized.brand, normalized.brandName || normalized.brand);
      this._notifySubscribers({ type: "add", changedIds: [normalized.name] });
      return normalized;
    } catch (err) {
      this._log(this._msg("FETCH_BY_ID_ERROR"), err);
      return null;
    }
  }
  /**
   * Заменяет текущий список продуктов новым массивом. Данные предварительно нормализуются.
   * @param {Array<any>} rawProducts
   * @returns {Promise<boolean>}
   */
  async setProducts(rawProducts = []) {
    const arr = Array.isArray(rawProducts) ? rawProducts : [];
    try {
      const normalized = await Promise.all(arr.map((r) => this._normalizeProduct(r)).filter(Boolean));
      this.products = normalized;
      this._rebuildMaps();
      for (const p of this.products) {
        if (p.category && !this._categoriesMap.has(p.category)) this._categoriesMap.set(p.category, p.categoryName || p.category);
        if (p.brand && !this._brandsMap.has(p.brand)) this._brandsMap.set(p.brand, p.brandName || p.brand);
      }
      this._notifySubscribers({ type: "set", changedIds: this.products.map((p) => p.name) });
      return true;
    } catch (err) {
      this._log(this._msg("LOAD_PRODUCTS_ERROR"), err);
      return false;
    }
  }
  /**
   * Перестраивает внутренние карты по текущему массиву продуктов
   */
  _rebuildMaps() {
    this._productMap.clear();
    for (const p of this.products) {
      if (!p || !p.name) continue;
      const key = this._normalizeId(p.name);
      this._productMap.set(key, p);
      if (p.brand) this._setCache(this._brandsMap, p.brand, p.brandName || p.brand);
      if (p.category) this._setCache(this._categoriesMap, p.category, p.categoryName || p.category);
    }
  }
  /* ---------------------- categories / brands (fetch helpers) ---------------------- */
  /**
   * Запрашивает список сущностей (brands | categories) с бэкенда
   * @param {string} entity
   * @returns {Promise<Array<any>>}
   */
  async fetchList(entity) {
    const endpoint = this.opts.endpoints[entity];
    const res = await this._safeCall({ sysRequest: endpoint }, "JSON");
    return this._extractArray(res, [entity, "data", "items", "list"]);
  }
  /**
   * Получает сущность по id (brand или category)
   * @param {string} entity
   * @param {any} id
   * @returns {Promise<any|null>}
   */
  async fetchEntityById(entity, id) {
    const endpoint = this.opts.endpoints[`${entity}`];
    const sid = this._normalizeId(id);
    if (!sid) return null;
    const res = await this._safeCall({ sysRequest: endpoint, id: sid }, "JSON");
    const arr = this._extractArray(res, [entity, "data", "items"]);
    if (Array.isArray(arr) && arr.length) {
      const found = arr.find((x) => {
        if (!x) return false;
        const candidates = [x.id, x.key, x.name, x.code].map((v) => this._normalizeId(v)).filter(Boolean);
        return candidates.includes(sid);
      });
      return found;
    }
    return res;
  }
  /**
   * Запрашивает и обновляет список категорий
   * @returns {Promise<Array<{name:string, fullname:string}>>}
   */
  async fetchCategories() {
    try {
      const arr = await this.fetchList("categories");
      const out = arr.map((c) => {
        if (!c) return null;
        if (typeof c === "string") return { name: c, fullname: c };
        return { name: c.name ?? c.id ?? "", fullname: c.fullname ?? c.name ?? c.title ?? "" };
      }).filter(Boolean);
      for (const c of out) this._setCache(this._categoriesMap, String(c.name).trim(), String(c.fullname).trim() || String(c.name).trim());
      return out.length ? out : Array.from(this._categoriesMap.entries()).map(([name, fullname]) => ({ name, fullname }));
    } catch (err) {
      this._log(this._msg("FETCH_CATEGORIES_ERROR"), err);
      return Array.from(this._categoriesMap.entries()).map(([name, fullname]) => ({ name, fullname }));
    }
  }
  /**
   * Запрашивает и обновляет список брендов
   * @returns {Promise<Array<{id:string, name:string, fullname:string}>>}
   */
  async fetchBrands() {
    try {
      const arr = await this.fetchList("brands");
      const out = arr.map((b) => {
        if (!b) return null;
        if (typeof b === "string") {
          const id2 = this._normalizeId(b);
          return { id: id2, name: b, fullname: b };
        }
        const id = this._normalizeId(b.id ?? b.key ?? b.name ?? "");
        if (!id) return null;
        const name = String(b.name ?? b.fullname ?? b.title ?? b.label ?? id).trim();
        const fullname = String(b.fullname ?? name).trim() || name || id;
        return { id, name, fullname };
      }).filter(Boolean);
      for (const b of out) this._setCache(this._brandsMap, b.id, b.fullname || b.name);
      for (const p of this.products) {
        const bid = this._normalizeId(p.brand);
        if (!bid) continue;
        if (!this._brandsMap.has(bid)) this._brandsMap.set(bid, p.brandName || p.brand || bid);
      }
      return out.length ? out : Array.from(this._brandsMap.entries()).map(([id, fullname]) => ({ id, name: fullname, fullname }));
    } catch (err) {
      this._log("ProductService.fetchBrands failed", err);
      const map = /* @__PURE__ */ new Map();
      for (const p of this.products) {
        const bid = this._normalizeId(p.brand);
        if (!bid) continue;
        const name = p.brandName || p.brand || bid;
        if (!map.has(bid)) map.set(bid, name);
        if (!this._brandsMap.has(bid)) this._brandsMap.set(bid, name);
      }
      return Array.from(map.entries()).map(([id, name]) => ({ id, name, fullname: name }));
    }
  }
  /**
   * Получить название бренда по id из кеша или из продукта
   * @param {any} id
   * @returns {string}
   */
  getBrandNameById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return "";
    if (this._brandsMap.has(sid)) return this._brandsMap.get(sid);
    for (const p of this.products) {
      const bid = this._normalizeId(p.brand);
      if (bid === sid) {
        const nm = p.brandName || p.brand || bid;
        this._brandsMap.set(sid, nm);
        return nm;
      }
    }
    return "";
  }
  /**
   * Асинхронно запрашивает название бренда по id с бэкенда
   * @param {any} id
   * @returns {Promise<string>}
   */
  async fetchBrandNameById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return "";
    try {
      const item = await this.fetchEntityById("brands", sid);
      if (!item) return "";
      const bid = this._normalizeId(item.name) || sid;
      const fullname = String(item.fullname).trim() || bid;
      this._brandsMap.set(bid, fullname);
      return fullname;
    } catch (err) {
      this._log("ProductService.fetchBrandNameById failed", err);
      return this.getBrandNameById(sid);
    }
  }
  /**
   * Получить название категории по id из кеша или из продукта
   * @param {any} id
   * @returns {string}
   */
  getCatNameById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return "";
    if (this._categoriesMap.has(sid)) return this._categoriesMap.get(sid);
    for (const p of this.products) {
      const cid = this._normalizeId(p.category);
      if (cid === sid) {
        const nm = p.categoryName || cid;
        this._categoriesMap.set(sid, nm);
        return nm;
      }
    }
    return "";
  }
  /**
   * Асинхронно запрашивает название категории по id с бэкенда
   * @param {any} id
   * @returns {Promise<string>}
   */
  async fetchCatById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return "";
    try {
      const item = await this.fetchEntityById("categories", sid);
      if (!item) return "";
      const cid = this._normalizeId(item.name) || sid;
      const fullname = String(item.fullname).trim() || cid;
      this._categoriesMap.set(cid, fullname);
      return fullname;
    } catch (err) {
      this._log("ProductService.fetchCatById failed", err);
      return this.getCatNameById(sid);
    }
  }
  /* ---------------------- fill select generic ---------------------- */
  /**
   * Универсальный наполнитель <select> на основе списка сущностей и данных из products.
   * Дубликаты объединяются по «слагу», строка 'undefined' считается пустой.
   * option.value равен id (если есть) либо name; data-id = оригинальный id (если есть),
   * data-fullname = fullname, data-name = name.
   *
   * @param {HTMLElement|string|null} selectEl
   * @param {Object} param1
   * @param {string} param1.entity (например, 'categories' или 'brands')
   * @param {string} param1.productProp (например, 'category' или 'brand')
   * @param {boolean} [param1.includeAllOption=true]
   * @param {boolean} [param1.onlyFromProducts=false]
   * @param {boolean} [param1.sort=true]
   * @param {string} [param1.allMsgKey='ALL_CATEGORIES_OPTION']
   * @returns {Promise<boolean>}
   */
  /**
   * Универсальный наполнитель <select> на основе списка сущностей и данных из products.
   * Дубликаты объединяются по «слагу», строка 'undefined' считается пустой.
   * option.value равен id (если есть) либо name; data-id = оригинальный id (если есть),
   * data-fullname = fullname, data-name = name.
   *
   * @param {HTMLElement|string|null} selectEl
   * @param {Object} param1
   * @param {string} param1.entity (например, 'categories' или 'brands')
   * @param {string} param1.productProp (например, 'category' или 'brand')
   * @param {boolean} [param1.includeAllOption=true]
   * @param {boolean} [param1.onlyFromProducts=false]
   * @param {boolean} [param1.sort=true]
   * @param {string} [param1.allMsgKey='ALL_CATEGORIES_OPTION']
   * @param {string} [param1.selected=""] значение, которое должно быть выбрано
   * @returns {Promise<boolean>}
   */
  async _fillSelectGeneric(selectEl, {
    entity = "categories",
    productProp = "category",
    includeAllOption = true,
    onlyFromProducts = false,
    sort = true,
    allMsgKey = "ALL_CATEGORIES_OPTION",
    selected = ""
    // <--- вот он
  } = {}) {
    if (typeof selectEl === "string") selectEl = document.querySelector(selectEl);
    if (!selectEl) return false;
    const slug = (str) => String(str).toLowerCase().replace(/\s+/g, "");
    const collected = /* @__PURE__ */ new Map();
    const add = (id, name, fullname) => {
      const safeName = name && name.toLowerCase() !== "undefined" ? name : "";
      const safeFullname = fullname && fullname.toLowerCase() !== "undefined" ? fullname : "";
      const human = safeFullname || safeName || id;
      if (!human) return;
      const key = slug(human);
      const entry = collected.get(key) || { id: "", name: "", fullname: "" };
      if (!entry.id && id) entry.id = id;
      if (!entry.name && safeName) entry.name = safeName;
      if (!entry.fullname && safeFullname) entry.fullname = safeFullname;
      collected.set(key, entry);
    };
    if (!onlyFromProducts) {
      const list = await this.fetchList(entity).catch((e) => {
        this._log(`fetchList(${entity}) failed`, e);
        return [];
      });
      for (const it of list) {
        if (!it) continue;
        if (typeof it === "string") {
          add(it, it, it);
        } else {
          const id = this._normalizeId(it.id ?? it.key ?? it.name);
          const name = it.name != null ? String(it.name).trim() : "";
          const fullname = it.fullname != null ? String(it.fullname).trim() : "";
          add(id, name, fullname);
          if (entity === "brands") {
            const nm = fullname && fullname.toLowerCase() !== "undefined" ? fullname : name;
            if (id && nm) this._brandsMap.set(id, nm);
          }
          if (entity === "categories") {
            const nm = fullname && fullname.toLowerCase() !== "undefined" ? fullname : name;
            if (id && nm) this._categoriesMap.set(id, nm);
          }
        }
      }
    }
    if (!onlyFromProducts) {
      for (const p of this.products) {
        const id = this._normalizeId(p[productProp]);
        const name = p[`${productProp}Name`] != null ? String(p[`${productProp}Name`]).trim() : "";
        const fullname = p[`${productProp}Fullname`] != null ? String(p[`${productProp}Fullname`]).trim() : "";
        add(id, name, fullname);
        if (entity === "brands") {
          const nm = fullname && fullname.toLowerCase() !== "undefined" ? fullname : name;
          if (id && nm) this._brandsMap.set(id, nm);
        }
        if (entity === "categories") {
          const nm = fullname && fullname.toLowerCase() !== "undefined" ? fullname : name;
          if (id && nm) this._categoriesMap.set(id, nm);
        }
      }
    }
    let rows = Array.from(collected.values());
    if (sort) {
      rows.sort((a, b) => String(a.fullname || a.name).localeCompare(String(b.fullname || b.name)));
    }
    selectEl.innerHTML = "";
    if (includeAllOption) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = this._msg(allMsgKey);
      if (selected === "" || selected == null) {
        opt.selected = true;
      }
      selectEl.appendChild(opt);
    }
    for (const r of rows) {
      const o = document.createElement("option");
      o.value = r.name;
      if (r.id) o.dataset.id = r.id;
      if (r.fullname && r.fullname.toLowerCase() !== "undefined") o.dataset.fullname = r.fullname;
      o.dataset.name = r.name || "";
      o.textContent = r.fullname || r.name || r.id;
      if (selected !== "" && String(o.value) === String(selected)) {
        o.selected = true;
      }
      selectEl.appendChild(o);
    }
    return true;
  }
  /**
   * Заполняет select категориями
   * @param {HTMLElement|string} selectEl
   * @param {Object} opts
   * @returns {Promise<boolean>}
   */
  async fillCategories(selectEl, opts = {}) {
    return this._fillSelectGeneric(selectEl, Object.assign({
      entity: "categories",
      productProp: "category",
      allMsgKey: "ALL_CATEGORIES_OPTION"
    }, opts));
  }
  /**
   * Заполняет select брендами
   * @param {HTMLElement|string} selectEl
   * @param {Object} opts
   * @returns {Promise<boolean>}
   */
  async fillBrands(selectEl, opts = {}) {
    return this._fillSelectGeneric(selectEl, Object.assign({
      entity: "brands",
      productProp: "brand",
      allMsgKey: "ALL_BRANDS_OPTION"
    }, opts));
  }
  /* ---------------------- misc ---------------------- */
  /**
   * Подписывается на изменения. Возвращает функцию для отписки.
   * @param {Function} fn
   * @returns {Function}
   */
  subscribe(fn) {
    if (typeof fn !== "function") throw new TypeError(this._msg("SUBSCRIBE_ARG_ERROR"));
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }
  /**
   * Добавляет или обновляет продукт. Возвращает нормализованный объект
   * @param {any} raw
   * @returns {Promise<any|null>}
   */
  async upsertProduct(raw) {
    try {
      const normalized = await this._normalizeProduct(raw);
      if (!normalized || !normalized.name) return null;
      const existing = this.findById(normalized.name);
      if (existing) {
        Object.assign(existing, normalized);
        this._productMap.set(existing.name, existing);
        this._setCache(this._categoriesMap, existing.category, existing.categoryName || existing.category);
        this._setCache(this._brandsMap, existing.brand, existing.brandName || existing.brand);
        this._notifySubscribers({ type: "update", changedIds: [existing.name] });
        return existing;
      }
      this.products.push(normalized);
      this._productMap.set(normalized.name, normalized);
      this._setCache(this._categoriesMap, normalized.category, normalized.categoryName || normalized.category);
      this._setCache(this._brandsMap, normalized.brand, normalized.brandName || normalized.brand);
      this._notifySubscribers({ type: "add", changedIds: [normalized.name] });
      return normalized;
    } catch (err) {
      this._log(this._msg("UPSERT_ERROR"), err);
      return null;
    }
  }
  /**
   * Создаёт и диспатчит событие storage, чтобы эмулировать изменение localStorage
   * @param {string} key
   * @param {string|null} oldValue
   * @param {string|null} newValue
   */
  _dispatchLocalStorageEvent(key, oldValue, newValue) {
    const ev = new StorageEvent("storage", { key, oldValue, newValue, url: location.href, storageArea: localStorage });
    window.dispatchEvent(ev);
  }
  /**
   * Очищает кеши продуктов, категорий или брендов
   * @param {Object} param0
   * @param {boolean} [param0.products=false]
   * @param {boolean} [param0.categories=false]
   * @param {boolean} [param0.brands=false]
   */
  clearCache({ products = false, categories = false, brands = false } = {}) {
    if (products) {
      this.products = [];
      this._productMap.clear();
    }
    if (categories) this._categoriesMap.clear();
    if (brands) this._brandsMap.clear();
  }
};

// ShopMatic/js/modules/StorageService.js
var StorageService = class {
  /**
   * @param {Object} shopMatic - главный сервис, ожидается поле productService
   * @param {Object} opts
   * @param {string} [opts.storageKey]
   * @param {string} [opts.favStorageKey]
   * @param {string} [opts.viewedStorageKey]
   * @param {number} [opts.maxViewedItems]
   * @param {number} [opts.defaultConcurrency]
   */
  constructor(shopMatic, opts = {}) {
    this.shopMatic = shopMatic;
    this.storageKey = opts.storageKey ?? "gribkov_cart_v1";
    this.favStorageKey = opts.favStorageKey ?? "gribkov_favs_v1";
    this.viewedStorageKey = opts.viewedStorageKey ?? "gribkov_viewed_v1";
    this.maxViewedItems = Number(opts.maxViewedItems ?? 20);
    this.defaultConcurrency = Math.max(1, Number(opts.defaultConcurrency ?? 6));
  }
  // -----------------------
  // === Helpers / utils ===
  // -----------------------
  _storageAvailable() {
    try {
      const k = "__storage_test__";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }
  _safeSetItem(key, value) {
    try {
      if (!this._storageAvailable()) return false;
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`StorageService._safeSetItem error for key="${key}"`, e);
      return false;
    }
  }
  _safeGetItem(key) {
    try {
      if (!this._storageAvailable()) return null;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      console.warn(`StorageService._safeGetItem error for key="${key}"`, e);
      return null;
    }
  }
  _normalizeCartItem(input = {}) {
    return {
      name: String(input.name ?? ""),
      fullname: input.fullname ?? "",
      price: Number(input.price ?? 0),
      qty: Number(input.qty ?? 0),
      picture: input.picture ?? "",
      stock: Number(input.stock ?? 0),
      specs: input.specs ?? {}
    };
  }
  _normalizeFavItem(input) {
    if (typeof input === "string") {
      return { name: input, fullname: "", price: 0, stock: 0 };
    }
    return {
      name: String(input.name ?? ""),
      fullname: input.fullname ?? "",
      price: Number(input.price ?? 0),
      stock: Number(input.stock ?? 0)
    };
  }
  _getKeyFromItem(it) {
    if (!it) return "";
    if (typeof it === "string") return String(it).trim();
    return String(it.name ?? it.id ?? it.productId ?? it._missingId ?? "").trim();
  }
  /**
   * Batch-process generic items: fetch product data by key and augment items with
   * { available, missing, stock, fullname?, price? }.
   *
   * @param {Array} items - массив нормализованных объектов (но может быть и строками)
   * @param {Object} options - { concurrency }
   * @param {Function} onMissingCallback - optional (key) => void
   */
  async _loadWithAvailability(items, options = {}, onMissingCallback) {
    try {
      if (!Array.isArray(items) || items.length === 0) return items || [];
      const ps = this.shopMatic?.productService;
      const concurrency = Math.max(1, Number(options.concurrency ?? this.defaultConcurrency));
      if (!ps || typeof ps.fetchById !== "function") {
        return items.map((item) => {
          const key = this._getKeyFromItem(item);
          const stock = Number((item && item.stock) ?? 0);
          return Object.assign({}, typeof item === "string" ? { name: item } : item, {
            available: stock > 0,
            missing: !key,
            stock
          });
        });
      }
      const results = [];
      for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const promises = batch.map(async (rawItem) => {
          const out = Object.assign({}, typeof rawItem === "string" ? { name: rawItem } : rawItem);
          const key = this._getKeyFromItem(rawItem);
          if (!key) {
            out.available = false;
            out.missing = true;
            out.stock = 0;
            return out;
          }
          try {
            const product = await ps.fetchById(key);
            if (!product) {
              console.warn(`StorageService: no product response for id="${key}"`);
              if (typeof onMissingCallback === "function") {
                try {
                  onMissingCallback(key);
                } catch (e) {
                }
              }
              out.available = false;
              out.missing = true;
              out.stock = 0;
              return out;
            }
            const prodStock = Number(product.stock ?? product._stock ?? product.count ?? product.qty ?? 0);
            out.stock = Number(out.stock || prodStock || 0);
            out.available = prodStock > 0;
            out.missing = false;
            if (!out.fullname && (product.fullname || product.title || product.name)) {
              out.fullname = product.fullname ?? product.title ?? product.name;
            }
            if ((!out.price || out.price === 0) && product.price != null) {
              out.price = Number(product.price);
            }
            return out;
          } catch (e) {
            console.warn(`StorageService: fetchById failed for id="${key}"`, e);
            out.available = false;
            out.missing = true;
            out.stock = 0;
            return out;
          }
        });
        const settled = await Promise.allSettled(promises);
        for (const s of settled) {
          if (s.status === "fulfilled") results.push(s.value);
          else {
            results.push({ available: false, missing: true, stock: 0 });
          }
        }
      }
      return results;
    } catch (e) {
      console.warn("StorageService._loadWithAvailability error", e);
      return items || [];
    }
  }
  // -----------------------
  // === Cart methods ===
  // -----------------------
  /**
   * Сохраняет корзину (массив объектов) в localStorage в нормализованном виде.
   * @param {Array} cartArr
   * @returns {boolean} успех
   */
  saveCart(cartArr) {
    try {
      const normalized = (Array.isArray(cartArr) ? cartArr : []).map((i) => this._normalizeCartItem(i));
      return this._safeSetItem(this.storageKey, normalized);
    } catch (e) {
      console.warn("StorageService.saveCart error", e);
      return false;
    }
  }
  /**
   * Загружает корзину (если есть) или null.
   * @returns {Array|null}
   */
  loadCart() {
    return this._safeGetItem(this.storageKey);
  }
  /**
   * Загружает корзину и асинхронно дополняет данными наличия через productService.fetchById
   * @param {Object} options { concurrency }
   * @returns {Promise<Array>}
   */
  async loadCartWithAvailability(options = {}) {
    const rawCart = this.loadCart();
    if (!Array.isArray(rawCart) || rawCart.length === 0) return rawCart || [];
    return this._loadWithAvailability(rawCart, options);
  }
  // -----------------------
  // === Favorites methods ===
  // -----------------------
  /**
   * Сохраняет избранное — принимает Set/Array/Iterable.
   * @param {Iterable} setLike
   * @returns {boolean}
   */
  saveFavs(setLike) {
    try {
      const arr = Array.from(setLike ?? []);
      return this._safeSetItem(this.favStorageKey, arr);
    } catch (e) {
      console.warn("StorageService.saveFavs error", e);
      return false;
    }
  }
  loadFavs() {
    return this._safeGetItem(this.favStorageKey);
  }
  /**
   * Загружает избранное и проверяет наличие в каталоге аналогично корзине.
   * Поддерживает элементы вида string или object.
   * @param {Object} options { concurrency }
   */
  async loadFavsWithAvailability(options = {}) {
    const rawFavs = this.loadFavs();
    if (!Array.isArray(rawFavs) || rawFavs.length === 0) return rawFavs || [];
    const normalized = rawFavs.map((item) => typeof item === "string" ? item : this._normalizeFavItem(item));
    const onMissing = (key) => {
      try {
        const ps = this.shopMatic?.productService;
        if (ps && typeof ps.removeFavoriteById === "function") {
          ps.removeFavoriteById(key);
        }
      } catch (e) {
        console.warn("StorageService: onMissing callback failed for", key, e);
      }
    };
    return this._loadWithAvailability(normalized, options, onMissing);
  }
  // -----------------------
  // === Viewed items ===
  // -----------------------
  /**
   * Добавляет просмотренный товар (нормализует, убирает дубликаты, ограничивает длину).
   * @param {Object} product
   */
  addViewed(product) {
    try {
      if (!product || !product.name) return;
      const item = {
        name: String(product.name ?? ""),
        fullname: product.fullname ?? "",
        price: Number(product.price ?? 0),
        picture: product.picture ?? "",
        stock: Number(product.stock ?? 0),
        viewedAt: Date.now()
      };
      const viewed = this.loadViewed() ?? [];
      const filtered = viewed.filter((p) => p.name !== item.name);
      filtered.unshift(item);
      const limited = filtered.slice(0, this.maxViewedItems);
      this._safeSetItem(this.viewedStorageKey, limited);
      this.shopMatic.viewedModule.sync();
    } catch (e) {
      console.warn("StorageService.addViewed error", e);
    }
  }
  loadViewed() {
    return this._safeGetItem(this.viewedStorageKey);
  }
  clearViewed() {
    try {
      if (!this._storageAvailable()) return;
      localStorage.removeItem(this.viewedStorageKey);
      this.shopMatic.viewedModule.sync();
    } catch (e) {
      console.warn("StorageService.clearViewed error", e);
    }
  }
};

// ShopMatic/js/modules/Notifications.js
var Notifications = class {
  static UI_MESSAGES = Object.freeze({
    CLOSE_BUTTON_LABEL: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435",
    REASON_TIMEOUT: "timeout",
    REASON_MANUAL: "manual",
    REASON_KEYBOARD: "keyboard",
    REASON_CLEARED: "cleared",
    REASON_EVICTED: "evicted"
  });
  _msg(key, vars = {}) {
    const pool = this.constructor && this.constructor.UI_MESSAGES || {};
    let tpl = pool[key] ?? "";
    return String(tpl).replace(
      /\{([^}]+)\}/g,
      (m, k) => Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }
  constructor(opts = {}) {
    this.opts = Object.assign({
      duration: 3e3,
      position: { right: 20, bottom: 20 },
      maxVisible: 5,
      pauseOnHover: true,
      dismissible: true,
      allowHtml: false,
      containerClass: "shop-notifications",
      notificationClass: "shop-notification",
      ariaLive: "polite",
      showProgressBar: true
      // display loading bar by default
    }, opts);
    this._container = null;
    this._idCounter = 1;
    this._timers = /* @__PURE__ */ new Map();
    this._resolvers = /* @__PURE__ */ new Map();
  }
  show(message, opts = {}) {
    if (!message && message !== 0) return null;
    const cfg = Object.assign({}, this.opts, opts);
    const id = `notif_${this._idCounter++}`;
    const container = this._ensureContainer(cfg);
    this._enforceMaxVisible(container, cfg.maxVisible);
    const note = document.createElement("div");
    note.className = `${cfg.notificationClass} ${cfg.notificationClass}--${cfg.type || "info"}`.trim();
    note.setAttribute("data-notification-id", id);
    note.tabIndex = 0;
    note.style.pointerEvents = "auto";
    note.setAttribute("role", cfg.type === "error" || cfg.ariaLive === "assertive" ? "alert" : "status");
    note.setAttribute("aria-live", opts.ariaLive ?? cfg.ariaLive);
    note.setAttribute("aria-atomic", "true");
    const ICONS = {
      success: "fa-solid fa-check",
      warning: "fa-solid fa-triangle-exclamation",
      error: "fa-solid fa-hexagon-exclamation",
      info: "fa-solid fa-info"
    };
    const typeKey = cfg.type && String(cfg.type) ? String(cfg.type) : "info";
    const iconClass = ICONS[typeKey] || ICONS.info;
    const iconEl = document.createElement("i");
    iconEl.className = `${iconClass} ${cfg.notificationClass}__icon notif-icon notif-icon--${typeKey}`;
    iconEl.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.className = `${cfg.notificationClass}__content`;
    if (message instanceof Node) {
      content.appendChild(message);
    } else {
      if (cfg.allowHtml || opts.allowHtml) {
        content.innerHTML = String(message);
      } else {
        content.textContent = String(message);
      }
    }
    note.appendChild(iconEl);
    note.appendChild(content);
    if (cfg.dismissible) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${cfg.notificationClass}__close`;
      btn.setAttribute("aria-label", this._msg("CLOSE_BUTTON_LABEL"));
      btn.innerHTML = "&times;";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        dismiss();
      });
      note.appendChild(btn);
    }
    let progress = null;
    let parentWidth = 0;
    if (cfg.showProgressBar) {
      progress = document.createElement("div");
      progress.className = `${cfg.notificationClass}__progress`;
      note.appendChild(progress);
    }
    let remainingDuration = Number(cfg.duration) || 0;
    let startTs = Date.now();
    let timeoutId = null;
    const clearTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (this._timers.has(id)) this._timers.delete(id);
    };
    const startTimer = (dur) => {
      clearTimer();
      if (dur <= 0) return;
      startTs = Date.now();
      timeoutId = setTimeout(() => performRemove(this.constructor.UI_MESSAGES.REASON_TIMEOUT), dur);
      this._timers.set(id, timeoutId);
    };
    const pauseTimer = () => {
      if (!cfg.pauseOnHover) return;
      if (!timeoutId) return;
      const elapsed = Date.now() - startTs;
      remainingDuration = Math.max(0, remainingDuration - elapsed);
      clearTimer();
      if (progress) {
        const parent = progress.parentNode;
        if (parent) parentWidth = parent.clientWidth;
        const currentWidth = progress.getBoundingClientRect().width;
        const pct = parentWidth ? currentWidth / parentWidth * 100 : 0;
        progress.style.transition = "none";
        progress.style.width = `${pct}%`;
      }
    };
    const resumeTimer = () => {
      if (!cfg.pauseOnHover) return;
      startTimer(remainingDuration);
      if (progress) {
        const parent = progress.parentNode;
        parentWidth = parent ? parent.clientWidth : parentWidth;
        progress.style.transition = `width ${remainingDuration}ms linear`;
        progress.style.width = "0%";
      }
    };
    note.classList.add("is-entering");
    container.appendChild(note);
    requestAnimationFrame(() => {
      note.classList.remove("is-entering");
      note.classList.add("is-visible");
      if (progress) {
        parentWidth = progress.parentNode ? progress.parentNode.clientWidth : 0;
        progress.style.transition = "none";
        progress.style.width = "100%";
        requestAnimationFrame(() => {
          progress.style.transition = `width ${remainingDuration}ms linear`;
          progress.style.width = "0%";
        });
      }
    });
    const performRemove = (reason = this.constructor.UI_MESSAGES.REASON_MANUAL) => {
      if (!note.parentNode) return resolveAndCleanup(reason);
      note.classList.remove("is-visible");
      note.classList.add("is-leaving");
      clearTimer();
      setTimeout(() => {
        if (note && note.parentNode) note.parentNode.removeChild(note);
        resolveAndCleanup(reason);
      }, 320);
    };
    const resolveAndCleanup = (reason = this.constructor.UI_MESSAGES.REASON_MANUAL) => {
      const resolver = this._resolvers.get(id);
      if (resolver) {
        try {
          resolver({ id, reason });
        } catch (e) {
        }
      }
      this._resolvers.delete(id);
      const t = this._timers.get(id);
      if (t) {
        clearTimeout(t);
        this._timers.delete(id);
      }
      if (typeof cfg.onClose === "function") {
        try {
          cfg.onClose({ id, reason });
        } catch (e) {
        }
      }
    };
    const promise = new Promise((resolve) => {
      this._resolvers.set(id, resolve);
    });
    const dismiss = (reason = this.constructor.UI_MESSAGES.REASON_MANUAL) => performRemove(reason);
    if (cfg.pauseOnHover) {
      note.addEventListener("mouseenter", pauseTimer);
      note.addEventListener("mouseleave", resumeTimer);
    }
    note.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" || ev.key === "Esc") {
        ev.preventDefault();
        dismiss(this.constructor.UI_MESSAGES.REASON_KEYBOARD);
      }
    });
    remainingDuration = Number(cfg.duration) || 0;
    if (remainingDuration > 0) startTimer(remainingDuration);
    return { id, dismiss, promise };
  }
  clearAll() {
    if (!this._container) return;
    const notes = Array.from(this._container.querySelectorAll(`.${this.opts.notificationClass}`));
    notes.forEach((n) => {
      const id = n.getAttribute("data-notification-id");
      n.classList.remove("is-visible");
      n.classList.add("is-leaving");
      setTimeout(() => {
        if (n.parentNode) n.parentNode.removeChild(n);
      }, 320);
      const resolver = this._resolvers.get(id);
      if (resolver) {
        try {
          resolver({ id, reason: this.constructor.UI_MESSAGES.REASON_CLEARED });
        } catch (e) {
        }
        this._resolvers.delete(id);
      }
      const t = this._timers.get(id);
      if (t) {
        clearTimeout(t);
        this._timers.delete(id);
      }
    });
  }
  _ensureContainer(cfg = {}) {
    if (this._container) return this._container;
    const cont = document.createElement("div");
    cont.className = cfg.containerClass || this.opts.containerClass;
    document.body.appendChild(cont);
    this._container = cont;
    return cont;
  }
  _enforceMaxVisible(container, max) {
    try {
      const nodes = container.querySelectorAll(`.${this.opts.notificationClass}`);
      const overflow = nodes.length - (max - 1);
      if (overflow > 0) {
        const toRemove = Array.from(nodes).slice(0, overflow);
        toRemove.forEach((n) => {
          const id = n.getAttribute("data-notification-id");
          n.classList.remove("is-visible");
          n.classList.add("is-leaving");
          setTimeout(() => {
            if (n.parentNode) n.parentNode.removeChild(n);
          }, 320);
          const resolver = this._resolvers.get(id);
          if (resolver) {
            try {
              resolver({ id, reason: this.constructor.UI_MESSAGES.REASON_EVICTED });
            } catch (e) {
            }
          }
          this._resolvers.delete(id);
        });
      }
    } catch (e) {
    }
  }
};

// ShopMatic/js/modules/Renderer.js
var Renderer = class {
  /**
   * @param {Object} options
   * @param {Object|null} options.foxEngine
   * @param {Object|null} options.productService
   * @param {Object|null} options.favorites
   */
  constructor({ foxEngine = null, productService = null, favorites = null } = {}) {
    this.foxEngine = foxEngine;
    this.productService = productService;
    this.favorites = favorites;
  }
  // -----------------------
  // Helpers
  // -----------------------
  /**
   * Безопасный JSON.parse с fallback'ом
   * @param {string|any} value
   * @param {any} fallback
   * @returns {any}
   */
  safeParseJSON(value, fallback = []) {
    if (value == null) return fallback;
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value);
      return parsed === null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }
  /**
   * Нормализованное представление списка картинок.
   * Принимает строку или массив и возвращает массив строк.
   * @param {string|Array} picture
   * @returns {Array<string>}
   */
  _getImageArray(picture) {
    const arr = this.safeParseJSON(picture, []);
    return Array.isArray(arr) ? arr.map(String) : [];
  }
  /**
   * Возвращает первую картинку из поля picture или дефолт
   * @param {string|Array} picture
   * @returns {string}
   */
  getFirstImage(picture) {
    const arr = this._getImageArray(picture);
    return Array.isArray(arr) && arr.length ? String(arr[0]) : "/assets/no-image.png";
  }
  /**
   * Унифицированное форматирование цены. Пытается использовать
   * глобальную функцию formatPrice, если она доступна, иначе
   * подставляет локализованное значение. На случай любой ошибки
   * возвращает исходное значение в строковом виде.
   *
   * @param {number|string|null} value
   * @returns {string}
   */
  _formatPrice(value) {
    try {
      if (typeof formatPrice === "function") return formatPrice(value ?? 0);
      const num = Number(value ?? 0);
      return Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(num);
    } catch (_) {
      return String(value ?? "");
    }
  }
  /**
   * Безопасное экранирование для селектора (fallback если CSS.escape отсутствует)
   * @param {string} val
   * @returns {string}
   */
  escapeForAttribute(val) {
    try {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(String(val));
    } catch (_) {
    }
    return String(val).replace(/"/g, '\\"');
  }
  /**
   * Логгер, падает безопасно если foxEngine отсутствует
   * @param {string} msg
   * @param {string} level
   */
  _log(msg, level = "INFO") {
    try {
      this.foxEngine?.log?.(`Renderer: ${msg}`, level);
    } catch (_) {
    }
  }
  // -----------------------
  // Template rendering
  // -----------------------
  /**
   * Унифицированный рендер via foxEngine template cache.
   * Если шаблон отсутствует или рендер падает — возвращает пустую строку.
   * @param {string} tplName
   * @param {Object} data
   * @returns {Promise<string>}
   */
  async renderTemplate(tplName, data = {}) {
    if (!this.foxEngine || !this.foxEngine.templateCache) return "";
    const tpl = this.foxEngine.templateCache[tplName];
    if (!tpl) return "";
    try {
      return await this.foxEngine.replaceTextInTemplate(tpl, data);
    } catch (e) {
      try {
        this.foxEngine?.log?.(`Renderer.renderTemplate ${tplName} error: ${e}`, "ERROR");
      } catch (_) {
      }
      return "";
    }
  }
  /**
   * Создаёт элемент DOM из HTML строки (возвращает первый элемент)
   * @param {string} html
   * @returns {Element}
   */
  createElementFromHTML(html = "") {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = String(html).trim();
    return wrapper.firstElementChild || wrapper;
  }
  // -----------------------
  // Data normalization
  // -----------------------
  /**
   * Нормализует данные продукта в единый объект для шаблона вертикальной карточки.
   * @param {Object} prod
   * @returns {Object}
   */
  _createCardData(prod = {}) {
    const id = String(prod.name ?? prod.id ?? prod.productId ?? "");
    const imgArray = this._getImageArray(prod.picture);
    const firstImg = imgArray.length ? imgArray[0] : "/assets/no-image.png";
    const priceText = this._formatPrice(prod.price ?? 0);
    const hasOldPrice = prod.oldPrice && Number(prod.oldPrice) > 0;
    const specsHtml = typeof makeSpecHtmlPreview === "function" ? makeSpecHtmlPreview(prod.specs || {}) : "";
    return {
      id,
      fullname: prod.fullname ?? prod.title ?? prod.name ?? "",
      imgArray,
      img: firstImg,
      short: prod.short ?? "",
      price: priceText,
      oldPrice: hasOldPrice ? this._formatPrice(prod.oldPrice) : "",
      badgeText: Number(prod.stock) > 0 ? "\u0412 \u043D\u0430\u043B\u0438\u0447\u0438\u0438" : "\u041F\u043E\u0434 \u0437\u0430\u043A\u0430\u0437",
      stock: Number.isFinite(Number(prod.stock)) ? Number(prod.stock) : 0,
      specsHtml
    };
  }
  /**
   * Нормализует данные элемента корзины для горизонтального списка.
   * Возвращает объект с вычисленными полями, готовыми для шаблона или fallback.
   * @param {Object} item
   * @returns {Object}
   */
  _normalizeCartItem(item = {}) {
    const id = String(item.name ?? item.id ?? item.productId ?? "").trim();
    const fullname = String(item.fullname ?? item.title ?? item.name ?? "").trim();
    const imageArray = this._getImageArray(item.picture);
    const picture = imageArray.length ? imageArray[0] : "/assets/no-image.png";
    const priceNum = Number(item.price ?? 0);
    const qtyNum = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 1;
    const stockNum = Number.isFinite(Number(item.stock)) ? Number(item.stock) : 0;
    const specsHtml = typeof makeSpecHtmlPreview === "function" ? makeSpecHtmlPreview(item.specs || {}) : "";
    const priceFormatted = this._formatPrice(priceNum);
    const totalPriceFormatted = this._formatPrice(priceNum * qtyNum);
    return {
      id,
      fullname,
      picture,
      priceNum,
      qtyNum,
      stockNum,
      specsHtml,
      priceFormatted,
      totalPriceFormatted
    };
  }
  // -----------------------
  // Fallback builders
  // -----------------------
  /**
   * Построение fallback HTML для вертикальной карточки при отсутствии шаблона.
   * @param {Object} data
   * @returns {string}
   */
  _buildVerticalCardHtml(data) {
    const esc = (val) => escapeHtml(String(val ?? ""));
    const hasOldPrice = Boolean(data.oldPrice);
    return `
        <article class="card" data-product-id="${esc(data.id)}">
          <div class="card__media">
            <img src="${esc(data.img)}" alt="${esc(data.fullname)}" loading="lazy">
          </div>
          <div class="card__body">
            <h3 class="card__title">${esc(data.fullname)}</h3>
            <div class="card__price">
              ${esc(data.price)}${hasOldPrice ? ' <small class="old">' + esc(data.oldPrice) + "</small>" : ""}
            </div>
            <div class="card__short">${esc(data.short)}</div>
            <div class="card__specs">${data.specsHtml || ""}</div>
            <div class="card__controls">
              <button data-role="buy" class="btn">\u0412 \u043A\u043E\u0440\u0437\u0438\u043D\u0443</button>
            </div>
          </div>
        </article>`;
  }
  /**
   * Построение fallback HTML для строки корзины (горизонтальный режим) при отсутствии шаблона.
   * @param {Object} data
   * @returns {string}
   */
  _buildHorizontalRowHtml(data) {
    const esc = (s) => escapeHtml(String(s ?? ""));
    const { id, fullname, picture, priceFormatted, totalPriceFormatted, qtyNum, stockNum, specsHtml } = data;
    const minQty = stockNum > 0 ? String(Math.max(1, qtyNum)) : "0";
    const disabledAttr = stockNum <= 0 ? ' disabled aria-disabled="true"' : "";
    return `
          <div class="cart-item" data-id="${esc(id)}">
            <div class="cart-item__content">
              <div class="cart-item__image"><img src="${esc(picture)}" alt="${esc(fullname)}" loading="lazy"></div>
              <div class="cart-item__details">
                <div class="cart-item__title"><a href="#product/${encodeURIComponent(id)}" rel="noopener noreferrer">${esc(fullname)}</a></div>
                ${specsHtml}
              </div>
              <div class="cart-item__right" role="group" aria-label="\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0442\u043E\u0432\u0430\u0440\u043E\u043C \u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0435">
                <div class="cart-item__price" aria-hidden="false"><span class="price-value">${esc(priceFormatted)}</span>
                  <div class="price-total">\u0418\u0442\u043E\u0433\u043E: <span class="price-total-value">${esc(totalPriceFormatted)}</span></div>
                </div>
                <div class="qty-controls" data-id="${esc(id)}" role="group" aria-label="\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u0442\u043E\u0432\u0430\u0440\u0430">
                  <button class="qty-btn qty-decr" type="button" aria-label="\u0423\u043C\u0435\u043D\u044C\u0448\u0438\u0442\u044C \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E">\u2212</button>
                  <input class="qty-input" type="number" value="${minQty}" min="1" max="${stockNum}" aria-label="\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E" inputmode="numeric"${disabledAttr}/>
                  <button class="qty-btn qty-incr" type="button" aria-label="\u0423\u0432\u0435\u043B\u0438\u0447\u0438\u0442\u044C \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E">+</button>
                </div>
              </div>
              <div class="cart-item__controls">
                <div class="cart-item__icons">
                  <button class="wishlist-btn fav-btn" type="button" title="\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435" aria-label="\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435"><i class="icon-heart" aria-hidden="true"></i></button>
                  <button class="remove-btn" type="button" data-id="${esc(id)}" title="\u0423\u0434\u0430\u043B\u0438\u0442\u044C" aria-label="\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440"><i class="fa-regular fa-xmark" aria-hidden="true"></i></button>
                </div>
              </div>
              <div class="stock-warning" aria-hidden="true" style="display:none;">\u0422\u043E\u0432\u0430\u0440\u0430 \u043D\u0435\u0442 \u0432 \u043D\u0430\u043B\u0438\u0447\u0438\u0438</div>
            </div>
          </div>`;
  }
  // -----------------------
  // Vertical card rendering
  // -----------------------
  /**
   * Создаёт DOM-элемент карточки продукта (вертикальная карточка)
   * @param {Object} product
   * @returns {Promise<Element>}
   */
  async createCard(product = {}) {
    const data = this._createCardData(product);
    let html = "";
    html = await this.renderTemplate("cardVertical", data);
    if (!html) {
      html = this._buildVerticalCardHtml(data);
    }
    const node = this.createElementFromHTML(html);
    try {
      node.setAttribute && node.setAttribute("data-product-id", String(data.id));
    } catch (_) {
    }
    if (Array.isArray(data.imgArray) && data.imgArray.length > 1) {
      try {
        this._attachImageGallery(node, data.imgArray);
      } catch (e) {
        this._log(`attachImageGallery error: ${e}`, "WARN");
      }
    }
    return node;
  }
  /**
   * Добавляет на карточку зоны для наведения и точки для переключения изображений
   * @param {Element} node
   * @param {string[]} imgArray
   */
  _attachImageGallery(node, imgArray = []) {
    if (!node || !Array.isArray(imgArray) || imgArray.length <= 1) return;
    const media = node.querySelector && node.querySelector(".card__media");
    if (!media) return;
    media.classList.add("multi-image");
    const overlay = document.createElement("div");
    overlay.className = "card__image-overlay";
    const dots = document.createElement("div");
    dots.className = "card__image-dots";
    const imgEl = media.querySelector("img");
    let activeIndex = 0;
    const updateImage = (index) => {
      if (index < 0 || index >= imgArray.length) return;
      activeIndex = index;
      if (imgEl) {
        imgEl.classList.add("fade");
        setTimeout(() => {
          imgEl.src = imgArray[index];
          imgEl.onload = () => imgEl.classList.remove("fade");
        }, 120);
      }
      dots.querySelectorAll(".dot").forEach((d, i) => d.classList.toggle("active", i === index));
    };
    imgArray.forEach((_, i) => {
      const zone = document.createElement("div");
      zone.className = "card__image-zone";
      zone.style.setProperty("--zone-index", i);
      zone.addEventListener("mouseenter", () => updateImage(i));
      overlay.appendChild(zone);
      const dot = document.createElement("span");
      dot.className = "dot";
      if (i === 0) dot.classList.add("active");
      dot.addEventListener("mouseenter", () => updateImage(i));
      dots.appendChild(dot);
    });
    media.appendChild(overlay);
    media.after(dots);
  }
  // -----------------------
  // Vertical list rendering (animated)
  // -----------------------
  /**
   * Быстрое рендерение вертикальной колонки карточек
   * @param {Array} list
   * @param {Element} rootEl
   */
  async _renderCartVertical(list = [], rootEl) {
    if (!rootEl) return;
    rootEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    const items = Array.isArray(list) ? list : [];
    const cards = await Promise.all(items.map((p) => this.createCard(p)));
    for (const card of cards) {
      if (!card) continue;
      card.style.opacity = "0";
      card.style.transition = "opacity .22s ease";
      frag.appendChild(card);
      requestAnimationFrame(() => {
        card.style.opacity = "1";
      });
    }
    rootEl.appendChild(frag);
  }
  // -----------------------
  // Mini cart item
  // -----------------------
  /**
   * create mini cart item HTML
   * @param {Object} item
   * @param {Object|null} foxEngine
   * @returns {Promise<string>}
   */
  async _createMiniCartItemHTML(item = {}, foxEngine = null) {
    const title = String(item.fullname ?? item.title ?? item.name ?? "\u0422\u043E\u0432\u0430\u0440");
    const price = this._formatPrice(item.price ?? 0);
    const qty = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0;
    const imageArray = this._getImageArray(item.picture);
    const img = String(imageArray.at ? imageArray.at(0) ?? "/assets/no-image.png" : imageArray[0] ?? "/assets/no-image.png");
    const id = String(item.name ?? item.id ?? "");
    if (foxEngine && foxEngine.templateCache && foxEngine.templateCache.miniCartItem) {
      try {
        return await foxEngine.replaceTextInTemplate(foxEngine.templateCache.miniCartItem, {
          id,
          img,
          title,
          qty,
          price
        });
      } catch (e) {
        this._log(`_createMiniCartItemHTML template error: ${e}`, "WARN");
      }
    }
    return `<li class="cart-item" data-id="${escapeHtml(id)}">
      <div class="mc-thumb"><img src="${escapeHtml(img)}" alt="${escapeHtml(title)}" loading="lazy"/></div>
      <div class="mc-body"><div class="mc-name">${escapeHtml(title)}</div><div class="mc-meta">${escapeHtml(String(qty))} \xD7 ${escapeHtml(price)}</div></div>
    </li>`;
  }
  // -----------------------
  // Horizontal cart rendering
  // -----------------------
  /**
   * Конфигурирует поля количества и кнопки в DOM-узле
   * @param {Element} produced
   * @param {number} qtyNum
   * @param {number} stockNum
   */
  _configureQtyControls(produced, qtyNum = 1, stockNum = 0) {
    if (!produced) return;
    try {
      const qtyInput = produced.querySelector && produced.querySelector(".qty-input");
      const btnPlus = produced.querySelector && produced.querySelector(".qty-btn.qty-incr");
      const btnMinus = produced.querySelector && produced.querySelector(".qty-btn.qty-decr");
      if (qtyInput) {
        qtyInput.setAttribute("min", "1");
        qtyInput.setAttribute("max", String(stockNum));
        if (stockNum <= 0) {
          qtyInput.value = "0";
          qtyInput.disabled = true;
          qtyInput.setAttribute("aria-disabled", "true");
        } else {
          let cur = parseInt(qtyInput.value || String(qtyNum), 10);
          if (isNaN(cur) || cur < 1) cur = Math.max(1, qtyNum || 1);
          if (cur > stockNum) cur = stockNum;
          qtyInput.value = String(cur);
          qtyInput.disabled = false;
          qtyInput.removeAttribute("aria-disabled");
        }
      }
      if (btnPlus) {
        const disabled = stockNum <= 0 || qtyNum >= stockNum;
        btnPlus.disabled = disabled;
        disabled ? btnPlus.setAttribute("aria-disabled", "true") : btnPlus.removeAttribute("aria-disabled");
      }
      if (btnMinus) {
        const disabled = stockNum <= 0 || qtyNum <= 1;
        btnMinus.disabled = disabled;
        disabled ? btnMinus.setAttribute("aria-disabled", "true") : btnMinus.removeAttribute("aria-disabled");
      }
      const stockWarning = produced.querySelector && produced.querySelector(".stock-warning");
      if (stockNum <= 0) {
        if (stockWarning) {
          stockWarning.textContent = "\u0422\u043E\u0432\u0430\u0440\u0430 \u043D\u0435\u0442 \u0432 \u043D\u0430\u043B\u0438\u0447\u0438\u0438";
          stockWarning.style.display = "";
          stockWarning.setAttribute("aria-hidden", "false");
        }
        produced.classList.add("out-of-stock");
      } else if (stockWarning) {
        stockWarning.style.display = "none";
        stockWarning.setAttribute("aria-hidden", "true");
        produced.classList.remove("out-of-stock");
      }
    } catch (e) {
      this._log(`_configureQtyControls error: ${e}`, "WARN");
    }
  }
  /**
   * Эффективно рендерит горизонтальную сетку корзины (cartEl) из массива cartArr.
   * Попытка in-place обновления, иначе создание новых строк.
   * @param {Element} cartEl
   * @param {Array} cartArr
   */
  async _renderCartHorizontal(cartEl, cartArr = []) {
    if (!cartEl) return;
    const arr = Array.isArray(cartArr) ? cartArr.slice() : [];
    if (!arr.length) {
      cartEl.innerHTML = `
        <div class="cart-empty" role="status" aria-live="polite">
          <p><i class="fa-regular fa-cart-shopping" aria-hidden="true"></i> \u0412\u0430\u0448\u0430 \u043A\u043E\u0440\u0437\u0438\u043D\u0430 \u043F\u0443\u0441\u0442\u0430.</p>
          <a href="#page/catalog" class="btn btn-primary">\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u0432 \u043A\u0430\u0442\u0430\u043B\u043E\u0433</a>
        </div>`;
      return;
    }
    const existingMap = /* @__PURE__ */ new Map();
    try {
      const existingRows = Array.from(cartEl.querySelectorAll && cartEl.querySelectorAll(".cart-item") || []);
      for (const r of existingRows) {
        try {
          const did = r.getAttribute && (r.getAttribute("data-id") || r.getAttribute("data-cart-item") || r.getAttribute("data-cart-id"));
          if (did) existingMap.set(String(did), r);
        } catch (_) {
        }
      }
    } catch (_) {
    }
    const frag = document.createDocumentFragment();
    for (const rawItem of arr) {
      const data = this._normalizeCartItem(rawItem);
      const existing = data.id ? existingMap.get(String(data.id)) : null;
      if (existing) {
        try {
          this._updateRowDom(existing, data);
          existingMap.delete(String(data.id));
          frag.appendChild(existing);
          continue;
        } catch (e) {
          existingMap.delete(String(data.id));
          this._log(`in-place update failed for ${data.id}: ${e}`, "WARN");
        }
      }
      let rowHtml = "";
      rowHtml = await this.renderTemplate("cardHorizontal", {
        id: data.id,
        fullname: data.fullname,
        price: data.priceFormatted,
        totalPrice: data.totalPriceFormatted,
        qty: data.qtyNum,
        stock: data.stockNum,
        picture: data.picture,
        specs: data.specsHtml
      });
      if (!rowHtml) {
        rowHtml = this._buildHorizontalRowHtml(data);
      }
      const produced = this.createElementFromHTML(rowHtml);
      try {
        if (String(data.id) && produced.setAttribute) produced.setAttribute("data-id", String(data.id));
      } catch (_) {
      }
      this._configureQtyControls(produced, data.qtyNum, data.stockNum);
      frag.appendChild(produced);
    }
    for (const [key, node] of existingMap) {
      try {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      } catch (_) {
      }
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    cartEl.innerHTML = "";
    cartEl.appendChild(frag);
  }
  // -----------------------
  // In-place update row
  // -----------------------
  /**
   * Попытка скорректировать существующую DOM-строку "in-place".
   * Ожидает объект с уже вычисленными полями как у _normalizeCartItem().
   * @param {Element} row
   * @param {Object} data
   */
  _updateRowDom(row, data = {}) {
    if (!row || typeof row !== "object") return;
    const {
      id,
      fullname,
      picture,
      priceFormatted,
      totalPriceFormatted,
      qtyNum,
      stockNum,
      specsHtml
    } = data;
    try {
      const a = row.querySelector && row.querySelector('a[href*="#product/"]');
      if (a && a.setAttribute) {
        a.setAttribute("href", `#product/${encodeURIComponent(String(id))}`);
        if (a.firstChild && a.firstChild.nodeType === 3) a.firstChild.nodeValue = fullname;
        else a.textContent = fullname;
      } else {
        const title = row.querySelector && (row.querySelector(".cart-item__title") || row.querySelector(".cart-item__name") || row.querySelector(".cart-item__title a"));
        if (title) title.textContent = fullname;
      }
    } catch (e) {
      this._log(`updateRowDom title error: ${e}`, "WARN");
    }
    try {
      const img = row.querySelector && (row.querySelector(".cart-item__image img") || row.querySelector("img"));
      if (img && img.setAttribute) {
        img.setAttribute("src", String(picture));
        img.setAttribute("alt", String(fullname));
      }
    } catch (e) {
      this._log(`updateRowDom image error: ${e}`, "WARN");
    }
    try {
      const pv = row.querySelector && row.querySelector(".price-value");
      if (pv) pv.textContent = String(priceFormatted);
      const pt = row.querySelector && row.querySelector(".price-total-value");
      if (pt) pt.textContent = String(totalPriceFormatted);
    } catch (e) {
      this._log(`updateRowDom price error: ${e}`, "WARN");
    }
    this._configureQtyControls(row, qtyNum, stockNum);
    try {
      if (specsHtml) {
        const specsNode = row.querySelector && (row.querySelector(".cart-item__info") || row.querySelector(".cart-item__details"));
        if (specsNode) specsNode.innerHTML = specsHtml;
      }
    } catch (e) {
      this._log(`updateRowDom specs error: ${e}`, "WARN");
    }
  }
  // -----------------------
  // Favorite state
  // -----------------------
  /**
   * Обновить состояние кнопки "избранное" в карточке товара
   * @param {Element} rootEl
   * @param {string} id
   * @param {boolean} isFav
   */
  updateProductCardFavState(rootEl, id, isFav) {
    if (!rootEl || !id) return;
    const esc = this.escapeForAttribute(id);
    const selector = `[data-product-id="${esc}"]`;
    const card = rootEl.querySelector && rootEl.querySelector(selector);
    if (!card) return;
    const favBtn = card.querySelector(".fav-btn");
    if (!favBtn) return;
    favBtn.setAttribute("aria-pressed", isFav ? "true" : "false");
    favBtn.title = isFav ? "\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C" : "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435";
    favBtn.classList.toggle("is-fav", !!isFav);
    const icon = favBtn.querySelector("i");
    if (icon) {
      icon.classList.remove("fa-regular", "fa-solid");
      icon.classList.add(isFav ? "fa-solid" : "fa-regular");
      if (!icon.classList.contains("fa-heart")) icon.classList.add("fa-heart");
    }
  }
};

// ShopMatic/js/modules/MiniCart.js
var MiniCart = class _MiniCart {
  /**
   * Общие текстовые сообщения и классы для UI
   * @type {Readonly<Record<string,string>>}
   */
  static UI_MESSAGES = Object.freeze({
    EMPTY_TEXT: "\u041A\u043E\u0440\u0437\u0438\u043D\u0430 \u043F\u0443\u0441\u0442\u0430",
    EMPTY_ICON_CLASS: "fa-solid fa-cart-shopping",
    SUMMARY_MORE: '\u0415\u0449\u0451 {n} \u0442\u043E\u0432\u0430\u0440{plural}\u2026 <a href="#page/cart" class="mc-summary__link">\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0443</a>',
    FALLBACK_NAME: "\u0422\u043E\u0432\u0430\u0440",
    HEADER_BASE: "\u041A\u043E\u0440\u0437\u0438\u043D\u0430"
  });
  /**
   * Создаёт новый мини‑карт
   * @param {Object} [param0]
   * @param {Object|null} [param0.renderer] Рендерер карточек (может быть null)
   * @param {Object|null} [param0.notifications] Система уведомлений (может быть null)
   * @param {Object} [param0.opts] Настройки отображения
   */
  constructor({ renderer = null, notifications = null, opts = {} } = {}) {
    this.renderer = renderer;
    this.notifications = notifications;
    const {
      emptyText = this.constructor.UI_MESSAGES.EMPTY_TEXT,
      emptyIconClass = this.constructor.UI_MESSAGES.EMPTY_ICON_CLASS,
      maxItems = 10,
      debug = false
    } = opts;
    this.opts = { emptyText, emptyIconClass, maxItems, debug };
    this.listEl = null;
    this.headerTitleEl = null;
    this._lastRenderHash = "";
    this._headerBase = null;
    this._elementsMap = /* @__PURE__ */ new Map();
    this._pendingRaf = false;
    this._latestCart = null;
  }
  /* ---------- i18n / small utils ---------- */
  /**
   * Шаблонизатор сообщений: заменяет {variables}
   * @param {string} key
   * @param {Object} vars
   * @returns {string}
   */
  _msg(key, vars = {}) {
    const pool = this.constructor && this.constructor.UI_MESSAGES || {};
    const tpl = pool[key] ?? "";
    return String(tpl).replace(
      /\{([^}]+)\}/g,
      (m, k) => Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }
  /**
   * Экранирует строку для HTML
   * @param {any} s
   * @returns {string}
   */
  static _escapeHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  /**
   * Форматирует цену в рублях
   * @param {number|string} num
   * @returns {string}
   */
  _formatPrice(num) {
    try {
      return Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(Number(num || 0));
    } catch (e) {
      return String(num || 0);
    }
  }
  /* ---------- DOM helpers ---------- */
  /**
   * Создаёт DOM-узел из HTML-строки
   * @param {string} html
   * @returns {Element|null}
   */
  _createElFromHTML(html) {
    try {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html.trim();
      return wrapper.firstElementChild || null;
    } catch (e) {
      return null;
    }
  }
  /**
   * Нормализует объект корзины. Возвращает удобную структуру для рендеринга.
   * @param {any} it
   * @returns {{ idKey: string, qty: number, priceNum: number, name: string, picture: string, priceFormatted: string }}
   */
  _normalizeCartItem(it) {
    const idKey = String(it?.name ?? it?.id ?? it?.productId ?? "").trim();
    const qty = Number.isFinite(Number(it?.qty)) ? Number(it?.qty) : 0;
    const priceNum = Number.isFinite(Number(it?.price)) ? Number(it?.price) : 0;
    const name = it?.fullname || it?.title || it?.name || this.constructor.UI_MESSAGES.FALLBACK_NAME;
    const picture = it?.picture || it?.image || "/assets/no-image.png";
    const priceFormatted = this._formatPrice(priceNum);
    return { idKey, qty, priceNum, name, picture, priceFormatted };
  }
  /**
   * Вычисляет хэш элемента корзины на основе id, qty и цены
   * @param {string} idKey
   * @param {number} qty
   * @param {number} priceNum
   * @returns {string}
   */
  _computeItemHash(idKey, qty, priceNum) {
    return `${idKey}:${qty}:${priceNum}`;
  }
  /**
   * Генерирует fallback‑разметку для элемента, если renderer недоступен
   * @param {Object} norm
   * @returns {Element|null}
   */
  _renderFallbackItem(norm) {
    const id = _MiniCart._escapeHtml(norm.idKey);
    const name = _MiniCart._escapeHtml(norm.name);
    const qty = _MiniCart._escapeHtml(String(norm.qty));
    const price = _MiniCart._escapeHtml(norm.priceFormatted);
    const img = _MiniCart._escapeHtml(norm.picture);
    const liHtml = `
      <li class="mc-item" data-id="${id}">
        <div class="mc-thumb"><img src="${img}" alt="${name}" loading="lazy" /></div>
        <div class="mc-body">
          <div class="mc-name">${name}</div>
          <div class="mc-meta">${qty} \xD7 <span class="mc-price">${price}</span></div>
        </div>
      </li>`;
    return this._createElFromHTML(liHtml);
  }
  /**
   * Устанавливает ссылки на DOM-элементы для списка и заголовка
   * @param {Object} param0
   * @param {HTMLElement|null} [param0.listEl]
   * @param {HTMLElement|null} [param0.headerTitleEl]
   */
  setDomRefs({ listEl = null, headerTitleEl = null } = {}) {
    if (listEl) {
      this.listEl = listEl;
      try {
        if (!this.listEl.hasAttribute("aria-live")) this.listEl.setAttribute("aria-live", "polite");
      } catch (e) {
      }
    }
    if (headerTitleEl) {
      this.headerTitleEl = headerTitleEl;
      try {
        this._headerBase = (this.headerTitleEl.textContent || "").replace(/\(\d+\)$/, "").trim() || this.constructor.UI_MESSAGES.HEADER_BASE;
      } catch (e) {
        this._headerBase = this.constructor.UI_MESSAGES.HEADER_BASE;
      }
    }
  }
  /**
   * Вычисляет хэш для всего списка товаров (id:qty:price|...)
   * @param {Array<any>} cart
   * @returns {string}
   */
  _computeHash(cart) {
    if (!Array.isArray(cart) || cart.length === 0) return "";
    return cart.map((i) => {
      const id = String(i?.name ?? i?.id ?? i?.productId ?? "").trim();
      const qty = String(Number(i?.qty || 0));
      const price = String(Number(i?.price || 0));
      return `${id}:${qty}:${price}`;
    }).join("|");
  }
  /* ---------- render API ---------- */
  /**
   * Основная точка входа для рендера. Вызывает внутренний метод через requestAnimationFrame.
   * @param {Array<any>} cart
   * @returns {Promise<void>}
   */
  async render(cart = []) {
    this._latestCart = Array.isArray(cart) ? cart.slice() : [];
    if (this._pendingRaf) return;
    this._pendingRaf = true;
    return new Promise((resolve) => {
      requestAnimationFrame(async () => {
        try {
          await this._doRender(this._latestCart);
        } catch (e) {
          if (this.opts.debug) console.error("MiniCart.render error", e);
        } finally {
          this._pendingRaf = false;
          resolve();
        }
      });
    });
  }
  /**
   * Выполняет реальный рендеринг списка товаров
   * @param {Array<any>} cart
   */
  async _doRender(cart) {
    if (!this.listEl) return;
    const hash = this._computeHash(cart);
    if (hash && hash === this._lastRenderHash) {
      this.updateHeader(cart.reduce((s, it) => s + Number(it.qty || 0), 0));
      return;
    }
    this._lastRenderHash = hash;
    const normalized = Array.isArray(cart) ? cart.slice() : [];
    if (!normalized.length) {
      this._elementsMap.clear();
      const li = document.createElement("li");
      li.className = "mc-item empty";
      const iconCls = _MiniCart._escapeHtml(this.opts.emptyIconClass);
      const text = _MiniCart._escapeHtml(this.opts.emptyText);
      li.innerHTML = `<div class="mc-empty"><span class="mc-empty__icon"><i class="${iconCls}" aria-hidden="true"></i></span><span class="mc-empty__text">${text}</span></div>`;
      await new Promise((r) => requestAnimationFrame(r));
      try {
        this.listEl.innerHTML = "";
        this.listEl.appendChild(li);
      } catch (e) {
        this.listEl.innerHTML = "";
        this.listEl.appendChild(li);
      }
      this.updateHeader(0);
      return;
    }
    const existing = /* @__PURE__ */ new Map();
    for (const child of Array.from(this.listEl.children || [])) {
      try {
        const did = child.getAttribute && (child.getAttribute("data-id") || child.getAttribute("data-cart-item"));
        if (did) existing.set(String(did), child);
      } catch (e) {
      }
    }
    const frag = document.createDocumentFragment();
    const max = Number.isFinite(Number(this.opts.maxItems)) ? Math.max(1, Number(this.opts.maxItems)) : Infinity;
    let shown = 0;
    let dropped = 0;
    for (let i = 0; i < normalized.length; i++) {
      if (shown >= max) {
        dropped = normalized.length - i;
        break;
      }
      const norm = this._normalizeCartItem(normalized[i] || {});
      if (!norm.idKey) continue;
      const itemHash = this._computeItemHash(norm.idKey, norm.qty, norm.priceNum);
      let node = null;
      if (this._elementsMap.has(norm.idKey)) {
        node = this._elementsMap.get(norm.idKey);
        try {
          const storedHash = node.getAttribute && node.getAttribute("data-mc-hash");
          if (storedHash === itemHash) {
            existing.delete(norm.idKey);
            frag.appendChild(node);
            shown++;
            continue;
          }
        } catch (e) {
        }
      }
      let produced = null;
      if (this.renderer && typeof this.renderer._createMiniCartItemHTML === "function") {
        try {
          const out = await this.renderer._createMiniCartItemHTML(normalized[i], this.renderer.foxEngine);
          if (typeof out === "string") {
            produced = this._createElFromHTML(out) || null;
          } else if (out instanceof Element) {
            produced = out.cloneNode(true);
          } else if (out instanceof DocumentFragment) {
            produced = out.firstElementChild ? out.firstElementChild.cloneNode(true) : null;
          }
        } catch (e) {
          if (this.opts.debug) console.warn("MiniCart: renderer item failed", e);
          produced = null;
        }
      }
      if (!produced) {
        produced = this._renderFallbackItem(norm);
      }
      if (!produced) continue;
      try {
        produced.setAttribute("data-id", String(norm.idKey));
        produced.setAttribute("data-mc-hash", itemHash);
      } catch (e) {
      }
      try {
        this._elementsMap.set(norm.idKey, produced);
      } catch (e) {
      }
      frag.appendChild(produced);
      shown++;
    }
    if (dropped > 0) {
      const summary = document.createElement("li");
      summary.className = "mc-item mc-summary";
      const plural = dropped > 1 ? "\u043E\u0432" : "";
      summary.innerHTML = this._msg("SUMMARY_MORE", { n: dropped, plural });
      frag.appendChild(summary);
    }
    for (const [did, node] of existing.entries()) {
      try {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      } catch (e) {
      }
      try {
        this._elementsMap.delete(did);
      } catch (_) {
      }
    }
    await new Promise((r) => requestAnimationFrame(r));
    try {
      this.listEl.innerHTML = "";
      this.listEl.appendChild(frag);
    } catch (e) {
      try {
        const tmp = document.createElement("div");
        tmp.appendChild(frag.cloneNode(true));
        this.listEl.innerHTML = tmp.innerHTML;
      } catch (_) {
        this.listEl.innerHTML = "";
      }
    }
    this.updateHeader(normalized.reduce((s, it) => s + Number(it.qty || 0), 0));
  }
  /**
   * Обновляет текст заголовка с учётом общего количества
   * @param {number} totalCount
   */
  updateHeader(totalCount) {
    if (!this.headerTitleEl) return;
    try {
      if (!this._headerBase) {
        this._headerBase = (this.headerTitleEl.textContent || "").replace(/\(\d+\)$/, "").trim() || this.constructor.UI_MESSAGES.HEADER_BASE;
      }
      this.headerTitleEl.textContent = `${this._headerBase} (${Number(totalCount)})`;
      this.headerTitleEl.setAttribute && this.headerTitleEl.setAttribute("aria-live", "polite");
    } catch (e) {
      if (this.opts.debug) console.warn("MiniCart.updateHeader failed", e);
    }
  }
  /**
   * Очищает все внутренние ссылки и кеши
   */
  destroy() {
    try {
      this._elementsMap.clear();
      this.listEl = null;
      this.headerTitleEl = null;
      this.renderer = null;
      this.notifications = null;
      this._lastRenderHash = "";
      this._headerBase = null;
      this._latestCart = null;
      this._pendingRaf = false;
    } catch (e) {
      if (this.opts.debug) console.warn("MiniCart.destroy failed", e);
    }
  }
  /**
   * Удаляет товар из мини‑корзины по идентификатору.
   * Этот метод обновляет внутренний список, инициирует перерисовку
   * и возвращает true, если элемент был найден и удалён. Внутренняя
   * коллекция _latestCart хранит последнюю переданную корзину; если
   * она не определена, метод ничего не делает. Такой подход
   * позволяет удалять элементы из мини‑корзины без необходимости
   * напрямую взаимодействовать с менеджером корзины.
   *
   * @param {any} id Идентификатор товара (name/id/productId)
   * @returns {boolean} true, если элемент был удалён, иначе false
   */
  removeCartItemById(id) {
    const idStr = String(id ?? "").trim();
    if (!idStr) return false;
    if (!Array.isArray(this._latestCart)) return false;
    const normalize = (it) => String(it?.name ?? it?.id ?? it?.productId ?? "").trim();
    const index = this._latestCart.findIndex((it) => normalize(it) === idStr);
    if (index < 0) return false;
    this._latestCart.splice(index, 1);
    try {
      if (this._elementsMap.has(idStr)) {
        const el = this._elementsMap.get(idStr);
        if (el && el.parentNode) el.parentNode.removeChild(el);
        this._elementsMap.delete(idStr);
      }
    } catch (_) {
    }
    this._lastRenderHash = "";
    this.render(this._latestCart);
    return true;
  }
};

// ShopMatic/js/modules/CartModule.js
var CartModule = class {
  static UI_MESSAGES = Object.freeze({
    NOT_ENOUGH_STOCK: "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0442\u043E\u0432\u0430\u0440\u0430 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435.",
    ONLY_X_LEFT: "\u0412 \u043D\u0430\u043B\u0438\u0447\u0438\u0438 \u0442\u043E\u043B\u044C\u043A\u043E {stock} \u0448\u0442.",
    ADDED_TO_CART_HTML: '\u0422\u043E\u0432\u0430\u0440 ({title}) x{qty} \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0443 <a href="#page/cart">\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0443</a>',
    ADDED_TO_CART_PLAIN: '\u0422\u043E\u0432\u0430\u0440 "{title}" x{qty} \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0443.',
    FAVORITES_UNAVAILABLE: "\u041C\u043E\u0434\u0443\u043B\u044C \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D.",
    INSUFFICIENT_STOCK_ADD: "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435. \u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E: {max}.",
    INSUFFICIENT_STOCK_CHANGEQTY: "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435. \u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E: {stock}.",
    PRODUCT_OUT_OF_STOCK: "\u0422\u043E\u0432\u0430\u0440 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435.",
    REACHED_MAX_STOCK_LIMIT_NOTIFY: "\u0414\u043E\u0441\u0442\u0438\u0433\u043D\u0443\u0442 \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u044B\u0439 \u043B\u0438\u043C\u0438\u0442 \u043F\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0443.",
    PRODUCT_LIMIT_DEFAULT: "\u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0435",
    PRODUCT_LIMIT_REACHED: "\u0412\u044B \u0434\u043E\u0441\u0442\u0438\u0433\u043B\u0438 \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0430 \u044D\u0442\u043E\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0430",
    NO_STOCK_TEXT: "\u0422\u043E\u0432\u0430\u0440\u0430 \u043D\u0435\u0442 \u0432 \u043D\u0430\u043B\u0438\u0447\u0438\u0438"
  });
  _msg(key, vars = {}) {
    const pool = this.constructor && this.constructor.UI_MESSAGES || {};
    const tpl = pool[key] ?? "";
    return String(tpl).replace(
      /\{([^}]+)\}/g,
      (m, k) => Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }
  constructor({ storage, productService, renderer, notifications, favorites = null, opts = {} }) {
    this.storage = storage;
    this.productService = productService;
    this.renderer = renderer;
    this.notifications = notifications;
    this.favorites = favorites;
    this.opts = Object.assign({
      saveDebounceMs: 200,
      debug: false,
      parallelProductFetch: true,
      productFetchBatchSize: 20,
      stockCacheTTL: 5e3
    }, opts || {});
    this.cart = [];
    this._idIndex = /* @__PURE__ */ new Map();
    this._pendingChangedIds = /* @__PURE__ */ new Set();
    this._saveTimeout = null;
    this.headerCartNum = null;
    this.cartGrid = null;
    this.cartCountInline = null;
    this.cartTotal = null;
    this.miniCartTotal = null;
    this.miniCart = new MiniCart({ renderer: this.renderer, notifications: this.notifications, opts: opts.miniCart || {} });
    this._gridHandler = null;
    this._gridInputHandler = null;
    this._gridListenersAttachedTo = null;
    this._rowsSyncing = /* @__PURE__ */ new WeakSet();
    this._changeSourceMap = /* @__PURE__ */ new Map();
    this._cssEscape = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape : (s) => String(s).replace(/["\\]/g, "\\$&");
  }
  _logError(...args) {
    if (this.opts.debug) console.error("[CartModule]", ...args);
  }
  // --- Id normalization & index management (incremental) ---
  _normalizeId(id) {
    if (id === void 0 || id === null) return "";
    if (typeof id === "object") {
      return String(id.id ?? id.name ?? id.productId ?? id.cartId ?? id.itemId ?? "").trim();
    }
    return String(id).trim();
  }
  _normalizeIdKey(id) {
    return String(this._normalizeId(id));
  }
  _rebuildIndex() {
    this._idIndex.clear();
    for (let i = 0; i < this.cart.length; i++) {
      const key = this._normalizeIdKey(this.cart[i].name);
      if (key) this._idIndex.set(key, i);
    }
  }
  getCartItems() {
    return this.cart;
  }
  _updateIndexOnInsert(id, index) {
    try {
      const key = this._normalizeIdKey(id);
      if (!key) return;
      for (const [k, idx] of Array.from(this._idIndex.entries())) {
        if (idx >= index) this._idIndex.set(k, idx + 1);
      }
      this._idIndex.set(key, index);
    } catch (e) {
      this._rebuildIndex();
    }
  }
  _updateIndexOnRemove(index) {
    try {
      if (index === void 0 || index === null) {
        this._rebuildIndex();
        return;
      }
      let removedKey = null;
      for (const [k, idx] of Array.from(this._idIndex.entries())) {
        if (idx === index) {
          removedKey = k;
          break;
        }
      }
      if (removedKey) this._idIndex.delete(removedKey);
      for (const [k, idx] of Array.from(this._idIndex.entries())) {
        if (idx > index) this._idIndex.set(k, idx - 1);
      }
    } catch (e) {
      this._rebuildIndex();
    }
  }
  _findCartIndexById(id) {
    const sid = this._normalizeIdKey(id);
    if (!sid) return -1;
    const idx = this._idIndex.get(sid);
    if (typeof idx === "number" && this.cart[idx] && this._normalizeIdKey(this.cart[idx].name) === sid) return idx;
    for (let i = 0; i < this.cart.length; i++) {
      if (this._normalizeIdKey(this.cart[i].name) === sid) {
        this._rebuildIndex();
        return i;
      }
    }
    return -1;
  }
  _getCartItemById(id) {
    const idx = this._findCartIndexById(id);
    return idx >= 0 ? this.cart[idx] : null;
  }
  _getCartQtyById(id) {
    const it = this._getCartItemById(id);
    return it ? Number(it.qty || 0) : 0;
  }
  _formatPrice(value) {
    try {
      return Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(Number(value || 0));
    } catch (e) {
      return String(value || "0");
    }
  }
  _noteChangedId(id) {
    const k = this._normalizeIdKey(id);
    if (k) this._pendingChangedIds.add(k);
  }
  _clearPendingChanged() {
    this._pendingChangedIds.clear();
  }
  _scheduleSave() {
    if (!this.storage || typeof this.storage.saveCart !== "function") return;
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      try {
        this.storage.saveCart(this.cart);
      } catch (e) {
        this._logError("saveCart failed", e);
      }
      this._saveTimeout = null;
    }, Math.max(0, Number(this.opts.saveDebounceMs || 200)));
  }
  _emitUpdateEvent() {
    try {
      const totalCount = this.cart.reduce((s, it) => s + Number(it.qty || 0), 0);
      const totalSum = this.cart.reduce((s, it) => s + Number(it.price || 0) * Number(it.qty || 0), 0);
      const changedIds = Array.from(this._pendingChangedIds);
      this._pendingChangedIds.clear();
      const ev = new CustomEvent("cart:updated", { detail: { cart: this.cart.slice(), totalCount, totalSum, changedIds } });
      window.dispatchEvent(ev);
    } catch (e) {
      this._logError("emitUpdateEvent failed", e);
    }
  }
  // --- product resolution helpers (handles sync or promise) ---
  _isThenable(v) {
    return v && typeof v.then === "function";
  }
  /**
   * Try to get product via productService.findById.
   * Returns either the product (sync) or a Promise that resolves to product or null.
   */
  _resolveProduct(id) {
    try {
      const svc = this.productService;
      if (!svc || typeof svc.findById !== "function") return null;
      const out = svc.findById(id);
      return out;
    } catch (e) {
      return null;
    }
  }
  _mergeProductToItem(item, prod, qtyAdjust = true) {
    if (!item || !prod) return item;
    item.price = Number(prod.price ?? item.price ?? 0);
    item.stock = Number(prod.stock ?? item.stock ?? 0);
    item.fullname = prod.fullname ?? prod.title ?? prod.name ?? item.fullname;
    item.picture = prod.picture ?? prod.image ?? item.picture;
    item.specs = prod.specs ?? item.specs ?? {};
    if (qtyAdjust && Number.isFinite(item.stock) && item.stock >= 0 && item.qty > item.stock) {
      item.qty = Math.max(1, item.stock);
      this._noteChangedId(item.name);
    }
    return item;
  }
  // --- storage load ---
  async loadFromStorage() {
    let raw = [];
    try {
      raw = await (this.storage?.loadCartWithAvailability?.() ?? []);
    } catch (e) {
      this._logError("loadFromStorage: storage.loadCart failed", e);
      raw = [];
    }
    this.cart = (Array.isArray(raw) ? raw : []).map((entry) => {
      if (!entry) return null;
      const name = this._normalizeId(entry.name ?? entry.id ?? entry.title ?? entry.fullname ?? entry.productId ?? entry.cartId ?? "");
      let qty = Number(entry.qty ?? entry.quantity ?? 1);
      if (!Number.isFinite(qty) || qty < 1) qty = 1;
      let syncProd = null;
      try {
        syncProd = this.productService && typeof this.productService.findById === "function" ? this.productService.findById(name) : null;
      } catch (e) {
        syncProd = null;
      }
      if (this._isThenable(syncProd)) syncProd = null;
      if (syncProd) {
        const stock = Number(syncProd.stock || 0);
        if (stock > 0) qty = Math.min(qty, stock);
        return this._normalizeCartItemFromProduct(syncProd, qty);
      }
      return {
        name,
        fullname: entry.fullname || entry.title || entry.name || entry.productName || "\u0422\u043E\u0432\u0430\u0440",
        price: Number(entry.price ?? 0),
        qty,
        picture: entry.picture || entry.image || "/assets/no-image.png",
        stock: Number(entry.stock ?? 0),
        specs: entry.specs || {}
      };
    }).filter(Boolean);
    this._dedupeCart();
    this._rebuildIndex();
    for (const i of this.cart) this._noteChangedId(i.name);
    return this.updateCartUI();
  }
  _normalizeCartItemFromProduct(prod, qty = 1) {
    return {
      name: this._normalizeId(prod.name ?? prod.id ?? prod.title ?? prod.fullname ?? prod.productId ?? ""),
      fullname: prod.fullname ?? prod.title ?? prod.name ?? prod.productName ?? "",
      price: Number(prod.price || 0),
      qty: Number(qty || 1),
      picture: prod.picture || prod.image || "",
      stock: Number(prod.stock || 0),
      specs: prod.specs || {}
    };
  }
  setDomRefs({ headerCartNum, miniCartList, miniCartHeaderTitle, cartGrid, cartCountInline, cartTotal, miniCartTotal } = {}) {
    this.headerCartNum = headerCartNum || this.headerCartNum;
    this.cartGrid = cartGrid || this.cartGrid;
    this.cartCountInline = cartCountInline || this.cartCountInline;
    this.cartTotal = cartTotal || this.cartTotal;
    this.miniCartTotal = miniCartTotal || this.miniCartTotal;
    if (miniCartList || miniCartHeaderTitle) {
      this.miniCart.setDomRefs({ listEl: miniCartList, headerTitleEl: miniCartHeaderTitle });
    }
    if (cartGrid) this._attachGridListeners();
  }
  // --- public mutations: add / remove / changeQty ---
  add(productId, qty = 1) {
    try {
      const id = this._normalizeId(productId);
      if (!id) {
        this._logError("add: empty productId", productId);
        return false;
      }
      const prod = this._resolveProduct(id);
      if (this._isThenable(prod)) {
        return this._addRawEntry(id, qty, null);
      }
      return this._addRawEntry(id, qty, prod ?? null);
    } catch (e) {
      this._logError("add failed", e);
      return false;
    }
  }
  _addRawEntry(id, qty, prod) {
    qty = Math.max(1, parseInt(qty || 1, 10));
    const key = this._normalizeId(id);
    if (!key) return false;
    if (prod) {
      const stock = Number(prod.stock || 0);
      if (stock <= 0) {
        this.notifications?.show?.(this._msg("NOT_ENOUGH_STOCK"), { type: "warning" });
        return false;
      }
      if (qty > stock) {
        this.notifications?.show?.(this._msg("ONLY_X_LEFT", { stock }), { type: "warning" });
        qty = stock;
      }
    }
    const idx = this._findCartIndexById(key);
    if (idx >= 0) {
      const existing = this.cart[idx];
      const proposed = existing.qty + qty;
      const maxAllowed = prod ? Number(prod.stock || existing.stock || 0) : Number(existing.stock || 0);
      if (maxAllowed > 0 && proposed > maxAllowed) {
        this.notifications?.show?.(this._msg("INSUFFICIENT_STOCK_ADD", { max: maxAllowed }), { type: "warning" });
        return false;
      }
      existing.qty = proposed;
      this._noteChangedId(key);
    } else {
      if (prod) {
        const item = this._normalizeCartItemFromProduct(prod, qty);
        this.cart.push(item);
        this._updateIndexOnInsert(item.name, this.cart.length - 1);
        this._noteChangedId(item.name);
      } else {
        const item = {
          name: key,
          fullname: key,
          price: 0,
          qty,
          picture: "/assets/no-image.png",
          stock: 0,
          specs: {}
        };
        this.cart.push(item);
        this._updateIndexOnInsert(item.name, this.cart.length - 1);
        this._noteChangedId(item.name);
      }
    }
    const p = this.updateCartUI();
    try {
      const title = prod && (prod.fullname || prod.title) ? prod.fullname || prod.title : key;
      try {
        this.notifications?.show?.(this._msg("ADDED_TO_CART_HTML", { title, qty }), { type: "success", allowHtml: true });
      } catch (_) {
        this.notifications?.show?.(this._msg("ADDED_TO_CART_PLAIN", { title, qty }), { type: "success" });
      }
    } catch (e) {
      this._logError("notifications.show failed on add", e);
    }
    return p;
  }
  remove(productId) {
    const key = this._normalizeId(productId);
    const idx = this._findCartIndexById(key);
    if (idx >= 0) {
      this._noteChangedId(key);
      this.cart.splice(idx, 1);
      this._updateIndexOnRemove(idx);
      return this.updateCartUI();
    }
    return false;
  }
  changeQty(productId, newQty, opts = {}) {
    try {
      const key = this._normalizeId(productId);
      const idx = this._findCartIndexById(key);
      if (idx < 0) return false;
      let qty = parseInt(newQty || 1, 10);
      if (isNaN(qty) || qty < 1) qty = 1;
      const item = this.cart[idx];
      const prod = this._resolveProduct(key);
      if (this._isThenable(prod)) {
        item.qty = qty;
      } else if (prod) {
        const stock = Number(prod.stock || item.stock || 0);
        if (stock > 0 && qty > stock) {
          this.notifications?.show?.(this._msg("INSUFFICIENT_STOCK_CHANGEQTY", { stock }), { type: "warning" });
          qty = stock;
        }
        item.qty = qty;
      } else {
        item.qty = qty;
      }
      try {
        if (opts && opts.sourceRow instanceof Element) {
          this._changeSourceMap.set(this._normalizeIdKey(key), opts.sourceRow);
        }
      } catch (_) {
      }
      this._noteChangedId(key);
      return this.updateCartUI(productId);
    } catch (e) {
      this._logError("changeQty failed", e);
      return false;
    }
  }
  getCart() {
    return this.cart.map((i) => Object.assign({}, i));
  }
  _dedupeCart() {
    if (!Array.isArray(this.cart) || this.cart.length < 2) return;
    const map = /* @__PURE__ */ new Map();
    for (const item of this.cart) {
      const key = this._normalizeIdKey(item && item.name);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, Object.assign({}, item));
      } else {
        const existing = map.get(key);
        existing.qty = Number(existing.qty || 0) + Number(item.qty || 0);
        if (item.price || item.price === 0) existing.price = Number(item.price);
        if (item.picture) existing.picture = item.picture;
        if (item.fullname) existing.fullname = item.fullname;
        if (Number.isFinite(Number(item.stock))) existing.stock = Number(item.stock);
        existing.specs = Object.assign({}, existing.specs || {}, item.specs || {});
      }
    }
    const merged = Array.from(map.values()).map((it) => {
      if (Number.isFinite(it.stock) && it.stock >= 0 && Number(it.qty) > it.stock) {
        it.qty = Math.max(1, it.stock);
      } else {
        it.qty = Math.max(1, Number(it.qty || 1));
      }
      return it;
    });
    this.cart = merged;
    this._rebuildIndex();
  }
  // --- rendering helpers ---
  async _renderItemsToTemp(items) {
    const tmp = document.createElement("div");
    if (typeof this.renderer.renderCards === "function") {
      await this.renderer.renderCards(tmp, items, this.renderer.foxEngine);
    } else if (typeof this.renderer._renderCartHorizontal === "function") {
      await this.renderer._renderCartHorizontal(tmp, items);
    } else {
      throw new Error("renderer API missing render function");
    }
    return tmp;
  }
  _findRowFromElement(el) {
    if (!el) return null;
    let node = el;
    while (node && node !== document.documentElement) {
      if (node.classList && node.classList.contains("cart-item")) return node;
      node = node.parentElement;
    }
    return null;
  }
  _getIdFromRow(row) {
    if (!row) return "";
    try {
      let id = row.getAttribute && (row.getAttribute("data-id") || row.getAttribute("data-cart-item"));
      if (id) return this._normalizeIdKey(id);
      const qc = row.querySelector && row.querySelector(".qty-controls[data-id]");
      if (qc) return this._normalizeIdKey(qc.getAttribute("data-id"));
      const rb = row.querySelector && row.querySelector(".remove-btn[data-id]");
      if (rb) return this._normalizeIdKey(rb.getAttribute("data-id"));
      const a = row.querySelector && row.querySelector('a[href*="#product/"]');
      if (a && a.getAttribute("href")) {
        const href = a.getAttribute("href");
        const m = href.match(/#product\/([^\/\?#]+)/);
        if (m) return this._normalizeIdKey(m[1]);
      }
      const anyData = row.querySelector && row.querySelector("[data-id],[data-product-id],[data-cart-id]");
      if (anyData) {
        return this._normalizeIdKey(anyData.getAttribute("data-id") || anyData.getAttribute("data-product-id") || anyData.getAttribute("data-cart-id"));
      }
    } catch (e) {
      this._logError("_getIdFromRow failed", e);
    }
    return "";
  }
  _showLimitMsg(row, text = null) {
    if (!row) return;
    try {
      const controls = row.querySelector && (row.querySelector(".cart-item__aside") || row);
      if (!controls) return;
      const msgText = typeof text === "string" && text.length ? text : this._msg("PRODUCT_LIMIT_DEFAULT");
      let m = row.querySelector(".product-limit-msg");
      if (!m) {
        m = document.createElement("div");
        m.className = "product-limit-msg";
        m.textContent = msgText;
        controls.appendChild(m);
        requestAnimationFrame(() => {
          m.style.opacity = "1";
        });
      } else {
        m.textContent = msgText;
        m.style.opacity = "1";
      }
    } catch (e) {
      this._logError("_showLimitMsg failed", e);
    }
  }
  _hideLimitMsg(row) {
    if (!row) return;
    try {
      const m = row.querySelector && row.querySelector(".product-limit-msg");
      if (!m) return;
      m.style.opacity = "0";
      setTimeout(() => {
        const el = row.querySelector && row.querySelector(".product-limit-msg");
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, 320);
    } catch (e) {
      this._logError("_hideLimitMsg failed", e);
    }
  }
  _updateFavButtonState(row, id) {
    if (!row || !id || !this.favorites) return;
    try {
      const favBtn = row.querySelector && row.querySelector(".fav-btn");
      if (!favBtn) return;
      let isFav = false;
      try {
        if (typeof this.favorites.isFavorite === "function") isFav = !!this.favorites.isFavorite(id);
        else if (Array.isArray(this.favorites.getAll && this.favorites.getAll())) isFav = this.favorites.getAll().indexOf(id) >= 0;
      } catch (e) {
        isFav = false;
      }
      favBtn.classList.toggle("is-fav", isFav);
      favBtn.setAttribute("aria-pressed", String(isFav));
      const icon = favBtn.querySelector && favBtn.querySelector("i");
      if (icon) icon.classList.toggle("active", isFav);
    } catch (e) {
      this._logError("_updateFavButtonState failed", e);
    }
  }
  _syncRowControls(row, item) {
    if (!row) return;
    if (this._rowsSyncing.has(row)) return;
    try {
      this._rowsSyncing.add(row);
      const qtyInput = row.querySelector && row.querySelector(".qty-input");
      const btnPlus = row.querySelector && (row.querySelector(".qty-btn.qty-incr") || row.querySelector('[data-action="qty-incr"]') || row.querySelector('[data-role="qty-plus"]'));
      const btnMinus = row.querySelector && (row.querySelector(".qty-btn.qty-decr") || row.querySelector('[data-action="qty-decr"]') || row.querySelector('[data-role="qty-minus"]'));
      let stock = Number.isFinite(Number(item?.stock)) ? Number(item.stock) : NaN;
      if (!Number.isFinite(stock)) {
        const ds = row.getAttribute && row.getAttribute("data-stock");
        stock = ds !== null ? Number(ds) : NaN;
      }
      if (!Number.isFinite(stock)) {
        const modelItem = item?.name ? this._getCartItemById(item.name) : null;
        stock = modelItem ? Number(modelItem.stock || 0) : 0;
      }
      let qty = Number.isFinite(Number(item?.qty)) ? Number(item.qty) : NaN;
      if (!Number.isFinite(qty)) {
        if (qtyInput) {
          const v = parseInt(qtyInput.value || "0", 10);
          qty = Number.isFinite(v) ? v : NaN;
        }
        if (!Number.isFinite(qty)) {
          const modelItem = item?.name ? this._getCartItemById(item.name) : null;
          qty = modelItem ? Number(modelItem.qty || 0) : 0;
        }
      }
      if (!Number.isFinite(stock)) stock = 0;
      if (!Number.isFinite(qty)) qty = 0;
      let stockWarning = row.querySelector && row.querySelector(".stock-warning");
      if (!stockWarning) {
        stockWarning = document.createElement("div");
        stockWarning.className = "stock-warning";
        stockWarning.style.cssText = "color:#c62828;font-size:13px;margin-top:6px;display:none;";
        const right = row.querySelector(".cart-item__aside") || row;
        right.appendChild(stockWarning);
      }
      if (qtyInput) {
        qtyInput.setAttribute("min", "1");
        qtyInput.setAttribute("max", String(stock));
        if (stock <= 0) {
          qtyInput.value = "0";
          qtyInput.disabled = true;
          qtyInput.setAttribute("aria-disabled", "true");
        } else {
          if (qty > stock) qty = stock;
          qtyInput.value = String(Math.max(1, qty));
          qtyInput.disabled = false;
          qtyInput.removeAttribute("aria-disabled");
        }
      }
      if (btnMinus) {
        const disabled = stock <= 0 || qty <= 1;
        btnMinus.disabled = disabled;
        btnMinus.toggleAttribute && btnMinus.toggleAttribute("aria-disabled", disabled);
        btnMinus.classList.toggle("disabled", disabled);
      }
      if (btnPlus) {
        const disabled = stock <= 0 || qty >= stock;
        btnPlus.disabled = disabled;
        btnPlus.toggleAttribute && btnPlus.toggleAttribute("aria-disabled", disabled);
        btnPlus.classList.toggle("disabled", disabled);
        if (stock > 0 && qty >= stock) this._showLimitMsg(row, this._msg("PRODUCT_LIMIT_REACHED"));
        else this._hideLimitMsg(row);
      } else {
        this._hideLimitMsg(row);
      }
      if (stock <= 0) {
        stockWarning.textContent = this._msg("NO_STOCK_TEXT");
        stockWarning.style.display = "";
        stockWarning.setAttribute("aria-hidden", "false");
        row.classList.add("out-of-stock");
        if (btnPlus) {
          btnPlus.disabled = true;
          btnPlus.setAttribute && btnPlus.setAttribute("aria-disabled", "true");
          btnPlus.classList.add("disabled");
        }
        if (btnMinus) {
          btnMinus.disabled = true;
          btnMinus.setAttribute && btnMinus.setAttribute("aria-disabled", "true");
          btnMinus.classList.add("disabled");
        }
        if (qtyInput) {
          qtyInput.value = "0";
          qtyInput.disabled = true;
          qtyInput.setAttribute && qtyInput.setAttribute("aria-disabled", "true");
        }
        this._hideLimitMsg(row);
      } else {
        stockWarning.style.display = "none";
        stockWarning.setAttribute("aria-hidden", "true");
        row.classList.remove("out-of-stock");
      }
      try {
        const id = this._getIdFromRow(row);
        if (id && this.productService && typeof this.productService.findById === "function") {
          const prod = this._resolveProduct(id);
          if (this._isThenable(prod)) {
            prod.then((resolved) => {
              if (!resolved) return;
              const existing = this._getCartItemById(id);
              if (existing) {
                this._mergeProductToItem(existing, resolved, true);
                const mainRow = this._findRowFromElement(row) || row;
                this._syncRowControls(mainRow, existing);
              }
            }).catch((err) => this._logError("single product refresh failed", err));
          } else if (prod) {
            const existing = this._getCartItemById(id);
            if (existing) {
              this._mergeProductToItem(existing, prod, true);
              const mainRow = this._findRowFromElement(row) || row;
              this._syncRowControls(mainRow, existing);
            }
          }
        }
      } catch (e) {
        this._logError("_syncRowControls product refresh failed", e);
      }
    } catch (e) {
      this._logError("_syncRowControls failed", e);
    } finally {
      try {
        this._rowsSyncing.delete(row);
      } catch (_) {
      }
    }
  }
  async updateCartUI(targetId = null) {
    const overrideIdKey = targetId ? this._normalizeIdKey(targetId) : null;
    const changedIdsSnapshot = overrideIdKey ? [String(overrideIdKey)] : Array.from(this._pendingChangedIds);
    this._dedupeCart();
    this._rebuildIndex();
    try {
      if (this.productService && typeof this.productService.findById === "function") {
        if (overrideIdKey) {
          const id = overrideIdKey;
          const item = this._getCartItemById(id);
          if (item) {
            try {
              const prod = this._resolveProduct(id);
              if (this._isThenable(prod)) {
                const resolved = await prod.catch(() => null);
                if (resolved) this._mergeProductToItem(item, resolved, true);
              } else if (prod) this._mergeProductToItem(item, prod, true);
            } catch (e) {
              this._logError("single product fetch failed", e);
            }
          }
        } else {
          const tasks = this.cart.map((item) => {
            const id = this._normalizeId(item.name);
            try {
              const prod = this._resolveProduct(id);
              if (this._isThenable(prod)) {
                return prod.then((res) => ({ id, res })).catch((err) => ({ id, res: null, err }));
              } else {
                return Promise.resolve({ id, res: prod || null });
              }
            } catch (e) {
              return Promise.resolve({ id, res: null, err: e });
            }
          });
          if (this.opts.parallelProductFetch) {
            const settled = await Promise.allSettled(tasks);
            for (const r of settled) {
              if (r.status === "fulfilled" && r.value?.res) {
                const id = r.value.id;
                const resolved = r.value.res;
                const idx = this._findCartIndexById(id);
                if (idx >= 0) {
                  this._mergeProductToItem(this.cart[idx], resolved, true);
                }
              } else if (r.status === "rejected") {
                this._logError("product fetch failed", r.reason);
              }
            }
          } else {
            for (const t of tasks) {
              try {
                const r = await t;
                if (r?.res) {
                  const idx = this._findCartIndexById(r.id);
                  if (idx >= 0) this._mergeProductToItem(this.cart[idx], r.res, true);
                }
              } catch (e) {
                this._logError("sequential product refresh failed", e);
              }
            }
          }
        }
      }
    } catch (e) {
      this._logError("updateCartUI (product fetch) failed", e);
    }
    let totalCount = 0;
    let totalSum = 0;
    for (const it of this.cart) {
      totalCount += Number(it.qty || 0);
      totalSum += Number(it.price || 0) * Number(it.qty || 0);
    }
    try {
      if (this.headerCartNum) {
        this.headerCartNum.textContent = String(totalCount);
        this.headerCartNum.style.display = totalCount > 0 ? "inline-flex" : "none";
        this.headerCartNum.setAttribute("aria-hidden", totalCount > 0 ? "false" : "true");
      }
    } catch (e) {
      this._logError("headerCartNum update failed", e);
    }
    try {
      if (this.miniCart && typeof this.miniCart.updateHeader === "function") this.miniCart.updateHeader(totalCount);
    } catch (e) {
      this._logError("miniCart.updateHeader failed", e);
    }
    try {
      if (this.miniCart && typeof this.miniCart.render === "function") {
        const maybe = this.miniCart.render(this.cart);
        if (this._isThenable(maybe)) await maybe.catch((err) => this._logError("miniCart.render failed", err));
      }
    } catch (e) {
      this._logError("miniCart.render threw", e);
    }
    try {
      if (this.cartGrid && this.renderer) {
        if (overrideIdKey) {
          const id = String(overrideIdKey);
          this._pendingChangedIds.delete(id);
          const esc = this._cssEscape(String(id));
          let targetRow = null;
          try {
            targetRow = this.cartGrid.querySelector(`[data-id="${esc}"]`);
          } catch (_) {
            targetRow = null;
          }
          targetRow = this._findRowFromElement(targetRow) || targetRow;
          const item = this._getCartItemById(id);
          if (!item) {
            const rows = this._findAllRowsByIdInGrid(id);
            for (const r of rows) {
              try {
                if (r.parentNode) r.parentNode.removeChild(r);
              } catch (_) {
              }
            }
            if (this.cart.length === 0) {
              try {
                if (typeof this.renderer._renderCartHorizontal === "function") await this.renderer._renderCartHorizontal(this.cartGrid, this.cart);
              } catch (er) {
                this._logError("render empty state failed", er);
              }
            }
            this._attachGridListeners();
          } else {
            let producedRow = null;
            try {
              const tmp = await this._renderItemsToTemp([item]);
              producedRow = tmp.querySelector(".cart-item") || tmp.firstElementChild;
            } catch (err) {
              this._logError("renderer.render failed (fast-path)", err);
              producedRow = null;
            }
            if (producedRow && producedRow.cloneNode) {
              const clone = producedRow.cloneNode(true);
              clone.setAttribute && clone.setAttribute("data-id", String(id));
              if (targetRow && targetRow.parentNode) {
                try {
                  targetRow.parentNode.replaceChild(clone, targetRow);
                } catch (e) {
                  try {
                    targetRow.parentNode.appendChild(clone);
                  } catch (_) {
                  }
                }
              } else {
                const rows = this._findAllRowsByIdInGrid(id);
                if (rows.length > 0) {
                  try {
                    rows[0].parentNode.replaceChild(clone, rows[0]);
                  } catch (e) {
                    try {
                      this.cartGrid.appendChild(clone);
                    } catch (_) {
                    }
                  }
                  for (let i = 1; i < rows.length; i++) try {
                    if (rows[i].parentNode) rows[i].parentNode.removeChild(rows[i]);
                  } catch (_) {
                  }
                } else {
                  try {
                    this.cartGrid.appendChild(clone);
                  } catch (_) {
                  }
                }
              }
              const mainRow = this._findRowFromElement(clone) || clone;
              if (mainRow && item) this._syncRowControls(mainRow, item);
              if (mainRow) this._updateFavButtonState(mainRow, id);
              try {
                const src = this._changeSourceMap.get(id);
                if (src instanceof Element) {
                  const q = mainRow.querySelector && mainRow.querySelector(".qty-input");
                  if (q) q.focus();
                }
              } catch (_) {
              }
              try {
                this._changeSourceMap.delete(id);
              } catch (_) {
              }
              this._attachGridListeners();
            } else {
              if (typeof this.renderer._renderCartHorizontal === "function") {
                try {
                  await this.renderer._renderCartHorizontal(this.cartGrid, this.cart);
                } catch (er) {
                  this._logError("fallback full render failed (fast-path)", er);
                }
                this._attachGridListeners();
              }
            }
          }
        } else {
          const changedIds = changedIdsSnapshot;
          if (!changedIds.length) {
            if (typeof this.renderer._renderCartHorizontal === "function") {
              await this.renderer._renderCartHorizontal(this.cartGrid, this.cart);
              this._attachGridListeners();
            }
          } else {
            const tasks = changedIds.map(async (id) => {
              const item = this._getCartItemById(id);
              if (!item) return { id, removed: true };
              try {
                const tmp = await this._renderItemsToTemp([item]);
                const produced = tmp.querySelector(".cart-item") || tmp.firstElementChild;
                return { id, produced, item };
              } catch (err) {
                return { id, error: err };
              }
            });
            const settled = await Promise.allSettled(tasks);
            let hadFailure = false;
            const apply = [];
            for (const r of settled) {
              if (r.status === "fulfilled" && r.value) {
                if (r.value.error) {
                  hadFailure = true;
                  this._logError("partial render task error", r.value.error);
                } else apply.push(r.value);
              } else {
                hadFailure = true;
                this._logError("partial render promise rejected", r);
              }
            }
            await new Promise((resolve) => requestAnimationFrame(resolve));
            for (const c of apply) {
              try {
                if (c.removed) {
                  const rows = this._findAllRowsByIdInGrid(c.id);
                  for (const rr of rows) try {
                    if (rr.parentNode) rr.parentNode.removeChild(rr);
                  } catch (_) {
                  }
                  continue;
                }
                if (!c.produced) {
                  hadFailure = true;
                  continue;
                }
                const produced = c.produced.cloneNode(true);
                if (produced.setAttribute) produced.setAttribute("data-id", String(c.id));
                this._applyProducedRowSafely(c.id, produced, c.existingRow);
                const mainRow = this._findRowFromElement(produced) || produced;
                if (c.item) this._syncRowControls(mainRow, c.item);
                this._updateFavButtonState(mainRow, c.id);
              } catch (e) {
                hadFailure = true;
                this._logError("applyChange failed", e);
              }
            }
            if (hadFailure) {
              try {
                await this.renderer._renderCartHorizontal(this.cartGrid, this.cart);
              } catch (e) {
                this._logError("fallback full render failed", e);
              }
            } else {
              if (this.cart.length === 0) {
                try {
                  if (typeof this.renderer._renderCartHorizontal === "function") await this.renderer._renderCartHorizontal(this.cartGrid, this.cart);
                } catch (e) {
                  this._logError("render empty state failed", e);
                }
              }
            }
            this._attachGridListeners();
          }
        }
      }
    } catch (e) {
      this._logError("cart grid update failed, attempting full render", e);
      try {
        if (this.cartGrid && this.renderer && typeof this.renderer._renderCartHorizontal === "function") {
          await this.renderer._renderCartHorizontal(this.cartGrid, this.cart);
          this._attachGridListeners();
        }
      } catch (er) {
        this._logError("full render fallback failed", er);
      }
    }
    try {
      if (this.cartTotal) this.cartTotal.textContent = this._formatPrice(totalSum);
      if (this.miniCartTotal) this.miniCartTotal.textContent = this._formatPrice(totalSum);
      if (this.cartCountInline) this.cartCountInline.textContent = String(totalCount);
    } catch (e) {
      this._logError("totals update failed", e);
    }
    try {
      if (this.cartGrid && changedIdsSnapshot.length) {
        for (const id of changedIdsSnapshot) {
          const esc = this._cssEscape(String(id));
          let row = null;
          try {
            row = this.cartGrid.querySelector(`[data-id="${esc}"]`);
          } catch (err) {
            row = null;
          }
          const mainRow = this._findRowFromElement(row) || row;
          const item = this._getCartItemById(id);
          if (mainRow && item) {
            this._syncRowControls(mainRow, item);
            this._updateFavButtonState(mainRow, id);
          } else if (mainRow) this._updateFavButtonState(mainRow, id);
        }
      }
    } catch (e) {
      this._logError("final sync failed", e);
    }
    this._scheduleSave();
    this._emitUpdateEvent();
    return { cart: this.getCart(), totalCount, totalSum };
  }
  /**
   * Проверяет доступность товара по его id.
   * Учитывает количество товара в корзине и его наличие на складе.
   * @param {string} id - Идентификатор товара
   * @returns {boolean} - Доступность товара (true если доступен, false если нет)
   */
  isAvailable(item) {
    const stock = Number(item.stock);
    const qtyInCart = this._getCartQtyById(item.name);
    return stock > 0 && qtyInCart < stock;
  }
  _findAllRowsByIdInGrid(id) {
    if (!this.cartGrid || !id) return [];
    const esc = this._cssEscape(String(id));
    const nodes = [];
    try {
      const q = this.cartGrid.querySelectorAll(`[data-id="${esc}"]`);
      if (q && q.length) {
        for (const n of q) nodes.push(this._findRowFromElement(n) || n);
      } else {
        const rows = this.cartGrid.querySelectorAll && this.cartGrid.querySelectorAll(".cart-item");
        if (rows) {
          for (const r of rows) {
            try {
              if (this._getIdFromRow(r) === this._normalizeIdKey(id)) nodes.push(r);
            } catch (_) {
            }
          }
        }
      }
    } catch (e) {
      const rows = this.cartGrid.querySelectorAll && this.cartGrid.querySelectorAll(".cart-item");
      if (rows) for (const r of rows) try {
        if (this._getIdFromRow(r) === this._normalizeIdKey(id)) nodes.push(r);
      } catch (_) {
      }
    }
    const uniq = [];
    for (const n of nodes) if (n && uniq.indexOf(n) < 0) uniq.push(n);
    return uniq;
  }
  _applyProducedRowSafely(id, produced, existingRow) {
    if (!this.cartGrid || !produced) return;
    const existingRows = this._findAllRowsByIdInGrid(id);
    try {
      if (existingRows.length > 0) {
        const first = existingRows[0];
        if (first && first.parentNode) {
          try {
            first.parentNode.replaceChild(produced, first);
          } catch (e) {
            this.cartGrid.appendChild(produced);
          }
        } else this.cartGrid.appendChild(produced);
        for (let i = 1; i < existingRows.length; i++) {
          const node = existingRows[i];
          try {
            if (node && node.parentNode) node.parentNode.removeChild(node);
          } catch (_) {
          }
        }
      } else if (existingRow && existingRow.parentNode) {
        try {
          existingRow.parentNode.replaceChild(produced, existingRow);
        } catch (e) {
          this.cartGrid.appendChild(produced);
        }
      } else {
        this.cartGrid.appendChild(produced);
      }
    } catch (e) {
      try {
        this.cartGrid.appendChild(produced);
      } catch (_) {
      }
    }
  }
  // --- grid listeners attach/detach ---
  _attachGridListeners() {
    if (!this.cartGrid) return;
    if (this._gridListenersAttachedTo && this._gridListenersAttachedTo !== this.cartGrid) this._detachGridListeners();
    if (this._gridHandler) return;
    this._gridHandler = (ev) => {
      const target = ev.target;
      const row = this._findRowFromElement(target);
      if (!row) return;
      const id = this._getIdFromRow(row);
      if (!id) return;
      const fav = target.closest && target.closest('.fav-btn, [data-role="fav"]');
      if (fav) {
        ev.preventDefault();
        if (!this.favorites) {
          this.notifications?.show?.(this._msg("FAVORITES_UNAVAILABLE"), { type: "error" });
          return;
        }
        try {
          let res;
          if (typeof this.favorites.toggle === "function") res = this.favorites.toggle(id);
          else if (typeof this.favorites.add === "function" && typeof this.favorites.remove === "function") {
            const now = typeof this.favorites.isFavorite === "function" ? !!this.favorites.isFavorite(id) : false;
            res = now ? this.favorites.remove(id) : this.favorites.add(id);
          }
          const favBtnEl = row.querySelector && row.querySelector(".fav-btn");
          const isFavNow = typeof this.favorites.isFavorite === "function" ? !!this.favorites.isFavorite(id) : false;
          if (favBtnEl) {
            favBtnEl.classList.toggle("is-fav", isFavNow);
            favBtnEl.setAttribute("aria-pressed", String(isFavNow));
          }
          const wishEl = document.getElementById && document.getElementById("wishNum");
          try {
            if (wishEl && typeof this.favorites.getCount === "function") wishEl.textContent = String(this.favorites.getCount());
          } catch (_) {
          }
          if (res && this._isThenable(res)) {
            res.then(() => {
              const finalFav = typeof this.favorites.isFavorite === "function" ? !!this.favorites.isFavorite(id) : false;
              if (favBtnEl) favBtnEl.classList.toggle("is-fav", finalFav);
              if (wishEl && typeof this.favorites.getCount === "function") wishEl.textContent = String(this.favorites.getCount());
            }).catch((err) => this._logError("favorites operation failed", err));
          }
        } catch (e) {
          this._logError("fav handling failed", e);
        }
        return;
      }
      const plus = target.closest && target.closest('.qty-btn.qty-incr, [data-action="qty-incr"], [data-role="qty-plus"]');
      if (plus) {
        ev.preventDefault();
        const item = this._getCartItemById(id);
        if (!item) return;
        const stock = Number(item.stock || 0);
        if (stock <= 0) {
          this.notifications?.show?.(this._msg("PRODUCT_OUT_OF_STOCK"), { type: "warning" });
          this._syncRowControls(row, item);
          return;
        }
        if (item.qty < stock) this.changeQty(id, item.qty + 1, { sourceRow: row });
        else this.notifications?.show?.(this._msg("REACHED_MAX_STOCK_LIMIT_NOTIFY"), { type: "warning" });
        return;
      }
      const minus = target.closest && target.closest('.qty-btn.qty-decr, [data-action="qty-decr"], [data-role="qty-minus"]');
      if (minus) {
        ev.preventDefault();
        const item = this._getCartItemById(id);
        if (!item) return;
        if (item.qty > 1) this.changeQty(id, item.qty - 1, { sourceRow: row });
        return;
      }
      const rem = target.closest && target.closest('.remove-btn, [data-action="remove"], [data-role="remove"]');
      if (rem) {
        ev.preventDefault();
        this.remove(id);
        return;
      }
    };
    this._gridInputHandler = (ev) => {
      const input = ev.target;
      if (!input) return;
      if (!(input.matches && (input.matches(".qty-input") || input.matches('[data-role="qty-input"]') || input.matches('input[type="number"]')))) return;
      const row = this._findRowFromElement(input);
      if (!row) return;
      const id = this._getIdFromRow(row);
      if (!id) return;
      let v = parseInt(input.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      const max = parseInt(input.getAttribute("max") || "0", 10);
      if (Number.isFinite(max) && max > 0 && v > max) v = max;
      this.changeQty(id, v, { sourceRow: row });
    };
    try {
      this.cartGrid.addEventListener("click", this._gridHandler);
      this.cartGrid.addEventListener("change", this._gridInputHandler);
      this._gridListenersAttachedTo = this.cartGrid;
    } catch (e) {
      this._logError("_attachGridListeners failed", e);
    }
  }
  _detachGridListeners() {
    if (!this._gridListenersAttachedTo) return;
    try {
      this._gridListenersAttachedTo.removeEventListener("click", this._gridHandler);
      this._gridListenersAttachedTo.removeEventListener("change", this._gridInputHandler);
    } catch (e) {
      this._logError("_detachGridListeners error", e);
    }
    this._gridHandler = null;
    this._gridInputHandler = null;
    this._gridListenersAttachedTo = null;
  }
  // --- utilities for tests / reset / destroy ---
  clear() {
    for (const i of this.cart) this._noteChangedId(i.name);
    this.cart = [];
    this._rebuildIndex();
    return this.updateCartUI();
  }
  _setCartForTest(cartArray) {
    this.cart = Array.isArray(cartArray) ? cartArray.map((i) => Object.assign({}, i)) : [];
    this._rebuildIndex();
    this.cart.forEach((i) => this._noteChangedId(i.name));
    return this.updateCartUI();
  }
  destroy() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
      try {
        if (this.storage?.saveCart) this.storage.saveCart(this.cart);
      } catch (e) {
        this._logError("final save failed on destroy", e);
      }
    }
    this._detachGridListeners();
    try {
      if (this.miniCart?.destroy) this.miniCart.destroy();
    } catch (e) {
      this._logError("miniCart.destroy failed", e);
    }
  }
};

// ShopMatic/js/modules/FavoritesModule.js
var FavoritesModule = class {
  constructor({ storage, opts = {} } = {}) {
    if (!storage || typeof storage.loadFavs !== "function" || typeof storage.saveFavs !== "function") {
      throw new Error("FavoritesModule requires storage with loadFavs() and saveFavs() methods");
    }
    this.storage = storage;
    this._max = Math.max(0, Number.isFinite(opts.max) ? Math.floor(opts.max) : 0);
    this._overflow = opts.overflow === "drop_oldest" ? "drop_oldest" : "reject";
    this._sync = opts.sync !== void 0 ? Boolean(opts.sync) : true;
    this._saveDebounceMs = Math.max(0, Number.isFinite(opts.saveDebounceMs) ? opts.saveDebounceMs : 200);
    this._storageKey = opts.storageKey || this.storage.favStorageKey || this.storage.storageKey || null;
    this._list = [];
    this._set = /* @__PURE__ */ new Set();
    this._subs = /* @__PURE__ */ new Set();
    this._saveTimer = null;
    this._destroyed = false;
    this._onStorageEvent = this._onStorageEvent.bind(this);
    if (Array.isArray(opts.initial) && opts.initial.length) {
      this.importFromArray(opts.initial, { replace: true, persist: false });
    }
    if (this._sync && typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("storage", this._onStorageEvent);
    }
  }
  // --- Internal Helpers ---
  /**
   * Emit an event to all subscribers.
   * @private
   */
  _emit(event) {
    const payload = {
      type: event.type,
      id: event.id || null,
      reason: event.reason || null,
      list: this.exportToArray(),
      count: this.getCount()
    };
    for (const cb of this._subs) {
      try {
        cb(payload);
      } catch (e) {
        console.warn("FavoritesModule subscriber error", e);
      }
    }
  }
  /**
   * Schedule the save to storage with debounce.
   * @private
   */
  _scheduleSave() {
    if (this._saveDebounceMs <= 0) {
      this._doSave();
      return;
    }
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._doSave();
    }, this._saveDebounceMs);
  }
  /**
   * Perform the actual save to storage.
   * @private
   */
  async _doSave() {
    try {
      const result = this.storage.saveFavs(this._list);
      if (result && typeof result.then === "function") await result;
    } catch (e) {
      console.warn("FavoritesModule: save to storage failed", e);
    }
  }
  /**
   * Normalize an ID into a string.
   * @private
   */
  _normalizeId(id) {
    if (id === null || id === void 0) return null;
    const candidate = id?.name || id?.id || id?.productId || id?._missingId || id;
    const str = String(candidate).trim();
    return str === "" ? null : str;
  }
  /**
   * Apply truncation when exceeding max limit.
   * @private
   */
  _applyMaxTruncate() {
    if (this._max <= 0 || this._list.length <= this._max) return false;
    this._list = this._list.slice(-this._max);
    this._set = new Set(this._list);
    return true;
  }
  // --- Public Methods ---
  /**
   * Load favorites from storage and update the internal list.
   */
  async loadFromStorage() {
    try {
      const raw = await (this.storage.loadFavsWithAvailability ? this.storage.loadFavsWithAvailability() : this.storage.loadFavs());
      const normalized = this._normalizeList(raw);
      this._list = normalized;
      this._set = new Set(normalized);
      if (this._applyMaxTruncate()) this._scheduleSave();
      this._emit({ type: "load", id: null });
      return this.exportToArray();
    } catch (e) {
      console.warn("FavoritesModule.loadFromStorage error", e);
      return this.exportToArray();
    }
  }
  /**
   * Save the current list immediately.
   */
  saveToStorage() {
    if (this._destroyed) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._doSave();
  }
  /**
   * Check if an ID is in favorites.
   */
  has(id) {
    return this.isFavorite(id);
  }
  /**
   * Check if an ID is in favorites.
   */
  isFavorite(id) {
    return this._set.has(this._normalizeId(id));
  }
  /**
   * Get all favorite IDs as an array.
   */
  getAll() {
    return [...this._list];
  }
  /**
   * Get the number of favorites.
   */
  getCount() {
    return this._list.length;
  }
  /**
   * Add an item to favorites.
   */
  add(id) {
    if (this._destroyed) return false;
    const sid = this._normalizeId(id);
    if (!sid || this._set.has(sid)) return false;
    if (this._max > 0 && this._list.length >= this._max) {
      if (this._overflow === "drop_oldest") {
        const removed = this._list.shift();
        if (removed !== void 0) this._set.delete(removed);
      } else {
        this._emit({ type: "limit", id: sid, reason: "limit_reached" });
        return false;
      }
    }
    this._list.push(sid);
    this._set.add(sid);
    this._scheduleSave();
    this._emit({ type: "add", id: sid });
    return true;
  }
  /**
   * Remove an item from favorites.
   */
  remove(id) {
    if (this._destroyed) return false;
    const sid = this._normalizeId(id);
    if (!sid || !this._set.has(sid)) return false;
    this._list = this._list.filter((x) => x !== sid);
    this._set.delete(sid);
    this._scheduleSave();
    this._emit({ type: "remove", id: sid });
    return true;
  }
  /**
   * Toggle an item's presence in favorites.
   */
  toggle(id) {
    if (this._destroyed) return false;
    return this.isFavorite(id) ? this.remove(id) : this.add(id);
  }
  /**
   * Clear all favorites.
   */
  clear() {
    if (this._destroyed) return;
    if (!this._list.length) return;
    this._list = [];
    this._set.clear();
    this._scheduleSave();
    this._emit({ type: "clear", id: null });
  }
  /**
   * Import a list of IDs into the favorites.
   */
  importFromArray(arr = [], { replace = false, persist = true } = {}) {
    if (!Array.isArray(arr)) return this.exportToArray();
    const normalized = this._normalizeList(arr);
    if (replace) {
      this._list = normalized.slice(-this._max);
      this._set = new Set(this._list);
    } else {
      normalized.forEach((sid) => {
        if (!this._set.has(sid)) {
          if (this._max > 0 && this._list.length >= this._max) {
            if (this._overflow === "drop_oldest") {
              const removed = this._list.shift();
              if (removed !== void 0) this._set.delete(removed);
            } else {
              return;
            }
          }
          this._list.push(sid);
          this._set.add(sid);
        }
      });
    }
    if (persist) this._scheduleSave();
    this._emit({ type: "import", id: null });
    return this.exportToArray();
  }
  /**
   * Normalize and deduplicate a list of IDs.
   * @private
   */
  _normalizeList(arr) {
    const seen = /* @__PURE__ */ new Set();
    return arr.reduce((normalized, el) => {
      const sid = this._normalizeId(el);
      if (sid && !seen.has(sid)) {
        seen.add(sid);
        normalized.push(sid);
      }
      return normalized;
    }, []);
  }
  /**
   * Return a copy of the favorites array.
   */
  exportToArray() {
    return [...this._list];
  }
  /**
   * Subscribe to favorites events.
   */
  subscribe(cb, { immediate = true } = {}) {
    if (typeof cb !== "function") throw new Error("subscribe requires a function");
    this._subs.add(cb);
    if (immediate) {
      cb({ type: "load", id: null, list: this.exportToArray(), count: this.getCount() });
    }
    return () => this._subs.delete(cb);
  }
  /**
   * Respond to storage events (cross-tab sync).
   * @private
   */
  async _onStorageEvent(e) {
    const favKey = this._storageKey || this.storage && this.storage.favStorageKey || null;
    if (e?.key === favKey) {
      const prev = this.exportToArray();
      await this.loadFromStorage();
      const curr = this.exportToArray();
      if (prev.length !== curr.length || prev.some((v, i) => v !== curr[i])) {
        this._emit({ type: "sync", id: null });
      }
    }
  }
  /**
   * Destroy the module and clear all timers and listeners.
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    if (this._sync && window.removeEventListener) {
      window.removeEventListener("storage", this._onStorageEvent);
    }
    this._subs.clear();
  }
  /**
   * Iterate over the favorites list (yields IDs).
   */
  [Symbol.iterator]() {
    return this._list[Symbol.iterator]();
  }
  /**
   * Return a new Set containing all favorites.
   */
  toSet() {
    return new Set(this._set);
  }
};

// ShopMatic/js/modules/WishlistModule.js
var WishlistModule = class {
  constructor(opts = {}) {
    this.globalConfig = typeof window !== "undefined" && window.FAV_API_CONFIG ? window.FAV_API_CONFIG : {};
    this.foxEngine = typeof window !== "undefined" && window.foxEngine ? window.foxEngine : opts.foxEngine || null;
    const cfg = Object.assign({}, this.globalConfig, opts);
    this.config = {
      storageKey: this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.FAV_KEY || cfg.storageKey || "gribkov_favs_v1",
      api: {
        enabled: cfg.enabled ?? !!(cfg.baseUrl || this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.apiBase),
        baseUrl: cfg.baseUrl ?? (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.apiBase) ?? "/api",
        endpoints: Object.assign({
          list: "/favorites",
          add: "/favorites",
          remove: "/favorites/{id}",
          clear: "/favorites/clear",
          product: "/products/{id}"
        }, cfg.endpoints || {}),
        getHeaders: cfg.getHeaders || (() => {
          try {
            if (this.foxEngine && this.foxEngine.auth && this.foxEngine.auth.getToken) {
              const t = this.foxEngine.auth.getToken();
              if (t) return { "Authorization": `Bearer ${t}` };
            }
            if (typeof this.globalConfig.getAuthToken === "function") {
              const t = this.globalConfig.getAuthToken();
              if (t) return { [this.globalConfig.authHeader || "Authorization"]: t };
            }
          } catch (_) {
          }
          return { "Content-Type": "application/json" };
        }),
        fetchOptions: cfg.fetchOptions || { credentials: "same-origin" },
        debug: cfg.debug ?? false,
        optimisticRemoveDelayMs: cfg.optimisticRemoveDelayMs ?? 180
      },
      selectors: {
        grid: "#wishlist-grid",
        count: "#fav-count",
        clearBtn: "#clear-wishlist",
        backBtn: "#back-to-shop"
      },
      ui: {
        loadingText: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...",
        emptyTitle: "\u0421\u043F\u0438\u0441\u043E\u043A \u0436\u0435\u043B\u0430\u0435\u043C\u043E\u0433\u043E \u043F\u0443\u0441\u0442",
        emptyBody: "\u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0442\u043E\u0432\u0430\u0440\u044B \u0432 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0430 \u2014 \u043E\u043D\u0438 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C.",
        removedError: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0438 \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E",
        removeFailedRefresh: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u2014 \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0441\u043F\u0438\u0441\u043E\u043A",
        cleared: "\u0421\u043F\u0438\u0441\u043E\u043A \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043E\u0447\u0438\u0449\u0435\u043D!",
        clearConfirm: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E?",
        clearCascadeDelay: 50
      },
      debounceMs: cfg.debounceMs ?? 120,
      availabilityDebounceMs: cfg.availabilityDebounceMs ?? 40
    };
    this.grid = null;
    this.countEl = null;
    this.clearBtn = null;
    this.backBtn = null;
    this._refreshTimer = null;
    this._cartUpdateTimer = null;
    this._storageHandler = this._onStorageEvent.bind(this);
    this._cartHandler = this._onCartUpdated.bind(this);
    this._clearHandler = null;
    this._backHandler = null;
    this._gridClickHandler = null;
    this._destroyed = false;
  }
  /* ---------- logging ---------- */
  _log(...args) {
    if (this.config.api.debug) console.info("[Wishlist]", ...args);
  }
  _error(...args) {
    if (this.config.api.debug) console.error("[Wishlist]", ...args);
  }
  /* ---------- helpers ---------- */
  _normalizeIdRaw(id) {
    if (id === void 0 || id === null) return "";
    if (typeof id === "object") return String(id.id ?? id.name ?? id.productId ?? id.cartId ?? id.itemId ?? "").trim();
    return String(id).trim();
  }
  _normalizeKey(id) {
    return String(this._normalizeIdRaw(id));
  }
  notify(text, opts = {}) {
    try {
      if (this.foxEngine && this.foxEngine.notifications && typeof this.foxEngine.notifications.show === "function") {
        return this.foxEngine.notifications.show(text, opts);
      }
      if (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.notifications && typeof this.foxEngine.shopMatic.notifications.show === "function") {
        return this.foxEngine.shopMatic.notifications.show(text, opts);
      }
    } catch (e) {
      this._error("notify hook failed", e);
    }
    if (opts.type === "error") alert(text);
  }
  async _apiFetch(path, init = {}) {
    const base = (this.config.api.baseUrl || "/").replace(/\/$/, "");
    const url = path && path.startsWith("http") ? path : `${base}/${String(path).replace(/^\//, "")}`;
    const headers = Object.assign({}, this.config.api.getHeaders ? this.config.api.getHeaders() : {}, init.headers || {});
    const merged = Object.assign({}, this.config.api.fetchOptions || {}, init, { headers });
    this._log("apiFetch", url, merged);
    const res = await fetch(url, merged);
    if (!res.ok) {
      const txt = await res.text().catch(() => null);
      const err = new Error(`API ${res.status} ${res.statusText}${txt ? " \u2014 " + txt.slice(0, 200) : ""}`);
      err.response = res;
      throw err;
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    return await res.text();
  }
  /* ---------- DOM helpers & animations ---------- */
  _findNodesByKey(idKey) {
    if (!this.grid) return [];
    const nodes = Array.from(this.grid.querySelectorAll("[data-product-id]"));
    return nodes.filter((n) => this._normalizeKey(n.getAttribute("data-product-id") || "") === this._normalizeKey(idKey));
  }
  _appleRemoveAnimation(node, opts = {}) {
    return new Promise((resolve) => {
      if (!node || !node.parentNode) return resolve(false);
      try {
        if (typeof node.animate === "function") {
          const keyframes = [
            { transform: "scale(1) translateY(0)", opacity: 1, filter: "blur(0px)" },
            { transform: "scale(0.98) translateY(-6px)", opacity: 0.8, filter: "blur(2px)", offset: 0.4 },
            { transform: "scale(0.9) translateY(-20px)", opacity: 0, filter: "blur(6px)" }
          ];
          const timing = { duration: opts.duration || 600, easing: opts.easing || "cubic-bezier(.22,.61,.36,1)", fill: "forwards" };
          const prevZ = node.style.zIndex;
          node.style.zIndex = 9999;
          const anim = node.animate(keyframes, timing);
          anim.onfinish = () => {
            node.style.zIndex = prevZ;
            node.remove();
            resolve(true);
          };
          anim.oncancel = anim.onfinish;
          return;
        }
        node.style.transition = "all 0.6s cubic-bezier(.22,.61,.36,1)";
        node.style.opacity = "0";
        node.style.transform = "translateY(-20px) scale(0.9)";
        node.style.filter = "blur(4px)";
        setTimeout(() => {
          try {
            node.remove();
          } catch (_) {
          }
          ;
          resolve(true);
        }, 600);
      } catch (e) {
        try {
          node.remove();
        } catch (_) {
        }
        resolve(true);
      }
    });
  }
  async _removeNodeElem(node) {
    if (!node || !node.parentNode) return false;
    if (node.dataset.removing === "1") return false;
    node.dataset.removing = "1";
    const ok = await this._appleRemoveAnimation(node).catch(() => true);
    try {
      delete node.dataset.removing;
    } catch (_) {
    }
    try {
      if (this.countEl && typeof this.countEl.animate === "function") {
        this.countEl.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 360, easing: "cubic-bezier(.2,.9,.2,1)" });
      } else if (this.countEl) {
        this.countEl.style.transition = "transform 180ms ease";
        this.countEl.style.transform = "scale(1.06)";
        setTimeout(() => {
          if (this.countEl) this.countEl.style.transform = "";
        }, 180);
      }
    } catch (_) {
    }
    return ok;
  }
  async removeNodeById(id) {
    if (!id) return;
    const key = this._normalizeKey(id);
    const nodes = this._findNodesByKey(key);
    if (!nodes.length) return;
    await Promise.all(nodes.map((n) => this._removeNodeElem(n)));
    this.recalcCount();
  }
  async removeNodesByIds(ids = []) {
    const uniq = Array.isArray(ids) ? Array.from(new Set(ids.map(this._normalizeKey.bind(this)))) : [];
    const promises = [];
    for (const k of uniq) {
      const nodes = this._findNodesByKey(k);
      for (const n of nodes) promises.push(this._removeNodeElem(n));
    }
    if (promises.length) await Promise.all(promises);
    this.recalcCount();
  }
  recalcCount() {
    try {
      if (!this.countEl) return;
      if (!this.grid) {
        this.countEl.textContent = "\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C: 0";
        return;
      }
      const cards = Array.from(this.grid.querySelectorAll("[data-product-id]"));
      const set = new Set(cards.map((c) => this._normalizeKey(c.getAttribute("data-product-id") || "")));
      const n = set.size;
      this.countEl.textContent = n > 0 ? `\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C: ${n}` : "\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C \u043F\u0443\u0441\u0442\u043E";
    } catch (e) {
      this._error("recalcCount failed", e);
    }
  }
  _dispatchLocalStorageEvent(key, oldValue, newValue) {
    try {
      const ev = new StorageEvent("storage", { key, oldValue, newValue, url: location.href, storageArea: localStorage });
      window.dispatchEvent(ev);
    } catch (e) {
      try {
        window.dispatchEvent(new CustomEvent("favorites:changed", { detail: { key, oldValue, newValue } }));
      } catch (_) {
      }
    }
  }
  normalizeFavoritesArray(arr) {
    return (Array.isArray(arr) ? arr : []).map((entry) => {
      if (!entry) return null;
      if (typeof entry === "string" || typeof entry === "number") {
        const sid = String(entry);
        return { _missingId: sid, name: sid, fullname: sid, price: null, picture: "", stock: 0, short: "\u0422\u043E\u0432\u0430\u0440 (\u0434\u0430\u043D\u043D\u044B\u0435 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u044E\u0442)" };
      }
      const id = this._normalizeIdRaw(entry.name ?? entry.id ?? entry.productId ?? entry.title ?? entry.fullname ?? entry._missingId ?? "");
      return {
        _missingId: entry._missingId ?? "",
        name: id || "",
        fullname: entry.fullname ?? entry.title ?? entry.name ?? id,
        price: entry.price != null ? entry.price : entry.cost != null ? entry.cost : null,
        oldPrice: entry.oldPrice ?? entry.previousPrice ?? null,
        picture: entry.picture ?? entry.image ?? entry.img ?? "",
        stock: entry.stock,
        short: entry.short ?? entry.summary ?? entry.description ?? "",
        raw: entry
      };
    }).filter(Boolean);
  }
  /* ---------- remove / optimistic remove ---------- */
  async removeFromFav(id) {
    const key = this._normalizeIdRaw(id);
    if (!key) return false;
    try {
      if (this.foxEngine && this.foxEngine.shopMatic && typeof this.foxEngine.shopMatic.removeFavorite === "function") {
        await Promise.resolve(this.foxEngine.shopMatic.removeFavorite(key));
        this._log("removed via shopMatic", key);
        await this.removeNodeById(key);
        return true;
      }
    } catch (e) {
      this._error("shopMatic.removeFavorite failed", e);
    }
    if (this.config.api.enabled) {
      try {
        const path = this.config.api.endpoints.remove.replace("{id}", encodeURIComponent(key));
        try {
          await this._apiFetch(path, { method: "DELETE" });
        } catch {
          await this._apiFetch(path, { method: "POST", body: JSON.stringify({ id: key }) });
        }
        this._log("removed via API", key);
        await this.removeNodeById(key);
        return true;
      } catch (e) {
        this._error("API removeFromFav failed", e);
      }
    }
    try {
      const raw = localStorage.getItem(this.config.storageKey);
      if (!raw) {
        await this.removeNodeById(key);
        return true;
      }
      let arr = JSON.parse(raw) || [];
      arr = arr.filter((x) => this._normalizeKey(x) !== this._normalizeKey(key));
      const old = localStorage.getItem(this.config.storageKey);
      localStorage.setItem(this.config.storageKey, JSON.stringify(arr));
      this._dispatchLocalStorageEvent(this.config.storageKey, old, JSON.stringify(arr));
      this._log("removed from localStorage", key);
      await this.removeNodeById(key);
      return true;
    } catch (e) {
      this._error("removeFromFav fallback failed", e);
      this.notify(this.config.ui.removedError, { type: "error" });
      return false;
    }
  }
  async optimisticRemoveUI(id, node) {
    if (!id) return;
    try {
      if (node && node.parentNode) {
        const animPromise = this._removeNodeElem(node);
        const backendPromise = this.removeFromFav(id);
        const res = await Promise.all([animPromise, backendPromise]).catch(() => [true, false]);
        const ok = Array.isArray(res) ? Boolean(res[1]) : Boolean(res);
        if (!ok) throw new Error("remove returned false");
        this._log("optimistic remove succeeded", id);
      } else {
        const ok = await this.removeFromFav(id);
        if (!ok) {
          throw new Error("remove returned false");
        }
      }
    } catch (e) {
      this._error("optimisticRemoveUI failed", e);
      this.notify(this.config.ui.removeFailedRefresh, { type: "error" });
      this.refresh(true);
    }
    this.recalcCount();
    this.removeFromFav(id);
  }
  /* ---------- availability refresh (cart updates) ---------- */
  scheduleAvailabilityRefresh(delay = this.config.availabilityDebounceMs) {
    if (this._cartUpdateTimer) clearTimeout(this._cartUpdateTimer);
    this._cartUpdateTimer = setTimeout(() => {
      this._cartUpdateTimer = null;
      this.updateAllCardAvailability();
    }, delay);
  }
  updateAllCardAvailability() {
    try {
      if (!this.grid) return;
      const cards = Array.from(this.grid.querySelectorAll("[data-product-id]"));
      if (!cards.length) return;
      const cardApi = this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.card ? this.foxEngine.shopMatic.card : null;
      const useSync = cardApi && typeof cardApi._syncCardControlsState === "function";
      let cartItems = [];
      try {
        if (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.cart) {
          const cart = this.foxEngine.shopMatic.cart;
          if (typeof cart.getCart === "function") cartItems = cart.getCart() || [];
          else if (Array.isArray(cart.cart)) cartItems = cart.cart;
        }
      } catch (_) {
        cartItems = [];
      }
      const cartMap = /* @__PURE__ */ new Map();
      for (const it of cartItems) {
        try {
          const k = this._normalizeKey(it.name ?? it.id ?? it.productId ?? it.cartId ?? "");
          cartMap.set(k, Number(it.qty || it.quantity || 0));
        } catch (_) {
        }
      }
      for (const card of cards) {
        try {
          if (useSync) {
            try {
              cardApi._syncCardControlsState(card);
              continue;
            } catch (e) {
            }
          }
          const pidRaw = card.getAttribute("data-product-id") || card.getAttribute("data-id") || card.dataset?.productId || "";
          const pid = this._normalizeKey(pidRaw);
          let stock = NaN;
          try {
            if (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.productService && typeof this.foxEngine.shopMatic.productService.findById === "function") {
              const prod = this.foxEngine.shopMatic.productService.findById(pidRaw) || this.foxEngine.shopMatic.productService.findById(pid) || null;
              if (prod) stock = Number(prod.stock ?? prod._stock ?? prod.count ?? 0);
            }
          } catch (_) {
            stock = NaN;
          }
          if (!Number.isFinite(stock)) {
            const ds = card.getAttribute && card.getAttribute("data-stock");
            stock = ds !== null ? Number(ds) : NaN;
          }
          if (!Number.isFinite(stock)) stock = 0;
          const inCartQty = cartMap.get(pid) || 0;
          const available = Math.max(0, Number(stock) - Number(inCartQty));
          const buyBtn = card.querySelector && card.querySelector('[data-role="buy"], [data-action="buy"], .btn-buy');
          const incrBtn = card.querySelector && card.querySelector('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]');
          const decrBtn = card.querySelector && card.querySelector('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]');
          const qtyInput = card.querySelector && card.querySelector('[data-role="qty-input"], .qty-input, input[type="number"]');
          const leftNum = card.querySelector && card.querySelector(".leftNum");
          if (leftNum) leftNum.textContent = String(available);
          if (buyBtn) {
            buyBtn.disabled = available <= 0;
            buyBtn.toggleAttribute && buyBtn.toggleAttribute("aria-disabled", available <= 0);
          }
          if (incrBtn && qtyInput) {
            const currentVal = Math.max(0, parseInt(qtyInput.value || "0", 10));
            const disableIncr = !available || currentVal >= available;
            incrBtn.disabled = disableIncr;
            incrBtn.toggleAttribute && incrBtn.toggleAttribute("aria-disabled", disableIncr);
          }
          if (qtyInput) {
            if (!available) {
              qtyInput.disabled = true;
              qtyInput.setAttribute && qtyInput.setAttribute("aria-disabled", "true");
              qtyInput.value = "0";
            } else {
              qtyInput.disabled = false;
              qtyInput.removeAttribute && qtyInput.removeAttribute("aria-disabled");
              let val = parseInt(qtyInput.value || "1", 10);
              val = isNaN(val) || val < 1 ? 1 : Math.min(val, available);
              qtyInput.value = String(val);
            }
          }
          if (decrBtn && qtyInput) {
            const v = parseInt(qtyInput.value || "0", 10);
            const disabled = v <= 1;
            decrBtn.disabled = disabled;
            decrBtn.toggleAttribute && decrBtn.toggleAttribute("aria-disabled", disabled);
          }
        } catch (e) {
          this._error("updateAllCardAvailability: card update failed", e);
        }
      }
    } catch (e) {
      this._error("updateAllCardAvailability failed", e);
    }
  }
  _onStorageEvent(e) {
    try {
      if (!e) return;
      if (e.key !== this.config.storageKey && e.key !== null) return;
      let newIds = [];
      try {
        const raw = localStorage.getItem(this.config.storageKey);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) newIds = arr.map(String).map((s) => this._normalizeKey(s));
        }
      } catch (_) {
        newIds = [];
      }
      const domIds = Array.from(this.grid ? this.grid.querySelectorAll("[data-product-id]") : []).map((c) => this._normalizeKey(c.getAttribute("data-product-id") || "")).filter(Boolean);
      const toRemove = domIds.filter((d) => !newIds.includes(d));
      if (toRemove.length) this.removeNodesByIds(toRemove);
      else this.refresh(true);
    } catch (e2) {
      this._error("storage listener error", e2);
      this.refresh(true);
    }
  }
  _onCartUpdated() {
    this.scheduleAvailabilityRefresh(this.config.availabilityDebounceMs);
  }
  /* ---------- render ---------- */
  async renderGrid() {
    if (!this.grid) return;
    this.grid.innerHTML = "";
    let items = [];
    try {
      items = this.foxEngine && this.foxEngine.shopMatic && typeof this.foxEngine.shopMatic.getFavorites === "function" ? this.foxEngine.shopMatic.getFavorites() : [];
    } catch (e) {
      this._error("renderGrid fetchFavorites failed", e);
      items = [];
    }
    const dedup = /* @__PURE__ */ new Map();
    for (const p of items) {
      const key = this._normalizeKey(p && (p.name || p._missingId || p.id || p.productId));
      if (!key) continue;
      if (!dedup.has(key)) dedup.set(key, p);
      else {
        const existing = dedup.get(key);
        existing.qty = Math.max(existing.qty || 1, p.qty || existing.qty || 1);
      }
    }
    const uniqueItems = Array.from(dedup.values());
    if (this.countEl) this.countEl.textContent = uniqueItems && uniqueItems.length ? `\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C: ${uniqueItems.length}` : "\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C \u043F\u0443\u0441\u0442\u043E";
    if (!uniqueItems || uniqueItems.length === 0) {
      this.grid.innerHTML = `<div class="empty" role="status"><h3>${this.config.ui.emptyTitle}</h3><p>${this.config.ui.emptyBody}</p></div>`;
      return;
    }
    try {
      if (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.renderer && typeof this.foxEngine.shopMatic.renderer._renderCartVertical === "function") {
        this.foxEngine.shopMatic.renderer._renderCartVertical(items, this.grid);
      } else {
        const frag = document.createDocumentFragment();
        for (const it of uniqueItems) {
          const id = this._normalizeIdRaw(it.name || it._missingId || "");
          const card = document.createElement("div");
          card.className = "wish-card";
          card.setAttribute("data-product-id", id);
          card.innerHTML = `
            <div class="wish-thumb"><img src="${this._escapeAttr(it.picture || "/assets/no-image.png")}" alt="${this._escapeAttr(it.fullname || it.name || id)}" loading="lazy"></div>
            <div class="wish-body">
              <div class="wish-name">${this._escapeHtml(it.fullname || it.name || id)}</div>
              <div class="wish-meta">${it.price != null ? this._escapeHtml(String(it.price) + " \u20BD") : ""}</div>
              <button class="wish-remove" data-action="fav-remove" aria-label="\u0423\u0434\u0430\u043B\u0438\u0442\u044C">\u0423\u0434\u0430\u043B\u0438\u0442\u044C</button>
            </div>`;
          frag.appendChild(card);
        }
        this.grid.appendChild(frag);
      }
    } catch (e) {
      this._error("renderGrid renderer failed", e);
    }
    try {
      if (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.card && typeof this.foxEngine.shopMatic.card._bindCardDelegation === "function") {
        this.foxEngine.shopMatic.card._bindCardDelegation(this.grid);
      }
    } catch (_) {
    }
    setTimeout(() => {
      for (const card of this.grid.querySelectorAll("[data-product-id]")) {
        try {
          if (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.card && typeof this.foxEngine.shopMatic.card._syncCardControlsState === "function") {
            this.foxEngine.shopMatic.card._syncCardControlsState(card);
          }
          const pid = card.getAttribute("data-product-id");
          if (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.renderer && typeof this.foxEngine.shopMatic.renderer.updateProductCardFavState === "function") {
            this.foxEngine.shopMatic.renderer.updateProductCardFavState(this.grid, pid, this.foxEngine.shopMatic.isFavorite && this.foxEngine.shopMatic.isFavorite(pid));
          }
        } catch (_) {
        }
      }
      this.scheduleAvailabilityRefresh(60);
    }, 300);
  }
  _escapeHtml(s = "") {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  _escapeAttr(s = "") {
    return this._escapeHtml(s);
  }
  /* ---------- UI helpers ---------- */
  _setButtonLoading(btn, loading) {
    if (!btn) return;
    try {
      btn.disabled = !!loading;
      if (loading) {
        btn.setAttribute("aria-busy", "true");
        btn.dataset.origText = btn.innerHTML;
        btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;"><i class="fa fa-spinner fa-spin" aria-hidden="true"></i> \u041E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430...</span>';
      } else {
        btn.removeAttribute("aria-busy");
        if (btn.dataset.origText) {
          btn.innerHTML = btn.dataset.origText;
          delete btn.dataset.origText;
        }
      }
    } catch (e) {
      this._error("setButtonLoading failed", e);
    }
  }
  decrementCount() {
    try {
      if (!this.countEl) return;
      const txt = (this.countEl.textContent || "").match(/\d+/);
      if (txt && txt[0]) {
        const v = Math.max(0, parseInt(txt[0], 10) - 1);
        this.countEl.textContent = v > 0 ? `\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C: ${v}` : "\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C \u043F\u0443\u0441\u0442\u043E";
        try {
          if (typeof this.countEl.animate === "function") {
            this.countEl.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 360, easing: "cubic-bezier(.2,.9,.2,1)" });
          }
        } catch (_) {
        }
      } else this.refresh(true);
    } catch (e) {
      this._error("decrementCount failed", e);
    }
  }
  /* ---------- lifecycle: init / refresh / destroy ---------- */
  init() {
    if (this._destroyed) return;
    const sel = this.config.selectors;
    this.grid = document.querySelector(sel.grid);
    this.countEl = document.querySelector(sel.count);
    this.clearBtn = document.querySelector(sel.clearBtn);
    this.backBtn = document.querySelector(sel.backBtn);
    if (this.countEl) this.countEl.textContent = this.config.ui.loadingText;
    if (this.clearBtn) {
      this._clearHandler = async () => {
        if (!confirm(this.config.ui.clearConfirm)) return;
        this._setButtonLoading(this.clearBtn, true);
        const preNodes = this.grid ? Array.from(this.grid.querySelectorAll("[data-product-id]")) : [];
        try {
          if (!preNodes.length) {
            this.notify(this.config.ui.cleared, { type: "success" });
            this._setButtonLoading(this.clearBtn, false);
            return;
          }
          const ids = Array.from(new Set(preNodes.map((n) => n.getAttribute("data-product-id")))).filter(Boolean);
          const tasks = [];
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const node = this._findNodesByKey(id)[0];
            const delay = i * this.config.ui.clearCascadeDelay;
            const p = new Promise((res) => {
              setTimeout(async () => {
                try {
                  if (node) await this._removeNodeElem(node);
                  await this.removeFromFav(id);
                  res(true);
                } catch (e) {
                  res(false);
                }
              }, delay);
            });
            tasks.push(p);
          }
          await Promise.all(tasks);
          await this.refresh(true);
          this.notify(this.config.ui.cleared, { type: "success" });
        } catch (e) {
          this._error("clear button failed", e);
          this.notify("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E", { type: "error" });
        } finally {
          this._setButtonLoading(this.clearBtn, false);
        }
      };
      this.clearBtn.addEventListener("click", this._clearHandler);
    }
    if (this.backBtn) {
      this._backHandler = () => {
        if (document.referrer) location.href = document.referrer;
        else history.back();
      };
      this.backBtn.addEventListener("click", this._backHandler);
    }
    window.addEventListener("storage", this._storageHandler);
    window.addEventListener("cart:updated", this._cartHandler);
    this._gridClickHandler = (ev) => {
      const t = ev.target;
      const rem = t.closest && t.closest('[data-role="fav"], .wish-remove');
      if (rem && this.grid && this.grid.contains(rem)) {
        ev.stopPropagation();
        const card = rem.closest && rem.closest("[data-product-id]");
        const id = card ? card.getAttribute("data-product-id") || "" : "";
        this.optimisticRemoveUI(id, card);
      }
    };
    if (this.grid) this.grid.addEventListener("click", this._gridClickHandler);
    this.refresh(true);
  }
  refresh(force = false) {
    if (this._destroyed) return;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this.renderGrid().catch((e) => this._error("renderGrid failed", e));
    }, force ? 0 : this.config.debounceMs);
  }
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    try {
      window.removeEventListener("storage", this._storageHandler);
      window.removeEventListener("cart:updated", this._cartHandler);
      if (this.clearBtn && this._clearHandler) this.clearBtn.removeEventListener("click", this._clearHandler);
      if (this.backBtn && this._backHandler) this.backBtn.removeEventListener("click", this._backHandler);
      if (this.grid && this._gridClickHandler) this.grid.removeEventListener("click", this._gridClickHandler);
    } catch (e) {
    }
    this.grid = null;
    this.countEl = null;
    this.clearBtn = null;
    this.backBtn = null;
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (this._cartUpdateTimer) {
      clearTimeout(this._cartUpdateTimer);
      this._cartUpdateTimer = null;
    }
  }
};

// ShopMatic/js/modules/Gallery.js
var Gallery = class {
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
    if (!rootEl) throw new Error("Gallery root element required");
    const defaults = {
      thumbContainerSelector: ".gallery-thumbs",
      thumbSelector: "[data-thumb]",
      mainSelector: "#product-main-image",
      mainFrameSelector: ".main-frame",
      modalId: "galleryModal",
      circular: true,
      preloadAdjacent: 1,
      swipeThreshold: 40,
      transitionMs: 180,
      renderThumbs: true,
      placeholder: "",
      nav: true,
      navPrevClass: "gallery-nav-prev",
      navNextClass: "gallery-nav-next",
      navWrapperClass: "gallery-nav",
      thumbScrollClass: "gallery-thumb-scroll",
      thumbScrollIconClass: "fa fa-chevron-down",
      animation: "slide"
    };
    this.options = Object.assign({}, defaults, options);
    this.root = rootEl;
    this.mainImg = this.root.querySelector(this.options.mainSelector);
    this.mainFrame = this.root.querySelector(this.options.mainFrameSelector);
    this.modal = document.getElementById(this.options.modalId) || null;
    this.modalImg = this.modal ? this.modal.querySelector(".gallery-main-img") : null;
    this._listeners = /* @__PURE__ */ new Map();
    this._listenerId = 0;
    this._thumbContainer = this.root.querySelector(this.options.thumbContainerSelector) || null;
    this._thumbs = [];
    this.images = [];
    this.current = 0;
    this._prevIndex = -1;
    this._animating = false;
    this._animDuration = Math.max(40, Number(this.options.transitionMs) || 180);
    this._tmpImage = null;
    this._thumbScrollBtn = null;
    this._thumbScrollObserver = null;
    this._thumbScrollRAF = null;
    this._thumbScrollAttached = false;
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
    this._navInitialized = false;
    this._thumbHandlersBound = false;
    if (this.mainFrame) {
      const csPos = window.getComputedStyle(this.mainFrame).position;
      if (csPos === "static" || !csPos) this.mainFrame.style.position = "relative";
      this.mainFrame.style.overflow = "hidden";
      if (!this.mainFrame.style.zIndex) this.mainFrame.style.zIndex = "0";
      try {
        this.mainFrame.style.touchAction = this.mainFrame.style.touchAction || "pan-y";
      } catch (e) {
      }
    }
    if (this.mainImg) {
      const objFit = this.mainImg.style.objectFit || "contain";
      this.mainImg.style.objectFit = objFit;
      this.mainImg.style.transition = `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration / 2)}ms ease`;
      this.mainImg.style.transform = "translateX(0)";
      this.mainImg.style.zIndex = "1";
      this.mainImg.draggable = false;
      this.mainImg.style.willChange = "transform, opacity";
    }
    this._bound = {
      _onMainClick: (e) => this._onMainClick(e),
      _onRootKey: (e) => this._onRootKey(e)
    };
    this._bindHandlers();
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
    try {
      rec.el.removeEventListener(rec.evt, rec.fn, rec.opts);
    } catch (e) {
    }
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
    if (typeof images === "string") {
      const s = images.trim();
      if (!s) return [];
      try {
        return this._normalizeImages(JSON.parse(s));
      } catch (e) {
        return this._normalizeImages([s]);
      }
    }
    if (!Array.isArray(images) && typeof images === "object") {
      if (Array.isArray(images.images)) return this._normalizeImages(images.images);
      const maybe = ["gallery", "files", "pictures", "photos"];
      for (const k of maybe) if (Array.isArray(images[k])) return this._normalizeImages(images[k]);
      const single = this._extractSrc(images);
      return single ? [{ id: null, src: single, thumb: single, alt: "" }] : [];
    }
    if (Array.isArray(images)) {
      const out = [];
      for (let i = 0; i < images.length; i++) {
        const norm = this._normalizeImageItem(images[i], i);
        if (norm && norm.src) out.push(norm);
      }
      const seen = /* @__PURE__ */ new Set();
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
    if (typeof item === "string") {
      const s = item.trim();
      return s ? { id: null, src: s, thumb: s, alt: "" } : null;
    }
    if (Array.isArray(item)) {
      for (const it of item) {
        const n = this._normalizeImageItem(it, idx);
        if (n && n.src) return n;
      }
      return null;
    }
    if (typeof item === "object") {
      const fields = ["src", "url", "path", "file", "location", "image"];
      const thumbFields = ["thumb", "thumbnail", "preview"];
      let src = "";
      for (const f of fields) if (item[f]) {
        src = this._extractSrc(item[f]);
        if (src) break;
      }
      if (!src) {
        const numericKeys = Object.keys(item).filter((k) => String(Number(k)) === k).sort((a, b) => Number(a) - Number(b));
        for (const k of numericKeys) {
          const c = this._extractSrc(item[k]);
          if (c) {
            src = c;
            break;
          }
        }
      }
      let thumb = "";
      for (const f of thumbFields) if (item[f]) {
        thumb = this._extractSrc(item[f]);
        if (thumb) break;
      }
      if (!thumb) thumb = src || "";
      const alt = item.alt || item.title || item.name || "";
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
    if (val == null) return "";
    if (typeof val === "string") {
      const s = val.trim();
      if (!s) return "";
      if (s[0] === "[" || s[0] === "{") {
        try {
          return this._extractSrc(JSON.parse(s));
        } catch (e) {
          return s;
        }
      }
      return s;
    }
    if (Array.isArray(val)) {
      for (const v of val) {
        const c = this._extractSrc(v);
        if (c) return c;
      }
      return "";
    }
    if (typeof val === "object") {
      const fields = ["src", "url", "path", "file", "location", "thumb", "thumbnail"];
      for (const f of fields) if (val[f]) {
        const c = this._extractSrc(val[f]);
        if (c) return c;
      }
      const ks = Object.keys(val).sort((a, b) => Number(a) - Number(b));
      for (const k of ks) if (!isNaN(Number(k))) {
        const c = this._extractSrc(val[k]);
        if (c) return c;
      }
      return "";
    }
    return "";
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
    this._unbindThumbHandlers();
    this._thumbContainer.innerHTML = "";
    const frag = document.createDocumentFragment();
    this.images.forEach((it, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gallery-thumb";
      btn.setAttribute("aria-label", it.alt || `\u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 ${i + 1}`);
      btn.dataset.index = String(i);
      btn.setAttribute("role", "button");
      btn.tabIndex = 0;
      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.src = it.thumb || it.src || this.options.placeholder || "";
      img.alt = it.alt || "";
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
      this._thumbs = Array.from(this._thumbContainer.querySelectorAll(".gallery-thumb"));
      if (!this._thumbs.length) this._thumbs = Array.from(this.root.querySelectorAll(this.options.thumbSelector));
    } else {
      this._thumbs = Array.from(this.root.querySelectorAll(this.options.thumbSelector));
    }
  }
  /**
   * Ensure thumbnails have the correct source and attributes after a refresh.
   */
  _normalizeThumbSrcs() {
    const placeholder = this.options.placeholder || "";
    this._thumbs.forEach((t, i) => {
      try {
        let img = t.querySelector("img");
        const expected = this.images[i] && (this.images[i].thumb || this.images[i].src) || placeholder;
        t.dataset.index = String(i);
        if (img) {
          if (!img.src || img.src !== expected) img.src = expected;
          if (!img.alt) img.alt = this.images[i]?.alt || "";
        } else {
          img = document.createElement("img");
          img.loading = "lazy";
          img.decoding = "async";
          img.src = expected;
          img.alt = this.images[i]?.alt || "";
          t.appendChild(img);
        }
      } catch (e) {
      }
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
    else {
      this._collectThumbs();
      this._normalizeThumbSrcs();
      this._bindThumbHandlers();
    }
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
    if (!Number.isFinite(prev) || prev < 0 || prev === index || n <= 1) return "none";
    if (!this.options.circular) return index > prev ? "right" : "left";
    const forward = (index - prev + n) % n;
    const backward = (prev - index + n) % n;
    return forward <= backward ? "right" : "left";
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
    if (typeof indexOrThumb === "number") index = this._clampIndex(indexOrThumb);
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
    this._thumbs.forEach((t, i) => {
      const is = i === index;
      t.classList.toggle("active", is);
      if (is) t.setAttribute("aria-current", "true");
      else t.removeAttribute("aria-current");
      t.dataset.index = String(i);
    });
    if (this.modal && !this.modal.hidden && this.modalImg) this.modalImg.src = src;
    this._preload(index);
    if (options.emit !== false) this._emit("gallery:change", { index, src, item });
    this._markActive(index);
    this._ensureThumbVisible(index);
    if (!this.mainImg || !this.mainFrame || direction === "none" || this.options.animation !== "slide") {
      this._simpleSwap(src, index, item);
      return;
    }
    if (this._animating) {
      const prevTmp = this._tmpImage;
      if (prevTmp && prevTmp.parentNode) prevTmp.parentNode.removeChild(prevTmp);
      this._animating = false;
      this._tmpImage = null;
      try {
        this.mainImg.style.transform = "translateX(0)";
        this.mainImg.style.opacity = "1";
      } catch (e) {
      }
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
    this.mainImg.classList.add("is-loading");
    const onLoad = () => {
      this.mainImg.classList.remove("is-loading");
      this.mainImg.removeEventListener("load", onLoad);
      this._emit("gallery:loaded", { index, src });
    };
    const onError = () => {
      this.mainImg.classList.remove("is-loading");
      this.mainImg.removeEventListener("error", onError);
      if (this.options.placeholder) this.mainImg.src = this.options.placeholder;
      this._emit("gallery:error", { index, src });
    };
    this.mainImg.addEventListener("load", onLoad, { once: true });
    this.mainImg.addEventListener("error", onError, { once: true });
    setTimeout(() => {
      this.mainImg.src = src;
      this.mainImg.dataset.index = String(index);
      this.mainImg.alt = item.alt || "";
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
    this.mainImg.classList.add("is-loading");
    this._animating = true;
    const tmp = document.createElement("img");
    this._tmpImage = tmp;
    tmp.decoding = "async";
    tmp.loading = "eager";
    tmp.alt = item.alt || "";
    tmp.draggable = false;
    Object.assign(tmp.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      objectFit: this.mainImg.style.objectFit || "contain",
      transition: `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration / 2)}ms ease`,
      zIndex: "2",
      opacity: "1"
    });
    const fromPct = direction === "right" ? 100 : -100;
    tmp.style.transform = `translateX(${fromPct}%)`;
    this.mainImg.style.zIndex = "1";
    this.mainImg.style.transition = `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration / 2)}ms ease`;
    this.mainImg.style.transform = "translateX(0)";
    this.mainImg.style.opacity = "1";
    this.mainFrame.appendChild(tmp);
    const handleLoad = () => {
      tmp.removeEventListener("load", handleLoad);
      tmp.offsetHeight;
      requestAnimationFrame(() => {
        const mainTarget = direction === "right" ? -100 : 100;
        this.mainImg.style.transform = `translateX(${mainTarget}%)`;
        this.mainImg.style.opacity = "0";
        tmp.style.transform = "translateX(0%)";
      });
      const cleanup = () => {
        try {
          if (tmp.parentNode) tmp.parentNode.removeChild(tmp);
        } catch (e) {
        }
        this.mainImg.style.transition = "";
        this.mainImg.style.transform = "translateX(0)";
        this.mainImg.style.opacity = "1";
        this.mainImg.src = src;
        this.mainImg.dataset.index = String(index);
        this.mainImg.alt = item.alt || "";
        this.mainImg.classList.remove("is-loading");
        this._emit("gallery:loaded", { index, src });
        this._animating = false;
        this._tmpImage = null;
      };
      const onTransEnd = (e) => {
        if (e && e.target !== tmp) return;
        tmp.removeEventListener("transitionend", onTransEnd);
        cleanup();
      };
      tmp.addEventListener("transitionend", onTransEnd);
      setTimeout(() => {
        if (this._animating) {
          try {
            tmp.removeEventListener("transitionend", onTransEnd);
          } catch (e) {
          }
          cleanup();
        }
      }, this._animDuration + 70);
    };
    const handleError = () => {
      if (tmp.parentNode) tmp.parentNode.removeChild(tmp);
      this.mainImg.classList.remove("is-loading");
      if (this.options.placeholder) this.mainImg.src = this.options.placeholder;
      this._emit("gallery:error", { index, src });
      this._animating = false;
      this._tmpImage = null;
    };
    tmp.addEventListener("load", handleLoad, { once: true });
    tmp.addEventListener("error", handleError, { once: true });
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
    if (elTop < viewTop) container.scrollTo({ top: elTop - 8, behavior: "smooth" });
    else if (elBottom > viewBottom) container.scrollTo({ top: elBottom - container.clientHeight + 8, behavior: "smooth" });
  }
  /**
   * Navigate to the next image.
   */
  next() {
    this.show(this._clampIndex(this.current + 1));
  }
  /**
   * Navigate to the previous image.
   */
  prev() {
    this.show(this._clampIndex(this.current - 1));
  }
  /**
   * Open the modal view of the gallery.
   */
  openModal() {
    if (!this.modal || !this.modalImg) return;
    const src = this.images[this.current]?.src || this.mainImg?.src;
    if (src) this.modalImg.src = src;
    this._lastFocused = document.activeElement;
    this.modal.hidden = false;
    document.documentElement.style.overflow = "hidden";
    this._trapFocus();
    this.modal.setAttribute("aria-hidden", "false");
    this._emit("gallery:open", { index: this.current, src });
    if (this.options.nav) this._ensureNav();
  }
  /**
   * Close the modal view.
   */
  closeModal() {
    if (!this.modal) return;
    this.modal.hidden = true;
    if (this.modalImg) this.modalImg.src = "";
    document.documentElement.style.overflow = "";
    this._releaseFocusTrap();
    if (this._lastFocused && typeof this._lastFocused.focus === "function") this._lastFocused.focus();
    this.modal.setAttribute("aria-hidden", "true");
    this._emit("gallery:close", { index: this.current });
  }
  /**
   * Fully destroy the gallery instance, unbinding all listeners and
   * nullifying internal references.
   */
  destroy() {
    this._removeAllListeners();
    if (this._thumbScrollBtn) {
      try {
        this._thumbScrollBtn.remove();
      } catch (e) {
      }
      this._thumbScrollBtn = null;
    }
    if (this._thumbScrollObserver) {
      try {
        this._thumbScrollObserver.disconnect();
      } catch (e) {
      }
      this._thumbScrollObserver = null;
    }
    if (this._thumbScrollRAF) cancelAnimationFrame(this._thumbScrollRAF);
    if (this._dragRAF) cancelAnimationFrame(this._dragRAF);
    if (this._suppressClickTimer) {
      clearTimeout(this._suppressClickTimer);
      this._suppressClickTimer = null;
    }
    if (this._tmpImage && this._tmpImage.parentNode) try {
      this._tmpImage.parentNode.removeChild(this._tmpImage);
    } catch (e) {
    }
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
    if (e.target.closest && e.target.closest("button, a, input")) return;
    this.openModal();
  }
  /**
   * Root-level key handling for navigating images.
   *
   * @param {KeyboardEvent} e Key event.
   */
  _onRootKey(e) {
    if (this.modal && !this.modal.hidden) return;
    if (e.key === "ArrowRight") this.next();
    if (e.key === "ArrowLeft") this.prev();
  }
  /**
   * Attach core handlers to the main frame, root element, and modal. Also
   * initiates swipe handling on the main frame.
   */
  _bindHandlers() {
    if (this.mainFrame) this._addListener(this.mainFrame, "click", this._bound._onMainClick);
    if (this.modal) {
      const closeBtn = this.modal.querySelector(".gallery-close");
      const overlay = this.modal.querySelector(".gallery-modal-overlay");
      if (closeBtn) this._addListener(closeBtn, "click", () => this.closeModal());
      if (overlay) this._addListener(overlay, "click", () => this.closeModal());
      this._addListener(this.modal, "keydown", (e) => {
        if (this.modal.hidden) return;
        if (e.key === "Escape") this.closeModal();
        if (e.key === "ArrowRight") this.next();
        if (e.key === "ArrowLeft") this.prev();
      });
    }
    if (this.mainFrame) this._bindPointerSwipe();
    this._addListener(this.root, "keydown", (e) => this._onRootKey(e));
    if (!this.root.hasAttribute("tabindex")) this.root.setAttribute("tabindex", "0");
  }
  /**
   * Attach delegated handlers for thumbnails. Ensures that handlers are
   * bound only once per instance, even if called multiple times via
   * `renderThumbs()` or `refresh()`.
   */
  _bindThumbHandlers() {
    if (this._thumbHandlersBound) return;
    if (!this._thumbContainer) return;
    const clickHandler = (e) => {
      const btn = e.target.closest(".gallery-thumb");
      if (!btn) return;
      e.preventDefault();
      this.show(btn);
      btn.focus();
    };
    const keyHandler = (e) => {
      const btn = e.target.closest(".gallery-thumb");
      if (!btn) return;
      const i = Number(btn.dataset.index);
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.show(btn);
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = this._thumbs[(i + 1) % this._thumbs.length];
        next && next.focus();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = this._thumbs[(i - 1 + this._thumbs.length) % this._thumbs.length];
        prev && prev.focus();
      }
    };
    this._thumbClickListenerId = this._addListener(this._thumbContainer, "click", clickHandler);
    this._thumbKeyListenerId = this._addListener(this._thumbContainer, "keydown", keyHandler);
    this._thumbHandlersBound = true;
    this._thumbs.forEach((thumb) => {
      if (!thumb.hasAttribute("role")) thumb.setAttribute("role", "button");
      if (!thumb.hasAttribute("tabindex")) thumb.tabIndex = 0;
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
      if (e.target.closest && e.target.closest("button, a, input, textarea, select")) return;
      this._drag.active = true;
      this._drag.pointerId = e.pointerId ?? "touch";
      this._drag.startX = e.clientX;
      this._drag.startY = e.clientY;
      this._drag.lastDX = 0;
      this._drag.targetIndex = null;
      this._drag.direction = null;
      this._drag.moved = false;
      try {
        e.currentTarget && e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {
      }
      document.body.style.userSelect = "none";
    };
    const move = (e) => {
      if (!this._drag.active || e.pointerId !== void 0 && e.pointerId !== this._drag.pointerId) return;
      const dx = e.clientX - this._drag.startX;
      const dy = e.clientY - this._drag.startY;
      if (!this._drag.moved && Math.abs(dx) > 6) this._drag.moved = true;
      if (!this._drag.direction && Math.abs(dx) > 6) this._drag.direction = dx < 0 ? "left" : "right";
      this._drag.lastDX = dx;
      const width = this.mainFrame.clientWidth || this.mainImg.clientWidth || window.innerWidth / 2;
      const sign = dx < 0 ? -1 : 1;
      const targetIdx = this._clampIndex(this.current + (sign < 0 ? 1 : -1));
      if (this.images.length <= 1 || targetIdx === this.current) {
        const damp = dx * 0.35;
        this._applyDragTransforms(damp, null, width);
        return;
      }
      if (this._drag.targetIndex !== targetIdx || !this._tmpImage) {
        if (this._tmpImage && this._tmpImage.parentNode) try {
          this._tmpImage.parentNode.removeChild(this._tmpImage);
        } catch (_) {
        }
        const tmp = document.createElement("img");
        this._tmpImage = tmp;
        tmp.decoding = "async";
        tmp.loading = "eager";
        tmp.draggable = false;
        Object.assign(tmp.style, {
          position: "absolute",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
          objectFit: this.mainImg.style.objectFit || "contain",
          transition: "none",
          zIndex: "2",
          willChange: "transform, opacity"
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
      if (!this._drag.active || e && e.pointerId !== void 0 && e.pointerId !== this._drag.pointerId) return;
      const dx = this._drag.lastDX;
      const abs = Math.abs(dx);
      const width = this.mainFrame.clientWidth || this.mainImg.clientWidth || window.innerWidth / 2;
      try {
        e.currentTarget && e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {
      }
      document.body.style.userSelect = "";
      if (this._drag.moved) {
        this._suppressClick = true;
        clearTimeout(this._suppressClickTimer);
        this._suppressClickTimer = setTimeout(() => {
          this._suppressClick = false;
          this._suppressClickTimer = null;
        }, this._clickSuppressMs);
      }
      const sign = dx < 0 ? -1 : 1;
      const targetIdx = this._drag.targetIndex != null ? this._drag.targetIndex : this._clampIndex(this.current + (sign < 0 ? 1 : -1));
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
      try {
        e.currentTarget && e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {
      }
      document.body.style.userSelect = "";
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
    this._addListener(this.mainFrame, "pointerdown", down);
    this._addListener(this.mainFrame, "pointermove", move);
    this._addListener(this.mainFrame, "pointerup", up);
    this._addListener(this.mainFrame, "pointercancel", cancel);
    const touchStart = (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      down({ pointerId: "touch", clientX: t.clientX, clientY: t.clientY, currentTarget: this.mainFrame, target: e.target, button: 0 });
    };
    const touchMove = (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      move({ pointerId: "touch", clientX: t.clientX, clientY: t.clientY, currentTarget: this.mainFrame, target: e.target, preventDefault: () => e.preventDefault() });
    };
    const touchEnd = (e) => {
      const t = e.changedTouches && e.changedTouches[0] || null;
      up({ pointerId: "touch", clientX: t ? t.clientX : 0, clientY: t ? t.clientY : 0, currentTarget: this.mainFrame, target: e.target });
    };
    this._addListener(this.mainFrame, "touchstart", touchStart, { passive: true });
    this._addListener(this.mainFrame, "touchmove", touchMove, { passive: false });
    this._addListener(this.mainFrame, "touchend", touchEnd, { passive: true });
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
    const resistance = this._drag.active && Math.abs(dx) > width * 0.6 ? width * 0.6 * Math.sign(dx) : dx;
    this.mainImg.style.transition = "none";
    this.mainImg.style.transform = `translateX(${resistance}px)`;
    this.mainImg.style.opacity = String(Math.max(0.35, 1 - Math.abs(resistance) / (width * 1.2)));
    if (tmpEl) {
      tmpEl.style.transition = "none";
      const sign = resistance < 0 ? 1 : -1;
      const baseOffset = sign > 0 ? width : -width;
      tmpEl.style.transform = `translateX(${baseOffset + resistance}px)`;
      tmpEl.style.opacity = "1";
    }
  }
  /**
   * Roll back a drag gesture when it doesn't meet the threshold to change images.
   */
  _animateDragRollback() {
    if (!this.mainImg) return;
    this.mainImg.style.transition = `transform ${Math.round(this._animDuration / 1.5)}ms ease, opacity ${Math.round(this._animDuration / 2)}ms ease`;
    this.mainImg.style.transform = "translateX(0)";
    this.mainImg.style.opacity = "1";
    if (this._tmpImage) {
      const tmp = this._tmpImage;
      tmp.style.transition = `transform ${Math.round(this._animDuration / 1.5)}ms ease, opacity ${Math.round(this._animDuration / 2)}ms ease`;
      const width = this.mainFrame.clientWidth || this.mainImg.clientWidth || window.innerWidth / 2;
      const currentTransform = this._getTranslateXValue(tmp);
      const sign = currentTransform >= 0 ? 1 : -1;
      const final = sign > 0 ? width : -width;
      tmp.style.transform = `translateX(${final}px)`;
      tmp.style.opacity = "0";
      const cleanup = () => {
        if (tmp.parentNode) try {
          tmp.parentNode.removeChild(tmp);
        } catch (e) {
        }
        if (this._tmpImage === tmp) this._tmpImage = null;
      };
      tmp.addEventListener("transitionend", function once() {
        tmp.removeEventListener("transitionend", once);
        cleanup();
      });
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
    this.mainImg.style.transition = `transform ${dur}ms cubic-bezier(.2,.9,.2,1), opacity ${Math.round(dur / 2)}ms ease`;
    this.mainImg.style.transform = `translateX(${sign < 0 ? -width : width}px)`;
    this.mainImg.style.opacity = "0";
    if (tmp) {
      tmp.style.transition = `transform ${dur}ms cubic-bezier(.2,.9,.2,1), opacity ${Math.round(dur / 2)}ms ease`;
      tmp.style.transform = "translateX(0px)";
      tmp.style.opacity = "1";
    }
    const finish = () => {
      if (tmp && tmp.parentNode) try {
        tmp.parentNode.removeChild(tmp);
      } catch (e) {
      }
      this._tmpImage = null;
      const item = this.images[targetIdx];
      if (item && item.src) {
        this.mainImg.src = item.src;
        this.mainImg.dataset.index = String(targetIdx);
        this.mainImg.alt = item.alt || "";
      }
      this.mainImg.style.transition = "";
      this.mainImg.style.transform = "translateX(0)";
      this.mainImg.style.opacity = "1";
      this._prevIndex = this.current;
      this.current = targetIdx;
      this._animating = false;
      this._emit("gallery:change", { index: this.current, src: this.mainImg.src, item: this.images[this.current] });
      this._emit("gallery:loaded", { index: this.current, src: this.mainImg.src });
      this._markActive(this.current);
      this._ensureThumbVisible(this.current);
    };
    let handled = false;
    const onEnd = () => {
      if (handled) return;
      handled = true;
      this.mainImg.removeEventListener("transitionend", onEnd);
      finish();
    };
    this.mainImg.addEventListener("transitionend", onEnd);
    setTimeout(() => {
      if (!handled) {
        handled = true;
        try {
          this.mainImg.removeEventListener("transitionend", onEnd);
        } catch (e) {
        }
        finish();
      }
    }, dur + 150);
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
      if (!s || s === "none") return 0;
      const m = s.match(/matrix\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
        return parts[4] || 0;
      }
      const m3 = s.match(/matrix3d\(([^)]+)\)/);
      if (m3) {
        const parts = m3[1].split(",").map((p) => parseFloat(p.trim()));
        return parts[12] || 0;
      }
    } catch (e) {
    }
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
      if (e.key !== "Tab") return;
      const first = this._focusables[0];
      const last = this._focusables[this._focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    this.modal.addEventListener("keydown", this._modalKeyHandler);
    this._focusables[0].focus();
  }
  /**
   * Release focus trap when closing the modal.
   */
  _releaseFocusTrap() {
    if (!this.modal || !this._modalKeyHandler) return;
    this.modal.removeEventListener("keydown", this._modalKeyHandler);
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
    const modalContent = this.modal.querySelector(".gallery-modal-content") || this.modal;
    if (!modalContent) return;
    if (!this.modal.querySelector(`.${this.options.navWrapperClass}`)) {
      const wrap = document.createElement("div");
      wrap.className = this.options.navWrapperClass;
      const prev = document.createElement("button");
      prev.type = "button";
      prev.className = this.options.navPrevClass;
      prev.setAttribute("aria-label", "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435");
      prev.innerHTML = '<i class="fa fa-chevron-left" aria-hidden="true"></i>';
      const next = document.createElement("button");
      next.type = "button";
      next.className = this.options.navNextClass;
      next.setAttribute("aria-label", "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435");
      next.innerHTML = '<i class="fa fa-chevron-right" aria-hidden="true"></i>';
      wrap.appendChild(prev);
      wrap.appendChild(next);
      modalContent.appendChild(wrap);
      this._navWrap = wrap;
      this._navPrev = prev;
      this._navNext = next;
      this._addListener(prev, "click", (e) => {
        e.preventDefault();
        this.prev();
      });
      this._addListener(next, "click", (e) => {
        e.preventDefault();
        this.next();
      });
      this._addListener(prev, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.prev();
        }
      });
      this._addListener(next, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.next();
        }
      });
    } else {
      this._navWrap = this.modal.querySelector(`.${this.options.navWrapperClass}`);
      this._navPrev = this._navWrap.querySelector(`.${this.options.navPrevClass}`);
      this._navNext = this._navWrap.querySelector(`.${this.options.navNextClass}`);
      if (this._navPrev) this._addListener(this._navPrev, "click", (e) => {
        e.preventDefault();
        this.prev();
      });
      if (this._navNext) this._addListener(this._navNext, "click", (e) => {
        e.preventDefault();
        this.next();
      });
    }
    this._navInitialized = true;
  }
  /**
   * Manage the visibility of the thumbnail scroll button based on overflow.
   */
  _ensureThumbScroll() {
    if (!this._thumbContainer) return;
    if (!this._thumbScrollBtn) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = this.options.thumbScrollClass;
      btn.setAttribute("aria-label", "\u041F\u0440\u043E\u043A\u0440\u0443\u0442\u0438\u0442\u044C \u043C\u0438\u043D\u0438\u0430\u0442\u044E\u0440\u044B \u0432\u043D\u0438\u0437");
      btn.innerHTML = `<i class="${this.options.thumbScrollIconClass}" aria-hidden="true"></i>`;
      this._thumbContainer.appendChild(btn);
      this._thumbScrollBtn = btn;
      this._thumbScrollHandler = (e) => {
        e.preventDefault();
        const scrollAmount = Math.max(this._thumbContainer.clientHeight * 0.85, 120);
        this._thumbContainer.scrollBy({ top: scrollAmount, behavior: "smooth" });
      };
      this._addListener(btn, "click", this._thumbScrollHandler);
    }
    const update = () => {
      if (!this._thumbContainer) return;
      const needsScroll = this._thumbContainer.scrollHeight > this._thumbContainer.clientHeight + 1;
      if (!this._thumbScrollBtn) return;
      const atBottom = this._thumbContainer.scrollTop + this._thumbContainer.clientHeight >= this._thumbContainer.scrollHeight - 2;
      this._thumbScrollBtn.hidden = !needsScroll || atBottom;
    };
    if (!this._thumbScrollAttached) {
      this._addListener(this._thumbContainer, "scroll", () => {
        if (this._thumbScrollRAF) cancelAnimationFrame(this._thumbScrollRAF);
        this._thumbScrollRAF = requestAnimationFrame(update);
      });
      this._addListener(window, "resize", () => {
        if (this._thumbScrollRAF) cancelAnimationFrame(this._thumbScrollRAF);
        this._thumbScrollRAF = requestAnimationFrame(update);
      });
      this._thumbScrollAttached = true;
    }
    if (this._thumbScrollObserver) this._thumbScrollObserver.disconnect();
    this._thumbScrollObserver = new MutationObserver(() => {
      if (this._thumbScrollRAF) cancelAnimationFrame(this._thumbScrollRAF);
      this._thumbScrollRAF = requestAnimationFrame(update);
    });
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
      t.classList.toggle("active", is);
      if (is) t.setAttribute("aria-current", "true");
      else t.removeAttribute("aria-current");
    });
  }
  /**
   * Dispatch a custom event on the root element.
   *
   * @param {string} name Event name.
   * @param {Object} detail Event payload.
   */
  _emit(name, detail = {}) {
    try {
      this.root.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (e) {
    }
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
    if (this.options.circular) return (idx % n + n) % n;
    return Math.max(0, Math.min(idx, n - 1));
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
      [index + d, index - d].forEach((i) => {
        const j = this._clampIndex(i);
        const src = this.images[j]?.src;
        if (src) {
          const img = new Image();
          img.src = src;
        }
      });
    }
  }
};

// ShopMatic/js/modules/ProductPage.js
var DEFAULT_MESSAGES = {
  // Notification shown when attempting to add to cart but stock is zero
  addToCartDisabled: "\u041D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C: \u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430.",
  // Notification shown when an unexpected error occurs while adding to cart
  addToCartError: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0438 \u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0443",
  // Notification shown after toggling favourite state to "added"
  favoriteAdded: "\u0422\u043E\u0432\u0430\u0440 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u0432 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435",
  // Notification shown after toggling favourite state to "removed"
  favoriteRemoved: "\u0422\u043E\u0432\u0430\u0440 \u0443\u0434\u0430\u043B\u0451\u043D \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E",
  // Shown when wishlist module is missing
  wishlistNotConfigured: "\u0412\u0438\u0448\u043B\u0438\u0441\u0442 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D",
  // Notification shown after updating the wishlist
  wishlistUpdated: "\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E \u0432 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u0435",
  // Template for notifying maximum available quantity; {count} will be replaced with a number
  maxAvailableTemplate: "\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E: {count}",
  // Notification shown when an item is removed from the cart
  itemRemovedFromCart: "\u0422\u043E\u0432\u0430\u0440 \u0443\u0434\u0430\u043B\u0451\u043D \u0438\u0437 \u043A\u043E\u0440\u0437\u0438\u043D\u044B",
  // Favourite button label when item is not in favourites
  favLabelAdd: '<i class="fa-heart fa-solid"></i> \u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435',
  // Favourite button label when item is in favourites
  favLabelIn: '<i class="fa-heart fa-solid active"></i> \u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C',
  // Wishlist button label when item is not in wishlist
  wishlistLabelAdd: "\u0412 \u0432\u0438\u0448\u043B\u0438\u0441\u0442",
  // Wishlist button label when item is in wishlist
  wishlistLabelIn: "\u0412 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u0435",
  // Badge shown when product is in stock
  badgeInStock: "\u0412 \u043D\u0430\u043B\u0438\u0447\u0438\u0438",
  // Badge shown when product is on order/out of stock
  badgeOutOfStock: "\u041F\u043E\u0434 \u0437\u0430\u043A\u0430\u0437",
  // Label for the "Add to cart" button
  addToCartButton: "\u0412 \u041A\u043E\u0440\u0437\u0438\u043D\u0443",
  // Label for the button that navigates to the cart
  goToCartButton: "\u041A\u043E\u0440\u0437\u0438\u043D\u0430"
};
var ProductPage = class {
  constructor(shop, opts = {}) {
    if (!shop) throw new Error("ProductPage requires ShopMatic instance");
    const {
      productService,
      cart,
      favorites,
      renderer,
      notifications,
      wishlistModule: wishlist
    } = shop;
    this.shop = shop;
    this.productService = productService;
    this.cart = cart;
    this.favorites = favorites;
    this.renderer = renderer;
    this.notifications = notifications;
    this.wishlist = wishlist || null;
    const {
      messages = {},
      debug = false,
      ...rest
    } = opts;
    this.opts = {
      templateId: null,
      relatedLimit: 6,
      cardTemplateKey: "cardVertical",
      ...rest
    };
    this.messages = Object.assign({}, DEFAULT_MESSAGES, messages);
    this.debug = !!debug;
    this._stripeTimers = /* @__PURE__ */ new WeakMap();
    this.container = null;
    this.currentProductId = null;
    this._bound = {
      onAddClick: this._onAddClick.bind(this),
      onFavClick: this._onFavClick.bind(this),
      onQtyInput: this._onQtyInput.bind(this),
      onQtyIncr: this._onQtyIncr.bind(this),
      onQtyDecr: this._onQtyDecr.bind(this),
      onWishlistClick: this._onWishlistClick.bind(this),
      onBackClick: this._onBackClick.bind(this),
      onCartUpdated: this._onCartUpdated.bind(this)
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
      const msg = args.join(" ");
      this.shop?.foxEngine?.log?.(`ProductPage: ${msg}`, "DEBUG");
    } catch (_) {
      console.debug("ProductPage:", ...args);
    }
  }
  /**
   * Initialize the product image gallery. This should be called after the
   * DOM has rendered the gallery root element. It uses the Gallery class to
   * display a carousel of product images.
   */
  _initGallery() {
    if (!this.container) return;
    const galleryRoot = this.container.querySelector(".product-gallery");
    if (!galleryRoot) return;
    const product = this.productService.findById(this.currentProductId) ?? {};
    let photos = [];
    try {
      photos = Array.isArray(product.images) ? product.images.slice() : JSON.parse(product.picture || "[]");
    } catch (_) {
      photos = [];
    }
    try {
      this.gallery = new Gallery(galleryRoot, photos);
    } catch (err) {
      console.warn("Gallery initialization failed", err);
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
    if (!this.pageTemplate) {
      const tplPath = `/templates/${this.shop.foxEngine.replaceData.template}/foxEngine/product/productPage.tpl`;
      this.pageTemplate = await this.shop.foxEngine.loadTemplate(tplPath);
    }
    const el = typeof container === "string" ? document.querySelector(container) : container;
    if (!el) throw new Error("container element required");
    this.container = el;
    this.currentProductId = String(productId);
    this._log("render: fetching product", productId);
    let product = null;
    try {
      product = await this.productService.fetchById(productId);
    } catch {
      product = null;
    }
    if (!product) {
      this._log("render: product not found", productId);
      await this._renderNotFound();
      return;
    }
    try {
      this.cart?.loadFromStorage?.();
    } catch (_) {
    }
    let html;
    try {
      html = await this._buildHtml(product);
      this.container.innerHTML = html;
      this._log("render: HTML injected into container", productId);
    } catch (e) {
      console.error("_buildHtml error", e);
      await this._renderNotFound();
      return;
    }
    try {
      this._syncFavButton();
      this._syncQtyControls();
      this._syncWishlistButton();
      this._bindListeners();
    } catch (e) {
      console.error("UI sync/bind error", e);
    }
    try {
      await this._renderRelated(product);
    } catch (e) {
      console.error("_renderRelated error", e);
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
    back?.addEventListener("click", this._bound.onBackClick);
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
    try {
      this.shop.storage.addViewed?.(p);
    } catch (_) {
    }
    const cartItem = Array.isArray(this.cart?.cart) ? this.cart.cart.find((item) => String(item.name) === String(p.name)) : null;
    const qtyFromCart = cartItem ? Number(cartItem.qty || 0) : 0;
    const photos = Array.isArray(p.images) ? p.images.slice() : p.image ? [p.image] : p.picture ? [p.picture] : [];
    const mainImage = photos[0] ?? p.picture ?? p.image ?? "";
    const thumbsHtml = photos.length ? photos.map((src, i) => {
      const esc = this._escapeAttr(src);
      const active = i === 0 ? " active" : "";
      return `<button class="thumb-btn${active}" data-thumb-index="${i}" aria-label="thumb-${i}"><img src="${esc}" alt="" loading="lazy" /></button>`;
    }).join("") : "";
    try {
      await this.productService.fetchCategories?.();
    } catch (_) {
    }
    const tplData = {
      name: p.name ?? "",
      fullname: p.title ?? p.name ?? p.fullname ?? "",
      price: this._formatPrice(p.price),
      oldPrice: p.oldPrice ? this._formatPrice(p.oldPrice) : "",
      short: p.short ?? "",
      long: p.long ?? "",
      qty: qtyFromCart > 0 ? qtyFromCart : 1,
      mainImage,
      images: photos,
      picture: p.picture ?? mainImage,
      discountPercent: "",
      // reserved for future features
      thumbs: thumbsHtml,
      brandName: p.brandName ?? "",
      categoryName: p.categoryName ? `<small>${p.categoryName}</small>` : "",
      brand: p.brand ?? "",
      category: p.category ?? "",
      specs: typeof makeSpecHtmlPreview === "function" ? makeSpecHtmlPreview(p.specs || {}) : ""
    };
    const fox = this.shop.foxEngine;
    try {
      if (this.opts.templateId) {
        const t = document.getElementById(this.opts.templateId);
        if (t?.content) {
          const raw = t.innerHTML || "";
          return this._replaceTokens(raw, tplData);
        }
      }
      if (fox?.replaceTextInTemplate) {
        const replaced = await fox.replaceTextInTemplate(this.pageTemplate, tplData);
        if (typeof replaced === "string" && replaced.length) return replaced;
      }
    } catch (e) {
      console.warn("ProductPage: template replacement failed", e);
    }
    const pictureToken = this._escapeAttr(tplData.picture || tplData.mainImage);
    const nameToken = this._escapeAttr(tplData.name);
    const fullnameHtml = escapeHtml2(tplData.fullname);
    const priceToken = tplData.price || "";
    const oldPriceToken = tplData.oldPrice || "";
    const stockToken = String(p.stock ?? p.qty ?? 0);
    const qtyToken = String(tplData.qty);
    const specsHtml = tplData.specs || "";
    const thumbsToken = tplData.thumbs || "";
    const noticesToken = "";
    return this.pageTemplate.replace(/\{name\}/g, nameToken).replace(/\{fullname\}/g, fullnameHtml).replace(/\{picture\}/g, pictureToken).replace(/\{price\}/g, priceToken).replace(/\{oldPrice\}/g, oldPriceToken).replace(/\{stock\}/g, stockToken).replace(/\{qty\}/g, qtyToken).replace(/\{specs\}/g, specsHtml).replace(/\{thumbs\}/g, thumbsToken).replace(/\{notices\}/g, noticesToken);
  }
  /**
   * Bind DOM event listeners to UI controls on the product page. Listeners are
   * bound to specific selectors and use the pre-bound handler functions. The
   * gallery is initialized after thumbs are rendered.
   */
  _bindListeners() {
    if (!this.container) return;
    const addListener = (selector, event, handler) => {
      const el = this.container.querySelector(selector);
      if (el) el.addEventListener(event, handler);
    };
    addListener('[data-action="add-to-cart"], .add-to-cart, .btn-yellow', "click", this._bound.onAddClick);
    addListener(".fav-toggle", "click", this._bound.onFavClick);
    addListener(".wishlist-toggle", "click", this._bound.onWishlistClick);
    addListener(".qty-input", "input", this._bound.onQtyInput);
    this.container.querySelectorAll(".qty-incr").forEach((btn) => btn.addEventListener("click", this._bound.onQtyIncr));
    this.container.querySelectorAll(".qty-decr").forEach((btn) => btn.addEventListener("click", this._bound.onQtyDecr));
    addListener('[data-action="back"]', "click", this._bound.onBackClick);
    this.container.querySelectorAll(".thumb-btn").forEach(
      (btn) => btn.addEventListener("click", (ev) => {
        const idx = parseInt(ev.currentTarget.getAttribute("data-thumb-index"), 10) || 0;
        const product = this.productService.findById(this.currentProductId) || {};
        const photos = Array.isArray(product.images) ? product.images : [];
        const src = photos[idx];
        const main = this.container.querySelector(".product-main-img");
        if (main && src) main.src = src;
      })
    );
    this.container.querySelectorAll(".size-btn").forEach(
      (btn) => btn.addEventListener("click", (ev) => {
        this.container.querySelectorAll(".size-btn").forEach((b) => b.classList.remove("active"));
        ev.currentTarget.classList.add("active");
      })
    );
    window.addEventListener("cart:updated", this._bound.onCartUpdated);
    try {
      this._initGallery();
    } catch (e) {
      console.warn("gallery init failed", e);
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
    removeListener('[data-action="add-to-cart"], .add-to-cart, .btn-yellow', "click", this._bound.onAddClick);
    removeListener(".fav-toggle", "click", this._bound.onFavClick);
    removeListener(".wishlist-toggle", "click", this._bound.onWishlistClick);
    removeListener(".qty-input", "input", this._bound.onQtyInput);
    this.container.querySelectorAll(".qty-incr").forEach((btn) => btn.removeEventListener("click", this._bound.onQtyIncr));
    this.container.querySelectorAll(".qty-decr").forEach((btn) => btn.removeEventListener("click", this._bound.onQtyDecr));
    removeListener('[data-action="back"]', "click", this._bound.onBackClick);
    this.container.querySelectorAll(".thumb-btn").forEach((t) => t.replaceWith(t.cloneNode(true)));
    this.container.querySelectorAll(".size-btn").forEach((b) => b.replaceWith(b.cloneNode(true)));
    window.removeEventListener("cart:updated", this._bound.onCartUpdated);
  }
  // Event handlers
  _onAddClick() {
    const pid = this.currentProductId;
    if (!pid) return;
    try {
      const qtyEl = this.container.querySelector(".qty-input");
      const qty = Math.max(1, parseInt(qtyEl?.value || "1", 10));
      const available = this.cart && typeof this.cart._computeAvailableStock === "function" ? this.cart._computeAvailableStock(pid) : this.productService.findById(pid)?.stock || 0;
      if (available <= 0) {
        this.notifications.show("\u041D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C: \u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430.", { duration: 3e3 });
        return;
      }
      const toAdd = Math.min(qty, available);
      this.cart?.add?.(pid, toAdd);
      this._syncQtyControls();
    } catch (err) {
      console.error("_onAddClick error", err);
      this.notifications.show("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0438 \u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0443", { duration: 3e3 });
    }
  }
  _onFavClick() {
    try {
      const pid = this.currentProductId;
      if (!pid || !this.favorites?.toggle) return;
      this.favorites.toggle(pid);
      this._syncFavButton();
      const isFav = this.favorites.isFavorite?.(pid);
      this.notifications.show(isFav ? "\u0422\u043E\u0432\u0430\u0440 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u0432 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435" : "\u0422\u043E\u0432\u0430\u0440 \u0443\u0434\u0430\u043B\u0451\u043D \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E", { duration: 1500 });
    } catch (err) {
      console.warn(err);
    }
  }
  _onWishlistClick() {
    const pid = this.currentProductId;
    if (!pid) return;
    if (!this.wishlist) {
      this.notifications.show("\u0412\u0438\u0448\u043B\u0438\u0441\u0442 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D", { duration: 1400 });
      return;
    }
    try {
      if (this.wishlist.toggle) this.wishlist.toggle(pid);
      else if (this.wishlist.add) this.wishlist.add(pid);
      this._syncWishlistButton();
      this.notifications.show("\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E \u0432 \u0432\u0438\u0448\u043B\u0438\u0441\u0442\u0435", { duration: 1200 });
    } catch (err) {
      console.warn(err);
    }
  }
  _onQtyInput(e) {
    const qty = parseInt(e.target.value || "1", 10) || 1;
    const pid = this.currentProductId;
    const product = this.productService.findById(pid);
    const available = product ? product.stock ?? product.qty ?? 0 : 0;
    if (qty > available) {
      e.target.value = String(available || 1);
      this.notifications.show(`\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E: ${available}`, { duration: 1400 });
    }
    const cartItem = Array.isArray(this.cart?.cart) ? this.cart.cart.find((i) => String(i.name) === String(pid)) : null;
    if (cartItem && typeof this.cart?.changeQty === "function") {
      const newQty = Math.max(1, Math.min(available || 1, parseInt(e.target.value || "1", 10)));
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
      const ctrl = e.currentTarget?.closest?.(".qty-controls") || null;
      const qtyEl = ctrl?.querySelector(".qty-input") || this.container.querySelector(".qty-input");
      if (!qtyEl) return;
      const pid = this.currentProductId;
      const product = this.productService.findById(pid);
      const stock = product ? product.stock ?? product.qty ?? 0 : 0;
      let cur = parseInt(qtyEl.value || "1", 10) || 1;
      const target = Math.min(stock || cur + 1, cur + 1);
      if (target > cur) {
        qtyEl.value = String(target);
        this.cart?.changeQty?.(pid, target);
      }
      this._syncQtyControls();
      this._log("_onQtyIncr: increment qty", pid, "new qty", qtyEl?.value);
    } catch (err) {
      console.error("_onQtyIncr", err);
    }
  }
  _onQtyDecr(e) {
    try {
      const ctrl = e.currentTarget?.closest?.(".qty-controls") || null;
      const qtyEl = ctrl?.querySelector(".qty-input") || this.container.querySelector(".qty-input");
      if (!qtyEl) return;
      const pid = this.currentProductId;
      let cur = parseInt(qtyEl.value || "1", 10) || 1;
      const target = Math.max(0, cur - 1);
      qtyEl.value = String(target);
      if (target === 0) {
        try {
          if (this.cart?.remove) {
            this.cart.remove(String(pid));
          } else if (Array.isArray(this.cart?.cart)) {
            const idx = this.cart.cart.findIndex((i) => String(i.name) === String(pid));
            if (idx >= 0) {
              this.cart.cart.splice(idx, 1);
              this.cart.save?.();
            }
          }
          this.notifications.show(this.messages.itemRemovedFromCart, { duration: 1500 });
          this._log("_onQtyDecr: item removed from cart", pid);
        } catch (err) {
          console.warn("cart.remove threw", err);
        }
        window.dispatchEvent(new CustomEvent("cart:updated", { detail: { changedIds: [pid] } }));
      } else {
        try {
          this.cart?.changeQty?.(String(pid), Number(target));
        } catch (err) {
          console.warn("cart.changeQty threw", err);
        }
        if (Array.isArray(this.cart?.cart)) {
          const idx = this.cart.cart.findIndex((i) => String(i.name) === String(pid));
          if (idx >= 0) {
            this.cart.cart[idx].qty = Number(target);
            this.cart.save?.();
            window.dispatchEvent(new CustomEvent("cart:updated", { detail: { changedIds: [pid] } }));
          }
        }
      }
      this._syncQtyControls();
    } catch (err) {
      console.error("_onQtyDecr", err);
    }
  }
  _onBackClick() {
    if (window.history && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (this.container) this.container.innerHTML = "";
  }
  _onCartUpdated() {
    this._syncQtyControls();
  }
  // Sync UI state methods
  _syncFavButton() {
    if (!this.container || !this.favorites) return;
    const btn = this.container.querySelector(".fav-toggle");
    if (!btn) return;
    const isFav = this.favorites.isFavorite?.(String(this.currentProductId)) ?? false;
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
    btn.classList.add("with-stripes", "active");
    btn.classList.remove("hidden");
    const t = setTimeout(() => {
      btn.classList.add("hidden");
      const cleanup = setTimeout(() => {
        btn.classList.remove("with-stripes", "hidden");
        timers.delete(btn);
        clearTimeout(cleanup);
      }, 300);
      timers.delete(btn);
    }, duration);
    timers.set(btn, t);
  }
  _syncWishlistButton() {
    if (!this.container || !this.wishlist) return;
    const btn = this.container.querySelector(".wishlist-toggle");
    if (!btn) return;
    let isIn = false;
    try {
      isIn = this.wishlist.isIn?.(this.currentProductId) || this.wishlist.has?.(this.currentProductId) || false;
    } catch (_) {
    }
    btn.textContent = isIn ? this.messages.wishlistLabelIn : this.messages.wishlistLabelAdd;
  }
  _syncQtyControls() {
    if (!this.container) return;
    const pid = this.currentProductId;
    const product = this.productService.findById(pid);
    const stock = product ? Number(product.stock ?? product.qty ?? 0) : 0;
    const stockEl = this.container.querySelector(".stock-count");
    if (stockEl) stockEl.textContent = String(stock);
    const controlBar = this.container.querySelector(".qty-controls");
    const qtyEl = this.container.querySelector(".qty-input");
    const btnPlus = this.container.querySelector(".qty-incr");
    const btnMinus = this.container.querySelector(".qty-decr");
    const addBtn = this.container.querySelector('[data-action="add-to-cart"], .add-to-cart, .btn-yellow');
    const buyNowBtn = this.container.querySelector('[data-action="buy-now"]');
    const cartItem = Array.isArray(this.cart?.cart) ? this.cart.cart.find((i) => String(i.name) === String(pid)) : null;
    const cartQty = cartItem ? Number(cartItem.qty || 0) : 0;
    if (qtyEl) {
      qtyEl.setAttribute("min", "1");
      qtyEl.setAttribute("max", String(Math.max(1, stock)));
      let cur = parseInt(qtyEl.value || (cartQty > 0 ? String(cartQty) : "1"), 10) || 1;
      if (cartQty > 0) {
        cur = cartQty;
        buyNowBtn && (buyNowBtn.style.display = "none");
        controlBar && (controlBar.style.display = "flex");
        if (addBtn) {
          try {
            addBtn.removeEventListener("click", this._bound.onAddClick);
          } catch (_) {
          }
          addBtn.onclick = () => {
            try {
              this.shop.foxEngine?.page?.loadPage("cart");
            } catch (_) {
            }
          };
          addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" class="_1w4N_" width="16" height="16"><path fill="#21201F" fill-rule="evenodd" d="M0 5.752a.5.5 0 0 1 .5-.5h8.65L5.304 1.406a.5.5 0 0 1 0-.707l.342-.343a.5.5 0 0 1 .708 0L12 6.002 6.354 11.65a.5.5 0 0 1-.708 0l-.342-.343a.5.5 0 0 1 0-.707L9.15 6.752H.5a.5.5 0 0 1-.5-.5v-.5Z" clip-rule="evenodd"></path></svg> ${this.messages.goToCartButton}`;
        }
      } else {
        buyNowBtn && (buyNowBtn.style.display = "flex");
        controlBar && (controlBar.style.display = "none");
        if (addBtn) {
          addBtn.onclick = null;
          addBtn.addEventListener("click", this._bound.onAddClick);
          addBtn.innerHTML = this.messages.addToCartButton;
        }
      }
      if (stock <= 0) {
        qtyEl.value = "0";
        qtyEl.disabled = true;
        if (addBtn) {
          addBtn.disabled = true;
          addBtn.classList.add("disabled");
        }
      } else {
        if (cur > stock) cur = stock;
        qtyEl.value = String(cur);
        qtyEl.disabled = false;
        if (addBtn) {
          addBtn.disabled = false;
          addBtn.classList.remove("disabled");
        }
      }
    }
    try {
      const current = qtyEl ? parseInt(qtyEl.value || "1", 10) || 1 : 1;
      if (btnPlus) {
        const disablePlus = stock <= 0 || current >= stock;
        btnPlus.disabled = disablePlus;
        disablePlus ? btnPlus.setAttribute("aria-disabled", "true") : btnPlus.removeAttribute("aria-disabled");
      }
      if (btnMinus) {
        const disableMinus = current <= 0;
        btnMinus.disabled = disableMinus;
        disableMinus ? btnMinus.setAttribute("aria-disabled", "true") : btnMinus.removeAttribute("aria-disabled");
      }
    } catch (e) {
    }
  }
  async createCard(product = {}) {
    const p = product || {};
    const id = String(p.name ?? p.id ?? p.productId ?? "");
    const priceText = this._formatPrice(p.price ?? 0);
    const hasOldPrice = p.oldPrice && Number(p.oldPrice) > 0;
    const badgeText = Number(p.stock) > 0 ? this.messages.badgeInStock : this.messages.badgeOutOfStock;
    const specsHtml = makeSpecHtmlPreview ? makeSpecHtmlPreview(p.specs || p.attributes || {}) : "";
    const data = {
      id,
      fullname: p.fullname ?? p.title ?? p.name ?? "",
      img: p.picture ?? p.image ?? "/assets/no-image.png",
      short: p.short ?? "",
      price: priceText,
      oldPrice: hasOldPrice ? this._formatPrice(p.oldPrice) : "",
      badgeText,
      stock: Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0,
      specsHtml
    };
    let html = "";
    const fox = this.shop.foxEngine;
    try {
      if (fox?.templateCache?.[this.opts.cardTemplateKey]) {
        html = await fox.replaceTextInTemplate(fox.templateCache[this.opts.cardTemplateKey], data);
      }
    } catch (e) {
      fox?.log?.("ProductPage.createCard template error: " + e, "ERROR");
      html = "";
    }
    if (!html) {
      const escTitle = escapeHtml2(data.fullname);
      const escImg = escapeHtml2(data.img);
      const escPrice = escapeHtml2(data.price);
      const escOld = escapeHtml2(data.oldPrice);
      const escShort = escapeHtml2(data.short);
      const escSpecs = data.specsHtml || "";
      html = `
        <article class="card product-card" data-product-id="${escapeHtml2(id)}">
          <div class="card__media"><img src="${escImg}" alt="${escTitle}" loading="lazy"></div>
          <div class="card__body p-2">
            <h3 class="card__title small">${escTitle}</h3>
            <div class="card__price">${escPrice}${hasOldPrice ? ' <small class="old">' + escOld + "</small>" : ""}</div>
            <div class="card__short small text-muted">${escShort}</div>
            <div class="card__specs small">${escSpecs}</div>
            <div class="card__controls mt-2"><button data-role="buy" class="btn btn-sm btn-outline-primary">${this.messages.addToCartButton}</button></div>
          </div>
        </article>`;
    }
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
    const node = wrapper.firstElementChild || wrapper;
    try {
      node?.setAttribute("data-product-id", String(id));
    } catch (_) {
    }
    return node;
  }
  async _renderCartVertical(list = [], rootEl) {
    if (!rootEl) return;
    rootEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    const cards = await Promise.all((Array.isArray(list) ? list : []).map((p) => this.createCard(p)));
    for (const card of cards) {
      if (!card) continue;
      card.style.opacity = "0";
      card.style.transition = "opacity .22s ease";
      frag.append(card);
      requestAnimationFrame(() => {
        card.style.opacity = "1";
      });
    }
    rootEl.append(frag);
  }
  updateProductCardFavState(rootEl, id, isFav) {
    if (!rootEl || !id) return;
    const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/"/g, '\\"');
    const selector = `[data-product-id="${esc}"]`;
    const card = rootEl.querySelector(selector);
    if (!card) return;
    const favBtn = card.querySelector('.fav-btn, .fav-toggle, [data-role="fav"]');
    if (!favBtn) return;
    favBtn.setAttribute("aria-pressed", isFav ? "true" : "false");
    favBtn.title = isFav ? "\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C" : "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435";
    favBtn.classList.toggle("is-fav", Boolean(isFav));
    const icon = favBtn.querySelector("i");
    if (icon) {
      icon.classList.remove("fa-regular", "fa-solid");
      icon.classList.add(isFav ? "fa-solid" : "fa-regular");
      if (!icon.classList.contains("fa-heart")) icon.classList.add("fa-heart");
    }
  }
  async _renderRelated(product) {
    if (!this.container) return;
    const relatedRoot = this.container.querySelector("[data-related]");
    if (!relatedRoot) return;
    try {
      const all = Array.isArray(this.productService.getProducts()) ? this.productService.getProducts() : [];
      let related = all.filter((p) => p && p.id != product.id && p.category === product.category);
      if (!related.length) related = all.filter((p) => p && p.id != product.id);
      related = related.slice(0, this.opts.relatedLimit);
      await this._renderCartVertical(related, relatedRoot);
      related.forEach((p) => {
        const isFav = this.favorites?.isFavorite?.(String(p.id)) ?? false;
        this.updateProductCardFavState(relatedRoot, p.id, isFav);
      });
    } catch (err) {
      console.warn("renderRelated failed", err);
    }
  }
  _replaceTokens(template, data = {}) {
    return String(template).replace(/\{\{\s*([^}]+)\s*\}\}/g, (m, key) => {
      const v = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : "";
      return v == null ? "" : String(v);
    });
  }
  _formatPrice(v) {
    if (v == null) return "";
    if (typeof v === "number") {
      try {
        return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(v);
      } catch (e) {
        return String(v);
      }
    }
    return String(v);
  }
  _escape(str) {
    if (str == null) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  _escapeAttr(str) {
    if (str == null) return "";
    return String(str).replace(/"/g, "&quot;");
  }
};
function escapeHtml2(str) {
  if (str == null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ShopMatic/js/modules/ViewedItemsModule.js
var ViewedItemsModule = class {
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
    if (!storageService) throw new Error("ViewedItemsModule requires a storageService.");
    this._storage = storageService;
    this._renderer = renderer;
    this._container = typeof container === "string" ? document.querySelector(container) : container;
    if (!this._container) {
      throw new Error("ViewedItemsModule: container element not found.");
    }
    const defaults = {
      maxItems: Number.isFinite(Number(storageService?.maxViewedItems)) ? Number(storageService.maxViewedItems) : 20,
      concurrency: Number.isFinite(Number(storageService?.defaultConcurrency)) ? Number(storageService.defaultConcurrency) : 6,
      noItemsMessage: "\u041D\u0435\u0442 \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0445 \u0442\u043E\u0432\u0430\u0440\u043E\u0432."
    };
    this._opts = Object.assign({}, defaults, opts);
  }
  /**
   * Load the viewed items from storage, enrich them with availability info,
   * and render them into the container.
   * This method is idempotent and can be called multiple times to refresh the UI.
   */
  async load() {
    this._container.innerHTML = "";
    let raw = [];
    try {
      raw = this._storage.loadViewed?.() || [];
    } catch (e) {
      console.warn("ViewedItemsModule: failed to load viewed items", e);
      raw = [];
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      this._renderEmpty();
      return;
    }
    const itemsToLoad = raw.slice().sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0)).slice(0, this._opts.maxItems);
    let enriched = itemsToLoad;
    try {
      if (typeof this._storage._loadWithAvailability === "function") {
        enriched = await this._storage._loadWithAvailability(itemsToLoad, { concurrency: this._opts.concurrency });
      }
    } catch (e) {
      console.warn("ViewedItemsModule: _loadWithAvailability failed", e);
      enriched = itemsToLoad;
    }
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
      if (this._renderer && typeof this._renderer.renderCards === "function") {
        const tmp = document.createElement("div");
        const renderResult = this._renderer.renderCards(tmp, items, this._renderer.foxEngine);
        if (renderResult && typeof renderResult.then === "function") {
          await renderResult;
        }
        this._container.innerHTML = "";
        this._container.appendChild(tmp);
        return;
      }
    } catch (e) {
      console.warn("ViewedItemsModule: renderer.renderCards failed", e);
    }
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
    const ul = document.createElement("ul");
    ul.className = "viewed-items-list";
    for (const it of items) {
      const li = document.createElement("li");
      li.className = "viewed-item";
      const itemContent = document.createElement("div");
      itemContent.className = "viewed-item__content";
      if (it.picture) {
        const img = document.createElement("img");
        img.src = String(JSON.parse(it.picture).at(0));
        img.loading = "lazy";
        img.width = 80;
        img.height = 80;
        img.className = "viewed-item__image";
        itemContent.appendChild(img);
      }
      const link = document.createElement("a");
      link.href = `#product/${encodeURIComponent(it.name || "")}`;
      link.textContent = String(it.fullname || it.name || "");
      link.className = "viewed-item__link";
      itemContent.appendChild(link);
      const available = this._storage.shopMatic.cart.isAvailable(it);
      const status = document.createElement("span");
      status.className = "viewed-item__status";
      status.textContent = available ? "\u0412 \u043D\u0430\u043B\u0438\u0447\u0438\u0438" : "\u041D\u0435\u0442 \u0432 \u043D\u0430\u043B\u0438\u0447\u0438\u0438";
      status.style.marginLeft = "8px";
      itemContent.appendChild(status);
      li.appendChild(itemContent);
      const viewButton = document.createElement("button");
      viewButton.className = "viewed-item__button";
      viewButton.textContent = "\u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C";
      viewButton.onclick = () => window.location.href = link.href;
      li.appendChild(viewButton);
      ul.appendChild(li);
    }
    this._container.innerHTML = "";
    this._container.appendChild(ul);
    this._addClearHistoryButton();
  }
  /**
   * Add "Clear History" button at the bottom of the list.
   */
  _addClearHistoryButton() {
    const clearButtonHtml = `
      <div class="clearViewed">
        <a href="javascript:void(0)" onclick="foxEngine.shopMatic.storage.clearViewed()">\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E</a>
      </div>
    `;
    this._container.insertAdjacentHTML("beforeend", clearButtonHtml);
  }
  /**
   * Render an empty state when there are no viewed items.
   */
  _renderEmpty() {
    const p = document.createElement("p");
    p.className = "viewed-items-empty";
    p.textContent = String(this._opts.noItemsMessage);
    this._container.appendChild(p);
  }
  /**
   * Synchronize viewed items with the latest storage data and re-render.
   */
  async sync() {
    await this.load();
  }
};

// ShopMatic/js/modules/Catalog.js
var Catalog = class _Catalog {
  static UI_MESSAGES = Object.freeze({
    PRODUCT_LIMIT_DEFAULT: "\u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0432 \u043A\u043E\u0440\u0437\u0438\u043D\u0435",
    PRODUCT_LIMIT_REACHED: "\u0412\u044B \u0434\u043E\u0441\u0442\u0438\u0433\u043B\u0438 \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0430 \u044D\u0442\u043E\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0430",
    NO_STOCK_TEXT: "\u0422\u043E\u0432\u0430\u0440\u0430 \u043D\u0435\u0442 \u0432 \u043D\u0430\u043B\u0438\u0447\u0438\u0438",
    CANNOT_ADD_NO_STOCK: "\u041D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C: \u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430.",
    ADDED_PARTIAL: "\u0412 \u043A\u043E\u0440\u0437\u0438\u043D\u0443 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E {added} \u0448\u0442. (\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E {available}).",
    FAVORITES_UNAVAILABLE: "\u041C\u043E\u0434\u0443\u043B\u044C \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D.",
    PRODUCT_LEFT: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A: {left}",
    CATALOG_LOAD_ERROR: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440\u044B",
    CATALOG_ALL_OPTION: "\u0412\u0441\u0435",
    CATALOG_NO_RESULTS: "\u041F\u043E \u0442\u0435\u043A\u0443\u0449\u0438\u043C \u043E\u043F\u0446\u0438\u044F\u043C \u043D\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u043E\u0432",
    CATALOG_NO_RESULTS_HINT: "\u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440\u044B, \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u0443 \u0438\u043B\u0438 \u0441\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A."
  });
  constructor({
    shop,
    rootId,
    catFilterId,
    brandFilterId,
    searchId,
    sortId,
    searchBtnId,
    productsCountId
  }) {
    if (!shop) throw new Error("Catalog requires a shop instance");
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
    this.resetBtn = null;
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
  _msg(key, fallback = "") {
    if (this.shop && typeof this.shop._msg === "function") {
      const val = this.shop._msg(key);
      if (val != null && val !== key) return val;
    }
    const i18n = this.shop?.i18n;
    if (i18n && typeof i18n.t === "function") {
      const val = i18n.t(key);
      if (val != null && val !== key) return val;
    }
    return _Catalog.UI_MESSAGES[key] || fallback;
  }
  async init(_request = {}) {
    this._cacheDomElements();
    const ps = this.shop.productService;
    if (!ps) return;
    try {
      await ps.loadProductsSimple();
    } catch (err) {
      console.error("Catalog.init: loadProductsSimple failed", err);
      this._showNotification(this._msg("CATALOG_LOAD_ERROR", "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440\u044B"));
    }
    this._bindEvents();
  }
  async loadCatalog({ request = null } = {}) {
    const ps = this.shop.productService;
    if (!ps) return [];
    const selectedCategory = request?.category ?? "";
    const selectedBrand = request?.brand ?? "";
    this._setLocationHash("#page/catalog");
    await Promise.all([
      this.catFilter ? this._populateFilter(
        this.catFilter,
        ps,
        "fillCategories",
        "fetchCategories",
        selectedCategory
      ) : Promise.resolve(),
      this.brandFilter ? this._populateFilter(
        this.brandFilter,
        ps,
        "fillBrands",
        "fetchBrands",
        selectedBrand
      ) : Promise.resolve()
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
    this.resetBtn = document.getElementById("resetFilters") || null;
  }
  _bindEvents() {
    if (this.search) this.search.addEventListener("input", this._bound.onSearchInput);
    if (this.catFilter) this.catFilter.addEventListener("change", this._bound.onCatChange);
    if (this.brandFilter) this.brandFilter.addEventListener("change", this._bound.onBrandChange);
    if (this.sort) this.sort.addEventListener("change", this._bound.onSortChange);
    if (this.searchBtn) this.searchBtn.addEventListener("click", this._bound.onSearchBtn);
    if (this.resetBtn) this.resetBtn.addEventListener("click", this._bound.onResetFilters);
  }
  _removeEventListeners() {
    if (this.search) this.search.removeEventListener("input", this._bound.onSearchInput);
    if (this.catFilter) this.catFilter.removeEventListener("change", this._bound.onCatChange);
    if (this.brandFilter) this.brandFilter.removeEventListener("change", this._bound.onBrandChange);
    if (this.sort) this.sort.removeEventListener("change", this._bound.onSortChange);
    if (this.searchBtn) this.searchBtn.removeEventListener("click", this._bound.onSearchBtn);
    if (this.resetBtn) this.resetBtn.removeEventListener("click", this._bound.onResetFilters);
  }
  _setLocationHash(hash) {
    if (typeof window !== "undefined" && window.location) {
      window.location.hash = hash;
    }
  }
  _showNotification(message) {
    try {
      this.shop.notifications.show(message, {
        duration: this.shop.opts?.notificationDuration ?? 3e3
      });
    } catch (_) {
    }
  }
  // --- filters / data ------------------------------------------------------
  async _populateFilter(filterElement, ps, fillMethod, fetchMethod, selectedValue = "") {
    if (!filterElement || !ps) return;
    try {
      if (typeof ps[fillMethod] === "function") {
        await ps[fillMethod](filterElement, { selected: selectedValue });
        if (selectedValue && filterElement.value !== selectedValue) {
          filterElement.value = selectedValue;
        }
        return;
      }
      if (typeof ps[fetchMethod] === "function") {
        await ps[fetchMethod]();
      }
      const getterName = `get${fillMethod.replace("fill", "")}`;
      const items = typeof ps[getterName] === "function" ? ps[getterName]() || [] : [];
      const allLabel = this._msg("CATALOG_ALL_OPTION", "\u0412\u0441\u0435");
      filterElement.innerHTML = `<option value="">${allLabel}</option>`;
      for (const item of items) {
        if (!item) continue;
        const option = document.createElement("option");
        option.value = item.id ?? item.name ?? "";
        option.textContent = item.fullname ?? item.name ?? item.id ?? "";
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
    const list = ps && typeof ps.getProducts === "function" ? ps.getProducts() : [];
    return Array.isArray(list) ? [...list] : [];
  }
  _filterAndSort(list) {
    const searchTerm = (this.search?.value || "").trim().toLowerCase();
    const category = this.catFilter?.value || "";
    const brand = this.brandFilter?.value || "";
    const sortOrder = this.sort?.value || "";
    if (searchTerm) {
      list = list.filter(
        (p) => (p.fullname || p.title || p.name || "").toLowerCase().includes(searchTerm)
      );
    }
    if (category) {
      list = list.filter((p) => p.category === category);
    }
    if (brand) {
      const normalized = brand.toLowerCase();
      list = list.filter(
        (p) => (p.brand ?? p.brandName ?? "").toLowerCase() === normalized
      );
    }
    if (!sortOrder) return list;
    const arr = [...list];
    switch (sortOrder) {
      case "price_asc":
        return arr.sort((a, b) => (a.price || 0) - (b.price || 0));
      case "price_desc":
        return arr.sort((a, b) => (b.price || 0) - (a.price || 0));
      case "brand_asc":
        return arr.sort(
          (a, b) => (a.brandName || "").localeCompare(b.brandName || "")
        );
      case "brand_desc":
        return arr.sort(
          (a, b) => (b.brandName || "").localeCompare(a.brandName || "")
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
    if (this.productsCount) this.productsCount.textContent = "0";
    const text = message ?? this._msg("CATALOG_NO_RESULTS", "\u041F\u043E \u0442\u0435\u043A\u0443\u0449\u0438\u043C \u043E\u043F\u0446\u0438\u044F\u043C \u043D\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u043E\u0432");
    const hintText = this._msg(
      "CATALOG_NO_RESULTS_HINT",
      "\u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440\u044B, \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u0443 \u0438\u043B\u0438 \u0441\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A."
    );
    const wrapper = document.createElement("div");
    wrapper.className = "catalog-empty";
    const icon = document.createElement("div");
    icon.className = "catalog-empty__icon";
    icon.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 6h18v2H3zm0 5h12v2H3zm0 5h6v2H3z"></path></svg>';
    icon.style.opacity = "0.6";
    const p = document.createElement("p");
    p.className = "catalog-empty__text";
    p.textContent = text;
    const hint = document.createElement("div");
    hint.className = "catalog-empty__hint";
    hint.textContent = hintText;
    wrapper.appendChild(icon);
    wrapper.appendChild(p);
    wrapper.appendChild(hint);
    this.root.innerHTML = "";
    this.root.appendChild(wrapper);
    this.shop._syncAllCardsControls();
  }
  _clearNoResults() {
    const found = this.root?.querySelector(".catalog-empty");
    if (found) found.remove();
  }
  _updateFavorites(list) {
    if (!this.shop.favorites || !this.root) return;
    list.forEach((product) => {
      const card = this.root.querySelector(`[data-product-id="${product.id}"]`);
      if (!card) return;
      const isFav = this.shop.favorites.isFavorite(product.id);
      this.shop.renderer.updateProductCardFavState(this.root, product.id, isFav);
    });
  }
  // --- event handlers ------------------------------------------------------
  onSearchInput() {
    this.applyFilters();
  }
  onCatChange() {
    this.applyFilters();
  }
  onBrandChange() {
    this.applyFilters();
  }
  onSortChange() {
    this.applyFilters();
  }
  onSearchBtn() {
    this.applyFilters();
  }
  onResetFilters() {
    if (this.search) this.search.value = "";
    if (this.catFilter) this.catFilter.value = "";
    if (this.brandFilter) this.brandFilter.value = "";
    if (this.sort) this.sort.value = this.sort.querySelector("option")?.value || "";
    this.applyFilters();
  }
};

// ShopMatic/js/modules/CheckoutPage.js
var CheckoutPage = class {
  constructor(cartService) {
    this.cartService = cartService;
    this.foxEngine = this.cartService.storage.shopMatic.foxEngine;
    this.cartItems = [];
    this.totalPrice = 0;
    this.totalQty = 0;
    this.promoCode = "";
    this.goodsWordsArr = ["\u0442\u043E\u0432\u0430\u0440", "\u0442\u043E\u0432\u0430\u0440\u0430", "\u0442\u043E\u0432\u0430\u0440\u043E\u0432"];
    this.deliveryOptions = [
      {
        label: "\u041F\u043E \u043A\u043B\u0438\u043A\u0443",
        deliveryType: "ON_DEMAND",
        description: "\u041F\u043E \u043A\u043B\u0438\u043A\u0443 \u0437\u0430 15-30 \u043C\u0438\u043D\u0443\u0442",
        time: "\u0417\u0430\u0432\u0442\u0440\u0430 \u0438\u043B\u0438 \u043F\u043E\u0437\u0436\u0435",
        price: "\u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E",
        checked: false,
        disabled: true
      },
      {
        label: "\u041F\u0443\u043D\u043A\u0442 \u0432\u044B\u0434\u0430\u0447\u0438",
        deliveryType: "PICKUP",
        description: "\u0420\u044F\u0434\u043E\u043C, 7 \u043C\u0438\u043D\u0443\u0442",
        time: "\u0417\u0430\u0432\u0442\u0440\u0430 \u0438\u043B\u0438 \u043F\u043E\u0437\u0436\u0435",
        price: "\u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E",
        checked: true,
        disabled: false
      },
      {
        label: "\u041A\u0443\u0440\u044C\u0435\u0440",
        deliveryType: "COURIER",
        description: "\u0414\u043E\u0441\u0442\u0430\u0432\u043A\u0430 \u043D\u0430 \u0434\u043E\u043C",
        time: "\u0417\u0430\u0432\u0442\u0440\u0430 \u0438\u043B\u0438 \u043F\u043E\u0437\u0436\u0435",
        price: "\u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E",
        checked: false,
        disabled: true
      }
    ];
    this._bound = {
      onApplyPromo: this._onApplyPromo.bind(this),
      onCheckout: this._onCheckout.bind(this),
      onContainerClick: this._onContainerClick.bind(this),
      onContainerChange: this._onContainerChange.bind(this)
    };
  }
  async init(id) {
    this.container = document.querySelector(id);
    this.cartItems = await this.cartService.getCartItems();
    await this._renderCartItems();
    this._buildDeliveryOptions();
    this._bindEvents();
    this._updateTotalsUI();
  }
  _bindEvents() {
    this.container.querySelector(".promo-code-apply")?.addEventListener("click", this._bound.onApplyPromo);
    this.container.querySelector(".btn-checkout")?.addEventListener("click", this._bound.onCheckout);
    this.container.addEventListener("click", this._bound.onContainerClick);
    this.container.addEventListener("change", this._bound.onContainerChange);
  }
  _onApplyPromo() {
    const promoInput = this.container.querySelector("#promo-input");
    if (!promoInput) return;
    this.promoCode = promoInput.value.trim();
    if (this.promoCode === "DISCOUNT10") {
      this.totalPrice = Math.round(this.totalPrice * 0.9);
      this._updateTotalsUI();
      this._showPromoHint("\u041F\u0440\u043E\u043C\u043E\u043A\u043E\u0434 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D! \u0421\u043A\u0438\u0434\u043A\u0430 10%");
    } else {
      this._showPromoHint("\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434");
    }
  }
  _showPromoHint(message) {
    const hint = this.container.querySelector("#promo-hint");
    if (hint) hint.textContent = message;
  }
  _buildDeliveryOptions() {
    const host = this.container.querySelector("#deliveryOptions");
    if (!host) return;
    const frag = document.createDocumentFragment();
    this.deliveryOptions.forEach((opt) => {
      const isChecked = !opt.disabled && !!opt.checked;
      const card = document.createElement("div");
      card.className = "delivery-card";
      if (opt.disabled) card.classList.add("disabled");
      if (isChecked) card.classList.add("checked");
      card.setAttribute("data-zone-name", "deliveryTypeButton");
      card.setAttribute(
        "data-zone-data",
        JSON.stringify({ label: opt.label, deliveryType: opt.deliveryType })
      );
      card.innerHTML = `
        <div class="delivery-card-header">
          <label for="delivery-type-selector_global_${opt.deliveryType}" class="delivery-label" data-auto="${opt.deliveryType}">
            <input
              id="delivery-type-selector_global_${opt.deliveryType}"
              name="delivery-type-selector_global"
              class="radio-input"
              type="radio"
              value="${opt.deliveryType}"
              ${isChecked ? "checked" : ""}
              ${opt.disabled ? "disabled" : ""}
              aria-disabled="${opt.disabled ? "true" : "false"}"
            >
            <div class="delivery-info">
              <div class="delivery-title">
                <h3>${opt.label}</h3>
                <div class="delivery-description">${opt.description}</div>
              </div>
              <div class="delivery-details">
                <div class="delivery-time">${opt.time}</div>
                <div class="delivery-price">${opt.price}</div>
              </div>
            </div>
            <div class="checkmark" aria-hidden="true">
              <i class="fa-solid fa-check"></i>
            </div>
          </label>
        </div>
      `;
      frag.appendChild(card);
    });
    host.replaceChildren(frag);
  }
  _onContainerClick(e) {
    const card = e.target.closest(".delivery-card");
    if (!card || !this.container.contains(card)) return;
    if (card.classList.contains("disabled")) return;
    const radio = card.querySelector('input[type="radio"]');
    if (!radio) return;
    this.container.querySelectorAll(".delivery-card").forEach((c) => c.classList.remove("checked"));
    radio.checked = true;
    card.classList.add("checked");
  }
  _onContainerChange(e) {
    const radio = e.target.closest('input[type="radio"]');
    if (!radio) return;
    const card = e.target.closest(".delivery-card");
    if (!card || card.classList.contains("disabled")) return;
    this.container.querySelectorAll(".delivery-card").forEach((c) => c.classList.remove("checked"));
    card.classList.add("checked");
  }
  _updateTotalsUI() {
    const totalEl = this.container.querySelector("#cart-total");
    const qtyEl = this.container.querySelector("#cart-count-inline");
    const wordEl = this.container.querySelector("#goodsNumWord");
    if (totalEl) totalEl.textContent = formatPrice(this.totalPrice);
    if (qtyEl) qtyEl.textContent = this.totalQty;
    if (wordEl) wordEl.textContent = pluralize(this.totalQty, this.goodsWordsArr);
  }
  async _renderCartItems() {
    const grid = this.container.querySelector("#checkout-grid");
    if (!grid) return;
    grid.innerHTML = "";
    if (!this.cartItems.length) {
      grid.innerHTML = "<p>\u0412\u0430\u0448\u0430 \u043A\u043E\u0440\u0437\u0438\u043D\u0430 \u043F\u0443\u0441\u0442\u0430.</p>";
      this.totalPrice = 0;
      this.totalQty = 0;
      this._updateTotalsUI();
      return;
    }
    this.totalPrice = 0;
    this.totalQty = 0;
    const frag = document.createDocumentFragment();
    for (const item of this.cartItems) {
      this.totalPrice += item.price * item.qty;
      this.totalQty += item.qty;
      const card = await this._createCartItemCard(item);
      frag.appendChild(card);
    }
    grid.replaceChildren(frag);
    this._updateTotalsUI();
  }
  async _createCartItemCard(item) {
    const card = document.createElement("div");
    card.classList.add("card", "mb-3");
    const picture = JSON.parse(item.picture)?.at(0) ?? "";
    card.innerHTML = `
      <div class="row g-0">
        <div class="col-md-4 imgWrapper">
          <img src="${picture}" class="img-fluid rounded-start checkoutPicture" alt="${item.name}">
        </div>
        <div class="col-md-8">
          <span class="amount">\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E: ${item.qty}</span>
          <div class="card-body">
            <h5 class="card-title">${item.fullname}</h5>
            <p class="card-text">${makeSpecHtmlPreview(item.specs)}</p>
            <div class="d-flex justify-content-between">
              <span>\u0426\u0435\u043D\u0430: <span class="price-submain">${formatPrice(item.price)}</span></span>
            </div>
            <div class="d-flex justify-content-between mt-3">
              <span>\u0418\u0442\u043E\u0433\u043E: <span class="price-main">${formatPrice(item.price * item.qty)}</span></span>
            </div>
          </div>
        </div>
      </div>
    `;
    return card;
  }
  _onCheckout() {
    alert("\u041F\u043B\u0430\u0442\u0435\u0436\u043D\u0430\u044F \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u0435\u0449\u0435 \u043D\u0435 \u0440\u0435\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043D\u0430.");
  }
  destroy() {
    this.container.innerHTML = "";
  }
};

// ShopMatic/js/ShopMatic.js
var ShopMatic = class {
  /**
   * Create a new ShopMatic instance.
   * @param {Object} foxEngine Host engine providing template loading and routing.
   * @param {Object} opts Optional configuration overrides.
   */
  constructor(foxEngine, opts = {}) {
    if (!foxEngine) throw new Error("foxEngine is required");
    this.foxEngine = foxEngine;
    this.opts = Object.assign({
      itemsId: "items",
      categoryFilterId: "categoryFilter",
      brandFilterId: "brandFilter",
      searchId: "search",
      sortId: "sort",
      searchBtnId: "searchBtn",
      cartGridId: "cart-grid",
      checkoutGridId: "checkout-grid",
      cartCountInlineId: "cart-count-inline",
      cartTotalId: "cart-total",
      miniCartTotalId: "miniCartTotal",
      miniCartListId: "miniCart",
      headerCartNumId: "cartNum",
      miniCartHeaderTitleId: "miniCartHeaderTitle",
      productsCountId: "productsCount",
      storageKey: "gribkov_cart_v1",
      favStorageKey: "gribkov_favs_v1",
      notificationDuration: 3e3,
      debug: false
    }, opts);
    this.productService = new ProductService(this.foxEngine);
    this.card = new Card(this);
    this.storage = new StorageService(this, { storageKey: this.opts.storageKey, favStorageKey: this.opts.favStorageKey });
    this.notifications = new Notifications();
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
      container: "#viewed-items"
    });
    this.wishlistModule = null;
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
    this._favsUnsub = null;
    this._bound = {
      onStorage: this._onStorageEvent.bind(this),
      onCartUpdated: this._onCartUpdated.bind(this)
    };
    this._delegationHandlers = /* @__PURE__ */ new WeakMap();
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
    const cartGridEl = document.getElementById(this.opts.cartGridId);
    const cartCountInlineEl = document.getElementById(this.opts.cartCountInlineId);
    const cartTotalEl = document.getElementById(this.opts.cartTotalId);
    const miniCartTotalEl = document.getElementById(this.opts.miniCartTotalId);
    const miniCartListEl = document.getElementById(this.opts.miniCartListId);
    const headerCartNumEl = document.getElementById(this.opts.headerCartNumId);
    const miniCartHeaderTitleEl = document.getElementById(this.opts.miniCartHeaderTitleId);
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
      console.warn("cart.setDomRefs failed", err);
    }
    await this.catalog.init();
    this.root = this.catalog.root;
    this.catFilter = this.catalog.catFilter;
    this.brandFilter = this.catalog.brandFilter;
    this.search = this.catalog.search;
    this.sort = this.catalog.sort;
    this.searchBtn = this.catalog.searchBtn;
    this.productsCount = this.catalog.productsCount;
    try {
      await this.favorites.loadFromStorage();
    } catch (e) {
      console.warn("favorites.loadFromStorage failed", e);
    }
    try {
      await this.cart.loadFromStorage();
    } catch (e) {
      console.warn("cart.loadFromStorage failed", e);
    }
    this._updateWishUI();
    try {
      this._favsUnsub = this.favorites.subscribe(() => {
        if (this.catalog && this.catalog.root) {
          const allCards = this.catalog.root.querySelectorAll("[data-product-id]");
          allCards.forEach((card) => {
            const pid = card.getAttribute("data-product-id");
            this.renderer.updateProductCardFavState(this.catalog.root, pid, this.favorites.isFavorite(pid));
          });
        }
        this._updateWishUI();
      });
    } catch (err) {
      console.warn("favorites.subscribe failed", err);
    }
    window.addEventListener("storage", this._bound.onStorage);
    window.addEventListener("cart:updated", this._bound.onCartUpdated);
    this.card._bindCardDelegation();
    this._syncAllCardsControls();
    this.wishlistModule = new WishlistModule();
    await this.viewedModule.load();
    await this.cart.updateCartUI();
  }
  /**
   * Destroy all event listeners and subordinate modules. Should be called
   * when the ShopMatic instance is no longer used.
   */
  destroy() {
    window.removeEventListener("storage", this._bound.onStorage);
    window.removeEventListener("cart:updated", this._bound.onCartUpdated);
    if (this.catalog && typeof this.catalog.destroy === "function") {
      try {
        this.catalog.destroy();
      } catch (_) {
      }
    }
    if (typeof this._favsUnsub === "function") {
      try {
        this._favsUnsub();
      } catch (e) {
      }
      this._favsUnsub = null;
    }
    if (this.favorites && typeof this.favorites.destroy === "function") {
      try {
        this.favorites.destroy();
      } catch (e) {
      }
    }
    if (this.cart && typeof this.cart.destroy === "function") {
      try {
        this.cart.destroy();
      } catch (e) {
      }
    }
  }
  /**
   * Update the wish counter in the UI to reflect the number of favourite
   * items. If there are none the element is hidden.
   */
  _updateWishUI() {
    try {
      const wishEl = document.getElementById("wishNum");
      if (!wishEl) return;
      const count = this.favorites && typeof this.favorites.getCount === "function" ? this.favorites.getCount() : 0;
      wishEl.style.display = count > 0 ? "inline-flex" : "none";
      wishEl.textContent = String(count);
    } catch (e) {
      console.warn("_updateWishUI failed", e);
    }
  }
  /**
   * Synchronise quantity controls and disabled state across all cards. Delegates
   * to Card module for per-card logic. Accepts an optional container; defaults
   * to the catalog root.
   * @param {HTMLElement} container Optional container to sync controls within.
   */
  _syncAllCardsControls(container = null) {
    const root = container || this.catalog && this.catalog.root;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll("[data-product-id]"));
    cards.forEach((card) => this.card._syncCardControlsState(card));
  }
  /**
   * Handle updates from storage. Re-sync cart/favourites and refresh UI.
   * @param {StorageEvent} e Storage event
   */
  _onStorageEvent(e) {
    if (!e) return;
    if (e.key === null) {
      try {
        this.cart.loadFromStorage();
      } catch (_) {
      }
      try {
        this.favorites.loadFromStorage();
      } catch (_) {
      }
      this._updateWishUI();
      this._syncAllCardsControls();
      return;
    }
    if (e.key === this.opts.storageKey) {
      try {
        this.cart.loadFromStorage();
      } catch (_) {
      }
      try {
        this.cart.updateCartUI();
      } catch (_) {
      }
      this._syncAllCardsControls();
    }
    if (e.key === this.opts.favStorageKey) {
      try {
        this.favorites.loadFromStorage();
      } catch (_) {
      }
      if (this.catalog && this.catalog.root) {
        const allCards = this.catalog.root.querySelectorAll("[data-product-id]");
        allCards.forEach((card) => {
          const pid = card.getAttribute("data-product-id");
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
      changedIds.forEach((id) => {
        if (!id) return;
        const selector = `[data-product-id="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/\"/g, '\\"')}"]`;
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
    location.hash = "#product/" + product;
    this.productPage.render(product, block);
  }
  /* ================== Public API (delegates) ================== */
  addToCart(id, qty = 1) {
    const desired = Math.max(1, parseInt(qty || 1, 10));
    const available = this.card._computeAvailableStock(id);
    if (available <= 0) {
      this.notifications.show("\u041D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C: \u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0442\u043A\u0430.", { duration: this.opts.notificationDuration });
      this._syncAllCardsControls();
      return false;
    }
    const toAdd = Math.min(desired, available);
    if (toAdd < desired) {
      this.notifications.show(`\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${toAdd} \u0448\u0442. (\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E ${available}).`, { duration: this.opts.notificationDuration });
    }
    return this.cart.add(id, toAdd);
  }
  changeQty(id, qty) {
    return this.cart.changeQty(id, qty);
  }
  isFavorite(id) {
    return this.favorites.isFavorite ? this.favorites.isFavorite(id) : false;
  }
  toggleFavorite(id) {
    return this.favorites.toggle ? this.favorites.toggle(id) : false;
  }
  getFavorites() {
    const ids = this.favorites.getAll ? this.favorites.getAll() : this.favorites.exportToArray ? this.favorites.exportToArray() : [];
    return Array.isArray(ids) ? ids.map((id) => this.productService.findById(id)).filter(Boolean) : [];
  }
  removeCartItem(id) {
    this.cart.remove(id);
  }
  async loadCatalog(brand = "", category = "") {
    await this.catalog.loadCatalog({ request: { brand, category } });
  }
  removeWishlistItem(id) {
    if (this.wishlistModule && typeof this.wishlistModule.removeFromFav === "function") {
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
  _onSearchInput() {
    this.applyFilters();
  }
  _onCatChange() {
    this.applyFilters();
  }
  _onBrandChange() {
    this.applyFilters();
  }
  _onSortChange() {
    this.applyFilters();
  }
  _onSearchBtn() {
    this.applyFilters();
  }
};
export {
  ShopMatic
};
//# sourceMappingURL=ShopMatic.js.map
