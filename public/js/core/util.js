// Small DOM + formatting helpers shared by all components.

/** Hyperscript: h('div.cls#id', { attrs }, ...children) */
export function h(tag, props, ...children) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const part of rest) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else if (part[0] === '#') el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
        else el.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const svg = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
};

export const $ = (sel, root = document) => root.querySelector(sel);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stable small hash for deterministic per-card jitter. */
export function hash(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return (x >>> 0) / 4294967295;
}

export const COLOR_NAMES = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };
export const COLOR_HEX = { red: '#ff3d55', yellow: '#ffcc2e', green: '#21c776', blue: '#2e85ff' };
const VALUE_NAMES = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };

export function cardLabel(card) {
  if (!card) return 'no card';
  const v = VALUE_NAMES[card.value] ?? card.value;
  return card.color === 'wild' ? v : `${COLOR_NAMES[card.color]} ${v}`;
}

export const AVATARS = {
  fox: { glyph: '🦊', bg: 'linear-gradient(135deg,#ff9a4d,#ff4f6d)' },
  panda: { glyph: '🐼', bg: 'linear-gradient(135deg,#9aa4c8,#4a5274)' },
  tiger: { glyph: '🐯', bg: 'linear-gradient(135deg,#ffc44d,#ff7a1a)' },
  lion: { glyph: '🦁', bg: 'linear-gradient(135deg,#ffd76a,#d68a12)' },
  frog: { glyph: '🐸', bg: 'linear-gradient(135deg,#7cf0a0,#16a35a)' },
  octopus: { glyph: '🐙', bg: 'linear-gradient(135deg,#ff8fd0,#b0369a)' },
  unicorn: { glyph: '🦄', bg: 'linear-gradient(135deg,#d8a8ff,#7a5cff)' },
  dragon: { glyph: '🐲', bg: 'linear-gradient(135deg,#5ef0c8,#139a8a)' },
  alien: { glyph: '👽', bg: 'linear-gradient(135deg,#b4ff6a,#3fa82a)' },
  robot: { glyph: '🤖', bg: 'linear-gradient(135deg,#7fd3ff,#3a6bd6)' },
  penguin: { glyph: '🐧', bg: 'linear-gradient(135deg,#8fb0ff,#2d3f8a)' },
  owl: { glyph: '🦉', bg: 'linear-gradient(135deg,#e0b48a,#8a5a35)' },
};
export const AVATAR_IDS = Object.keys(AVATARS);

/** Server clock offset so countdowns agree across clients. */
export const clock = {
  offset: 0,
  now() {
    return Date.now() + this.offset;
  },
  sync(serverNow, rtt = 0) {
    const sample = serverNow - Date.now() + rtt / 2;
    this.offset = this.offset === 0 ? sample : this.offset * 0.7 + sample * 0.3;
  },
};

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

export const session = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem('uno.session') || 'null');
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      if (value) sessionStorage.setItem('uno.session', JSON.stringify(value));
      else sessionStorage.removeItem('uno.session');
    } catch {
      /* storage unavailable */
    }
  },
};

const live = () => document.getElementById('sr-live');
export function announce(text) {
  const el = live();
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => (el.textContent = text));
}

export const ICONS = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17-5-5 5-5M5 12h11"/></svg>',
  crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>',
  bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 14h.01M15 14h.01"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  wifiOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 5-2.7M19 12.5a10 10 0 0 0-2-1.5M12 20h.01"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};
export const icon = (name) => svg(ICONS[name]);
