# Fable 5.2 Chess

A complete chess game written from scratch by Claude Fable 5.2 for the
[claude-chess](https://github.com/davidramsay95/claude-chess) collection. The rules, the engine, the piece
artwork, the icons and the sounds are all original code in this folder. There are no runtime dependencies and no
chess libraries.

## Playing

- Choose white or black and one of four levels, then click or drag pieces. Legal destinations are marked.
- The move list is clickable. The arrow buttons, or the left and right arrow keys, step through the game.
- Export gives the game as a `.json` file or clipboard text. Import accepts a file or pasted text, validates the
  whole state by replaying every move, and leaves the current game alone if anything is wrong.
- Inside the claude-chess site the game also answers the save bridge (`ping`, `request-state`, `load-state`).

## Rules

`src/chess/position.ts` holds the rules on a 0x88 board with make and unmake: legal move generation, check,
checkmate, stalemate, castling (not out of, through or into check), en passant, promotion to any piece, and
insufficient material. `src/game/game.ts` adds threefold repetition, the fifty-move rule and resignation. Draws
by repetition and by the fifty-move rule are applied automatically.

Move generation is verified with perft counts from the start position (depth 4), Kiwipete (depth 3) and three
more positions from the standard perft suite.

## Engine

`src/engine/search.ts` and `src/engine/evaluate.ts`, running in a Web Worker so the page never blocks.

- Iterative deepening negamax with alpha-beta and principal variation search.
- Transposition table (2^19 entries, about 8 MB) keyed on a 64-bit Zobrist hash.
- Quiescence search with delta pruning; move ordering by table move, MVV-LVA, killers and history.
- Check extension, null-move pruning, late move reductions, futility and late move pruning.
- Draw detection inside the search (repetition, fifty-move rule, insufficient material), mate distance scoring.
- Tapered evaluation: material, piece-square tables, pawn structure, bishop pair, rooks on open files, king
  safety, and endgame knowledge for driving a lone king to the edge.

| Level | Depth cap | Time cap | Weakening |
|---|---|---|---|
| Easy | 2 | 300 ms | Two plies of capture search, picks randomly among moves within 160 centipawns of the best, and on 35% of moves looks only one ply ahead |
| Medium | 4 | 1000 ms | Picks among moves within 45 centipawns of the best |
| Hard | 8 | 700 ms | None |
| Expert | none | 2500 ms | None |

Time caps are wall-clock, so a slow device loses depth, not responsiveness. In self-play with the clock run eight
times fast to imitate a phone, each level beat the one below it without losing a game (expert against hard
22 wins and 2 draws, hard against medium 19 wins and 1 draw, medium against easy 50 wins).

## Running

```sh
npm ci
npm run dev        # local development server
npm test           # unit tests (rules, notation, game state, bridge, engine)
npm run build      # typecheck, then build into dist/
npm run preview    # serve the build
```

The platform build is `npm run build -- --base=/play/fable_5-2_20261110/`. No `base` is set in the Vite config
and no URL in the source is root-absolute.

## Known limitations

- The board is played with a pointer (mouse, touch or pen). There is no keyboard control for moving pieces.
- Threefold repetition and the fifty-move rule end the game automatically; there is no optional draw claim or
  draw offer.
- No clocks, no takebacks, and the engine has no opening book or endgame tablebases.
