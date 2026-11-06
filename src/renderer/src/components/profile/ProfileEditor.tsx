import type { FormEvent, ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Check, ChevronDown, Cloud, Settings2 } from 'lucide-react';

import type { GitHubCliAccount, GitProfile } from '@shared/types';

import { gitProfileFromDraft, PROFILE_COLOR } from './ProfileMenu.logic';

type ProfileEditorProps = {
  /** The profile to edit, or undefined to create one. */
  profile?: GitProfile;
  /** Prefills a new profile from the repository's Git identity. */
  defaultIdentity?: { name?: string; email?: string };
  onSave: (profile: GitProfile) => Promise<void>;
  onCancel: () => void;
};

/** Name, email, GitHub account and advanced Git settings for one workspace profile. */
export function ProfileEditor({ profile, defaultIdentity, onSave, onCancel }: ProfileEditorProps): ReactElement {
  const [name, setName] = useState(profile?.name ?? defaultIdentity?.name ?? '');
  const [email, setEmail] = useState(profile?.email ?? defaultIdentity?.email ?? '');
  const [sshKeyPath, setSshKeyPath] = useState(profile?.sshKeyPath ?? '');
  const [ghConfigDir, setGhConfigDir] = useState(profile?.ghConfigDir ?? '');
  const [githubLogin, setGithubLogin] = useState(profile?.githubLogin ?? '');
  const [githubHost, setGithubHost] = useState(profile?.githubHost ?? '');
  const [signingKey, setSigningKey] = useState(profile?.signingKey ?? '');
  const [remoteUrlPatterns, setRemoteUrlPatterns] = useState(profile?.remoteUrlPatterns?.join('\n') ?? '');
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(profile?.sshKeyPath || profile?.ghConfigDir || profile?.signingKey || profile?.remoteUrlPatterns?.length)
  );
  const [githubAccounts, setGithubAccounts] = useState<GitHubCliAccount[]>([]);
  const [isLoadingGithubAccounts, setIsLoadingGithubAccounts] = useState(true);
  const [githubAccountsError, setGithubAccountsError] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    void window.api
      .listGitHubAccounts()
      .then((accounts) => {
        if (!isCancelled) setGithubAccounts(accounts);
      })
      .catch((error: unknown) => {
        if (!isCancelled) setGithubAccountsError(error instanceof Error ? error.message : 'Could not read GitHub CLI accounts.');
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingGithubAccounts(false);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  function setGithubAccount(account: GitHubCliAccount | undefined): void {
    setGhConfigDir(account?.configDir ?? '');
    setGithubLogin(account?.login ?? '');
    setGithubHost(account?.host ?? '');
  }

  function updateGhConfigDir(value: string): void {
    const matchedAccount = githubAccounts.find((account) => account.configDir === value.trim());
    setGhConfigDir(value);
    setGithubLogin(matchedAccount?.login ?? '');
    setGithubHost(matchedAccount?.host ?? '');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const draft = gitProfileFromDraft({
      editingProfileId: profile?.id,
      name,
      email,
      avatarColor: profile?.avatarColor ?? PROFILE_COLOR,
      sshKeyPath,
      ghConfigDir,
      githubLogin,
      githubHost,
      signingKey,
      remoteUrlPatterns
    });

    if (!draft) {
      setErrorMessage('Name and email are required.');
      return;
    }

    setIsPending(true);
    setErrorMessage(undefined);
    try {
      await onSave(draft);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save the profile.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form className="profile-editor" onSubmit={(event) => void handleSubmit(event)}>
      <div className="profile-editor-fields">
        <label className="profile-editor-field">
          <span>Name</span>
          <input className="form-input form-input--compact" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="profile-editor-field">
          <span>Email</span>
          <input className="form-input form-input--compact" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
      </div>

      <fieldset className="profile-editor-github">
        <legend>
          <Cloud size={13} />
          GitHub account
        </legend>
        {isLoadingGithubAccounts ? (
          <p className="profile-editor-help">Finding GitHub CLI accounts…</p>
        ) : githubAccounts.length > 0 ? (
          <div className="profile-editor-accounts">
            {githubAccounts.map((account) => {
              const isSelected = account.configDir === ghConfigDir && account.login === githubLogin;

              return (
                <button
                  key={`${account.configDir}:${account.host}:${account.login}`}
                  className="profile-editor-account"
                  data-selected={isSelected}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setGithubAccount(isSelected ? undefined : account)}
                >
                  <span className="profile-editor-account-icon">{isSelected ? <Check size={12} /> : <Cloud size={12} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-[var(--text-1)]">@{account.login}</span>
                    <span className="block truncate text-[var(--text-3)]">{account.host} · {account.gitProtocol.toUpperCase()} via GitHub CLI</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : githubAccountsError ? null : (
          <p className="profile-editor-help">No authenticated GitHub CLI accounts found.</p>
        )}
        {githubAccountsError ? <p className="profile-editor-error">{githubAccountsError}</p> : null}
        <p className="profile-editor-help">Reuses GitHub CLI credentials and your existing Git credential or SSH setup. Git Gud never copies the token.</p>
      </fieldset>

      <button
        className="profile-editor-disclosure"
        type="button"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced((value) => !value)}
      >
        <Settings2 size={12} />
        Advanced Git and remote settings
        <ChevronDown size={12} className={showAdvanced ? 'ml-auto rotate-180' : 'ml-auto'} />
      </button>

      {showAdvanced ? (
        <div className="profile-editor-fields">
          <ProfileTextField label="SSH key path" value={sshKeyPath} placeholder="~/.ssh/id_ed25519_work" onChange={setSshKeyPath} />
          <ProfileTextField label="GH_CONFIG_DIR (manual)" value={ghConfigDir} placeholder="~/.config/gh-work" onChange={updateGhConfigDir} />
          <ProfileTextField label="Signing key" value={signingKey} placeholder="GPG or SSH signing key" onChange={setSigningKey} />
          <label className="profile-editor-field">
            <span>Remote URL patterns</span>
            <textarea
              className="form-input form-input--multiline"
              value={remoteUrlPatterns}
              placeholder={'github.com/work\ngitlab.example.com'}
              onChange={(event) => setRemoteUrlPatterns(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {errorMessage ? <p className="profile-editor-error" role="alert">{errorMessage}</p> : null}

      <div className="profile-editor-actions">
        <button className="btn-subtle btn-compact" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn-primary btn-compact" type="submit" disabled={isPending || !name.trim() || !email.trim()}>
          {profile ? 'Save profile' : 'Create profile'}
        </button>
      </div>
    </form>
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
    <label className="profile-editor-field">
      <span>{label}</span>
      <input className="form-input form-input--compact" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
