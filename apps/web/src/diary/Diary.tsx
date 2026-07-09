import { useEffect, useState } from 'react';
import {
  MOODS,
  NEWS_CATEGORIES,
  NEWS_CATEGORY_LABELS,
  type DiaryEntryPublic,
  type DiaryFragmentPublic,
  type DiarySearchResponse,
  type Mood,
  type NewsCategory,
  type NewsItemPublic as NewsTodayItem,
} from '@rodinna/shared-types';
import { ApiError, diaryApi, newsApi } from '../lib/api';
import { useChat } from '../chat/ChatProvider';
import { relativeTime } from '../shared/time';

/**
 * Modul Denník (M5, §15.2): quick capture fragmentov cez deň, nočný
 * (alebo na vyžiadanie) LLM draft, human-in-the-loop potvrdenie,
 * sémantické hľadanie v potvrdených zápisoch. Striktne súkromný —
 * server vracia výhradne vlastné dáta.
 */
export function Diary() {
  const { subscribe } = useChat();
  const [entries, setEntries] = useState<DiaryEntryPublic[] | null>(null);
  const [fragments, setFragments] = useState<DiaryFragmentPublic[]>([]);
  const [llm, setLlm] = useState<{ enabled: boolean } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  const refresh = () =>
    Promise.all([diaryApi.entries(), diaryApi.fragments()])
      .then(([e, f]) => {
        setEntries(e.entries);
        setFragments(f.fragments);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Načítanie denníka zlyhalo'));

  useEffect(() => {
    void refresh();
    void diaryApi.status().then(setLlm).catch(() => setLlm({ enabled: false }));
    const off = subscribe((e) => {
      if (e.t === 'diary:update') {
        void refresh();
        flash('Denník aktualizovaný ✍️');
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  const openEntry = entries?.find((e) => e.id === openId) ?? null;
  if (openEntry) {
    return (
      <EntryDetail
        entry={openEntry}
        onBack={() => {
          setOpenId(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <QuickCapture
        onAdded={(f) => setFragments((prev) => [f, ...prev])}
      />

      {fragments.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-sm font-semibold text-neutral-500">Dnešné poznámky</h3>
          <ul className="space-y-1">
            {fragments.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                {f.mood && <span>{f.mood}</span>}
                <span className="min-w-0 flex-1 truncate">{f.body || '(fotka)'}</span>
                <span className="shrink-0 text-xs text-neutral-400">{relativeTime(f.createdAt)}</span>
                <button
                  onClick={() =>
                    void diaryApi.removeFragment(f.id).then(() =>
                      setFragments((prev) => prev.filter((x) => x.id !== f.id)),
                    )
                  }
                  aria-label="Zmazať poznámku"
                  className="shrink-0 text-neutral-300 hover:text-red-500"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {llm?.enabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() =>
              void diaryApi
                .generate()
                .then(() => flash('Generujem zápis… prídе notifikácia ✍️'))
                .catch((err) => flash(err instanceof ApiError ? err.message : 'Nepodarilo sa'))
            }
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            ✍️ Vygenerovať dnešný zápis
          </button>
          <SearchBox />
        </div>
      ) : (
        llm && (
          <p className="rounded-xl bg-neutral-100 p-3 text-xs text-neutral-500 dark:bg-neutral-800">
            LLM nie je na serveri zapnuté (LLM_BASE_URL) — denník funguje ručne, generovanie
            a hľadanie sa zapnú s Ollamou na NAS-e.
          </p>
        )
      )}

      <WorldSection />

      <section>
        <h3 className="mb-1.5 text-sm font-semibold text-neutral-500">Zápisy</h3>
        {!entries && !error && <p className="py-4 text-sm text-neutral-500">Načítavam…</p>}
        {entries?.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-500">
            Zatiaľ žiadne zápisy. Píš si cez deň krátke poznámky — večer z nich vznikne návrh. 📖
          </p>
        )}
        <ul className="space-y-2">
          {entries?.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => setOpenId(e.id)}
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left transition hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {new Date(`${e.date}T12:00:00Z`).toLocaleDateString('sk-SK', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      e.status === 'draft'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    }`}
                  >
                    {e.status === 'draft' ? 'Návrh' : 'Potvrdené'}
                  </span>
                </span>
                <span className="mt-1 line-clamp-2 block text-sm text-neutral-500">{e.bodyMd}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-neutral-900">
          {toast}
        </div>
      )}
    </div>
  );
}

/**
 * Svet okolo (M7, §15.3): opt-in kategórie správ. Denník potom dostane
 * záverečný odsek „Svet okolo" z dnešných titulkov (len titulky + snippet,
 * rodinné dáta nikam neodchádzajú).
 */
function WorldSection() {
  const [cats, setCats] = useState<NewsCategory[] | null>(null);
  const [items, setItems] = useState<NewsTodayItem[]>([]);
  const [open, setOpen] = useState(false);

  const loadToday = () => void newsApi.today().then((r) => setItems(r.items)).catch(() => {});

  useEffect(() => {
    void newsApi
      .getPrefs()
      .then((r) => {
        setCats(r.categories);
        if (r.categories.length > 0) loadToday();
      })
      .catch(() => setCats([]));
  }, []);

  if (cats === null) return null;

  const toggle = async (c: NewsCategory) => {
    const next = cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c];
    setCats(next);
    const r = await newsApi.setPrefs(next);
    setCats(r.categories);
    loadToday();
  };

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-semibold">🌍 Svet okolo</span>
        <span className="text-xs text-neutral-400">
          {cats.length > 0 ? `${cats.length} kategórie · ` : 'vypnuté · '}
          {open ? 'skryť' : 'nastaviť'}
        </span>
      </button>
      {open && (
        <>
          <p className="mt-2 text-xs text-neutral-500">
            Vyber si kategórie — na záver denníka pribudne krátky odsek o dnešnom dianí.
            Sťahujú sa len titulky verejných správ, tvoje dáta nikam neodchádzajú.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {NEWS_CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => void toggle(c)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  cats.includes(c)
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300'
                }`}
              >
                {NEWS_CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </>
      )}
      {cats.length > 0 && items.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {items.slice(0, 5).map((it) => (
            <li key={it.id} className="text-sm">
              <a href={it.url} target="_blank" rel="noreferrer" className="hover:underline">
                <span className="font-medium">{it.title}</span>
              </a>
              <span className="ml-1 text-xs text-neutral-400">{it.source}</span>
            </li>
          ))}
        </ul>
      )}
      {cats.length > 0 && items.length === 0 && (
        <p className="mt-2 text-xs text-neutral-400">Titulky sa stiahnu pri najbližšom behu (2× denne).</p>
      )}
    </section>
  );
}

function QuickCapture({ onAdded }: { onAdded: (f: DiaryFragmentPublic) => void }) {
  const [body, setBody] = useState('');
  const [mood, setMood] = useState<Mood | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if ((!body.trim() && !mood) || busy) return;
    setBusy(true);
    try {
      const f = await diaryApi.addFragment({ body: body.trim(), mood });
      onAdded(f);
      setBody('');
      setMood(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          maxLength={2000}
          placeholder="Ako bolo dnes? (krátka poznámka)"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
        />
        <button
          onClick={() => void save()}
          disabled={(!body.trim() && !mood) || busy}
          className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Uložiť
        </button>
      </div>
      <div className="mt-2 flex gap-1">
        {MOODS.map((m) => (
          <button
            key={m}
            onClick={() => setMood(mood === m ? null : m)}
            aria-label={`Nálada ${m}`}
            className={`grid h-8 w-8 place-items-center rounded-full text-lg transition ${
              mood === m ? 'bg-accent/15 ring-1 ring-accent' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </section>
  );
}

function SearchBox() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DiarySearchResponse['results'] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (q.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      setResults((await diaryApi.search(q.trim())).results);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          placeholder="🔍 Spomínaš si? (napr. keď sme boli pri vode)"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
        />
      </div>
      {results && (
        <ul className="mt-2 space-y-1.5">
          {results.length === 0 && <li className="text-xs text-neutral-400">Nič som nenašiel.</li>}
          {results.map((r) => (
            <li key={r.id} className="rounded-xl border border-neutral-200 p-2.5 text-sm dark:border-neutral-800">
              <p className="mb-0.5 text-xs text-neutral-400">
                {new Date(`${r.date}T12:00:00Z`).toLocaleDateString('sk-SK')} ·{' '}
                {Math.round(r.similarity * 100)} % zhoda
              </p>
              <p className="line-clamp-2 text-neutral-600 dark:text-neutral-300">{r.bodyMd}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryDetail({ entry, onBack }: { entry: DiaryEntryPublic; onBack: () => void }) {
  const [body, setBody] = useState(entry.bodyMd);
  const [status, setStatus] = useState(entry.status);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (body.trim() === entry.bodyMd || busy) return;
    setBusy(true);
    try {
      await diaryApi.updateEntry(entry.id, body.trim());
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      if (body.trim() !== entry.bodyMd) await diaryApi.updateEntry(entry.id, body.trim());
      const e = await diaryApi.confirmEntry(entry.id);
      setStatus(e.status);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} aria-label="Späť na denník" className="grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold capitalize">
            {new Date(`${entry.date}T12:00:00Z`).toLocaleDateString('sk-SK', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </h2>
          <p className="text-xs text-neutral-500">
            {status === 'draft' ? 'Návrh — skontroluj a potvrď' : 'Potvrdený zápis'}
          </p>
        </div>
        <button
          onClick={() => {
            if (window.confirm('Zmazať tento zápis?')) {
              void diaryApi.removeEntry(entry.id).then(onBack);
            }
          }}
          aria-label="Zmazať zápis"
          className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
        >
          🗑
        </button>
      </div>

      {status === 'draft' && (
        <p className="mb-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Toto napísal pomocník z tvojich poznámok — uprav, čo nesedí, a potvrď. Nič sa nikam
          neposiela, denník vidíš len ty.
        </p>
      )}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={14}
        className="w-full resize-y rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm leading-relaxed outline-none focus:border-accent dark:border-neutral-800 dark:bg-neutral-900"
      />
      <div className="mt-2 flex items-center gap-2">
        {status === 'draft' ? (
          <button
            onClick={() => void confirm()}
            disabled={busy || !body.trim()}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            ✓ Potvrdiť zápis
          </button>
        ) : (
          <button
            onClick={() => void save()}
            disabled={busy || body.trim() === entry.bodyMd}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Uložiť
          </button>
        )}
      </div>
    </div>
  );
}
