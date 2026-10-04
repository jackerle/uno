// Simple server-side bot. Bots use exactly the same validated Game actions as
// humans, so they can never bypass the rules.
import { COLORS, isWild } from './engine/cards.js';

const pickColor = (hand) => {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const c of hand) if (!isWild(c)) counts[c.color]++;
  return COLORS.reduce((best, c) => (counts[c] > counts[best] ? c : best), COLORS[Math.floor(Math.random() * 4)]);
};

/** Returns a list of [method, ...args] calls for the bot to perform now. */
export function decideBotMove(game, botId) {
  const hand = game.hands.get(botId);
  if (!hand || game.over || game.currentPlayerId !== botId) return [];

  if (game.pending?.type === 'chooseColor') return [['chooseColor', botId, pickColor(hand)]];
  if (game.pending?.type === 'challenge') {
    // Challenge occasionally, more often when holding many cards anyway.
    return [[Math.random() < 0.25 ? 'challenge' : 'accept', botId]];
  }

  const playable = hand.filter((c) => game.isPlayable(c, botId));
  if (playable.length === 0) return game.drawnCardId ? [['pass', botId]] : [['draw', botId]];

  // Prefer action cards, then high numbers, keep wilds for last.
  const rank = (c) => (c.value === 'wild4' ? -2 : c.value === 'wild' ? -1 : isNaN(Number(c.value)) ? 20 : Number(c.value));
  playable.sort((a, b) => rank(b) - rank(a));
  const card = playable[0];
  const moves = [];
  if (hand.length === 2 && Math.random() < 0.85) moves.push(['callUno', botId]);
  const rest = hand.filter((c) => c.id !== card.id);
  moves.push(['play', botId, card.id, isWild(card) ? pickColor(rest) : undefined]);
  return moves;
}
