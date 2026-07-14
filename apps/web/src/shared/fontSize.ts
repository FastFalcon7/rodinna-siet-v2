/**
 * Veľkosť písma (ladenie 07/2026): voľba žije v localStorage, aplikuje sa
 * ako data-font-size="normal|large|xlarge" na <html> — na to je naviazaný
 * root font-size v styles.css, takže sa harmonicky prispôsobí text aj
 * odsadenia (rem jednotky) v celej appke. Prvotné nastavenie pred paint-om
 * rieši inline skript v index.html (žiadny blik).
 */

export type FontSizeMode = 'normal' | 'large' | 'xlarge';

const KEY = 'rs-font-size';

export function getFontSizeMode(): FontSizeMode {
  const v = localStorage.getItem(KEY);
  return v === 'large' || v === 'xlarge' ? v : 'normal';
}

export function setFontSizeMode(mode: FontSizeMode): void {
  if (mode === 'normal') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, mode);
  document.documentElement.dataset.fontSize = mode;
}

/** Volá sa raz pri štarte appky (main.tsx). */
export function initFontSize(): void {
  document.documentElement.dataset.fontSize = getFontSizeMode();
}
