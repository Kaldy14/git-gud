import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { Plus } from 'lucide-react';

import type { GitProfile, RepoProfileState } from '@shared/types';

import { ProfileEditor } from './ProfileEditor';
import { profileInitials } from './ProfileMenu.logic';

type ProfileSettingsSectionProps = {
  heading: ReactNode;
  profileState?: RepoProfileState;
  onSaveProfile: (profile: GitProfile) => Promise<void>;
};

/** Settings › Profiles: every workspace profile with an inline editor. Saves apply right away. */
export function ProfileSettingsSection({ heading, profileState, onSaveProfile }: ProfileSettingsSectionProps): ReactElement {
  // undefined: nothing open; 'new': the create form; otherwise the id being edited.
  const [editing, setEditing] = useState<string>();
  const profiles = profileState?.profiles ?? [];
  const activeId = profileState?.activeProfile?.id;
  const identityMismatch = Boolean(profileState?.activeProfile && profileState.identityMatchesActiveProfile === false);

  async function save(profile: GitProfile): Promise<void> {
    await onSaveProfile(profile);
    setEditing(undefined);
  }

  return (
    <section className="settings-group" id="settings-profiles">
      {heading}
      <p className="settings-row-help">Each profile keeps its own open tabs and recent repositories. Switch profiles from the menu in the title bar.</p>
      {identityMismatch ? (
        <p className="profile-settings-warning" role="status">
          This repository's local Git identity differs from the active profile. Git Gud operations still use the profile.
        </p>
      ) : null}
      <div className="settings-group-body">
        {profiles.map((profile) => (
          <div key={profile.id} className="settings-row settings-row--block">
            <div className="profile-settings-row">
              <span className="profile-settings-avatar" style={{ background: profile.avatarColor }} aria-hidden="true">
                {profileInitials(profile.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="settings-row-label">
                  {profile.name}
                  {profile.id === activeId ? <span className="profile-settings-active">Active</span> : null}
                </span>
                <span className="profile-settings-meta">
                  {profile.email}
                  {profile.githubLogin ? ` · GitHub @${profile.githubLogin}` : ' · No GitHub account'}
                </span>
              </span>
              {editing === profile.id ? null : (
                <button className="btn-subtle btn-compact" type="button" onClick={() => setEditing(profile.id)}>Edit</button>
              )}
            </div>
            {editing === profile.id ? (
              <ProfileEditor profile={profile} onSave={save} onCancel={() => setEditing(undefined)} />
            ) : null}
          </div>
        ))}
        <div className="settings-row settings-row--block">
          {editing === 'new' ? (
            <ProfileEditor defaultIdentity={profileState?.effectiveIdentity} onSave={save} onCancel={() => setEditing(undefined)} />
          ) : (
            <button className="btn-subtle btn-compact self-start" type="button" onClick={() => setEditing('new')}>
              <Plus size={12} />
              New profile
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
