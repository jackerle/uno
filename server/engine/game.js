// Authoritative UNO round engine (official-style rules).
// The Game owns all hidden information (hands, draw pile). Every mutation goes
// through a validated action method; results are emitted as events that the
// room layer sanitises per viewer before broadcasting.
import { COLORS, cardPoints, createDeck, cryptoRng, isWild, matches, shuffle } from './cards.js';

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new GameError(code, message);
};

export class Game {
  /**
   * @param {object} opts
   * @param {string[]} opts.playerIds seating order (play order when direction = 1)
   * @param {number} [opts.dealerIndex]
   * @param {number} [opts.handSize]
   * @param {(max:number)=>number} [opts.rng]
   */
  constructor({ playerIds, dealerIndex = 0, handSize = 7, rng = cryptoRng }) {
    if (!Array.isArray(playerIds) || playerIds.length < 2) fail('NOT_ENOUGH_PLAYERS', 'Need at least 2 players');
    this.rng = rng;
    this.order = [...playerIds];
    this.dealerIndex = dealerIndex % this.order.length;
    this.handSize = handSize;
    this.hands = new Map(this.order.map((id) => [id, []]));
    this.drawPile = [];
    this.discardPile = [];
    this.direction = 1;
    this.currentIndex = 0;
    this.currentColor = null;
    /** @type {null | {type:'challenge', playerId:string, offenderId:string, wasLegal:boolean, prevColor:string} | {type:'chooseColor', playerId:string}} */
    this.pending = null;
    this.drawnCardId = null; // card drawn this turn that may be played
    this.unoCalled = new Set();
    this.unoVulnerableId = null; // player who reached 1 card without calling UNO
    this.winnerId = null;
    this.over = false;
    this.endReason = null;
    this.turnKey = 0; // bumps whenever the player expected to act changes
    this.events = [];
  }

  // ---------------------------------------------------------------- helpers
  get currentPlayerId() {
    return this.order[this.currentIndex];
  }

  get topCard() {
    return this.discardPile[this.discardPile.length - 1];
  }

  handOf(playerId) {
    const hand = this.hands.get(playerId);
    if (!hand) fail('NOT_IN_GAME', 'You are not in this game');
    return hand;
  }

  step(fromIndex, steps = 1) {
    const n = this.order.length;
    return (((fromIndex + steps * this.direction) % n) + n) % n;
  }

