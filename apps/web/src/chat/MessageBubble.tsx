import { useState } from 'react';
import { ALLOWED_REACTION_EMOJIS, type MessagePublic } from '@rodinna/shared-types';
import { chatApi } from '../lib/api';
import { MediaItem } from '../shared/MediaItem';
import { nameStyle } from '../shared/nameColor';
import { PhotoGallery } from '../shared/PhotoGallery';
import { LinkPreviewCard } from '../shared/LinkPreviewCard';
import { extractFirstUrl, RichBody } from '../shared/linkify';
import { parseAppLink, stripAppLink } from '../shared/appLink';
import { EntityCard } from '../app/cards';
import { useLongPress } from '../shared/useLongPress';
import { useSwipeReply } from '../shared/useSwipeReply';
import { formatTime } from './chatTime';

interface MessageBubbleProps {
  message: MessagePublic;
  mine: boolean;
  showAuthor: boolean;
  seen: boolean;
  /** Posledná správa skupiny (zoskupovanie §4.1) — len tá má chvost a čas. */
  tail: boolean;
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
  // Úvodná fotka + „+N fotiek" badge (PhotoGallery); video a súbory na plnú šírku.
  const images = message.media.filter((m) => m.kind === 'image');
  const rest = message.media.filter((m) => m.kind !== 'image');
  return (
    <div className="mt-1 space-y-1">
      <PhotoGallery images={images} compact />
      {rest.map((m) => (
        <MediaItem key={m.id} media={m} className="max-h-72" />
      ))}
    </div>
  );
}

export function MessageBubble({ message, mine, showAuthor, seen, tail, onReply, onEdit }: MessageBubbleProps) {
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  // Na dotykových zariadeniach hover akcie neexistujú — long-press na bublinu
  // otvorí picker s reakciami + akciami (WhatsApp pattern).
  const longPress = useLongPress(() => setPicker(true));
  const swipe = useSwipeReply(() => onReply(message));
  // Živá karta (app:// link, §M0-4) má prednosť pred OG preview.
  const appLink = parseAppLink(message.bodyMd);
  const bodyText = appLink ? stripAppLink(message.bodyMd, appLink) : message.bodyMd;
  const previewUrl =
    message.media.length === 0 && !appLink ? extractFirstUrl(message.bodyMd) : null;

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
        <div className="min-w-0 max-w-[min(78%,32rem)] rounded-2xl border border-dashed border-neutral-300 px-3 py-2 text-sm italic text-neutral-400 dark:border-neutral-700">
          Správa bola zmazaná
        </div>
      </div>
    );
  }

  return (
    <div
      {...swipe.handlers}
      className={`group relative flex ${mine ? 'justify-end' : 'justify-start'}`}
      style={{ touchAction: 'pan-y' }}
    >
      {/* Swipe-to-reply indikátor (viditeľný počas ťahu). */}
      {swipe.dx > 0 && (
        <span
          className="absolute left-1 top-1/2 -translate-y-1/2 text-lg text-neutral-400"
          style={{ opacity: Math.min(swipe.dx / 56, 1) }}
        >
          ↩
        </span>
      )}
      {/* min-w-0 + overflow-wrap:anywhere: dlhé URL bez medzier inak roztiahnu
          flex item nad šírku kontajnera (break-word min-content nezmenšuje). */}
      <div
        className={`relative min-w-0 max-w-[min(78%,32rem)] ${mine ? 'items-end' : 'items-start'} flex flex-col`}
        style={swipe.dx > 0 ? { transform: `translateX(${swipe.dx * 0.9}px)`, transition: 'none' } : { transition: 'transform 150ms' }}
      >
        {showAuthor && !mine && (
          <span className="mb-0.5 ml-1 text-xs font-medium text-accent" style={nameStyle(message.author)}>
            {message.author.displayName}
          </span>
        )}

        <div
          {...longPress}
          className={`relative rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
            mine
              ? `${tail ? 'rounded-br-md' : ''} bg-accent text-white`
              : `${tail ? 'rounded-bl-md' : ''} bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100`
          }`}
        >
          {message.replyTo && <ReplyQuote message={message.replyTo} mine={mine} />}
          {bodyText && (
            <RichBody
              text={bodyText}
              className="whitespace-pre-wrap [overflow-wrap:anywhere]"
              linkClassName={`underline decoration-1 underline-offset-2 hover:opacity-80 ${
                mine ? 'text-white' : 'text-accent'
              }`}
            />
          )}
          {appLink && (
            <div className={bodyText ? 'mt-1.5' : ''}>
              <EntityCard module={appLink.module} entityId={appLink.entityId} compact />
            </div>
          )}
          {previewUrl && (
            <div className="mt-1.5">
              <LinkPreviewCard url={previewUrl} compact />
            </div>
          )}
          <MediaGrid message={message} />

          {/* Čas + doručenky len na poslednej správe skupiny (§4.1). */}
          {tail && (
            <span
              className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                mine ? 'text-white/70' : 'text-neutral-400'
              }`}
            >
              {message.editedAt && <span>upravené</span>}
              {formatTime(message.createdAt)}
              {mine && <span title={seen ? 'Videné' : 'Doručené'}>{seen ? '✓✓' : '✓'}</span>}
            </span>
          )}
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
          <>
            {/* Klik mimo zavrie picker (dôležité pre touch). */}
            <div className="fixed inset-0 z-10" onClick={() => setPicker(false)} />
            <div
              className={`absolute z-20 ${mine ? 'right-0' : 'left-0'} bottom-full mb-1 w-max rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-900`}
            >
              <div className="flex gap-1">
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
              <div className="mt-1 flex gap-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => {
                    setPicker(false);
                    onReply(message);
                  }}
                  className="flex-1 rounded-lg px-2 py-1 text-xs text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  ↩ Odpovedať
                </button>
                {mine && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setPicker(false);
                        onEdit(message);
                      }}
                      className="flex-1 rounded-lg px-2 py-1 text-xs text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      ✎ Upraviť
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPicker(false);
                        void del();
                      }}
                      className="flex-1 rounded-lg px-2 py-1 text-xs text-red-600 transition hover:bg-red-50 dark:hover:bg-red-950"
                    >
                      🗑 Zmazať
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
