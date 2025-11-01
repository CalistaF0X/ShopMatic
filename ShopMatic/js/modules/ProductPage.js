import { makeSpecHtmlPreview } from './utils.js';
import { Gallery } from './Gallery.js';

export class ProductPage {
  constructor(shop, opts = {}) {
    if (!shop) throw new Error('ProductPage requires ShopMatic instance');
    this.shop = shop;
    this.productService = shop.productService;
    this.cart = shop.cart;
    this.favorites = shop.favorites;
    this.renderer = shop.renderer;
    this.notifications = shop.notifications;
    this.wishlist = shop.wishlistModule || null;

    this.opts = Object.assign({
      templateId: null,
      relatedLimit: 6,
      cardTemplateKey: 'cardVertical'
    }, opts);

    this._stripeTimers = new WeakMap();
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
  
  // Инициализация галереи — вызывается из _bindListeners
 _initGallery() {
    if (!this.container) return;
    const galleryRoot = this.container.querySelector('.product-gallery');
    if (!galleryRoot) return;

    const product = this.productService.findById(this.currentProductId) || {};
    const photos = JSON.parse(product.picture);

    try {
      this.gallery = new Gallery(galleryRoot, photos);
    } catch (err) {
      console.warn('Gallery initialization failed', err);
    }
  }

  async render(productId, container = this.shop.foxEngine.replaceData.contentBlock) {
	this.pageTemplate = await this.shop.foxEngine.loadTemplate('/templates/'+this.shop.foxEngine.replaceData.template+'/foxEngine/product/productPage.tpl');
    const el = (typeof container === 'string') ? document.querySelector(container) : container;
    if (!el) throw new Error('container element required');
    this.container = el;
    this.currentProductId = String(productId);
    let product = null;
    try {
      product = await this.productService.fetchById(productId);
    } catch (e) {
      product = null;
    }
	
	console.log(product);

    if (!product) {
      try { this._renderNotFound(); } catch (e) { console.error('_renderNotFound error', e); }
      return;
    }
    try {
      if (this.cart && typeof this.cart.loadFromStorage === 'function') {
        try { this.cart.loadFromStorage(); } catch (_) {}
      }
      const html = await this._buildHtml(product);
      this.container.innerHTML = html;
    } catch (e) {
      console.error('_buildHtml error', e);
      try { this._renderNotFound(); } catch (ee) { console.error('_renderNotFound fallback error', ee); }
      return;
    }
    try {
      this._syncFavButton();
      this._syncQtyControls();
      this._syncWishlistButton();
      this._bindListeners();
    } catch (e) {
      console.error('UI sync/bind error', e);
    }
    try {
      await this._renderRelated(product);
    } catch (e) {
      console.error('_renderRelated error', e);
    }
  }

  destroy() {
    if (!this.container) return;
    this._unbindListeners();
    this.container = null;
    this.currentProductId = null;
  }

  async _renderNotFound() {
    if (!this.container) return;
    this.container.innerHTML = await this.shop.foxEngine.loadTemplate('/templates/'+this.shop.foxEngine.replaceData.template+'/foxEngine/product/notFound.tpl');
    const back = this.container.querySelector('[data-action="back"]');
    if (back) back.addEventListener('click', this._bound.onBackClick);
  }

async _buildHtml(p) {
  // mark viewed (best-effort)
  try { this.shop.storage.addViewed(p); } catch (_) {}

  // find qty already in cart (if any)
  const cartItem = (this.cart && Array.isArray(this.cart.cart))
    ? this.cart.cart.find(item => String(item.name) === String(p.name))
    : null;
  const qtyFromCart = cartItem ? Number(cartItem.qty || 0) : 0;

  // Normalize photos/images array early (avoid using photos before defined)
  const photos = Array.isArray(p.images)
    ? p.images.slice()
    : (p.image ? [p.image] : (p.picture ? [p.picture] : []));

  // Ensure we have at least one main image value
  const mainImage = (photos && photos.length > 0) ? photos[0] : (p.picture || p.image || '');

  // Pre-generate thumbs HTML (safe escaping)
  const thumbsHtml = (photos && photos.length > 0)
    ? photos.map((src, i) => {
        const esc = this._escapeAttr(src);
        const active = i === 0 ? ' active' : '';
        // button includes data-thumb-index used by gallery initializer
        return `<button class="thumb-btn${active}" data-thumb-index="${i}" aria-label="thumb-${i}"><img src="${esc}" alt="" loading="lazy" /></button>`;
      }).join('')
    : '';

  // Ensure categories are loaded (best-effort)
  try {
    await this.shop.foxEngine.shopMatic.productService.fetchCategories();
  } catch (_) {
    // ignore fetch failures — categories are optional for template
  }

  // Build template data object
  console.log(p);
  const tplData = {
    name: p.name,
    fullname: p.title ?? p.name ?? p.fullname ?? '',
    price: this._formatPrice(p.price),
    oldPrice: p.oldPrice ? this._formatPrice(p.oldPrice) : '',
    short: p.short ?? '',
    long: p.long ?? '',
    qty: qtyFromCart > 0 ? qtyFromCart : 1,
    mainImage: mainImage,
    images: photos,
    picture: p.picture ?? mainImage,
    discountPercent: '',
    thumbs: thumbsHtml,
    brandName: p.brandName,
    categoryName: '<small>' + p.categoryName + '</small>',
	brand: p.brand,
    category: p.category ?? '',
    specs: (typeof makeSpecHtmlPreview === 'function') ? makeSpecHtmlPreview(p.specs || {}) : ''
  };

  // Try template replacement using provided templateId or fox.replaceTextInTemplate
  const fox = this.shop.foxEngine;
  try {
    if (this.opts.templateId) {
      const t = document.getElementById(this.opts.templateId);
      if (t && 'content' in t) {
        const raw = t.innerHTML || '';
        return this._replaceTokens(raw, tplData);
      }
    }
    if (fox && typeof fox.replaceTextInTemplate === 'function') {
      // allow host engine to perform replacement (async)
      const replaced = await fox.replaceTextInTemplate(this.pageTemplate, tplData);
      // If replacement produced a string, return it
      if (typeof replaced === 'string' && replaced.length) return replaced;
    }
  } catch (e) {
    // fallback to manual replacement below
    console.warn('ProductPage: template replacement failed', e);
  }

  // If engine/template not available — do manual token replacement.
  // Use safe escaping for attributes and HTML for fields that may contain markup.
  const pictureToken = this._escapeAttr(tplData.picture || tplData.mainImage);
  const nameToken = this._escapeAttr(tplData.name);
  const fullnameHtml = escapeHtml(tplData.fullname);
  const priceToken = tplData.price || '';
  const oldPriceToken = tplData.oldPrice || '';
  const stockToken = String(p.stock ?? p.qty ?? 0);
  const qtyToken = String(tplData.qty);
  const specsHtml = tplData.specs || '';
  const thumbsToken = tplData.thumbs || '';
  const noticesToken = '';

  return this.pageTemplate
    .replace(/\{name\}/g, nameToken)
    .replace(/\{fullname\}/g, fullnameHtml)
    .replace(/\{picture\}/g, pictureToken)
    .replace(/\{price\}/g, priceToken)
    .replace(/\{oldPrice\}/g, oldPriceToken)
    .replace(/\{stock\}/g, stockToken)
    .replace(/\{qty\}/g, qtyToken)
    .replace(/\{specs\}/g, specsHtml)
    .replace(/\{thumbs\}/g, thumbsToken)
    .replace(/\{notices\}/g, noticesToken);
}


  _bindListeners() {
    if (!this.container) return;
    const addBtn = this.container.querySelector('[data-action="add-to-cart"], .add-to-cart, .btn-yellow');
    if (addBtn) addBtn.addEventListener('click', this._bound.onAddClick);
    const fav = this.container.querySelector('.fav-toggle');
    if (fav) fav.addEventListener('click', this._bound.onFavClick);
    const wish = this.container.querySelector('.wishlist-toggle');
    if (wish) wish.addEventListener('click', this._bound.onWishlistClick);
    const qty = this.container.querySelector('.qty-input');
    if (qty) qty.addEventListener('input', this._bound.onQtyInput);
    const qtyIncrBtns = this.container.querySelectorAll('.qty-incr');
    qtyIncrBtns.forEach(b => b.addEventListener('click', this._bound.onQtyIncr));
    const qtyDecrBtns = this.container.querySelectorAll('.qty-decr');
    qtyDecrBtns.forEach(b => b.addEventListener('click', this._bound.onQtyDecr));
    const back = this.container.querySelector('[data-action="back"]');
    if (back) back.addEventListener('click', this._bound.onBackClick);
    const thumbs = this.container.querySelectorAll('.thumb-btn');
    thumbs.forEach(btn => btn.addEventListener('click', (ev) => {
      const idx = parseInt(ev.currentTarget.getAttribute('data-thumb-index'), 10) || 0;
      const photos = Array.isArray(this.productService.findById(this.currentProductId)?.images) ? this.productService.findById(this.currentProductId).images : [];
      const src = photos[idx];
      const main = this.container.querySelector('.product-main-img');
      if (main && src) main.src = src;
    }));
    const sizeBtns = this.container.querySelectorAll('.size-btn');
    sizeBtns.forEach(btn => btn.addEventListener('click', (ev) => {
      sizeBtns.forEach(b => b.classList.remove('active'));
      ev.currentTarget.classList.add('active');
    }));
    window.addEventListener('cart:updated', this._bound.onCartUpdated);
	// Инициализация галереи (работает с сгенерированными {thumbs})
try { this._initGallery(); } catch (e) { console.warn('gallery init failed', e); }

  }

  _unbindListeners() {
    if (!this.container) return;
    const addBtn = this.container.querySelector('[data-action="add-to-cart"], .add-to-cart, .btn-yellow');
    if (addBtn) addBtn.removeEventListener('click', this._bound.onAddClick);
    const fav = this.container.querySelector('.fav-toggle');
    if (fav) fav.removeEventListener('click', this._bound.onFavClick);
    const wish = this.container.querySelector('.wishlist-toggle');
    if (wish) wish.removeEventListener('click', this._bound.onWishlistClick);
    const qty = this.container.querySelector('.qty-input');
    if (qty) qty.removeEventListener('input', this._bound.onQtyInput);
    const qtyControls = this.container.querySelectorAll('.qty-controls');
    qtyControls.forEach(node => {
      try { node.replaceWith(node.cloneNode(true)); } catch (_) {}
    });
    const thumbs = this.container.querySelectorAll('.thumb-btn'); thumbs.forEach(t => t.replaceWith(t.cloneNode(true)));
    const sizeBtns = this.container.querySelectorAll('.size-btn'); sizeBtns.forEach(b => b.replaceWith(b.cloneNode(true)));
    const back = this.container.querySelector('[data-action="back"]');
    if (back) back.removeEventListener('click', this._bound.onBackClick);
    window.removeEventListener('cart:updated', this._bound.onCartUpdated);
  }

  _onAddClick() {
    try {
      const qtyEl = this.container.querySelector('.qty-input');
      const qty = Math.max(1, parseInt(qtyEl && qtyEl.value || '1', 10));
      const pid = this.currentProductId;
      if (!pid) return;
      const available = this.shop.cart ? (typeof this.shop.cart._computeAvailableStock === 'function' ? this.shop.cart._computeAvailableStock(pid) : (this.productService.findById(pid)?.stock || 0)) : (this.productService.findById(pid)?.stock || 0);
      if (available <= 0) {
        this.notifications.show('Невозможно добавить: нет доступного остатка.', { duration: 3000 });
        return;
      }
      const toAdd = Math.min(qty, available);
      if (this.cart && typeof this.cart.add === 'function') {
        this.cart.add(pid, toAdd);
      }
      this._syncQtyControls();
    } catch (err) {
      console.error('_onAddClick error', err);
      this.notifications.show('Ошибка при добавлении в корзину', { duration: 3000 });
    }
  }

  _onFavClick() {
    try {
      const pid = this.currentProductId;
      if (!pid || !this.favorites || typeof this.favorites.toggle !== 'function') return;
      this.favorites.toggle(pid);
      this._syncFavButton();
      this.notifications.show(this.favorites.isFavorite(pid) ? 'Товар добавлен в избранное' : 'Товар удалён из избранного', { duration: 1500 });
    } catch (err) { console.warn(err); }
  }

  _onWishlistClick() {
    if (!this.wishlist) { this.notifications.show('Вишлист не настроен', { duration: 1400 }); return; }
    const pid = this.currentProductId;
    if (!pid) return;
    try {
      if (typeof this.wishlist.toggle === 'function') this.wishlist.toggle(pid);
      else if (typeof this.wishlist.add === 'function') this.wishlist.add(pid);
      this._syncWishlistButton();
      this.notifications.show('Обновлено в вишлисте', { duration: 1200 });
    } catch (err) { console.warn(err); }
  }

  _onQtyInput(e) {
    const qty = parseInt(e.target.value || '1', 10) || 1;
    const pid = this.currentProductId;
    const product = this.productService.findById(pid);
    const available = product ? (product.stock ?? product.qty ?? 0) : 0;
    if (qty > available) {
      e.target.value = String(available || 1);
      this.notifications.show(`Максимум доступно: ${available}`, { duration: 1400 });
    }
    const cartItem = (this.cart && Array.isArray(this.cart.cart)) ? this.cart.cart.find(i => String(i.name) === String(pid)) : null;
    if (cartItem && this.cart && typeof this.cart.changeQty === 'function') {
      const newQty = Math.max(1, Math.min(available || 1, parseInt(e.target.value || '1', 10)));
      try { this.cart.changeQty(pid, newQty); } catch (err) {}
    }
    this._syncQtyControls();
  }

  _onQtyIncr(e) {
    try {
      const ctrl = e.currentTarget?.closest ? e.currentTarget.closest('.qty-controls') : null;
      const qtyEl = ctrl ? ctrl.querySelector('.qty-input') : this.container.querySelector('.qty-input');
      if (!qtyEl) return;
      const pid = this.currentProductId;
      const product = this.productService.findById(pid);
      const stock = product ? (product.stock ?? product.qty ?? 0) : 0;
      let cur = parseInt(qtyEl.value || '1', 10) || 1;
      const target = Math.min(stock || cur + 1, cur + 1);
      if (target === cur && stock > 0 && cur >= stock) {}
      else qtyEl.value = String(target);
      if (this.cart && typeof this.cart.changeQty === 'function') {
        try { this.cart.changeQty(pid, Number(qtyEl.value)); } catch (_) {}
      }
      this._syncQtyControls();
    } catch (err) { console.error('_onQtyIncr', err); }
  }

  _onQtyDecr(e) {
    try {
      const ctrl = e.currentTarget && typeof e.currentTarget.closest === 'function' ? e.currentTarget.closest('.qty-controls') : null;
      const qtyEl = ctrl ? ctrl.querySelector('.qty-input') : this.container.querySelector('.qty-input');
      if (!qtyEl) return;
      const pid = this.currentProductId;
      let cur = parseInt(qtyEl.value || '1', 10) || 1;
      const target = Math.max(0, cur - 1);
      qtyEl.value = String(target);
      if (target === 0) {
        if (this.cart && typeof this.cart.remove === 'function') {
          try { this.cart.remove(String(pid)); } catch (err) { console.warn('cart.remove threw', err); }
        } else if (this.cart && Array.isArray(this.cart.cart)) {
          try {
            const idx = this.cart.cart.findIndex(i => String(i.name) === String(pid));
            if (idx >= 0) this.cart.cart.splice(idx, 1);
            if (typeof this.cart.save === 'function') {
              try { this.cart.save(); } catch (_) {}
            }
          } catch (err) { console.warn('fallback cart remove error', err); }
        }
        try {
          if (this.notifications && typeof this.notifications.show === 'function') {
            this.notifications.show('Товар удалён из корзины', { duration: 1500 });
          }
        } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('cart:updated', { detail: { changedIds: [pid] } })); } catch (_) {}
      } else {
        if (this.cart && typeof this.cart.changeQty === 'function') {
          try { this.cart.changeQty(String(pid), Number(target)); } catch (err) { console.warn('cart.changeQty threw', err); }
        } else if (this.cart && Array.isArray(this.cart.cart)) {
          try {
            const idx = this.cart.cart.findIndex(i => String(i.name) === String(pid));
            if (idx >= 0) {
              this.cart.cart[idx].qty = Number(target);
              if (typeof this.cart.save === 'function') {
                try { this.cart.save(); } catch (_) {}
              }
              try { window.dispatchEvent(new CustomEvent('cart:updated', { detail: { changedIds: [pid] } })); } catch (_) {}
            }
          } catch (err) { console.warn('fallback cart changeQty error', err); }
        }
      }
      this._syncQtyControls();
    } catch (err) {
      console.error('_onQtyDecr', err);
    }
  }

  _onBackClick() {
    if (window.history && window.history.length > 1) { window.history.back(); return; }
    if (this.container) this.container.innerHTML = '';
  }

  _onCartUpdated(e) {
    try { this._syncQtyControls(); } catch (err) {}
  }

  _syncFavButton() {
    if (!this.container || !this.favorites) return;
    const btn = this.container.querySelector('.fav-toggle');
    if (!btn) return;
    const isFav = this.favorites.isFavorite ? this.favorites.isFavorite(String(this.currentProductId)) : false;
    btn.textContent = isFav ? '♥ В избранном' : '♡ В избранное';
  }

  _animateStripes(btn, duration = 1800) {
    if (!btn || !(btn instanceof HTMLElement)) return;
    const timers = this._stripeTimers;
    const prev = timers.get(btn);
    if (prev) {
      clearTimeout(prev);
      timers.delete(btn);
    }
    btn.classList.add('with-stripes', 'active');
    btn.classList.remove('hidden');
    const t = setTimeout(() => {
      btn.classList.add('hidden');
      const cleanup = setTimeout(() => {
        btn.classList.remove('with-stripes', 'hidden');
        timers.delete(btn);
        clearTimeout(cleanup);
      }, 300);
      timers.delete(btn);
    }, duration);
    timers.set(btn, t);
  }

  _syncWishlistButton() {
    if (!this.container || !this.wishlist) return;
    const btn = this.container.querySelector('.wishlist-toggle');
    if (!btn) return;
    let isIn = false;
    try {
      if (typeof this.wishlist.isIn === 'function') isIn = this.wishlist.isIn(this.currentProductId);
      if (typeof this.wishlist.has === 'function') isIn = this.wishlist.has(this.currentProductId);
    } catch (e) {}
    btn.textContent = isIn ? 'В вишлисте' : 'В вишлист';
  }

