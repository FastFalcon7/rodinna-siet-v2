import { TTT_BOARD_SIZE, TTT_WIN_COUNT, type TttMark } from '@rodinna/shared-types';

/**
 * AI súper pre piškvorky (M6 doplnok). Žiadny LLM — na 10×10 doske je
 * jednoduchý heuristický bot rýchlejší aj spoľahlivejší než promptovanie
 * Ollamy pre herné ťahy. Jediná úroveň (žiadne "ľahká/stredná" — tie boli
 * v praxi skoro nerozoznateľné, keďže po win/block ťahali len náhodne):
 * win-if-possible → block-if-necessary → inak heuristické skóre línií
 * (bez plného minimaxu — na 100 poliach by bol príliš drahý).
 */

const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function at(board: (TttMark | null)[], r: number, c: number): TttMark | null {
  if (r < 0 || r >= TTT_BOARD_SIZE || c < 0 || c >= TTT_BOARD_SIZE) return null;
  return board[r * TTT_BOARD_SIZE + c] ?? null;
}

function emptyCells(board: (TttMark | null)[]): number[] {
  const cells: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === null) cells.push(i);
  return cells;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Dĺžka súvislej línie danej značky, keby bola práve teraz položená na (r0, c0). */
function lineLength(board: (TttMark | null)[], r0: number, c0: number, dr: number, dc: number, mark: TttMark): number {
  let count = 1;
  let r = r0 + dr;
  let c = c0 + dc;
  while (at(board, r, c) === mark) {
    count++;
    r += dr;
    c += dc;
  }
  r = r0 - dr;
  c = c0 - dc;
  while (at(board, r, c) === mark) {
    count++;
    r -= dr;
    c -= dc;
  }
  return count;
}

/** Existuje prázdne políčko, ktoré by pre `mark` dokončilo 5 v rade? Ak áno, vráti ho. */
function findWinningCell(board: (TttMark | null)[], mark: TttMark): number | null {
  for (const cell of emptyCells(board)) {
    const r0 = Math.floor(cell / TTT_BOARD_SIZE);
    const c0 = cell % TTT_BOARD_SIZE;
    for (const [dr, dc] of DIRS) {
      if (lineLength(board, r0, c0, dr, dc, mark) >= TTT_WIN_COUNT) return cell;
    }
  }
  return null;
}

/** Otvorená línia (aspoň jeden voľný koniec) váži viac než zablokovaná — nútiť súpera brániť. */
function openEndsBonus(board: (TttMark | null)[], r0: number, c0: number, dr: number, dc: number, mark: TttMark): number {
  let ends = 0;
  let r = r0 + dr;
  let c = c0 + dc;
  while (at(board, r, c) === mark) {
    r += dr;
    c += dc;
  }
  if (at(board, r, c) === null) ends++;
  r = r0 - dr;
  c = c0 - dc;
  while (at(board, r, c) === mark) {
    r -= dr;
    c -= dc;
  }
  if (at(board, r, c) === null) ends++;
  return ends;
}

function scoreCell(board: (TttMark | null)[], cell: number, mark: TttMark, opp: TttMark): number {
  const r0 = Math.floor(cell / TTT_BOARD_SIZE);
  const c0 = cell % TTT_BOARD_SIZE;
  let score = 0;
  for (const [dr, dc] of DIRS) {
    const own = lineLength(board, r0, c0, dr, dc, mark);
    score += 10 ** Math.min(own, 4) * (openEndsBonus(board, r0, c0, dr, dc, mark) + 1);
    // Blokovanie súperovej línie na tom istom políčku je skoro tak cenné ako vlastný útok.
    const theirs = lineLength(board, r0, c0, dr, dc, opp);
    score += 0.9 * 10 ** Math.min(theirs, 4) * (openEndsBonus(board, r0, c0, dr, dc, opp) + 1);
  }
  return score;
}

/** Vráti index políčka pre ťah bota, alebo null ak je doska plná (remíza). */
export function pickBotMove(board: (TttMark | null)[], botMark: TttMark): number | null {
  const empty = emptyCells(board);
  if (empty.length === 0) return null;

  const oppMark: TttMark = botMark === 'x' ? 'o' : 'x';
  const winning = findWinningCell(board, botMark);
  if (winning !== null) return winning;
  const blocking = findWinningCell(board, oppMark);
  if (blocking !== null) return blocking;

  // Heuristické skóre — najlepšie políčko (s náhodou medzi remízovými top výsledkami).
  let best: number[] = [];
  let bestScore = -Infinity;
  for (const cell of empty) {
    const s = scoreCell(board, cell, botMark, oppMark);
    if (s > bestScore) {
      bestScore = s;
      best = [cell];
    } else if (s === bestScore) {
      best.push(cell);
    }
  }
  return pickRandom(best);
}
