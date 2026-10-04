// UNO deck definition, shuffling and card helpers.
// Pure module: no I/O. Randomness is injectable so tests can be deterministic.
import { randomBytes, randomInt } from 'node:crypto';

export const COLORS = Object.freeze(['red', 'yellow', 'green', 'blue']);
export const ACTION_VALUES = Object.freeze(['skip', 'reverse', 'draw2']);
export const WILD_VALUES = Object.freeze(['wild', 'wild4']);

/** Cryptographically strong rng: returns integer in [0, max). */
export const cryptoRng = (max) => randomInt(max);

/**
 * Card ids are random per deck so a client can never infer a hidden card's
 * identity from its id.
 */
function makeIdFactory() {
  const used = new Set();
  return () => {
    let id;
    do id = randomBytes(5).toString('hex');
    while (used.has(id));
    used.add(id);
    return id;
  };
}

/** Standard 108-card UNO deck. */
export function createDeck() {
  const nextId = makeIdFactory();
  const cards = [];
  const add = (color, value) => cards.push({ id: nextId(), color, value });
  for (const color of COLORS) {
    add(color, '0');
    for (let n = 1; n <= 9; n++) {
      add(color, String(n));
      add(color, String(n));
    }
    for (const action of ACTION_VALUES) {
      add(color, action);
      add(color, action);
    }
  }
  for (let i = 0; i < 4; i++) {
    add('wild', 'wild');
    add('wild', 'wild4');
  }
  return cards;
}

/** In-place Fisher–Yates shuffle. */
export function shuffle(cards, rng = cryptoRng) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export const isWild = (card) => card.color === 'wild';

/** Official scoring values. */
export function cardPoints(card) {
  if (isWild(card)) return 50;
  if (ACTION_VALUES.includes(card.value)) return 20;
  return Number(card.value);
}

/** Basic matching rule (Wild Draw Four legality is handled by the challenge). */
export function matches(card, topCard, currentColor) {
  if (isWild(card)) return true;
  if (card.color === currentColor) return true;
  return !isWild(topCard) && card.value === topCard.value;
}

export function describeCard(card) {
  const names = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };
  const value = names[card.value] ?? card.value;
  return isWild(card) ? value : `${card.color[0].toUpperCase()}${card.color.slice(1)} ${value}`;
}
