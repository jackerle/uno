// Subtle floating light particles behind everything (capped count, paused when hidden).
import { prefersReducedMotion } from '../core/util.js';

export function startAmbient(canvas) {
  const ctx = canvas.getContext('2d');
  const palette = ['255,61,85', '255,204,46', '33,199,118', '46,133,255', '143,125,255', '66,227,255'];
  let w = 0;
  let h = 0;
  let raf = 0;
  let particles = [];

  // Pre-rendered glow sprites: far cheaper than a gradient per particle per frame.
  const sprites = palette.map((rgb) => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return c;
  });

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(38, (w * h) / 32000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 2.5 + Math.random() * 8,
      vx: (Math.random() - 0.5) * 0.12,
      vy: -0.05 - Math.random() * 0.18,
      a: 0.12 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      sprite: sprites[(Math.random() * sprites.length) | 0],
    }));
  };

  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -20) {
        p.y = h + 20;
        p.x = Math.random() * w;
      }
      if (p.x < -20) p.x = w + 20;
      if (p.x > w + 20) p.x = -20;
      ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(t / 1400 + p.phase));
      ctx.drawImage(p.sprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
  };

  const loop = (t) => {
    draw(t);
    raf = requestAnimationFrame(loop);
  };

  const run = () => {
    cancelAnimationFrame(raf);
    if (prefersReducedMotion()) draw(0);
    else if (!document.hidden) raf = requestAnimationFrame(loop);
  };

  resize();
  run();
  window.addEventListener('resize', () => {
    resize();
    run();
  });
  document.addEventListener('visibilitychange', run);
}
