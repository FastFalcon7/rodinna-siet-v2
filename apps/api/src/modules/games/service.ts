import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { GameAnswerInput, GamePublic, PostAuthor, TttMark } from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import {
  feedCards,
  gameMoves,
  gameSessions,
  media,
  roomMembers,
  users,
  type GameSessionRow,
} from '../../core/db/schema';
import { APP_TOPIC } from '../../core/realtime';
import { publishCrossProcess } from '../../core/events';
import { getOnlineUserIds } from '../../core/realtime';
import { toMediaPublic } from '../media/service';

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class BadRequestError extends Error {}

/** Stav piškvoriek v stateJson. */
interface TttState {
  board: (TttMark | null)[];
  xUserId: string;
  oUserId: string | null;
  turn: TttMark;
  winner: TttMark | 'draw' | null;
  rematchId?: string | null;
}

interface QuestState {
  question: string;
  date: string;
}

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // riadky
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // stĺpce
  [0, 4, 8], [2, 4, 6], // uhlopriečky
] as const;

async function fetchAuthors(userIds: (string | null)[]): Promise<Map<string, PostAuthor>> {
  const ids = [...new Set(userIds.filter((v): v is string => v !== null))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

async function getSession(gameId: string): Promise<GameSessionRow> {
  const rows = await db.select().from(gameSessions).where(eq(gameSessions.id, gameId)).limit(1);
  if (!rows[0]) throw new NotFoundError('Hra nenájdená');
  return rows[0];
}

/** Hry viazané na miestnosť vidia len jej členovia (nepriznávame existenciu). */
async function requireAccess(session: GameSessionRow, userId: string): Promise<void> {
  if (!session.roomId) return; // denná otázka / foto výzva = family-wide
  const rows = await db
    .select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, session.roomId), eq(roomMembers.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Hra nenájdená');
}

async function broadcast(gameId: string): Promise<void> {
  await publishCrossProcess(APP_TOPIC, { t: 'game:update', gameId });
}

// ── Hydratácia ───────────────────────────────────────────────────────────────

export async function getGame(gameId: string, viewerId: string): Promise<GamePublic> {
  const session = await getSession(gameId);
  await requireAccess(session, viewerId);

  const base = {
    id: session.id,
    kind: session.kind,
    status: session.status,
    roomId: session.roomId,
    createdAt: session.createdAt.toISOString(),
  };

  if (session.kind === 'tictactoe') {
    const st = session.stateJson as unknown as TttState;
    const authors = await fetchAuthors([session.createdBy, st.xUserId, st.oUserId]);
    return {
      ...base,
      createdBy: authors.get(session.createdBy)!,
      board: st.board,
      players: { x: authors.get(st.xUserId)!, o: st.oUserId ? (authors.get(st.oUserId) ?? null) : null },
      turn: session.status === 'active' ? st.turn : null,
      winner: st.winner ?? null,
      rematchId: st.rematchId ?? null,
    };
  }

  // daily / photo
  const st = session.stateJson as unknown as QuestState;
  const moveRows = await db
    .select({ move: gameMoves, media })
    .from(gameMoves)
    .leftJoin(media, sqlMediaJoin())
    .where(eq(gameMoves.sessionId, session.id))
    .orderBy(asc(gameMoves.createdAt));
  const authors = await fetchAuthors([session.createdBy, ...moveRows.map((m) => m.move.userId)]);
  const myAnswered = moveRows.some((m) => m.move.userId === viewerId);
  // Denná otázka: odpovede vidíš až po vlastnej (nech ťa neovplyvnia).
  const revealed = session.kind === 'photo' || myAnswered;

  return {
    ...base,
    createdBy: authors.get(session.createdBy)!,
    question: st.question,
    myAnswered,
    answersCount: moveRows.length,
    answers: revealed
      ? moveRows.map((m) => {
          const payload = m.move.payloadJson as { text?: string };
          return {
            author: authors.get(m.move.userId)!,
            text: payload.text ?? '',
            media: m.media ? toMediaPublic(m.media) : null,
            createdAt: m.move.createdAt.toISOString(),
          };
        })
      : [],
  };
}

/** Join media cez jsonb mediaId v payloade odpovede. */
function sqlMediaJoin() {
  return sql`${media.id}::text = ${gameMoves.payloadJson}->>'mediaId'`;
}

// ── Piškvorky ────────────────────────────────────────────────────────────────

export async function createTictactoe(creatorId: string, roomId: string): Promise<GamePublic> {
  const member = await db
    .select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, creatorId)))
    .limit(1);
  if (!member[0]) throw new NotFoundError('Miestnosť nenájdená');

  const state: TttState = {
    board: Array(9).fill(null),
    xUserId: creatorId,
    oUserId: null,
    turn: 'x',
    winner: null,
  };
  const inserted = await db
    .insert(gameSessions)
    .values({ kind: 'tictactoe', roomId, createdBy: creatorId, stateJson: state, status: 'open' })
    .returning();
  return getGame(inserted[0]!.id, creatorId);
}

