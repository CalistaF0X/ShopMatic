// shopmatic/utils.js
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, ms = 200) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Возвращает правильное слово в зависимости от числа
 * @param {number} n — число
 * @param {string[]} forms — массив из трёх форм [1, 2, 5]
 * Пример: pluralize(5, ['товар', 'товара', 'товаров']) → "товаров"
 */
export function pluralize(n, forms) {
  n = Math.abs(n) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}


export function computeDiscountPercent(p) {
  if (!p || typeof p.oldPrice !== 'number') return 0;
  if (p.oldPrice <= p.price) return 0;
  const percent = Math.round(((p.oldPrice - p.price) / p.oldPrice) * 100);
  return Math.max(0, percent);
}
/**
 * Форматирует цену с учетом валюты.
 * @param {number} amount Сумма, которую нужно отформатировать.
 * @param {string} currency Код валюты (например, 'USD', 'EUR', 'RUB').
 * @returns {string} Отформатированная строка с ценой.
 */
export function formatPrice(amount, currency = 'RUB') {
  // Убедимся, что сумма является числом
  if (isNaN(amount) || amount === null) {
    throw new Error('Invalid amount');
  }

  // Определим настройки для валюты
  const options = {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,  // отображать минимум 2 знака после запятой
    maximumFractionDigits: 2   // отображать максимум 2 знака после запятой
  };

  // Форматируем сумму с использованием Intl.NumberFormat
  const formatter = new Intl.NumberFormat('ru-RU', options);
  return formatter.format(amount);
}

/**
 * Message formatter utility
 *
 * Supports template variables like:
 *   _msg('added', {count: 3})
 *   // if UI_MESSAGES.added = "Добавлено {count} товаров"
 *   // => "Добавлено 3 товаров"
 *
 * Can be used standalone or bound to a class with static UI_MESSAGES.
 *
 * @param {string} key - message key to fetch from UI_MESSAGES
 * @param {object} vars - optional replacements for {placeholders}
 * @param {object} [ctx] - optional context (class or instance with .UI_MESSAGES)
 * @returns {string}
 */
export function _msg(key, vars = {}, ctx = null) {
  const pool =
    (ctx && ctx.UI_MESSAGES) ||
    (ctx && ctx.constructor && ctx.constructor.UI_MESSAGES) ||
    (this && this.constructor && this.constructor.UI_MESSAGES) ||
    {};
  let tpl = pool[key] ?? '';
  return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
  );
}


/**
 * makeSpecHtmlPreview: принимает JSON-строку или объект и возвращает безопасный HTML
 * @param {string|object} specs
 * @returns {string}
 */
export function makeSpecHtmlPreview(specs) {
  if (arguments.length === 0 || specs == null) return '';

  let data = specs;
  if (typeof specs === 'string') {
    specs = specs.trim();
    if (!specs) return '';
    try {
      data = JSON.parse(specs);
    } catch {
      return '';
    }
  }
  if (typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) {
    return '';
  }
  let html = '<strong>Основные характеристики:</strong><div class="specsBlock">';
  for (const [key, value] of Object.entries(data)) {
    html += `<div class="specsEntry">
  <div class="specsTitle">${escapeHtml(key)}</div>
  <div class="separator" aria-hidden="true"></div>
  <div class="specsValue">${escapeHtml(value)}</div>
</div>
`;
  }
  html += '</div>';
  return html;
}
