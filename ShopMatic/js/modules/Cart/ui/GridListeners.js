/**
 * @author Calista Verner
 *
 * GridListeners — DOM -> intents only.
 * NO business logic.
 *
 * Senior polish:
 *  - uses 'input' for qty to react immediately (no blur required)
 */
export class GridListeners {
  constructor(ctx) {
    this.ctx = ctx;
  }

  attachGridListeners() {
    const c = this.ctx;
    if (!c.cartGrid) return;

    if (c._gridListenersAttachedTo && c._gridListenersAttachedTo !== c.cartGrid) {
      this.detachGridListeners();
    }
    if (c._gridHandler) return;

    c._gridHandler = (ev) => this.handleGridClick(ev);
    c._gridInputHandler = (ev) => this.handleGridInput(ev);

    try {
      c.cartGrid.addEventListener('click', c._gridHandler, { passive: false });
      c.cartGrid.addEventListener('input', c._gridInputHandler, { passive: true }); // was 'change'
      c._gridListenersAttachedTo = c.cartGrid;
    } catch (e) {
      c._logError('_attachGridListeners failed', e);
    }
  }

  detachGridListeners() {
    const c = this.ctx;
    if (!c._gridListenersAttachedTo) return;
    try {
      c._gridListenersAttachedTo.removeEventListener('click', c._gridHandler);
      c._gridListenersAttachedTo.removeEventListener('input', c._gridInputHandler);
    } catch (e) {
      c._logError('_detachGridListeners error', e);
    }
    c._gridHandler = null;
    c._gridInputHandler = null;
    c._gridListenersAttachedTo = null;
  }

  handleGridClick(ev) {
    const c = this.ctx;
    const t = ev.target;
    const row = c.rowSync.findRowFromElement(t);
    if (!row) return;

    const id = c.rowSync.getIdFromRow(row);
    if (!id) return;

    const closest = (sel) => (t.closest && t.closest(sel)) || null;

    if (closest('.fav-btn, [data-role="fav"]')) {
      ev.preventDefault();
      c.presenter.dispatch({ type: 'FAV_TOGGLE', id });
      return;
    }

    if (closest('.qty-btn.qty-incr, [data-action="qty-incr"], [data-role="qty-plus"]')) {
      ev.preventDefault();
      c.presenter.dispatch({ type: 'QTY_INC', id, sourceRow: row });
      return;
    }

    if (closest('.qty-btn.qty-decr, [data-action="qty-decr"], [data-role="qty-minus"]')) {
      ev.preventDefault();
      c.presenter.dispatch({ type: 'QTY_DEC', id, sourceRow: row });
      return;
    }

    if (closest('.remove-btn, [data-action="remove"], [data-role="remove"]')) {
      ev.preventDefault();
      c.presenter.dispatch({ type: 'REMOVE', id });
    }
  }

  handleGridInput(ev) {
    const c = this.ctx;
    const input = ev.target;
    if (!input) return;

    // qty input
    const isQty =
      (input.matches &&
        (input.matches('.qty-input') ||
          input.matches('[data-role="qty-input"]') ||
          input.matches('input[type="number"]')));

    if (isQty) {
      const row = c.rowSync.findRowFromElement(input);
      if (!row) return;

      const id = c.rowSync.getIdFromRow(row);
      if (!id) return;

      let v = parseInt(input.value, 10);
      if (Number.isNaN(v)) v = 0;

      c.presenter.dispatch({ type: 'QTY_SET', id, qty: v, sourceRow: row });
      return;
    }

    // include checkbox
    const isInclude =
      (input.matches &&
        (input.matches('input[data-role="include"]') ||
          input.matches('input.include-checkbox') ||
          input.matches('input[name="include"]'))) ||
      (!!input.closest && (!!input.closest('.include-checkbox') || !!input.closest('.cart-item__include')));

    if (isInclude) {
      const row = c.rowSync.findRowFromElement(input);
      if (!row) return;

      const id = c.rowSync.getIdFromRow(row);
      if (!id) return;

      c.presenter.dispatch({ type: 'INCLUDE_SET', id, included: !!input.checked });
    }
  }
}