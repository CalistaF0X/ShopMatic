/**
 * Events — canonical event names (no legacy aliases).
 *
 * Design notes:
 *  - DOMAIN_* events represent state changes in domain/services.
 *  - UI_* events represent UI pipeline lifecycle / snapshots.
 *
 * @author Calista Verner
 */
export const Events = Object.freeze({
  // Domain
  DOMAIN_CART_CHANGED: 'domain.cart.changed',
  DOMAIN_INCLUDED_CHANGED: 'domain.included.changed',
  DOMAIN_FAVORITES_CHANGED: 'domain.favorites.changed',

  // UI
  UI_CART_UPDATED: 'ui.cart.updated',
  UI_CARDS_SYNC_REQUEST: 'ui.cards.sync.request'
});
