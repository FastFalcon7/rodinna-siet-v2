import { useInstallPrompt } from '../shared/useInstallPrompt';

/**
 * Karta „Nainštalovať appku" vo Viac (T8, PWA polish). Zobrazí sa len keď má
 * zmysel: Android/Chrome s dostupným promptom alebo iOS s návodom. Keď appka
 * už beží ako PWA, karta sa vôbec nevykreslí (netreba ju).
 */
export function InstallCard() {
  const { status, promptInstall } = useInstallPrompt();

  if (status === 'installed' || status === 'unavailable') return null;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-1 font-semibold">Nainštalovať appku</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Pridaj Rodinnú sieť na plochu — otvára sa ako appka, funguje aj bez
        signálu a chodia notifikácie na zamknutú obrazovku.
      </p>

      {status === 'available' ? (
        <button
          onClick={() => void promptInstall()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Nainštalovať
        </button>
      ) : (
        <p className="rounded-xl bg-neutral-100 p-3 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          Na iPhone/iPade ťukni na <strong>Zdieľať</strong> a potom{' '}
          <strong>Pridať na plochu</strong>.
        </p>
      )}
    </section>
  );
}
