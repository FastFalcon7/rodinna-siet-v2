/** Detekcia URL v texte — koncová interpunkcia sa do linku nepočíta. */
const URL_RE = /https?:\/\/[^\s<>]+/g;

function trimTrailingPunct(url: string): string {
  return url.replace(/[.,!?;:'")\]]+$/, '');
}

export function extractFirstUrl(text: string): string | null {
  URL_RE.lastIndex = 0;
  const m = URL_RE.exec(text);
  return m ? trimTrailingPunct(m[0]) : null;
}

/** Skrátený display tvar linku (Bluesky štýl): doména + orezaná cesta. */
export function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const display = `${u.hostname.replace(/^www\./, '')}${path}${u.search}`;
    return display.length > 40 ? `${display.slice(0, 37)}…` : display;
  } catch {
    return url.length > 40 ? `${url.slice(0, 37)}…` : url;
  }
}

/**
 * Text so zlinkovanými URL — plné URL sa zobrazujú skrátene (§3.3),
 * klik otvára originál v novom tabe.
 */
export function RichBody({
  text,
  className = '',
  linkClassName = 'underline decoration-1 underline-offset-2 hover:opacity-80',
}: {
  text: string;
  className?: string;
  linkClassName?: string;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  URL_RE.lastIndex = 0;
  for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
    const url = trimTrailingPunct(m[0]);
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a
        key={`${m.index}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        title={url}
        className={linkClassName}
        onClick={(e) => e.stopPropagation()}
      >
        {shortenUrl(url)}
      </a>,
    );
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return <p className={className}>{parts}</p>;
}
