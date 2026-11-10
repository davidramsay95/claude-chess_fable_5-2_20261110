import type { BridgeHost } from "../bridge";
import {
  BISHOP,
  BLACK,
  FLAG_CASTLE_KING,
  FLAG_CASTLE_QUEEN,
  KING,
  KNIGHT,
  type Move,
  PAWN,
  Position,
  QUEEN,
  ROOK,
  START_FEN,
  WHITE,
  makePiece,
  moveFlag,
  moveFrom,
  movePromotion,
  moveTo,
  moveToUci,
  pieceColor,
  pieceType,
} from "../chess/position";
import { EngineClient } from "../engine/client";
import { Game, StateError } from "../game/game";
import { DIFFICULTIES, type Difficulty, type PlayerColor } from "../game/types";
import { BoardView, type Glide } from "./board-view";
import { ICONS } from "./icons";
import { pieceSvg } from "./pieces";
import { Sound } from "./sound";

const ENGINE_NAME = "Fable 5.2";
// The engine's reply is held back to at least this long so its move does not land under the user's own.
const MIN_REPLY_MS = 420;
const RESIGN_CONFIRM_MS = 3500;

const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };
const DIFFICULTY_NOTES: Record<Difficulty, string> = {
  easy: "Looks one move ahead and often wanders. Good for learning.",
  medium: "Sees short tactics but can be outplayed with a plan.",
  hard: "Searches several moves deep. Punishes loose pieces.",
  expert: "Full strength. Takes a couple of seconds on each move.",
};

const PIECE_VALUES = [0, 1, 3, 3, 5, 9, 0];
const CAPTURE_ORDER = [QUEEN, ROOK, BISHOP, KNIGHT, PAWN];

