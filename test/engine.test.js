import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cardPoints, createDeck, shuffle } from '../server/engine/cards.js';
import { Game } from '../server/engine/game.js';

let seq = 0;
const c = (color, value) => ({ id: `t${seq++}`, color, value });
const keepOrder = (max) => max - 1; // rng that makes shuffle a no-op

/** Build an n-player game whose state we then overwrite for a focused scenario. */
function setup(n, { top = c('red', '5'), color, hands = [], drawPile } = {}) {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const g = new Game({ playerIds: ids, dealerIndex: n - 1 });
  g.start();
  g.drainEvents();
  ids.forEach((id, i) => {
    if (hands[i]) g.hands.set(id, hands[i]);
  });
  g.discardPile = [top];
  g.currentColor = color ?? top.color;
  g.currentIndex = 0;
  g.direction = 1;
  g.pending = null;
  g.drawnCardId = null;
  if (drawPile) g.drawPile = drawPile;
  return { g, ids };
}

/** Game where the flipped starter is a specific card (deck order preserved). */
function startWith(starter, n) {
  const filler = createDeck().filter((x) => x.value !== 'wild4' && !['skip', 'reverse', 'draw2', 'wild'].includes(x.value));
  const deck = [...filler.slice(0, 20), starter, ...filler.slice(20, 20 + 7 * n)];
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const g = new Game({ playerIds: ids, dealerIndex: 0, rng: keepOrder });
  g.start(deck);
  return { g, ids };
}

describe('deck', () => {
  test('has the official 108 card composition', () => {
    const deck = createDeck();
    assert.equal(deck.length, 108);
    assert.equal(new Set(deck.map((x) => x.id)).size, 108);
    const count = (pred) => deck.filter(pred).length;
    assert.equal(count((x) => x.value === '0'), 4);
    assert.equal(count((x) => x.value === '7'), 8);
    assert.equal(count((x) => x.value === 'skip'), 8);
    assert.equal(count((x) => x.value === 'reverse'), 8);
    assert.equal(count((x) => x.value === 'draw2'), 8);
    assert.equal(count((x) => x.value === 'wild'), 4);
    assert.equal(count((x) => x.value === 'wild4'), 4);
  });

  test('shuffle is a permutation', () => {
    const deck = createDeck();
    const shuffled = shuffle([...deck]);
    assert.deepEqual(new Set(shuffled.map((x) => x.id)), new Set(deck.map((x) => x.id)));
  });

  test('scoring values', () => {
    assert.equal(cardPoints(c('red', '7')), 7);
    assert.equal(cardPoints(c('red', 'skip')), 20);
    assert.equal(cardPoints(c('wild', 'wild4')), 50);
  });
});

describe('setup', () => {
  for (const n of [2, 3, 4, 8]) {
    test(`deals 7 cards to each of ${n} players`, () => {
      const g = new Game({ playerIds: Array.from({ length: n }, (_, i) => `p${i}`) });
      g.start();
      const extra = g.topCard.value === 'draw2' ? 2 : 0; // starter Draw Two hits the first player
      const sizes = [...g.hands.values()].map((h) => h.length).sort();
      assert.deepEqual(sizes, [...Array(n - 1).fill(7), 7 + extra].sort());
      assert.equal(g.discardPile.length, 1);
      const total = g.drawPile.length + g.discardPile.length + [...g.hands.values()].reduce((s, h) => s + h.length, 0);
      assert.equal(total, 108);
    });
  }

  test('starter is never a Wild Draw Four', () => {
    for (let i = 0; i < 300; i++) {
      const g = new Game({ playerIds: ['a', 'b'] });
      g.start();
      assert.notEqual(g.topCard.value, 'wild4');
    }
  });

  test('starter Skip skips the first player', () => {
    const { g } = startWith(c('blue', 'skip'), 3);
    assert.equal(g.currentPlayerId, 'p2');
  });

  test('starter Reverse (3p) reverses and dealer starts', () => {
    const { g } = startWith(c('blue', 'reverse'), 3);
    assert.equal(g.direction, -1);
    assert.equal(g.currentPlayerId, 'p0');
  });

  test('starter Draw Two makes first player draw 2 and lose turn', () => {
    const { g } = startWith(c('green', 'draw2'), 3);
    assert.equal(g.hands.get('p1').length, 9);
    assert.equal(g.currentPlayerId, 'p2');
  });

  test('starter Wild lets first player choose colour', () => {
    const { g } = startWith(c('wild', 'wild'), 3);
    assert.deepEqual(g.pending, { type: 'chooseColor', playerId: 'p1' });
    assert.throws(() => g.play('p1', g.hands.get('p1')[0].id), { code: 'PENDING_ACTION' });
    g.chooseColor('p1', 'green');
    assert.equal(g.currentColor, 'green');
    assert.equal(g.pending, null);
  });
});

