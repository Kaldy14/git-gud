import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';

type AuthorAvatarProps = {
  name: string;
  email?: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
};

const AVATAR_COLORS = [
  'var(--avatar-1)',
  'var(--avatar-2)',
  'var(--avatar-3)',
  'var(--avatar-4)',
  'var(--avatar-5)',
  'var(--avatar-6)'
] as const;

export function AuthorAvatar({ name, email, avatarUrl, size = 32, className = '' }: AuthorAvatarProps): ReactElement {
  const [imageFailed, setImageFailed] = useState(false);
  const label = authorLabel(name, email);
  const style = useMemo(() => ({ width: size, height: size }), [size]);
  const baseClassName = `shrink-0 rounded bg-[var(--avatar-card-bg)] ${className}`.trim();

  if (avatarUrl && !imageFailed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        title={label}
        referrerPolicy="no-referrer"
        className={`${baseClassName} object-cover`}
        style={style}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <GeneratedAvatar
      seed={email || name || 'unknown'}
      initials={authorInitials(name || email || 'Unknown')}
      label={label}
      size={size}
      className={baseClassName}
    />
  );
}

function GeneratedAvatar({
  seed,
  initials,
  label,
  size,
  className
}: {
  seed: string;
  initials: string;
  label: string;
  size: number;
  className: string;
}): ReactElement {
  const color = AVATAR_COLORS[Math.abs(hashString(seed)) % AVATAR_COLORS.length];

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 40 40"
      className={className}
      style={{ width: size, height: size }}
    >
      <title>{label}</title>
      <rect x="0" y="0" width="40" height="40" rx="5" fill={color} />
      <text x="20" y="25" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--bg-field)">
        {initials}
      </text>
    </svg>
  );
}

function authorInitials(value: string): string {
  return (
    value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

function authorLabel(name: string, email: string | undefined): string {
  const displayName = name || 'Unknown author';
  return email ? `${displayName} <${email}>` : displayName;
}

function hashString(value: string): number {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }

  return hash;
}