  emit(event) {
    this.events.push(event);
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  setTurn(index) {
    this.currentIndex = index;
    this.drawnCardId = null;
    this.turnKey++;
    this.emit({ type: 'turn', playerId: this.currentPlayerId });
  }

  assertActive() {
    if (this.over) fail('ROUND_OVER', 'The round is over');
  }

  assertTurn(playerId) {
    this.assertActive();
    this.handOf(playerId);
    if (this.currentPlayerId !== playerId) fail('NOT_YOUR_TURN', 'It is not your turn');
  }

  /** Any action by a player closes the previous player's "catch UNO" window. */
  noteAction(playerId) {
    if (this.unoVulnerableId && this.unoVulnerableId !== playerId) this.unoVulnerableId = null;
  }

  isPlayable(card, playerId = this.currentPlayerId) {
    if (this.over || this.pending || playerId !== this.currentPlayerId) return false;
    if (this.drawnCardId && card.id !== this.drawnCardId) return false;
    return matches(card, this.topCard, this.currentColor);
  }

  playableIds(playerId) {
    const hand = this.hands.get(playerId);
    if (!hand) return [];
    return hand.filter((c) => this.isPlayable(c, playerId)).map((c) => c.id);
  }

  reshuffle() {
    if (this.discardPile.length <= 1) return false;
    const top = this.discardPile.pop();
    this.drawPile = shuffle(this.discardPile, this.rng);
    this.discardPile = [top];
    this.emit({ type: 'reshuffle', count: this.drawPile.length });
    return true;
  }

  drawCards(playerId, count, reason) {
    const hand = this.handOf(playerId);
    const cards = [];
    for (let i = 0; i < count; i++) {
      if (this.drawPile.length === 0 && !this.reshuffle()) break;
      cards.push(this.drawPile.pop());
    }
    hand.push(...cards);
    if (hand.length > 1) this.unoCalled.delete(playerId);
    if (this.unoVulnerableId === playerId && hand.length > 1) this.unoVulnerableId = null;
    this.emit({ type: 'draw', playerId, cards, count: cards.length, reason });
    return cards;
  }

  // ------------------------------------------------------------------ setup
  start(deck = createDeck()) {
    this.drawPile = shuffle([...deck], this.rng);
    const n = this.order.length;
    for (let round = 0; round < this.handSize; round++) {
      for (let k = 1; k <= n; k++) {
        const pid = this.order[(this.dealerIndex + k) % n];
        this.hands.get(pid).push(this.drawPile.pop());
      }
    }
    // Flip starter; a Wild Draw Four is returned to the deck and reshuffled.
    let starter = this.drawPile.pop();
    while (starter.value === 'wild4') {
      this.drawPile.push(starter);
      shuffle(this.drawPile, this.rng);
      starter = this.drawPile.pop();
    }
    this.discardPile.push(starter);
    this.emit({ type: 'deal', dealerId: this.order[this.dealerIndex], handSize: this.handSize, starter });

    const dealer = this.dealerIndex;
    this.currentIndex = dealer;
    if (isWild(starter)) {
      // Player to the dealer's left picks the colour, then plays.
      this.setTurn(this.step(dealer, 1));
      this.pending = { type: 'chooseColor', playerId: this.currentPlayerId };
      return;
    }
    this.currentColor = starter.color;
    switch (starter.value) {
      case 'skip':
        this.emit({ type: 'skip', playerId: this.order[this.step(dealer, 1)] });
        this.setTurn(this.step(dealer, 2));
        break;
      case 'reverse':
        if (n === 2) {
          this.emit({ type: 'skip', playerId: this.order[this.step(dealer, 1)] });
          this.setTurn(this.step(dealer, 2));
        } else {
          this.direction = -1;
          this.emit({ type: 'reverse', direction: this.direction });
          this.setTurn(dealer); // dealer starts, play moves to the right
        }
        break;
      case 'draw2': {
        const victim = this.order[this.step(dealer, 1)];
        this.drawCards(victim, 2, 'draw2');
        this.emit({ type: 'skip', playerId: victim });
        this.setTurn(this.step(dealer, 2));
        break;
      }
      default:
        this.setTurn(this.step(dealer, 1));
    }
  }

  // ---------------------------------------------------------------- actions
  play(playerId, cardId, chosenColor) {
    this.assertTurn(playerId);
    if (this.pending) fail('PENDING_ACTION', this.pending.type === 'challenge' ? 'Resolve the Wild Draw Four first' : 'Choose a colour first');
    const hand = this.handOf(playerId);
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) fail('NOT_IN_HAND', 'That card is not in your hand');
    const card = hand[idx];
    if (this.drawnCardId && card.id !== this.drawnCardId) fail('MUST_PLAY_DRAWN', 'You can only play the card you just drew');
    if (!matches(card, this.topCard, this.currentColor)) fail('INVALID_MOVE', 'That card does not match');
    if (isWild(card) && !COLORS.includes(chosenColor)) fail('COLOR_REQUIRED', 'Choose a colour for the Wild card');

    // Wild Draw Four is only legal when you hold no card of the current colour.
    const wasLegal = card.value !== 'wild4' || !hand.some((c) => c.id !== card.id && c.color === this.currentColor);
    const prevColor = this.currentColor;

    this.noteAction(playerId);
    hand.splice(idx, 1);
    this.discardPile.push(card);
    this.currentColor = isWild(card) ? chosenColor : card.color;
    this.drawnCardId = null;
    this.emit({ type: 'play', playerId, card, color: this.currentColor });

    if (hand.length === 1) {
      if (!this.unoCalled.has(playerId)) this.unoVulnerableId = playerId;
    } else {
      this.unoCalled.delete(playerId);
    }

    const cur = this.currentIndex;
    if (hand.length === 0) {
      // Final Draw Two / Wild Draw Four still hits the next player (counts for scoring).
      if (card.value === 'draw2') this.drawCards(this.order[this.step(cur, 1)], 2, 'draw2');
      if (card.value === 'wild4') this.drawCards(this.order[this.step(cur, 1)], 4, 'wild4');
      this.endRound(playerId, 'empty_hand');
      return;
    }

    const n = this.order.length;
    switch (card.value) {
      case 'skip':
        this.emit({ type: 'skip', playerId: this.order[this.step(cur, 1)] });
        this.setTurn(this.step(cur, 2));
        break;
      case 'reverse':
        if (n === 2) {
          this.emit({ type: 'skip', playerId: this.order[this.step(cur, 1)] });
          this.setTurn(this.step(cur, 2));
        } else {
          this.direction *= -1;
          this.emit({ type: 'reverse', direction: this.direction });
          this.setTurn(this.step(cur, 1));
        }
        break;
      case 'draw2': {
        const victim = this.order[this.step(cur, 1)];
        this.drawCards(victim, 2, 'draw2');
        this.emit({ type: 'skip', playerId: victim });
        this.setTurn(this.step(cur, 2));
        break;
      }
      case 'wild4': {
        const target = this.step(cur, 1);
        this.setTurn(target);
        this.pending = { type: 'challenge', playerId: this.order[target], offenderId: playerId, wasLegal, prevColor };
        this.emit({ type: 'wild4Pending', playerId: this.order[target], offenderId: playerId });
        break;
      }
      default:
        this.setTurn(this.step(cur, 1));
    }
  }