describe('basic play', () => {
  test('matching colour or value is valid, otherwise invalid', () => {
    const red7 = c('red', '7');
    const blue5 = c('blue', '5');
    const blue9 = c('blue', '9');
    const { g } = setup(3, { top: c('red', '5'), hands: [[red7, blue5, blue9, c('green', '1')]] });
    assert.throws(() => g.play('p0', blue9.id), { code: 'INVALID_MOVE' });
    assert.deepEqual(new Set(g.playableIds('p0')), new Set([red7.id, blue5.id]));
    g.play('p0', blue5.id);
    assert.equal(g.currentColor, 'blue');
    assert.equal(g.currentPlayerId, 'p1');
  });

  test('cannot play out of turn or a card not in hand', () => {
    const { g } = setup(3);
    const p1Card = g.hands.get('p1')[0];
    assert.throws(() => g.play('p1', p1Card.id), { code: 'NOT_YOUR_TURN' });
    assert.throws(() => g.play('p0', p1Card.id), { code: 'NOT_IN_HAND' });
    assert.throws(() => g.play('ghost', 'x'), { code: 'NOT_IN_GAME' });
  });

  test('Skip skips next player', () => {
    const skip = c('red', 'skip');
    const { g } = setup(4, { hands: [[skip, c('blue', '1')]] });
    g.play('p0', skip.id);
    assert.equal(g.currentPlayerId, 'p2');
  });

  test('Reverse with 2 players acts like Skip', () => {
    const rev = c('red', 'reverse');
    const { g } = setup(2, { hands: [[rev, c('blue', '1')]] });
    g.play('p0', rev.id);
    assert.equal(g.currentPlayerId, 'p0');
    assert.equal(g.direction, 1);
  });

  test('Reverse with 3+ players changes direction', () => {
    const rev = c('red', 'reverse');
    const { g } = setup(4, { hands: [[rev, c('blue', '1')]] });
    g.play('p0', rev.id);
    assert.equal(g.direction, -1);
    assert.equal(g.currentPlayerId, 'p3');
  });

  test('Draw Two: next player draws 2 and loses turn', () => {
    const d2 = c('red', 'draw2');
    const { g } = setup(3, { hands: [[d2, c('blue', '1')], [c('green', '3')]] });
    g.play('p0', d2.id);
    assert.equal(g.hands.get('p1').length, 3);
    assert.equal(g.currentPlayerId, 'p2');
  });

  test('Wild requires and sets a colour', () => {
    const wild = c('wild', 'wild');
    const { g } = setup(3, { hands: [[wild, c('blue', '1')]] });
    assert.throws(() => g.play('p0', wild.id), { code: 'COLOR_REQUIRED' });
    assert.throws(() => g.play('p0', wild.id, 'purple'), { code: 'COLOR_REQUIRED' });
    g.play('p0', wild.id, 'yellow');
    assert.equal(g.currentColor, 'yellow');
    assert.equal(g.currentPlayerId, 'p1');
  });
});

