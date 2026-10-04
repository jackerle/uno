// Transform/opacity-only effects: flying cards, bursts, shakes, confetti.
import { createCard, createCardBack, createFlipCard } from './Card.js';
import { h, prefersReducedMotion } from '../core/util.js';

const layer = () => document.getElementById('fx-layer');
const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * Fly a card from one rect to another.
 * @param {object} o
 * @param {DOMRect} o.from
 * @param {DOMRect} o.to            final rect (defines the rendered size)
 * @param {object|null} [o.card]    face to show; null → card back
 * @param {boolean} [o.flip]        start face-down and flip to the face mid-flight
 * @param {number} [o.duration]
 * @param {number} [o.delay]
 * @param {number} [o.fromRotate]
 * @param {number} [o.toRotate]
 * @param {number} [o.toScale]      scale at the end (for shrinking into a seat)
 * @param {boolean} [o.keep]        don't remove at the end (caller cleans up)
 */
export function flyCard({ from, to, card = null, flip = false, duration = 520, delay = 0, fromRotate = 0, toRotate = 0, toScale = 1, keep = false, chosen }) {
  const reduced = prefersReducedMotion();
  const width = to.width / toScale;
  const inner = flip && card ? createFlipCard(card) : card ? createCard(card, { chosen }) : createCardBack();
  const el = h('div.fly', inner);
  el.style.setProperty('--cw', `${width}px`);
  inner.querySelectorAll?.('.card').forEach((c) => c.style.setProperty('--cw', `${width}px`));
  if (inner.classList.contains('card')) inner.style.setProperty('--cw', `${width}px`);
  const c1 = center(to);
  el.style.left = `${c1.x - width / 2}px`;
  el.style.top = `${c1.y - (width * 1.5) / 2}px`;
  layer().append(el);

  const c0 = center(from);
  const dx = c0.x - c1.x;
  const dy = c0.y - c1.y;
  const s0 = from.width / width;
  const lift = Math.min(120, Math.hypot(dx, dy) * 0.18);
  const anim = el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(${fromRotate}deg)`, offset: 0 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(${Math.max(s0, toScale) * 1.12}) rotate(${(fromRotate + toRotate) / 2 + 8}deg)`, offset: 0.55 },
      { transform: `translate(0, 0) scale(${toScale}) rotate(${toRotate}deg)`, offset: 1 },
    ],
    { duration: reduced ? 1 : duration, delay: reduced ? 0 : delay, easing: 'cubic-bezier(.25,.8,.3,1)', fill: 'both' },
  );
  if (flip && card && !reduced) {
    inner.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(180deg)', offset: 0.2 }, { transform: 'rotateY(0deg)' }], {
      duration,
      delay,
      easing: 'ease-in-out',
      fill: 'both',
    });
  }
  return anim.finished
    .catch(() => {})
    .then(() => {
      if (!keep) el.remove();
      return el;
    });
}

/** Big floating label (SKIP, +2, UNO!…) centred on a rect. */
export function burst(text, rect, { tone = 'default', size = 1 } = {}) {
  if (!rect) return;
  const c = center(rect);
  const el = h(`div.burst.burst--${tone}`, { style: { left: `${c.x}px`, top: `${c.y}px`, '--s': size } }, text);
  layer().append(el);
  const anim = el.animate(
    [
      { transform: 'translate(-50%,-50%) scale(.3) rotate(-8deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.12) rotate(2deg)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1, offset: 0.7 },
      { transform: 'translate(-50%,-90%) scale(.96)', opacity: 0 },
    ],
    { duration: prefersReducedMotion() ? 900 : 1300, easing: 'cubic-bezier(.2,.9,.3,1)' },
  );
  anim.finished.catch(() => {}).then(() => el.remove());
}

/** Expanding ring pulse (e.g. colour change on the discard pile). */
export function ripple(rect, color) {
  if (!rect || prefersReducedMotion()) return;
  const c = center(rect);
  const size = Math.max(rect.width, rect.height) * 1.2;
  const el = h('div.ripple', { style: { left: `${c.x - size / 2}px`, top: `${c.y - size / 2}px`, width: `${size}px`, height: `${size}px`, '--rc': color } });
  layer().append(el);
  el.animate([{ transform: 'scale(.6)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 800, easing: 'ease-out' }).finished.then(() => el.remove());
}

export function shake(el) {
  if (!el) return;
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-9px) rotate(-3deg)' },
      { transform: 'translateX(8px) rotate(2deg)' },
      { transform: 'translateX(-6px) rotate(-1deg)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 420, easing: 'ease-out' },
  );
}

/** Lightweight confetti on a single canvas, auto-stops. */
export function confetti({ duration = 3800, count = 150 } = {}) {
  if (prefersReducedMotion()) return;
  const canvas = h('canvas.confetti');
  layer().append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const W = innerWidth;
  const H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#ff3d55', '#ffcc2e', '#21c776', '#2e85ff', '#ffffff', '#8f7dff'];
  const parts = Array.from({ length: count }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? -10 : W + 10,
      y: H * (0.45 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * (5 + Math.random() * 9),
      vy: -(9 + Math.random() * 10),
      w: 6 + Math.random() * 7,
      h: 9 + Math.random() * 9,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      color: colors[i % colors.length],
    };
  });
  const start = performance.now();
  const frame = (t) => {
    const elapsed = t - start;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, Math.min(1, (duration - elapsed) / 600));
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.rot * 2));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
