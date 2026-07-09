import { useEffect, useState } from 'react';
import type { QuizPublic } from '@rodinna/shared-types';
import { ApiError, quizApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useChat } from '../chat/ChatProvider';
import type { EntityCardProps } from '../app/cards';

/**
 * Živá karta kvízu (M8): hranie priamo v karte (Feed aj chat bublina) —
 * stepper otázka po otázke, odpovede lokálne, odoslanie naraz (skóre počíta
 * server). Po dohraní skóre + rebríček; live cez WS quiz:update.
 */
export function QuizCard({ entityId, compact }: EntityCardProps) {
  const { user } = useAuth();
  const { subscribe } = useChat();
  const [quiz, setQuiz] = useState<QuizPublic | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      quizApi
        .get(entityId)
        .then((q) => alive && setQuiz(q))
        .catch(() => alive && setGone(true));
    void load();
    const off = subscribe((e) => {
      if (e.t === 'quiz:update' && e.quizId === entityId) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [entityId, subscribe]);

  if (gone) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">
        Kvíz už neexistuje.
      </div>
    );
  }
  if (!quiz || !user) {
    return <div className="h-28 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  }

  return (
    <div
      className={`rounded-xl border border-black/10 bg-white text-left shadow-sm dark:border-white/10 dark:bg-neutral-900 ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        🧠 Kvíz · {quiz.title}
      </p>
      <p className="mt-0.5 text-xs text-neutral-500">
        od {quiz.createdBy.displayName.split(' ')[0]} · {quiz.questionCount} otázok
      </p>
      <QuizBody quiz={quiz} onUpdated={setQuiz} />
    </div>
  );
}

/** Telo karty — zdieľané s modulom Kvízy (hranie v detaile). */
export function QuizBody({ quiz, onUpdated }: { quiz: QuizPublic; onUpdated: (q: QuizPublic) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (quiz.status !== 'published') {
    return <p className="mt-2 text-xs text-neutral-400">Kvíz ešte nie je publikovaný.</p>;
  }

  // Už dohrané → skóre + rebríček + správne odpovede pre moje chyby.
  if (quiz.myScore !== null) {
    return (
      <div className="mt-2">
        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
          Tvoje skóre: {quiz.myScore}/{quiz.questionCount}{' '}
          {quiz.myScore === quiz.questionCount ? '🏆' : quiz.myScore >= quiz.questionCount / 2 ? '👏' : '😅'}
        </p>
        {quiz.questions && quiz.myAnswers && (
          <MyMistakes questions={quiz.questions} myAnswers={quiz.myAnswers} />
        )}
        {(quiz.results?.length ?? 0) > 0 && (
          <ul className="mt-2 space-y-1">
            {quiz.results!.map((res, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-lg bg-neutral-50 px-2.5 py-1.5 text-sm dark:bg-neutral-800"
              >
                <span className="font-medium text-neutral-800 dark:text-neutral-100">
                  {i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''}
                  {res.author.displayName.split(' ')[0]}
                </span>
                <span className="text-neutral-600 dark:text-neutral-300">
                  {res.score}/{res.total}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const questions = quiz.playQuestions ?? quiz.questions ?? [];
  if (questions.length === 0) return null;
  const idx = picked.length;
  const q = questions[idx];

  const submit = async (answers: number[]) => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await quizApi.answer(quiz.id, answers));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nepodarilo sa odoslať');
      setPicked([]);
    } finally {
      setBusy(false);
    }
  };

  const pick = (optionIdx: number) => {
    const next = [...picked, optionIdx];
    if (next.length === questions.length) void submit(next);
    else setPicked(next);
  };

  return (
    <div className="mt-2">
      {q ? (
        <>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs text-neutral-400">
              Otázka {idx + 1}/{questions.length}
            </p>
            {(quiz.results === null || quiz.results.length === 0) && idx === 0 && (
              <p className="text-xs text-neutral-400">Výsledky uvidíš po dohraní 😉</p>
            )}
          </div>
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{q.q}</p>
          <div className="mt-1.5 grid gap-1.5">
            {q.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => !busy && pick(i)}
                disabled={busy}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-left text-sm text-neutral-800 transition hover:border-accent/50 hover:bg-accent/5 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-accent/10"
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-neutral-500">{busy ? 'Vyhodnocujem…' : ''}</p>
      )}
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}

/** Po dohraní: moje chybné otázky so správnou odpoveďou (učenie sa). */
function MyMistakes({
  questions,
  myAnswers,
}: {
  questions: NonNullable<QuizPublic['questions']>;
  myAnswers: number[];
}) {
  const wrong = questions
    .map((q, i) => ({ q, mine: myAnswers[i]! }))
    .filter(({ q, mine }) => q.correct !== mine);
  if (wrong.length === 0) return null;
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-xs text-neutral-500">
        Kde si sa pomýlil/a ({wrong.length})
      </summary>
      <ul className="mt-1 space-y-1">
        {wrong.map(({ q, mine }, i) => (
          <li key={i} className="rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs dark:bg-neutral-800">
            <p className="font-medium text-neutral-800 dark:text-neutral-100">{q.q}</p>
            <p className="text-red-500 line-through">{q.options[mine]}</p>
            <p className="text-green-600 dark:text-green-400">✓ {q.options[q.correct]}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
