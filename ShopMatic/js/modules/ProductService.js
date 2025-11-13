import { escapeHtml as _escapeHtml } from './utils.js';

/**
 * ProductService
 * @author Calista Verner
 *
 * Этот класс инкапсулирует логику загрузки и нормализации
 * продуктов, категорий и брендов. Оптимизированная версия
 * сохраняет прежний интерфейс (публичные методы и поля),
 * упрощает внутренние процессы и повышает читаемость. Используются
 * вспомогательные методы для сокращения дублирования и обеспечения
 * единообразия.
 */
export class ProductService {
  /**
   * Статические текстовые сообщения для вывода пользователю
   * @type {Readonly<Record<string,string>>}
   */
  static UI_MESSAGES = Object.freeze({
    ERROR_NO_ENGINE: 'Интеграция с бекендом недоступна',
    ERROR_TIMEOUT: 'Запрос продукта превысил время ожидания',
    LOAD_PRODUCTS_ERROR: 'Ошибка загрузки списка товаров',
    FETCH_BY_ID_ERROR: 'Ошибка получения данных товара',
    FETCH_CATEGORIES_ERROR: 'Ошибка получения категорий',
    FILL_CATEGORIES_WARN: 'ProductService.fillCategories: ошибка при заполнении select',
    ALL_CATEGORIES_OPTION: 'Все категории',
    ALL_BRANDS_OPTION: 'Все бренды',
    SUBSCRIBE_ARG_ERROR: 'subscribe ожидает функцию',
    UPSERT_ERROR: 'Ошибка добавления/обновления товара'
  });

  /**
   * @param {any} foxEngine Экземпляр движка отправки запросов
   * @param {Object} [opts]
   * @param {Object} [opts.endpoints] Переопределения имён эндпоинтов
   * @param {number} [opts.timeoutMs] Таймаут запросов в миллисекундах
   * @param {boolean} [opts.debug] Включить логирование
   */
  constructor(foxEngine, opts = {}) {
    if (!foxEngine) throw new TypeError('ProductService requires foxEngine');
    this.foxEngine = foxEngine;
    // деструктуризация настроек с дефолтами
    const {
      endpoints = {
        products: 'getProducts',
        productById: 'getProduct',
        categories: 'getCategories',
        brands: 'getBrands'
      },
      timeoutMs = 7000,
      debug = false
    } = opts;
    this.opts = { endpoints, timeoutMs, debug };
    /** @type {Array<any>} */
    this.products = [];
    /** @type {Map<string,any>} */
    this._productMap = new Map();
    /** @type {Map<string,string>} */
    this._categoriesMap = new Map();
    /** @type {Map<string,string>} */
    this._brandsMap = new Map();
    /** @type {Set<Function>} */
    this._subscribers = new Set();
  }

  /* ---------------------- utils ---------------------- */

  /**
   * Подстановка значений в строку сообщений
   * @param {string} key
   * @param {Record<string,string|number>} vars
   * @returns {string}
   */
  _msg(key, vars = {}) {
    const tpl = (this.constructor && this.constructor.UI_MESSAGES && this.constructor.UI_MESSAGES[key]) || '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) => Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m);
  }

  /**
   * Нормализует идентификатор в строку
   * @param {any} v
   * @returns {string}
   */
  _normalizeId(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim();
  }

  /**
   * Логирование в debug режиме
   * @param {...any} args
   */
  _log(...args) {
    if (!this.opts.debug) return;
    const logger = typeof this.foxEngine.log === 'function' ? this.foxEngine.log.bind(this.foxEngine) : console.debug;
    try { logger(...args); } catch (e) { console.debug(...args); }
  }

  /**
   * Безопасный вызов удалённого метода с таймаутом
   * @param {any} payload
   * @param {string} expect
   * @returns {Promise<any>}
   */
  async _safeCall(payload = {}, expect = 'JSON') {
    const call = this.foxEngine.sendPostAndGetAnswer(payload, expect);
    const timeout = Number(this.opts.timeoutMs) || 7000;
    if (!timeout || timeout <= 0) return call;
    return Promise.race([
      call,
      new Promise((_, rej) => setTimeout(() => rej(new Error(this._msg('ERROR_TIMEOUT'))), timeout))
    ]);
  }