describe('Wild Draw Four + challenge', () => {
  const scenario = (legal) => {
    const w4 = c('wild', 'wild4');
    const other = legal ? c('blue', '2') : c('red', '2'); // red = current colour → illegal
    const { g } = setup(3, { top: c('red', '5'), hands: [[w4, other, c('green', '8')], [c('green', '1'), c('yellow', '1')]] });
    g.play('p0', w4.id, 'green');
    return g;
  };

  test('puts the next player into a challenge decision', () => {
    const g = scenario(true);
    assert.equal(g.currentPlayerId, 'p1');
    assert.equal(g.pending.type, 'challenge');
    assert.throws(() => g.draw('p1'), { code: 'PENDING_ACTION' });
    assert.throws(() => g.challenge('p2'), { code: 'NO_PENDING' });
  });

  test('accept: draw 4 and lose turn', () => {
    const g = scenario(true);
    g.accept('p1');
    assert.equal(g.hands.get('p1').length, 6);
    assert.equal(g.currentPlayerId, 'p2');
  });

  test('failed challenge (legal +4): challenger draws 6 and loses turn', () => {
    const g = scenario(true);
    g.challenge('p1');
    assert.equal(g.hands.get('p1').length, 8);
    assert.equal(g.currentPlayerId, 'p2');
    const reveal = g.drainEvents().find((e) => e.type === 'reveal');
    assert.equal(reveal.to, 'p1');
  });

  test('successful challenge (illegal +4): offender draws 4, challenger plays', () => {
    const g = scenario(false);
    g.challenge('p1');
    assert.equal(g.hands.get('p0').length, 6);
    assert.equal(g.hands.get('p1').length, 2);
    assert.equal(g.currentPlayerId, 'p1');
    assert.equal(g.currentColor, 'green');
  });
});

describe('drawing', () => {
  test('unplayable drawn card ends the turn', () => {
    const { g } = setup(3, { top: c('red', '5'), hands: [[c('blue', '1')]], drawPile: [c('green', '9')] });
    g.draw('p0');
    assert.equal(g.hands.get('p0').length, 2);
    assert.equal(g.currentPlayerId, 'p1');
  });

  test('playable drawn card may be played (only that card) or passed', () => {
    const red1 = c('red', '1');
    const drawn = c('red', '9');
    const { g } = setup(3, { top: c('red', '5'), hands: [[red1]], drawPile: [drawn] });
    g.draw('p0');
    assert.equal(g.currentPlayerId, 'p0');
    assert.equal(g.drawnCardId, drawn.id);
    assert.throws(() => g.draw('p0'), { code: 'ALREADY_DREW' });
    assert.throws(() => g.play('p0', red1.id), { code: 'MUST_PLAY_DRAWN' });
    g.play('p0', drawn.id);
    assert.equal(g.currentPlayerId, 'p1');
  });

  test('pass after drawing a playable card', () => {
    const { g } = setup(3, { top: c('red', '5'), hands: [[c('blue', '1')]], drawPile: [c('red', '9')] });
    assert.throws(() => g.pass('p0'), { code: 'CANNOT_PASS' });
    g.draw('p0');
    g.pass('p0');
    assert.equal(g.currentPlayerId, 'p1');
  });

  test('reshuffles discard pile (minus top) when the draw pile is empty', () => {
    const top = c('red', '5');
    const { g } = setup(3, { top, hands: [[c('blue', '1')], [c('blue', '2')]], drawPile: [] });
    g.discardPile = [c('green', '1'), c('green', '2'), c('green', '3'), top];
    g.draw('p0');
    assert.equal(g.discardPile.length, 1);
    assert.equal(g.topCard, top);
    assert.equal(g.hands.get('p0').length, 2);
    assert.equal(g.drawPile.length, 2);
    assert.ok(g.drainEvents().some((e) => e.type === 'reshuffle'));
  });

  test('drawing with no cards anywhere just passes', () => {
    const { g } = setup(2, { hands: [[c('blue', '1')]], drawPile: [] });
    g.draw('p0');
    assert.equal(g.currentPlayerId, 'p1');
  });
});

