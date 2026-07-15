/**
 * Karta „Nápoveda a návod" vo Viac. Odkazuje na statickú príručku
 * `public/napoveda.html` (dostupná aj bez prihlásenia — nový člen ju otvorí
 * z pozývacieho e-mailu). Otvára sa v novej karte, aby appka bežala ďalej.
 */
export function HelpCard() {
  return (
    <a
      href="/napoveda.html"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-6 text-left transition hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.7-2 2-2 3.5" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Nápoveda a návod</p>
        <p className="mt-0.5 text-sm text-neutral-500">
          Rýchly štart, ovládanie a popis všetkých funkcií.
        </p>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-neutral-400" aria-hidden>
        <path d="m9 6 6 6-6 6" />
      </svg>
    </a>
  );
}
