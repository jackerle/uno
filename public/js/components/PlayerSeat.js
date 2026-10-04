// Opponent seat around the table: avatar, name, card fan, turn ring, UNO badge.
import { h, icon, svg } from '../core/util.js';
import { createCardBack } from './Card.js';
import { PlayerAvatar } from './PlayerAvatar.js';

const RING = `<svg class="seat-ring" viewBox="0 0 100 100" aria-hidden="true">
  <circle class="seat-ring-track" cx="50" cy="50" r="46" pathLength="100"/>
  <circle class="seat-ring-fill" cx="50" cy="50" r="46" pathLength="100"/></svg>`;

export class PlayerSeat {
  constructor(player, { onCatch }) {
    this.id = player.id;
    this.avatar = player.avatar;
    this.count = -1;
    this.ring = svg(RING);
    this.ringFill = this.ring.querySelector('.seat-ring-fill');
    this.avatarWrap = h('div.seat-avatar', this.ring, PlayerAvatar(player.avatar, 52), h('span.seat-offline', { title: 'Disconnected' }, icon('wifiOff')));
    this.name = h('span.seat-name');
    this.countEl = h('span.seat-count');
    this.fan = h('div.seat-fan', { 'aria-hidden': 'true' });
    this.status = h('span.seat-status');
    this.unoBadge = h('span.seat-uno', { 'aria-hidden': 'true' }, 'UNO!');
    this.catchBtn = h('button.seat-catch', { type: 'button', onclick: () => onCatch(this.id) }, 'Catch!');
    this.el = h(
      'div.seat',
      { dataset: { id: player.id }, role: 'group' },
      this.fan,
      h('div.seat-plate', this.avatarWrap, h('div.seat-meta', this.name, h('div.seat-sub', this.countEl, this.status))),
      this.unoBadge,
      this.catchBtn,
    );
  }

  /** Where flying cards should land / launch for this seat. */
  get anchorRect() {
    return this.fan.getBoundingClientRect();
  }

  update(p, { isTurn, isNext, vulnerable, canCatch, statusText }) {
    this.name.textContent = p.name;
    if (p.cardCount !== this.count) {
      this.count = p.cardCount;
      this.countEl.textContent = `${p.cardCount} card${p.cardCount === 1 ? '' : 's'}`;
      const shown = Math.min(p.cardCount, 8);
      const spread = Math.min(44, shown * 7);
      this.fan.replaceChildren(
        ...Array.from({ length: shown }, (_, i) => {
          const t = shown === 1 ? 0 : i / (shown - 1) - 0.5;
          const back = createCardBack({ mini: true });
          back.style.transform = `translateX(${t * spread * 1.1}px) rotate(${t * spread}deg)`;
          return back;
        }),
      );
    }
    this.el.classList.toggle('is-turn', Boolean(isTurn));
    this.el.classList.toggle('is-next', Boolean(isNext) && !isTurn);
    this.el.classList.toggle('is-offline', !p.connected);
    this.el.classList.toggle('is-uno', p.cardCount === 1);
    this.el.classList.toggle('is-vulnerable', Boolean(vulnerable));
    this.catchBtn.hidden = !(vulnerable && canCatch);
    this.catchBtn.setAttribute('aria-label', `Catch ${p.name} — they didn't call UNO`);
    this.status.textContent = statusText ?? '';
    this.el.setAttribute(
      'aria-label',
      `${p.name}${p.isBot ? ' (bot)' : ''}, ${p.cardCount} card${p.cardCount === 1 ? '' : 's'}${isTurn ? ', playing now' : ''}${p.connected ? '' : ', disconnected'}`,
    );
  }

  setProgress(fraction) {
    this.ringFill.style.strokeDashoffset = String(100 - Math.max(0, Math.min(1, fraction)) * 100);
  }
}
