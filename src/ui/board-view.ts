import {
  BISHOP,
  KNIGHT,
  type Position,
  QUEEN,
  ROOK,
  makePiece,
  pieceColor,
  squareFile,
  squareName,
  squareRank,
  toSquare,
} from "../chess/position";
import type { PlayerColor } from "../game/types";
import { pieceName, pieceSvg } from "./pieces";

export interface BoardModel {
  position: Position;
  orientation: PlayerColor;
  lastMove: { from: number; to: number } | null;
  /** Square of a king in check, or -1. */
  checkSquare: number;
  /** Whether the side to move may be moved by the user right now. */
  interactive: boolean;
}

/** A piece that should glide from one square to another on the next render. */
export interface Glide {
  from: number;
  to: number;
}

export interface BoardCallbacks {
  /** Legal destination squares for the piece on `square`. */
  targetsFrom(square: number): number[];
  /** The user asked for a move. `dropped` is true when the piece was dragged, so it needs no glide. */
  onMove(from: number, to: number, dropped: boolean): void;
}

interface Drag {
  square: number;
  pointerId: number;
  startX: number;
  startY: number;
  element: HTMLElement;
  active: boolean;
  /** The square was already selected before this press, so a plain click should deselect it. */
  wasSelected: boolean;
}

const DRAG_THRESHOLD = 5;
const GLIDE_MS = 190;

/** Draws the board and turns pointer input into move requests. It knows nothing about the rules. */
export class BoardView {
  private readonly root: HTMLElement;
  private readonly callbacks: BoardCallbacks;
  private readonly squaresLayer: HTMLElement;
  private readonly piecesLayer: HTMLElement;
  private readonly squareElements = new Map<number, HTMLElement>();
  private readonly pieceElements = new Map<number, HTMLElement>();
  private model: BoardModel | null = null;
  private builtFor: PlayerColor | null = null;
  private selected = -1;
  private targets: number[] = [];
  private drag: Drag | null = null;
  private promotionCleanup: (() => void) | null = null;

  constructor(root: HTMLElement, callbacks: BoardCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Chess board");
    this.squaresLayer = document.createElement("div");
    this.squaresLayer.className = "squares";
    this.piecesLayer = document.createElement("div");
    this.piecesLayer.className = "pieces";
    root.append(this.squaresLayer, this.piecesLayer);
    root.addEventListener("pointerdown", this.onPointerDown);
    root.addEventListener("pointermove", this.onPointerMove);
    root.addEventListener("pointerup", this.onPointerUp);
    root.addEventListener("pointercancel", this.onPointerCancel);
  }

  /** Redraws everything for `model`. Pieces listed in `glides` animate into place. */
  render(model: BoardModel, glides: readonly Glide[] = []): void {
    this.cancelPromotion();
    this.drag = null;
    this.model = model;
    this.selected = -1;
    this.targets = [];
    if (this.builtFor !== model.orientation) {
      this.buildSquares(model.orientation);
    }
    this.drawPieces(model);
    this.paintSquares();
    glides.forEach((glide) => this.glide(glide));
  }

