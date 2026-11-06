import type { FormEvent, ReactElement } from 'react';
import { useEffect, useId, useState } from 'react';
import {
  Bot,
  Check,
  Download,
  GitGraph,
  Monitor,
  RefreshCw,
  Rows3,
  ShieldAlert,
  SplitSquareHorizontal,
  Trash2,
  UserRound,
  X
} from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import { MachineSettingsSection } from '@renderer/components/machines/MachineSettingsSection';
import { ProfileSettingsSection } from '@renderer/components/profile/ProfileSettingsSection';
import {
  clampAutoFetchIntervalMinutes,
  clampGraphPageSize,
  codeFontStack,
  MAX_AUTO_FETCH_INTERVAL_MINUTES,
  MAX_GRAPH_PAGE_SIZE,
  MIN_AUTO_FETCH_INTERVAL_MINUTES,
  MIN_GRAPH_PAGE_SIZE,
  normalizeCodeFontFamily
} from '@shared/settings';
import type { AppSettings, CodexAgentNotesSkillState, DiffSyntaxTheme, GitProfile, RepoProfileState } from '@shared/types';

type SettingsPanelProps = {
  settings: AppSettings;
  isSaving: boolean;
  errorMessage?: string;
  codexSkillState?: CodexAgentNotesSkillState;
  isCodexSkillBusy: boolean;
  codexSkillErrorMessage?: string;
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<void> | void;
  onInstallCodexSkill: () => Promise<void> | void;
  onRemoveCodexSkill: () => Promise<void> | void;
  profileState?: RepoProfileState;
  onSaveProfile: (profile: GitProfile) => Promise<void>;
  /** Scrolls this section into view when the drawer opens. */
  initialSection?: 'profiles';
};

