import type { ReactElement } from 'react';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderTree,
  GitMerge,
  Loader2,
  MonitorUp,
  PanelRightOpen,
  MoreHorizontal,
  ShieldCheck,
  X
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu';
import type {
  ExternalApplication,
  ExternalApplicationId
} from '@shared/externalApplications';
import { isExternalApplicationId } from '@shared/externalApplications';
import type { GitHubPullRequestDetail } from '@shared/types';


type PullRequestHeaderActionsProps = {
  detail: GitHubPullRequestDetail;
  repoPath?: string;
  isOverviewOpen: boolean;
  isAllFilesOpen: boolean;
  reviewDraftCount: number;
  mergeLabel: string;
  mergeDisabled: boolean;
  mergeTitle: string;
  isMergePending: boolean;
  onToggleOverview: () => void;
  onToggleAllFiles: () => void;
  onFinishReview: () => void;
  onSelectReviewDecision: (event: 'comment' | 'approve' | 'request-changes') => void;
  onOpenMerge: () => void;
  onClose: () => void;
  onNotice: (notice: { tone: 'success' | 'danger'; message: string }) => void;
};

type OpenApplicationController = {
  applications: readonly ExternalApplication[];
  selectedApplication?: ExternalApplication;
  unavailableReason?: string;
  isLoading: boolean;
  isOpening: boolean;
  openInApplication: (application: ExternalApplication) => void;
};

const preferredApplicationStorageKey = 'git-gud:open-pr-application:v1';
const emptyApplications: readonly ExternalApplication[] = [];

export function PullRequestHeaderActions({
  detail,
  repoPath,
  isOverviewOpen,
  isAllFilesOpen,
  reviewDraftCount,
  mergeLabel,
  mergeDisabled,
  mergeTitle,
  isMergePending,
  onToggleOverview,
  onToggleAllFiles,
  onFinishReview,
  onSelectReviewDecision,
  onOpenMerge,
  onClose,
  onNotice
}: PullRequestHeaderActionsProps): ReactElement {
  const openApplication = useOpenApplication(detail, repoPath, onNotice);
  const compactTriggerRef = useRef<HTMLButtonElement>(null);
  const decisionTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingActionRef = useRef<(() => void) | undefined>(undefined);
  const finishReviewLabel = reviewDraftCount > 0 ? `Review · ${reviewDraftCount}` : 'Review';
  const isOwnPullRequest = detail.author.toLowerCase() === detail.viewerLogin.toLowerCase();

  function runAfterMenuClose(action: () => void): void {
    pendingActionRef.current = action;
  }

  return (
    <div className="pr-review-header-actions pr-review-actions-persistent">
      <button className="btn-subtle btn-regular" type="button" aria-pressed={isAllFilesOpen} aria-expanded={isAllFilesOpen} onClick={onToggleAllFiles} title={isAllFilesOpen ? 'Hide all changed files' : 'Show all changed files'}>
        <FolderTree size={13} />All files
      </button>
      <button
        className="btn-subtle btn-regular"
        type="button"
        aria-expanded={isOverviewOpen}
        aria-pressed={isOverviewOpen}
        onClick={onToggleOverview}
      >
        <PanelRightOpen size={13} />
        Details
      </button>
      <div className="pr-review-decision-split">
        <button className="btn-primary btn-regular" type="button" onClick={onFinishReview}>
          <ShieldCheck size={13} />
          {finishReviewLabel}
        </button>
        {!isOwnPullRequest ? <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              ref={decisionTriggerRef}
              className="btn-primary btn-regular"
              type="button"
              aria-label="Choose review decision"
            >
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            aria-label="Review decision"
            onCloseAutoFocus={(event) => {
              const action = pendingActionRef.current;
              if (!action) return;
              event.preventDefault();
              pendingActionRef.current = undefined;
              decisionTriggerRef.current?.focus({ preventScroll: true });
              action();
            }}
          >
            <DropdownMenuItem
              onSelect={() => runAfterMenuClose(() => onSelectReviewDecision('comment'))}
            >
              Send comments
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => runAfterMenuClose(() => onSelectReviewDecision('approve'))}
            >
              Approve
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => runAfterMenuClose(() => onSelectReviewDecision('request-changes'))}
            >
              Request changes
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu> : null}
      </div>
      <button
        className="btn-subtle btn-regular pr-header-merge"
        type="button"
        disabled={mergeDisabled}
        title={mergeTitle}
        aria-label={mergeLabel}
        onClick={onOpenMerge}
      >
        {isMergePending ? <Loader2 size={13} /> : <GitMerge size={13} />}
        <span className="pr-merge-label-full">{mergeLabel}</span>
        <span className="pr-merge-label-compact" aria-hidden="true">Merge</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={compactTriggerRef}
            className="icon-btn icon-btn-regular"
            type="button"
            aria-label="More pull request actions"
          >
            <MoreHorizontal size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64"
          aria-label="Pull request actions"
          onCloseAutoFocus={(event) => {
            const action = pendingActionRef.current;
            if (!action) return;
            event.preventDefault();
            pendingActionRef.current = undefined;
            compactTriggerRef.current?.focus({ preventScroll: true });
            action();
          }}
        >
          <DropdownMenuLabel>Pull request actions</DropdownMenuLabel>
          <OpenApplicationSubmenu controller={openApplication} />
          <DropdownMenuItem asChild>
            <a href={detail.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              Open on GitHub
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={mergeDisabled}
            title={mergeTitle}
            onSelect={() => runAfterMenuClose(onOpenMerge)}
          >
            <GitMerge size={14} />
            {mergeLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CloseReviewButton onClose={onClose} />
    </div>
  );
}

