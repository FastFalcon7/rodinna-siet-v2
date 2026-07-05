import { useState, type ComponentType } from 'react';
import { PollCard } from '../polls/PollCard';
import { AlbumFeedCard, MemoryCard } from '../albums/cards';

/**
 * Registry živých kariet (plán §M0-4, kontrakty K1/K2): modul zaregistruje
 * render pre svoje entity a karta sa dá vložiť do chatu (app:// link
 * v správe) aj do Feedu (feed_cards, od M1). Karta renderuje AKTUÁLNY stav
 * entity — dáta si načíta sama cez API modulu, správa nesie len referenciu.
 */

export interface EntityCardProps {
  entityId: string;
  /** Kompaktný variant do chat bubliny (užší, bez veľkých okrajov). */
  compact?: boolean;
}

const renderers = new Map<string, ComponentType<EntityCardProps>>();

export function registerCardRenderer(module: string, C: ComponentType<EntityCardProps>): void {
  renderers.set(module, C);
}

/** Render karty podľa modulu; neznámy modul → decentný fallback (starší klient). */
export function EntityCard({ module, entityId, compact }: { module: string } & EntityCardProps) {
  const C = renderers.get(module);
  if (!C) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">
        Karta modulu „{module}" — aktualizuj appku, aby si ju videl.
      </div>
    );
  }
  return <C entityId={entityId} compact={compact} />;
}

/**
 * Demo karta (M0 akceptácia: „dummy živá karta sa dá poslať do chatu
 * a otvoriť"). Pošli správu s textom `app://demo/test`. M1 ju nahradí
 * skutočnou kartou ankety.
 */
function DemoCard({ entityId, compact }: EntityCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
      // Plný povrch nezávislý od farby bubliny (karta musí byť čitateľná
      // aj vo vlastnej coral bubline aj vo feede).
      className={`block w-full rounded-xl border border-black/10 bg-white text-left shadow-sm transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-neutral-800 ${
        compact ? 'px-3 py-2' : 'px-4 py-3'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-accent">
        <span aria-hidden>🧩</span> Živá karta
      </span>
      <span className="mt-0.5 block text-xs text-neutral-500">
        {open ? `Entita „${entityId}" — takto tu bude žiť anketa, zoznam či udalosť.` : 'Ťukni pre detail'}
      </span>
    </button>
  );
}

registerCardRenderer('demo', DemoCard);
registerCardRenderer('polls', PollCard);
registerCardRenderer('albums', AlbumFeedCard);
registerCardRenderer('memories', MemoryCard);