describe('UNO', () => {
  test('player can call UNO before playing their second-to-last card', () => {
    const red1 = c('red', '1');
    const { g } = setup(3, { hands: [[red1, c('blue', '9')]] });
    g.callUno('p0');
    g.play('p0', red1.id);
    assert.equal(g.unoVulnerableId, null);
    assert.throws(() => g.catchUno('p1', 'p0'), { code: 'CANNOT_CATCH' });
  });

  test('forgetting UNO can be caught for a 2 card penalty', () => {
    const red1 = c('red', '1');
    const { g } = setup(3, { hands: [[red1, c('blue', '9')]] });
    g.play('p0', red1.id);
    assert.equal(g.unoVulnerableId, 'p0');
    g.catchUno('p2', 'p0');
    assert.equal(g.hands.get('p0').length, 3);
  });

  test('late UNO call before being caught is safe', () => {
    const red1 = c('red', '1');
    const { g } = setup(3, { hands: [[red1, c('blue', '9')]] });
    g.play('p0', red1.id);
    g.callUno('p0');
    assert.throws(() => g.catchUno('p1', 'p0'), { code: 'CANNOT_CATCH' });
  });

  test('catch window closes once the next player acts', () => {
    const red1 = c('red', '1');
    const { g } = setup(3, { hands: [[red1, c('blue', '9')]] });
    g.play('p0', red1.id);
    g.draw('p1');
    assert.throws(() => g.catchUno('p2', 'p0'), { code: 'CANNOT_CATCH' });
  });

  test('cannot call UNO with many cards', () => {
    const { g } = setup(3, { hands: [[c('red', '1'), c('red', '2'), c('red', '3')]] });
    assert.throws(() => g.callUno('p0'), { code: 'CANNOT_UNO' });
  });
});

describe('winning', () => {
  test('emptying the hand ends the round and scores opponents cards', () => {
    const last = c('red', '1');
    const { g } = setup(3, { hands: [[last], [c('blue', '9'), c('wild', 'wild')], [c('green', 'skip')]] });
    g.play('p0', last.id);
    assert.equal(g.over, true);
    assert.equal(g.winnerId, 'p0');
    assert.equal(g.points, 9 + 50 + 20);
    assert.throws(() => g.draw('p1'), { code: 'ROUND_OVER' });
  });

  test('final Draw Two still makes the next player draw', () => {
    const last = c('red', 'draw2');
    const { g } = setup(2, { hands: [[last], [c('blue', '1')]], drawPile: [c('blue', '2'), c('blue', '3')] });
    g.play('p0', last.id);
    assert.equal(g.hands.get('p1').length, 3);
    assert.equal(g.points, 6);
  });
});

describe('timeout & leaving', () => {
  test('timeout draws and passes', () => {
    const { g } = setup(3, { top: c('red', '5'), hands: [[c('blue', '1')]], drawPile: [c('red', '9')] });
    g.timeout();
    assert.equal(g.hands.get('p0').length, 2);
    assert.equal(g.currentPlayerId, 'p1');
  });

  test('timeout during challenge accepts the +4', () => {
    const w4 = c('wild', 'wild4');
    const { g } = setup(3, { hands: [[w4, c('blue', '1')], [c('green', '1')]] });
    g.play('p0', w4.id, 'blue');
    g.timeout();
    assert.equal(g.hands.get('p1').length, 5);
    assert.equal(g.currentPlayerId, 'p2');
  });

  test('current player leaving passes the turn to the next seat', () => {
    const { g } = setup(4);
    const before = g.drawPile.length;
    g.removePlayer('p0');
    assert.equal(g.currentPlayerId, 'p1');
    assert.equal(g.order.length, 3);
    assert.equal(g.drawPile.length, before + 7);
  });

  test('last opponent leaving ends the round', () => {
    const { g } = setup(2);
    g.removePlayer('p1');
    assert.equal(g.over, true);
    assert.equal(g.winnerId, 'p0');
  });
});
