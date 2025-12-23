// Renderer/CardRenderer.js
import { BaseRenderer } from '../../BaseRenderer.js';

/**
 * VerticalCardRenderer
 * Отвечает за рендер вертикальных карточек и списков карточек
 */
export class VerticalCardRenderer extends BaseRenderer {
  /**
   * @param {Object} shopMatic
   */
  constructor(shopMatic) {
    super({ shopMatic });
    this.shopMatic = shopMatic;
	this.card = shopMatic.card;
  }

  _extractProductId(prod = {}) {
    const raw = prod.name ?? prod.id ?? prod.productId ?? prod.product_id;
    if (raw == null) return '';
    const id = String(raw).trim();
    return id;
  }

  _createCardData(prod = {}) {
    const id = this._extractProductId(prod);
    if (!id) {
      this._log('Product has no id/name/productId, skip card render', 'WARN');
      return null;
    }

    const imgArray = this._getImageArray(prod.picture);
    const firstImg = imgArray.length ? imgArray[0] : '/assets/no-image.png';
    const priceNum = Number(prod.price) || 0;
    const priceText = this._formatPrice(priceNum);

    const hasOldPrice =
      prod.oldPrice != null && Number(prod.oldPrice) > 0;

    const specsHtml =
      typeof this.makeSpecHtmlPreview === 'function'
        ? this.makeSpecHtmlPreview(prod.specs || {})
        : '';

    return {
      id,
      fullname: prod.fullname ?? prod.title ?? prod.name ?? '',
      imgArray,
      img: firstImg,
      short: prod.short ?? '',
      price: priceText,
      oldPrice: hasOldPrice ? this._formatPrice(prod.oldPrice) : '',
      badgeText: Number(prod.stock) > 0 ? 'В наличии' : 'Под заказ',
      stock: Number.isFinite(Number(prod.stock)) ? Number(prod.stock) : 0,
      specsHtml,
    };
  }

  _buildVerticalCardHtml(data) {
    const esc = (val) => this.htmlEscape(String(val ?? ''));
    const hasOldPrice = Boolean(data.oldPrice);

    return `
      <article class="card" data-product-id="${esc(data.id)}">
        <div class="card__media">
          <img src="${esc(data.img)}" alt="${esc(data.fullname)}" loading="lazy">
        </div>
        <div class="card__body">
          <h3 class="card__title">${esc(data.fullname)}</h3>
          <div class="card__price">
            ${esc(data.price)}${
              hasOldPrice
                ? ' <small class="old">' + esc(data.oldPrice) + '</small>'
                : ''
            }
          </div>
          <div class="card__short">${esc(data.short)}</div>
          <div class="card__specs">${data.specsHtml || ''}</div>
          <div class="card__controls">
            <button data-role="buy" class="btn">В корзину</button>
          </div>
        </div>
      </article>`;
  }

  async createCard(product = {}) {
    const data = this._createCardData(product);
    if (!data) return null;

    let html = '';
    try {
      html = (await this.renderTemplate('cardVertical', data)) || '';
    } catch (e) {
      this._log(`renderTemplate error: ${e}`, 'WARN');
    }

    if (!html) {
      html = this._buildVerticalCardHtml(data);
    }

    let node = null;
    try {
      node = this.createElementFromHTML(html);
    } catch (e) {
      this._log(`createElementFromHTML error: ${e}`, 'ERROR');
      return null;
    }

    if (!node) return null;
    node.setAttribute('data-product-id', String(data.id));

    if (Array.isArray(data.imgArray) && data.imgArray.length > 1) {
      try {
        this._attachImageGallery(node, data.imgArray);
      } catch (e) {
        this._log(`attachImageGallery error: ${e}`, 'WARN');
      }
    }

	// Bindings + state are applied ONLY where the card DOM is created.
	this.shopMatic.card.mount(node, product, 'VERTICAL');

    return node;
  }

  async renderCardInto(rootEl, product = {}, options = {}) {
    if (!rootEl) return null;

    const {
      position = 'append',
      refNode = null,
      animate = true,
    } = options;

    const card = await this.createCard(product);
    if (!card) return null;

    if (animate) {
      card.classList.add('card--pending');
    }

    try {
      switch (position) {
        case 'prepend':
          rootEl.prepend(card);
          break;
        case 'before':
          refNode && refNode.parentNode
            ? refNode.parentNode.insertBefore(card, refNode)
            : rootEl.appendChild(card);
          break;
        case 'after':
          refNode && refNode.parentNode
            ? refNode.parentNode.insertBefore(card, refNode.nextSibling)
            : rootEl.appendChild(card);
          break;
        case 'replace':
          if (refNode && refNode.parentNode) {
            refNode.replaceWith(card);
          } else {
            rootEl.appendChild(card);
          }
          break;
        case 'append':
        default:
          rootEl.appendChild(card);
      }
    } catch (e) {
      this._log(`renderCardInto insert error: ${e}`, 'ERROR');
      return null;
    }

    if (animate) {
      requestAnimationFrame(() => {
        card.classList.add('card--visible');
        card.classList.remove('card--pending');
      });
    }

    return card;
  }