const TEMPLATE = `
<div class="shell">
  <main class="stage">
    <div class="bar" data-ref="topBar"></div>
    <div class="board" data-ref="board"></div>
    <div class="bar" data-ref="bottomBar"></div>
  </main>
  <aside class="side">
    <header class="brand">
      <span class="brand-mark">${pieceSvg(makePiece(WHITE, KNIGHT))}</span>
      <div class="brand-text"><h1>Fable <em>5.2</em></h1><p>Built from scratch</p></div>
      <div class="brand-tools">
        <button type="button" class="icon-button" data-ref="flip" title="Flip board" aria-label="Flip board">${ICONS.flip}</button>
        <button type="button" class="icon-button" data-ref="sound" title="Sound" aria-label="Toggle sound"></button>
      </div>
    </header>
    <section class="status" data-ref="status" aria-live="polite">
      <p class="status-text" data-ref="statusText"></p>
      <button type="button" class="link-button" data-ref="statusAction" hidden></button>
    </section>
    <section class="moves-wrap" data-ref="movesWrap" aria-label="Moves">
      <div class="moves" data-ref="moves"></div>
    </section>
    <nav class="stepper" aria-label="Step through the game">
      <button type="button" class="icon-button" data-ref="first" title="First position" aria-label="First position">${ICONS.first}</button>
      <button type="button" class="icon-button" data-ref="previous" title="Previous move" aria-label="Previous move">${ICONS.previous}</button>
      <button type="button" class="icon-button" data-ref="next" title="Next move" aria-label="Next move">${ICONS.next}</button>
      <button type="button" class="icon-button" data-ref="last" title="Latest position" aria-label="Latest position">${ICONS.last}</button>
    </nav>
    <div class="actions">
      <button type="button" class="button" data-ref="newGame">${ICONS.plus}<span>New game</span></button>
      <button type="button" class="button" data-ref="resign">${ICONS.flag}<span data-ref="resignLabel">Resign</span></button>
      <button type="button" class="button" data-ref="export">${ICONS.download}<span>Export game</span></button>
      <button type="button" class="button" data-ref="import">${ICONS.upload}<span>Import game</span></button>
    </div>
  </aside>

  <section class="setup" data-ref="setup">
    <form class="card" data-ref="setupForm">
      <p class="eyebrow">${ENGINE_NAME}</p>
      <h2>New game</h2>
      <fieldset class="field">
        <legend>Play as</legend>
        <div class="color-choice">
          <label class="color-option"><input type="radio" name="color" value="white" checked><span class="color-tile">${pieceSvg(makePiece(WHITE, KING))}<b>White</b><i>Moves first</i></span></label>
          <label class="color-option"><input type="radio" name="color" value="black"><span class="color-tile">${pieceSvg(makePiece(BLACK, KING))}<b>Black</b><i>Moves second</i></span></label>
        </div>
      </fieldset>
      <fieldset class="field">
        <legend>Opponent</legend>
        <div class="level-choice">
          ${DIFFICULTIES.map(
            (level, index) =>
              `<label class="level-option"><input type="radio" name="difficulty" value="${level}"${level === "medium" ? " checked" : ""}><span><i class="pips">${'<s class="on"></s>'.repeat(index + 1)}${"<s></s>".repeat(3 - index)}</i>${DIFFICULTY_LABELS[level]}</span></label>`,
          ).join("")}
        </div>
        <p class="level-note" data-ref="levelNote"></p>
      </fieldset>
      <button type="submit" class="button primary">Start game</button>
      <div class="card-footer">
        <button type="button" class="link-button" data-ref="setupImport">Import a saved game</button>
        <button type="button" class="link-button" data-ref="setupCancel" hidden>Back to the game</button>
      </div>
    </form>
  </section>

  <dialog class="sheet" data-ref="exportDialog" aria-labelledby="export-title">
    <h2 id="export-title">Export game</h2>
    <p>Save this file, or copy the text, to continue the game later or load it into another model's game.</p>
    <textarea data-ref="exportText" readonly rows="9" spellcheck="false" aria-label="Game state as JSON"></textarea>
    <p class="sheet-note" data-ref="exportNote" role="status"></p>
    <div class="sheet-actions">
      <button type="button" class="button primary" data-ref="exportDownload">${ICONS.download}<span>Download .json</span></button>
      <button type="button" class="button" data-ref="exportCopy">${ICONS.copy}<span>Copy</span></button>
      <button type="button" class="button quiet" data-ref="exportClose">Close</button>
    </div>
  </dialog>

  <dialog class="sheet" data-ref="importDialog" aria-labelledby="import-title">
    <h2 id="import-title">Import game</h2>
    <p>Choose a saved <code>.json</code> file or paste its contents. Every move is checked before anything changes.</p>
    <label class="button file-button">${ICONS.upload}<span>Choose file</span><input type="file" data-ref="importFile" accept=".json,application/json,text/plain"></label>
    <textarea data-ref="importText" rows="9" spellcheck="false" placeholder='{ "version": 1, "startFen": "...", "moves": ["e2e4"] }' aria-label="Game state as JSON"></textarea>
    <p class="sheet-note error" data-ref="importError" role="alert"></p>
    <div class="sheet-actions">
      <button type="button" class="button primary" data-ref="importLoad">Load game</button>
      <button type="button" class="button quiet" data-ref="importClose">Cancel</button>
    </div>
  </dialog>
</div>`;

type RefName =
  | "topBar" | "board" | "bottomBar" | "flip" | "sound" | "status" | "statusText" | "statusAction" | "movesWrap"
  | "moves" | "first" | "previous" | "next" | "last" | "newGame" | "resign" | "resignLabel" | "export" | "import"
  | "setup" | "setupForm" | "levelNote" | "setupImport" | "setupCancel" | "exportDialog" | "exportText"
  | "exportNote" | "exportDownload" | "exportCopy" | "exportClose" | "importDialog" | "importFile" | "importText"
  | "importError" | "importLoad" | "importClose";

/** Finds one element marked `data-ref` in the template and checks that it is the expected kind of element. */
const findRef = <T extends HTMLElement>(root: HTMLElement, name: RefName, kind: new () => T): T => {
  const element = root.querySelector(`[data-ref="${name}"]`);
  if (!(element instanceof kind)) {
    throw new Error(`Template is missing ${name}`);
  }
  return element;
};

const describeOutcome = (game: Game): string => {
  const { result, reason } = game.outcome;
  const humanWon = (result === "1-0") === (game.playerColor === "white");
  switch (reason) {
    case "checkmate":
      return humanWon ? "Checkmate. You win." : `Checkmate. ${ENGINE_NAME} wins.`;
    case "resignation":
      return `You resigned. ${ENGINE_NAME} wins.`;
    case "stalemate":
      return "Draw by stalemate.";
    case "threefold":
      return "Draw by threefold repetition.";
    case "fifty-move":
      return "Draw by the fifty-move rule.";
    case "insufficient":
      return "Draw. Neither side has enough material to mate.";
    case null:
      return "";
  }
};