  draw(playerId) {
    this.assertTurn(playerId);
    if (this.pending) fail('PENDING_ACTION', 'Resolve the pending action first');
    if (this.drawnCardId) fail('ALREADY_DREW', 'You already drew this turn — play it or pass');
    this.noteAction(playerId);
    const [card] = this.drawCards(playerId, 1, 'draw');
    if (card && matches(card, this.topCard, this.currentColor)) {
      this.drawnCardId = card.id; // player may play it or pass
      this.turnKey++;
    } else {
      this.emit({ type: 'pass', playerId });
      this.setTurn(this.step(this.currentIndex, 1));
    }
  }

  pass(playerId) {
    this.assertTurn(playerId);
    if (!this.drawnCardId) fail('CANNOT_PASS', 'You must play or draw first');
    this.noteAction(playerId);
    this.emit({ type: 'pass', playerId });
    this.setTurn(this.step(this.currentIndex, 1));
  }

  callUno(playerId) {
    this.assertActive();
    const hand = this.handOf(playerId);
    const canPreCall = hand.length === 2 && this.currentPlayerId === playerId && !this.pending && this.playableIds(playerId).length > 0;
    if (!(hand.length === 1 || canPreCall)) fail('CANNOT_UNO', 'You can only call UNO when going down to one card');
    if (this.unoCalled.has(playerId)) fail('ALREADY_CALLED', 'You already called UNO');
    this.unoCalled.add(playerId);
    if (this.unoVulnerableId === playerId) this.unoVulnerableId = null;
    this.emit({ type: 'uno', playerId });
  }

  catchUno(playerId, targetId) {
    this.assertActive();
    this.handOf(playerId);
    if (playerId === targetId) fail('BAD_REQUEST', 'You cannot catch yourself');
    if (this.unoVulnerableId !== targetId) fail('CANNOT_CATCH', 'Too late — nothing to catch');
    this.unoVulnerableId = null;
    this.emit({ type: 'caught', playerId: targetId, by: playerId });
    this.drawCards(targetId, 2, 'uno_penalty');
  }

