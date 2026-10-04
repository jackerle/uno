// Card + CardBack rendering. Pure DOM factories, sized via the --cw variable.
import { cardLabel, h, svg } from '../core/util.js';

const INK = '#14141f';

const SYMBOLS = {
  skip: `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke-linecap="round">
    <circle cx="50" cy="50" r="31" stroke="${INK}" stroke-width="23"/>
    <line x1="29" y1="71" x2="71" y2="29" stroke="${INK}" stroke-width="23"/>
    <circle cx="50" cy="50" r="31" stroke="currentColor" stroke-width="13"/>
    <line x1="29" y1="71" x2="71" y2="29" stroke="currentColor" stroke-width="13"/></g></svg>`,
  reverse: `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-40 50 50)" fill="currentColor" stroke="${INK}" stroke-width="7" stroke-linejoin="round" paint-order="stroke">
    <path d="M22 60V45a15 15 0 0 1 15-15h19V17l24 22-24 22V48H40v12z"/>
    <path d="M22 60V45a15 15 0 0 1 15-15h19V17l24 22-24 22V48H40v12z" transform="rotate(180 50 50)"/></g></svg>`,
  draw2: `<svg viewBox="0 0 100 100" aria-hidden="true"><g stroke="${INK}" stroke-width="6" stroke-linejoin="round">
    <rect x="20" y="14" width="38" height="54" rx="7" fill="currentColor" transform="rotate(-12 39 41)"/>
    <rect x="42" y="32" width="38" height="54" rx="7" fill="currentColor" transform="rotate(-12 61 59)"/></g></svg>`,
  wild4: `<svg viewBox="0 0 100 100" aria-hidden="true"><g stroke="${INK}" stroke-width="5" stroke-linejoin="round" transform="rotate(-12 50 50)">
    <rect x="12" y="30" width="28" height="40" rx="5" fill="#2e85ff"/>
    <rect x="28" y="16" width="28" height="40" rx="5" fill="#21c776"/>
    <rect x="44" y="44" width="28" height="40" rx="5" fill="#ff3d55"/>
    <rect x="60" y="30" width="28" height="40" rx="5" fill="#ffcc2e"/></g></svg>`,
  cornerSkip: `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke-linecap="round">
    <circle cx="50" cy="50" r="34" stroke="${INK}" stroke-width="30"/><line x1="26" y1="74" x2="74" y2="26" stroke="${INK}" stroke-width="30"/>
    <circle cx="50" cy="50" r="34" stroke="#fff" stroke-width="16"/><line x1="26" y1="74" x2="74" y2="26" stroke="#fff" stroke-width="16"/></g></svg>`,
  cornerReverse: `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-40 50 50)" fill="#fff" stroke="${INK}" stroke-width="10" stroke-linejoin="round" paint-order="stroke">
    <path d="M22 60V45a15 15 0 0 1 15-15h19V17l24 22-24 22V48H40v12z"/>
    <path d="M22 60V45a15 15 0 0 1 15-15h19V17l24 22-24 22V48H40v12z" transform="rotate(180 50 50)"/></g></svg>`,
  cornerWild: `<svg viewBox="0 0 100 100" aria-hidden="true"><g stroke="${INK}" stroke-width="9">
    <path d="M50 50V8a42 42 0 0 1 42 42z" fill="#2e85ff"/><path d="M50 50h42a42 42 0 0 1-42 42z" fill="#21c776"/>
    <path d="M50 50v42A42 42 0 0 1 8 50z" fill="#ffcc2e"/><path d="M50 50H8A42 42 0 0 1 50 8z" fill="#ff3d55"/></g></svg>`,
};

function cornerContent(card) {
  switch (card.value) {
    case 'skip':
      return svg(SYMBOLS.cornerSkip);
    case 'reverse':
      return svg(SYMBOLS.cornerReverse);
    case 'draw2':
      return '+2';
    case 'wild4':
      return '+4';
    case 'wild':
      return svg(SYMBOLS.cornerWild);
    default:
      return card.value;
  }
}

function glyphContent(card) {
  switch (card.value) {
    case 'skip':
    case 'reverse':
    case 'draw2':
    case 'wild4':
      return svg(SYMBOLS[card.value]);
    case 'wild':
      return null;
    default:
      return h('span', card.value);
  }
}

/**
 * @param {{id:string,color:string,value:string}} card
 * @param {{chosen?:string}} [opts] chosen = colour picked for a played wild
 */
export function createCard(card, opts = {}) {
  const underline = card.value === '6' || card.value === '9';
  const corner = (pos) => h(`span.card-corner.${pos}`, { class: underline ? 'is-underlined' : null }, cornerContent(card));
  const el = h(
    'div.card',
    { dataset: { color: card.color, value: card.value, id: card.id }, role: 'img', 'aria-label': cardLabel(card) },
    h('div.card-face', h('span.card-oval'), h('span.card-glyph', { class: underline ? 'is-underlined' : null }, glyphContent(card)), corner('tl'), corner('br')),
  );
  if (opts.chosen && card.color === 'wild') el.dataset.chosen = opts.chosen;
  return el;
}

export function createCardBack({ mini = false } = {}) {
  return h(
    'div.card.is-back',
    { class: mini ? 'is-mini' : null, 'aria-hidden': 'true' },
    h('div.card-face', h('span.card-oval'), h('span.card-logo', 'UNO')),
  );
}

/** Two-sided card for flip animations (front visible at rotateY(0)). */
export function createFlipCard(card) {
  return h('div.flip', createCard(card), createCardBack());
}
