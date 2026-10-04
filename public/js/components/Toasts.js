// Toast notifications + friendly error copy.
import { h } from '../core/util.js';

const ERROR_COPY = {
  ROOM_NOT_FOUND: { icon: '🔍', text: 'Room not found — check the code and try again.' },
  ROOM_FULL: { icon: '🚪', text: 'That room is full.' },
  GAME_STARTED: { icon: '⏳', text: 'That game has already started.' },
  NOT_YOUR_TURN: { icon: '✋', text: "Hold on — it's not your turn." },
  INVALID_MOVE: { icon: '🚫', text: "That card doesn't match the color or symbol." },
  MUST_PLAY_DRAWN: { icon: '☝️', text: 'You can only play the card you just drew — or pass.' },
  CONNECTION_LOST: { icon: '📡', text: 'Connection lost. Reconnecting…' },
  TIMEOUT: { icon: '📡', text: 'The server took too long to respond.' },
  SERVER_ERROR: { icon: '⚠️', text: 'Server error — please try again.' },
  SESSION_EXPIRED: { icon: '⌛', text: 'Your previous game is no longer available.' },
  NAME_REQUIRED: { icon: '✏️', text: 'Please enter your name first.' },
};

export function toast(text, { type = 'info', icon = 'ℹ️', duration = 3200 } = {}) {
  const root = document.getElementById('toasts');
  const el = h(`div.toast.glass.toast--${type}`, h('span.toast-icon', icon), h('span', text));
  root.append(el);
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }, duration);
  return el;
}

export function toastError(error) {
  const copy = ERROR_COPY[error?.code];
  toast(copy?.text ?? error?.message ?? 'Something went wrong', { type: 'error', icon: copy?.icon ?? '⚠️' });
}
