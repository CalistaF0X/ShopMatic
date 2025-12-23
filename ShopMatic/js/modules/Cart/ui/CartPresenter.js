/**
 * @author Calista Verner
 *
 * CartPresenter — the single orchestrator (senior polish).
 * Responsibilities:
 *  - Accept actions (commands) from UI layer
 *  - Mutate domain state (CartBase) WITHOUT triggering UI side-effects
 *  - Re-render UI (grid/minicart/totals/badges)
 *  - Emit events (through ctx pipeline)
 *
 * Key improvements:
 *  - Queues updates while pipeline running (no re-entrancy storms)
 *  - Coalesces targetId safely
 */
export class CartPresenter {
  /**
   * @param {any} ctx CartUI (extends CartBase)
   */
  constructor(ctx) {
    this.ctx = ctx;
    this._updating = false;

    // queued refresh request while updating
    this._queued = false;
    this._queuedTargetId = null; // null => global
  }

  /**
   * Unified entry point.
   * @param {object} action
   * @returns {Promise<any>}
   */
  async dispatch(action = {}) {
    const c = this.ctx;
    const type = String(action?.type || '').trim().toUpperCase();
    if (!type) return null;

    let targetId = action.id != null ? c._normalizeIdKey(action.id) : null;

    // --- DOMAIN MUTATIONS ONLY (no UI calls here) ----------------------------
    switch (type) {
      case 'QTY_SET': {
        if (!targetId) return null;
        const qty = Number.isFinite(Number(action.qty)) ? Number(action.qty) : 0;
        c._domainChangeQty(targetId, qty, { sourceRow: action.sourceRow || null });
        break;
      }

      case 'QTY_INC': {
        if (!targetId) return null;
        const item = c._getCartItemById(targetId);
        const next = Number(item?.qty ?? 0) + 1;
        c._domainChangeQty(targetId, next, { sourceRow: action.sourceRow || null });
        break;
      }

      case 'QTY_DEC': {
        if (!targetId) return null;
        const item = c._getCartItemById(targetId);
        const next = Number(item?.qty ?? 0) - 1; // allow 0 => domain removes
        c._domainChangeQty(targetId, next, { sourceRow: action.sourceRow || null });
        break;
      }

      case 'REMOVE': {
        if (!targetId) return null;
        c._domainRemove(targetId);
        break;
      }

      case 'ADD': {
        if (!targetId) return null;
        const qty = Number.isFinite(Number(action.qty)) ? Math.max(1, Number(action.qty)) : 1;
        c._domainAdd(targetId, qty);
        break;
      }

      case 'INCLUDE_SET': {
        if (!targetId) return null;
        const included = !!action.included;
        c.included?.set?.(targetId, included, { immediateSave: true, reason: 'include_set' });
        const it = c._getCartItemById?.(targetId);
        if (it) it.included = included;
        // If you want strict totals correctness on include change, set:
        // targetId = null;
        break;
      }

      case 'INCLUDE_ALL': {
        const val = !!action.included;
        c.included?.setAll?.(Array.isArray(c.cart) ? c.cart : [], val, { immediateSave: true });
        targetId = null; // global update
        break;
      }

      case 'FAV_TOGGLE': {
        if (!targetId) return null;
        try {
          const res = c.favorites?.toggle?.(targetId);
          if (res && typeof res.then === 'function') await res.catch(() => {});
        } catch {}
        break;
      }

      default:
        return null;
    }

    // --- UI ORCHESTRATION (single place) ------------------------------------
    return this.updateUI(targetId);
  }

  /**
   * The only UI refresh pipeline.
   * Queues if pipeline is already running.
   * @param {string|null} targetId
   */
  async updateUI(targetId = null) {
    const c = this.ctx;

    if (this._updating) {
      this._queued = true;

      // Coalesce:
      // - if any caller requests global (null) => global wins
      // - else keep first queued id (cheap and stable)
      if (targetId == null) this._queuedTargetId = null;
      else if (this._queuedTargetId == null) {
        // keep global
      } else if (!this._queuedTargetId) {
        this._queuedTargetId = targetId;
      }

      return null;
    }

    this._updating = true;
    try {
      return await c._updateCartUI(targetId);
    } finally {
      this._updating = false;

      if (this._queued) {
        const nextTarget = this._queuedTargetId;
        this._queued = false;
        this._queuedTargetId = null;

        // run one more refresh, safely
        try {
          await c._updateCartUI(nextTarget);
        } catch {}
      }
    }
  }
}