// App bootstrap: connection lifecycle, session restore and screen routing.
import { startAmbient } from './components/Ambient.js';
import { GameBoard } from './components/GameBoard.js';
import { HomeScreen } from './components/HomeScreen.js';
import { RoomLobby } from './components/RoomLobby.js';
import { toast, toastError } from './components/Toasts.js';
import { audio } from './core/audio.js';
import { Connection } from './core/net.js';
import { clock, h, session } from './core/util.js';

const app = document.getElementById('app');
const banner = document.getElementById('conn-banner');
const conn = new Connection();
const request = (t, data) => conn.request(t, data);

let screen = null; // { kind, view }

const urlCode = () => new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) ?? '';

function setUrl(code) {
  const url = code ? `/?room=${code}` : '/';
  if (location.pathname + location.search !== url) history.replaceState(null, '', url);
}

function mount(kind, view) {
  if (screen?.view?.destroy) screen.view.destroy();
  document.getElementById('overlay-root').replaceChildren();
  screen = { kind, view };
  app.replaceChildren(view.el);
  view.el.classList.add('screen-enter');
}

function showHome(code = urlCode()) {
  if (screen?.kind === 'home') return;
  const view = HomeScreen({
    initialCode: code,
    onCreate: async ({ name, avatar, maxPlayers }) => {
      const res = await request('create', { name, avatar, maxPlayers });
      if (!res.ok) return toastError(res.error);
      session.set({ token: res.token, code: res.code });
      setUrl(res.code);
    },
    onJoin: async ({ name, avatar, code: c }) => {
      const res = await request('join', { name, avatar, code: c });
      if (!res.ok) return toastError(res.error);
      session.set({ token: res.token, code: res.code });
      setUrl(res.code);
    },
  });
  mount('home', view);
  view.focus();
}

async function leave() {
  await request('leave');
  session.set(null);
  setUrl('');
  showHome('');
}

function onState({ state, events }) {
  clock.sync(state.serverNow);
  window.__uno = { state, request }; // debugging aid: only this player's own view
  if (state.phase === 'LOBBY') {
    if (screen?.kind !== 'lobby') mount('lobby', new RoomLobby({ request, onLeave: leave }));
    screen.view.update(state);
    for (const e of events) {
      if (e.type === 'disconnected' && e.playerId !== state.youId) toast(`${name(state, e.playerId)} disconnected`, { icon: '📡' });
      if (e.type === 'playerLeft' && e.playerId !== state.youId) toast(`${e.name} ${e.reason === 'kicked' ? 'was removed' : 'left'}`, { icon: '👋' });
      if (e.type === 'joined' && e.playerId && e.playerId !== state.youId) {
        toast(`${name(state, e.playerId)} joined`, { icon: '✨', type: 'success', duration: 2000 });
        audio.play('click');
      }
    }
  } else {
    if (screen?.kind !== 'game') mount('game', new GameBoard({ request, onLeave: leave }));
    screen.view.update(state, events);
  }
}

const name = (state, id) => state.players.find((p) => p.id === id)?.name ?? 'A player';

async function resume() {
  const s = session.get();
  if (!s?.token) return false;
  const res = await request('resume', { token: s.token });
  if (res.ok) {
    setUrl(res.code);
    return true;
  }
  session.set(null);
  if (res.error?.code === 'SESSION_EXPIRED') toastError(res.error);
  return false;
}

conn.addEventListener('open', async (e) => {
  banner.hidden = true;
  const restored = await resume();
  if (e.detail.reconnect && restored) toast('Reconnected', { icon: '✅', type: 'success', duration: 1800 });
  if (!restored) {
    if (screen && screen.kind !== 'home') toast('You left the room', { icon: '👋' });
    showHome();
  }
});
conn.addEventListener('close', () => {
  if (conn.everOpened) banner.hidden = false;
});
conn.addEventListener('state', (e) => onState(e.detail));
conn.addEventListener('kicked', () => {
  session.set(null);
  setUrl('');
  toast('The host removed you from the room', { icon: '🚪', type: 'error' });
  showHome('');
});
conn.addEventListener('replaced', () => {
  session.set(null);
  toast('This seat was opened in another tab', { icon: '🪟', type: 'error' });
  app.replaceChildren(h('main.home', h('p.replaced', 'This game is open in another tab.')));
  screen = { kind: 'replaced', view: {} };
});

// Audio needs a user gesture before it can play.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });
window.addEventListener('keydown', () => audio.unlock(), { once: true, capture: true });

startAmbient(document.getElementById('ambient'));
app.append(h('div.boot', h('span.spinner'), 'Connecting…'));
conn.connect();
