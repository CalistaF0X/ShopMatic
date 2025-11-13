/*
 * shopmatic/NotificationsOptimized.js
 *
 * Optimized notifications manager for ShopMatic with CyberLife style and
 * built-in progress bar. This version extends the existing Notifications
 * manager by adding a loading bar that shrinks over the notification
 * lifetime, integrates pause/resume behaviour with the timer, and
 * supports a modern CyberLife aesthetic via external CSS (see
 * notifications_detroit.css).
 *
 * Author: Calista Verner (modifications by optimization)
 * Version: 1.4.0
 * Date: 2025-10-24
 * License: MIT
 */

export class Notifications {
  static UI_MESSAGES = Object.freeze({
    CLOSE_BUTTON_LABEL: 'Закрыть уведомление',
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
    // Default settings extended with progress bar option
    this.opts = Object.assign({
      duration: 3000,
      position: { right: 20, bottom: 20 },
      maxVisible: 5,
      pauseOnHover: true,
      dismissible: true,
      allowHtml: false,
      containerClass: 'shop-notifications',
      notificationClass: 'shop-notification',
      ariaLive: 'polite',
      showProgressBar: true // display loading bar by default
    }, opts);

    this._container = null;
    this._idCounter = 1;
    this._timers = new Map();
    this._resolvers = new Map();
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

    // Icon mapping
    const ICONS = {
      success: 'fa-solid fa-check',
      warning: 'fa-solid fa-triangle-exclamation',
      error: 'fa-solid fa-hexagon-exclamation',
      info: 'fa-solid fa-info'
    };
    const typeKey = (cfg.type && String(cfg.type)) ? String(cfg.type) : 'info';
    const iconClass = ICONS[typeKey] || ICONS.info;

    // Create icon element
    const iconEl = document.createElement('i');
    iconEl.className = `${iconClass} ${cfg.notificationClass}__icon notif-icon notif-icon--${typeKey}`;
    iconEl.setAttribute('aria-hidden', 'true');

    // Content element
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

    // Dismiss button if enabled
    if (cfg.dismissible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${cfg.notificationClass}__close`;
      btn.setAttribute('aria-label', this._msg('CLOSE_BUTTON_LABEL'));
      btn.innerHTML = '&times;';
      btn.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
      note.appendChild(btn);
    }

    // Progress bar element (insert before close button so it sits at bottom)
    let progress = null;
    let parentWidth = 0;
    if (cfg.showProgressBar) {
      progress = document.createElement('div');
      progress.className = `${cfg.notificationClass}__progress`;
      note.appendChild(progress);
    }

    // Timer management
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
      // Pause progress bar by freezing current width
      if (progress) {
        const parent = progress.parentNode;
        if (parent) parentWidth = parent.clientWidth;
        const currentWidth = progress.getBoundingClientRect().width;
        const pct = parentWidth ? (currentWidth / parentWidth) * 100 : 0;
        progress.style.transition = 'none';
        progress.style.width = `${pct}%`;
      }
    };
    const resumeTimer = () => {
      if (!cfg.pauseOnHover) return;
      // Resume timer with remaining duration
      startTimer(remainingDuration);
      // Resume progress bar transition
      if (progress) {
        // Ensure parent width is up to date
        const parent = progress.parentNode;
        parentWidth = parent ? parent.clientWidth : parentWidth;
        // Set transition for remaining time and animate to 0
        progress.style.transition = `width ${remainingDuration}ms linear`;
        progress.style.width = '0%';
      }
    };

    note.classList.add('is-entering');
    container.appendChild(note);
    // Trigger CSS enter transition
    requestAnimationFrame(() => {
      note.classList.remove('is-entering');
      note.classList.add('is-visible');
      // Start progress bar animation on next tick
      if (progress) {
        // Get parent width now
        parentWidth = progress.parentNode ? progress.parentNode.clientWidth : 0;
        progress.style.transition = 'none';
        progress.style.width = '100%';
        // Start shrinking after a frame
        requestAnimationFrame(() => {
          progress.style.transition = `width ${remainingDuration}ms linear`;
          progress.style.width = '0%';
        });
      }
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

    // Hover events for pause/resume
    if (cfg.pauseOnHover) {
      note.addEventListener('mouseenter', pauseTimer);
      note.addEventListener('mouseleave', resumeTimer);
    }
    // Keyboard dismiss
    note.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' || ev.key === 'Esc') {
        ev.preventDefault();
        dismiss(this.constructor.UI_MESSAGES.REASON_KEYBOARD);
      }
    });

    // Start the timer
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
          const id = n.getAttribute('data-notification-id');
          n.classList.remove('is-visible');
          n.classList.add('is-leaving');
          setTimeout(() => { if (n.parentNode) n.parentNode.removeChild(n); }, 320);
          const resolver = this._resolvers.get(id);
          if (resolver) { try { resolver({ id, reason: this.constructor.UI_MESSAGES.REASON_EVICTED }); } catch (e) {} }
          this._resolvers.delete(id);
        });
      }
    } catch (e) { /* ignore */ }
  }
}