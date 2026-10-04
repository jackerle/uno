// End-to-end tests against a real server over WebSockets.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';
import { TIMING } from '../server/rooms.js';

TIMING.startingMs = 30;
TIMING.botMinMs = 10;
TIMING.botJitterMs = 10;

let srv;
let url;

before(async () => {
  srv = createGameServer();
  await new Promise((r) => srv.server.listen(0, r));
  url = `ws://127.0.0.1:${srv.server.address().port}/ws`;
});
after(() => {
  for (const ws of srv.wss.clients) ws.terminate();
  for (const code of [...srv.manager.rooms.keys()]) srv.manager.deleteRoom(code);
  srv.server.close();
});

class Client {
  constructor() {
    this.rid = 0;
    this.acks = new Map();
    this.state = null;
    this.events = [];
    this.waiters = [];
  }
  open() {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.t === 'ack') this.acks.get(msg.rid)?.(msg);
      if (msg.t === 'state') {
        this.state = msg.state;
        this.events.push(...msg.events);
        this.waiters = this.waiters.filter((w) => !w());
      }
    });
    return new Promise((r) => this.ws.once('open', r));
  }
  send(t, data = {}) {
    const rid = ++this.rid;
    return new Promise((resolve) => {
      this.acks.set(rid, resolve);
      this.ws.send(JSON.stringify({ t, rid, ...data }));
    });
  }
  async ok(t, data) {
    const res = await this.send(t, data);
    assert.equal(res.ok, true, `${t} failed: ${JSON.stringify(res.error)}`);
    return res;
  }
  until(pred, ms = 2000) {
    if (this.state && pred(this.state)) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for state')), ms);
      this.waiters.push(() => {
        if (!pred(this.state)) return false;
        clearTimeout(timer);
        resolve(this.state);
        return true;
      });
    });
  }
  close() {
    this.ws.terminate();
  }
}

async function makeRoom(n, maxPlayers = 8) {
  const clients = [];
  const host = new Client();
  await host.open();
  const { code } = await host.ok('create', { name: 'Host', avatar: 'fox', maxPlayers });
  clients.push(host);
  for (let i = 1; i < n; i++) {
    const cl = new Client();
    await cl.open();
    await cl.ok('join', { code, name: `P${i}`, avatar: 'owl' });
    await cl.ok('ready', { ready: true });
    clients.push(cl);
  }
  return { code, clients, host };
}

const startGame = async ({ host, clients }) => {
  await host.ok('start');
  await Promise.all(clients.map((cl) => cl.until((s) => s.phase === 'PLAYING')));
};

const byId = (clients) => Object.fromEntries(clients.map((cl) => [cl.state.youId, cl]));

/** Have whoever's turn it is take a legal action. */
async function stepGame(clients) {
  const map = byId(clients);
  const s = clients[0].state;
  const actor = map[s.game.currentPlayerId];
  const a = actor.state.actions;
  if (a.canChallenge) return actor.ok('accept');
  if (a.mustChooseColor) return actor.ok('chooseColor', { color: 'red' });
  const card = actor.state.hand.find((x) => a.playable.includes(x.id));
  if (card) return actor.ok('play', { cardId: card.id, color: card.color === 'wild' ? 'blue' : undefined });
  if (a.canPass) return actor.ok('pass');
  return actor.ok('draw');
}

