import { useCallback, useEffect, useState } from 'react';
import {
  QUIZ_AUDIENCE_LABELS,
  type ChatRoomPublic,
  type QuizAudience,
  type QuizPublic,
  type QuizQuestion,
} from '@rodinna/shared-types';
import { ApiError, chatApi, diaryApi, quizApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useChat } from '../chat/ChatProvider';
import { QuizBody } from './QuizCard';

/**
 * Modul Kvízy (M8, slot Viac): tvorba kvízu na tému (LLM vo workeri),
 * review draftov (human-in-the-loop — malý model halucinuje, autor otázky
 * skontroluje/upraví a až potom publikuje) a prehľad kvízov na hranie.
 */
export function Quizzes() {
  const { user } = useAuth();
  const { subscribe } = useChat();
  const [quizzes, setQuizzes] = useState<QuizPublic[] | null>(null);
  const [llm, setLlm] = useState<{ enabled: boolean } | null>(null);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    void quizApi.list().then((r) => setQuizzes(r.quizzes)).catch(() => setQuizzes([]));
  }, []);

  useEffect(() => {
    load();
    void diaryApi.status().then(setLlm).catch(() => setLlm({ enabled: false }));
    const off = subscribe((e) => {
      if (e.t === 'quiz:update') load();
    });
    return () => off();
  }, [load, subscribe]);

  const flash = (msg: string) => {
    setFlashMsg(msg);
    setTimeout(() => setFlashMsg(null), 4000);
  };

  if (!user) return null;

  return (
    <div className="space-y-4 px-4 py-4">
      <header>
        <h2 className="text-lg font-semibold">🧠 Kvízy</h2>
        <p className="text-sm text-neutral-500">
          Zadaj tému — Harry Potter, hlavné mestá, rodinné jubileá… — a LLM pripraví
          otázky. Skontroluješ ich a pustíš rodine, miestnosti alebo len sebe.
        </p>
      </header>

      {flashMsg && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-sm text-accent">{flashMsg}</p>
      )}

      {llm?.enabled === false ? (
        <p className="rounded-xl bg-neutral-100 p-3 text-xs text-neutral-500 dark:bg-neutral-800">
          LLM nie je na serveri zapnuté (LLM_BASE_URL) — kvízy sa zapnú s Ollamou na NAS-e.
        </p>
      ) : (
        <CreateQuizForm onCreated={(q) => {
          flash(`Kvíz „${q.topic}" sa generuje — dáme ti vedieť ✅`);
          load();
        }} />
      )}

      {quizzes === null ? (
        <div className="h-24 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-800" />
      ) : quizzes.length === 0 ? (
        <p className="text-sm text-neutral-400">Zatiaľ žiadne kvízy — vytvor prvý 🎉</p>
      ) : (
        <ul className="space-y-3">
          {quizzes.map((q) => (
            <li key={q.id}>
              <QuizListItem quiz={q} meId={user.id} onChanged={load} onFlash={flash} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Tvorba ───────────────────────────────────────────────────────────────────

function CreateQuizForm({ onCreated }: { onCreated: (q: QuizPublic) => void }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(5);
  const [audience, setAudience] = useState<QuizAudience>('family');
  const [roomId, setRoomId] = useState('');
  const [facts, setFacts] = useState('');
  const [rooms, setRooms] = useState<ChatRoomPublic[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (audience === 'room' && rooms.length === 0) {
      void chatApi.listRooms().then((r) => setRooms(r.rooms)).catch(() => {});
    }
  }, [audience, rooms.length]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const quiz = await quizApi.create({
        topic: topic.trim(),
        count,
        audience,
        roomId: audience === 'room' ? roomId : undefined,
        facts: facts.trim() || undefined,
      });
      setTopic('');
      setFacts('');
      setOpen(false);
      onCreated(quiz);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nepodarilo sa vytvoriť kvíz');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-500 transition hover:border-accent/50 hover:text-accent dark:border-neutral-700"
      >
        ＋ Nový kvíz
      </button>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        maxLength={120}
        placeholder="Téma (napr. Staroveký Rím, Harry Potter…)"
        className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
      />
      <div className="flex flex-wrap gap-2">
        <select
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          {[3, 5, 8, 10].map((n) => (
            <option key={n} value={n}>{n} otázok</option>
          ))}
        </select>
        <select
          value={audience}
          onChange={(e) => setAudience(e.target.value as QuizAudience)}
          className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          {(Object.keys(QUIZ_AUDIENCE_LABELS) as QuizAudience[]).map((a) => (
            <option key={a} value={a}>{QUIZ_AUDIENCE_LABELS[a]}</option>
          ))}
        </select>
        {audience === 'room' && (
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">Vyber miestnosť…</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
        )}
      </div>
      <textarea
        value={facts}
        onChange={(e) => setFacts(e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder="Vlastné podklady (nepovinné) — napr. rodinné jubileá: „Dedko Jozef sa narodil 1950 v Nitre…“. LLM čerpá len z nich."
        className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy || topic.trim().length < 2 || (audience === 'room' && !roomId)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Zakladám…' : '✨ Vygenerovať kvíz'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
        >
          Zrušiť
        </button>
      </div>
    </section>
  );
}

// ── Položka zoznamu ──────────────────────────────────────────────────────────

const STATUS_BADGE: Record<QuizPublic['status'], { label: string; cls: string }> = {
  generating: { label: '⏳ Generuje sa…', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  draft: { label: '📝 Návrh na kontrolu', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  published: { label: '', cls: '' },
  failed: { label: '⚠️ Nepodarilo sa', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

function QuizListItem({
  quiz,
  meId,
  onChanged,
  onFlash,
}: {
  quiz: QuizPublic;
  meId: string;
  onChanged: () => void;
  onFlash: (msg: string) => void;
}) {
  const isAuthor = quiz.createdBy.id === meId;
  const [local, setLocal] = useState<QuizPublic>(quiz);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setLocal(quiz), [quiz]);

  const act = async (fn: () => Promise<unknown>, doneMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (doneMsg) onFlash(doneMsg);
      onChanged();
    } catch (err) {
      onFlash(err instanceof ApiError ? err.message : 'Nepodarilo sa');
    } finally {
      setBusy(false);
    }
  };

  const badge = STATUS_BADGE[local.status];

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">🧠 {local.title}</p>
          <p className="text-xs text-neutral-500">
            {QUIZ_AUDIENCE_LABELS[local.audience]} · od {local.createdBy.displayName.split(' ')[0]} ·{' '}
            {local.questionCount} otázok
          </p>
        </div>
        {badge.label && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
        )}
      </div>

      {/* Draft: review autora (human-in-the-loop) */}
      {isAuthor && local.status === 'draft' && (
        <div className="mt-3">
          {editing ? (
            <DraftEditor
              quiz={local}
              busy={busy}
              onSave={(questions) =>
                void act(async () => setLocal(await quizApi.update(local.id, { questions })), 'Uložené ✅').then(() =>
                  setEditing(false),
                )
              }
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <ul className="space-y-1">
                {(local.questions ?? []).map((q, i) => (
                  <li key={i} className="rounded-lg bg-neutral-50 px-2.5 py-1.5 text-sm dark:bg-neutral-800">
                    <p className="font-medium text-neutral-800 dark:text-neutral-100">{i + 1}. {q.q}</p>
                    <p className="text-xs text-green-600 dark:text-green-400">✓ {q.options[q.correct]}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => void act(() => quizApi.publish(local.id), 'Kvíz publikovaný 🎉')}
                  disabled={busy}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Publikovať
                </button>
                <button
                  onClick={() => setEditing(true)}
                  disabled={busy}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
                >
                  Upraviť otázky
                </button>
                <button
                  onClick={() => void act(() => quizApi.regenerate(local.id), 'Generujem znova…')}
                  disabled={busy}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
                >
                  🔄 Pregenerovať
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Failed: retry */}
      {isAuthor && local.status === 'failed' && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => void act(() => quizApi.regenerate(local.id), 'Skúšam znova…')}
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            🔄 Skúsiť znova
          </button>
        </div>
      )}

      {/* Published: hranie / výsledky priamo tu */}
      {local.status === 'published' && <QuizBody quiz={local} onUpdated={setLocal} />}

      {isAuthor && (
        <button
          onClick={() => window.confirm('Zmazať kvíz?') && void act(() => quizApi.remove(local.id), 'Zmazané')}
          disabled={busy}
          className="mt-2 text-xs text-neutral-400 transition hover:text-red-500"
        >
          Zmazať kvíz
        </button>
      )}
    </section>
  );
}

// ── Editor draftu ────────────────────────────────────────────────────────────

function DraftEditor({
  quiz,
  busy,
  onSave,
  onCancel,
}: {
  quiz: QuizPublic;
  busy: boolean;
  onSave: (questions: QuizQuestion[]) => void;
  onCancel: () => void;
}) {
  const [questions, setQuestions] = useState<QuizQuestion[]>(quiz.questions ?? []);

  const patch = (i: number, part: Partial<QuizQuestion>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...part } : q)));

  return (
    <div className="space-y-3">
      {questions.map((q, i) => (
        <div key={i} className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-700">
          <div className="flex items-start gap-2">
            <input
              value={q.q}
              onChange={(e) => patch(i, { q: e.target.value })}
              maxLength={500}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
            />
            <button
              onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
              disabled={questions.length <= 1}
              aria-label="Zmazať otázku"
              className="shrink-0 text-neutral-400 transition hover:text-red-500 disabled:opacity-30"
            >
              ✕
            </button>
          </div>
          <div className="mt-1.5 grid gap-1">
            {q.options.map((opt, oi) => (
              <label key={oi} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${quiz.id}-${i}`}
                  checked={q.correct === oi}
                  onChange={() => patch(i, { correct: oi })}
                  title="Správna odpoveď"
                />
                <input
                  value={opt}
                  onChange={(e) =>
                    patch(i, { options: q.options.map((o, j) => (j === oi ? e.target.value : o)) })
                  }
                  maxLength={200}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <button
          onClick={() => onSave(questions)}
          disabled={busy || questions.some((q) => !q.q.trim() || q.options.some((o) => !o.trim()))}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Uložiť
        </button>
        <button onClick={onCancel} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700">
          Zrušiť
        </button>
      </div>
    </div>
  );
}
