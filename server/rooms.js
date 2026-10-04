// Room / session layer: lobby, phases, timers, reconnect and per-viewer views.
// The server is the single source of truth — clients only send intents.
import { randomBytes, randomInt } from 'node:crypto';
import { decideBotMove } from './bot.js';
import { cardPoints } from './engine/cards.js';
import { Game, GameError } from './engine/game.js';

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY',
  STARTING: 'STARTING',
  PLAYING: 'PLAYING',
  ROUND_END: 'ROUND_END',
  GAME_END: 'GAME_END',
});

export const AVATARS = ['fox', 'panda', 'tiger', 'lion', 'frog', 'octopus', 'unicorn', 'dragon', 'alien', 'robot', 'penguin', 'owl'];
const BOT_NAMES = ['Nova', 'Pixel', 'Echo', 'Blitz', 'Luna', 'Orbit', 'Vega', 'Zed', 'Iris', 'Kai'];
const TURN_TIMES = [0, 15, 30, 45, 60];
const TARGET_SCORES = [0, 100, 200, 500];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const TIMING = {
  startingMs: 3800, // client intro: logo + 3·2·1·GO
  lobbyDropMs: 60_000, // disconnected lobby players are removed after this
  hostTransferMs: 30_000,
  roomIdleMs: 10 * 60_000, // room with no connected humans is deleted
  disconnectedTurnMs: 20_000, // used when turn timer is off but actor is offline
  botMinMs: 900,
  botJitterMs: 800,
};

const err = (code, message) => new GameError(code, message);

export function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  if (!name) throw err('NAME_REQUIRED', 'Please enter a name');
  return name;
}

const cleanAvatar = (a) => (AVATARS.includes(a) ? a : AVATARS[randomInt(AVATARS.length)]);
const clampPlayers = (n) => Math.min(8, Math.max(2, Number.parseInt(n, 10) || 4));

function sanitizeEvent(e, viewerId) {
  if (e.type === 'reveal') return e.to === viewerId ? e : null;
  if (e.type === 'draw' && e.playerId !== viewerId) {
    const { cards, ...rest } = e;
    return rest;
  }
  return e;
}

export class Room {
  constructor(manager, code, { maxPlayers = 4, turnTime = 30, targetScore = 200 } = {}) {
    this.manager = manager;
    this.code = code;
    this.settings = { maxPlayers: clampPlayers(maxPlayers), turnTime, targetScore };
    this.players = new Map(); // insertion order = seat order
    this.hostId = null;
    this.phase = PHASE.LOBBY;
    this.game = null;
    this.round = 0;
    this.dealerIndex = -1;
    this.startsAt = null;
    this.turnEndsAt = null;
    this.turnDuration = 0;
    this.lastTurnKey = -1;
    this.roundResult = null;
    this.log = [];
    this.version = 0;
    this.timers = { turn: null, bot: null, phase: null, catch: null, idle: null };
    this.playerTimers = new Map(); // playerId -> { drop, host }
  }

  // --------------------------------------------------------------- players
  get isFull() {
    return this.players.size >= this.settings.maxPlayers;
  }

  hasConnectedHuman() {
    for (const p of this.players.values()) if (!p.isBot && p.connected) return true;
    return false;
  }

  addPlayer({ name, avatar, isBot = false }) {
    const id = randomBytes(6).toString('hex');
    const token = isBot ? null : randomBytes(24).toString('base64url');
    const player = { id, token, name, avatar: cleanAvatar(avatar), isBot, connected: isBot, ready: isBot, score: 0, socket: null };
    this.players.set(id, player);
    if (!this.hostId && !isBot) this.hostId = id;
    if (token) this.manager.sessions.set(token, { code: this.code, playerId: id });
    return player;
  }

