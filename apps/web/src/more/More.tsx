import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../shared/Avatar';
import { nameStyle } from '../shared/nameColor';
import { ProfileCard } from '../users/ProfileCard';
import { MembersList } from '../users/MembersList';
import { InvitePanel } from '../users/InvitePanel';
import { NotificationSettings } from './NotificationSettings';
import { ThemeSettings } from './ThemeSettings';
import { LlmSettings } from './LlmSettings';
import { InstallCard } from './InstallCard';
import { webModules, type WebModule } from '../app/registry';
import { useLlmEnabled } from '../shared/llm';

/**
 * „Viac" (DESIGN_REVIEW_FEED_CHAT.md §2.1): identita + profil + nastavenia
 * + vstupy do modulov mimo bottom navu (slot 'more'). Phase 2 moduly sa tu
 * objavia automaticky z registry.
 */
export function More({ onOpenModule }: { onOpenModule: (name: string) => void }) {
  const { user, logout } = useAuth();
  const llmEnabled = useLlmEnabled();
  if (!user) return null;

  const extraModules = webModules.filter((m: WebModule) => m.slot === 'more' && (!m.llm || llmEnabled));

  return (
    <>
      <section className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <Avatar user={user} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" style={nameStyle(user)}>
            {user.displayName}
          </p>
          <p className="truncate text-sm text-neutral-500">
            {user.email} · {user.role === 'admin' ? 'admin' : 'člen'}
          </p>
        </div>
        <button
          onClick={() => logout()}
          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Odhlásiť
        </button>
      </section>

      {extraModules.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {extraModules.map(({ name, label, icon: Icon }) => (
              <li key={name}>
                <button
                  onClick={() => onOpenModule(name)}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left text-sm font-medium transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <Icon className="h-5 w-5 text-neutral-500" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <InstallCard />
      <ThemeSettings />
      <LlmSettings />
      <NotificationSettings />
      <ProfileCard />
      {user.role === 'admin' && <InvitePanel />}
      <MembersList />
    </>
  );
}
