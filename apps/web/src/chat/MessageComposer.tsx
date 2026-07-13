import { useEffect, useRef, useState } from 'react';
import type { MessagePublic } from '@rodinna/shared-types';
import { chatApi, ApiError, gamesApi } from '../lib/api';
import { useChat } from './ChatProvider';
import { AttachmentSheet } from '../shared/AttachmentSheet';
import { UploadPreviews } from '../shared/UploadPreviews';
import { useMediaUpload } from '../shared/useMediaUpload';
import { buildAppLink } from '../shared/appLink';
import { useAutoGrow } from '../shared/useAutoGrow';
import { PollComposerDialog } from '../polls/PollComposerDialog';
import { EventComposerDialog } from '../events/EventComposerDialog';
import { NoteComposerDialog } from '../notes/NoteComposerDialog';

interface MessageComposerProps {
  roomId: string;
  replyTo: MessagePublic | null;
  editing: MessagePublic | null;
  onClearReply: () => void;
  onClearEdit: () => void;
  onSent: (m: MessagePublic) => void;
}

export function MessageComposer({
  roomId,
  replyTo,
  editing,
  onClearReply,
  onClearEdit,
  onSent,
}: MessageComposerProps) {
  const { sendTyping } = useChat();
  const [text, setText] = useState('');
  const uploads = useMediaUpload(10);
  const [sheet, setSheet] = useState(false);
  const [pollDialog, setPollDialog] = useState(false);
  const [eventDialog, setEventDialog] = useState(false);
  const [noteDialog, setNoteDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const typingActive = useRef(false);
  const typingStop = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (editing) {
      setText(editing.bodyMd);
      taRef.current?.focus();
    }
  }, [editing]);

  // Autogrow textarea — strop 40 % výšky okna (ladenie 07/2026).
  useAutoGrow(taRef, text, 40);

  const emitTyping = () => {
    if (editing) return;
    if (!typingActive.current) {
      typingActive.current = true;
      sendTyping(roomId, 'start');
    }
    clearTimeout(typingStop.current);
    typingStop.current = setTimeout(stopTyping, 2500);
  };
  const stopTyping = () => {
    if (typingActive.current) {
      typingActive.current = false;
      sendTyping(roomId, 'stop');
    }
    clearTimeout(typingStop.current);
  };

  // Pri prepnutí miestnosti zhasni typing.
  useEffect(() => () => stopTyping(), [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const body = text.trim();
    if (busy || uploads.uploading) return;
    if (!body && uploads.mediaIds.length === 0 && !editing) return;
    setBusy(true);
    setError(null);
    stopTyping();
    try {
      if (editing) {
        const m = await chatApi.editMessage(editing.id, body);
        onSent(m);
        onClearEdit();
      } else {
        const m = await chatApi.sendMessage(roomId, {
          bodyMd: body,
          mediaIds: uploads.mediaIds,
          replyToId: replyTo?.id ?? null,
        });
        onSent(m);
        onClearReply();
      }
      setText('');
      uploads.clear();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Odoslanie zlyhalo');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') {
      if (editing) onClearEdit();
      if (replyTo) onClearReply();
    }
  };

  /** Poloha zo sheetu sa vloží do textu — užívateľ môže dopísať poznámku. */
  const insertLocation = (locText: string) => {
    setText((cur) => (cur.trim() ? `${cur}\n${locText}` : locText));
    taRef.current?.focus();
  };

  return (
    <div
      className="border-t border-neutral-200 bg-white px-3 pt-2 dark:border-neutral-800 dark:bg-neutral-900"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {(replyTo || editing) && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-accent bg-neutral-100 px-2 py-1 text-sm dark:bg-neutral-800">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-accent">
              {editing ? 'Úprava správy' : `Odpoveď pre ${replyTo!.author.displayName}`}
            </div>
            <div className="truncate text-neutral-500">
              {editing ? editing.bodyMd : replyTo!.bodyMd || (replyTo!.media.length ? '📎 Príloha' : '')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => (editing ? onClearEdit() : onClearReply())}
            className="shrink-0 rounded-full px-2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>
      )}

      {uploads.items.length > 0 && (
        <div className="mb-2">
          <UploadPreviews items={uploads.items} onRemove={uploads.remove} onMakeCover={uploads.makeFirst} />
        </div>
      )}

      {error && <p className="mb-1 text-xs text-red-500">{error}</p>}

      <div className="flex items-end gap-2">
        {!editing && (
          <button
            type="button"
            onClick={() => setSheet(true)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="Pridať prílohu"
            aria-label="Pridať prílohu"
          >
            +
          </button>
        )}
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            emitTyping();
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Napíš správu…"
          className="flex-1 resize-none rounded-2xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700 dark:bg-neutral-800"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || uploads.uploading || (!text.trim() && uploads.mediaIds.length === 0 && !editing)}
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {editing ? 'Uložiť' : 'Poslať'}
        </button>
      </div>

      {sheet && (
        <AttachmentSheet
          onFiles={uploads.addFiles}
          onLocation={insertLocation}
          onPoll={() => setPollDialog(true)}
          onGame={() => {
            setSheet(false);
            // Piškvorky proti človeku: založ výzvu a pošli živú kartu do miestnosti (K2).
            void gamesApi
              .createTictactoe(roomId)
              .then((g) => chatApi.sendMessage(roomId, { bodyMd: buildAppLink('games', g.id), mediaIds: [] }))
              .then(onSent)
              .catch(() => setError('Piškvorky sa nepodarilo založiť'));
          }}
          onEvent={() => setEventDialog(true)}
          onNote={() => setNoteDialog(true)}
          onClose={() => setSheet(false)}
        />
      )}
      {noteDialog && (
        <NoteComposerDialog
          roomId={roomId}
          onCreated={(note) => {
            setNoteDialog(false);
            // Zoznam/poznámka ide do miestnosti ako živá karta (K2).
            void chatApi
              .sendMessage(roomId, { bodyMd: buildAppLink('notes', note.id), mediaIds: [] })
              .then(onSent)
              .catch(() => setError('Zoznam sa nepodarilo poslať do chatu'));
          }}
          onClose={() => setNoteDialog(false)}
        />
      )}
      {pollDialog && (
        <PollComposerDialog
          toFeed={false}
          onCreated={(poll) => {
            setPollDialog(false);
            // Anketa sa do miestnosti pošle ako app:// správa → živá karta (K2).
            void chatApi
              .sendMessage(roomId, { bodyMd: buildAppLink('polls', poll.id), mediaIds: [] })
              .then(onSent)
              .catch(() => setError('Anketu sa nepodarilo poslať do chatu'));
          }}
          onClose={() => setPollDialog(false)}
        />
      )}
      {eventDialog && (
        <EventComposerDialog
          roomId={roomId}
          onCreated={(event) => {
            setEventDialog(false);
            // Udalosť sa do miestnosti pošle ako app:// správa → RSVP karta (K2),
            // bez toFeed karty vo Feede (tam ju vidí len táto miestnosť).
            void chatApi
              .sendMessage(roomId, { bodyMd: buildAppLink('events', event.id), mediaIds: [] })
              .then(onSent)
              .catch(() => setError('Udalosť sa nepodarilo poslať do chatu'));
          }}
          onClose={() => setEventDialog(false)}
        />
      )}
    </div>
  );
}