  addBot() {
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.players.size + 1}`;
    return this.addPlayer({ name, avatar: AVATARS[randomInt(AVATARS.length)], isBot: true });
  }

  removePlayer(playerId, reason) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.clearPlayerTimers(playerId);
    this.players.delete(playerId);
    if (p.token) this.manager.sessions.delete(p.token);
    if (p.socket) {
      if (reason === 'kicked') this.manager.send(p.socket, { t: 'kicked' });
      p.socket.session = null;
    }
    const events = [{ type: 'playerLeft', playerId, name: p.name, reason }];

    if (this.game && this.game.hands.has(playerId) && (this.phase === PHASE.PLAYING || this.phase === PHASE.STARTING)) {
      this.game.removePlayer(playerId);
      events.push(...this.game.drainEvents());
    }
    if (this.hostId === playerId) this.transferHost();

    if (!this.hasConnectedHuman() && ![...this.players.values()].some((x) => !x.isBot)) {
      this.manager.deleteRoom(this.code);
      return;
    }
    if (this.game?.over && (this.phase === PHASE.PLAYING || this.phase === PHASE.STARTING)) this.finishRound();
    this.pushLog(events);
    this.syncTimers();
    this.broadcast(events);
  }

  transferHost() {
    const humans = [...this.players.values()].filter((p) => !p.isBot);
    const next = humans.find((p) => p.connected) ?? humans[0];
    this.hostId = next?.id ?? null;
    if (next) next.ready = true;
    return next;
  }

  clearPlayerTimers(playerId) {
    const t = this.playerTimers.get(playerId);
    if (t) {
      clearTimeout(t.drop);
      clearTimeout(t.host);
      this.playerTimers.delete(playerId);
    }
  }

  onDisconnect(player) {
    const timers = { drop: null, host: null };
    if (this.phase === PHASE.LOBBY) {
      timers.drop = setTimeout(() => {
        if (!player.connected) this.removePlayer(player.id, 'timeout');
      }, TIMING.lobbyDropMs);
    }
    if (this.hostId === player.id) {
      timers.host = setTimeout(() => {
        if (!player.connected && this.hostId === player.id) {
          const next = this.transferHost();
          if (next && next.id !== player.id) this.broadcast([{ type: 'host', playerId: next.id }]);
        }
      }, TIMING.hostTransferMs);
    }
    this.clearPlayerTimers(player.id);
    this.playerTimers.set(player.id, timers);

    const isActor = this.game && !this.game.over && this.game.currentPlayerId === player.id;
    this.syncTimers(isActor && !this.settings.turnTime);
    if (!this.hasConnectedHuman()) {
      clearTimeout(this.timers.idle);
      this.timers.idle = setTimeout(() => {
        if (!this.hasConnectedHuman()) this.manager.deleteRoom(this.code);
      }, TIMING.roomIdleMs);
    }
    this.broadcast([{ type: 'disconnected', playerId: player.id }]);
  }

  onReconnect(player) {
    this.clearPlayerTimers(player.id);
    clearTimeout(this.timers.idle);
    this.syncTimers();
    this.broadcast([{ type: 'reconnected', playerId: player.id }]);
  }

  // --------------------------------------------------------------- actions
  handle(playerId, type, data = {}) {
    const player = this.players.get(playerId);
    if (!player) throw err('NOT_IN_ROOM', 'You are not in this room');
    const isHost = this.hostId === playerId;
    const requireHost = () => {
      if (!isHost) throw err('NOT_HOST', 'Only the host can do that');
    };
    const requireLobby = () => {
      if (this.phase !== PHASE.LOBBY) throw err('GAME_STARTED', 'The game has already started');
    };

    switch (type) {
      case 'ready':
        requireLobby();
        player.ready = isHost ? true : Boolean(data.ready);
        return this.broadcast();

      case 'settings': {
        requireHost();
        requireLobby();
        const s = { ...this.settings };
        if (data.maxPlayers !== undefined) {
          const max = clampPlayers(data.maxPlayers);
          if (max < this.players.size) throw err('BAD_REQUEST', 'More players are already in the room');
          s.maxPlayers = max;
        }
        if (data.turnTime !== undefined) {
          if (!TURN_TIMES.includes(Number(data.turnTime))) throw err('BAD_REQUEST', 'Invalid turn time');
          s.turnTime = Number(data.turnTime);
        }
        if (data.targetScore !== undefined) {
          if (!TARGET_SCORES.includes(Number(data.targetScore))) throw err('BAD_REQUEST', 'Invalid target score');
          s.targetScore = Number(data.targetScore);
        }
        this.settings = s;
        return this.broadcast();
      }

      case 'kick': {
        requireHost();
        if (data.playerId === playerId) throw err('BAD_REQUEST', 'You cannot remove yourself');
        if (!this.players.has(data.playerId)) throw err('BAD_REQUEST', 'Player not found');
        return this.removePlayer(data.playerId, 'kicked');
      }

      case 'addBot':
        requireHost();
        requireLobby();
        if (this.isFull) throw err('ROOM_FULL', 'The room is full');
        this.addBot();
        return this.broadcast([{ type: 'joined' }]);

      case 'start': {
        requireHost();
        requireLobby();
        if (this.players.size < 2) throw err('NOT_ENOUGH_PLAYERS', 'Need at least 2 players to start');
        const notReady = [...this.players.values()].filter((p) => !p.ready && p.id !== this.hostId);
        if (notReady.length) throw err('NOT_READY', `Waiting for ${notReady.map((p) => p.name).join(', ')} to be ready`);
        for (const p of this.players.values()) p.score = 0;
        this.round = 0;
        this.dealerIndex = randomInt(this.players.size) - 1;
        return this.startRound();
      }

      case 'nextRound':
        requireHost();
        if (this.phase !== PHASE.ROUND_END) throw err('BAD_REQUEST', 'The round is not over');
        if (this.players.size < 2) return this.backToLobby();
        return this.startRound();

      case 'backToLobby':
        requireHost();
        if (this.phase !== PHASE.GAME_END && this.phase !== PHASE.ROUND_END) throw err('BAD_REQUEST', 'The game is still running');
        return this.backToLobby();

      default:
        return this.gameAction(playerId, type, data);
    }
  }

  gameAction(playerId, type, data) {
    const actions = {
      play: (g) => g.play(playerId, String(data.cardId ?? ''), data.color),
      draw: (g) => g.draw(playerId),
      pass: (g) => g.pass(playerId),
      uno: (g) => g.callUno(playerId),
      catch: (g) => g.catchUno(playerId, String(data.targetId ?? '')),
      challenge: (g) => g.challenge(playerId),
      accept: (g) => g.accept(playerId),
      chooseColor: (g) => g.chooseColor(playerId, data.color),
    };
    const action = actions[type];
    if (!action) throw err('BAD_REQUEST', `Unknown action "${type}"`);
    if (this.phase === PHASE.STARTING) throw err('NOT_STARTED', 'Hold on — the round is about to start');
    if (this.phase !== PHASE.PLAYING || !this.game) throw err('NOT_PLAYING', 'No round in progress');
    action(this.game);
    this.afterGameChange();
  }

  afterGameChange() {
    const events = this.game.drainEvents();
    if (this.game.over) this.finishRound();
    this.pushLog(events);
    this.syncTimers();
    this.broadcast(events);
  }

  // ---------------------------------------------------------------- phases
  startRound() {
    this.clearGameTimers();
    const ids = [...this.players.keys()];
    this.dealerIndex = (this.dealerIndex + 1 + ids.length) % ids.length;
    this.game = new Game({ playerIds: ids, dealerIndex: this.dealerIndex });
    this.game.start();
    this.round++;
    this.roundResult = null;
    this.phase = PHASE.STARTING;
    this.startsAt = Date.now() + TIMING.startingMs;
    this.lastTurnKey = -1;
    this.turnEndsAt = null;
    const events = [{ type: 'roundStart', round: this.round }, ...this.game.drainEvents()];
    this.pushLog(events);
    this.timers.phase = setTimeout(() => {
      this.timers.phase = null;
      if (this.phase !== PHASE.STARTING) return;
      this.phase = PHASE.PLAYING;
      this.startsAt = null;
      if (this.game.over) this.finishRound();
      this.syncTimers();
      this.broadcast([{ type: 'go' }]);
    }, TIMING.startingMs);
    this.broadcast(events);
  }

  finishRound() {
    const g = this.game;
    this.clearGameTimers();
    const winner = this.players.get(g.winnerId);
    if (winner) winner.score += g.points;
    const target = this.settings.targetScore;
    const gameOver = !target || !winner || winner.score >= target || this.players.size < 2;
    this.phase = gameOver ? PHASE.GAME_END : PHASE.ROUND_END;
    this.roundResult = {
      winnerId: g.winnerId,
      winnerName: winner?.name ?? '—',
      points: g.points,
      reason: g.endReason,
      targetScore: target,
      gameOver,
      standings: [...this.players.values()]
        .map((p) => {
          const hand = g.hands.get(p.id) ?? [];
          return { id: p.id, name: p.name, avatar: p.avatar, score: p.score, cards: hand, handPoints: hand.reduce((s, c) => s + cardPoints(c), 0) };
        })
        .sort((a, b) => b.score - a.score),
    };
  }

  backToLobby() {
    this.clearGameTimers();
    this.phase = PHASE.LOBBY;
    this.game = null;
    this.roundResult = null;
    this.round = 0;
    for (const p of this.players.values()) {
      p.score = 0;
      p.ready = p.isBot || p.id === this.hostId;
      if (!p.isBot && !p.connected) this.onDisconnect(p); // re-arm lobby drop timers
    }
    this.log = [];
    this.broadcast([{ type: 'lobby' }]);
  }

  // ---------------------------------------------------------------- timers
  clearGameTimers() {
    for (const key of ['turn', 'bot', 'phase', 'catch']) {
      clearTimeout(this.timers[key]);
      this.timers[key] = null;
    }
    this.turnEndsAt = null;
  }

  /** Keeps the authoritative turn timer and bot scheduling in sync with game state. */
  syncTimers(force = false) {
    const g = this.game;
    if (this.phase !== PHASE.PLAYING || !g || g.over || !this.hasConnectedHuman()) {
      if (this.phase === PHASE.PLAYING) {
        // Paused (nobody connected) — resume with the time that was left, so
        // reconnecting can never be used to reset the clock.
        if (this.timers.turn && this.turnEndsAt) this.paused = { turnKey: g?.turnKey, remaining: Math.max(1000, this.turnEndsAt - Date.now()) };
        clearTimeout(this.timers.turn);
        clearTimeout(this.timers.bot);
        this.timers.turn = this.timers.bot = null;
        this.turnEndsAt = null;
        this.lastTurnKey = -1;
      }
      return;
    }
    if (force || g.turnKey !== this.lastTurnKey) {
      this.lastTurnKey = g.turnKey;
      clearTimeout(this.timers.turn);
      this.timers.turn = null;
      const actor = this.players.get(g.currentPlayerId);
      let ms = this.settings.turnTime * 1000;
      if (!ms && actor && !actor.isBot && !actor.connected) ms = TIMING.disconnectedTurnMs;
      if (ms && this.paused?.turnKey === g.turnKey) ms = Math.min(ms, this.paused.remaining);
      this.paused = null;
      if (ms) {
        this.turnDuration = ms;
        this.turnEndsAt = Date.now() + ms;
        this.timers.turn = setTimeout(() => this.onTurnTimeout(), ms);
      } else {
        this.turnEndsAt = null;
      }
      this.scheduleBot();
    }
    this.scheduleBotCatch();
  }

  onTurnTimeout() {
    this.timers.turn = null;
    if (this.phase !== PHASE.PLAYING || !this.game || this.game.over) return;
    try {
      this.game.timeout();
    } catch (e) {
      console.error('[room %s] timeout failed', this.code, e);
    }
    this.afterGameChange();
  }

  scheduleBot() {
    clearTimeout(this.timers.bot);
    this.timers.bot = null;
    const g = this.game;
    const actor = this.players.get(g.currentPlayerId);
    if (!actor?.isBot) return;
    const turnKey = g.turnKey;
    this.timers.bot = setTimeout(() => {
      this.timers.bot = null;
      if (this.game !== g || g.over || g.turnKey !== turnKey || this.phase !== PHASE.PLAYING) return;
      for (const [method, ...args] of decideBotMove(g, actor.id)) {
        try {
          g[method](...args);
        } catch (e) {
          if (!(e instanceof GameError)) console.error(e);
        }
        if (g.over) break;
      }
      this.afterGameChange();
    }, TIMING.botMinMs + Math.random() * TIMING.botJitterMs);
  }

  /** Bots sometimes catch a human who forgot to call UNO. */
  scheduleBotCatch() {
    const g = this.game;
    const target = g.unoVulnerableId && this.players.get(g.unoVulnerableId);
    if (!target || target.isBot || this.timers.catch) return;
    const bot = [...this.players.values()].find((p) => p.isBot && g.hands.has(p.id));
    if (!bot || Math.random() > 0.6) return;
    this.timers.catch = setTimeout(() => {
      this.timers.catch = null;
      if (this.game !== g || g.over || g.unoVulnerableId !== target.id) return;
      try {
        g.catchUno(bot.id, target.id);
        this.afterGameChange();
      } catch {
        /* window closed */
      }
    }, 1600 + Math.random() * 1600);
  }

  // ------------------------------------------------------------------ views
  pushLog(events) {
    const at = Date.now();
    for (const e of events) {
      if (e.type === 'reveal' || e.type === 'turn') continue;
      const { cards, ...pub } = e.type === 'draw' ? e : { ...e, cards: undefined };
      this.log.push({ ...pub, at });
    }
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
  }

  viewFor(viewerId) {
    const g = this.game;
    const inRound = g && this.phase !== PHASE.LOBBY;
    const view = {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      youId: viewerId,
      settings: this.settings,
      round: this.round,
      serverNow: Date.now(),
      startsAt: this.startsAt,
      version: this.version,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot,
        connected: p.isBot || p.connected,
        ready: p.ready || p.id === this.hostId,
        isHost: p.id === this.hostId,
        score: p.score,
        cardCount: inRound ? (g.hands.get(p.id)?.length ?? 0) : 0,
        unoCalled: inRound ? g.unoCalled.has(p.id) : false,
      })),
      log: this.log.slice(-40),
      roundResult: this.roundResult,
      game: null,
      hand: [],
      actions: null,
    };
    if (!inRound) return view;

    const hand = g.hands.get(viewerId) ?? [];
    const live = this.phase === PHASE.PLAYING && !g.over;
    const isMyTurn = live && g.currentPlayerId === viewerId;
    const playable = live ? g.playableIds(viewerId) : [];
    view.game = {
      order: g.order,
      currentPlayerId: g.over ? null : g.currentPlayerId,
      direction: g.direction,
      currentColor: g.currentColor,
      topCard: g.topCard,
      discardTail: g.discardPile.slice(-5),
      discardCount: g.discardPile.length,
      drawCount: g.drawPile.length,
      pending: g.pending ? { type: g.pending.type, playerId: g.pending.playerId, offenderId: g.pending.offenderId ?? null, prevColor: g.pending.prevColor ?? null } : null,
      unoVulnerableId: g.unoVulnerableId,
      turnEndsAt: live ? this.turnEndsAt : null,
      turnDuration: this.turnDuration,
      drawnCardId: isMyTurn ? g.drawnCardId : null,
      winnerId: g.winnerId,
    };
    view.hand = hand;
    view.actions = {
      isMyTurn,
      playable,
      canDraw: isMyTurn && !g.pending && !g.drawnCardId,
      canPass: isMyTurn && Boolean(g.drawnCardId),
      canCallUno: live && !g.unoCalled.has(viewerId) && (hand.length === 1 || (hand.length === 2 && isMyTurn && !g.pending && playable.length > 0)),
      canChallenge: live && g.pending?.type === 'challenge' && g.pending.playerId === viewerId,
      mustChooseColor: live && g.pending?.type === 'chooseColor' && g.pending.playerId === viewerId,
      canCatch: live && Boolean(g.unoVulnerableId) && g.unoVulnerableId !== viewerId && g.hands.has(viewerId),
    };
    return view;
  }

  broadcast(events = []) {
    this.version++;
    for (const p of this.players.values()) {
      if (!p.socket) continue;
      const personal = events.map((e) => sanitizeEvent(e, p.id)).filter(Boolean);
      this.manager.send(p.socket, { t: 'state', state: this.viewFor(p.id), events: personal });
    }
  }

  destroy() {
    this.clearGameTimers();
    clearTimeout(this.timers.idle);
    for (const id of this.playerTimers.keys()) this.clearPlayerTimers(id);
    for (const p of this.players.values()) {
      if (p.token) this.manager.sessions.delete(p.token);
      if (p.socket) p.socket.session = null;
    }
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.sessions = new Map(); // token -> { code, playerId }
  }

  send(ws, msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  deleteRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.destroy();
    this.rooms.delete(code);
  }

  bind(ws, room, player) {
    if (player.socket && player.socket !== ws) {
      this.send(player.socket, { t: 'replaced' });
      player.socket.session = null;
      player.socket.close(4000, 'Session opened elsewhere');
    }
    player.socket = ws;
    player.connected = true;
    ws.session = { code: room.code, playerId: player.id };
  }

  /** Leave whatever room this socket is currently in. */
  detach(ws) {
    const s = ws.session;
    if (!s) return;
    ws.session = null;
    this.rooms.get(s.code)?.removePlayer(s.playerId, 'left');
  }

  onClose(ws) {
    const s = ws.session;
    if (!s) return;
    const room = this.rooms.get(s.code);
    const player = room?.players.get(s.playerId);
    if (!player || player.socket !== ws) return;
    player.socket = null;
    player.connected = false;
    room.onDisconnect(player);
  }

  handle(ws, msg) {
    const { t, rid } = msg;
    const reply = (ok, extra = {}) => this.send(ws, { t: 'ack', rid, ok, ...extra });
    try {
      switch (t) {
        case 'ping':
          return this.send(ws, { t: 'pong', rid, serverNow: Date.now(), clientTime: msg.clientTime });

        case 'create': {
          const name = cleanName(msg.name);
          this.detach(ws);
          const room = new Room(this, this.newCode(), { maxPlayers: msg.maxPlayers });
          this.rooms.set(room.code, room);
          const player = room.addPlayer({ name, avatar: msg.avatar });
          this.bind(ws, room, player);
          room.broadcast([{ type: 'joined', playerId: player.id }]);
          return reply(true, { code: room.code, playerId: player.id, token: player.token });
        }

        case 'join': {
          const name = cleanName(msg.name);
          const code = String(msg.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const room = this.rooms.get(code);
          if (!room) throw err('ROOM_NOT_FOUND', `Room ${code || '?'} does not exist`);
          if (ws.session?.code === code) {
            const me = room.players.get(ws.session.playerId);
            return reply(true, { code, playerId: me.id, token: me.token });
          }
          if (room.phase !== PHASE.LOBBY) throw err('GAME_STARTED', 'That game has already started');
          if (room.isFull) throw err('ROOM_FULL', `Room ${code} is full`);
          this.detach(ws);
          const player = room.addPlayer({ name, avatar: msg.avatar });
          this.bind(ws, room, player);
          room.broadcast([{ type: 'joined', playerId: player.id }]);
          return reply(true, { code: room.code, playerId: player.id, token: player.token });
        }

        case 'resume': {
          const s = this.sessions.get(String(msg.token ?? ''));
          const room = s && this.rooms.get(s.code);
          const player = room?.players.get(s.playerId);
          if (!player) throw err('SESSION_EXPIRED', 'Your previous game is no longer available');
          if (ws.session && ws.session.playerId !== player.id) this.detach(ws);
          this.bind(ws, room, player);
          reply(true, { code: room.code, playerId: player.id, token: player.token });
          return room.onReconnect(player);
        }

        case 'leave':
          this.detach(ws);
          return reply(true);

        default: {
          const s = ws.session;
          const room = s && this.rooms.get(s.code);
          if (!room) throw err('NOT_IN_ROOM', 'You are not in a room');
          room.handle(s.playerId, t, msg);
          return reply(true);
        }
      }
    } catch (e) {
      if (e instanceof GameError) return reply(false, { error: { code: e.code, message: e.message } });
      console.error('[server] unexpected error handling %s', t, e);
      return reply(false, { error: { code: 'SERVER_ERROR', message: 'Something went wrong on the server' } });
    }
  }
}
