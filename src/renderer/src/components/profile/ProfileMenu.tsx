import type { ReactElement } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, GitBranch, Lightbulb, Settings, UserRound } from 'lucide-react';

import type { RepoProfileState } from '@shared/types';

import { PROFILE_COLOR, profileInitials } from './ProfileMenu.logic';

type ProfileMenuProps = {
  profileState?: RepoProfileState;
  onActivateProfile: (profileId: string | undefined) => Promise<void>;
  onOpenSettings: () => void;
  /** Opens Settings scrolled to Profiles, where profiles are created and edited. */
  onOpenProfileSettings: () => void;
};

/** The title-bar profile switcher. Editing lives in Settings › Profiles. */
export function ProfileMenu({
  profileState,
  onActivateProfile,
  onOpenSettings,
  onOpenProfileSettings
}: ProfileMenuProps): ReactElement {
  const popoverId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isPending, setIsPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeProfile = profileState?.activeProfile;
  const suggestedProfile = profileState?.suggestedProfile;
  const effectiveIdentity = profileState?.effectiveIdentity;
  const profileLabel = activeProfile?.name ?? effectiveIdentity?.name ?? 'Git config';
  const profileEmail = activeProfile?.email ?? effectiveIdentity?.email;
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

  async function handleAssign(profileId: string | undefined): Promise<void> {
    setIsOpen(false);
    setIsPending(true);
    setErrorMessage(undefined);
    try {
      await onActivateProfile(profileId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not switch profiles.');
      setIsOpen(true);
    } finally {
      setIsPending(false);
    }
  }

  function openFromMenu(open: () => void): void {
    setIsOpen(false);
    open();
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        ref={triggerRef}
        className="ml-1 flex h-7 items-center gap-2 rounded-full py-0.5 pl-1 pr-2 text-xs text-[var(--text-2)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)] disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-[var(--text-2)]"
        type="button"
        aria-label="Git profile menu"
        disabled={isPending}
        title={profileEmail ? `${profileLabel} <${profileEmail}>` : 'Git config workspace'}
        onClick={() => {
          setIsOpen((value) => !value);
          setErrorMessage(undefined);
        }}
        aria-busy={isPending}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
      >
        <span
          className="grid h-5.5 w-5.5 place-items-center rounded-full text-[10px] font-bold text-[var(--bg-field)]"
          style={{ background: profileColor }}
        >
          {profileInitials(profileLabel)}
        </span>
        <span className="max-w-28 truncate">{profileLabel}</span>
        {identityMismatch ? <AlertTriangle size={12} className="shrink-0 text-[var(--warning-text)]" aria-label="Workspace profile differs from local Git identity" /> : null}
        <ChevronDown size={12} />
      </button>

      {isOpen ? (
        <div id={popoverId} className="profile-menu" role="dialog" aria-label="Git profiles">
          <div className="profile-menu-header">
            <span className="profile-menu-avatar" style={{ background: profileColor }} aria-hidden="true">
              {profileInitials(profileLabel)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-[var(--text-1)]">{profileLabel}</span>
              <span className="block truncate text-[var(--text-3)]">
                {profileEmail ?? 'No Git identity configured'}
                {activeProfile?.githubLogin ? ` · GitHub @${activeProfile.githubLogin}` : ''}
              </span>
            </span>
          </div>

          {identityMismatch ? (
            <button className="profile-menu-warning" type="button" onClick={() => openFromMenu(onOpenProfileSettings)}>
              <AlertTriangle size={13} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">This repository's Git identity differs.</span>
              <span className="profile-menu-warning-action">Review</span>
            </button>
          ) : null}

          {suggestedProfile && suggestedProfile.id !== activeProfile?.id ? (
            <button className="menu-row" type="button" disabled={isPending} onClick={() => void handleAssign(suggestedProfile.id)}>
              <Lightbulb size={14} className="text-[var(--accent-2)]" />
              <span className="min-w-0 flex-1 truncate">Switch to suggested profile: {suggestedProfile.name}</span>
            </button>
          ) : null}

          <div className="profile-menu-section">
            {profiles.map((profile) => {
              const isActive = profile.id === activeProfile?.id;

              return (
                <button
                  key={profile.id}
                  className="menu-row"
                  type="button"
                  disabled={isPending}
                  aria-current={isActive || undefined}
                  title={profile.githubLogin ? `${profile.email} · @${profile.githubLogin}` : profile.email}
                  onClick={() => (isActive ? setIsOpen(false) : void handleAssign(profile.id))}
                >
                  <span className="profile-menu-check">{isActive ? <Check size={14} /> : null}</span>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: profile.avatarColor }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                  {profile.githubLogin ? <span className="max-w-24 truncate text-[11px] text-[var(--text-3)]">@{profile.githubLogin}</span> : null}
                </button>
              );
            })}
            <button className="menu-row" type="button" disabled={isPending} aria-current={!activeProfile || undefined} onClick={() => (activeProfile ? void handleAssign(undefined) : setIsOpen(false))}>
              <span className="profile-menu-check">{activeProfile ? null : <Check size={14} />}</span>
              <GitBranch size={13} className="text-[var(--text-3)]" />
              <span className="min-w-0 flex-1 truncate">Use Git config</span>
            </button>
          </div>

          {errorMessage ? <p className="profile-menu-error" role="alert">{errorMessage}</p> : null}

          <div className="profile-menu-section">
            <button className="menu-row" type="button" onClick={() => openFromMenu(onOpenProfileSettings)}>
              <UserRound size={14} />
              <span className="min-w-0 flex-1 truncate">Manage profiles…</span>
            </button>
            <button className="menu-row" type="button" onClick={() => openFromMenu(onOpenSettings)}>
              <Settings size={14} />
              <span className="min-w-0 flex-1 truncate">Settings</span>
              <kbd className="text-[11px] text-[var(--text-3)]">⌘,</kbd>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
