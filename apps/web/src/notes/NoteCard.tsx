import { useEffect, useState } from 'react';
import type { NoteDetail } from '@rodinna/shared-types';
import { notesApi } from '../lib/api';
import { appNavigate } from '../app/navigate';
import { useChat } from '../chat/ChatProvider';
import type { EntityCardProps } from '../app/cards';

/**
 * Živá karta zoznamu/poznámky v chate a feede (M3, K2 naplno): checkboxy
 * sa dajú odškrtávať PRIAMO v bubline — v obchode netreba otvárať modul.
 * Stav sa mení real-time cez WS event `note:update`.
 */

const CARD_ITEMS = 4;

export function NoteCard({ entityId, compact }: EntityCardProps) {
  const { subscribe } = useChat();
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      notesApi
        .get(entityId)
        .then((n) => alive && setNote(n))
        .catch(() => alive && setGone(true));
    void load();
    const off = subscribe((e) => {
      if (e.t === 'note:update' && e.noteId === entityId) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [entityId, subscribe]);

  if (gone) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">
        Zoznam už neexistuje.
      </div>
    );
  }
  if (!note) {
    return <div className="h-24 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  }

  const toggle = async (itemId: string, checked: boolean) => {
    if (busy) return;
    setBusy(itemId);
    try {
      setNote(await notesApi.updateItem(itemId, { checked: !checked }));
    } finally {
      setBusy(null);
    }
  };

  const shown = note.items.slice(0, CARD_ITEMS);
  const rest = note.items.length - shown.length;
  const pct = note.itemsTotal > 0 ? Math.round((note.itemsChecked / note.itemsTotal) * 100) : 0;

  return (
    <div
      className={`rounded-xl border border-black/10 bg-white text-left shadow-sm dark:border-white/10 dark:bg-neutral-900 ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => appNavigate({ module: 'notes', entityId })}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {note.kind === 'list' ? '✅' : '📝'} {note.title}
        </span>
        {note.kind === 'list' && (
          <span className="shrink-0 text-xs tabular-nums text-neutral-500">
            {note.itemsChecked}/{note.itemsTotal} ✓
          </span>
        )}
      </button>

      {note.kind === 'list' ? (
        <>
          {note.itemsTotal > 0 && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          )}
          <ul className="mt-1.5 space-y-1">
            {shown.map((item) => {
              const checked = item.checkedAt !== null;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => void toggle(item.id, checked)}
                    disabled={busy === item.id}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-50 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <span
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${
                        checked ? 'border-accent bg-accent text-white' : 'border-neutral-300 dark:border-neutral-600'
                      }`}
                    >
                      {checked && '✓'}
                    </span>
                    <span className={`min-w-0 truncate ${checked ? 'text-neutral-400 line-through' : ''}`}>
                      {item.label}
                    </span>
                    {item.assignedTo && (
                      <span className="ml-auto shrink-0 text-[10px] text-neutral-400">
                        {item.assignedTo.displayName.split(' ')[0]}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {rest > 0 && (
            <button
              onClick={() => appNavigate({ module: 'notes', entityId })}
              className="mt-1 text-xs text-accent hover:underline"
            >
              +{rest} ďalších — otvoriť
            </button>
          )}
        </>
      ) : (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-300">
          {note.bodyMd || '…'}
        </p>
      )}
    </div>
  );
}