  /**
   * Извлекает массив из ответа бекенда по предпочтительному списку ключей.
   * @param {any} res
   * @param {Array<string>} prefer
   * @returns {Array<any>}
   */
  _extractArray(res, prefer = ['items', 'products', 'data', 'categories', 'brands', 'list']) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (typeof res !== 'object') return [];
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
  _notifySubscribers(change = { type: 'set', changedIds: [] }) {
    for (const fn of this._subscribers) {
      try { fn(change); } catch (e) { this._log('subscriber error', e); }
    }
  }

  /* ---------------------- normalization helpers ---------------------- */

  /**
   * Разбирает и нормализует поля категории из сырого продукта
   * @param {Object} raw
   * @returns {{ key: string, name: string }}
   */
  _parseCategory(raw) {
    const rawCat = raw.category ?? raw.cat ?? raw.categoryId ?? '';
    const key = this._normalizeId(rawCat);
    const name = String(raw.categoryName ?? raw.categoryFullname ?? '').trim();
    return { key, name };
  }

  /**
   * Разбирает и нормализует поля бренда из сырого продукта
   * @param {Object} raw
   * @returns {{ key: string, name: string }}
   */
  _parseBrand(raw) {
    let rawBrand = raw.brand ?? raw.brandId ?? '';
    if (typeof rawBrand === 'object') rawBrand = rawBrand.id ?? rawBrand.key ?? rawBrand.name ?? '';
    const key = this._normalizeId(rawBrand);
    const name = String(raw.brandName ?? raw.brandFullname ?? '').trim();
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
  async _resolveBrandAndCategoryNames(categoryKey, brandKey, fallbackCategory = '', fallbackBrand = '') {
    const ensureBrandName = async () => {
      if (!brandKey) return '';
      const fetched = await this.fetchBrandNameById(brandKey);
      return fetched;
    };
    const ensureCatName = async () => {
      if (!categoryKey) return '';
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
    if (!raw || typeof raw !== 'object') return null;
    const name = this._normalizeId(raw.name ?? raw.id ?? raw.title ?? raw.fullname ?? raw.sku);
    if (!name) return null;
    const title = String(raw.fullname ?? raw.title ?? raw.name ?? '').trim();
    const price = Number(raw.price ?? raw.cost ?? 0);
    const oldPrice = Number(raw.oldPrice ?? raw.price_old ?? 0);
    const stock = Number(raw.stock ?? raw.count ?? raw.qty ?? 0);
    const picture = String(raw.picture ?? raw.image ?? raw.img ?? '/assets/no-image.png');
    const { key: categoryKey, name: categoryNameInput } = this._parseCategory(raw);
    const { key: brandKey, name: brandNameInput } = this._parseBrand(raw);
    const [resolvedCatName, resolvedBrandName] = await this._resolveBrandAndCategoryNames(categoryKey, brandKey, categoryNameInput, brandNameInput);
    // обновить кэши окончательными значениями
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
      short: raw.short ?? raw.description ?? '',
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
    return sid ? (this._productMap.get(sid) || null) : null;
  }

  /**
   * Загружает список товаров. Можно указать force=true для принудительного обновления.
   * @param {Object} [options]
   * @param {boolean} [options.force=false]
   * @param {any} [options.request=null] Переопределение запроса
   * @returns {Promise<Array<any>>}
   */
  async loadProductsSimple({ force = false, request = null } = {}) {
    //if (this.products.length && !force && !request) return this.getProducts();
    const defaultEndpoint = this.opts.endpoints.products;
    let endpoint = defaultEndpoint;
    let payload = { sysRequest: endpoint };
    if (request) {
      if (typeof request === 'string') {
        endpoint = request;
        payload.sysRequest = endpoint;
      } else {
        const { endpoint: reqEndpoint, sysRequest: reqSys, payload: reqPayload, params: reqParams, ...extra } = request;
        endpoint = reqEndpoint ?? reqSys ?? defaultEndpoint;
        payload = Object.assign({}, reqParams ?? {}, reqPayload ?? {}, extra ?? {}, { sysRequest: endpoint });
      }
    }
    try {
      const res = await this._safeCall(payload, 'JSON');
      const items = this._extractArray(res, ['items', 'products', 'data']);
      const normalized = await Promise.all(items.map((i) => this._normalizeProduct(i)).filter(Boolean));
      this.products = normalized;
      this._rebuildMaps();
      // ensure simple category/brand keys exist in maps (для фильтров)
      for (const p of this.products) {
        if (p.category && !this._categoriesMap.has(p.category)) this._categoriesMap.set(p.category, p.categoryName || p.category);
        if (p.brand && !this._brandsMap.has(p.brand)) this._brandsMap.set(p.brand, p.brandName);
      }
      this._notifySubscribers({ type: 'reload', changedIds: this.products.map((p) => p.name) });
      return this.getProducts();
    } catch (err) {
      this._log(this._msg('LOAD_PRODUCTS_ERROR'), err);
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
      const res = await this._safeCall({ sysRequest: endpoint, id: sid }, 'JSON');
      const items = this._extractArray(res, ['product', 'items', 'products', 'data']);
      const raw = items.length ? items[0] : res.product ?? res;
      if (!raw) return null;
      const normalized = await this._normalizeProduct(raw);
      if (!normalized) return null;
      this.products.push(normalized);
      this._productMap.set(normalized.name, normalized);
      if (normalized.category) this._setCache(this._categoriesMap, normalized.category, normalized.categoryName || normalized.category);
      if (normalized.brand) this._setCache(this._brandsMap, normalized.brand, normalized.brandName || normalized.brand);
      this._notifySubscribers({ type: 'add', changedIds: [normalized.name] });
      return normalized;
    } catch (err) {
      this._log(this._msg('FETCH_BY_ID_ERROR'), err);
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
      this._notifySubscribers({ type: 'set', changedIds: this.products.map((p) => p.name) });
      return true;
    } catch (err) {
      this._log(this._msg('LOAD_PRODUCTS_ERROR'), err);
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
    const res = await this._safeCall({ sysRequest: endpoint }, 'JSON');
    return this._extractArray(res, [entity, 'data', 'items', 'list']);
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
    const res = await this._safeCall({ sysRequest: endpoint, id: sid }, 'JSON');
    const arr = this._extractArray(res, [entity, 'data', 'items']);
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
      const arr = await this.fetchList('categories');
      const out = arr.map((c) => {
        if (!c) return null;
        if (typeof c === 'string') return { name: c, fullname: c };
        return { name: c.name ?? c.id ?? '', fullname: c.fullname ?? c.name ?? c.title ?? '' };
      }).filter(Boolean);
      for (const c of out) this._setCache(this._categoriesMap, String(c.name).trim(), String(c.fullname).trim() || String(c.name).trim());
      return out.length ? out : Array.from(this._categoriesMap.entries()).map(([name, fullname]) => ({ name, fullname }));
    } catch (err) {
      this._log(this._msg('FETCH_CATEGORIES_ERROR'), err);
      return Array.from(this._categoriesMap.entries()).map(([name, fullname]) => ({ name, fullname }));
    }
  }

  /**
   * Запрашивает и обновляет список брендов
   * @returns {Promise<Array<{id:string, name:string, fullname:string}>>}
   */
  async fetchBrands() {
    try {
      const arr = await this.fetchList('brands');
      const out = arr.map((b) => {
        if (!b) return null;
        if (typeof b === 'string') {
          const id = this._normalizeId(b);
          return { id, name: b, fullname: b };
        }
        const id = this._normalizeId(b.id ?? b.key ?? b.name ?? '');
        if (!id) return null;
        const name = String(b.name ?? b.fullname ?? b.title ?? b.label ?? id).trim();
        const fullname = String(b.fullname ?? name).trim() || name || id;
        return { id, name, fullname };
      }).filter(Boolean);
      for (const b of out) this._setCache(this._brandsMap, b.id, b.fullname || b.name);
      // complement with brands found in products
      for (const p of this.products) {
        const bid = this._normalizeId(p.brand);
        if (!bid) continue;
        if (!this._brandsMap.has(bid)) this._brandsMap.set(bid, p.brandName || p.brand || bid);
      }
      return out.length ? out : Array.from(this._brandsMap.entries()).map(([id, fullname]) => ({ id, name: fullname, fullname }));
    } catch (err) {
      this._log('ProductService.fetchBrands failed', err);
      // fallback: derive from products
      const map = new Map();
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
    if (!sid) return '';
    if (this._brandsMap.has(sid)) return this._brandsMap.get(sid);
    for (const p of this.products) {
      const bid = this._normalizeId(p.brand);
      if (bid === sid) {
        const nm = p.brandName || p.brand || bid;
        this._brandsMap.set(sid, nm);
        return nm;
      }
    }
    return '';
  }

  /**
   * Асинхронно запрашивает название бренда по id с бэкенда
   * @param {any} id
   * @returns {Promise<string>}
   */
  async fetchBrandNameById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return '';
    try {
      const item = await this.fetchEntityById('brands', sid);
      if (!item) return '';
      const bid = this._normalizeId(item.name) || sid;
      const fullname = String(item.fullname).trim() || bid;
      this._brandsMap.set(bid, fullname);
      return fullname;
    } catch (err) {
      this._log('ProductService.fetchBrandNameById failed', err);
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
    if (!sid) return '';
    if (this._categoriesMap.has(sid)) return this._categoriesMap.get(sid);
    for (const p of this.products) {
      const cid = this._normalizeId(p.category);
      if (cid === sid) {
        const nm = p.categoryName || cid;
        this._categoriesMap.set(sid, nm);
        return nm;
      }
    }
    return '';
  }

  /**
   * Асинхронно запрашивает название категории по id с бэкенда
   * @param {any} id
   * @returns {Promise<string>}
   */
  async fetchCatById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return '';
    try {
      const item = await this.fetchEntityById('categories', sid);
      if (!item) return '';
      const cid = this._normalizeId(item.name) || sid;
      const fullname = String(item.fullname).trim() || cid;
      this._categoriesMap.set(cid, fullname);
      return fullname;
    } catch (err) {
      this._log('ProductService.fetchCatById failed', err);
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
async _fillSelectGeneric(
  selectEl,
  {
    entity = 'categories',
    productProp = 'category',
    includeAllOption = true,
    onlyFromProducts = false,
    sort = true,
    allMsgKey = 'ALL_CATEGORIES_OPTION',
    selected = ""          // <--- вот он
  } = {}
) {
  if (typeof selectEl === 'string') selectEl = document.querySelector(selectEl);
  if (!selectEl) return false;

  const slug = (str) => String(str).toLowerCase().replace(/\s+/g, '');
  const collected = new Map();

  const add = (id, name, fullname) => {
    const safeName = name && name.toLowerCase() !== 'undefined' ? name : '';
    const safeFullname = fullname && fullname.toLowerCase() !== 'undefined' ? fullname : '';
    const human = safeFullname || safeName || id;
    if (!human) return;
    const key = slug(human);
    const entry = collected.get(key) || { id: '', name: '', fullname: '' };
    if (!entry.id && id) entry.id = id;
    if (!entry.name && safeName) entry.name = safeName;
    if (!entry.fullname && safeFullname) entry.fullname = safeFullname;
    collected.set(key, entry);
  };

  // 1) fetch list unless onlyFromProducts
  if (!onlyFromProducts) {
    const list = await this.fetchList(entity).catch((e) => {
      this._log(`fetchList(${entity}) failed`, e);
      return [];
    });
    for (const it of list) {
      if (!it) continue;
      if (typeof it === 'string') {
        add(it, it, it);
      } else {
        const id = this._normalizeId(it.id ?? it.key ?? it.name);
        const name = it.name != null ? String(it.name).trim() : '';
        const fullname = it.fullname != null ? String(it.fullname).trim() : '';
        add(id, name, fullname);

        if (entity === 'brands') {
          const nm = (fullname && fullname.toLowerCase() !== 'undefined') ? fullname : name;
          if (id && nm) this._brandsMap.set(id, nm);
        }
        if (entity === 'categories') {
          const nm = (fullname && fullname.toLowerCase() !== 'undefined') ? fullname : name;
          if (id && nm) this._categoriesMap.set(id, nm);
        }
      }
    }
  }

  // 2) include items from products
  if (!onlyFromProducts) {
    for (const p of this.products) {
      const id = this._normalizeId(p[productProp]);
      const name = p[`${productProp}Name`] != null ? String(p[`${productProp}Name`]).trim() : '';
      const fullname = p[`${productProp}Fullname`] != null ? String(p[`${productProp}Fullname`]).trim() : '';
      add(id, name, fullname);

      if (entity === 'brands') {
        const nm = (fullname && fullname.toLowerCase() !== 'undefined') ? fullname : name;
        if (id && nm) this._brandsMap.set(id, nm);
      }
      if (entity === 'categories') {
        const nm = (fullname && fullname.toLowerCase() !== 'undefined') ? fullname : name;
        if (id && nm) this._categoriesMap.set(id, nm);
      }
    }
  }

  let rows = Array.from(collected.values());
  if (sort) {
    rows.sort((a, b) => String(a.fullname || a.name).localeCompare(String(b.fullname || b.name)));
  }

  selectEl.innerHTML = '';

  if (includeAllOption) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = this._msg(allMsgKey);

    // если selected === "" (по умолчанию) — выделяем "Все"
    if (selected === '' || selected == null) {
      opt.selected = true;
    }

    selectEl.appendChild(opt);
  }

  for (const r of rows) {
    const o = document.createElement('option');
    o.value = r.name; // если хочешь — можно поменять на r.id
    if (r.id) o.dataset.id = r.id;
    if (r.fullname && r.fullname.toLowerCase() !== 'undefined') o.dataset.fullname = r.fullname;
    o.dataset.name = r.name || '';
    o.textContent = r.fullname || r.name || r.id;

    // если значение совпало с selected — ставим выбранным
    if (selected !== '' && String(o.value) === String(selected)) {
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
      entity: 'categories',
      productProp: 'category',
      allMsgKey: 'ALL_CATEGORIES_OPTION'
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
      entity: 'brands',
      productProp: 'brand',
      allMsgKey: 'ALL_BRANDS_OPTION'
    }, opts));
  }

  /* ---------------------- misc ---------------------- */

  /**
   * Подписывается на изменения. Возвращает функцию для отписки.
   * @param {Function} fn
   * @returns {Function}
   */
  subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError(this._msg('SUBSCRIBE_ARG_ERROR'));
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
        this._notifySubscribers({ type: 'update', changedIds: [existing.name] });
        return existing;
      }
      this.products.push(normalized);
      this._productMap.set(normalized.name, normalized);
      this._setCache(this._categoriesMap, normalized.category, normalized.categoryName || normalized.category);
      this._setCache(this._brandsMap, normalized.brand, normalized.brandName || normalized.brand);
      this._notifySubscribers({ type: 'add', changedIds: [normalized.name] });
      return normalized;
    } catch (err) {
      this._log(this._msg('UPSERT_ERROR'), err);
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
    const ev = new StorageEvent('storage', { key, oldValue, newValue, url: location.href, storageArea: localStorage });
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
}