_syncQtyControls() {
  if (!this.container) return;
  const pid = this.currentProductId;
  const product = this.productService.findById(pid);
  const stock = product ? (Number(product.stock ?? product.qty ?? 0) || 0) : 0;
  const stockEl = this.container.querySelector('.stock-count');
  
  if (stockEl) stockEl.textContent = String(stock);

  const controlBar = this.container.querySelector('.qty-controls');
  const qtyEl = this.container.querySelector('.qty-input');
  const btnPlus = this.container.querySelector('.qty-incr');
  const btnMinus = this.container.querySelector('.qty-decr');
  const addBtn = this.container.querySelector('[data-action="add-to-cart"], .add-to-cart, .btn-yellow');
  const buyNowBtn = this.container.querySelector('[data-action="buy-now"]');
  
  // Проверка на наличие товара в корзине
  const cartItem = (this.cart && Array.isArray(this.cart.cart)) ? this.cart.cart.find(i => String(i.name) === String(pid)) : null;
  const cartQty = cartItem ? Number(cartItem.qty || 0) : 0;

  if (qtyEl) {
    qtyEl.setAttribute('min', '1');
    qtyEl.setAttribute('max', String(Math.max(1, stock)));
    let cur = parseInt(qtyEl.value || (cartQty > 0 ? String(cartQty) : '1'), 10) || 1;

    if (cartQty > 0) {
      // Если товар уже в корзине, скрываем кнопку "Купить сейчас" и показываем "Корзина"
      cur = cartQty;
      if (buyNowBtn) buyNowBtn.style.display = 'none';
      if (controlBar) controlBar.style.display = 'flex';
      
      if (addBtn) {
        // Убираем старый обработчик и добавляем новый для перехода в корзину
        try { addBtn.removeEventListener('click', this._bound.onAddClick); } catch (_) {}
        addBtn.onclick = () => { try { this.shop.foxEngine?.page?.loadPage('cart'); } catch (_) {}; };
        addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" class="_1w4N_" width="16" height="16"><path fill="#21201F" fill-rule="evenodd" d="M0 5.752a.5.5 0 0 1 .5-.5h8.65L5.304 1.406a.5.5 0 0 1 0-.707l.342-.343a.5.5 0 0 1 .708 0L12 6.002 6.354 11.65a.5.5 0 0 1-.708 0l-.342-.343a.5.5 0 0 1 0-.707L9.15 6.752H.5a.5.5 0 0 1-.5-.5v-.5Z" clip-rule="evenodd"></path></svg>
        Корзина`;
      }
    } else {
      // Если товара нет в корзине, показываем кнопку "В Корзину"
      if (buyNowBtn) buyNowBtn.style.display = 'flex';
      if (controlBar) controlBar.style.display = 'none';
      
      if (addBtn) {
        try { addBtn.onclick = null; } catch (_) {}
        try { addBtn.addEventListener('click', this._bound.onAddClick); } catch (_) {}
        addBtn.innerHTML = 'В Корзину';
      }
    }

    // Убедимся, что количество не больше доступного на складе
    if (stock <= 0) {
      qtyEl.value = '0';
      qtyEl.setAttribute('disabled', 'true');
      if (addBtn) { addBtn.setAttribute('disabled', 'true'); addBtn.classList.add('disabled'); }
    } else {
      if (cur > stock) cur = stock;
      qtyEl.value = String(cur);
      qtyEl.removeAttribute('disabled');
      if (addBtn) { addBtn.removeAttribute('disabled'); addBtn.classList.remove('disabled'); }
    }
  }

  try {
    const curNum = qtyEl ? (parseInt(qtyEl.value || '1', 10) || 1) : 1;
    if (btnPlus) {
      const disablePlus = stock <= 0 || curNum >= stock;
      btnPlus.disabled = disablePlus;
      disablePlus ? btnPlus.setAttribute('aria-disabled', 'true') : btnPlus.removeAttribute('aria-disabled');
    }
    if (btnMinus) {}
  } catch (e) {}
}

  async createCard(product = {}) {
    const p = product || {};
    const id = String(p.name ?? p.id ?? p.productId ?? '');
    const priceText = this._formatPrice(p.price ?? 0);
    const hasOldPrice = (p.oldPrice && Number(p.oldPrice) > 0);
    const badgeText = (Number(p.stock) > 0) ? 'В наличии' : 'Под заказ';
    const specsHtml = makeSpecHtmlPreview ? makeSpecHtmlPreview(p.specs || p.attributes || {}) : '';
    const data = {
      id,
      fullname: p.fullname ?? p.title ?? p.name ?? '',
      img: p.picture ?? p.image ?? '/assets/no-image.png',
      short: p.short ?? '',
      price: priceText,
      oldPrice: hasOldPrice ? this._formatPrice(p.oldPrice) : '',
      badgeText,
      stock: Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0,
      specsHtml
    };
    let html = '';
    const fox = this.shop.foxEngine;
    try {
      if (fox && fox.templateCache && fox.templateCache[this.opts.cardTemplateKey]) {
        html = await fox.replaceTextInTemplate(fox.templateCache[this.opts.cardTemplateKey], data);
      }
    } catch (e) {
      if (fox && typeof fox.log === 'function') fox.log('ProductPage.createCard template error: ' + e, 'ERROR');
      html = '';
    }
    if (!html) {
      const escTitle = escapeHtml(data.fullname);
      const escImg = escapeHtml(data.img);
      const escPrice = escapeHtml(data.price);
      const escOld = escapeHtml(data.oldPrice);
      const escShort = escapeHtml(data.short);
      const escSpecs = data.specsHtml || '';
      html = `
        <article class="card product-card" data-product-id="${escapeHtml(id)}">
          <div class="card__media"><img src="${escImg}" alt="${escTitle}" loading="lazy"></div>
          <div class="card__body p-2">
            <h3 class="card__title small">${escTitle}</h3>
            <div class="card__price">${escPrice}${hasOldPrice ? ' <small class="old">' + escOld + '</small>' : ''}</div>
            <div class="card__short small text-muted">${escShort}</div>
            <div class="card__specs small">${escSpecs}</div>
            <div class="card__controls mt-2"><button data-role="buy" class="btn btn-sm btn-outline-primary">В корзину</button></div>
          </div>
        </article>`;
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const node = wrapper.firstElementChild || wrapper;
    try { if (node && node.setAttribute) node.setAttribute('data-product-id', String(id)); } catch (_) {}
    return node;
  }

  async _renderCartVertical(list = [], rootEl) {
    if (!rootEl) return;
    rootEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    const cards = await Promise.all((Array.isArray(list) ? list : []).map(p => this.createCard(p)));
    for (const card of cards) {
      if (!card) continue;
      card.style.opacity = '0';
      card.style.transition = 'opacity .22s ease';
      frag.appendChild(card);
      requestAnimationFrame(() => { card.style.opacity = '1'; });
    }
    rootEl.appendChild(frag);
  }

  updateProductCardFavState(rootEl, id, isFav) {
    if (!rootEl || !id) return;
    const esc = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') ? CSS.escape(String(id)) : String(id).replace(/"/g, '\\"');
    const selector = `[data-product-id="${esc}"]`;
    const card = rootEl.querySelector && rootEl.querySelector(selector);
    if (!card) return;
    const favBtn = card.querySelector('.fav-btn, .fav-toggle, [data-role="fav"]');
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

  async _renderRelated(product) {
    if (!this.container) return;
    const relatedRoot = this.container.querySelector('[data-related]');
    if (!relatedRoot) return;
    try {
      const all = Array.isArray(this.productService.getProducts()) ? this.productService.getProducts() : [];
      let related = all.filter(p => p && p.id != product.id && p.category === product.category);
      if (!related.length) related = all.filter(p => p && p.id != product.id);
      related = related.slice(0, this.opts.relatedLimit);
      await this._renderCartVertical(related, relatedRoot);
      related.forEach(p => {
        const isFav = this.favorites && typeof this.favorites.isFavorite === 'function' ? this.favorites.isFavorite(String(p.id)) : false;
        this.updateProductCardFavState(relatedRoot, p.id, isFav);
      });
    } catch (err) {
      console.warn('renderRelated failed', err);
    }
  }

  _replaceTokens(template, data = {}) {
    return String(template).replace(/\{\{\s*([^}]+)\s*\}\}/g, (m, key) => {
      const v = (data && Object.prototype.hasOwnProperty.call(data, key)) ? data[key] : '';
      return (v == null) ? '' : String(v);
    });
  }

  _formatPrice(v) {
    if (v == null) return '';
    if (typeof v === 'number') {
      try {
        return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v);
      } catch (e) { return String(v); }
    }
    return String(v);
  }

  _escape(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  _escapeAttr(str) {
    if (str == null) return '';
    return String(str).replace(/"/g,'&quot;');
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
