import * as PIXI from "pixi.js";
import type { PuzzleDifficulty } from "./puzzleDifficulty";

interface HintLayerOptions {
  world: PIXI.Container;
  texture: PIXI.Texture;
  boardStartX: number;
  boardStartY: number;
  boardWidth: number;
  boardHeight: number;
  pieceWidth: number;
  pieceHeight: number;
  difficulty: PuzzleDifficulty;
}

export interface PuzzleHintLayer {
  revealPiece: (pieceId: number, cols: number, rows: number) => void;
  revealPieces: (pieceIds: Iterable<number>, cols: number, rows: number) => void;
  setCompletionPercent: (percent: number) => void;
  destroy: () => void;
}

export const createPuzzleHintLayer = (opts: HintLayerOptions): PuzzleHintLayer => {
  const {
    world,
    texture,
    boardStartX,
    boardStartY,
    boardWidth,
    boardHeight,
    difficulty,
  } = opts;

  if (difficulty === "hard" || difficulty === "nightmare") {
    return {
      revealPiece: () => {},
      revealPieces: () => {},
      setCompletionPercent: () => {},
      destroy: () => {},
    };
  }

  const hintSprite = new PIXI.Sprite(texture);
  hintSprite.x = boardStartX;
  hintSprite.y = boardStartY;
  hintSprite.width = boardWidth;
  hintSprite.height = boardHeight;
  hintSprite.alpha = 0.2;
  hintSprite.eventMode = "none";
  hintSprite.zIndex = -0.5;
  if (difficulty === "easy") {
    world.addChild(hintSprite);
    return {
      revealPiece: () => {},
      revealPieces: () => {},
      setCompletionPercent: () => {},
      destroy: () => hintSprite.destroy(),
    };
  }

  // Medium: no per-piece fog reveal.
  // Start with global board guide at 20% alpha, then reduce by 1% every 5% completion.
  hintSprite.alpha = 0.2;
  hintSprite.zIndex = -0.45;
  world.addChild(hintSprite);
  const setCompletionPercent = (percent: number) => {
    const clamped = Math.max(0, Math.min(100, percent));
    const step = Math.floor(clamped / 5);
    hintSprite.alpha = Math.max(0, 0.2 - step * 0.01);
  };
  const revealPiece = () => {};

  return {
    revealPiece,
    revealPieces: () => {},
    setCompletionPercent,
    destroy: () => {
      hintSprite.destroy();
    },
  };
};
