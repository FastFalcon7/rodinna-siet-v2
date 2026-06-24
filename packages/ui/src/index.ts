// Design system tokens (TS prístup k hodnotám). CSS premenné sú v tokens.css.
// Smer: "Calm iMessage + Linear sharp" (ARCHITECTURE_V2.md §10).

export const themes = ['light', 'dark'] as const;
export type Theme = (typeof themes)[number];

/** Názvy CSS premenných, aby ich TS kód vedel referencovať bez magic stringov. */
export const cssVar = {
  bg: 'var(--color-bg)',
  surface: 'var(--color-surface)',
  text: 'var(--color-text)',
  textMuted: 'var(--color-text-muted)',
  accent: 'var(--color-accent)',
  accentTeal: 'var(--color-accent-teal)',
  border: 'var(--color-border)',
} as const;
