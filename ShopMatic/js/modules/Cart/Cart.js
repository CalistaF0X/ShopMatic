import { CartUI } from './CartUI.js';
import { Events } from '../Events.js';

/**
 * CartModule
 * @author Calista Verner
 */
export class CartModule extends CartUI {
  static UI_MESSAGES = Object.freeze({
    NOT_ENOUGH_STOCK: 'Недостаточно товара на складе.',
    ONLY_X_LEFT: 'В наличии только {stock} шт.',
    ADDED_TO_CART_HTML:
      'Товар ({title}) x{qty} добавлен в корзину <a href="#page/cart">Перейти в корзину</a>',
    ADDED_TO_CART_PLAIN:
      'Товар "{title}" x{qty} добавлен в корзину.',
    FAVORITES_UNAVAILABLE: 'Модуль избранного недоступен.',
    INSUFFICIENT_STOCK_ADD:
      'Недостаточно на складе. Доступно: {max}.',
    INSUFFICIENT_STOCK_CHANGEQTY:
      'Недостаточно на складе. Доступно: {stock}.',
    PRODUCT_OUT_OF_STOCK: 'Товар отсутствует на складе.',
    REACHED_MAX_STOCK_LIMIT_NOTIFY:
      'Достигнут максимальный лимит по остатку.',
    PRODUCT_LIMIT_DEFAULT: 'У вас уже максимум в корзине',
    PRODUCT_LIMIT_REACHED:
      'Вы достигли максимального количества этого товара',
    NO_STOCK_TEXT: 'Товара нет в наличии'
  });

  constructor({ storage, productService, renderer, notifications, favorites = null, opts = {} }) {
    super({ storage, productService, renderer, notifications, favorites, opts });
    this._bindCheckout();
    this.loadFromStorage();
  }

  _bus() {
    return this.storage?.shopMatic?.eventBus || null;
  }

  _emitCartChanged(payload) {
    const bus = this._bus();
    // canonical
    try { bus?.emit?.(Events.DOMAIN_CART_CHANGED, payload); } catch {}
    // legacy alias
    try { bus?.emit?.(Events.LEGACY_CART_CHANGED, payload); } catch {}
  }

  add(productId, qty = 1) {
    const ok = super.add(productId, qty);
    if (!ok) return false;

    const id = this._normalizeId(productId);
    const prod = this._resolveProduct(id);

    try {
      const title = prod && (prod.fullname || prod.title) ? (prod.fullname || prod.title) : id;
      try {
        this.notifications?.show?.(
          this._msg('ADDED_TO_CART_HTML', { title, qty }),
          { type: 'success', allowHtml: true }
        );
      } catch {
        this.notifications?.show?.(
          this._msg('ADDED_TO_CART_PLAIN', { title, qty }),
          { type: 'success' }
        );
      }
    } catch (e) {
      this._logError('notifications.show failed on add', e);
    }

    const uiRes = this.updateCartUI(id);
    this._emitCartChanged({ id, action: 'add' });
    return uiRes;
  }

  remove(productId) {
    const ok = super.remove(productId);
    if (!ok) return false;

    const id = this._normalizeId(productId);
    const uiRes = this.updateCartUI(id);
    this._emitCartChanged({ id, action: 'remove' });
    return uiRes;
  }

  changeQty(productId, newQty, opts = {}) {
    const ok = super.changeQty(productId, newQty, opts);
    if (!ok) return false;

    const id = this._normalizeId(productId);
    const uiRes = this.updateCartUI(id);
    this._emitCartChanged({ id, action: 'qty', qty: newQty });
    return uiRes;
  }

  async loadFromStorage() {
    await super.loadFromStorage();
    const uiRes = this.updateCartUI();

    try {
      const arr = this.getCartArray?.() || this.storage?.loadCart?.() || [];
      const ids = Array.isArray(arr)
        ? arr.map((x) => String(x?.id ?? x?.name ?? x?.productId ?? '').trim()).filter(Boolean)
        : [];
      if (ids.length) this._emitCartChanged({ ids, action: 'load' });
      else this._emitCartChanged({ action: 'load' });
    } catch {
      this._emitCartChanged({ action: 'load' });
    }

    return uiRes;
  }

  clear() {
    let ids = [];
    try {
      const arr = this.getCartArray?.() || [];
      if (Array.isArray(arr)) {
        ids = arr.map((x) => String(x?.id ?? x?.name ?? x?.productId ?? '').trim()).filter(Boolean);
      }
    } catch {}

    super.clear();
    const uiRes = this.updateCartUI();

    if (ids.length) this._emitCartChanged({ ids, action: 'clear' });
    else this._emitCartChanged({ action: 'clear' });

    return uiRes;
  }

  _setCartForTest(cartArray) {
    super._setCartForTest(cartArray);
    const uiRes = this.updateCartUI();
    this._emitCartChanged({ action: 'test' });
    return uiRes;
  }
}
