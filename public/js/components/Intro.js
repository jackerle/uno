// Round intro: big UNO logo, then 3 · 2 · 1 · GO! — synced to the server start time.
import { audio } from '../core/audio.js';
import { h, prefersReducedMotion, sleep } from '../core/util.js';
import { UnoLogo } from './HomeScreen.js';

export async function playIntro(totalMs, round = 1) {
  const root = document.getElementById('overlay-root');
  const stage = h('div.intro-stage');
  const overlay = h('div.overlay.overlay--intro', { 'aria-live': 'assertive' }, stage);
  root.append(overlay);
  const full = 3800;
  const k = Math.max(0.15, Math.min(1, totalMs / full)); // shorten if we joined late
  const show = async (node, ms, sound) => {
    stage.replaceChildren(node);
    if (sound) audio.play(sound);
    await sleep(ms * k);
  };
  try {
    if (prefersReducedMotion()) {
      await show(h('div.intro-go', 'GO!'), 700);
    } else {
      await show(h('div.intro-logo', UnoLogo(), h('div.intro-round', round > 1 ? `Round ${round}` : 'Get ready')), 1000, 'shuffle');
      for (const n of ['3', '2', '1']) await show(h('div.intro-count', n), 700, 'tick');
      await show(h('div.intro-go', 'GO!'), 650, 'uno');
    }
  } finally {
    overlay.classList.add('is-leaving');
    setTimeout(() => overlay.remove(), 300);
  }
}