  async _buildCardsFragment(list = [], { animate = true } = {}) {
    const items = Array.isArray(list) ? list.filter(Boolean) : [];
    const frag = document.createDocumentFragment();
    const createdCards = [];

    if (!items.length) {
      return { fragment: frag, cards: createdCards };
    }

    const promises = items.map((p) =>
      this.createCard(p).catch((e) => {
        this._log(`createCard failed: ${e}`, 'WARN');
        return null;
      }),
    );

    const cards = await Promise.all(promises);

    for (const card of cards) {
      if (!card) continue;
      if (animate) {
        card.classList.add('card--pending');
      }
      frag.appendChild(card);
      createdCards.push(card);
    }

    return { fragment: frag, cards: createdCards };
  }

  async renderListVertical(list = [], rootEl, options = {}) {
    if (!rootEl) return;

    const { clear = true, animate = true } = options;

    if (clear) {
      rootEl.innerHTML = '';
    }

    const { fragment, cards } = await this._buildCardsFragment(list, {
      animate,
    });

    if (!cards.length) {
      return;
    }

    rootEl.appendChild(fragment);

    if (animate) {
      requestAnimationFrame(() => {
        for (const card of cards) {
          card.classList.add('card--visible');
          card.classList.remove('card--pending');
        }
      });
    }
  }

  _attachImageGallery(node, imgArray = []) {
    if (!node || !Array.isArray(imgArray) || imgArray.length <= 1) return;

    const media = node.querySelector('.card__media');
    if (!media) return;

    media.classList.add('multi-image');

    const overlay = document.createElement('div');
    overlay.className = 'card__image-overlay';

    const dots = document.createElement('div');
    dots.className = 'card__image-dots';

    const imgEl = media.querySelector('img');

    let activeIndex = 0;
    let touchStartX = 0;
    let touchStartTime = 0;
    let touchMoveX = 0;
    let isSwiping = false;
    const isMobile = this.shopMatic?.deviceUtil?.isTouchDevice;

    const updateImage = (index) => {
      if (index < 0 || index >= imgArray.length) return;
      activeIndex = index;

      if (imgEl) {
        imgEl.classList.add('fade');
        imgEl.style.transform = 'translateX(0)';

        setTimeout(() => {
          imgEl.src = imgArray[index];
          imgEl.onload = () => imgEl.classList.remove('fade');
        }, 120);
      }

      dots.querySelectorAll('.dot').forEach((d, i) => {
        d.classList.toggle('active', i === index);
      });
    };

    const handleSwipeStart = (e) => {
      if (!e.touches?.[0]) return;
      touchStartX = e.touches[0].clientX;
      touchStartTime = Date.now();
      isSwiping = true;
      if (imgEl) imgEl.style.transition = 'none';
    };

    const handleSwipeMove = (e) => {
      if (!isSwiping || !imgEl) return;
      const touchX = e.changedTouches?.[0]?.clientX;
      if (typeof touchX !== 'number') return;
      touchMoveX = touchX - touchStartX;
      imgEl.style.transform = `translateX(${touchMoveX}px)`;
      e.preventDefault();
    };

    const handleSwipeEnd = (e) => {
      if (!isSwiping || !imgEl) return;

      const touchEndX = e.changedTouches?.[0]?.clientX;
      if (typeof touchEndX !== 'number') return;

      const deltaX = touchStartX - touchEndX;
      const swipeDuration = Date.now() - touchStartTime;

      isSwiping = false;
      imgEl.style.transition = 'transform 0.3s ease';
      imgEl.style.transform = 'translateX(0)';

      if (Math.abs(deltaX) > 50 && swipeDuration < 500) {
        if (deltaX > 0 && activeIndex < imgArray.length - 1) {
          updateImage(activeIndex + 1);
        } else if (deltaX < 0 && activeIndex > 0) {
          updateImage(activeIndex - 1);
        }
      }
    };

    const createDotsAndZones = () => {
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
    };

    if (isMobile) {
      media.addEventListener('touchstart', handleSwipeStart, {
        passive: true,
      });
      media.addEventListener('touchmove', handleSwipeMove, {
        passive: false,
      });
      media.addEventListener('touchend', handleSwipeEnd, {
        passive: true,
      });
    }

    createDotsAndZones();

    media.appendChild(overlay);
    media.after(dots);
  }
}