import React, { useState, useEffect, useCallback } from 'react';
import styles from './SlidingPuzzle.module.css';

interface Props {
  challengeId: string;
  points: number;
  timeLimit?: number;
  config?: {
    title?: string;
    image?: string;
    shuffleMoves?: number;
  };
  initialState?: number[] | string;
  currentState?: number[] | string;
  alreadySolved?: boolean;
  savedMoves?: number;
  onComplete?: (result: { moves: number; timeTakenSeconds: number; isSolved: boolean; initialState: string; currentState: string }) => void;
  onStateChange?: (board: number[], moves: number, timeTaken: number) => void;
  isReadOnly?: boolean;
}

// Solved 3x3 state: tiles 1 through 8, with 0 as blank space at position 8
const SOLVED_STATE = [1, 2, 3, 4, 5, 6, 7, 8, 0];

// Tech icons/labels for each tile
const TILE_DATA: Record<number, { label: string; icon: string; color: string }> = {
  1: { label: 'CPU', icon: '🧠', color: '#8B0000' },
  2: { label: 'GPU', icon: '⚡', color: '#B22222' },
  3: { label: 'RAM', icon: '💾', color: '#800000' },
  4: { label: 'NPU', icon: '🤖', color: '#990000' },
  5: { label: 'QPU', icon: '⚛️', color: '#660000' },
  6: { label: 'SSD', icon: '🔋', color: '#8B1A1A' },
  7: { label: 'BUS', icon: '🔌', color: '#A52A2A' },
  8: { label: 'CRYPTO', icon: '🔐', color: '#800020' },
};

/**
 * Generate a mathematically guaranteed solvable 3x3 puzzle by starting from solved state
 * and applying a controlled number of valid neighbor swaps.
 */
function generateSolvableBoard(movesCount = 28): { board: number[]; moves: number[] } {
  const board = [...SOLVED_STATE];
  let emptyIdx = 8;
  let lastMove = -1;

  for (let m = 0; m < movesCount; m++) {
    const row = Math.floor(emptyIdx / 3);
    const col = emptyIdx % 3;
    const neighbors: number[] = [];

    if (row > 0) neighbors.push(emptyIdx - 3); // Up
    if (row < 2) neighbors.push(emptyIdx + 3); // Down
    if (col > 0) neighbors.push(emptyIdx - 1); // Left
    if (col < 2) neighbors.push(emptyIdx + 1); // Right

    // Filter out immediate reverse move to prevent trivial loops
    const validMoves = neighbors.filter((n) => n !== lastMove);
    const chosen = validMoves.length > 0
      ? validMoves[Math.floor(Math.random() * validMoves.length)]
      : neighbors[Math.floor(Math.random() * neighbors.length)];

    // Swap empty with chosen
    board[emptyIdx] = board[chosen];
    board[chosen] = 0;
    lastMove = emptyIdx;
    emptyIdx = chosen;
  }

  // Ensure it's not solved initially
  if (isBoardSolved(board)) {
    const neighbors = [emptyIdx > 2 ? emptyIdx - 3 : emptyIdx + 3];
    const chosen = neighbors[0];
    board[emptyIdx] = board[chosen];
    board[chosen] = 0;
  }

  return { board, moves: [] };
}

function isBoardSolved(board: number[]): boolean {
  for (let i = 0; i < SOLVED_STATE.length; i++) {
    if (board[i] !== SOLVED_STATE[i]) return false;
  }
  return true;
}

