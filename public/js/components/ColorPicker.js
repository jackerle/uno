// Visual colour picker for Wild cards. Resolves with a colour or null (cancel).
import { audio } from '../core/audio.js';
import { COLOR_NAMES, h } from '../core/util.js';

const ORDER = ['red', 'blue', 'yellow', 'green'];

export function openColorPicker({ cancelable = true, title = 'Choose a color', hint } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('overlay-root');
    let done = false;
    const finish = (color) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.classList.add('is-leaving');
      setTimeout(() => overlay.remove(), 260);
      resolve(color);
    };
    const buttons = ORDER.map((color, i) =>
      h(
        'button.picker-btn',
        {
          type: 'button',
          dataset: { color },
          'aria-label': `${COLOR_NAMES[color]} (${i + 1})`,
          style: { '--i': i },
          onclick: () => {
            audio.play('wild');
            finish(color);
          },
        },
        h('span.picker-btn-label', COLOR_NAMES[color]),
        h('kbd', String(i + 1)),
      ),
    );
    const onKey = (e) => {
      if (e.key === 'Escape' && cancelable) {
        e.preventDefault();
        finish(null);
      } else if (/^[1-4]$/.test(e.key)) {
        e.preventDefault();
        buttons[Number(e.key) - 1].click();
      }
    };
    const overlay = h(
      'div.overlay.overlay--picker',
      { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'picker-title' },
      h(
        'div.picker',
        h('h2.overlay-title#picker-title', title),
        hint ? h('p.overlay-sub', hint) : null,
        h('div.picker-wheel', buttons, h('div.picker-core', { 'aria-hidden': 'true' }, 'WILD')),
        cancelable ? h('button.btn.btn--ghost.btn--sm.picker-cancel', { type: 'button', onclick: () => finish(null) }, 'Cancel') : null,
      ),
    );
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay && cancelable) finish(null);
    });
    document.addEventListener('keydown', onKey, true);
    root.append(overlay);
    requestAnimationFrame(() => buttons[0].focus({ preventScroll: true }));
    // Allow callers to force-close (e.g. state moved on).
    openColorPicker.close = () => finish(null);
  });
}
