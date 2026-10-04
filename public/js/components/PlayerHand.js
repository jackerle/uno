// The local player's hand: fan layout, hover/select, Pointer-Events drag & drop
// (mouse + touch), tap-to-select fallback and full keyboard support.
import { audio } from '../core/audio.js';
import { cardLabel, clamp, h } from '../core/util.js';
import { createCard } from './Card.js';
import { shake } from './fx.js';

const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
const VALUE_ORDER = (v) => ({ skip: 10, reverse: 11, draw2: 12, wild: 13, wild4: 14 })[v] ?? Number(v);
const sortHand = (cards) => [...cards].sort((a, b) => COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || VALUE_ORDER(a.value) - VALUE_ORDER(b.value));

const DRAG_THRESHOLD = 7;
const ZONE_SLOP = 36;

export class PlayerHand {
  /**
   * @param {object} o
   * @param {() => HTMLElement} o.getDropZone
   * @param {(id:string) => Promise<boolean>} o.onPlay    resolves true if the play went through
   * @param {(id:string) => void} o.onInvalid
   * @param {(id:string|null) => void} o.onSelect
   */
  constructor({ getDropZone, onPlay, onInvalid, onSelect }) {
    this.getDropZone = getDropZone;
    this.onPlay = onPlay;
    this.onInvalid = onInvalid;
    this.onSelectCb = onSelect;
    this.items = new Map(); // id -> { card, wrap }
    this.order = [];
    this.playable = new Set();
    this.myTurn = false;
    this.selectedId = null;
    this.drag = null;
    this.incoming = new Set();

    this.inner = h('div.hand', { role: 'listbox', 'aria-label': 'Your hand', 'aria-orientation': 'horizontal' });
    this.el = h('div.hand-scroll', this.inner);

    this.inner.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.inner.addEventListener('click', (e) => this.onClick(e));
    this.inner.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.inner.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => this.layout()).observe(this.el);
  }

  // ---------------------------------------------------------------- render
  update(hand, { playable, myTurn }) {
    this.playable = new Set(playable);
    this.myTurn = myTurn;
    const sorted = sortHand(hand);
    const ids = new Set(sorted.map((c) => c.id));

    for (const [id, item] of this.items) {
      if (!ids.has(id)) {
        item.wrap.remove();
        this.items.delete(id);
        if (this.selectedId === id) this.selectedId = null;
      }
    }
    for (const card of sorted) {
      if (this.items.has(card.id)) continue;
      const wrap = h('button.hand-card.no-anim', { type: 'button', role: 'option', dataset: { id: card.id } }, createCard(card));
      if (this.incoming.has(card.id)) wrap.classList.add('is-incoming');
      this.items.set(card.id, { card, wrap });
      this.inner.append(wrap);
    }
    this.order = sorted.map((c) => c.id);
    // DOM order = visual order so Tab / screen readers follow the fan.
    this.order.forEach((id) => this.inner.append(this.items.get(id).wrap));

    for (const [id, { card, wrap }] of this.items) {
      const ok = this.playable.has(id);
      wrap.classList.toggle('is-playable', myTurn && ok);
      wrap.classList.toggle('is-unplayable', myTurn && !ok);
      wrap.classList.toggle('is-selected', id === this.selectedId);
      wrap.setAttribute('aria-selected', String(id === this.selectedId));
      wrap.setAttribute(
        'aria-label',
        `${cardLabel(card)}${myTurn ? (ok ? ', playable' : ', cannot be played now') : ''}${id === this.selectedId ? ', selected — press Enter to play' : ''}`,
      );
    }
    if (this.selectedId && !(myTurn && this.playable.has(this.selectedId))) this.select(null);
    this.layout();
  }

  layout() {
    const n = this.order.length;
    if (!n) return;
    const W = this.el.clientWidth;
    const cw = this.cardWidth();
    const pad = 14;
    const avail = Math.max(cw, W - pad * 2);
    const maxStep = cw * 0.72;
    const minStep = cw * 0.38;
    const step = n > 1 ? clamp((avail - cw) / (n - 1), minStep, maxStep) : 0;
    const total = cw + step * (n - 1);
    const overflow = total > avail + 1;
    this.inner.style.width = overflow ? `${total + pad * 2}px` : '100%';
    this.el.classList.toggle('is-overflowing', overflow);
    const x0 = overflow ? pad : (W - total) / 2;
    const mid = (n - 1) / 2;
    const ang = overflow ? 0 : Math.min(3.4, 30 / n);
    const arc = (deg) => (1 - Math.cos((deg * Math.PI) / 180)) * cw * 7;
    const arcMax = arc(mid * ang); // outer cards rest on the baseline, centre rises
    this.order.forEach((id, i) => {
      const { wrap } = this.items.get(id);
      const d = i - mid;
      const rot = d * ang;
      const y = arc(rot) - arcMax - 4;
      wrap.style.transform = `translate(${x0 + i * step}px, ${y}px) rotate(${rot}deg)`;
      wrap.style.zIndex = String(i + 1);
    });
    requestAnimationFrame(() => this.inner.querySelectorAll('.no-anim').forEach((w) => w.classList.remove('no-anim')));
  }

  /** Resolved card width in px (the CSS var holds an unresolved clamp()). */
  cardWidth() {
    return this.inner.querySelector('.card')?.offsetWidth || 100;
  }

  rectOf(id) {
    return this.items.get(id)?.wrap.querySelector('.card').getBoundingClientRect() ?? null;
  }

  cardOf(id) {
    return this.items.get(id)?.card ?? null;
  }

  markIncoming(ids) {
    ids.forEach((id) => this.incoming.add(id));
    ids.forEach((id) => this.items.get(id)?.wrap.classList.add('is-incoming'));
  }

  reveal(id) {
    this.incoming.delete(id);
    this.items.get(id)?.wrap.classList.remove('is-incoming');
  }

  revealAll() {
    for (const id of [...this.incoming]) this.reveal(id);
  }

  select(id) {
    this.selectedId = id;
    for (const [cid, { wrap }] of this.items) {
      wrap.classList.toggle('is-selected', cid === id);
      wrap.setAttribute('aria-selected', String(cid === id));
    }
    this.onSelectCb?.(id);
  }

  // ------------------------------------------------------------ interaction
  tap(id) {
    if (this.selectedId === id && this.playable.has(id) && this.myTurn) {
      this.onPlay(id);
      return;
    }
    if (!this.myTurn) {
      shake(this.items.get(id)?.wrap.querySelector('.card'));
      this.onInvalid(id, 'NOT_YOUR_TURN');
      return;
    }
    if (!this.playable.has(id)) {
      shake(this.items.get(id)?.wrap.querySelector('.card'));
      this.onInvalid(id, 'INVALID_MOVE');
      return;
    }
    audio.play('click');
    this.select(this.selectedId === id ? null : id);
  }

  onClick(e) {
    // Pointer taps are handled on pointerup; this path is keyboard activation.
    if (e.detail !== 0) return;
    const wrap = e.target.closest('.hand-card');
    if (wrap) this.tap(wrap.dataset.id);
  }

  onKeyDown(e) {
    const wrap = e.target.closest('.hand-card');
    if (!wrap) return;
    const i = this.order.indexOf(wrap.dataset.id);
    let next = null;
    if (e.key === 'ArrowRight') next = this.order[Math.min(this.order.length - 1, i + 1)];
    if (e.key === 'ArrowLeft') next = this.order[Math.max(0, i - 1)];
    if (e.key === 'Home') next = this.order[0];
    if (e.key === 'End') next = this.order[this.order.length - 1];
    if (next) {
      e.preventDefault();
      const w = this.items.get(next).wrap;
      w.focus();
      w.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (e.key === 'Escape' && this.selectedId) this.select(null);
  }

  onPointerDown(e) {
    const wrap = e.target.closest('.hand-card');
    if (!wrap || e.button > 0 || this.drag) return;
    audio.unlock();
    const id = wrap.dataset.id;
    if (wrap.classList.contains('is-incoming')) return;
    this.drag = { id, wrap, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, pointerType: e.pointerType };
    const move = (ev) => this.onPointerMove(ev);
    const up = (ev) => {
      cleanup();
      this.onPointerUp(ev);
    };
    const cancel = () => {
      cleanup();
      this.onPointerCancel();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      // On touch, horizontal swipes scroll the hand; upward motion picks a card up.
      if (d.pointerType === 'touch' && this.el.classList.contains('is-overflowing') && Math.abs(dx) > Math.abs(dy) * 1.2) {
        this.drag = null;
        return;
      }
      this.startDrag(e);
    }
    e.preventDefault();
    d.px = e.clientX;
    d.py = e.clientY;
    if (!d.raf) d.raf = requestAnimationFrame(() => this.renderDrag());
  }

  startDrag(e) {
    const d = this.drag;
    const cardEl = d.wrap.querySelector('.card');
    const rect = cardEl.getBoundingClientRect();
    const item = this.items.get(d.id);
    const cw = this.cardWidth();
    d.active = true;
    d.offX = d.x0 - rect.left - (rect.width - cw) / 2;
    d.offY = d.y0 - rect.top - (rect.height - cw * 1.5) / 2;
    d.cw = cw;
    d.origin = rect;
    d.tilt = 0;
    d.lastX = e.clientX;
    d.playable = this.myTurn && this.playable.has(d.id);
    d.ghost = h('div.drag-ghost', createCard(item.card));
    d.ghost.style.setProperty('--cw', `${cw}px`);
    document.getElementById('fx-layer').append(d.ghost);
    d.wrap.classList.add('is-drag-source');
    document.body.classList.add('is-dragging');
    const zone = this.getDropZone();
    zone.classList.add('is-armed', d.playable ? 'is-valid' : 'is-invalid');
    audio.play('click');
    this.select(null);
    d.px = e.clientX;
    d.py = e.clientY;
    this.renderDrag();
  }

  renderDrag() {
    const d = this.drag;
    if (!d?.active) return;
    d.raf = 0;
    const vx = d.px - d.lastX;
    d.lastX = d.px;
    d.tilt = d.tilt * 0.78 + clamp(vx * 1.4, -22, 22) * 0.22;
    d.ghost.style.transform = `translate(${d.px - d.offX}px, ${d.py - d.offY}px) rotate(${d.tilt}deg) scale(1.1)`;
    const zone = this.getDropZone();
    const r = zone.getBoundingClientRect();
    d.over = d.px > r.left - ZONE_SLOP && d.px < r.right + ZONE_SLOP && d.py > r.top - ZONE_SLOP && d.py < r.bottom + ZONE_SLOP;
    zone.classList.toggle('is-over', d.over);
  }

  endDragVisuals() {
    document.body.classList.remove('is-dragging');
    this.getDropZone().classList.remove('is-armed', 'is-valid', 'is-invalid', 'is-over');
  }

  async onPointerUp(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.active) {
      this.drag = null;
      if (e.pointerType !== 'mouse' || e.button === 0) this.tap(d.id);
      return;
    }
    cancelAnimationFrame(d.raf);
    this.renderDrag();
    this.endDragVisuals();
    if (d.over && d.playable) {
      const ok = await this.onPlay(d.id, { ghost: d.ghost });
      if (!ok) await this.returnGhost(d);
      else d.wrap.classList.remove('is-drag-source');
    } else {
      if (d.over) {
        shake(d.ghost.firstElementChild);
        this.onInvalid(d.id, this.myTurn ? 'INVALID_MOVE' : 'NOT_YOUR_TURN');
        await new Promise((r) => setTimeout(r, 300));
      }
      await this.returnGhost(d);
    }
    this.drag = null;
  }

  onPointerCancel() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (!d.active) return;
    cancelAnimationFrame(d.raf);
    this.endDragVisuals();
    this.returnGhost(d);
  }

  async returnGhost(d) {
    const ghost = d.ghost;
    if (!ghost?.isConnected) {
      d.wrap.classList.remove('is-drag-source');
      return;
    }
    const target = d.wrap.isConnected ? d.wrap.querySelector('.card').getBoundingClientRect() : d.origin;
    const tx = target.left + (target.width - d.cw) / 2;
    const ty = target.top + (target.height - d.cw * 1.5) / 2;
    await ghost
      .animate([{ transform: ghost.style.transform }, { transform: `translate(${tx}px, ${ty}px) rotate(0deg) scale(1)` }], {
        duration: 280,
        easing: 'cubic-bezier(.3,.9,.3,1)',
        fill: 'forwards',
      })
      .finished.catch(() => {});
    ghost.remove();
    d.wrap.classList.remove('is-drag-source');
  }
}