describe('multiplayer', () => {
  for (const n of [2, 3, 5]) {
    test(`${n} players: deal, hidden hands and turns`, async () => {
      const room = await makeRoom(n);
      await startGame(room);
      for (const cl of room.clients) {
        const s = cl.state;
        assert.equal(s.players.length, n);
        assert.equal(s.hand.length, s.players.find((p) => p.id === s.youId).cardCount);
        // No other player's cards anywhere in the payload.
        const json = JSON.stringify(s);
        for (const other of room.clients) {
          if (other === cl) continue;
          for (const card of other.state.hand) assert.ok(!json.includes(card.id), 'leaked a hidden card id');
        }
        assert.equal(s.game.drawPile, undefined);
      }
      for (let i = 0; i < 25; i++) {
        if (room.clients[0].state.phase !== 'PLAYING') break;
        const version = room.clients[0].state.version;
        await stepGame(room.clients);
        await Promise.all(room.clients.map((cl) => cl.until((s) => s.version > version)));
      }
      room.clients.forEach((c) => c.close());
    });
  }

  test('not your turn and invalid move are rejected by the server', async () => {
    const room = await makeRoom(3);
    await startGame(room);
    const map = byId(room.clients);
    const cur = room.clients[0].state.game.currentPlayerId;
    const idle = room.clients.find((cl) => cl.state.youId !== cur);
    const res = await idle.send('play', { cardId: idle.state.hand[0].id });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'NOT_YOUR_TURN');

    const actor = map[cur];
    if (!actor.state.actions.canChallenge && !actor.state.actions.mustChooseColor) {
      const bad = actor.state.hand.find((x) => !actor.state.actions.playable.includes(x.id));
      if (bad) {
        const r = await actor.send('play', { cardId: bad.id });
        assert.equal(r.error.code, 'INVALID_MOVE');
      }
      const fake = await actor.send('play', { cardId: 'forged-card' });
      assert.equal(fake.error.code, 'NOT_IN_HAND');
    }
    room.clients.forEach((c) => c.close());
  });

  test('simultaneous actions: only one draw is accepted', async () => {
    const room = await makeRoom(3);
    await startGame(room);
    const map = byId(room.clients);
    let s = room.clients[0].state;
    while (s.game.pending) {
      const v = s.version;
      await stepGame(room.clients);
      await Promise.all(room.clients.map((cl) => cl.until((x) => x.version > v)));
      s = room.clients[0].state;
    }
    const current = map[s.game.currentPlayerId];
    // Everyone (plus a double-click from the current player) races to draw.
    const racers = [current, current, ...room.clients.filter((cl) => cl !== current)];
    const results = await Promise.all(racers.map((cl) => cl.send('draw')));
    assert.equal(results[0].ok, true);
    for (const r of results.filter((x) => !x.ok)) assert.ok(['NOT_YOUR_TURN', 'ALREADY_DREW', 'PENDING_ACTION'].includes(r.error.code), r.error.code);
    // The current player's duplicate request can never draw a second card.
    assert.equal(results[1].ok, false);
    const end = room.clients[0].state;
    const total = end.players.reduce((sum, p) => sum + p.cardCount, 0) + end.game.drawCount + end.game.discardCount;
    assert.equal(total, 108, 'cards are conserved');
    room.clients.forEach((c) => c.close());
  });

  test('room full, room not found and game already started', async () => {
    const room = await makeRoom(2, 2);
    const extra = new Client();
    await extra.open();
    let r = await extra.send('join', { code: room.code, name: 'Late' });
    assert.equal(r.error.code, 'ROOM_FULL');
    r = await extra.send('join', { code: 'ZZZZZ', name: 'Late' });
    assert.equal(r.error.code, 'ROOM_NOT_FOUND');
    await room.host.ok('settings', { maxPlayers: 4 });
    await startGame(room);
    r = await extra.send('join', { code: room.code, name: 'Late' });
    assert.equal(r.error.code, 'GAME_STARTED');
    [...room.clients, extra].forEach((c) => c.close());
  });

  test('only the host can start / change settings', async () => {
    const room = await makeRoom(2);
    const guest = room.clients[1];
    assert.equal((await guest.send('start')).error.code, 'NOT_HOST');
    assert.equal((await guest.send('settings', { turnTime: 15 })).error.code, 'NOT_HOST');
    room.clients.forEach((c) => c.close());
  });

  test('disconnect and reconnect restores hand, turn and room', async () => {
    const room = await makeRoom(3);
    await startGame(room);
    const guest = room.clients[1];
    const before = guest.state;
    const token = (await guest.ok('join', { code: room.code, name: 'x' })).token; // idempotent → returns session token
    guest.close();
    await room.host.until((s) => s.players.some((p) => p.id === before.youId && !p.connected));

    const again = new Client();
    await again.open();
    const res = await again.ok('resume', { token });
    assert.equal(res.playerId, before.youId);
    const s = await again.until((x) => x.phase === 'PLAYING');
    assert.deepEqual(s.hand.map((x) => x.id).sort(), before.hand.map((x) => x.id).sort());
    assert.equal(s.game.currentPlayerId, before.game.currentPlayerId);
    await room.host.until((st) => st.players.find((p) => p.id === before.youId).connected);

    const bad = new Client();
    await bad.open();
    assert.equal((await bad.send('resume', { token: 'nope' })).error.code, 'SESSION_EXPIRED');
    [...room.clients, again, bad].forEach((c) => c.close());
  });

  test('bots play a full game to completion', async () => {
    const host = new Client();
    await host.open();
    await host.ok('create', { name: 'Solo', maxPlayers: 4 });
    await host.ok('settings', { targetScore: 0, turnTime: 15 });
    await host.ok('addBot');
    await host.ok('addBot');
    await host.ok('start');
    // Human always takes a legal action; bots answer automatically.
    for (let i = 0; i < 400 && host.state.phase !== 'GAME_END'; i++) {
      const s = await host.until((x) => x.phase === 'GAME_END' || x.actions?.isMyTurn || x.actions?.canChallenge, 4000);
      if (s.phase === 'GAME_END') break;
      await stepGame([host]).catch(() => {});
      await host.until((x) => x.version > s.version);
    }
    assert.equal(host.state.phase, 'GAME_END');
    assert.ok(host.state.roundResult.winnerName);
    host.close();
  });
});
