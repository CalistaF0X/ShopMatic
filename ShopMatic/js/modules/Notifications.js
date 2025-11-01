/**
 * shopmatic/Notifications.js
 *
 * Notifications manager for ShopMatic
 *
 * Author: Calista Verner
 * Version: 1.3.0
 * Date: 2025-10-14
 * License: MIT
 *
 * Responsibilities:
 *  - display transient notifications (info/success/warning/error)
 *  - safe text insertion by default, optional trusted HTML via allowHtml
 *  - pause-on-hover, dismissible, keyboard dismiss, max visible items
 *  - returns control handle { id, dismiss, promise }
 *
 * Notes:
 *  - All user-facing strings are centralized in UI_MESSAGES.
 *  - The class is defensive and tolerates missing DOM.
 */

export class Notifications {
  static UI_MESSAGES = Object.freeze({
    CLOSE_BUTTON_LABEL: 'Закрыть уведомление',
    // resolver reasons (useful if you want to show or log them elsewhere)
    REASON_TIMEOUT: 'timeout',
    REASON_MANUAL: 'manual',
    REASON_KEYBOARD: 'keyboard',
    REASON_CLEARED: 'cleared',
    REASON_EVICTED: 'evicted'
  });

  _msg(key, vars = {}) {
    const pool = (this.constructor && this.constructor.UI_MESSAGES) || {};
    let tpl = pool[key] ?? '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }

  constructor(opts = {}) {
    this.opts = Object.assign({
      duration: 3000,
      position: { right: 20, bottom: 20 },
      maxVisible: 5,
      pauseOnHover: true,
      dismissible: true,
      allowHtml: false,
      containerClass: 'shop-notifications',
      notificationClass: 'shop-notification',
      ariaLive: 'polite'
    }, opts);

    this._container = null;
    this._idCounter = 1;
    this._timers = new Map();    // id -> timeoutId
    this._resolvers = new Map(); // id -> resolver
  }

  show(message, opts = {}) {
    if (!message && message !== 0) return null;
    const cfg = Object.assign({}, this.opts, opts);
    const id = `notif_${this._idCounter++}`;
    const container = this._ensureContainer(cfg);
    this._enforceMaxVisible(container, cfg.maxVisible);

    const note = document.createElement('div');
    note.className = `${cfg.notificationClass} ${cfg.notificationClass}--${cfg.type || 'info'}`.trim();
    note.setAttribute('data-notification-id', id);
    note.tabIndex = 0;
    note.style.pointerEvents = 'auto';
    note.setAttribute('role', (cfg.type === 'error' || cfg.ariaLive === 'assertive') ? 'alert' : 'status');
    note.setAttribute('aria-live', opts.ariaLive ?? cfg.ariaLive);
    note.setAttribute('aria-atomic', 'true');

    const ICONS = {
      success: 'fa-solid fa-check',
      warning: 'fa-solid fa-triangle-exclamation',
      error: 'fa-solid fa-hexagon-exclamation',
      info: 'fa-solid fa-info'
    };
    const typeKey = (cfg.type && String(cfg.type)) ? String(cfg.type) : 'info';
    const iconClass = ICONS[typeKey] || ICONS.info;

    const iconEl = document.createElement('i');
    iconEl.className = `${iconClass} ${cfg.notificationClass}__icon notif-icon notif-icon--${typeKey}`;
    iconEl.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${cfg.notificationClass}__close`;
      btn.setAttribute('aria-label', this._msg('CLOSE_BUTTON_LABEL'));
      btn.innerHTML = '&times;';
      btn.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
      note.appendChild(btn);
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
    };
    const resumeTimer = () => {
      if (!cfg.pauseOnHover) return;
      startTimer(remainingDuration);
    };

    note.classList.add('is-entering');
    container.appendChild(note);
    requestAnimationFrame(() => {
      note.classList.remove('is-entering');
      note.classList.add('is-visible');
    });

    const performRemove = (reason = this.constructor.UI_MESSAGES.REASON_MANUAL) => {
      if (!note.parentNode) return resolveAndCleanup(reason);
      note.classList.remove('is-visible');
      note.classList.add('is-leaving');
      clearTimer();
      setTimeout(() => {
        if (note && note.parentNode) note.parentNode.removeChild(note);
        resolveAndCleanup(reason);
      }, 320);
    };

    const resolveAndCleanup = (reason = this.constructor.UI_MESSAGES.REASON_MANUAL) => {
      const resolver = this._resolvers.get(id);
      if (resolver) {
        try { resolver({ id, reason }); } catch (e) {}
      }
      this._resolvers.delete(id);
      const t = this._timers.get(id);
      if (t) { clearTimeout(t); this._timers.delete(id); }
      if (typeof cfg.onClose === 'function') {
        try { cfg.onClose({ id, reason }); } catch (e) {}
      }
    };

    const promise = new Promise((resolve) => { this._resolvers.set(id, resolve); });
    const dismiss = (reason = this.constructor.UI_MESSAGES.REASON_MANUAL) => performRemove(reason);

    if (cfg.pauseOnHover) {
      note.addEventListener('mouseenter', pauseTimer);
      note.addEventListener('mouseleave', resumeTimer);
    }
    note.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' || ev.key === 'Esc') { ev.preventDefault(); dismiss(this.constructor.UI_MESSAGES.REASON_KEYBOARD); }
    });

    remainingDuration = Number(cfg.duration) || 0;
    if (remainingDuration > 0) startTimer(remainingDuration);

    return { id, dismiss, promise };
  }

  clearAll() {
    if (!this._container) return;
    const notes = Array.from(this._container.querySelectorAll(`.${this.opts.notificationClass}`));
    notes.forEach(n => {
      const id = n.getAttribute('data-notification-id');
      n.classList.remove('is-visible');
      n.classList.add('is-leaving');
      setTimeout(() => { if (n.parentNode) n.parentNode.removeChild(n); }, 320);
      const resolver = this._resolvers.get(id);
      if (resolver) {
        try { resolver({ id, reason: this.constructor.UI_MESSAGES.REASON_CLEARED }); } catch (e) {}
        this._resolvers.delete(id);
      }
      const t = this._timers.get(id);
      if (t) { clearTimeout(t); this._timers.delete(id); }
    });
  }

  _ensureContainer(cfg = {}) {
    if (this._container) return this._container;
    const cont = document.createElement('div');
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
        toRemove.forEach(n => {
          n.classList.remove('is-visible');
          n.classList.add('is-leaving');
          setTimeout(() => { if (n.parentNode) n.parentNode.removeChild(n); }, 320);
          const id = n.getAttribute('data-notification-id');
          const resolver = this._resolvers.get(id);
          if (resolver) { try { resolver({ id, reason: this.constructor.UI_MESSAGES.REASON_EVICTED }); } catch (e) {} }
          this._resolvers.delete(id);
        });
      }
    } catch (e) { /* ignore */ }
  }
}
