import { useRef } from 'react';
import { useAutoGrow } from './useAutoGrow';

interface TitleInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Enter potvrdí (Shift+Enter je ignorovaný — názov je jednoriadkový obsahom, viacriadkový zobrazením). */
  onSubmit?: () => void;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Pole názvu (ladenie 07/2026): dlhý názov sa neschováva — pole vertikálne
 * rastie s textom (do ~25 % okna). Technicky textarea s rows=1; Enter
 * potvrdzuje ako v inpute.
 */
export function TitleInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  maxLength = 120,
  autoFocus,
  className = '',
}: TitleInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, value, 25);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmit?.();
        }
      }}
      rows={1}
      autoFocus={autoFocus}
      maxLength={maxLength}
      placeholder={placeholder}
      className={`resize-none rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700 ${className}`}
    />
  );
}
