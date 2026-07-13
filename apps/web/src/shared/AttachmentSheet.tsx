import { useRef, useState } from 'react';

interface AttachmentSheetProps {
  onFiles: (files: File[]) => void;
  /** Ak je zadané, sheet ponúkne „Poloha" — vráti text s odkazom na mapu. */
  onLocation?: (text: string) => void;
  /** Ak je zadané, sheet ponúkne „Anketa" (M1) — volajúci otvorí dialóg tvorby. */
  onPoll?: () => void;
  /** Ak je zadané, sheet ponúkne „Piškvorky" (M6) — výzva v konverzácii. */
  onGame?: () => void;
  /** Ak je zadané, sheet ponúkne „Udalosť" (M4) — volajúci otvorí dialóg tvorby. */
  onEvent?: () => void;
  /** Ak je zadané, sheet ponúkne „Zoznam" (poznámka/zoznam pre miestnosť). */
  onNote?: () => void;
  onClose: () => void;
}

/**
 * Bottom sheet výberu prílohy (chat). Ladenie 07/2026: jedna dlaždica
 * „Príloha" otvára PRIAMO natívny výber (na iOS systémové menu Knihovna
 * fotek / Pořídit snímek / Vybrat soubory) — žiadne tri duplicitné ikony.
 * Zvyšok sú akcie modulov: Poloha, Anketa, Piškvorky, Udalosť.
 */
export function AttachmentSheet({
  onFiles,
  onLocation,
  onPoll,
  onGame,
  onEvent,
  onNote,
  onClose,
}: AttachmentSheetProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) {
      onFiles(files);
      onClose();
    }
  };

  const shareLocation = () => {
    if (!navigator.geolocation) {
      setLocError('Zariadenie nepodporuje zisťovanie polohy');
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        onLocation?.(`📍 Moja poloha: https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`);
        setLocating(false);
        onClose();
      },
      () => {
        setLocating(false);
        setLocError('Polohu sa nepodarilo zistiť (povoľ prístup k polohe)');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const tiles: { icon: string; label: string; onClick: () => void; disabled?: boolean }[] = [
    { icon: '📎', label: 'Príloha', onClick: () => fileRef.current?.click() },
    ...(onLocation
      ? [{ icon: '📍', label: locating ? 'Zisťujem…' : 'Poloha', onClick: shareLocation, disabled: locating }]
      : []),
    ...(onPoll
      ? [
          {
            icon: '📊',
            label: 'Anketa',
            onClick: () => {
              onClose();
              onPoll();
            },
          },
        ]
      : []),
    ...(onGame
      ? [
          {
            icon: '⭕',
            label: 'Piškvorky',
            onClick: () => {
              onClose();
              onGame();
            },
          },
        ]
      : []),
    ...(onEvent
      ? [
          {
            icon: '📅',
            label: 'Udalosť',
            onClick: () => {
              onClose();
              onEvent();
            },
          },
        ]
      : []),
    ...(onNote
      ? [
          {
            icon: '✅',
            label: 'Zoznam',
            onClick: () => {
              onClose();
              onNote();
            },
          },
        ]
      : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-4 dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        <div className="grid grid-cols-4 gap-2">
          {tiles.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={t.onClick}
              disabled={t.disabled}
              className="flex flex-col items-center gap-1.5 rounded-xl px-1 py-3 transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-2xl">
                {t.icon}
              </span>
              <span className="text-xs text-neutral-600 dark:text-neutral-300">{t.label}</span>
            </button>
          ))}
        </div>
        {locError && <p className="mt-2 text-center text-xs text-red-500">{locError}</p>}

        <input ref={fileRef} type="file" multiple hidden onChange={pick} />
      </div>
    </div>
  );
}