export async function joinTictactoe(gameId: string, userId: string): Promise<GamePublic> {
  const session = await getSession(gameId);
  await requireAccess(session, userId);
  if (session.kind !== 'tictactoe') throw new BadRequestError('Toto nie sú piškvorky');
  const st = session.stateJson as unknown as TttState;
  if (session.status !== 'open') throw new BadRequestError('Hra už má oboch hráčov');
  if (st.xUserId === userId) throw new BadRequestError('Sám so sebou to nepôjde 🙂');

  st.oUserId = userId;
  await db
    .update(gameSessions)
    .set({ stateJson: st, status: 'active', updatedAt: new Date() })
    .where(eq(gameSessions.id, gameId));
  await broadcast(gameId);

  // Vyzývateľ je na ťahu — povedz mu to (push len offline).
  const { notifyUsers } = await import('../notifications/service');
  await notifyUsers([st.xUserId], 'games.turn', {
    title: 'Piškvorky prijaté ✏️',
    body: 'Si na ťahu!',
    url: session.roomId ? `/?room=${session.roomId}` : '/',
    tag: `game-${gameId}`,
  }, { inApp: false, skipPushFor: getOnlineUserIds() });

  return getGame(gameId, userId);
}

function winnerOf(board: (TttMark | null)[]): TttMark | 'draw' | null {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a]!;
  }
  return board.every((c) => c !== null) ? 'draw' : null;
}

export async function moveTictactoe(gameId: string, userId: string, cell: number): Promise<GamePublic> {
  const session = await getSession(gameId);
  await requireAccess(session, userId);
  if (session.kind !== 'tictactoe') throw new BadRequestError('Toto nie sú piškvorky');
  if (session.status !== 'active') throw new BadRequestError('Hra nie je rozohraná');

  const st = session.stateJson as unknown as TttState;
  const myMark: TttMark | null = st.xUserId === userId ? 'x' : st.oUserId === userId ? 'o' : null;
  if (!myMark) throw new ForbiddenError('Nie si hráčom tejto partie');
  if (st.turn !== myMark) throw new BadRequestError('Nie si na ťahu');
  if (st.board[cell] !== null) throw new BadRequestError('Políčko je obsadené');

  st.board[cell] = myMark;
  st.winner = winnerOf(st.board);
  st.turn = myMark === 'x' ? 'o' : 'x';
  const finished = st.winner !== null;

  await db
    .update(gameSessions)
    .set({ stateJson: st, status: finished ? 'finished' : 'active', updatedAt: new Date() })
    .where(eq(gameSessions.id, gameId));
  await db.insert(gameMoves).values({ sessionId: gameId, userId, payloadJson: { cell, mark: myMark } });
  await broadcast(gameId);

  // Push súperovi: buď je na ťahu, alebo mu oznám výsledok.
  const opponentId = myMark === 'x' ? st.oUserId : st.xUserId;
  if (opponentId) {
    const { notifyUsers } = await import('../notifications/service');
    const authors = await fetchAuthors([userId]);
    const meName = authors.get(userId)?.displayName ?? 'Súper';
    await notifyUsers([opponentId], 'games.turn', {
      title: finished
        ? st.winner === 'draw'
          ? 'Piškvorky: remíza 🤝'
          : `Piškvorky: ${meName} vyhral/a 🏆`
        : `${meName} potiahol/la — si na ťahu ✏️`,
      body: 'Otvor kartu v chate.',
      url: session.roomId ? `/?room=${session.roomId}` : '/',
      tag: `game-${gameId}`,
    }, { inApp: false, skipPushFor: getOnlineUserIds() });
  }

  return getGame(gameId, userId);
}

/** Odveta: nová hra v tej istej miestnosti (vyzývateľ = kto klikol), prelinkovaná z karty. */
export async function rematchTictactoe(gameId: string, userId: string): Promise<GamePublic> {
  const session = await getSession(gameId);
  await requireAccess(session, userId);
  if (session.kind !== 'tictactoe' || session.status !== 'finished') {
    throw new BadRequestError('Odveta sa dá len po skončenej hre');
  }
  const st = session.stateJson as unknown as TttState;
  if (st.rematchId) return getGame(st.rematchId, userId);
  if (userId !== st.xUserId && userId !== st.oUserId) throw new ForbiddenError('Nie si hráčom tejto partie');

  const fresh = await createTictactoe(userId, session.roomId!);
  st.rematchId = fresh.id;
  await db.update(gameSessions).set({ stateJson: st }).where(eq(gameSessions.id, gameId));
  await broadcast(gameId);
  return fresh;
}

// ── Denná otázka / foto výzva ────────────────────────────────────────────────

export async function answerGame(gameId: string, userId: string, input: GameAnswerInput): Promise<GamePublic> {
  const session = await getSession(gameId);
  await requireAccess(session, userId);
  if (session.kind === 'tictactoe') throw new BadRequestError('Piškvorky sa hrajú ťahmi');
  if (session.status === 'finished') throw new BadRequestError('Výzva už skončila');
  if (session.kind === 'photo' && !input.mediaId) throw new BadRequestError('Foto výzva chce fotku 📷');

  // Jedna odpoveď na užívateľa — ďalšia ju nahradí.
  await db.delete(gameMoves).where(and(eq(gameMoves.sessionId, gameId), eq(gameMoves.userId, userId)));
  await db.insert(gameMoves).values({
    sessionId: gameId,
    userId,
    payloadJson: { text: input.text, mediaId: input.mediaId ?? null },
  });
  await broadcast(gameId);
  return getGame(gameId, userId);
}

/** Vytvor kartu otázky/výzvy vo Feede (denný worker job). */
export async function createQuest(
  kind: 'daily' | 'photo',
  question: string,
  authorId: string,
  dateIso: string,
): Promise<string> {
  const inserted = await db
    .insert(gameSessions)
    .values({
      kind,
      stateJson: { question, date: dateIso } satisfies QuestState,
      status: 'active',
      createdBy: authorId,
    })
    .returning();
  const id = inserted[0]!.id;
  await db.insert(feedCards).values({ module: 'games', entityId: id, authorId });
  await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'games', entityId: id });
  return id;
}
