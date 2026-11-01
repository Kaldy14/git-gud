import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';

import { authorColor } from '@shared/graph';

type AuthorAvatarProps = {
  name: string;
  email?: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
};

export function AuthorAvatar({ name, email, avatarUrl, size = 32, className = '' }: AuthorAvatarProps): ReactElement {
  const [imageFailed, setImageFailed] = useState(false);
  const label = authorLabel(name, email);
  const style = useMemo(() => ({ width: size, height: size }), [size]);
  const baseClassName = `shrink-0 rounded-full bg-[var(--avatar-card-bg)] ${className}`.trim();

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
      color={authorColor(email ?? name)}
      initials={authorInitials(name || email || 'Unknown')}
      label={label}
      size={size}
      className={baseClassName}
    />
  );
}

function GeneratedAvatar({
  color,
  initials,
  label,
  size,
  className
}: {
  color: string;
  initials: string;
  label: string;
  size: number;
  className: string;
}): ReactElement {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 40 40"
      className={className}
      style={{ width: size, height: size }}
    >
      <title>{label}</title>
      <circle cx="20" cy="20" r="20" fill={color} />
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