export function SettingsPanel({
  settings,
  isSaving,
  errorMessage,
  codexSkillState,
  isCodexSkillBusy,
  codexSkillErrorMessage,
  onClose,
  onSave,
  onInstallCodexSkill,
  onRemoveCodexSkill,
  profileState,
  onSaveProfile,
  initialSection
}: SettingsPanelProps): ReactElement {
  const titleId = useId();

  useEffect(() => {
    if (initialSection === 'profiles') {
      document.getElementById('settings-profiles')?.scrollIntoView({ block: 'start' });
    }
  }, [initialSection]);
  const descriptionId = useId();
  const [draft, setDraft] = useState<AppSettings>(settings);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSave({
      ...draft,
      autoFetchIntervalMinutes: clampAutoFetchIntervalMinutes(
        draft.autoFetchIntervalMinutes
      ),
      graphPageSize: clampGraphPageSize(draft.graphPageSize),
      codeFontFamily: normalizeCodeFontFamily(draft.codeFontFamily)
    });
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      className="h-full w-full max-w-[560px]"
      backdropClassName="fixed inset-0 z-50 flex items-stretch justify-end bg-black/45"
      onClose={onClose}
    >
      <form
        className="flex h-full w-full max-w-[560px] flex-col border-l border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl shadow-black/60"
        onSubmit={handleSubmit}
      >
        <header className="flex min-h-14 items-center gap-3 border-b border-[var(--border)] px-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold text-[var(--text-1)]">Settings</h2>
            <p id={descriptionId} className="mt-0.5 text-[12px] text-[var(--text-3)]">Local workflow defaults</p>
          </div>
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close settings">
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <section className="settings-group">
            <SettingHeading icon={<Rows3 size={15} />} label="Diffs" />
            <div className="settings-group-body">
              <div className="settings-row">
                <fieldset className="contents">
                  <legend className="settings-row-label">Default layout</legend>
                  <div className="segmented" role="group" aria-label="Default diff layout">
                    <button
                      type="button"
                      aria-pressed={draft.defaultDiffStyle === 'unified'}
                      data-active={draft.defaultDiffStyle === 'unified'}
                      onClick={() => setDraft((value) => ({ ...value, defaultDiffStyle: 'unified' }))}
                    >
                      <Rows3 size={12} />
                      Unified
                    </button>
                    <button
                      type="button"
                      aria-pressed={draft.defaultDiffStyle === 'split'}
                      data-active={draft.defaultDiffStyle === 'split'}
                      onClick={() => setDraft((value) => ({ ...value, defaultDiffStyle: 'split' }))}
                    >
                      <SplitSquareHorizontal size={12} />
                      Split
                    </button>
                  </div>
                </fieldset>
              </div>
              <div className="settings-row settings-row--block">
                <fieldset className="min-w-0">
                  <legend className="settings-row-label mb-2">Syntax theme</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <SyntaxThemeOption
                      label="Git Gud Dark"
                      description="Balanced aqua and warm accents"
                      colors={['#4fc1ff', '#dcdcaa', '#ce9178', '#4ec9b0']}
                      value="git-gud-dark"
                      selected={draft.diffSyntaxTheme}
                      onSelect={(diffSyntaxTheme) => setDraft((value) => ({ ...value, diffSyntaxTheme }))}
                    />
                    <SyntaxThemeOption
                      label="Tokyo Night Storm"
                      description="Blue-violet storm palette"
                      colors={['#7aa2f7', '#bb9af7', '#9ece6a', '#f7768e']}
                      value="tokyo-night-storm"
                      selected={draft.diffSyntaxTheme}
                      onSelect={(diffSyntaxTheme) => setDraft((value) => ({ ...value, diffSyntaxTheme }))}
                    />
                  </div>
                  <p className="settings-row-help">Applied to file diffs and review views.</p>
                </fieldset>
              </div>
              <label className="settings-row">
                <SettingCopy
                  label="Code font"
                  help="Font family for diffs, hashes and code, as installed on this Mac. Leave empty for the system monospace font."
                />
                <input
                  className="form-input form-input--text"
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="SF Mono"
                  maxLength={80}
                  value={draft.codeFontFamily}
                  style={{ fontFamily: codeFontStack(draft.codeFontFamily) ?? 'var(--font-mono)' }}
                  onChange={(event) => setDraft((value) => ({ ...value, codeFontFamily: event.target.value }))}
                />
              </label>
            </div>
          </section>

          <section className="settings-group">
            <SettingHeading icon={<GitGraph size={15} />} label="Graph" />
            <div className="settings-group-body">
              <label className="settings-row">
                <SettingCopy
                  label="History page size"
                  help="History opens with the newest 50 commits, then loads up to this many at a time as you scroll."
                />
                <input
                  className="form-input form-input--number"
                  type="number"
                  min={MIN_GRAPH_PAGE_SIZE}
                  max={MAX_GRAPH_PAGE_SIZE}
                  step={250}
                  value={draft.graphPageSize}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      graphPageSize: Number.parseInt(event.target.value, 10) || MIN_GRAPH_PAGE_SIZE
                    }))
                  }
                />
              </label>
              <label className="settings-row">
                <SettingCopy label="Large-repo mode" help="Renders fewer offscreen commits to reduce memory use." />
                <input
                  type="checkbox"
                  checked={draft.largeRepoMode}
                  onChange={(event) => setDraft((value) => ({ ...value, largeRepoMode: event.target.checked }))}
                />
              </label>
              <label className="settings-row">
                <SettingCopy label="Show short commit SHAs" />
                <input
                  type="checkbox"
                  checked={draft.graphColumns.sha}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      graphColumns: { ...value.graphColumns, sha: event.target.checked }
                    }))
                  }
                />
              </label>
              <label className="settings-row">
                <SettingCopy
                  label="Load remote author avatars"
                  help="Uses GitHub identities for GitHub repositories, then falls back to Gravatar. Disable to keep author identities local."
                />
                <input
                  type="checkbox"
                  checked={draft.remoteAvatars}
                  onChange={(event) => setDraft((value) => ({ ...value, remoteAvatars: event.target.checked }))}
                />
              </label>
            </div>
          </section>

          <section className="settings-group">
            <SettingHeading icon={<RefreshCw size={15} />} label="Repositories" />
            <div className="settings-group-body">
              <label className="settings-row">
                <SettingCopy
                  label="Auto-fetch interval (minutes)"
                  help="Fetch remote updates for open repositories, even while the app is in the background. Auto-fetch yields to your Git actions. Use 0 to turn off auto-fetch. This never pulls or changes working files."
                />
                <input
                  className="form-input form-input--number"
                  type="number"
                  min={MIN_AUTO_FETCH_INTERVAL_MINUTES}
                  max={MAX_AUTO_FETCH_INTERVAL_MINUTES}
                  step={1}
                  value={draft.autoFetchIntervalMinutes}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      autoFetchIntervalMinutes:
                        Number.parseInt(event.target.value, 10) ||
                        MIN_AUTO_FETCH_INTERVAL_MINUTES
                    }))
                  }
                />
              </label>
            </div>
          </section>

          <ProfileSettingsSection
            heading={<SettingHeading icon={<UserRound size={15} />} label="Profiles" note="Changes here apply right away." />}
            profileState={profileState}
            onSaveProfile={onSaveProfile}
          />

          <MachineSettingsSection heading={<SettingHeading icon={<Monitor size={15} />} label="Machines" note="Changes here apply right away." />} />

          <section className="settings-group">
            <SettingHeading icon={<Bot size={15} />} label="Codex" note="Install and remove apply right away." />
            <div className="settings-group-body">
              <div className="settings-row">
                <span className="settings-row-copy">
                  <span className="settings-row-label">Agent Notes skill</span>
                  <span className="settings-row-help">
                    Lets Codex decide whether a changed line needs a short implementation note. Most tasks produce none.
                  </span>
                  <span className="settings-row-help">
                    Once installed, this works for local Codex tasks started anywhere, not only tasks opened from Git Gud.
                  </span>
                </span>
                <CodexSkillStatus state={codexSkillState} />
              </div>

              <div className="settings-row">
                <div className="settings-row-copy">
                  {codexSkillState ? (
                    <code className="settings-row-path" title={codexSkillState.installPath}>
                      {codexSkillState.installPath}
                    </code>
                  ) : null}

                  {codexSkillState?.message ? (
                    <p className="mt-2 text-[12px] leading-4 text-[var(--warning-text)]">{codexSkillState.message}</p>
                  ) : null}
                  {codexSkillErrorMessage ? (
                    <p className="mt-2 text-[12px] leading-4 text-[var(--danger-text)]" role="alert">{codexSkillErrorMessage}</p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  {codexSkillState?.status === 'installed' ? (
                    <button
                      className="btn-subtle h-8 text-xs"
                      type="button"
                      disabled={isCodexSkillBusy}
                      onClick={() => void onRemoveCodexSkill()}
                    >
                      <Trash2 size={12} />
                      Remove skill
                    </button>
                  ) : codexSkillState?.status === 'conflict' ? null : (
                    <button
                      className="btn-primary h-8 text-xs"
                      type="button"
                      disabled={isCodexSkillBusy || !codexSkillState}
                      onClick={() => void onInstallCodexSkill()}
                    >
                      <Download size={12} />
                      {codexSkillState?.status === 'update-available' ? 'Update skill' : 'Install skill'}
                    </button>
                  )}
                  {codexSkillState?.status === 'update-available' ? (
                    <button
                      className="btn-subtle h-8 text-xs"
                      type="button"
                      disabled={isCodexSkillBusy}
                      onClick={() => void onRemoveCodexSkill()}
                    >
                      <Trash2 size={12} />
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="settings-group">
            <SettingHeading icon={<ShieldAlert size={15} />} label="Safety" />
            <div className="settings-group-body">
              <label className="settings-row">
                <SettingCopy
                  label="Confirm before force pushing"
                  help="Show a destructive-action warning before replacing remote branch history."
                />
                <input
                  type="checkbox"
                  checked={draft.confirmForcePush}
                  onChange={(event) => setDraft((value) => ({ ...value, confirmForcePush: event.target.checked }))}
                />
              </label>
            </div>
          </section>

          {errorMessage ? <p className="mt-4 text-[12px] text-[var(--danger-text)]" role="alert">{errorMessage}</p> : null}
        </div>

        <footer className="flex min-h-14 items-center justify-end gap-2 border-t border-[var(--border)] px-5">
          <button className="btn-subtle h-8 text-xs" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary h-8 text-xs" type="submit" disabled={isSaving}>
            Save settings
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
}

function CodexSkillStatus({ state }: { state?: CodexAgentNotesSkillState }): ReactElement {
  const label = state
    ? {
        'not-installed': 'Not installed',
        installed: 'Installed',
        'update-available': 'Update available',
        conflict: 'Needs attention'
      }[state.status]
    : 'Checking';

  return (
    <span
      className="shrink-0 rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-2)]"
      data-status={state?.status ?? 'checking'}
    >
      {label}
    </span>
  );
}

function SyntaxThemeOption({
  label,
  description,
  colors,
  value,
  selected,
  onSelect
}: {
  label: string;
  description: string;
  colors: readonly string[];
  value: DiffSyntaxTheme;
  selected: DiffSyntaxTheme;
  onSelect: (value: DiffSyntaxTheme) => void;
}): ReactElement {
  const isSelected = selected === value;

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      className={`min-w-0 rounded-md border px-3 py-2.5 text-left transition ${
        isSelected
          ? 'border-[var(--select-border)] bg-[var(--select-bg)]'
          : 'border-[var(--border)] bg-[var(--bg-field)] hover:border-[var(--border-strong)]'
      }`}
      onClick={() => onSelect(value)}
    >
      <span className="mb-2 flex gap-1" aria-hidden="true">
        {colors.map((color) => (
          <span key={color} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: color }} />
        ))}
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="block truncate text-[13px] leading-5 text-[var(--text-1)]">{label}</span>
        {isSelected ? <Check size={13} className="shrink-0 text-[var(--accent-2)]" aria-hidden="true" /> : null}
      </span>
      <span className="mt-1 block text-[12px] leading-4 text-[var(--text-3)]">{description}</span>
    </button>
  );
}

function SettingCopy({ label, help }: { label: string; help?: string }): ReactElement {
  return (
    <span className="settings-row-copy">
      <span className="settings-row-label">{label}</span>
      {help ? <span className="settings-row-help">{help}</span> : null}
    </span>
  );
}

function SettingHeading({ icon, label, note }: { icon: ReactElement; label: string; note?: string }): ReactElement {
  return (
    <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-1)]">
      <span className="text-[var(--text-3)]">{icon}</span>
      {label}
      {note ? <span className="ml-auto text-[12px] font-normal text-[var(--text-3)]">{note}</span> : null}
    </h3>
  );
}
