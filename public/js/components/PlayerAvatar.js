import { AVATARS, h } from '../core/util.js';

export function PlayerAvatar(avatarId, size = 48, label) {
  const a = AVATARS[avatarId] ?? AVATARS.fox;
  return h(
    'div.avatar',
    { style: { '--size': `${size}px`, '--av-bg': a.bg }, role: label ? 'img' : null, 'aria-label': label ?? null, 'aria-hidden': label ? null : 'true' },
    h('span.avatar-glyph', a.glyph),
  );
}
