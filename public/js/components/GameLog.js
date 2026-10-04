// Human-readable game log (drawer) + one-line "last action" text.
import { cardLabel, COLOR_NAMES, h } from '../core/util.js';

export function describeEvent(e, nameOf, youId) {
  const n = (id) => (id === youId ? 'You' : nameOf(id));
  switch (e.type) {
    case 'roundStart':
      return { text: `Round ${e.round} begins`, kind: 'sys' };
    case 'deal':
      return { text: `${n(e.dealerId)} dealt · starter ${cardLabel(e.starter)}`, kind: 'sys' };
    case 'play':
      return { text: `${n(e.playerId)} played ${cardLabel(e.card)}${e.card.color === 'wild' ? ` → ${COLOR_NAMES[e.color]}` : ''}`, kind: 'play', color: e.color };
    case 'draw': {
      const what = e.count === 1 ? 'a card' : `${e.count} cards`;
      const why = { draw2: ' (+2)', wild4: ' (+4)', uno_penalty: ' (UNO penalty)', challenge_penalty: ' (challenge lost)', challenge_failed: ' (failed challenge)' }[e.reason] ?? '';
      return { text: `${n(e.playerId)} drew ${what}${why}`, kind: 'draw' };
    }
    case 'skip':
      return { text: `${n(e.playerId)} ${e.playerId === youId ? 'are' : 'is'} skipped`, kind: 'fx' };
    case 'reverse':
      return { text: `Direction reversed`, kind: 'fx' };
    case 'pass':
      return { text: `${n(e.playerId)} passed`, kind: 'draw' };
    case 'uno':
      return { text: `${n(e.playerId)} called UNO!`, kind: 'uno' };
    case 'caught':
      return { text: `${n(e.by)} caught ${n(e.playerId)} without UNO! +2`, kind: 'uno' };
    case 'wild4Pending':
      return { text: `${n(e.offenderId)} hit ${n(e.playerId)} with Wild Draw Four`, kind: 'fx' };
    case 'challenge':
      return { text: e.success ? `${n(e.playerId)} challenged — ${n(e.offenderId)} bluffed! +4` : `${n(e.playerId)} challenged and lost! +6`, kind: 'fx' };
    case 'color':
      return { text: `${n(e.playerId)} chose ${COLOR_NAMES[e.color]}`, kind: 'play', color: e.color };
    case 'timeout':
      return { text: `${n(e.playerId)} ran out of time`, kind: 'sys' };
    case 'reshuffle':
      return { text: `Discard pile reshuffled into the deck`, kind: 'sys' };
    case 'roundEnd':
      return { text: `${n(e.winnerId)} won the round! +${e.points}`, kind: 'uno' };
    case 'playerLeft':
      return { text: `${e.name} ${e.reason === 'kicked' ? 'was removed' : 'left'}`, kind: 'sys' };
    default:
      return null;
  }
}

export class GameLog {
  constructor() {
    this.list = h('ol.log-list');
    this.el = h('aside.log-drawer.glass', { 'aria-label': 'Game log', hidden: true }, h('h2.log-title', 'Game log'), this.list);
    this.count = -1;
  }

  toggle(force) {
    this.el.hidden = force === undefined ? !this.el.hidden : !force;
    return !this.el.hidden;
  }

  update(log, nameOf, youId) {
    const sig = `${log.length}:${log[log.length - 1]?.at}`;
    if (sig === this.count) return;
    this.count = sig;
    const items = log
      .map((e) => describeEvent(e, nameOf, youId))
      .filter(Boolean)
      .reverse()
      .map((d) => h(`li.log-item.log-${d.kind}`, d.color ? h('i.log-dot', { dataset: { color: d.color } }) : null, d.text));
    this.list.replaceChildren(...items);
  }
}
