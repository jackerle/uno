// "Player used Wild Draw Four — challenge?" decision dialog.
import { COLOR_NAMES, clock, h } from '../core/util.js';
import { createCard } from './Card.js';

export class ChallengeModal {
  constructor({ onChallenge, onAccept }) {
    this.onChallenge = onChallenge;
    this.onAccept = onAccept;
    this.el = null;
    this.raf = 0;
  }

  get isOpen() {
    return Boolean(this.el);
  }

  open({ offenderName, prevColor, turnEndsAt, turnDuration }) {
    if (this.el) return;
    const busy = (fn) => async () => {
      this.el?.querySelectorAll('button').forEach((b) => (b.disabled = true));
      const ok = await fn();
      if (ok === false) this.el?.querySelectorAll('button').forEach((b) => (b.disabled = false));
    };
    const timerFill = h('span.challenge-timer-fill');
    const colorName = prevColor ? COLOR_NAMES[prevColor] : 'the previous color';
    this.el = h(
      'div.overlay.overlay--challenge',
      { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'ch-title', 'aria-describedby': 'ch-desc' },
      h(
        'div.challenge.glass',
        h('div.challenge-card', createCard({ id: 'ch', color: 'wild', value: 'wild4' })),
        h('p.challenge-kicker', `${offenderName} used`),
        h('h2.overlay-title#ch-title', 'Wild Draw Four'),
        h(
          'p.overlay-sub#ch-desc',
          'Do you want to challenge? If ',
          h('b', offenderName),
          ' was holding a ',
          h('b', { class: `ink-${prevColor}` }, colorName),
          ' card, they draw 4 instead. If not, you draw 6.',
        ),
        h(
          'div.challenge-actions',
          h('button.btn.btn--lg.btn--danger', { type: 'button', onclick: busy(this.onChallenge) }, 'Challenge'),
          h('button.btn.btn--lg.btn--ghost', { type: 'button', onclick: busy(this.onAccept) }, 'Accept +4'),
        ),
        turnEndsAt ? h('div.challenge-timer', { 'aria-hidden': 'true' }, timerFill) : null,
      ),
    );
    document.getElementById('overlay-root').append(this.el);
    this.el.querySelector('.btn').focus({ preventScroll: true });
    if (turnEndsAt) {
      const tick = () => {
        const left = Math.max(0, turnEndsAt - clock.now());
        timerFill.style.transform = `scaleX(${left / (turnDuration || 1)})`;
        if (left > 0 && this.el) this.raf = requestAnimationFrame(tick);
      };
      tick();
    }
  }

  close() {
    cancelAnimationFrame(this.raf);
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  }
}
