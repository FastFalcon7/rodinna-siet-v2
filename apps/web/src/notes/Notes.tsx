import { useEffect, useRef, useState } from 'react';
import type { NoteDetail, NoteRevision, NoteSummary } from '@rodinna/shared-types';
import { ApiError, chatApi, mediaApi, notesApi, usersApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useChat } from '../chat/ChatProvider';
import { consumePendingNav } from '../app/navigate';
import { buildAppLink } from '../shared/appLink';
import { relativeTime } from '../shared/time';
import { PhotoGallery } from '../shared/PhotoGallery';
import { useSwipeBack } from '../shared/useSwipeBack';
import { useAutoGrow } from '../shared/useAutoGrow';
import { NoteForm } from './NoteForm';

/**
 * Modul Zoznamy & Poznámky (M3): rodinne zdieľané zoznamy s odškrtávaním
 * v reálnom čase (kto odškrtol, komu priradené) a poznámky s históriou
 * verzií. Zoznam sa dá poslať do chatu ako živá karta (K2).
 */
export function Notes() {
  const { subscribe } = useChat();
  const [items, setItems] = useState<NoteSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => consumePendingNav('notes')?.entityId ?? null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    notesApi
      .list()
      .then((r) => setItems(r.notes))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Načítanie zlyhalo'));

  useEffect(() => {
    void refresh();
    const off = subscribe((e) => {
      if (e.t === 'note:update') void refresh();
    });
    return off;
  }, [subscribe]);

  if (openId) {
    return <NoteDetailView noteId={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="space-y-3 px-4 py-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <NewNoteButtons onCreated={(id) => setOpenId(id)} />

      {!items && !error && <p className="py-6 text-sm text-neutral-500">Načítavam…</p>}
      {items?.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-500">
          Zatiaľ nič. Založ nákupný zoznam — odškrtávať ho môže celá rodina naraz. ✅
        </p>
      )}

      <ul className="space-y-2">
        {items?.map((n) => (
          <li key={n.id}>
            <button
              onClick={() => setOpenId(n.id)}
              className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left transition hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {n.pinned && '📌 '}
                  {n.visibility === 'private' && '🔒 '}
                  {n.visibility === 'rooms' && '👥 '}
                  {n.kind === 'list' ? '✅' : '📝'} {n.title}
                </span>
                {n.kind === 'list' && (
                  <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                    {n.itemsChecked}/{n.itemsTotal}
                  </span>
                )}
              </span>
              {n.kind === 'list' && n.itemsTotal > 0 && (
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <span
                    className="block h-full bg-accent"
                    style={{ width: `${Math.round((n.itemsChecked / n.itemsTotal) * 100)}%` }}
                  />
                </span>
              )}
              <span className="mt-1 block text-xs text-neutral-400">
                {n.updatedBy ? `${n.updatedBy.displayName} · ` : ''}
                {relativeTime(n.updatedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewNoteButtons({ onCreated }: { onCreated: (id: string) => void }) {
  const [mode, setMode] = useState<'list' | 'note' | null>(null);

  if (!mode) {
    return (
      <div className="flex gap-2">
        <button
          onClick={() => setMode('list')}
          className="flex-1 rounded-2xl border border-dashed border-neutral-300 px-4 py-2.5 text-sm text-neutral-500 transition hover:border-accent hover:text-accent dark:border-neutral-700"
        >
          + Zoznam
        </button>
        <button
          onClick={() => setMode('note')}
          className="flex-1 rounded-2xl border border-dashed border-neutral-300 px-4 py-2.5 text-sm text-neutral-500 transition hover:border-accent hover:text-accent dark:border-neutral-700"
        >
          + Poznámka
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <NoteForm
        initialKind={mode}
        submitLabel="Vytvoriť"
        busyLabel="Vytváram…"
        onDone={(n) => {
          setMode(null);
          onCreated(n.id);
        }}
        onCancel={() => setMode(null)}
      />
    </div>
  );
}

function NoteDetailView({ noteId, onBack }: { noteId: string; onBack: () => void }) {
  const { user } = useAuth();
  const { subscribe, rooms } = useChat();
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [body, setBody] = useState<string | null>(null); // lokálny draft textu poznámky
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [members, setMembers] = useState<{ id: string; displayName: string }[]>([]);
  const [sharePick, setSharePick] = useState(false);
  const [revisions, setRevisions] = useState<NoteRevision[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [locating, setLocating] = useState(false);
  // Jednotná editácia (7B): ⋯ menu → NoteForm, ako pri udalostiach/albumoch.
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(bodyRef, body ?? '', 60);
  const swipeBack = useSwipeBack(onBack);

  const load = () =>
    notesApi
      .get(noteId)
      .then((n) => {
        setNote(n);
        setBody((cur) => cur ?? n.bodyMd);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Načítanie zlyhalo'));

  useEffect(() => {
    void load();
    const off = subscribe((e) => {
      if (e.t === 'note:update' && e.noteId === noteId) void load();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, subscribe]);

  useEffect(() => {
    void usersApi.list().then((r) => setMembers(r.users.map((u) => ({ id: u.id, displayName: u.displayName }))));
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  if (error) {
    return (
      <div className="px-4 py-4">
        <button onClick={onBack} className="mb-3 text-sm text-accent">← Zoznamy</button>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!note) return <p className="px-4 py-6 text-sm text-neutral-500">Načítavam…</p>;

  const isOwner = user ? note.createdBy.id === user.id || user.role === 'admin' : false;

  const addItem = async () => {
    const label = newItem.trim();
    if (!label) return;
    setNewItem('');
    setNote(await notesApi.addItem(noteId, label));
  };

  const shareTo = async (roomId: string) => {
    setSharePick(false);
    // Zdieľanie do miestnosti: súkromná → 'rooms' s touto miestnosťou;
    // pri 'rooms' sa miestnosť pridá; rodinná ostáva rodinnou.
    if (note && note.createdBy.id === user?.id && note.visibility !== 'family') {
      const nextRooms = [...new Set([...(note.roomIds ?? []), roomId])];
      setNote(await notesApi.update(noteId, { visibility: 'rooms', roomIds: nextRooms }));
      flash('Poslané do chatu ✓ (vidí ju táto skupina)');
    } else {
      flash('Poslané do chatu ✓');
    }
    await chatApi.sendMessage(roomId, { bodyMd: buildAppLink('notes', noteId), mediaIds: [] });
  };

  const saveBody = async () => {
    if (body === null) return;
    if (body !== note.bodyMd) setNote(await notesApi.update(noteId, { bodyMd: body }));
    flash('Uložené ✓');
  };

  const uploadMedia = async (files: File[]) => {
    if (files.length === 0) return;
    setUploadingMedia(true);
    try {
      const ids: string[] = [];
      for (const f of files) ids.push((await mediaApi.upload(f)).id);
      setNote(await notesApi.addMedia(noteId, ids));
      flash('Prílohy pridané ✓');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nahrávanie zlyhalo');
    } finally {
      setUploadingMedia(false);
    }
  };

  /** 📍 Poloha: do poznámky ako riadok textu, do zoznamu ako položka. */
  const insertLocation = () => {
    if (!navigator.geolocation) {
      flash('Zariadenie nepodporuje polohu');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        const text = `📍 Poloha: https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
        if (note.kind === 'note') {
          setBody((cur) => (cur?.trim() ? `${cur}\n${text}` : text));
          flash('Poloha vložená — nezabudni Uložiť');
        } else {
          void notesApi.addItem(noteId, text).then(setNote);
        }
      },
      () => {
        setLocating(false);
        flash('Polohu sa nepodarilo zistiť');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const noteImages = note.media.filter((m) => m.kind === 'image');
  const isAuthor = user ? note.createdBy.id === user.id : false;

  // Jednotná editácia (7B): rovnaký formulár ako tvorba (názov, fotky,
  // viditeľnosť) — text/položky sa ďalej upravujú priamo v detaile.
  if (editing) {
    return (
      <div className="px-4 py-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <NoteForm
            note={note}
            canEditVisibility={isAuthor}
            submitLabel="Uložiť"
            busyLabel="Ukladám…"
            onDone={(n) => {
              setNote(n);
              setEditing(false);
              flash('Uložené ✓');
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4" {...swipeBack}>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} aria-label="Späť na zoznamy" className="grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">
            {note.visibility === 'private' ? '🔒 ' : note.visibility === 'rooms' ? '👥 ' : ''}
            {note.kind === 'list' ? '✅' : '📝'} {note.title}
          </h2>
          <p className="text-xs text-neutral-500">
            {note.updatedBy ? `naposledy ${note.updatedBy.displayName} · ` : ''}
            {relativeTime(note.updatedAt)}
          </p>
        </div>
        <button
          onClick={() => void notesApi.update(noteId, { pinned: !note.pinned }).then(setNote)}
          title={note.pinned ? 'Odopnúť' : 'Pripnúť hore'}
          className={`shrink-0 rounded-lg px-2 py-1.5 text-sm ${note.pinned ? '' : 'opacity-40'}`}
        >
          📌
        </button>
        <button
          onClick={() => setSharePick(true)}
          title="Poslať do chatu"
          className="shrink-0 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          💬 Zdieľať
        </button>
        {/* ⋯ menu — rovnaké ako na karte udalosti (7B): Upraviť / Duplikovať / Zmazať. */}
        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Možnosti"
            className="grid h-8 w-8 place-items-center rounded-full text-lg leading-none text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-800">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setEditing(true);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  Upraviť
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void notesApi.duplicate(noteId).then((n) => {
                      flash(`Kópia „${n.title}" vytvorená ✓`);
                    });
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  Duplikovať (šablóna)
                </button>
                {isOwner && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      if (confirm('Zmazať tento zoznam/poznámku?')) {
                        void notesApi.remove(noteId).then(onBack);
                      }
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  >
                    Zmazať
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fotky poznámky (ladenie 07/2026) + pridávanie príloh a polohy. */}
      {noteImages.length > 0 && (
        <div className="mb-3">
          <PhotoGallery
            images={noteImages}
            onRemove={async (ids) => {
              for (const id of ids) await notesApi.removeMedia(noteId, id).catch(() => {});
              void load();
            }}
          />
        </div>
      )}
      <div className="mb-3 flex gap-2 text-sm">
        <button
          onClick={() => mediaFileRef.current?.click()}
          disabled={uploadingMedia}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-500 transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-neutral-700"
        >
          {uploadingMedia ? 'Nahrávam…' : '📎 Príloha'}
        </button>
        <button
          onClick={insertLocation}
          disabled={locating}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-500 transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-neutral-700"
        >
          {locating ? 'Zisťujem…' : '📍 Poloha'}
        </button>
      </div>
      <input
        ref={mediaFileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void uploadMedia(files);
        }}
      />

      {note.kind === 'list' ? (
        <>
          <div className="mb-3 flex gap-2">
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addItem()}
              placeholder="Pridať položku…"
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
            />
            <button
              onClick={() => void addItem()}
              disabled={!newItem.trim()}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              +
            </button>
          </div>

          <ul className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {note.items.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-neutral-400">Zoznam je prázdny.</li>
            )}
            {note.items.map((item) => {
              const checked = item.checkedAt !== null;
              return (
                <li key={item.id} className="flex items-center gap-2.5 px-3 py-2">
                  <button
                    onClick={() => void notesApi.updateItem(item.id, { checked: !checked }).then(setNote)}
                    aria-label={checked ? 'Odškrtnuté' : 'Odškrtnúť'}
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded border text-xs transition ${
                      checked ? 'border-accent bg-accent text-white' : 'border-neutral-300 dark:border-neutral-600'
                    }`}
                  >
                    {checked && '✓'}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${checked ? 'text-neutral-400 line-through' : ''}`}>
                      {item.label}
                    </p>
                    <p className="text-[11px] text-neutral-400">
                      {checked && item.checkedBy ? `✓ ${item.checkedBy.displayName}` : ''}
                      {item.assignedTo ? `${checked ? ' · ' : ''}pre: ${item.assignedTo.displayName}` : ''}
                    </p>
                  </div>
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setAssignFor(assignFor === item.id ? null : item.id)}
                      title="Priradiť členovi"
                      className="rounded px-1.5 py-1 text-sm text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      👤
                    </button>
                    {assignFor === item.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setAssignFor(null)} />
                        <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                          {members.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setAssignFor(null);
                                void notesApi.updateItem(item.id, { assignedTo: m.id }).then(setNote);
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              {m.displayName}
                            </button>
                          ))}
                          {item.assignedTo && (
                            <button
                              onClick={() => {
                                setAssignFor(null);
                                void notesApi.updateItem(item.id, { assignedTo: null }).then(setNote);
                              }}
                              className="block w-full border-t border-neutral-200 px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                            >
                              Zrušiť priradenie
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => void notesApi.removeItem(item.id).then(setNote)}
                    aria-label="Zmazať položku"
                    className="shrink-0 rounded px-1.5 py-1 text-sm text-neutral-300 hover:text-red-500"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <textarea
            ref={bodyRef}
            value={body ?? ''}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Píš sem…"
            className="min-h-40 w-full resize-none rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm leading-relaxed outline-none focus:border-accent dark:border-neutral-800 dark:bg-neutral-900"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => void saveBody()}
              disabled={body === null}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Uložiť
            </button>
            {note.revisionCount > 0 && (
              <button
                onClick={() =>
                  revisions ? setRevisions(null) : void notesApi.revisions(noteId).then((r) => setRevisions(r.revisions))
                }
                className="text-sm text-neutral-500 underline underline-offset-2"
              >
                {revisions ? 'Skryť verzie' : `Verzie (${note.revisionCount})`}
              </button>
            )}
          </div>
          {revisions && (
            <ul className="mt-2 space-y-1.5">
              {revisions.map((r) => (
                <li key={r.id} className="rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
                    <span>
                      {r.savedBy?.displayName ?? '—'} · {relativeTime(r.savedAt)}
                    </span>
                    <button
                      onClick={() =>
                        void notesApi.restore(noteId, r.id).then((n) => {
                          setNote(n);
                          setBody(n.bodyMd);
                          setRevisions(null);
                          flash('Verzia obnovená ✓');
                        })
                      }
                      className="text-accent hover:underline"
                    >
                      Obnoviť
                    </button>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-neutral-500">{r.bodyMd}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {sharePick && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => setSharePick(false)}>
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 font-semibold">Poslať do chatu</h3>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {rooms.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => void shareTo(r.id)}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {r.kind === 'dm'
                      ? r.members.find((m) => m.id !== user?.id)?.displayName ?? 'DM'
                      : r.title ?? 'Rodina'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-neutral-900">
          {toast}
        </div>
      )}
    </div>
  );
}
