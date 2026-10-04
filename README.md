# UNO Online

Real-time multiplayer UNO for 2–8 players. Node.js WebSocket server with server-authoritative game state, vanilla ES-module front end (no build step).

```bash
npm install
npm start          # http://localhost:3000
npm test           # engine + end-to-end multiplayer tests
```

Open the URL, create a room, and share the room code or invite link (`/?room=CODE`). The host can add bots to fill seats, which is handy for trying out 4–8 player tables alone.

## Architecture

```
Client A ─┐
Client B ─┼─ WebSocket /ws ──> RoomManager ──> Room ──> Game (engine)
Client C ─┘
```

| Path | Role |
|---|---|
| `server/engine/cards.js` | 108-card deck, crypto shuffle, matching, scoring |
| `server/engine/game.js` | Rules engine: deal, turns, Skip/Reverse/+2/Wild/+4, the +4 challenge, UNO call and catch, reshuffle, timeout, leave |
| `server/rooms.js` | Rooms, lobby/settings, phases (`LOBBY → STARTING → PLAYING → ROUND_END → GAME_END`), turn timers, reconnect, bots, per-player views |
| `server/index.js` | Static file server, WebSocket endpoint, heartbeat, rate limiting |
| `public/js/components/*` | UI components (GameBoard, PlayerSeat, PlayerHand, Card, ColorPicker, ChallengeModal, GameResult, RoomLobby…) |
| `public/js/core/audio.js` | Sound service. Add audio files by listing them in `SOUND_FILES`; any event without a file falls back to a short generated sound |

### Server is the source of truth
- Clients only send intents (`play`, `draw`, `pass`, `uno`, `catch`, `challenge`, `accept`, `chooseColor`…). The server validates turn, card ownership, matching, and pending decisions for every intent, and rejects invalid ones with a coded error.
- Each player receives a personal view. It contains their own hand and only the card *counts* of everyone else. The draw pile, other hands, and whether a +4 was legal are never sent. Cards get random ids each round, so an id reveals nothing about the card.
- The server owns randomness (`crypto.randomInt` Fisher–Yates) and turn timers. Hints like "playable" glow come from the server's `playable` list.

### Rules implemented
7-card deal, with a Wild Draw Four starter returned to the deck. Starter effects follow the standard rules (Skip, Reverse, Draw Two, and Wild, where the first player picks the color). Reverse acts as Skip with 2 players. A player may draw instead of playing, and may then play the drawn card if it matches, or pass. Wild Draw Four can be played as a bluff: the next player may challenge, and the challenger sees the offender's hand. A guilty offender draws 4. If the +4 was legal, the challenger draws 6 instead. A player who forgets to call UNO can be caught by others for +2 until the next player acts. Scoring uses official points, and the target is 1 round, 100, 200, or 500 points.

### Reconnect
A session token lives in `sessionStorage`, so refreshing the page puts you back in your seat with the same hand. Other players see the disconnect and reconnect status. When a turn runs out, the server acts automatically. If no human is connected, the room pauses and the remaining turn time is kept, so reconnecting can't reset the clock.

## Controls
Drag a card onto the discard pile with mouse or touch, or tap a card and then tap the pile or press **Play**. Keyboard: **H** focuses the hand, **←/→** move between cards, **Enter** selects and then plays, **1–4** pick a color, **D** draws, **P** passes, **U** calls UNO, **L** opens the log.
