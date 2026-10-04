// WebSocket connection with request/ack, auto-reconnect and clock sync.
import { clock } from './util.js';

export class Connection extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.rid = 0;
    this.pending = new Map();
    this.retry = 0;
    this.everOpened = false;
    this.pingTimer = null;
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 0;
      const reconnect = this.everOpened;
      this.everOpened = true;
      this.emit('open', { reconnect });
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 15000);
    });
    ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'ack') {
        const p = this.pending.get(msg.rid);
        if (p) {
          this.pending.delete(msg.rid);
          clearTimeout(p.timer);
          p.resolve(msg);
        }
      } else if (msg.t === 'pong') {
        clock.sync(msg.serverNow, performance.now() - msg.clientTime);
      } else {
        this.emit(msg.t, msg);
      }
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: { code: 'CONNECTION_LOST', message: 'Connection lost' } });
      }
      this.pending.clear();
      this.emit('close');
      const delay = Math.min(5000, 400 * 2 ** this.retry++) + Math.random() * 300;
      setTimeout(() => this.connect(), delay);
    });
  }

  ping() {
    if (!this.isOpen) return;
    this.ws.send(JSON.stringify({ t: 'ping', clientTime: performance.now() }));
  }

  /** Sends an intent and resolves with the server's ack ({ ok, error? , ...}). */
  request(t, data = {}) {
    if (!this.isOpen) return Promise.resolve({ ok: false, error: { code: 'CONNECTION_LOST', message: 'Not connected to the server' } });
    const rid = ++this.rid;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        resolve({ ok: false, error: { code: 'TIMEOUT', message: 'The server did not respond' } });
      }, 10000);
      this.pending.set(rid, { resolve, timer });
      this.ws.send(JSON.stringify({ t, rid, ...data }));
    });
  }
}
