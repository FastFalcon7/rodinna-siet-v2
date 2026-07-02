import type { UserPublic } from '@rodinna/shared-types';

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

interface AvatarProps {
  user: Pick<UserPublic, 'displayName' | 'avatarUrl'>;
  size?: number;
}

/** Avatar člena: obrázok ak existuje, inak kruh s iniciálkami. */
export function Avatar({ user, size = 40 }: AvatarProps) {
  const style = { width: size, height: size };
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.displayName}
        style={style}
        className="rounded-full object-cover bg-neutral-200 dark:bg-neutral-800"
      />
    );
  }
  return (
    <div
      style={{ ...style, fontSize: size * 0.4 }}
      className="grid place-items-center rounded-full bg-neutral-200 dark:bg-neutral-700 font-medium text-neutral-600 dark:text-neutral-200 select-none"
    >
      {initials(user.displayName)}
    </div>
  );
}
