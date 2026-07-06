import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useAuth } from '../auth/AuthContext';
import { appNavigate, MORE_TAB } from './navigate';
import { webModules, MoreIcon } from './registry';

/**
 * Command palette (T8, PWA polish). Cmd/Ctrl+K otvorí rýchly skok medzi
 * modulmi + akcie. Navigácia ide cez appNavigate zbernicu (Home ju počúva),
 * takže paleta nemusí vedieť nič o stave shellu.
 *
 * Ovládanie: Cmd/Ctrl+K otvor/zavri, ↑/↓ pohyb, Enter spusti, Esc zavri.
 */

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
  run: () => void;
}

export function CommandPalette() {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const modCmds: Command[] = webModules.map((m) => ({
      id: `nav:${m.name}`,
      label: m.label,
      hint: 'Otvoriť',
      icon: m.icon,
      run: () => appNavigate({ module: m.name }),
    }));
    return [
      ...modCmds,
      {
        id: 'nav:more',
        label: 'Viac a nastavenia',
        hint: 'Otvoriť',
        icon: MoreIcon,
        run: () => appNavigate({ module: MORE_TAB }),
      },
      {
        id: 'action:logout',
        label: 'Odhlásiť sa',
        icon: MoreIcon,
        run: () => void logout(),
      },
    ];
  }, [logout]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Globálna skratka Cmd/Ctrl+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reset a fokus pri otvorení.
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      // po vykreslení
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Drž zvýraznenie v rozsahu filtra.
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(filtered[index]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Rýchle akcie"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Kam chceš ísť? (Cmd/Ctrl+K)"
          className="w-full border-b border-neutral-200 bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-neutral-400 dark:border-neutral-800"
        />
        <ul className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-neutral-400">Nič sa nenašlo</li>
          ) : (
            filtered.map((cmd, i) => {
              const Icon = cmd.icon;
              return (
                <li key={cmd.id}>
                  <button
                    onClick={() => run(cmd)}
                    onMouseMove={() => setIndex(i)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      i === index
                        ? 'bg-accent/10 text-accent'
                        : 'text-neutral-700 dark:text-neutral-200'
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0 opacity-70" />
                    <span className="flex-1 font-medium">{cmd.label}</span>
                    {cmd.hint && <span className="text-xs text-neutral-400">{cmd.hint}</span>}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
