// Game screen orchestrator: table, seats, piles, hand, controls, overlays and
// event-driven animations. All rules are decided by the server — this only
// renders the authoritative state and sends intents.
import { audio } from '../core/audio.js';
import { announce, cardLabel, clock, COLOR_HEX, COLOR_NAMES, h, hash, icon, prefersReducedMotion, sleep, svg } from '../core/util.js';
import { createCard, createCardBack } from './Card.js';
import { ChallengeModal } from './ChallengeModal.js';
import { openColorPicker } from './ColorPicker.js';
import { burst, confetti, flyCard, ripple, shake } from './fx.js';
import { describeEvent, GameLog } from './GameLog.js';
import { GameResult } from './GameResult.js';
import { UnoLogo } from './HomeScreen.js';
import { playIntro } from './Intro.js';
import { PlayerAvatar } from './PlayerAvatar.js';
import { PlayerHand } from './PlayerHand.js';
import { PlayerSeat } from './PlayerSeat.js';
import { toast, toastError } from './Toasts.js';

const SOFT = { red: 'rgba(255,61,85,.38)', yellow: 'rgba(255,204,46,.32)', green: 'rgba(33,199,118,.34)', blue: 'rgba(46,133,255,.38)' };
const PLAY_SOUND = { skip: 'skip', reverse: 'reverse', draw2: 'draw2', wild: 'wild', wild4: 'wild4' };

const DIRECTION_RING = `<svg class="direction-ring" viewBox="0 0 200 200" aria-hidden="true">
  <defs><marker id="dir-head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
  <path d="M0 0 10 5 0 10z" fill="currentColor"/></marker></defs>
  <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
  <path d="M100 8a92 92 0 0 1 80 46" marker-end="url(#dir-head)"/>
  <path d="M192 100a92 92 0 0 1-46 80" marker-end="url(#dir-head)"/>
  <path d="M100 192a92 92 0 0 1-80-46" marker-end="url(#dir-head)"/>
  <path d="M8 100a92 92 0 0 1 46-80" marker-end="url(#dir-head)"/></g></svg>`;

const MY_RING = `<svg class="seat-ring" viewBox="0 0 100 100" aria-hidden="true">
  <circle class="seat-ring-track" cx="50" cy="50" r="46" pathLength="100"/>
  <circle class="seat-ring-fill" cx="50" cy="50" r="46" pathLength="100"/></svg>`;

