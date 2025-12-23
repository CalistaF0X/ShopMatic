// Renderer/CartRenderer.js
import { BaseRenderer } from '../../BaseRenderer.js';

/**
 * Renders and updates horizontal cart rows (supports per-item include checkbox).
 * @author Calista Verner
 */
export class HorizontalCardRenderer extends BaseRenderer {
  constructor(shopMatic) {
    super({ shopMatic });
    this.shopMatic = shopMatic;
  }

  _normalizeCartItem(item = {}) {
    const id = String(item.name ?? item.id ?? item.productId ?? '').trim();
    const fullname = String(item.fullname ?? item.title ?? item.name ?? '').trim();
    const imageArray = this._getImageArray(item.picture);
    const picture = imageArray.length ? imageArray[0] : '/assets/no-image.png';
    const priceNum = Number(item.price ?? 0);
    const qtyNum = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 1;
    const stockNum = Number.isFinite(Number(item.stock)) ? Number(item.stock) : 0;

    // included checkbox flag (default: true)
    const included = (item.included !== undefined) ? Boolean(item.included) : true;

    const specsHtml =
      typeof this.makeSpecHtmlPreview === 'function'
        ? this.makeSpecHtmlPreview(item.specs || {})
        : '';

    const priceFormatted = this._formatPrice(priceNum);
    const totalPriceFormatted = this._formatPrice(priceNum * qtyNum);

    return {
      id,
      fullname,
      picture,
      priceNum,
      qtyNum,
      stockNum,
      included,
      specsHtml,
      priceFormatted,
      totalPriceFormatted,
    };
  }

