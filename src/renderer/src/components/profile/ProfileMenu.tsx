import type { FormEvent, ReactElement } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, GitBranch, Lightbulb, Plus, Settings2, UserRound } from 'lucide-react';

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
  const popoverId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string>();
  const [sshKeyPath, setSshKeyPath] = useState('');
  const [ghConfigDir, setGhConfigDir] = useState('');
  const [signingKey, setSigningKey] = useState('');
  const [remoteUrlPatterns, setRemoteUrlPatterns] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isPending, setIsPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeProfile = profileState?.activeProfile;
  const suggestedProfile = profileState?.suggestedProfile;
  const effectiveIdentity = profileState?.effectiveIdentity;
  const profileLabel = effectiveIdentity?.name ?? activeProfile?.name ?? 'Profile';
  const profileEmail = effectiveIdentity?.email ?? activeProfile?.email;
  const profileColor = activeProfile?.avatarColor ?? PROFILE_COLOR;
  const profiles = profileState?.profiles ?? [];
  const identityMismatch = Boolean(activeProfile && profileState?.identityMatchesActiveProfile === false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  function toggleOpen(): void {
    if (!repoPath) {
      return;
    }

    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    setErrorMessage(undefined);

    if (nextOpen) {
      loadProfileForm(activeProfile);
    }
  }

  function loadProfileForm(profile: GitProfile | undefined): void {
    setEditingProfileId(profile?.id);
    setName(profile?.name ?? effectiveIdentity?.name ?? '');
    setEmail(profile?.email ?? effectiveIdentity?.email ?? '');
    setSshKeyPath(profile?.sshKeyPath ?? '');
    setGhConfigDir(profile?.ghConfigDir ?? '');
    setSigningKey(profile?.signingKey ?? '');
    setRemoteUrlPatterns(profile?.remoteUrlPatterns?.join('\n') ?? '');
    setShowAdvanced(Boolean(profile?.sshKeyPath || profile?.ghConfigDir || profile?.signingKey || profile?.remoteUrlPatterns?.length));
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
        id: editingProfileId ?? createProfileId(trimmedName, trimmedEmail),
        name: trimmedName,
        email: trimmedEmail,
        avatarColor:
          activeProfile && activeProfile.id === editingProfileId
            ? activeProfile.avatarColor
            : PROFILE_COLOR,
        sshKeyPath: sshKeyPath.trim() || undefined,
        ghConfigDir: ghConfigDir.trim() || undefined,
        signingKey: signingKey.trim() || undefined,
        remoteUrlPatterns: remoteUrlPatterns
          .split(/[\n,]+/)
          .map((pattern) => pattern.trim())
          .filter(Boolean)
      });
      setIsOpen(false);
    });
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        ref={triggerRef}
        className="ml-1 flex h-7 items-center gap-2 rounded-full py-0.5 pl-1 pr-2 text-xs text-[var(--text-2)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)] disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-[var(--text-2)]"
        type="button"
        title={!repoPath ? 'Open a repository to assign a profile.' : profileEmail ? `${profileLabel} <${profileEmail}>` : 'No Git identity configured'}
        disabled={!repoPath}
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
      >
        <span
          className="grid h-5.5 w-5.5 place-items-center rounded-full text-[10px] font-bold text-[var(--bg-field)]"
          style={{ background: profileColor }}
        >
          {initials(profileLabel)}
        </span>
        <span className="max-w-28 truncate">{profileLabel}</span>
        {identityMismatch ? <AlertTriangle size={12} className="shrink-0 text-[var(--danger-text)]" aria-label="Assigned profile differs from Git identity" /> : null}
        <ChevronDown size={12} />
      </button>

      {isOpen ? (
        <div id={popoverId} className="absolute right-0 top-[34px] z-50 max-h-[min(720px,82vh)] w-80 overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-2 shadow-2xl shadow-black/60" role="dialog" aria-label="Git identity and profiles">
          <div className="px-2 pb-2 pt-1">
            <p className="truncate text-xs font-semibold text-[var(--text-1)]">{profileLabel}</p>
            <p className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">{profileEmail ?? 'No Git identity configured'}</p>
            {activeProfile ? <p className="mt-1 truncate text-[10.5px] text-[var(--text-3)]">Assigned profile: {activeProfile.name}</p> : null}
          </div>

          {identityMismatch ? (
            <div className="mx-1 mb-2 flex gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-2.5 py-2 text-[11px] leading-4 text-[var(--danger-text)]" role="status">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>The repository's actual Git identity differs from the assigned profile. Reassign it or use Git config.</span>
            </div>
          ) : null}

          {suggestedProfile && suggestedProfile.id !== activeProfile?.id ? (
            <div className="mb-2 border-t border-[var(--border)] pt-1">
              <button className="menu-row" type="button" disabled={isPending} onClick={() => void handleAssign(suggestedProfile.id)}>
                <Lightbulb size={14} className="text-[var(--accent-2)]" />
                <span className="min-w-0 flex-1 truncate">Use suggested profile: {suggestedProfile.name}</span>
              </button>
            </div>
          ) : null}

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
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
                {editingProfileId ? 'Edit assigned profile' : 'New profile'}
              </span>
              {editingProfileId ? (
                <button className="btn-subtle h-6 px-2 text-[10px]" type="button" onClick={() => loadProfileForm(undefined)}>
                  <Plus size={11} />
                  New
                </button>
              ) : null}
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">Name</span>
              <input
                className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--border-strong)]"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <button
              className="flex w-full items-center justify-between rounded px-1 py-1 text-[11px] font-semibold text-[var(--text-2)] hover:bg-[var(--bg-hover)]"
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((value) => !value)}
            >
              <span className="flex items-center gap-1.5"><Settings2 size={12} />Advanced Git and remote settings</span>
              <ChevronDown size={12} className={showAdvanced ? 'rotate-180' : undefined} />
            </button>

            {showAdvanced ? (
              <div className="space-y-2 rounded border border-[var(--border)] bg-[var(--bg-field)] p-2">
                <ProfileTextField label="SSH key path" value={sshKeyPath} placeholder="~/.ssh/id_ed25519_work" onChange={setSshKeyPath} />
                <ProfileTextField label="GH_CONFIG_DIR" value={ghConfigDir} placeholder="~/.config/gh-work" onChange={setGhConfigDir} />
                <ProfileTextField label="Signing key" value={signingKey} placeholder="GPG or SSH signing key" onChange={setSigningKey} />
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">Remote URL patterns</span>
                  <textarea
                    className="h-16 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-1.5 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--border-strong)]"
                    value={remoteUrlPatterns}
                    placeholder={'github.com/work\ngitlab.example.com'}
                    onChange={(event) => setRemoteUrlPatterns(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">Email</span>
              <input
                className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--border-strong)]"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            {errorMessage ? <p className="text-[11px] text-[var(--danger-text)]" role="alert">{errorMessage}</p> : null}

            <button className="btn-primary h-8 w-full" type="submit" disabled={isPending || !name.trim() || !email.trim()}>
              <Plus size={13} />
              <span>{editingProfileId ? 'Update and Assign' : 'Save and Assign'}</span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ProfileTextField({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">{label}</span>
      <input
        className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-2 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--border-strong)]"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
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
