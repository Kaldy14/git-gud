import type { FormEvent, ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, Plus, UserRound } from 'lucide-react';

import type { GitProfile, RepoProfileState } from '@shared/types';

type ProfileMenuProps = {
  repoPath?: string;
  profileState?: RepoProfileState;
  onAssignProfile: (profileId: string | undefined) => Promise<void>;
  onSaveAndAssignProfile: (profile: GitProfile) => Promise<void>;
};

const PROFILE_COLOR = 'var(--accent-2)';

export function ProfileMenu({
  repoPath,
  profileState,
  onAssignProfile,
  onSaveAndAssignProfile
}: ProfileMenuProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isPending, setIsPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeProfile = profileState?.activeProfile;
  const effectiveIdentity = profileState?.effectiveIdentity;
  const profileLabel = activeProfile?.name ?? effectiveIdentity?.name ?? 'Profile';
  const profileEmail = activeProfile?.email ?? effectiveIdentity?.email;
  const profileColor = activeProfile?.avatarColor ?? PROFILE_COLOR;
  const profiles = profileState?.profiles ?? [];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  function toggleOpen(): void {
    if (!repoPath) {
      return;
    }

    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    setErrorMessage(undefined);

    if (nextOpen) {
      setName(effectiveIdentity?.name ?? '');
      setEmail(effectiveIdentity?.email ?? '');
    }
  }

  async function runProfileAction(action: () => Promise<void>): Promise<void> {
    setIsPending(true);
    setErrorMessage(undefined);

    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Profile action failed.');
    } finally {
      setIsPending(false);
    }
  }

  async function handleAssign(profileId: string | undefined): Promise<void> {
    await runProfileAction(async () => {
      await onAssignProfile(profileId);
      setIsOpen(false);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || !trimmedEmail) {
      setErrorMessage('Name and email are required.');
      return;
    }

    await runProfileAction(async () => {
      await onSaveAndAssignProfile({
        id: createProfileId(trimmedName, trimmedEmail),
        name: trimmedName,
        email: trimmedEmail,
        avatarColor: PROFILE_COLOR
      });
      setIsOpen(false);
    });
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        className="ml-1 flex h-7 items-center gap-2 rounded-full py-0.5 pl-1 pr-2 text-xs text-[var(--text-2)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)] disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-[var(--text-2)]"
        type="button"
        title={!repoPath ? 'Open a repository to assign a profile.' : profileEmail ? `${profileLabel} <${profileEmail}>` : 'No Git identity configured'}
        disabled={!repoPath}
        onClick={toggleOpen}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <span
          className="grid h-5.5 w-5.5 place-items-center rounded-full text-[10px] font-bold text-[var(--bg-field)]"
          style={{ background: profileColor }}
        >
          {initials(profileLabel)}
        </span>
        <span className="max-w-28 truncate">{profileLabel}</span>
        <ChevronDown size={12} />
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-[34px] z-50 w-80 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-2 shadow-2xl shadow-black/60">
          <div className="px-2 pb-2 pt-1">
            <p className="truncate text-xs font-semibold text-[var(--text-1)]">{profileLabel}</p>
            <p className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">{profileEmail ?? 'No Git identity configured'}</p>
          </div>

          <div className="border-t border-[var(--border)] pt-1">
            <button
              className="menu-row"
              type="button"
              disabled={isPending || !activeProfile}
              onClick={() => void handleAssign(undefined)}
            >
              {activeProfile ? <GitBranch size={14} /> : <Check size={14} className="text-[var(--accent-2)]" />}
              <span className="min-w-0 flex-1 truncate">Use Git config</span>
            </button>
            {profiles.map((profile) => {
              const isActive = profile.id === activeProfile?.id;

              return (
                <button
                  key={profile.id}
                  className="menu-row"
                  type="button"
                  disabled={isPending || isActive}
                  title={profile.email}
                  onClick={() => void handleAssign(profile.id)}
                >
                  {isActive ? <Check size={14} className="text-[var(--accent-2)]" /> : <UserRound size={14} />}
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: profile.avatarColor }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                </button>
              );
            })}
          </div>

          <form className="mt-2 space-y-2 border-t border-[var(--border)] px-2 pt-2" onSubmit={(event) => void handleSubmit(event)}>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">Name</span>
              <input
                className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--border-strong)]"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">Email</span>
              <input
                className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--border-strong)]"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            {errorMessage ? <p className="text-[11px] text-[var(--danger-text)]">{errorMessage}</p> : null}

            <button className="btn-accent h-8 w-full" type="submit" disabled={isPending || !name.trim() || !email.trim()}>
              <Plus size={13} />
              <span>Save and Assign</span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function createProfileId(name: string, email: string): string {
  const slug =
    (email || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'profile';

  return `${slug}-${Date.now().toString(36)}`;
}

function initials(value: string): string {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'P'
  );
}
