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

  return <GeneratedAvatar seed={email || name || 'unknown'} label={label} size={size} className={baseClassName} />;
}

function GeneratedAvatar({
  seed,
  label,
  size,
  className
}: {
  seed: string;
  label: string;
  size: number;
  className: string;
}): ReactElement {
  const cells = useMemo(() => generatedCells(seed), [seed]);
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
      <rect x="0" y="0" width="40" height="40" rx="4" fill="var(--avatar-card-bg)" />
      {cells.map((cell) => (
        <rect key={`${cell.x}:${cell.y}`} x={cell.x * 5} y={cell.y * 5} width="5" height="5" fill={color} />
      ))}
    </svg>
  );
}

function generatedCells(seed: string): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  let hash = Math.abs(hashString(seed));

  for (let y = 1; y < 7; y += 1) {
    for (let x = 1; x < 4; x += 1) {
      hash = (hash * 1664525 + 1013904223) >>> 0;

      if ((hash & 1) === 0) {
        continue;
      }

      cells.push({ x, y }, { x: 7 - x, y });
    }
  }

  cells.push({ x: 3, y: 6 }, { x: 4, y: 6 });
  return cells;
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