  _configureQtyControls(produced, qtyNum = 1, stockNum = 0) {
    if (!produced) return;

    try {
      const qtyInput = produced.querySelector?.('.qty-input');
      const btnPlus = produced.querySelector?.('.qty-btn.qty-incr');
      const btnMinus = produced.querySelector?.('.qty-btn.qty-decr');

      if (qtyInput) {
        qtyInput.setAttribute('min', '1');
        qtyInput.setAttribute('max', String(stockNum));

        if (stockNum <= 0) {
          qtyInput.value = '0';
          qtyInput.disabled = true;
          qtyInput.setAttribute('aria-disabled', 'true');
        } else {
          let cur = parseInt(qtyInput.value || String(qtyNum), 10);
          if (Number.isNaN(cur) || cur < 1) cur = Math.max(1, qtyNum || 1);
          if (cur > stockNum) cur = stockNum;
          qtyInput.value = String(cur);
          qtyInput.disabled = false;
          qtyInput.removeAttribute('aria-disabled');
        }
      }

      if (btnPlus) {
        const disabled = stockNum <= 0 || qtyNum >= stockNum;
        btnPlus.disabled = disabled;
        disabled
          ? btnPlus.setAttribute('aria-disabled', 'true')
          : btnPlus.removeAttribute('aria-disabled');
      }

      // Минус НЕ блокируем (по требованию). Логику "ниже 1" держит обработчик.
      if (btnMinus) {
        btnMinus.disabled = false;
        btnMinus.removeAttribute('aria-disabled');
      }

      const stockWarning = produced.querySelector?.('.stock-warning');
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

  _applyIncludeUI(row, included) {
    if (!row) return;

    const on = included !== undefined ? !!included : true;

    try {
      const cb = row.querySelector?.('input[data-role="include"]');
      if (cb) cb.checked = on;
    } catch (_) {}

    try {
      row.classList.toggle('excluded-from-total', !on);
      row.dataset.included = on ? '1' : '0';
    } catch (_) {}
  }

  _readIncludedFromServices(id) {
    const c = this.shopMatic?.cart;
    // Prefer IncludedStates if present
    try {
      if (c?.included && typeof c.included.isIncluded === 'function') {
        return !!c.included.isIncluded(id);
      }
    } catch (_) {}

    // fallback: try to read from cart item model
    try {
      const item = c?._getCartItemById?.(id);
      if (item && item.included !== undefined) return !!item.included;
    } catch (_) {}

    return true;
  }

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
    specsHtml,
    included,
  } = data;

  const safeId = String(id ?? '').trim();
  const safeName = String(fullname ?? '').trim();

  try {
    if (safeId && row.setAttribute) {
      row.setAttribute('data-id', safeId);
      row.setAttribute('data-product-id', safeId);
    }
    row.dataset.stock = String(stockNum ?? '');
  } catch (_) {}

  this._applyIncludeUI(row, included);

  try {
    let a =
      row.querySelector?.('.cart-item__title a') ||
      row.querySelector?.('a[href^="#product/"]') ||
      row.querySelector?.('a[href*="#product/"]');

    if (!a) {
      const titleWrap = row.querySelector?.('.cart-item__title');
      if (titleWrap) {
        a = document.createElement('a');
        a.rel = 'noopener noreferrer';
        titleWrap.appendChild(a);
      }
    }

    if (a?.setAttribute) {
      if (safeId) a.setAttribute('href', `#product/${encodeURIComponent(safeId)}`);
      a.textContent = safeName;
    }
  } catch (e) {
    this._log(`updateRowDom title error: ${e}`, 'WARN');
  }

  try {
    const img = row.querySelector?.('.cart-item__image img, img');
    if (img?.setAttribute) {
      img.setAttribute('src', String(picture ?? ''));
      img.setAttribute('alt', safeName);
    }
  } catch (e) {
    this._log(`updateRowDom image error: ${e}`, 'WARN');
  }

  try {
    const pv = row.querySelector?.('.price-value');
    if (pv) pv.textContent = String(priceFormatted ?? '');
    const pt = row.querySelector?.('.price-total-value');
    if (pt) pt.textContent = String(totalPriceFormatted ?? '');
  } catch (e) {
    this._log(`updateRowDom price error: ${e}`, 'WARN');
  }

  this._configureQtyControls(row, qtyNum, stockNum);

  try {
    const details = row.querySelector?.('.cart-item__details');
    if (!details) return;

    const legacyLi = details.querySelector?.('li.cart-itemSpecs');
    const roleWrap = details.querySelector?.('[data-role="specs"]');
    const divWrap = details.querySelector?.('.cart-item__specs');

    let target = legacyLi || roleWrap || divWrap || null;

    if (!target) {
      const ul = details.querySelector?.('ul');
      if (ul) {
        const li = document.createElement('li');
        li.className = 'cart-itemSpecs';
        li.setAttribute('data-role', 'specs');
        const titleLi = ul.querySelector?.('li.cart-item__title');
        if (titleLi && titleLi.nextSibling) ul.insertBefore(li, titleLi.nextSibling);
        else ul.appendChild(li);
        target = li;
      } else {
        const div = document.createElement('div');
        div.className = 'cart-item__specs';
        div.setAttribute('data-role', 'specs');
        details.appendChild(div);
        target = div;
      }
    }

    if (legacyLi) {
      if (divWrap && divWrap !== legacyLi) {
        try { divWrap.remove(); } catch {}
      }
      if (roleWrap && roleWrap !== legacyLi) {
        try { roleWrap.remove(); } catch {}
      }
    } else if (roleWrap) {
      if (divWrap && divWrap !== roleWrap) {
        try { divWrap.remove(); } catch {}
      }
    }

    if (target) {
      target.innerHTML = '';
      if (specsHtml) target.innerHTML = String(specsHtml);
    }
  } catch (e) {
    this._log(`updateRowDom specs error: ${e}`, 'WARN');
  }
}

