import { formatPrice, makeSpecHtmlPreview, pluralize } from './utils.js';

export class CheckoutPage {
  constructor(cartService) {
    this.cartService = cartService;
    this.foxEngine = this.cartService.storage.shopMatic.foxEngine;
    this.cartItems = [];
    this.totalPrice = 0;
    this.totalQty = 0;
    this.promoCode = '';
	this.goodsWordsArr = ['товар', 'товара', 'товаров'];

    this.deliveryOptions = [
      {
        label: 'По клику',
        deliveryType: 'ON_DEMAND',
        description: 'По клику за 15-30 минут',
        time: 'Завтра или позже',
        price: 'бесплатно',
        checked: false,
        disabled: true,
      },
      {
        label: 'Пункт выдачи',
        deliveryType: 'PICKUP',
        description: 'Рядом, 7 минут',
        time: 'Завтра или позже',
        price: 'бесплатно',
        checked: true,
        disabled: false,
      },
      {
        label: 'Курьер',
        deliveryType: 'COURIER',
        description: 'Доставка на дом',
        time: 'Завтра или позже',
        price: 'бесплатно',
        checked: false,
        disabled: true,
      },
    ];

    this._bound = {
      onApplyPromo: this._onApplyPromo.bind(this),
      onCheckout: this._onCheckout.bind(this),
      onContainerClick: this._onContainerClick.bind(this),
      onContainerChange: this._onContainerChange.bind(this),
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
    this.container
      .querySelector('.promo-code-apply')
      ?.addEventListener('click', this._bound.onApplyPromo);

    this.container
      .querySelector('.btn-checkout')
      ?.addEventListener('click', this._bound.onCheckout);

    // Делегирование — клики по карточкам, и изменения радио по клавиатуре
    this.container.addEventListener('click', this._bound.onContainerClick);
    this.container.addEventListener('change', this._bound.onContainerChange);
  }

  _onApplyPromo() {
    const promoInput = this.container.querySelector('#promo-input');
    if (!promoInput) return;
    this.promoCode = promoInput.value.trim();
    if (this.promoCode === 'DISCOUNT10') {
      this.totalPrice = Math.round(this.totalPrice * 0.9);
      this._updateTotalsUI();
      this._showPromoHint('Промокод применен! Скидка 10%');
    } else {
      this._showPromoHint('Неверный промокод');
    }
  }

  _showPromoHint(message) {
    const hint = this.container.querySelector('#promo-hint');
    if (hint) hint.textContent = message;
  }

  _buildDeliveryOptions() {
    const host = this.container.querySelector('#deliveryOptions');
    if (!host) return;

    const frag = document.createDocumentFragment();

    this.deliveryOptions.forEach((opt) => {
      // Если опция disabled — принудительно снимаем checked для целостности
      const isChecked = !opt.disabled && !!opt.checked;

      const card = document.createElement('div');
      card.className = 'delivery-card';
      if (opt.disabled) card.classList.add('disabled');
      if (isChecked) card.classList.add('checked');

      card.setAttribute('data-zone-name', 'deliveryTypeButton');
      card.setAttribute(
        'data-zone-data',
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
              ${isChecked ? 'checked' : ''}
              ${opt.disabled ? 'disabled' : ''}
              aria-disabled="${opt.disabled ? 'true' : 'false'}"
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
    const card = e.target.closest('.delivery-card');
    if (!card || !this.container.contains(card)) return;
    if (card.classList.contains('disabled')) return;

    const radio = card.querySelector('input[type="radio"]');
    if (!radio) return;

    // Снять checked со всех, проставить на текущую
    this.container
      .querySelectorAll('.delivery-card')
      .forEach((c) => c.classList.remove('checked'));

    radio.checked = true;
    card.classList.add('checked');
  }

  _onContainerChange(e) {
    const radio = e.target.closest('input[type="radio"]');
    if (!radio) return;

    const card = e.target.closest('.delivery-card');
    if (!card || card.classList.contains('disabled')) return;

    // Синхронизация при навигации клавиатурой по радио
    this.container
      .querySelectorAll('.delivery-card')
      .forEach((c) => c.classList.remove('checked'));
    card.classList.add('checked');
  }

  _updateTotalsUI() {
    const totalEl = this.container.querySelector('#cart-total');
    const qtyEl = this.container.querySelector('#cart-count-inline');
    const wordEl = this.container.querySelector('#goodsNumWord');

    if (totalEl) totalEl.textContent = formatPrice(this.totalPrice);
    if (qtyEl) qtyEl.textContent = this.totalQty;
    if (wordEl) wordEl.textContent = pluralize(this.totalQty, this.goodsWordsArr);
  }

  async _renderCartItems() {
    const grid = this.container.querySelector('#checkout-grid');
    if (!grid) return;

    grid.innerHTML = '';

    if (!this.cartItems.length) {
      grid.innerHTML = '<p>Ваша корзина пуста.</p>';
      this.totalPrice = 0;
      this.totalQty = 0;
      this._updateTotalsUI();
      return;
    }

    // ВАЖНО: сброс перед пересчётом
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
    const card = document.createElement('div');
    card.classList.add('card', 'mb-3');

    const picture = JSON.parse(item.picture)?.at(0) ?? '';

    card.innerHTML = `
      <div class="row g-0">
        <div class="col-md-4 imgWrapper">
          <img src="${picture}" class="img-fluid rounded-start checkoutPicture" alt="${item.name}">
        </div>
        <div class="col-md-8">
          <span class="amount">Количество: ${item.qty}</span>
          <div class="card-body">
            <h5 class="card-title">${item.fullname}</h5>
            <p class="card-text">${makeSpecHtmlPreview(item.specs)}</p>
            <div class="d-flex justify-content-between">
              <span>Цена: <span class="price-submain">${formatPrice(item.price)}</span></span>
            </div>
            <div class="d-flex justify-content-between mt-3">
              <span>Итого: <span class="price-main">${formatPrice(item.price * item.qty)}</span></span>
            </div>
          </div>
        </div>
      </div>
    `;
    return card;
  }

  _onCheckout() {
    alert('Платежная информация еще не реализована.');
  }

  destroy() {
    this.container.innerHTML = '';
  }
}