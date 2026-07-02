import { useState } from 'react';
import { ALLOWED_REACTION_EMOJIS, type MessagePublic } from '@rodinna/shared-types';
import { chatApi } from '../lib/api';
import { formatTime } from './chatTime';

interface MessageBubbleProps {
  message: MessagePublic;
  mine: boolean;
  showAuthor: boolean;
  seen: boolean;
  onReply: (m: MessagePublic) => void;
  onEdit: (m: MessagePublic) => void;
}

/** Náhľad citovanej správy nad bublinou. */
function ReplyQuote({ message, mine }: { message: NonNullable<MessagePublic['replyTo']>; mine: boolean }) {
  return (
    <div
      className={`mb-1 rounded-lg border-l-2 px-2 py-1 text-xs ${
        mine ? 'border-white/60 bg-white/15 text-white/90' : 'border-accent bg-neutral-200/60 dark:bg-neutral-700/60'
      }`}
    >
      <span className="font-medium">{message.authorName}</span>
      <div className="truncate opacity-90">
        {message.deleted ? 'Správa bola zmazaná' : message.hasMedia && !message.preview ? '📷 Fotka' : message.preview}
      </div>
    </div>
  );
}

function MediaGrid({ message }: { message: MessagePublic }) {
  if (message.media.length === 0) return null;
  const cols = message.media.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
  return (
    <div className={`mt-1 grid ${cols} gap-1 overflow-hidden rounded-lg`}>
      {message.media.map((m) => (
        <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="block">
          <img
            src={m.url}
            alt=""
            loading="lazy"
            style={m.blurhash ? { backgroundColor: 'rgba(0,0,0,0.05)' } : undefined}
            className="max-h-72 w-full object-cover"
          />
        </a>
      ))}
    </div>
  );
}

export function MessageBubble({ message, mine, showAuthor, seen, onReply, onEdit }: MessageBubbleProps) {
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const react = async (emoji: string) => {
    if (busy) return;
    setBusy(true);
    setPicker(false);
    try {
      await chatApi.setReaction(message.id, emoji);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!confirm('Zmazať túto správu?')) return;
    await chatApi.deleteMessage(message.id);
  };

  if (message.deleted) {
    return (
      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <div className="max-w-[78%] rounded-2xl border border-dashed border-neutral-300 px-3 py-2 text-sm italic text-neutral-400 dark:border-neutral-700">
          Správa bola zmazaná
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative max-w-[78%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        {showAuthor && !mine && (
          <span className="mb-0.5 ml-1 text-xs font-medium text-accent">{message.author.displayName}</span>
        )}

        <div
          className={`relative rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
            mine
              ? 'rounded-br-md bg-accent text-white'
              : 'rounded-bl-md bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
          }`}
        >
          {message.replyTo && <ReplyQuote message={message.replyTo} mine={mine} />}
          {message.bodyMd && <p className="whitespace-pre-wrap break-words">{message.bodyMd}</p>}
          <MediaGrid message={message} />

          <span
            className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
              mine ? 'text-white/70' : 'text-neutral-400'
            }`}
          >
            {message.editedAt && <span>upravené</span>}
            {formatTime(message.createdAt)}
            {mine && <span title={seen ? 'Videné' : 'Doručené'}>{seen ? '✓✓' : '✓'}</span>}
          </span>
        </div>

        {message.reactions.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => react(r.emoji)}
                className={`rounded-full border px-1.5 py-0.5 text-xs transition ${
                  r.reactedByMe
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900'
                }`}
              >
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        )}

        {/* Hover akcie */}
        <div
          className={`absolute top-0 ${mine ? 'right-full mr-1' : 'left-full ml-1'} flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100`}
        >
          <button
            type="button"
            onClick={() => setPicker((p) => !p)}
            className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-xs hover:bg-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"
            title="Reagovať"
          >
            😊
          </button>
          <button
            type="button"
            onClick={() => onReply(message)}
            className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-xs hover:bg-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"
            title="Odpovedať"
          >
            ↩
          </button>
          {mine && (
            <>
              <button
                type="button"
                onClick={() => onEdit(message)}
                className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-xs hover:bg-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                title="Upraviť"
              >
                ✎
              </button>
              <button
                type="button"
                onClick={del}
                className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-xs hover:bg-red-200 dark:bg-neutral-700 dark:hover:bg-red-900"
                title="Zmazať"
              >
                🗑
              </button>
            </>
          )}
        </div>

        {picker && (
          <div
            className={`absolute z-20 ${mine ? 'right-0' : 'left-0'} -top-10 flex gap-1 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-900`}
          >
            {ALLOWED_REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => react(emoji)}
                className="rounded-lg px-1 py-0.5 text-lg transition hover:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