export default function SlidingPuzzle({
  challengeId,
  points,
  config,
  onComplete,
  onStateChange,
  initialState,
  currentState,
  alreadySolved = false,
  savedMoves = 0,
  isReadOnly = false,
}: Props) {
  const [initialBoard, setInitialBoard] = useState<number[]>([]);
  const [board, setBoard] = useState<number[]>([]);
  const [moves, setMoves] = useState(savedMoves);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [solved, setSolved] = useState(alreadySolved);
  const [submitted, setSubmitted] = useState(alreadySolved);

  // Initialize board from server-persisted initialState/currentState or fallback
  useEffect(() => {
    let startingBoard: number[] | null = null;
    let currentActiveBoard: number[] | null = null;

    if (initialState) {
      if (Array.isArray(initialState) && initialState.length === 9) {
        startingBoard = initialState;
      } else if (typeof initialState === 'string') {
        try {
          const parsed = JSON.parse(initialState);
          if (Array.isArray(parsed) && parsed.length === 9) startingBoard = parsed;
        } catch {
          // ignore
        }
      }
    }

    if (currentState) {
      if (Array.isArray(currentState) && currentState.length === 9) {
        currentActiveBoard = currentState;
      } else if (typeof currentState === 'string') {
        try {
          const parsed = JSON.parse(currentState);
          if (Array.isArray(parsed) && parsed.length === 9) currentActiveBoard = parsed;
        } catch {
          // ignore
        }
      }
    }

    if (!startingBoard) {
      const shuffleSteps = config?.shuffleMoves || 28;
      const { board: generated } = generateSolvableBoard(shuffleSteps);
      startingBoard = generated;
    }

    setInitialBoard(startingBoard);
    setBoard(currentActiveBoard || startingBoard);
    setMoves(savedMoves);
    setStartTime(Date.now());
    setElapsedSeconds(0);
    setSolved(alreadySolved);
    setSubmitted(alreadySolved);
  }, [challengeId, config?.shuffleMoves, initialState, currentState, alreadySolved, savedMoves]);

  // Live timer
  useEffect(() => {
    if (solved || submitted || isReadOnly) return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, solved, submitted, isReadOnly]);

  // Handle tile click
  const handleTileClick = useCallback(
    (index: number) => {
      if (solved || submitted || isReadOnly) return;

      const emptyIndex = board.indexOf(0);
      const row = Math.floor(index / 3);
      const col = index % 3;
      const emptyRow = Math.floor(emptyIndex / 3);
      const emptyCol = emptyIndex % 3;

      const isAdjacent =
        (Math.abs(row - emptyRow) === 1 && col === emptyCol) ||
        (Math.abs(col - emptyCol) === 1 && row === emptyRow);

      if (!isAdjacent) return;

      const newBoard = [...board];
      newBoard[emptyIndex] = newBoard[index];
      newBoard[index] = 0;

      const nextMoves = moves + 1;
      setBoard(newBoard);
      setMoves(nextMoves);

      const timeTaken = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
      onStateChange?.(newBoard, nextMoves, timeTaken);

      if (isBoardSolved(newBoard)) {
        setSolved(true);
        onComplete?.({
          moves: nextMoves,
          timeTakenSeconds: timeTaken,
          isSolved: true,
          initialState: JSON.stringify(initialBoard),
          currentState: JSON.stringify(newBoard),
        });
      }
    },
    [board, moves, solved, submitted, isReadOnly, startTime, initialBoard, onComplete, onStateChange]
  );

  function handleReset() {
    if (solved || submitted || isReadOnly) return;
    setBoard([...initialBoard]);
    setMoves(0);
    onStateChange?.([...initialBoard], 0, 0);
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const hasCustomImage = !!config?.image;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h3 className={styles.title}>{config?.title || '⚡ Neural Quantum Processor Grid'}</h3>
          <p className={styles.subtitle}>
            Slide the tiles into sequential order (1 to 8). Click any adjacent tile to move it into the empty space.
          </p>
        </div>
        <div className={styles.stats}>
          <div className={styles.statBox}>
            <span className={styles.statLabel}>Moves</span>
            <span className={styles.statVal}>{moves}</span>
          </div>
          <div className={styles.statBox}>
            <span className={styles.statLabel}>Time</span>
            <span className={styles.statVal}>{timeFormatted}</span>
          </div>
          <div className={styles.statBox}>
            <span className={styles.statLabel}>Reward</span>
            <span className={styles.statValGold}>{points} pts</span>
          </div>
        </div>
      </div>

      {solved && (
        <div className={styles.victoryBanner}>
          <span className={styles.victoryIcon}>🎉</span>
          <div>
            <strong>Puzzle Solved in {moves} moves!</strong>
            <p>Score has been recorded and submitted to the server.</p>
          </div>
        </div>
      )}

      {/* 3x3 Puzzle Board */}
      <div className={styles.boardWrapper}>
        <div className={styles.board}>
          {board.map((tile, idx) => {
            if (tile === 0) {
              return (
                <div key="empty" className={styles.emptyTile}>
                  <span className={styles.emptyText}>EMPTY</span>
                </div>
              );
            }

            const data = TILE_DATA[tile] || { label: `Tile ${tile}`, icon: '⚡', color: '#8B0000' };
            const isCorrectPosition = tile === idx + 1;

            // Image slice coordinates for 3x3 grid
            const origTileIndex = tile - 1; // 0..7
            const origRow = Math.floor(origTileIndex / 3);
            const origCol = origTileIndex % 3;
            const imageStyle = hasCustomImage
              ? {
                  backgroundImage: `url(${config!.image})`,
                  backgroundSize: '300% 300%',
                  backgroundPosition: `${origCol * 50}% ${origRow * 50}%`,
                  backgroundRepeat: 'no-repeat',
                }
              : {};

            return (
              <button
                key={tile}
                type="button"
                className={`${styles.tile} ${isCorrectPosition ? styles.tileCorrect : ''} ${hasCustomImage ? styles.tileImage : ''}`}
                style={imageStyle}
                onClick={() => handleTileClick(idx)}
                disabled={solved || isReadOnly}
                aria-label={`Tile ${tile}: ${data.label}`}
              >
                <span className={styles.tileNumber}>{tile}</span>
                {!hasCustomImage && <span className={styles.tileIcon}>{data.icon}</span>}
                {!hasCustomImage && <span className={styles.tileLabel}>{data.label}</span>}
                {isCorrectPosition && <span className={styles.checkMark}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Target Reference Guide */}
      <div className={styles.footer}>
        <div className={styles.targetGuide}>
          <span className={styles.guideTitle}>Goal:</span>
          <div className={styles.miniTargetGrid}>
            {[1, 2, 3, 4, 5, 6, 7, 8, ' '].map((n, i) => (
              <span key={i} className={styles.miniCell}>
                {n}
              </span>
            ))}
          </div>
        </div>
        {!solved && !isReadOnly && (
          <button type="button" className={styles.resetBtn} onClick={handleReset}>
            ↺ Reset to Start
          </button>
        )}
      </div>
    </div>
  );
}