function OpenApplicationSubmenu({
  controller
}: {
  controller: OpenApplicationController;
}): ReactElement {
  const disabled = Boolean(controller.unavailableReason) || controller.isOpening;
  const label = controller.selectedApplication
    ? `Open in ${controller.selectedApplication.name}`
    : 'Open in application';

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled} title={controller.unavailableReason}>
        {controller.isOpening || controller.isLoading ? (
          <Loader2 className="animate-spin" size={14} />
        ) : controller.selectedApplication ? (
          <ApplicationIcon application={controller.selectedApplication} size={18} />
        ) : (
          <MonitorUp size={14} />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight className="text-[var(--text-3)]" size={13} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        sideOffset={5}
        className="w-56"
        aria-label="Open pull request in"
      >
        <ApplicationMenuItems controller={controller} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ApplicationMenuItems({
  controller
}: {
  controller: OpenApplicationController;
}): ReactElement {
  return (
    <>
      {controller.applications.map((application) => (
        <DropdownMenuItem
          key={application.id}
          className="min-h-9"
          onSelect={() => controller.openInApplication(application)}
        >
          <ApplicationIcon application={application} size={20} />
          <span className="min-w-0 flex-1 truncate">{application.name}</span>
          {controller.selectedApplication?.id === application.id ? (
            <Check className="text-[var(--accent-2)]" size={14} />
          ) : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function CloseReviewButton({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <button
      className="icon-btn icon-btn-regular shrink-0"
      type="button"
      onClick={onClose}
      aria-label="Close pull request review and return to commit graph"
      title="Return to commit graph"
    >
      <X size={14} />
    </button>
  );
}

function ApplicationIcon({
  application,
  size
}: {
  application: ExternalApplication;
  size: number;
}): ReactElement {
  return (
    <img
      src={application.iconDataUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-[4px]"
      draggable={false}
    />
  );
}

function useOpenApplication(
  detail: GitHubPullRequestDetail,
  repoPath: string | undefined,
  onNotice: PullRequestHeaderActionsProps['onNotice']
): OpenApplicationController {
  const applicationsQuery = useQuery({
    queryKey: ['system', 'external-applications'],
    queryFn: () => window.api.listExternalApplications(),
    staleTime: Number.POSITIVE_INFINITY
  });
  const applications = applicationsQuery.data ?? emptyApplications;
  const [preferredApplicationId, setPreferredApplicationId] = useState<
    ExternalApplicationId | undefined
  >(() => loadPreferredApplication(window.localStorage));
  const selectedApplication = useMemo(
    () => selectApplication(applications, preferredApplicationId),
    [applications, preferredApplicationId]
  );
  const openMutation = useMutation({
    mutationFn: (application: ExternalApplication) => {
      if (!repoPath) {
        throw new Error('Open this pull request repository locally first.');
      }

      return window.api.openGitHubPullRequestInApplication(repoPath, {
        applicationId: application.id,
        url: detail.url,
        owner: detail.owner,
        repository: detail.repository,
        number: detail.number,
        headSha: detail.headSha
      });
    },
    onSuccess: (result) => {
      onNotice({ tone: 'success', message: result.message });
    },
    onError: (error) => {
      onNotice({
        tone: 'danger',
        message: error instanceof Error
          ? error.message
          : 'Could not open the pull request in that application.'
      });
    }
  });
  const unavailableReason = !repoPath
    ? 'Open this pull request repository locally first'
    : applicationsQuery.isLoading
      ? 'Finding installed applications…'
      : applicationsQuery.isError
        ? 'Installed applications could not be loaded'
        : applications.length === 0
          ? 'No supported applications were found'
          : undefined;

  function openInApplication(application: ExternalApplication): void {
    setPreferredApplicationId(application.id);
    savePreferredApplication(window.localStorage, application.id);
    openMutation.mutate(application);
  }

  return {
    applications,
    selectedApplication,
    unavailableReason,
    isLoading: applicationsQuery.isLoading,
    isOpening: openMutation.isPending,
    openInApplication
  };
}

function selectApplication(
  applications: readonly ExternalApplication[],
  preferredApplicationId: ExternalApplicationId | undefined
): ExternalApplication | undefined {
  return (
    applications.find((application) => application.id === preferredApplicationId) ??
    applications.find((application) => application.id === 'cursor') ??
    applications.find((application) => application.id === 'vscode') ??
    applications[0]
  );
}

function loadPreferredApplication(storage: Storage): ExternalApplicationId | undefined {
  const value = storage.getItem(preferredApplicationStorageKey);
  return value && isExternalApplicationId(value) ? value : undefined;
}

function savePreferredApplication(
  storage: Storage,
  applicationId: ExternalApplicationId
): void {
  storage.setItem(preferredApplicationStorageKey, applicationId);
}