  challenge(playerId) {
    const p = this.requirePending(playerId, 'challenge');
    this.noteAction(playerId);
    this.pending = null;
    const offenderHand = this.hands.get(p.offenderId);
    // The challenged player shows their hand to the challenger only.
    this.emit({ type: 'reveal', to: playerId, playerId: p.offenderId, cards: offenderHand ? [...offenderHand] : [] });
    if (!p.wasLegal) {
      this.emit({ type: 'challenge', playerId, offenderId: p.offenderId, success: true });
      if (offenderHand) this.drawCards(p.offenderId, 4, 'challenge_penalty');
      this.turnKey++; // challenger now takes a normal turn
    } else {
      this.emit({ type: 'challenge', playerId, offenderId: p.offenderId, success: false });
      this.drawCards(playerId, 6, 'challenge_failed');
      this.emit({ type: 'skip', playerId });
      this.setTurn(this.step(this.currentIndex, 1));
    }
  }

  accept(playerId) {
    this.requirePending(playerId, 'challenge');
    this.noteAction(playerId);
    this.pending = null;
    this.drawCards(playerId, 4, 'wild4');
    this.emit({ type: 'skip', playerId });
    this.setTurn(this.step(this.currentIndex, 1));
  }

  chooseColor(playerId, color) {
    this.requirePending(playerId, 'chooseColor');
    if (!COLORS.includes(color)) fail('BAD_REQUEST', 'Unknown colour');
    this.pending = null;
    this.currentColor = color;
    this.turnKey++;
    this.emit({ type: 'color', playerId, color });
  }

  requirePending(playerId, type) {
    this.assertActive();
    this.handOf(playerId);
    if (!this.pending || this.pending.type !== type || this.pending.playerId !== playerId) {
      fail('NO_PENDING', type === 'challenge' ? 'There is no Wild Draw Four to answer' : 'No colour to choose');
    }
    return this.pending;
  }

  /** Automatic action when the turn timer expires. */
  timeout() {
    if (this.over) return;
    const pid = this.currentPlayerId;
    this.emit({ type: 'timeout', playerId: pid });
    if (this.pending?.type === 'challenge') return this.accept(pid);
    if (this.pending?.type === 'chooseColor') return this.chooseColor(pid, COLORS[this.rng(COLORS.length)]);
    if (this.drawnCardId) return this.pass(pid);
    this.draw(pid);
    if (this.drawnCardId && !this.over) this.pass(pid);
  }

  /** A player left mid-round: their cards go to the bottom of the draw pile. */
  removePlayer(playerId) {
    const idx = this.order.indexOf(playerId);
    if (idx === -1) return;
    const hand = this.hands.get(playerId) ?? [];
    this.drawPile.unshift(...hand);
    this.hands.delete(playerId);
    this.unoCalled.delete(playerId);
    if (this.unoVulnerableId === playerId) this.unoVulnerableId = null;
    const wasCurrent = idx === this.currentIndex;
    this.order.splice(idx, 1);
    this.emit({ type: 'left', playerId });

    if (this.over) return;
    if (this.order.length < 2) {
      this.endRound(this.order[0], 'forfeit');
      return;
    }
    if (this.pending?.playerId === playerId) this.pending = null;
    if (this.pending?.type === 'challenge' && this.pending.offenderId === playerId) this.pending.wasLegal = true;

    const n = this.order.length;
    if (wasCurrent) {
      // The seat after the leaver now acts.
      const next = this.direction === 1 ? idx % n : (idx - 1 + n) % n;
      this.setTurn(next);
    } else if (idx < this.currentIndex) {
      this.currentIndex--;
    }
  }

  endRound(winnerId, reason) {
    this.over = true;
    this.winnerId = winnerId;
    this.endReason = reason;
    this.pending = null;
    this.drawnCardId = null;
    this.unoVulnerableId = null;
    let points = 0;
    for (const [pid, hand] of this.hands) {
      if (pid !== winnerId) points += hand.reduce((sum, c) => sum + cardPoints(c), 0);
    }
    this.points = points;
    this.turnKey++;
    this.emit({ type: 'roundEnd', winnerId, points, reason });
  }
}
