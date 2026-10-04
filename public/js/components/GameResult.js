// Round / game result overlay with winner spotlight and standings.
import { audio } from '../core/audio.js';
import { h } from '../core/util.js';
import { createCard } from './Card.js';
import { confetti } from './fx.js';
import { PlayerAvatar } from './PlayerAvatar.js';

export class GameResult {
  constructor({ onNext, onLobby, onLeave }) {
    this.onNext = onNext;
    this.onLobby = onLobby;
    this.onLeave = onLeave;
    this.el = null;
    this.key = null;
  }

  show(state) {
    const r = state.roundResult;
    if (!r) return this.hide();
    const key = `${state.round}:${state.phase}:${state.hostId}`;
    if (this.key === key && this.el) return;
    const first = this.key?.split(':')[0] !== String(state.round);
    this.key = key;
    this.el?.remove();

    const isHost = state.hostId === state.youId;
    const youWon = r.winnerId === state.youId;
    const target = r.targetScore;
    const reason = r.reason === 'forfeit' ? 'Everyone else left the table' : `+${r.points} points`;

    const standings = r.standings.map((p, i) =>
      h(
        'li.standing',
        { class: p.id === r.winnerId ? 'is-winner' : '', style: { '--i': i } },
        h('span.standing-rank', String(i + 1)),
        PlayerAvatar(p.avatar, 36),
        h('span.standing-name', p.name, p.id === state.youId ? h('span.you-tag', 'You') : null),
        h(
          'span.standing-cards',
          p.cards.slice(0, 6).map((c) => createCard(c)),
          p.cards.length > 6 ? h('span.more', `+${p.cards.length - 6}`) : null,
        ),
        h(
          'span.standing-score',
          h('b', String(p.score)),
          target ? h('span.score-bar', h('i', { style: { transform: `scaleX(${Math.min(1, p.score / target)})` } })) : null,
        ),
      ),
    );

    const actions = isHost
      ? r.gameOver
        ? [h('button.btn.btn--lg.btn--gold', { type: 'button', onclick: () => this.onLobby() }, 'Play again'), h('button.btn.btn--lg.btn--ghost', { type: 'button', onclick: () => this.onLeave() }, 'Leave')]
        : [h('button.btn.btn--lg.btn--go', { type: 'button', onclick: () => this.onNext() }, 'Next round'), h('button.btn.btn--lg.btn--ghost', { type: 'button', onclick: () => this.onLeave() }, 'Leave')]
      : [h('p.wait-host', h('span.spinner'), r.gameOver ? 'Waiting for the host to start a new game…' : 'Waiting for the host to deal the next round…'), h('button.btn.btn--ghost', { type: 'button', onclick: () => this.onLeave() }, 'Leave')];

    this.el = h(
      'div.overlay.overlay--result',
      { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'result-title' },
      h('div.result-rays', { 'aria-hidden': 'true' }),
      h(
        'div.result.glass',
        h('div.result-trophy', { 'aria-hidden': 'true' }, '🏆'),
        h('div.result-winner', PlayerAvatar(r.standings.find((p) => p.id === r.winnerId)?.avatar ?? 'fox', 84)),
        h('p.result-kicker', r.gameOver ? (target ? `First to ${target} · Game over` : 'Game over') : `Round ${state.round} complete`),
        h('h2.result-title#result-title', youWon ? 'YOU WIN!' : `${r.winnerName.toUpperCase()} WINS!`),
        h('p.result-points', reason),
        h('ol.standings', standings),
        h('div.result-actions', actions),
      ),
    );
    document.getElementById('overlay-root').append(this.el);
    this.el.querySelector('.btn')?.focus({ preventScroll: true });
    if (first) {
      audio.play('victory');
      confetti({ count: youWon ? 180 : 110 });
    }
  }

  hide() {
    this.key = null;
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 300);
  }
}
