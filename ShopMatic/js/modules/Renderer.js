import { escapeHtml as _escapeHtml, makeSpecHtmlPreview, formatPrice, computeDiscountPercent } from './utils.js';

/**
 * Renderer
 * Улучшенная версия рендера карточек/корзины/мини-карточек
 * @author Calista Verner
 *
 * Данное переосмысление направлено на улучшение ООП-организации кода,
 * оптимизацию процессов построения DOM и уменьшение повторяющихся
 * участков логики. В частности, введены вспомогательные методы для
 * подготовки данных, форматирования цен, построения fallback-разметки
 * и нормализации входных данных. Благодаря этому основные методы
 * становятся более компактными, легко читаемыми и расширяемыми.
 */
export class Renderer {
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
    if (typeof value !== 'string') return value;
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
    return Array.isArray(arr) && arr.length ? String(arr[0]) : '/assets/no-image.png';
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
      if (typeof formatPrice === 'function') return formatPrice(value ?? 0);
      const num = Number(value ?? 0);
      return Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(num);
    } catch (_) {
      return String(value ?? '');
    }
  }

  /**
   * Безопасное экранирование для селектора (fallback если CSS.escape отсутствует)
   * @param {string} val
   * @returns {string}
   */
  escapeForAttribute(val) {
    try {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(String(val));
    } catch (_) { /* ignore */ }
    return String(val).replace(/"/g, '\\"');
  }

  /**
   * Логгер, падает безопасно если foxEngine отсутствует
   * @param {string} msg
   * @param {string} level
   */
  _log(msg, level = 'INFO') {
    try { this.foxEngine?.log?.(`Renderer: ${msg}`, level); } catch (_) { /* noop */ }
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
    if (!this.foxEngine || !this.foxEngine.templateCache) return '';
    const tpl = this.foxEngine.templateCache[tplName];
    if (!tpl) return '';
    try {
      // replaceTextInTemplate может быть асинхронным
      return await this.foxEngine.replaceTextInTemplate(tpl, data);
    } catch (e) {
      try { this.foxEngine?.log?.(`Renderer.renderTemplate ${tplName} error: ${e}`, 'ERROR'); } catch (_) {}
      return '';
    }
  }

  /**
   * Создаёт элемент DOM из HTML строки (возвращает первый элемент)
   * @param {string} html
   * @returns {Element}
   */
  createElementFromHTML(html = '') {
    const wrapper = document.createElement('div');
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
    const id = String(prod.name ?? prod.id ?? prod.productId ?? '');
    const imgArray = this._getImageArray(prod.picture);
    const firstImg = imgArray.length ? imgArray[0] : '/assets/no-image.png';
    const priceText = this._formatPrice(prod.price ?? 0);
    const hasOldPrice = (prod.oldPrice && Number(prod.oldPrice) > 0);
    const specsHtml = (typeof makeSpecHtmlPreview === 'function') ? makeSpecHtmlPreview(prod.specs || {}) : '';
    return {
      id,
      fullname: prod.fullname ?? prod.title ?? prod.name ?? '',
      imgArray,
      img: firstImg,
      short: prod.short ?? '',
      price: priceText,
      oldPrice: hasOldPrice ? this._formatPrice(prod.oldPrice) : '',
      badgeText: (Number(prod.stock) > 0) ? 'В наличии' : 'Под заказ',
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
    const id = String(item.name ?? item.id ?? item.productId ?? '').trim();
    const fullname = String(item.fullname ?? item.title ?? item.name ?? '').trim();
    const imageArray = this._getImageArray(item.picture);
    const picture = imageArray.length ? imageArray[0] : '/assets/no-image.png';
    const priceNum = Number(item.price ?? 0);
    const qtyNum = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 1;
    const stockNum = Number.isFinite(Number(item.stock)) ? Number(item.stock) : 0;
    const specsHtml = (typeof makeSpecHtmlPreview === 'function') ? makeSpecHtmlPreview(item.specs || {}) : '';
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
    const esc = (val) => _escapeHtml(String(val ?? ''));
    const hasOldPrice = Boolean(data.oldPrice);
    return `
        <article class="card" data-product-id="${esc(data.id)}">
          <div class="card__media">
            <img src="${esc(data.img)}" alt="${esc(data.fullname)}" loading="lazy">
          </div>
          <div class="card__body">
            <h3 class="card__title">${esc(data.fullname)}</h3>
            <div class="card__price">
              ${esc(data.price)}${hasOldPrice ? ' <small class="old">' + esc(data.oldPrice) + '</small>' : ''}
            </div>
            <div class="card__short">${esc(data.short)}</div>
            <div class="card__specs">${data.specsHtml || ''}</div>
            <div class="card__controls">
              <button data-role="buy" class="btn">В корзину</button>
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
    const esc = (s) => _escapeHtml(String(s ?? ''));
    const { id, fullname, picture, priceFormatted, totalPriceFormatted, qtyNum, stockNum, specsHtml } = data;
    const minQty = stockNum > 0 ? String(Math.max(1, qtyNum)) : '0';
    const disabledAttr = stockNum <= 0 ? ' disabled aria-disabled="true"' : '';
    return `
          <div class="cart-item" data-id="${esc(id)}">
            <div class="cart-item__content">
              <div class="cart-item__image"><img src="${esc(picture)}" alt="${esc(fullname)}" loading="lazy"></div>
              <div class="cart-item__details">
                <div class="cart-item__title"><a href="#product/${encodeURIComponent(id)}" rel="noopener noreferrer">${esc(fullname)}</a></div>
                ${specsHtml}
              </div>
              <div class="cart-item__right" role="group" aria-label="Управление товаром в корзине">
                <div class="cart-item__price" aria-hidden="false"><span class="price-value">${esc(priceFormatted)}</span>
                  <div class="price-total">Итого: <span class="price-total-value">${esc(totalPriceFormatted)}</span></div>
                </div>
                <div class="qty-controls" data-id="${esc(id)}" role="group" aria-label="Количество товара">
                  <button class="qty-btn qty-decr" type="button" aria-label="Уменьшить количество">−</button>
                  <input class="qty-input" type="number" value="${minQty}" min="1" max="${stockNum}" aria-label="Количество" inputmode="numeric"${disabledAttr}/>
                  <button class="qty-btn qty-incr" type="button" aria-label="Увеличить количество">+</button>
                </div>
              </div>
              <div class="cart-item__controls">
                <div class="cart-item__icons">
                  <button class="wishlist-btn fav-btn" type="button" title="Добавить в избранное" aria-label="Добавить в избранное"><i class="icon-heart" aria-hidden="true"></i></button>
                  <button class="remove-btn" type="button" data-id="${esc(id)}" title="Удалить" aria-label="Удалить товар"><i class="fa-regular fa-xmark" aria-hidden="true"></i></button>
                </div>
              </div>
              <div class="stock-warning" aria-hidden="true" style="display:none;">Товара нет в наличии</div>
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
    let html = '';
    // Сначала пытаемся воспользоваться шаблоном
    html = await this.renderTemplate('cardVertical', data);
    // Fallback при отсутствии шаблона
    if (!html) {
      html = this._buildVerticalCardHtml(data);
    }
    const node = this.createElementFromHTML(html);
    // Ensure data attribute presence
    try { node.setAttribute && node.setAttribute('data-product-id', String(data.id)); } catch (_) {}
    // attach gallery enhancement if needed
    if (Array.isArray(data.imgArray) && data.imgArray.length > 1) {
      try { this._attachImageGallery(node, data.imgArray); } catch (e) { this._log(`attachImageGallery error: ${e}`, 'WARN'); }
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
    const media = node.querySelector && node.querySelector('.card__media');
    if (!media) return;
    media.classList.add('multi-image');
    const overlay = document.createElement('div');
    overlay.className = 'card__image-overlay';
    const dots = document.createElement('div');
    dots.className = 'card__image-dots';
    const imgEl = media.querySelector('img');
    let activeIndex = 0;
    const updateImage = (index) => {
      if (index < 0 || index >= imgArray.length) return;
      activeIndex = index;
      if (imgEl) {
        imgEl.classList.add('fade');
        // небольшая задержка для плавности (сохраняем прежнюю логику)
        setTimeout(() => {
          imgEl.src = imgArray[index];
          imgEl.onload = () => imgEl.classList.remove('fade');
        }, 120);
      }
      dots.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('active', i === index));
    };
    imgArray.forEach((_, i) => {
      const zone = document.createElement('div');
      zone.className = 'card__image-zone';
      zone.style.setProperty('--zone-index', i);
      zone.addEventListener('mouseenter', () => updateImage(i));
      overlay.appendChild(zone);
      const dot = document.createElement('span');
      dot.className = 'dot';
      if (i === 0) dot.classList.add('active');
      dot.addEventListener('mouseenter', () => updateImage(i));
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
    rootEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    const items = Array.isArray(list) ? list : [];
    // generate cards in parallel
    const cards = await Promise.all(items.map((p) => this.createCard(p)));
    for (const card of cards) {
      if (!card) continue;
      card.style.opacity = '0';
      card.style.transition = 'opacity .22s ease';
      frag.appendChild(card);
      // animate on next frame
      requestAnimationFrame(() => { card.style.opacity = '1'; });
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
    const title = String(item.fullname ?? item.title ?? item.name ?? 'Товар');
    const price = this._formatPrice(item.price ?? 0);
    const qty = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0;
    const imageArray = this._getImageArray(item.picture);
    const img = String(imageArray.at ? imageArray.at(0) ?? '/assets/no-image.png' : imageArray[0] ?? '/assets/no-image.png');
    const id = String(item.name ?? item.id ?? '');
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
        this._log(`_createMiniCartItemHTML template error: ${e}`, 'WARN');
      }
    }
    // fallback (safe)
    return `<li class="cart-item" data-id="${_escapeHtml(id)}">
      <div class="mc-thumb"><img src="${_escapeHtml(img)}" alt="${_escapeHtml(title)}" loading="lazy"/></div>
      <div class="mc-body"><div class="mc-name">${_escapeHtml(title)}</div><div class="mc-meta">${_escapeHtml(String(qty))} × ${_escapeHtml(price)}</div></div>
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
      const qtyInput = produced.querySelector && produced.querySelector('.qty-input');
      const btnPlus = produced.querySelector && produced.querySelector('.qty-btn.qty-incr');
      const btnMinus = produced.querySelector && produced.querySelector('.qty-btn.qty-decr');
      if (qtyInput) {
        qtyInput.setAttribute('min', '1');
        qtyInput.setAttribute('max', String(stockNum));
        if (stockNum <= 0) {
          qtyInput.value = '0';
          qtyInput.disabled = true;
          qtyInput.setAttribute('aria-disabled', 'true');
        } else {
          let cur = parseInt(qtyInput.value || String(qtyNum), 10);
          if (isNaN(cur) || cur < 1) cur = Math.max(1, qtyNum || 1);
          if (cur > stockNum) cur = stockNum;
          qtyInput.value = String(cur);
          qtyInput.disabled = false;
          qtyInput.removeAttribute('aria-disabled');
        }
      }
      if (btnPlus) {
        const disabled = stockNum <= 0 || qtyNum >= stockNum;
        btnPlus.disabled = disabled;
        disabled ? btnPlus.setAttribute('aria-disabled', 'true') : btnPlus.removeAttribute('aria-disabled');
      }
      if (btnMinus) {
        const disabled = stockNum <= 0 || qtyNum <= 1;
        btnMinus.disabled = disabled;
        disabled ? btnMinus.setAttribute('aria-disabled', 'true') : btnMinus.removeAttribute('aria-disabled');
      }
      // stock warning
      const stockWarning = produced.querySelector && produced.querySelector('.stock-warning');
      if (stockNum <= 0) {
        if (stockWarning) {
          stockWarning.textContent = 'Товара нет в наличии';
          stockWarning.style.display = '';
          stockWarning.setAttribute('aria-hidden', 'false');
        }
        produced.classList.add('out-of-stock');
      } else if (stockWarning) {
        stockWarning.style.display = 'none';
        stockWarning.setAttribute('aria-hidden', 'true');
        produced.classList.remove('out-of-stock');
      }
    } catch (e) {
      this._log(`_configureQtyControls error: ${e}`, 'WARN');
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
    // empty state
    if (!arr.length) {
      cartEl.innerHTML = `
        <div class="cart-empty" role="status" aria-live="polite">
          <p><i class="fa-regular fa-cart-shopping" aria-hidden="true"></i> Ваша корзина пуста.</p>
          <a href="#page/catalog" class="btn btn-primary">Перейти в каталог</a>
        </div>`;
      return;
    }
    // map existing rows
    const existingMap = new Map();
    try {
      const existingRows = Array.from((cartEl.querySelectorAll && cartEl.querySelectorAll('.cart-item')) || []);
      for (const r of existingRows) {
        try {
          const did = r.getAttribute && (r.getAttribute('data-id') || r.getAttribute('data-cart-item') || r.getAttribute('data-cart-id'));
          if (did) existingMap.set(String(did), r);
        } catch (_) { /* ignore per-row errors */ }
      }
    } catch (_) { /* ignore */ }
    const frag = document.createDocumentFragment();
    for (const rawItem of arr) {
      const data = this._normalizeCartItem(rawItem);
      const existing = data.id ? existingMap.get(String(data.id)) : null;
      if (existing) {
        // try in-place update
        try {
          this._updateRowDom(existing, data);
          existingMap.delete(String(data.id));
          frag.appendChild(existing);
          continue;
        } catch (e) {
          existingMap.delete(String(data.id));
          this._log(`in-place update failed for ${data.id}: ${e}`, 'WARN');
        }
      }
      // create new
      let rowHtml = '';
      rowHtml = await this.renderTemplate('cardHorizontal', {
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
      try { if (String(data.id) && produced.setAttribute) produced.setAttribute('data-id', String(data.id)); } catch (_) {}
      // post-process produced: set proper input state
      this._configureQtyControls(produced, data.qtyNum, data.stockNum);
      frag.appendChild(produced);
    }
    // remove leftover nodes
    for (const [key, node] of existingMap) {
      try { if (node && node.parentNode) node.parentNode.removeChild(node); } catch (_) {}
    }
    // replace in one frame
    await new Promise((resolve) => requestAnimationFrame(resolve));
    cartEl.innerHTML = '';
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
    if (!row || typeof row !== 'object') return;
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
    // title/link
    try {
      const a = row.querySelector && row.querySelector('a[href*="#product/"]');
      if (a && a.setAttribute) {
        a.setAttribute('href', `#product/${encodeURIComponent(String(id))}`);
        if (a.firstChild && a.firstChild.nodeType === 3) a.firstChild.nodeValue = fullname;
        else a.textContent = fullname;
      } else {
        const title = row.querySelector && (row.querySelector('.cart-item__title') || row.querySelector('.cart-item__name') || row.querySelector('.cart-item__title a'));
        if (title) title.textContent = fullname;
      }
    } catch (e) { this._log(`updateRowDom title error: ${e}`, 'WARN'); }
    // image
    try {
      const img = row.querySelector && (row.querySelector('.cart-item__image img') || row.querySelector('img'));
      if (img && img.setAttribute) {
        img.setAttribute('src', String(picture));
        img.setAttribute('alt', String(fullname));
      }
    } catch (e) { this._log(`updateRowDom image error: ${e}`, 'WARN'); }
    // price / total
    try {
      const pv = row.querySelector && row.querySelector('.price-value');
      if (pv) pv.textContent = String(priceFormatted);
      const pt = row.querySelector && row.querySelector('.price-total-value');
      if (pt) pt.textContent = String(totalPriceFormatted);
    } catch (e) { this._log(`updateRowDom price error: ${e}`, 'WARN'); }
    // qty controls and stock warning
    this._configureQtyControls(row, qtyNum, stockNum);
    // specs area
    try {
      if (specsHtml) {
        const specsNode = row.querySelector && (row.querySelector('.cart-item__info') || row.querySelector('.cart-item__details'));
        if (specsNode) specsNode.innerHTML = specsHtml;
      }
    } catch (e) { this._log(`updateRowDom specs error: ${e}`, 'WARN'); }
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
    const favBtn = card.querySelector('.fav-btn');
    if (!favBtn) return;
    favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    favBtn.title = isFav ? 'В избранном' : 'Добавить в избранное';
    favBtn.classList.toggle('is-fav', !!isFav);
    const icon = favBtn.querySelector('i');
    if (icon) {
      icon.classList.remove('fa-regular', 'fa-solid');
      icon.classList.add(isFav ? 'fa-solid' : 'fa-regular');
      if (!icon.classList.contains('fa-heart')) icon.classList.add('fa-heart');
    }
  }
}