  async _createRowFromData(data) {
    if (!data) return null;

    // Ensure included reflects current IncludedStates (source of truth)
    const id = String(data.id ?? '').trim();
    if (id) {
      data.included = this._readIncludedFromServices(id);
    } else if (data.included === undefined) {
      data.included = true;
    }

    let rowHtml = '';
    try {
      rowHtml = await this.renderTemplate('cardHorizontal', {
        id: data.id,
        fullname: data.fullname,
        price: data.priceFormatted,
        totalPrice: data.totalPriceFormatted,
        qty: data.qtyNum,
        stock: data.stockNum,
        picture: data.picture,
        specs: data.specsHtml,

        // for templates that support placeholders:
        includeChecked: data.included ? 'checked' : ''
      });
    } catch (e) {
      this._log(`renderTemplate(cardHorizontal) error: ${e}`, 'WARN');
    }

    if (!rowHtml) {
      rowHtml = await this.renderTemplate('cardHorizontal', data);
    }

    let produced;
    try {
      produced = this.createElementFromHTML(rowHtml);
    } catch (e) {
      this._log(`createElementFromHTML error: ${e}`, 'ERROR');
      return null;
    }

    try {
      if (String(data.id) && produced.setAttribute) {
        produced.setAttribute('data-id', String(data.id));
        produced.setAttribute('data-product-id', String(data.id));
        produced.setAttribute('data-stock', String(data.stockNum ?? ''));
      }
    } catch (_) {}

    // If template didn't include checkbox, inject minimal include checkbox (safety)
    try {
      const hasInclude = !!produced.querySelector?.('input[data-role="include"]');
      if (!hasInclude) {
        const content = produced.querySelector?.('.cart-item__content') || produced;
        const wrap = document.createElement('label');
        wrap.className = 'y-checkbox cart-row-select';
        wrap.title = 'Включать в оформление';
        wrap.innerHTML = `
          <input type="checkbox" class="cart-item-checkbox" data-role="include" ${data.included ? 'checked' : ''}>
          <span class="y-box">
            <svg class="y-icon" viewBox="0 0 24 24" width="24" height="24">
              <path d="M10.003 19 2.503 11.5l1.498-1.501 6.001 6.061 9.5-9.564 1.5 1.5z"></path>
            </svg>
          </span>`;
        content.insertBefore(wrap, content.firstChild);
      }
    } catch (_) {}

    // Apply include UI class even if template already had checkbox
    this._applyIncludeUI(produced, data.included);

    // Bindings + state are applied ONLY where the card DOM is created.
    try {
      this.shopMatic?.card?.mount?.(produced, { name: data.id, ...data }, 'HORIZONTAL');
    } catch (_) {}

    this._configureQtyControls(produced, data.qtyNum, data.stockNum);
    return produced;
  }

  async createCard(item = {}) {
    // Modern contract: createCard returns a DOM Element.
    const data = this._normalizeCartItem(item);
    return await this._createRowFromData(data);
  }


  async renderListHorizontal(cartEl, cartArr = [], options = {}) {
    if (!cartEl) return;

    const { clear = true, reuseExisting = true } = options;
    const arr = Array.isArray(cartArr) ? cartArr : [];

    if (!arr.length) {
      cartEl.innerHTML = `
        <div class="cart-empty" role="status" aria-live="polite">
          <p><i class="fa-regular fa-cart-shopping" aria-hidden="true"></i> Ваша корзина пуста.</p>
          <a href="#page/catalog" class="btn btn-primary">Перейти в каталог</a>
        </div>`;
      return;
    }

    const existingMap = new Map();

    if (reuseExisting) {
      try {
        const existingRows = Array.from(cartEl.querySelectorAll?.('.cart-item') || []);
        for (const r of existingRows) {
          const did =
            r.getAttribute?.('data-id') ||
            r.getAttribute?.('data-cart-item') ||
            r.getAttribute?.('data-cart-id');
          if (did) existingMap.set(String(did), r);
        }
      } catch (_) {}
    }

    const fragment = document.createDocumentFragment();

    for (const rawItem of arr) {
      const data = this._normalizeCartItem(rawItem);
      if (!data.id) {
        this._log('Cart item has no id, skipping', 'WARN');
        continue;
      }

      // Keep included in sync with IncludedStates source of truth
      data.included = this._readIncludedFromServices(data.id);

      const existing = reuseExisting ? existingMap.get(String(data.id)) : null;

      if (existing) {
        try {
          this._updateRowDom(existing, data);
          existingMap.delete(String(data.id));
          fragment.appendChild(existing);
          continue;
        } catch (e) {
          existingMap.delete(String(data.id));
          this._log(`in-place update failed for ${data.id}: ${e}`, 'WARN');
        }
      }

      const produced = await this._createRowFromData(data);
      if (produced) fragment.appendChild(produced);
    }

    for (const [, node] of existingMap) {
      try { node?.parentNode?.removeChild(node); } catch (_) {}
    }

    if (clear) cartEl.innerHTML = '';
    cartEl.appendChild(fragment);

    // After render, refresh master checkbox state if available
    try { this.shopMatic?.cart?.included?.updateMasterSelectState?.(); } catch (_) {}
  }

  async renderCartHorizontal(cartEl, cartArr = []) {
    return this.renderListHorizontal(cartEl, cartArr);
  }
}