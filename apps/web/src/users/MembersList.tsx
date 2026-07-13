import { useEffect, useState } from 'react';
import type { UserPublic } from '@rodinna/shared-types';
import { usersApi, ApiError } from '../lib/api';
import { Avatar } from '../shared/Avatar';
import { nameStyle } from '../shared/nameColor';

/** Zoznam členov rodiny. */
export function MembersList() {
  const [members, setMembers] = useState<UserPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    usersApi
      .list()
      .then((r) => setMembers(r.users))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Načítanie zlyhalo'));
  }, []);

  return (
    <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
      <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
        Členovia {members && `(${members.length})`}
      </h2>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {!members && !error && (
        <p className="mt-3 text-sm text-neutral-500">Načítavam…</p>
      )}

      <ul className="mt-4 divide-y divide-neutral-100 dark:divide-neutral-800">
        {members?.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <Avatar user={m} size={40} />
            <div className="min-w-0">
              <p className="truncate font-medium" style={nameStyle(m)}>
                {m.displayName}
              </p>
              <p className="truncate text-xs text-neutral-500">{m.email}</p>
            </div>
            {m.role === 'admin' && (
              <span className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                admin
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