/** The whole interface: owns the current game, the engine, and every control on the page. */
export class App implements BridgeHost {
  private readonly root: HTMLElement;
  private readonly boardView: BoardView;
  private readonly engine = new EngineClient();
  private readonly sound = new Sound();
  private game: Game | null = null;
  /** Number of half-moves shown on the board; less than the game's length while stepping back through it. */
  private viewPly = 0;
  private orientation: PlayerColor = "white";
  private thinking = false;
  private engineError: string | null = null;
  private choosingPromotion = false;
  private resignArmedTimer: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    // The template is a constant; nothing from a saved game or the user is ever written as HTML.
    root.innerHTML = TEMPLATE;
    this.boardView = new BoardView(this.ref("board", HTMLDivElement), {
      targetsFrom: (square) => this.targetsFrom(square),
      onMove: (from, to, dropped) => void this.handleBoardMove(from, to, dropped),
    });
    this.bindControls();
    this.updateLevelNote();
    this.render();
  }

  currentGame(): Game | null {
    return this.game;
  }

  /**
   * Replaces the current game with a saved one. Used by the import dialog and by the save bridge.
   * @throws StateError when the state is invalid; the current game is then left exactly as it was.
   */
  importState(state: unknown): void {
    this.setGame(Game.fromState(state));
  }

  private ref<T extends HTMLElement>(name: RefName, kind: new () => T): T {
    return findRef(this.root, name, kind);
  }

  private button(name: RefName): HTMLButtonElement {
    return this.ref(name, HTMLButtonElement);
  }

  private bindControls(): void {
    this.button("flip").addEventListener("click", () => {
      this.orientation = this.orientation === "white" ? "black" : "white";
      this.render();
    });
    this.button("sound").addEventListener("click", () => {
      this.sound.setEnabled(!this.sound.enabled);
      this.renderSoundButton();
      this.sound.play("move");
    });
    this.button("first").addEventListener("click", () => this.stepTo(0));
    this.button("previous").addEventListener("click", () => this.stepTo(this.viewPly - 1));
    this.button("next").addEventListener("click", () => this.stepTo(this.viewPly + 1));
    this.button("last").addEventListener("click", () => this.stepTo(Number.MAX_SAFE_INTEGER));
    this.button("statusAction").addEventListener("click", () => this.onStatusAction());
    this.button("newGame").addEventListener("click", () => this.showSetup(true));
    this.button("resign").addEventListener("click", () => this.onResign());
    this.button("export").addEventListener("click", () => this.openExport());
    this.button("import").addEventListener("click", () => this.openImport());

    const form = this.ref("setupForm", HTMLFormElement);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const color: PlayerColor = data.get("color") === "black" ? "black" : "white";
      const difficulty = DIFFICULTIES.find((level) => level === data.get("difficulty")) ?? "medium";
      this.setGame(Game.create(color, difficulty));
    });
    form.addEventListener("change", () => this.updateLevelNote());
    this.button("setupImport").addEventListener("click", () => this.openImport());
    this.button("setupCancel").addEventListener("click", () => this.showSetup(false));

    this.button("exportDownload").addEventListener("click", () => this.downloadExport());
    this.button("exportCopy").addEventListener("click", () => void this.copyExport());
    this.button("exportClose").addEventListener("click", () => this.ref("exportDialog", HTMLDialogElement).close());
    this.button("importLoad").addEventListener("click", () => this.loadImport());
    this.button("importClose").addEventListener("click", () => this.ref("importDialog", HTMLDialogElement).close());
    this.ref("importFile", HTMLInputElement).addEventListener("change", (event) => void this.readImportFile(event));

    this.ref("moves", HTMLDivElement).addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest("button[data-ply]") : null;
      if (target instanceof HTMLButtonElement) {
        this.stepTo(Number(target.dataset.ply));
      }
    });

    document.addEventListener("keydown", (event) => this.onKeyDown(event));
  }

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    const typing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
    if (typing || this.game === null || this.setupVisible() || document.querySelector("dialog[open]") !== null) {
      return;
    }
    if (event.key === "ArrowLeft") {
      this.stepTo(this.viewPly - 1);
    } else if (event.key === "ArrowRight") {
      this.stepTo(this.viewPly + 1);
    } else if (event.key === "Home") {
      this.stepTo(0);
    } else if (event.key === "End") {
      this.stepTo(Number.MAX_SAFE_INTEGER);
    } else {
      return;
    }
    event.preventDefault();
  }

  private setupVisible(): boolean {
    return !this.ref("setup", HTMLElement).hidden;
  }

  private showSetup(visible: boolean): void {
    this.ref("setup", HTMLElement).hidden = !visible;
    this.button("setupCancel").hidden = this.game === null;
  }

  private updateLevelNote(): void {
    const chosen = new FormData(this.ref("setupForm", HTMLFormElement)).get("difficulty");
    const level = DIFFICULTIES.find((candidate) => candidate === chosen) ?? "medium";
    this.ref("levelNote", HTMLParagraphElement).textContent = DIFFICULTY_NOTES[level];
  }

  /** Makes `game` the current game, whether it is new or imported, and lets the engine move if it is its turn. */
  private setGame(game: Game): void {
    this.engine.cancel();
    this.thinking = false;
    this.engineError = null;
    this.choosingPromotion = false;
    this.disarmResign();
    this.game = game;
    this.viewPly = game.plies.length;
    this.orientation = game.playerColor;
    this.ref("exportDialog", HTMLDialogElement).close();
    this.ref("importDialog", HTMLDialogElement).close();
    this.showSetup(false);
    this.render();
    this.continueGame();
  }

  private atLatest(): boolean {
    return this.game !== null && this.viewPly === this.game.plies.length;
  }

  private canHumanMove(): boolean {
    const game = this.game;
    return game !== null && !game.isOver && game.isHumanTurn() && this.atLatest() && !this.choosingPromotion;
  }

  private targetsFrom(square: number): number[] {
    if (this.game === null || !this.canHumanMove()) {
      return [];
    }
    return this.game.legalMoves().filter((move) => moveFrom(move) === square).map(moveTo);
  }

  private async handleBoardMove(from: number, to: number, dropped: boolean): Promise<void> {
    const game = this.game;
    if (game === null || !this.canHumanMove()) {
      return;
    }
    const candidates = game.legalMoves().filter((move) => moveFrom(move) === from && moveTo(move) === to);
    if (candidates.length === 0) {
      return;
    }
    let move = candidates[0];
    if (candidates.length > 1) {
      this.choosingPromotion = true;
      const choice = await this.boardView.askPromotion(to, game.position.turn);
      // A save could have been loaded over the bridge while the picker was open.
      if (this.game !== game) {
        return;
      }
      this.choosingPromotion = false;
      const chosen = candidates.find((candidate) => movePromotion(candidate) === choice);
      if (chosen === undefined) {
        this.render();
        return;
      }
      move = chosen;
    }
    this.commit(game, move, !dropped);
  }

  /** Plays a move in the live game, then redraws and hands the turn on. */
  private commit(game: Game, move: Move, animate: boolean): void {
    const wasAtLatest = this.atLatest();
    if (!game.playUci(moveToUci(move))) {
      return;
    }
    this.disarmResign();
    const ply = game.plies[game.plies.length - 1];
    if (wasAtLatest) {
      this.viewPly = game.plies.length;
    }
    if (game.isOver) {
      this.sound.play("end");
    } else if (game.position.inCheck()) {
      this.sound.play("check");
    } else {
      this.sound.play(ply.captured !== 0 ? "capture" : "move");
    }
    this.render(wasAtLatest && animate ? this.glidesFor(move, false) : []);
    this.continueGame();
  }

  private continueGame(): void {
    const game = this.game;
    if (game !== null && !game.isOver && !game.isHumanTurn()) {
      void this.engineTurn(game);
    }
  }

  private async engineTurn(game: Game): Promise<void> {
    this.thinking = true;
    this.engineError = null;
    this.renderStatus();
    this.renderBars();
    const state = game.toState();
    try {
      const [uci] = await Promise.all([
        this.engine.requestMove(state.startFen, state.moves, state.difficulty),
        new Promise<void>((resolve) => window.setTimeout(resolve, MIN_REPLY_MS)),
      ]);
      // Null means this request was cancelled; a different game or position has taken over.
      if (uci === null || this.game !== game || game.plies.length !== state.moves.length) {
        return;
      }
      this.thinking = false;
      const move = game.position.findMove(uci);
      if (move === null) {
        throw new Error(`The engine suggested an illegal move (${uci})`);
      }
      this.commit(game, move, true);
    } catch (error) {
      if (this.game !== game) {
        return;
      }
      this.thinking = false;
      this.engineError = error instanceof Error ? error.message : "The engine failed";
      console.error("Engine failure", error);
      this.render();
    }
  }

  private glidesFor(move: Move, reverse: boolean): Glide[] {
    const from = moveFrom(move);
    const to = moveTo(move);
    const glides: Glide[] = [{ from, to }];
    const flag = moveFlag(move);
    if (flag === FLAG_CASTLE_KING) {
      glides.push({ from: to + 1, to: to - 1 });
    } else if (flag === FLAG_CASTLE_QUEEN) {
      glides.push({ from: to - 2, to: to + 1 });
    }
    return reverse ? glides.map((glide) => ({ from: glide.to, to: glide.from })) : glides;
  }

  private stepTo(ply: number): void {
    const game = this.game;
    if (game === null) {
      return;
    }
    const target = Math.min(Math.max(ply, 0), game.plies.length);
    if (target === this.viewPly) {
      return;
    }
    let glides: Glide[] = [];
    if (target === this.viewPly + 1) {
      glides = this.glidesFor(game.plies[target - 1].move, false);
    } else if (target === this.viewPly - 1) {
      glides = this.glidesFor(game.plies[target].move, true);
    }
    this.viewPly = target;
    this.choosingPromotion = false;
    this.render(glides);
  }

  private onStatusAction(): void {
    const game = this.game;
    if (game === null) {
      return;
    }
    if (this.engineError !== null) {
      this.continueGame();
    } else if (!this.atLatest()) {
      this.stepTo(Number.MAX_SAFE_INTEGER);
    } else if (game.isOver) {
      this.showSetup(true);
    }
  }

  private onResign(): void {
    const game = this.game;
    if (game === null || game.isOver) {
      return;
    }
    if (this.resignArmedTimer === null) {
      this.ref("resignLabel", HTMLSpanElement).textContent = "Confirm resign";
      this.button("resign").classList.add("armed");
      this.resignArmedTimer = window.setTimeout(() => this.disarmResign(), RESIGN_CONFIRM_MS);
      return;
    }
    this.disarmResign();
    this.engine.cancel();
    this.thinking = false;
    game.resign();
    this.sound.play("end");
    this.viewPly = game.plies.length;
    this.render();
  }

  private disarmResign(): void {
    if (this.resignArmedTimer !== null) {
      window.clearTimeout(this.resignArmedTimer);
      this.resignArmedTimer = null;
    }
    this.ref("resignLabel", HTMLSpanElement).textContent = "Resign";
    this.button("resign").classList.remove("armed");
  }

  private exportJson(): string {
    return this.game === null ? "" : JSON.stringify(this.game.toState(), null, 2);
  }

  private openExport(): void {
    if (this.game === null) {
      return;
    }
    this.ref("exportText", HTMLTextAreaElement).value = this.exportJson();
    this.ref("exportNote", HTMLParagraphElement).textContent = "";
    this.ref("exportDialog", HTMLDialogElement).showModal();
  }

  private downloadExport(): void {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    const url = URL.createObjectURL(new Blob([this.exportJson()], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `fable-5-2-chess-${stamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.ref("exportNote", HTMLParagraphElement).textContent = "Saved to your downloads.";
  }

  private async copyExport(): Promise<void> {
    const note = this.ref("exportNote", HTMLParagraphElement);
    const text = this.ref("exportText", HTMLTextAreaElement);
    try {
      await navigator.clipboard.writeText(text.value);
      note.textContent = "Copied to the clipboard.";
    } catch {
      // The async clipboard API can be denied inside a frame. Selecting the text lets the user copy by hand.
      text.focus();
      text.select();
      note.textContent = "Copying was blocked by the browser. The text is selected; copy it with Ctrl or Cmd + C.";
    }
  }

  private openImport(): void {
    this.ref("importText", HTMLTextAreaElement).value = "";
    this.ref("importFile", HTMLInputElement).value = "";
    this.ref("importError", HTMLParagraphElement).textContent = "";
    this.ref("importDialog", HTMLDialogElement).showModal();
  }

  private async readImportFile(event: Event): Promise<void> {
    const input = event.target;
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (file === undefined) {
      return;
    }
    const error = this.ref("importError", HTMLParagraphElement);
    try {
      this.ref("importText", HTMLTextAreaElement).value = await file.text();
      error.textContent = "";
      this.loadImport();
    } catch {
      error.textContent = "That file could not be read.";
    }
  }

  private loadImport(): void {
    const error = this.ref("importError", HTMLParagraphElement);
    const text = this.ref("importText", HTMLTextAreaElement).value.trim();
    if (text === "") {
      error.textContent = "Choose a file or paste a saved game first.";
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      error.textContent = "That is not valid JSON.";
      return;
    }
    try {
      this.importState(parsed);
    } catch (failure) {
      if (!(failure instanceof StateError)) {
        throw failure;
      }
      error.textContent = `${failure.message}. The current game was not changed.`;
    }
  }

  private render(glides: readonly Glide[] = []): void {
    const game = this.game;
    const position = Position.fromFen(game === null ? START_FEN : game.fenAt(this.viewPly));
    const shown = game !== null && this.viewPly > 0 ? game.plies[this.viewPly - 1] : null;
    this.boardView.render(
      {
        position,
        orientation: this.orientation,
        lastMove: shown === null ? null : { from: moveFrom(shown.move), to: moveTo(shown.move) },
        checkSquare: position.inCheck() ? position.kingSquare[position.turn] : -1,
        interactive: this.canHumanMove(),
      },
      glides,
    );
    this.renderBars(position);
    this.renderStatus();
    this.renderMoves();
    this.renderControls();
    this.renderSoundButton();
  }

  private renderSoundButton(): void {
    const button = this.button("sound");
    button.innerHTML = this.sound.enabled ? ICONS.soundOn : ICONS.soundOff;
    button.setAttribute("aria-pressed", String(this.sound.enabled));
    button.title = this.sound.enabled ? "Sound on" : "Sound off";
  }

  private renderControls(): void {
    const game = this.game;
    const length = game?.plies.length ?? 0;
    this.button("first").disabled = this.viewPly === 0;
    this.button("previous").disabled = this.viewPly === 0;
    this.button("next").disabled = this.viewPly >= length;
    this.button("last").disabled = this.viewPly >= length;
    this.button("resign").disabled = game === null || game.isOver;
    this.button("export").disabled = game === null;
  }

  private renderStatus(): void {
    const game = this.game;
    const status = this.ref("status", HTMLElement);
    const text = this.ref("statusText", HTMLParagraphElement);
    const action = this.button("statusAction");
    let message = "Choose a side to begin.";
    let actionLabel = "";
    let tone = "idle";

    if (game !== null) {
      if (this.engineError !== null) {
        message = `${ENGINE_NAME} could not move: ${this.engineError}`;
        actionLabel = "Try again";
        tone = "error";
      } else if (!this.atLatest()) {
        message = `Viewing move ${this.viewPly} of ${game.plies.length}.`;
        actionLabel = "Back to latest";
        tone = "review";
      } else if (game.isOver) {
        message = describeOutcome(game);
        actionLabel = "New game";
        tone = "over";
      } else if (this.thinking) {
        message = `${ENGINE_NAME} is thinking`;
        tone = "thinking";
      } else {
        message = game.position.inCheck() ? "You are in check. Your move." : "Your move.";
        tone = "turn";
      }
    }
    text.textContent = message;
    status.dataset.tone = tone;
    action.hidden = actionLabel === "";
    action.textContent = actionLabel;
  }

  private renderBars(shownPosition?: Position): void {
    const game = this.game;
    const position = shownPosition ?? Position.fromFen(game === null ? START_FEN : game.fenAt(this.viewPly));
    const topColor = this.orientation === "white" ? BLACK : WHITE;
    this.renderBar(this.ref("topBar", HTMLDivElement), topColor, position);
    this.renderBar(this.ref("bottomBar", HTMLDivElement), topColor ^ 1, position);
  }

  private renderBar(bar: HTMLDivElement, color: number, position: Position): void {
    const game = this.game;
    const humanColor = game?.playerColor === "black" ? BLACK : WHITE;
    const isHuman = game !== null && color === humanColor;
    const isEngine = game !== null && !isHuman;

    const chip = document.createElement("span");
    chip.className = `chip ${color === WHITE ? "w" : "b"}`;
    const name = document.createElement("span");
    name.className = "bar-name";
    name.textContent = game === null ? (color === WHITE ? "White" : "Black") : isHuman ? "You" : ENGINE_NAME;
    bar.replaceChildren(chip, name);

    if (isEngine && game !== null) {
      const level = document.createElement("span");
      level.className = "bar-level";
      level.textContent = DIFFICULTY_LABELS[game.difficulty];
      bar.append(level);
    }
    if (isEngine && this.thinking) {
      const dots = document.createElement("span");
      dots.className = "thinking-dots";
      dots.setAttribute("aria-hidden", "true");
      dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
      bar.append(dots);
    }

    const taken = document.createElement("span");
    taken.className = "taken";
    const captured = (game?.plies.slice(0, this.viewPly) ?? [])
      .map((ply) => ply.captured)
      .filter((piece) => piece !== 0 && pieceColor(piece) !== color);
    CAPTURE_ORDER.forEach((type) => {
      const count = captured.filter((piece) => pieceType(piece) === type).length;
      if (count === 0) {
        return;
      }
      const group = document.createElement("span");
      group.className = "taken-group";
      // Static artwork only; see the note on the template.
      group.innerHTML = pieceSvg(makePiece(color ^ 1, type)).repeat(count);
      taken.append(group);
    });
    const lead = this.materialLead(position, color);
    if (lead > 0) {
      const badge = document.createElement("span");
      badge.className = "lead";
      badge.textContent = `+${lead}`;
      taken.append(badge);
    }
    bar.append(taken);
  }

  private materialLead(position: Position, color: number): number {
    let balance = 0;
    for (let square = 0; square < 120; square += 1) {
      const piece = position.board[square];
      if (square & 0x88 || piece === 0) {
        continue;
      }
      balance += pieceColor(piece) === color ? PIECE_VALUES[pieceType(piece)] : -PIECE_VALUES[pieceType(piece)];
    }
    return balance;
  }

  private renderMoves(): void {
    const game = this.game;
    const list = this.ref("moves", HTMLDivElement);
    if (game === null || game.plies.length === 0) {
      const empty = document.createElement("p");
      empty.className = "moves-empty";
      empty.textContent = game === null ? "Moves will appear here." : "No moves yet.";
      list.replaceChildren(empty);
      return;
    }
    const start = Position.fromFen(game.startFen);
    const blackStarts = start.turn === BLACK;
    const fragment = document.createDocumentFragment();
    let current: HTMLButtonElement | null = null;

    const addNumber = (text: string): void => {
      const number = document.createElement("span");
      number.className = "move-number";
      number.textContent = text;
      fragment.append(number);
    };
    if (blackStarts) {
      addNumber(`${start.fullmoveNumber}.`);
      const gap = document.createElement("span");
      gap.className = "move gap";
      gap.textContent = "…";
      fragment.append(gap);
    }
    game.plies.forEach((ply, index) => {
      const whiteMoved = (index % 2 === 0) !== blackStarts;
      if (whiteMoved) {
        addNumber(`${start.fullmoveNumber + Math.floor((index + (blackStarts ? 1 : 0)) / 2)}.`);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "move";
      button.dataset.ply = String(index + 1);
      button.textContent = ply.san;
      if (index + 1 === this.viewPly) {
        button.classList.add("current");
        button.setAttribute("aria-current", "step");
        current = button;
      }
      fragment.append(button);
    });
    if (game.isOver) {
      const result = document.createElement("span");
      result.className = "move-result";
      result.textContent = game.outcome.result === "1/2-1/2" ? "½-½" : game.outcome.result;
      fragment.append(result);
    }
    list.replaceChildren(fragment);
    this.scrollMoveIntoView(current);
  }

  /** Keeps the highlighted move visible without scrolling the page itself, which `scrollIntoView` would do. */
  private scrollMoveIntoView(current: HTMLButtonElement | null): void {
    const wrap = this.ref("movesWrap", HTMLElement);
    if (current === null) {
      wrap.scrollTop = 0;
      return;
    }
    const wrapRect = wrap.getBoundingClientRect();
    const rect = current.getBoundingClientRect();
    if (rect.top < wrapRect.top) {
      wrap.scrollTop -= wrapRect.top - rect.top + 8;
    } else if (rect.bottom > wrapRect.bottom) {
      wrap.scrollTop += rect.bottom - wrapRect.bottom + 8;
    }
  }
}
