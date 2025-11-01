/*
 * MiniCart for ShopMatic — optimized and refactored
 *
 * Этот класс инкапсулирует логику отображения мини‑корзины и предназначен
 * для безопасного и эффективного рендеринга списка товаров. В данной версии
 * внесены улучшения в структуру кода (ООП), повышена читаемость и
 * производительность, а также устранено повторение кода.
 *
 * Основные изменения:
 *  - Использована деструктуризация для параметров конструктора и опций
 *  - Введены вспомогательные методы для нормализации и хэширования товаров
 *  - Рендеринг элементов разбит на более мелкие шаги: сбор существующих
 *    узлов, их переиспользование, создание новых узлов и очистка лишних
 *  - Упрощено создание fallback‑разметки и перенесено в отдельный метод
 *  - Внесены небольшие оптимизации по работе с DOM и кешированию
 */

export class MiniCart {
  /**
   * Общие текстовые сообщения и классы для UI
   * @type {Readonly<Record<string,string>>}
   */
  static UI_MESSAGES = Object.freeze({
    EMPTY_TEXT: 'Корзина пуста',
    EMPTY_ICON_CLASS: 'fa-solid fa-cart-shopping',
    SUMMARY_MORE: 'Ещё {n} товар{plural}… <a href="#page/cart" class="mc-summary__link">Перейти в корзину</a>',
    FALLBACK_NAME: 'Товар',
    HEADER_BASE: 'Корзина'
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
    // деструктуризация с дефолтами
    const {
      emptyText = this.constructor.UI_MESSAGES.EMPTY_TEXT,
      emptyIconClass = this.constructor.UI_MESSAGES.EMPTY_ICON_CLASS,
      maxItems = 10,
      debug = false
    } = opts;
    this.opts = { emptyText, emptyIconClass, maxItems, debug };
    // DOM refs
    this.listEl = null;
    this.headerTitleEl = null;
    // internal state
    this._lastRenderHash = '';
    this._headerBase = null;
    /**
     * @type {Map<string, Element>} карта элементов по idKey для переиспользования
     */
    this._elementsMap = new Map();
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
    const pool = (this.constructor && this.constructor.UI_MESSAGES) || {};
    const tpl = pool[key] ?? '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }

  /**
   * Экранирует строку для HTML
   * @param {any} s
   * @returns {string}
   */
  static _escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Форматирует цену в рублях
   * @param {number|string} num
   * @returns {string}
   */
  _formatPrice(num) {
    try {
      return Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(num || 0));
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
      const wrapper = document.createElement('div');
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
    const idKey = String(it?.name ?? it?.id ?? it?.productId ?? '').trim();
    const qty = Number.isFinite(Number(it?.qty)) ? Number(it?.qty) : 0;
    const priceNum = Number.isFinite(Number(it?.price)) ? Number(it?.price) : 0;
    const name = it?.fullname || it?.title || it?.name || this.constructor.UI_MESSAGES.FALLBACK_NAME;
    const picture = it?.picture || it?.image || '/assets/no-image.png';
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
    const id = MiniCart._escapeHtml(norm.idKey);
    const name = MiniCart._escapeHtml(norm.name);
    const qty = MiniCart._escapeHtml(String(norm.qty));
    const price = MiniCart._escapeHtml(norm.priceFormatted);
    const img = MiniCart._escapeHtml(norm.picture);
    const liHtml = `
      <li class="mc-item" data-id="${id}">
        <div class="mc-thumb"><img src="${img}" alt="${name}" loading="lazy" /></div>
        <div class="mc-body">
          <div class="mc-name">${name}</div>
          <div class="mc-meta">${qty} × <span class="mc-price">${price}</span></div>
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
        if (!this.listEl.hasAttribute('aria-live')) this.listEl.setAttribute('aria-live', 'polite');
      } catch (e) {}
    }
    if (headerTitleEl) {
      this.headerTitleEl = headerTitleEl;
      try {
        this._headerBase = (this.headerTitleEl.textContent || '').replace(/\(\d+\)$/, '').trim() || this.constructor.UI_MESSAGES.HEADER_BASE;
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
    if (!Array.isArray(cart) || cart.length === 0) return '';
    return cart.map((i) => {
      const id = String(i?.name ?? i?.id ?? i?.productId ?? '').trim();
      const qty = String(Number(i?.qty || 0));
      const price = String(Number(i?.price || 0));
      return `${id}:${qty}:${price}`;
    }).join('|');
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
          if (this.opts.debug) console.error('MiniCart.render error', e);
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
      // даже если структура не изменилась, обновим заголовок
      this.updateHeader(cart.reduce((s, it) => s + Number(it.qty || 0), 0));
      return;
    }
    this._lastRenderHash = hash;
    // нормализованный список
    const normalized = Array.isArray(cart) ? cart.slice() : [];
    // пустое состояние
    if (!normalized.length) {
      this._elementsMap.clear();
      const li = document.createElement('li');
      li.className = 'mc-item empty';
      const iconCls = MiniCart._escapeHtml(this.opts.emptyIconClass);
      const text = MiniCart._escapeHtml(this.opts.emptyText);
      li.innerHTML = `<div class="mc-empty"><span class="mc-empty__icon"><i class="${iconCls}" aria-hidden="true"></i></span><span class="mc-empty__text">${text}</span></div>`;
      await new Promise((r) => requestAnimationFrame(r));
      try {
        this.listEl.innerHTML = '';
        this.listEl.appendChild(li);
      } catch (e) {
        this.listEl.innerHTML = '';
        this.listEl.appendChild(li);
      }
      this.updateHeader(0);
      return;
    }
    // собрать существующие элементы в карту (ключом служит idKey)
    const existing = new Map();
    for (const child of Array.from(this.listEl.children || [])) {
      try {
        const did = child.getAttribute && (child.getAttribute('data-id') || child.getAttribute('data-cart-item'));
        if (did) existing.set(String(did), child);
      } catch (e) {}
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
      // попробовать переиспользовать из карты
      if (this._elementsMap.has(norm.idKey)) {
        node = this._elementsMap.get(norm.idKey);
        try {
          const storedHash = node.getAttribute && node.getAttribute('data-mc-hash');
          if (storedHash === itemHash) {
            existing.delete(norm.idKey);
            frag.appendChild(node);
            shown++;
            continue;
          }
        } catch (e) {
          // игнорировать и переотрисовать
        }
      }
      // создать новый узел через renderer (если доступен)
      let produced = null;
      if (this.renderer && typeof this.renderer._createMiniCartItemHTML === 'function') {
        try {
          const out = await this.renderer._createMiniCartItemHTML(normalized[i], this.renderer.foxEngine);
          if (typeof out === 'string') {
            produced = this._createElFromHTML(out) || null;
          } else if (out instanceof Element) {
            produced = out.cloneNode(true);
          } else if (out instanceof DocumentFragment) {
            produced = out.firstElementChild ? out.firstElementChild.cloneNode(true) : null;
          }
        } catch (e) {
          if (this.opts.debug) console.warn('MiniCart: renderer item failed', e);
          produced = null;
        }
      }
      // fallback
      if (!produced) {
        produced = this._renderFallbackItem(norm);
      }
      if (!produced) continue;
      // присвоить атрибуты и кешировать
      try {
        produced.setAttribute('data-id', String(norm.idKey));
        produced.setAttribute('data-mc-hash', itemHash);
      } catch (e) {}
      try {
        this._elementsMap.set(norm.idKey, produced);
      } catch (e) {}
      frag.appendChild(produced);
      shown++;
    }
    // добавить summary если есть отброшенные
    if (dropped > 0) {
      const summary = document.createElement('li');
      summary.className = 'mc-item mc-summary';
      const plural = dropped > 1 ? 'ов' : '';
      summary.innerHTML = this._msg('SUMMARY_MORE', { n: dropped, plural });
      frag.appendChild(summary);
    }
    // удалить лишние существующие узлы
    for (const [did, node] of existing.entries()) {
      try {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      } catch (e) {}
      try {
        this._elementsMap.delete(did);
      } catch (_) {}
    }
    // заменить DOM за один кадр
    await new Promise((r) => requestAnimationFrame(r));
    try {
      this.listEl.innerHTML = '';
      this.listEl.appendChild(frag);
    } catch (e) {
      try {
        const tmp = document.createElement('div');
        tmp.appendChild(frag.cloneNode(true));
        this.listEl.innerHTML = tmp.innerHTML;
      } catch (_) {
        this.listEl.innerHTML = '';
      }
    }
    // обновить заголовок
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
        this._headerBase = (this.headerTitleEl.textContent || '').replace(/\(\d+\)$/, '').trim() || this.constructor.UI_MESSAGES.HEADER_BASE;
      }
      this.headerTitleEl.textContent = `${this._headerBase} (${Number(totalCount)})`;
      this.headerTitleEl.setAttribute && this.headerTitleEl.setAttribute('aria-live', 'polite');
    } catch (e) {
      if (this.opts.debug) console.warn('MiniCart.updateHeader failed', e);
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
      this._lastRenderHash = '';
      this._headerBase = null;
      this._latestCart = null;
      this._pendingRaf = false;
    } catch (e) {
      if (this.opts.debug) console.warn('MiniCart.destroy failed', e);
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
    const idStr = String(id ?? '').trim();
    if (!idStr) return false;
    // Если нет сохранённой корзины, удалить невозможно
    if (!Array.isArray(this._latestCart)) return false;
    // Поиск товара по идентификатору
    const normalize = (it) => String(it?.name ?? it?.id ?? it?.productId ?? '').trim();
    const index = this._latestCart.findIndex((it) => normalize(it) === idStr);
    if (index < 0) return false;
    // Удаляем из массива
    this._latestCart.splice(index, 1);
    // Удаляем кешированный DOM-элемент (если есть)
    try {
      if (this._elementsMap.has(idStr)) {
        const el = this._elementsMap.get(idStr);
        if (el && el.parentNode) el.parentNode.removeChild(el);
        this._elementsMap.delete(idStr);
      }
    } catch (_) {}
    // Инициируем перерисовку
    // После удаления хэш больше не совпадёт, поэтому _lastRenderHash может быть сброшен
    this._lastRenderHash = '';
    this.render(this._latestCart);
    return true;
  }
}