  /**
   * Shows the promotion picker over the target square.
   * Resolves with the chosen piece type, or null when the user dismisses it.
   */
  askPromotion(square: number, color: number): Promise<number | null> {
    this.cancelPromotion();
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "promotion";
      const { column, row } = this.place(square);
      const picker = document.createElement("div");
      picker.className = `promotion-picker ${row === 0 ? "from-top" : "from-bottom"}`;
      picker.style.left = `${column * 12.5}%`;
      picker.setAttribute("role", "dialog");
      picker.setAttribute("aria-label", "Choose a piece to promote to");

      const finish = (choice: number | null): void => {
        overlay.remove();
        this.promotionCleanup = null;
        resolve(choice);
      };
      [QUEEN, ROOK, BISHOP, KNIGHT].forEach((type) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "promotion-choice";
        button.innerHTML = pieceSvg(makePiece(color, type));
        button.setAttribute("aria-label", `Promote to ${pieceName(makePiece(color, type)).split(" ")[1]}`);
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          finish(type);
        });
        picker.append(button);
      });
      overlay.addEventListener("click", () => finish(null));
      // The board's own pointer handling must not see presses meant for the picker.
      overlay.addEventListener("pointerdown", (event) => event.stopPropagation());
      overlay.append(picker);
      this.root.append(overlay);
      this.promotionCleanup = (): void => finish(null);
      picker.querySelector("button")?.focus();
    });
  }

  private cancelPromotion(): void {
    this.promotionCleanup?.();
  }

  private place(square: number): { column: number; row: number } {
    const white = this.model?.orientation !== "black";
    return {
      column: white ? squareFile(square) : 7 - squareFile(square),
      row: white ? 7 - squareRank(square) : squareRank(square),
    };
  }

  private buildSquares(orientation: PlayerColor): void {
    this.builtFor = orientation;
    this.squareElements.clear();
    this.squaresLayer.replaceChildren();
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const file = orientation === "white" ? column : 7 - column;
        const rank = orientation === "white" ? 7 - row : row;
        const square = toSquare(file, rank);
        const element = document.createElement("div");
        element.className = `sq ${(file + rank) % 2 === 0 ? "dark" : "light"}`;
        if (column === 0) {
          element.insertAdjacentHTML("beforeend", `<span class="coord rank">${rank + 1}</span>`);
        }
        if (row === 7) {
          element.insertAdjacentHTML("beforeend", `<span class="coord file">${"abcdefgh"[file]}</span>`);
        }
        this.squareElements.set(square, element);
        this.squaresLayer.append(element);
      }
    }
  }

  private drawPieces(model: BoardModel): void {
    this.pieceElements.clear();
    const fragment = document.createDocumentFragment();
    this.squareElements.forEach((_element, square) => {
      const piece = model.position.board[square];
      if (piece === 0) {
        return;
      }
      const element = document.createElement("div");
      element.className = "piece";
      element.innerHTML = pieceSvg(piece);
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `${pieceName(piece)} on ${squareName(square)}`);
      element.style.transform = this.restingTransform(square);
      this.pieceElements.set(square, element);
      fragment.append(element);
    });
    this.piecesLayer.replaceChildren(fragment);
  }

  private restingTransform(square: number): string {
    const { column, row } = this.place(square);
    return `translate(${column * 100}%, ${row * 100}%)`;
  }

  private paintSquares(): void {
    const model = this.model;
    if (model === null) {
      return;
    }
    this.root.classList.toggle("interactive", model.interactive);
    this.squareElements.forEach((element, square) => {
      const isTarget = this.targets.includes(square);
      element.classList.toggle("last", model.lastMove?.from === square || model.lastMove?.to === square);
      element.classList.toggle("check", model.checkSquare === square);
      element.classList.toggle("selected", this.selected === square);
      element.classList.toggle("hint", isTarget && model.position.board[square] === 0);
      element.classList.toggle("hint-capture", isTarget && model.position.board[square] !== 0);
    });
  }

  private glide({ from, to }: Glide): void {
    const element = this.pieceElements.get(to);
    if (element === undefined || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    element.classList.add("gliding");
    const animation = element.animate(
      [{ transform: this.restingTransform(from) }, { transform: this.restingTransform(to) }],
      { duration: GLIDE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    animation.addEventListener("finish", () => element.classList.remove("gliding"));
    animation.addEventListener("cancel", () => element.classList.remove("gliding"));
  }

  private squareAt(clientX: number, clientY: number): number {
    const rect = this.root.getBoundingClientRect();
    const column = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (column < 0 || column > 7 || row < 0 || row > 7) {
      return -1;
    }
    const white = this.model?.orientation !== "black";
    return toSquare(white ? column : 7 - column, white ? 7 - row : row);
  }

  private select(square: number): void {
    this.selected = square;
    this.targets = square === -1 ? [] : this.callbacks.targetsFrom(square);
    this.paintSquares();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const model = this.model;
    if (model === null || !model.interactive || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    const square = this.squareAt(event.clientX, event.clientY);
    if (square === -1) {
      return;
    }
    event.preventDefault();
    if (this.selected !== -1 && this.targets.includes(square)) {
      const from = this.selected;
      this.select(-1);
      this.callbacks.onMove(from, square, false);
      return;
    }
    const piece = model.position.board[square];
    const element = this.pieceElements.get(square);
    if (piece === 0 || pieceColor(piece) !== model.position.turn || element === undefined) {
      this.select(-1);
      return;
    }
    const wasSelected = this.selected === square;
    this.select(square);
    this.drag = {
      square,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      element,
      active: false,
      wasSelected,
    };
    this.root.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) {
        return;
      }
      drag.active = true;
      drag.element.classList.add("dragging");
    }
    const rect = this.root.getBoundingClientRect();
    const size = rect.width / 8;
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width) - size / 2;
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height) - size / 2;
    drag.element.style.transform = `translate(${x}px, ${y}px) scale(1.15)`;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    this.drag = null;
    if (!drag.active) {
      if (drag.wasSelected) {
        this.select(-1);
      }
      return;
    }
    const square = this.squareAt(event.clientX, event.clientY);
    if (square !== -1 && this.targets.includes(square)) {
      this.select(-1);
      this.callbacks.onMove(drag.square, square, true);
      return;
    }
    this.settle(drag);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    const drag = this.drag;
    if (drag !== null && drag.pointerId === event.pointerId) {
      this.drag = null;
      this.settle(drag);
    }
  };

  /** Puts a dragged piece back on its own square. */
  private settle(drag: Drag): void {
    drag.element.classList.remove("dragging");
    drag.element.style.transform = this.restingTransform(drag.square);
  }
}
