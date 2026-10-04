// Landing screen: create or join a room.
import { audio } from '../core/audio.js';
import { AVATAR_IDS, h, icon, storage } from '../core/util.js';
import { createCard } from './Card.js';
import { PlayerAvatar } from './PlayerAvatar.js';

export function UnoLogo({ size = 'lg' } = {}) {
  return h(`div.uno-logo.uno-logo--${size}`, { role: 'img', 'aria-label': 'UNO' }, h('span.uno-logo-oval'), h('span.uno-logo-text', 'UNO'));
}

export function HomeScreen({ initialCode = '', onCreate, onJoin }) {
  const profile = storage.get('uno.profile', {});
  let avatar = AVATAR_IDS.includes(profile.avatar) ? profile.avatar : AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)];
  let maxPlayers = 4;
  let mode = initialCode ? 'join' : 'create';

  const nameInput = h('input.input#name', {
    type: 'text',
    maxlength: 16,
    placeholder: 'Your name',
    autocomplete: 'nickname',
    value: profile.name ?? '',
    'aria-label': 'Player name',
  });
  const codeInput = h('input.input.code-input#code', {
    type: 'text',
    maxlength: 5,
    placeholder: 'A7K92',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    value: initialCode,
    'aria-label': 'Room code',
  });
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  const avatarButtons = AVATAR_IDS.map((id) => {
    const b = h('button.avatar-option', { type: 'button', role: 'radio', 'aria-checked': String(id === avatar), 'aria-label': `Avatar ${id}` }, PlayerAvatar(id, 44));
    b.addEventListener('click', () => {
      avatar = id;
      audio.play('click');
      avatarButtons.forEach((x, i) => x.setAttribute('aria-checked', String(AVATAR_IDS[i] === id)));
    });
    return b;
  });

  const countLabel = h('span.stepper-value', { 'aria-live': 'polite' }, String(maxPlayers));
  const seatDots = h('div.seat-dots', { 'aria-hidden': 'true' });
  const renderDots = () => {
    countLabel.textContent = String(maxPlayers);
    seatDots.replaceChildren(...Array.from({ length: 8 }, (_, i) => h('i', { class: i < maxPlayers ? 'on' : null })));
  };
  renderDots();
  const step = (d) => () => {
    maxPlayers = Math.min(8, Math.max(2, maxPlayers + d));
    audio.play('click');
    renderDots();
  };

  const createBtn = h('button.btn.btn--lg.btn--go.w-full', { type: 'submit' }, 'Create Room');
  const joinBtn = h('button.btn.btn--lg.w-full', { type: 'submit' }, 'Join Room');

  const createPane = h(
    'div.pane',
    h(
      'div.field',
      h('span.field-label', 'Max players'),
      h(
        'div.stepper',
        h('button.icon-btn', { type: 'button', 'aria-label': 'Fewer players', onclick: step(-1) }, icon('minus')),
        h('div.stepper-mid', countLabel, seatDots),
        h('button.icon-btn', { type: 'button', 'aria-label': 'More players', onclick: step(1) }, icon('plus')),
      ),
    ),
    createBtn,
  );
  const joinPane = h('div.pane', h('label.field', h('span.field-label', 'Room code'), codeInput), joinBtn);

  const tabCreate = h('button.tab', { type: 'button', role: 'tab' }, 'Create room');
  const tabJoin = h('button.tab', { type: 'button', role: 'tab' }, 'Join room');
  const tabs = h('div.tabs', { role: 'tablist' }, tabCreate, tabJoin, h('span.tab-ink'));

  const setMode = (m) => {
    mode = m;
    tabs.dataset.mode = m;
    tabCreate.setAttribute('aria-selected', String(m === 'create'));
    tabJoin.setAttribute('aria-selected', String(m === 'join'));
    createPane.hidden = m !== 'create';
    joinPane.hidden = m !== 'join';
  };
  tabCreate.addEventListener('click', () => setMode('create'));
  tabJoin.addEventListener('click', () => setMode('join'));
  setMode(mode);

  const form = h(
    'form.home-panel.glass',
    { novalidate: true },
    tabs,
    h('label.field', h('span.field-label', 'Name'), nameInput),
    h('div.field', h('span.field-label', 'Avatar'), h('div.avatar-grid', { role: 'radiogroup', 'aria-label': 'Choose avatar' }, avatarButtons)),
    createPane,
    joinPane,
  );

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    audio.unlock();
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      nameInput.classList.add('is-invalid');
      setTimeout(() => nameInput.classList.remove('is-invalid'), 600);
      return;
    }
    storage.set('uno.profile', { name, avatar });
    busy = true;
    form.classList.add('is-busy');
    try {
      if (mode === 'create') await onCreate({ name, avatar, maxPlayers });
      else {
        if (codeInput.value.length < 5) {
          codeInput.focus();
          codeInput.classList.add('is-invalid');
          setTimeout(() => codeInput.classList.remove('is-invalid'), 600);
          return;
        }
        await onJoin({ name, avatar, code: codeInput.value });
      }
    } finally {
      busy = false;
      form.classList.remove('is-busy');
    }
  });

  const heroCards = [
    { id: 'h1', color: 'blue', value: '7' },
    { id: 'h2', color: 'green', value: 'reverse' },
    { id: 'h3', color: 'wild', value: 'wild4' },
    { id: 'h4', color: 'yellow', value: 'skip' },
    { id: 'h5', color: 'red', value: 'draw2' },
  ];

  const el = h(
    'main.home',
    h(
      'section.home-hero',
      h('div.hero-cards', { 'aria-hidden': 'true' }, heroCards.map((c, i) => h('div.hero-card', { style: { '--i': i - 2 } }, createCard(c)))),
      UnoLogo(),
      h('p.tagline', 'Real-time multiplayer · 2–8 players'),
    ),
    form,
  );

  return {
    el,
    focus() {
      if (!nameInput.value) nameInput.focus();
      else if (mode === 'join' && !codeInput.value) codeInput.focus();
    },
  };
}
