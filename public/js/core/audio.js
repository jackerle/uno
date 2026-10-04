// Audio service abstraction.
// Every game event maps to a sound id. To use real assets, drop files into
// /public/sounds and list them in SOUND_FILES — anything without a file falls
// back to a tiny procedural WebAudio cue, so the game is never silent/broken.
import { storage } from './util.js';

export const SOUND_EVENTS = [
  'draw', 'play', 'skip', 'reverse', 'draw2', 'wild', 'wild4', 'uno', 'turn',
  'victory', 'error', 'tick', 'click', 'challenge', 'shuffle', 'deal',
];

/** e.g. { play: '/sounds/play.mp3', victory: '/sounds/victory.mp3' } */
export const SOUND_FILES = {};

const SYNTH = {
  play: (a) => a.noise(0.07, 2400, 0.35).tone(180, 0.08, 'triangle', 0.18),
  draw: (a) => a.noise(0.12, 5200, 0.16, 1400),
  deal: (a) => a.noise(0.05, 4800, 0.12, 1800),
  shuffle: (a) => [0, 0.06, 0.12, 0.18].forEach((t) => a.noise(0.05, 4000, 0.12, 1500, t)),
  skip: (a) => a.tone(520, 0.09, 'square', 0.08).tone(320, 0.14, 'square', 0.08, 0.08),
  reverse: (a) => a.sweep(300, 900, 0.18, 0.12).sweep(900, 300, 0.18, 0.1, 0.16),
  draw2: (a) => a.tone(440, 0.08, 'sawtooth', 0.07).tone(440, 0.08, 'sawtooth', 0.07, 0.11),
  wild: (a) => [523, 659, 784, 1047].forEach((f, i) => a.tone(f, 0.12, 'triangle', 0.12, i * 0.06)),
  wild4: (a) => [196, 247, 294, 392].forEach((f, i) => a.tone(f, 0.16, 'sawtooth', 0.08, i * 0.07)),
  uno: (a) => [784, 988, 1175, 1568].forEach((f, i) => a.tone(f, 0.16, 'square', 0.07, i * 0.07)),
  turn: (a) => a.tone(880, 0.12, 'sine', 0.14).tone(1318, 0.18, 'sine', 0.12, 0.1),
  tick: (a) => a.tone(1600, 0.03, 'square', 0.04),
  click: (a) => a.tone(1200, 0.025, 'triangle', 0.06),
  error: (a) => a.tone(140, 0.16, 'sawtooth', 0.09).tone(110, 0.18, 'sawtooth', 0.08, 0.1),
  challenge: (a) => a.sweep(200, 600, 0.3, 0.1),
  victory: (a) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => a.tone(f, i === 5 ? 0.5 : 0.14, 'triangle', 0.14, i * 0.11)),
};

class AudioService {
  constructor() {
    this.enabled = storage.get('uno.sound', true);
    this.ctx = null;
    this.buffers = new Map();
    this.master = null;
  }

  /** Must be called from a user gesture (browser autoplay policies). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    for (const [id, url] of Object.entries(SOUND_FILES)) this.load(id, url);
  }

  async load(id, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      this.buffers.set(id, await this.ctx.decodeAudioData(await res.arrayBuffer()));
    } catch {
      /* fall back to synth */
    }
  }

  setEnabled(on) {
    this.enabled = on;
    storage.set('uno.sound', on);
  }

  play(id) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const buffer = this.buffers.get(id);
    if (buffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.master);
      src.start();
      return;
    }
    SYNTH[id]?.(this.synth());
  }

  // ---------------------------------------------------- procedural helpers
  synth() {
    const ctx = this.ctx;
    const out = this.master;
    const api = {
      tone(freq, dur, type = 'sine', vol = 0.1, delay = 0) {
        const t = ctx.currentTime + delay;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + dur + 0.02);
        return api;
      },
      sweep(from, to, dur, vol = 0.1, delay = 0) {
        const t = ctx.currentTime + delay;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(from, t);
        o.frequency.exponentialRampToValueAtTime(to, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + dur + 0.02);
        return api;
      },
      noise(dur, freq = 3000, vol = 0.2, q = 0.8, delay = 0) {
        const t = ctx.currentTime + delay;
        const len = Math.ceil(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = vol;
        src.connect(f).connect(g).connect(out);
        src.start(t);
        return api;
      },
    };
    return api;
  }
}

export const audio = new AudioService();