export class GameBoard {
  constructor({ request, onLeave }) {
    this.request = request;
    this.onLeave = onLeave;
    this.state = null;
    this.seats = new Map();
    this.names = new Map();
    this.introRound = 0;
    this.dealing = false;
    this.discardKey = '';
    this.landingHold = 0; // >0 while a card is flying onto the discard pile
    this.dragLanding = null;
    this.resultTimer = 0;
    this.lastTickSecond = -1;
    this.raf = 0;
    this.pickingStartColor = false;
    this.busy = false;

    this.build();
    this.challenge = new ChallengeModal({
      onChallenge: () => this.act('challenge'),
      onAccept: () => this.act('accept'),
    });
    this.result = new GameResult({
      onNext: () => this.act('nextRound'),
      onLobby: () => this.act('backToLobby'),
      onLeave: () => this.confirmLeave(),
    });
    this.onKey = (e) => this.handleKey(e);
    document.addEventListener('keydown', this.onKey);
    this.resizeObs = new ResizeObserver(() => this.layoutSeats());
    this.resizeObs.observe(this.boardEl);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.resultTimer);
    document.removeEventListener('keydown', this.onKey);
    this.resizeObs.disconnect();
    this.challenge.close();
    this.result.hide();
    openColorPicker.close?.();
    document.getElementById('fx-layer').replaceChildren();
    document.documentElement.style.removeProperty('--cur');
    document.documentElement.style.removeProperty('--cur-soft');
  }

  async act(t, data) {
    const res = await this.request(t, data);
    if (!res.ok) {
      audio.play('error');
      toastError(res.error);
    }
    return res.ok;
  }

  // ------------------------------------------------------------------ DOM
  build() {
    this.roomChip = h('span.room-chip');
    this.roundInfo = h('span.round-info');
    this.soundBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Toggle sound', 'aria-pressed': String(audio.enabled) }, icon(audio.enabled ? 'sound' : 'mute'));
    this.soundBtn.addEventListener('click', () => {
      audio.unlock();
      audio.setEnabled(!audio.enabled);
      this.soundBtn.setAttribute('aria-pressed', String(audio.enabled));
      this.soundBtn.replaceChildren(icon(audio.enabled ? 'sound' : 'mute'));
    });
    this.log = new GameLog();
    this.logBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Game log (L)', 'aria-pressed': 'false', onclick: () => this.toggleLog() }, icon('log'));
    const topbar = h(
      'header.topbar',
      h('div.topbar-left', UnoLogo({ size: 'xs' }), this.roomChip, this.roundInfo),
      h('div.topbar-right', this.logBtn, this.soundBtn, h('button.icon-btn', { type: 'button', 'aria-label': 'Leave game', onclick: () => this.confirmLeave() }, icon('exit'))),
    );

    // Table + centre
    this.statusEl = h('div.turn-status', { 'aria-hidden': 'true' });
    this.tickerEl = h('div.ticker', { 'aria-hidden': 'true' });
    this.drawCount = h('span.pile-count');
    this.drawPile = h(
      'button.draw-pile',
      { type: 'button', 'aria-label': 'Draw a card (D)' },
      h('div.pile-stack', createCardBack(), createCardBack(), createCardBack()),
      this.drawCount,
      h('span.pile-label', 'Draw'),
    );
    this.drawPile.addEventListener('click', () => this.drawCard());
    this.discardStack = h('div.discard-stack');
    this.colorChip = h('span.color-chip');
    this.discardZone = h(
      'button.discard-zone',
      { type: 'button' },
      h('span.discard-halo', { 'aria-hidden': 'true' }),
      this.discardStack,
      h('span.drop-hint', { 'aria-hidden': 'true' }, 'Drop to play'),
    );
    this.discardZone.addEventListener('click', () => this.onDiscardClick());
    this.directionEl = svg(DIRECTION_RING);

    this.seatLayer = h('div.seat-layer');
    this.boardEl = h(
      'section.board',
      { 'aria-label': 'Game table' },
      h('div.table', { 'aria-hidden': 'true' }, h('div.table-rim'), h('div.table-felt'), h('div.table-shine')),
      h('div.table-center', this.directionEl, h('div.center-top', this.statusEl, this.tickerEl), h('div.piles', this.drawPile, this.discardZone), this.colorChip),
      this.seatLayer,
    );

    // Hand zone
    this.hand = new PlayerHand({
      getDropZone: () => this.discardZone,
      onPlay: (id, opts) => this.playCard(id, opts),
      onInvalid: (id, code) => {
        audio.play('error');
        if (code === 'NOT_YOUR_TURN') toastError({ code });
        else this.discardZone.classList.add('is-reject'), setTimeout(() => this.discardZone.classList.remove('is-reject'), 400);
      },
      onSelect: (id) => this.renderSelection(id),
    });

    this.myRing = svg(MY_RING);
    this.myRingFill = this.myRing.querySelector('.seat-ring-fill');
    this.myAvatarSlot = h('div.me-avatar', this.myRing);
    this.myName = h('span.me-name');
    this.myCount = h('span.me-count');
    this.mePlate = h('div.me-plate', this.myAvatarSlot, h('div.me-meta', this.myName, this.myCount));

    this.bannerText = h('span.banner-text');
    this.timerNum = h('span.banner-timer-num');
    this.timerEl = h('span.banner-timer', svg('<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="bt-track" cx="20" cy="20" r="17" pathLength="100"/><circle class="bt-fill" cx="20" cy="20" r="17" pathLength="100"/></svg>'), this.timerNum);
    this.timerFill = this.timerEl.querySelector('.bt-fill');
    this.banner = h('div.turn-banner', this.bannerText, this.timerEl);

    this.drawBtn = h('button.btn.btn--ghost.action-draw', { type: 'button', onclick: () => this.drawCard() }, 'Draw');
    this.passBtn = h('button.btn.btn--ghost.action-pass', { type: 'button', onclick: () => this.act('pass') }, 'Pass');
    this.playBtn = h('button.btn.btn--go.action-play', { type: 'button', hidden: true, onclick: () => this.hand.selectedId && this.playCard(this.hand.selectedId) });
    this.unoBtn = h('button.uno-btn', { type: 'button', 'aria-label': 'Call UNO (U)' }, h('span.uno-btn-ring'), h('span.uno-btn-text', 'UNO!'));
    this.unoBtn.addEventListener('click', () => this.callUno());

    this.handZone = h(
      'section.hand-zone',
      { 'aria-label': 'Your hand and actions' },
      h('div.hand-bar', this.mePlate, this.banner, h('div.hand-actions', this.playBtn, this.passBtn, this.drawBtn, this.unoBtn)),
      this.hand.el,
    );

    this.el = h('main.game', topbar, this.boardEl, this.handZone, this.log.el);
  }

  toggleLog(force) {
    const open = this.log.toggle(force);
    this.logBtn.setAttribute('aria-pressed', String(open));
  }

  confirmLeave() {
    const root = document.getElementById('overlay-root');
    if (root.querySelector('.overlay--confirm')) return;
    const close = () => {
      ov.classList.add('is-leaving');
      setTimeout(() => ov.remove(), 250);
    };
    const ov = h(
      'div.overlay.overlay--confirm',
      { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title' },
      h(
        'div.confirm.glass',
        h('h2.overlay-title#confirm-title', 'Leave the game?'),
        h('p.overlay-sub', 'Your seat and cards will be given up.'),
        h(
          'div.confirm-actions',
          h('button.btn.btn--ghost', { type: 'button', onclick: close }, 'Stay'),
          h('button.btn.btn--danger', { type: 'button', onclick: () => (close(), this.onLeave()) }, 'Leave'),
        ),
      ),
    );
    ov.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    root.append(ov);
    ov.querySelector('.btn').focus();
  }

  // ------------------------------------------------------------ helpers
  nameOf = (id) => this.names.get(id) ?? 'Someone';

  rectForPlayer(id) {
    if (id === this.state?.youId) return this.mePlate.getBoundingClientRect();
    return this.seats.get(id)?.el.querySelector('.seat-avatar').getBoundingClientRect() ?? null;
  }

  discardTopRect() {
    const top = this.discardStack.lastElementChild;
    return (top ?? this.discardZone).getBoundingClientRect();
  }

  // --------------------------------------------------------------- update
  update(state, events = []) {
    const prev = this.state;
    const g = state.game;
    if (!g) return;
    for (const p of state.players) this.names.set(p.id, p.name);

    // Capture positions before re-render (for cards leaving the hand by tap/keyboard).
    const prevHandRects = new Map();
    for (const e of events) if (e.type === 'play' && e.playerId === state.youId) prevHandRects.set(e.card.id, this.hand.rectOf(e.card.id));

    this.state = state;
    const me = state.players.find((p) => p.id === state.youId);
    const a = state.actions ?? {};

    // New round → intro + deal.
    const newRound = state.phase === 'STARTING' && this.introRound !== state.round;
    if (newRound) {
      this.introRound = state.round;
      this.hand.markIncoming(state.hand.map((c) => c.id));
      this.boardEl.classList.add('is-dealing');
      this.landingHold++;
      this.result.hide();
    }
    // Cards I drew this update fly in from the deck.
    const myDraws = events.filter((e) => e.type === 'draw' && e.playerId === state.youId && e.cards?.length);
    if (!newRound && !this.dealing) this.hand.markIncoming(myDraws.flatMap((e) => e.cards.map((c) => c.id)));

    // Table colour
    const color = g.currentColor;
    if (color) {
      document.documentElement.style.setProperty('--cur', COLOR_HEX[color]);
      document.documentElement.style.setProperty('--cur-soft', SOFT[color]);
    }
    this.boardEl.dataset.color = color ?? 'none';
    this.colorChip.dataset.color = color ?? 'none';
    this.colorChip.textContent = color ? COLOR_NAMES[color] : 'Choosing…';
    this.directionEl.classList.toggle('is-ccw', g.direction === -1);

    // Top bar
    this.roomChip.textContent = state.code;
    const target = state.settings.targetScore;
    this.roundInfo.textContent = `Round ${state.round}${target ? ` · First to ${target}` : ''}`;

    this.renderSeats(state);
    this.renderPiles(state);
    this.hand.update(state.hand, { playable: a.playable ?? [], myTurn: Boolean(a.isMyTurn) });
    this.renderMe(state, me);
    this.renderControls(state);
    this.renderSelection(this.hand.selectedId);
    this.log.update(state.log, this.nameOf, state.youId);
    const last = [...state.log].reverse().map((e) => describeEvent(e, this.nameOf, state.youId)).find(Boolean);
    this.tickerEl.textContent = last?.text ?? '';
    this.runTimer();

    // Phase-driven overlays
    if (newRound) this.startRoundSequence(state);
    this.syncModals(state, prev);
    this.animateEvents(events, prevHandRects);
  }

  renderSeats(state) {
    const g = state.game;
    const order = g.order;
    const myIdx = order.indexOf(state.youId);
    const opponents = [];
    for (let k = 1; k < order.length; k++) opponents.push(order[(Math.max(0, myIdx) + k) % order.length]);
    if (myIdx === -1) opponents.unshift(order[0]);
    const players = new Map(state.players.map((p) => [p.id, p]));
    const nextId = g.currentPlayerId && order[(order.indexOf(g.currentPlayerId) + g.direction + order.length) % order.length];

    for (const [id, seat] of this.seats) {
      if (!opponents.includes(id)) {
        seat.el.remove();
        this.seats.delete(id);
      }
    }
    opponents.forEach((id) => {
      const p = players.get(id);
      if (!p) return;
      let seat = this.seats.get(id);
      if (!seat) {
        seat = new PlayerSeat(p, { onCatch: (target) => this.catchPlayer(target) });
        this.seats.set(id, seat);
        this.seatLayer.append(seat.el);
      }
      const isTurn = g.currentPlayerId === id && state.phase === 'PLAYING';
      let statusText = '';
      if (!p.connected) statusText = 'Reconnecting…';
      else if (isTurn) statusText = g.pending?.type === 'challenge' ? 'Deciding…' : g.pending?.type === 'chooseColor' ? 'Choosing color…' : 'Playing…';
      seat.update(p, { isTurn, isNext: nextId === id, vulnerable: g.unoVulnerableId === id, canCatch: state.actions?.canCatch, statusText });
    });
    this.seatOrder = opponents;
    this.layoutSeats();
  }

  layoutSeats() {
    const ids = this.seatOrder ?? [];
    const k = ids.length;
    if (!k) return;
    const W = this.boardEl.clientWidth;
    const H = this.boardEl.clientHeight;
    const compact = W < 700 || H < 420;
    this.boardEl.classList.toggle('is-compact', compact);
    const sample = this.seats.get(ids[0])?.el;
    const sw = sample?.offsetWidth || 120;
    const sh = sample?.offsetHeight || 110;
    const cx = W / 2;
    const cy = H / 2;
    // Hug the table: seats sit just outside its rim, but never off-board.
    const table = this.boardEl.querySelector('.table').getBoundingClientRect();
    const rx = Math.max(0, Math.min(W / 2 - sw / 2 - 6, table.width / 2 + sw * 0.25));
    const ry = Math.max(0, Math.min(H / 2 - sh / 2 - 4, table.height / 2 + sh * 0.45));
    const span = k === 1 ? 0 : Math.min(210, 50 + 40 * k);
    const start = 90 + span / 2;
    ids.forEach((id, i) => {
      const seat = this.seats.get(id);
      if (!seat) return;
      const deg = k === 1 ? 90 : start - (span * i) / (k - 1);
      const rad = (deg * Math.PI) / 180;
      const x = cx + rx * Math.cos(rad);
      const y = Math.min(H - sh / 2, cy - ry * Math.sin(rad));
      seat.el.style.transform = `translate(${x - sw / 2}px, ${y - sh / 2}px)`;
      seat.el.dataset.side = deg > 120 ? 'left' : deg < 60 ? 'right' : 'top';
    });
  }

  renderPiles(state) {
    const g = state.game;
    this.drawCount.textContent = String(g.drawCount);
    this.drawPile.classList.toggle('is-low', g.drawCount < 8);
    const a = state.actions ?? {};
    this.drawPile.classList.toggle('is-active', Boolean(a.canDraw));
    this.drawPile.setAttribute('aria-label', `Draw a card — ${g.drawCount} left${a.canDraw ? '' : ' (not available now)'}`);

    const tail = g.discardTail;
    const key = tail.map((c) => c.id).join(',') + ':' + g.currentColor;
    if (key !== this.discardKey) {
      this.discardKey = key;
      const nodes = tail.map((c, i) => {
        const isTop = i === tail.length - 1;
        const el = createCard(c, { chosen: isTop ? g.currentColor : undefined });
        const r = hash(c.id);
        el.style.transform = `translate(${(hash(c.id + 'x') - 0.5) * 10}px, ${(hash(c.id + 'y') - 0.5) * 8}px) rotate(${(r - 0.5) * 30}deg)`;
        if (!isTop) el.classList.add('is-under');
        return el;
      });
      this.discardStack.replaceChildren(...nodes);
      if (this.landingHold > 0) this.discardStack.lastElementChild?.classList.add('is-hidden');
    }
    const top = g.topCard;
    this.discardZone.setAttribute(
      'aria-label',
      `Discard pile: ${cardLabel(top)}. Current color ${g.currentColor ? COLOR_NAMES[g.currentColor] : 'not chosen'}.${this.hand.selectedId ? ' Activate to play the selected card.' : ''}`,
    );
  }

  renderMe(state, me) {
    if (!me) return;
    if (this.myAvatarId !== me.avatar) {
      this.myAvatarId = me.avatar;
      this.myAvatarSlot.querySelector('.avatar')?.remove();
      this.myAvatarSlot.append(PlayerAvatar(me.avatar, 46));
    }
    this.myName.textContent = me.name;
    const n = state.hand.length;
    this.myCount.textContent = `${n} card${n === 1 ? '' : 's'} · ${me.score} pts`;
    const g = state.game;
    const isTurn = g.currentPlayerId === me.id && state.phase === 'PLAYING';
    this.mePlate.classList.toggle('is-turn', isTurn);
    this.mePlate.classList.toggle('is-uno', n === 1);
    this.mePlate.classList.toggle('is-vulnerable', g.unoVulnerableId === me.id);
    this.handZone.classList.toggle('is-my-turn', isTurn);
  }

  renderControls(state) {
    const a = state.actions ?? {};
    const g = state.game;
    const cur = g.currentPlayerId;
    let text;
    if (state.phase === 'STARTING') text = 'Shuffling…';
    else if (state.phase !== 'PLAYING') text = 'Round over';
    else if (a.isMyTurn) text = a.canChallenge ? 'Respond to +4' : a.mustChooseColor ? 'Choose a color' : a.canPass ? 'Play it or pass' : 'Your turn';
    else text = `${this.nameOf(cur)}'s turn`;
    this.bannerText.textContent = text;
    this.banner.classList.toggle('is-mine', Boolean(a.isMyTurn));
    this.statusEl.textContent = a.isMyTurn ? 'YOUR TURN' : state.phase === 'PLAYING' ? `${this.nameOf(cur).toUpperCase()}'S TURN` : '';
    this.statusEl.classList.toggle('is-mine', Boolean(a.isMyTurn));

    if (prevTurnAnnounce !== `${state.round}:${cur}:${a.isMyTurn}` && state.phase === 'PLAYING') {
      prevTurnAnnounce = `${state.round}:${cur}:${a.isMyTurn}`;
      announce(a.isMyTurn ? 'Your turn' : `${this.nameOf(cur)}'s turn`);
    }

    this.drawBtn.disabled = !a.canDraw;
    this.drawBtn.hidden = Boolean(a.canPass);
    this.passBtn.hidden = !a.canPass;
    this.unoBtn.disabled = !a.canCallUno;
    this.unoBtn.classList.toggle('is-ready', Boolean(a.canCallUno));
    this.unoBtn.classList.toggle('is-called', Boolean(state.players.find((p) => p.id === state.youId)?.unoCalled));
  }

  renderSelection(id) {
    const card = id && this.hand.cardOf(id);
    this.playBtn.hidden = !card;
    if (card) {
      this.playBtn.textContent = `Play ${cardLabel(card)}`;
      this.playBtn.setAttribute('aria-label', `Play ${cardLabel(card)}`);
    }
    this.discardZone.classList.toggle('is-target', Boolean(card));
  }

  // ---------------------------------------------------------------- timer
  runTimer() {
    cancelAnimationFrame(this.raf);
    const g = this.state?.game;
    const mine = Boolean(this.state?.actions?.isMyTurn);
    for (const seat of this.seats.values()) seat.setProgress(0);
    this.myRingFill.style.strokeDashoffset = '100';
    if (!g?.turnEndsAt || this.state.phase !== 'PLAYING') {
      this.timerEl.hidden = true;
      return;
    }
    this.timerEl.hidden = false;
    const seat = this.seats.get(g.currentPlayerId);
    const tick = () => {
      const left = Math.max(0, g.turnEndsAt - clock.now());
      const frac = left / (g.turnDuration || 1);
      const secs = Math.ceil(left / 1000);
      this.timerNum.textContent = String(secs);
      this.timerFill.style.strokeDashoffset = String(100 - frac * 100);
      const urgent = secs <= 5;
      this.timerEl.classList.toggle('is-urgent', urgent);
      if (mine) {
        this.myRingFill.style.strokeDashoffset = String(100 - frac * 100);
        this.mePlate.classList.toggle('is-urgent', urgent);
        if (urgent && secs !== this.lastTickSecond && secs > 0) {
          this.lastTickSecond = secs;
          audio.play('tick');
        }
      } else {
        seat?.setProgress(frac);
        seat?.el.classList.toggle('is-urgent', urgent);
      }
      if (left > 0) this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  // --------------------------------------------------------------- modals
  syncModals(state, prev) {
    const a = state.actions ?? {};
    const g = state.game;
    if (a.canChallenge && state.phase === 'PLAYING') {
      this.challenge.open({ offenderName: this.nameOf(g.pending.offenderId), prevColor: g.pending.prevColor, turnEndsAt: g.turnEndsAt, turnDuration: g.turnDuration });
    } else this.challenge.close();

    if (a.mustChooseColor && !this.pickingStartColor && !this.dealing) {
      this.pickingStartColor = true;
      openColorPicker({ cancelable: false, title: 'Choose the starting color', hint: 'The first card is a Wild — you pick the color.' }).then(async (color) => {
        this.pickingStartColor = false;
        if (color) await this.act('chooseColor', { color });
      });
    } else if (!a.mustChooseColor && this.pickingStartColor) {
      openColorPicker.close?.();
    }

    const ended = state.phase === 'ROUND_END' || state.phase === 'GAME_END';
    if (ended) {
      const fresh = !prev || (prev.phase !== 'ROUND_END' && prev.phase !== 'GAME_END');
      clearTimeout(this.resultTimer);
      if (fresh && !prefersReducedMotion()) this.resultTimer = setTimeout(() => this.state?.roundResult && this.result.show(this.state), 1100);
      else this.result.show(state);
    } else {
      clearTimeout(this.resultTimer);
      this.result.hide();
    }
  }

  // ----------------------------------------------------------- round intro
  async startRoundSequence(state) {
    this.dealing = true;
    const remaining = Math.max(400, (state.startsAt ?? clock.now()) - clock.now());
    await playIntro(remaining, state.round);
    await this.dealAnimation();
    this.dealing = false;
    // The round may already need input (e.g. starting Wild).
    if (this.state) this.syncModals(this.state, this.state);
  }

  async dealAnimation() {
    const s = this.state;
    if (!s?.game) return;
    const deck = this.drawPile.querySelector('.pile-stack').getBoundingClientRect();
    const order = s.game.order;
    const myCards = this.hand.order.filter((id) => this.hand.incoming.has(id));
    const rounds = Math.max(myCards.length, 7);
    const stepMs = prefersReducedMotion() ? 0 : Math.min(55, 1300 / (rounds * order.length));
    const flights = [];
    let n = 0;
    for (let r = 0; r < rounds; r++) {
      for (const pid of order) {
        const delay = n++ * stepMs;
        if (pid === s.youId) {
          const id = myCards[r];
          const to = id && this.hand.rectOf(id);
          if (to) {
            flights.push(
              sleep(delay).then(() => audio.play('deal')),
              flyCard({ from: deck, to, card: this.hand.cardOf(id), flip: true, delay, duration: 460 }).then(() => this.hand.reveal(id)),
            );
          }
        } else if (r < 7) {
          const seat = this.seats.get(pid);
          if (seat) flights.push(flyCard({ from: deck, to: seat.anchorRect, delay, duration: 420, toScale: 0.4 }));
        }
      }
    }
    await Promise.all(flights);
    this.hand.revealAll();
    this.boardEl.classList.remove('is-dealing');
    // Flip the starter onto the discard pile.
    const top = this.state?.game?.discardTail.at(-1);
    if (top) {
      await flyCard({ from: deck, to: this.discardTopRect(), card: top, flip: true, duration: 480 });
      audio.play('play');
    }
    this.landingHold = Math.max(0, this.landingHold - 1);
    this.revealDiscard();
  }

  revealDiscard() {
    if (this.landingHold > 0) return;
    const top = this.discardStack.lastElementChild;
    if (top?.classList.contains('is-hidden')) {
      top.classList.remove('is-hidden');
      top.classList.add('is-landed');
      ripple(top.getBoundingClientRect(), COLOR_HEX[this.state?.game?.currentColor] ?? '#fff');
    }
  }

  // --------------------------------------------------------------- actions
  drawCard() {
    audio.unlock();
    const a = this.state?.actions;
    if (!a?.canDraw) {
      if (!a?.isMyTurn) toastError({ code: 'NOT_YOUR_TURN' });
      else shake(this.drawPile);
      return;
    }
    this.act('draw');
  }

  onDiscardClick() {
    const id = this.hand.selectedId;
    if (id) return this.playCard(id);
    if (this.state?.actions?.isMyTurn) toast('Tap a glowing card, then tap here — or drag it onto the pile.', { icon: '👆', duration: 2400 });
  }

  async callUno() {
    audio.unlock();
    if (!this.state?.actions?.canCallUno) return;
    const ok = await this.act('uno');
    if (ok) {
      this.unoBtn.classList.add('is-pop');
      setTimeout(() => this.unoBtn.classList.remove('is-pop'), 700);
      confetti({ count: 40, duration: 1600 });
    }
  }

  catchPlayer(targetId) {
    audio.unlock();
    this.act('catch', { targetId });
  }

  /**
   * Play a card from the hand (drag, tap or keyboard). With a drag ghost the
   * ghost itself flies onto the pile; the server confirms or rejects.
   */
  async playCard(id, { ghost } = {}) {
    if (this.busy) return false;
    const card = this.hand.cardOf(id);
    const s = this.state;
    if (!card || !s?.actions?.isMyTurn) return false;
    this.busy = true;
    try {
      let color;
      const target = this.discardTopRect();
      const pw = target.width;
      const rot = (hash(card.id) - 0.5) * 30;
      const cw = ghost ? parseFloat(ghost.style.getPropertyValue('--cw')) : 0;
      const toTransform = ghost
        ? `translate(${target.left + target.width / 2 - cw / 2}px, ${target.top + target.height / 2 - cw * 0.75}px) rotate(${rot}deg) scale(${pw / cw})`
        : null;
      const flyGhost = (extraLift = 0) =>
        ghost
          .animate([{ transform: ghost.style.transform }, { transform: toTransform.replace(/translate\(([^,]+), ([^)]+)\)/, (_, x, y) => `translate(${x}, calc(${y} - ${extraLift}px))`) }], {
            duration: prefersReducedMotion() ? 1 : 260,
            easing: 'cubic-bezier(.2,.9,.3,1.1)',
            fill: 'forwards',
          })
          .finished.catch(() => {});

      if (card.color === 'wild') {
        if (ghost) await flyGhost(26);
        color = await openColorPicker({ hint: card.value === 'wild4' ? 'Next player draws 4 — they may challenge if you had a matching color.' : undefined });
        if (!color) return false;
        if (!this.state?.actions?.playable?.includes(id)) return false; // turn timed out meanwhile
      }

      if (ghost) this.dragLanding = { id, ghost };
      const landed = ghost ? flyGhost(0) : Promise.resolve();
      const res = await this.request('play', { cardId: id, color });
      if (!res.ok) {
        this.dragLanding = null;
        audio.play('error');
        toastError(res.error);
        return false;
      }
      this.hand.select(null);
      if (ghost) {
        await landed;
        ghost.remove();
        this.landingHold = Math.max(0, this.landingHold - (this.dragLanding?.held ? 1 : 0));
        this.dragLanding = null;
        this.revealDiscard();
      }
      return true;
    } finally {
      this.busy = false;
    }
  }

  handleKey(e) {
    if (e.target.closest?.('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('#overlay-root .overlay:not(.is-leaving)')) return;
    const k = e.key.toLowerCase();
    if (k === 'd') this.drawCard();
    else if (k === 'p' && this.state?.actions?.canPass) this.act('pass');
    else if (k === 'u') this.callUno();
    else if (k === 'l') this.toggleLog();
    else if (k === 'h') this.hand.inner.querySelector('.hand-card.is-playable, .hand-card')?.focus();
    else return;
    e.preventDefault();
  }

  // ------------------------------------------------------------ animations
  animateEvents(events, prevHandRects) {
    if (!events.length) return;
    const s = this.state;
    const me = s.youId;
    const deckRect = () => this.drawPile.querySelector('.pile-stack').getBoundingClientRect();
    const centerRect = () => this.discardZone.getBoundingClientRect();
    let drawDelay = 0;

    for (const e of events) {
      switch (e.type) {
        case 'play': {
          const sound = PLAY_SOUND[e.card.value] ?? 'play';
          if (this.dealing) break;
          if (e.playerId === me && this.dragLanding?.id === e.card.id) {
            // Ghost is already flying; hide the real top card until it lands.
            this.dragLanding.held = true;
            this.landingHold++;
            this.discardStack.lastElementChild?.classList.add('is-hidden');
            audio.play(sound);
            this.playEffects(e);
            break;
          }
          const from = e.playerId === me ? prevHandRects.get(e.card.id) : this.seats.get(e.playerId)?.anchorRect;
          this.landingHold++;
          this.discardStack.lastElementChild?.classList.add('is-hidden');
          flyCard({
            from: from ?? deckRect(),
            to: this.discardTopRect(),
            card: e.card,
            chosen: e.card.color === 'wild' ? e.color : undefined,
            flip: e.playerId !== me,
            duration: e.playerId === me ? 380 : 540,
            fromRotate: e.playerId === me ? 0 : -20,
            toRotate: (hash(e.card.id) - 0.5) * 30,
          }).then(() => {
            this.landingHold = Math.max(0, this.landingHold - 1);
            this.revealDiscard();
            audio.play(sound);
            this.playEffects(e);
          });
          break;
        }
        case 'draw': {
          if (this.dealing || !e.count) break;
          const delay = drawDelay;
          drawDelay += Math.min(e.count, 6) * 110 + 80;
          if (e.reason === 'draw2' || e.reason === 'wild4' || e.reason === 'uno_penalty' || e.reason?.startsWith('challenge')) {
            setTimeout(() => burst(`+${e.count}`, this.rectForPlayer(e.playerId), { tone: 'draw' }), 380);
          }
          if (e.playerId === me && e.cards) {
            e.cards.forEach((c, i) => {
              const to = this.hand.rectOf(c.id);
              if (!to) return this.hand.reveal(c.id);
              setTimeout(() => audio.play('draw'), delay + i * 110);
              flyCard({ from: deckRect(), to, card: c, flip: true, delay: delay + i * 110, duration: 500 }).then(() => this.hand.reveal(c.id));
            });
          } else {
            const seat = this.seats.get(e.playerId);
            if (!seat) break;
            for (let i = 0; i < Math.min(e.count, 6); i++) {
              setTimeout(() => audio.play('draw'), delay + i * 110);
              flyCard({ from: deckRect(), to: seat.anchorRect, delay: delay + i * 110, duration: 440, toScale: 0.4 });
            }
          }
          break;
        }
        case 'skip':
          if (!this.dealing) setTimeout(() => burst('SKIP', this.rectForPlayer(e.playerId), { tone: 'skip' }), 420);
          break;
        case 'reverse':
          if (!this.dealing) {
            setTimeout(() => burst(e.direction === 1 ? '↻ REVERSE' : '↺ REVERSE', centerRect(), { tone: 'reverse' }), 360);
            this.directionEl.classList.remove('is-flip');
            void this.directionEl.getBoundingClientRect();
            this.directionEl.classList.add('is-flip');
          }
          break;
        case 'uno':
          audio.play('uno');
          burst('UNO!', this.rectForPlayer(e.playerId), { tone: 'uno', size: 1.2 });
          break;
        case 'caught':
          audio.play('error');
          burst('CAUGHT!', this.rectForPlayer(e.playerId), { tone: 'skip' });
          toast(`${e.by === me ? 'You' : this.nameOf(e.by)} caught ${e.playerId === me ? 'you' : this.nameOf(e.playerId)} without UNO! +2`, { icon: '🚨' });
          break;
        case 'wild4Pending':
          if (e.playerId !== me) toast(`${this.nameOf(e.playerId)} is deciding whether to challenge…`, { icon: '⚖️', duration: 2200 });
          break;
        case 'challenge':
          audio.play('challenge');
          burst(e.success ? 'BLUFF CAUGHT!' : 'CHALLENGE FAILED', centerRect(), { tone: e.success ? 'uno' : 'skip', size: 0.8 });
          break;
        case 'reveal':
          this.showReveal(e);
          break;
        case 'color':
          ripple(centerRect(), COLOR_HEX[e.color]);
          burst(COLOR_NAMES[e.color].toUpperCase(), centerRect(), { tone: e.color, size: 0.8 });
          break;
        case 'reshuffle':
          audio.play('shuffle');
          burst('RESHUFFLE', deckRect(), { tone: 'reverse', size: 0.6 });
          this.drawPile.classList.remove('is-shuffling');
          void this.drawPile.offsetWidth;
          this.drawPile.classList.add('is-shuffling');
          break;
        case 'timeout':
          if (e.playerId === me) toast("Time's up — your turn was played automatically.", { icon: '⏰' });
          break;
        case 'turn':
          if (e.playerId === me && s.phase === 'PLAYING') audio.play('turn');
          break;
        case 'go':
          break;
        case 'disconnected':
          if (e.playerId !== me) toast(`${this.nameOf(e.playerId)} disconnected`, { icon: '📡', type: 'error' });
          break;
        case 'reconnected':
          if (e.playerId !== me) toast(`${this.nameOf(e.playerId)} reconnected`, { icon: '✅', type: 'success' });
          break;
        case 'playerLeft':
          toast(`${e.name} ${e.reason === 'kicked' ? 'was removed' : 'left the game'}`, { icon: '👋' });
          break;
        case 'host':
          if (e.playerId === me) toast('You are now the host', { icon: '👑', type: 'success' });
          break;
        default:
      }
    }
  }

  playEffects(e) {
    const color = e.color;
    if (e.card.color === 'wild') {
      ripple(this.discardZone.getBoundingClientRect(), COLOR_HEX[color]);
      burst(COLOR_NAMES[color].toUpperCase(), this.discardZone.getBoundingClientRect(), { tone: color, size: 0.75 });
    }
  }

  showReveal(e) {
    const panel = h(
      'div.reveal-panel.glass',
      { role: 'status' },
      h('p', `${this.nameOf(e.playerId)}'s hand`),
      h('div.reveal-cards', e.cards.map((c) => createCard(c))),
    );
    document.getElementById('overlay-root').append(panel);
    setTimeout(() => {
      panel.classList.add('is-leaving');
      setTimeout(() => panel.remove(), 300);
    }, 4200);
  }
}

let prevTurnAnnounce = '';
