import { useEffect, useRef, useState } from 'react';
import type { MediaPublic, MessagePublic } from '@rodinna/shared-types';
import { chatApi, mediaApi, ApiError } from '../lib/api';
import { useChat } from './ChatProvider';

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
  const [media, setMedia] = useState<MediaPublic[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingActive = useRef(false);
  const typingStop = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (editing) {
      setText(editing.bodyMd);
      taRef.current?.focus();
    }
  }, [editing]);

  // Autogrow textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [text]);

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

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const m = await mediaApi.upload(file);
        setMedia((cur) => (cur.length < 10 ? [...cur, m] : cur));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Nahranie zlyhalo');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    const body = text.trim();
    if (busy || uploading) return;
    if (!body && media.length === 0 && !editing) return;
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
          mediaIds: media.map((x) => x.id),
          replyToId: replyTo?.id ?? null,
        });
        onSent(m);
        onClearReply();
      }
      setText('');
      setMedia([]);
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
              {editing ? editing.bodyMd : replyTo!.bodyMd || (replyTo!.media.length ? '📷 Fotka' : '')}
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

      {media.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {media.map((m) => (
            <div key={m.id} className="relative">
              <img src={m.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => setMedia((cur) => cur.filter((x) => x.id !== m.id))}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-neutral-800 text-xs text-white"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mb-1 text-xs text-red-500">{error}</p>}

      <div className="flex items-end gap-2">
        {!editing && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="shrink-0 rounded-full p-2 text-xl text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
            title="Pridať fotku"
          >
            {uploading ? '…' : '📎'}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => pickFiles(e.target.files)}
        />
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
          className="max-h-40 flex-1 resize-none rounded-2xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700 dark:bg-neutral-800"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || uploading || (!text.trim() && media.length === 0 && !editing)}
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {editing ? 'Uložiť' : 'Poslať'}
        </button>
      </div>
    </div>
  );
}
