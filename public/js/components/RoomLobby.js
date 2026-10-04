// Room lobby: code sharing, player list, host settings, ready / start.
import { audio } from '../core/audio.js';
import { h, icon } from '../core/util.js';
import { UnoLogo } from './HomeScreen.js';
import { PlayerAvatar } from './PlayerAvatar.js';
import { toast, toastError } from './Toasts.js';

const TURN_TIMES = [
  [0, 'Off'],
  [15, '15s'],
  [30, '30s'],
  [45, '45s'],
  [60, '60s'],
];
const TARGETS = [
  [0, '1 round'],
  [100, '100'],
  [200, '200'],
  [500, '500'],
];

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  audio.play('click');
  toast(`${what} copied`, { type: 'success', icon: '📋', duration: 1800 });
}

export function RoomCode(code) {
  const link = `${location.origin}/?room=${code}`;
  return h(
    'section.room-card.glass',
    h('span.field-label', 'Room code'),
    h('div.room-code', { 'aria-label': `Room code ${code.split('').join(' ')}` }, code.split('').map((ch, i) => h('span.room-code-char', { style: { '--i': i } }, ch))),
    h(
      'div.room-actions',
      h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => copy(code, 'Room code') }, icon('copy'), 'Copy code'),
      h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => copy(link, 'Invite link') }, icon('link'), 'Copy link'),
    ),
    h('p.room-hint', 'Share the code or link — friends join instantly.'),
  );
}

export class RoomLobby {
  constructor({ request, onLeave }) {
    this.request = request;
    this.onLeave = onLeave;
    this.code = null;
    this.el = h('main.lobby');
  }

  async act(t, data) {
    const res = await this.request(t, data);
    if (!res.ok) toastError(res.error);
    return res;
  }

  segmented(label, options, value, disabled, onPick) {
    return h(
      'div.field',
      h('span.field-label', label),
      h(
        'div.segmented',
        { role: 'radiogroup', 'aria-label': label },
        options.map(([v, text]) =>
          h(
            'button.segment',
            { type: 'button', role: 'radio', 'aria-checked': String(v === value), disabled, onclick: () => v !== value && onPick(v) },
            text,
          ),
        ),
      ),
    );
  }

  update(state) {
    const me = state.players.find((p) => p.id === state.youId);
    const isHost = state.hostId === state.youId;
    const s = state.settings;
    const players = state.players;
    const notReady = players.filter((p) => !p.ready);
    const canStart = isHost && players.length >= 2 && notReady.length === 0;
    const startHint =
      players.length < 2 ? 'Invite at least one more player — or add a bot' : notReady.length ? `Waiting for ${notReady.map((p) => p.name).join(', ')}` : 'Everyone is ready!';

    const seatRows = players.map((p) =>
      h(
        'li.lobby-player',
        { class: [p.id === state.youId ? 'is-me' : '', p.connected ? '' : 'is-offline'].join(' ') },
        PlayerAvatar(p.avatar, 46),
        h(
          'div.lobby-player-meta',
          h('span.lobby-player-name', p.name, p.id === state.youId ? h('span.you-tag', 'You') : null),
          h(
            'span.lobby-player-tags',
            p.isHost ? h('span.tag.tag--host', icon('crown'), 'Host') : null,
            p.isBot ? h('span.tag.tag--bot', icon('bot'), 'Bot') : null,
            !p.connected ? h('span.tag.tag--off', 'Offline') : null,
          ),
        ),
        h('span.ready-chip', { class: p.ready ? 'is-ready' : '' }, h('i'), p.ready ? 'Ready' : 'Not ready'),
        isHost && p.id !== state.youId
          ? h('button.icon-btn.kick-btn', { type: 'button', 'aria-label': `Remove ${p.name}`, title: `Remove ${p.name}`, onclick: () => this.act('kick', { playerId: p.id }) }, icon('x'))
          : null,
      ),
    );
    const empty = Array.from({ length: Math.max(0, s.maxPlayers - players.length) }, () => h('li.lobby-player.is-empty', h('span.empty-seat'), h('span', 'Waiting for player…')));

    const playersCard = h(
      'section.players-card.glass',
      h(
        'header.card-head',
        h('h2', 'Players'),
        h('span.count-pill', `${players.length}/${s.maxPlayers}`),
        isHost && players.length < s.maxPlayers ? h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => this.act('addBot') }, icon('bot'), 'Add bot') : null,
      ),
      h('ul.lobby-players', seatRows, empty),
    );

    const settingsCard = h(
      'section.settings-card.glass',
      h('header.card-head', h('h2', 'Settings'), !isHost ? h('span.muted', 'Host controls') : null),
      h(
        'div.field',
        h('span.field-label', 'Max players'),
        h(
          'div.stepper',
          h('button.icon-btn', { type: 'button', disabled: !isHost || s.maxPlayers <= Math.max(2, players.length), 'aria-label': 'Fewer seats', onclick: () => this.act('settings', { maxPlayers: s.maxPlayers - 1 }) }, icon('minus')),
          h('div.stepper-mid', h('span.stepper-value', String(s.maxPlayers)), h('div.seat-dots', Array.from({ length: 8 }, (_, i) => h('i', { class: i < s.maxPlayers ? 'on' : null })))),
          h('button.icon-btn', { type: 'button', disabled: !isHost || s.maxPlayers >= 8, 'aria-label': 'More seats', onclick: () => this.act('settings', { maxPlayers: s.maxPlayers + 1 }) }, icon('plus')),
        ),
      ),
      this.segmented('Turn timer', TURN_TIMES, s.turnTime, !isHost, (v) => this.act('settings', { turnTime: v })),
      this.segmented('Play to', TARGETS, s.targetScore, !isHost, (v) => this.act('settings', { targetScore: v })),
    );

    const footer = h(
      'footer.lobby-footer.glass',
      h('p.start-hint', { 'aria-live': 'polite' }, startHint),
      isHost
        ? h('button.btn.btn--lg.btn--go.start-btn', { type: 'button', disabled: !canStart, onclick: () => (audio.play('click'), this.act('start')) }, 'Start Game')
        : h(
            'button.btn.btn--lg.ready-btn',
            { type: 'button', class: me?.ready ? 'btn--ghost' : 'btn--go', 'aria-pressed': String(Boolean(me?.ready)), onclick: () => (audio.play('click'), this.act('ready', { ready: !me?.ready })) },
            me?.ready ? 'Not ready' : "I'm ready",
          ),
    );

    const activeId = document.activeElement?.closest?.('.lobby') ? document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent : null;

    if (this.code !== state.code) {
      this.code = state.code;
      this.header = h(
        'header.lobby-header',
        UnoLogo({ size: 'sm' }),
        h('div.lobby-title', h('span.field-label', 'Lobby'), h('h1', 'Get ready to play')),
        h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => this.onLeave() }, icon('exit'), 'Leave'),
      );
      this.roomCard = RoomCode(state.code);
    }
    this.el.replaceChildren(this.header, h('div.lobby-grid', this.roomCard, playersCard, settingsCard), footer);

    // Keep keyboard focus stable across re-renders.
    if (activeId) {
      const again = [...this.el.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === activeId);
      again?.focus();
    }
  }
}
