import type { ReactElement } from 'react';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitMerge,
  Loader2,
  MonitorUp,
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

import { PullRequestGitHubLink } from './PullRequestGitHubLink';

type PullRequestHeaderActionsProps = {
  detail: GitHubPullRequestDetail;
  repoPath?: string;
  isOverviewOpen: boolean;
  reviewDraftCount: number;
  mergeLabel: string;
  mergeDisabled: boolean;
  mergeTitle: string;
  isMergePending: boolean;
  onToggleOverview: () => void;
  onFinishReview: () => void;
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
  reviewDraftCount,
  mergeLabel,
  mergeDisabled,
  mergeTitle,
  isMergePending,
  onToggleOverview,
  onFinishReview,
  onOpenMerge,
  onClose,
  onNotice
}: PullRequestHeaderActionsProps): ReactElement {
  const openApplication = useOpenApplication(detail, repoPath, onNotice);
  const compactTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingActionRef = useRef<(() => void) | undefined>(undefined);
  const finishReviewLabel = reviewDraftCount > 0
    ? `Finish review · ${reviewDraftCount}`
    : 'Finish review';

  function runAfterMenuClose(action: () => void): void {
    pendingActionRef.current = action;
  }

  return (
    <>
      <div className="pr-review-header-actions max-[1600px]:hidden!">
        <button
          className="btn-subtle btn-regular pr-review-overview-button"
          type="button"
          aria-controls="pr-review-overview-panel"
          aria-expanded={isOverviewOpen}
          onClick={onToggleOverview}
        >
          <ChevronDown size={13} />
          Overview
        </button>
        <OpenApplicationSplitButton controller={openApplication} />
        <PullRequestGitHubLink url={detail.url} onNotice={onNotice} />
        <button className="btn-subtle btn-regular" type="button" onClick={onFinishReview}>
          <ShieldCheck size={13} />
          {finishReviewLabel}
        </button>
        <button
          className="btn-primary btn-regular"
          type="button"
          disabled={mergeDisabled}
          title={mergeTitle}
          onClick={onOpenMerge}
        >
          <GitMerge size={13} />
          {mergeLabel}
        </button>
        <CloseReviewButton onClose={onClose} />
      </div>

      <div className="hidden shrink-0 items-center gap-1.5 max-[1600px]:flex">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              ref={compactTriggerRef}
              className="icon-btn icon-btn-regular shrink-0"
              type="button"
              aria-label="Pull request actions"
              title="Pull request actions"
            >
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={5}
            className="w-64"
            aria-label="Pull request actions"
            onCloseAutoFocus={(event) => {
              const action = pendingActionRef.current;

              if (!action) {
                return;
              }

              event.preventDefault();
              pendingActionRef.current = undefined;
              compactTriggerRef.current?.focus({ preventScroll: true });
              action();
            }}
          >
            <DropdownMenuLabel>Pull request actions</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => runAfterMenuClose(onToggleOverview)}>
              <ChevronDown
                className={isOverviewOpen ? 'rotate-180' : undefined}
                size={14}
              />
              <span className="min-w-0 flex-1 truncate">
                {isOverviewOpen ? 'Hide overview' : 'Show overview'}
              </span>
            </DropdownMenuItem>
            <OpenApplicationSubmenu controller={openApplication} />
            <DropdownMenuItem asChild>
              <a
                href={detail.url}
                target="_blank"
                rel="noreferrer"
                className="no-underline"
              >
                <ExternalLink size={14} />
                <span className="min-w-0 flex-1 truncate">Open on GitHub</span>
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => runAfterMenuClose(onFinishReview)}>
              <ShieldCheck size={14} />
              <span className="min-w-0 flex-1 truncate">{finishReviewLabel}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={mergeDisabled}
              title={mergeTitle}
              onSelect={() => runAfterMenuClose(onOpenMerge)}
            >
              {isMergePending ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <GitMerge size={14} />
              )}
              <span className="min-w-0 flex-1 truncate">{mergeLabel}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CloseReviewButton onClose={onClose} />
      </div>
    </>
  );
}

function OpenApplicationSplitButton({
  controller
}: {
  controller: OpenApplicationController;
}): ReactElement {
  const disabled = Boolean(controller.unavailableReason) || controller.isOpening;

  return (
    <div
      className="inline-flex h-8 shrink-0 overflow-hidden rounded-[5px] border border-[var(--border-strong)] bg-[var(--bg-field)]"
      aria-label="Open pull request in another application"
      role="group"
    >
      <button
        className="grid h-[30px] w-8 place-items-center text-[var(--text-2)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)] disabled:text-[var(--text-3)] disabled:opacity-60"
        type="button"
        disabled={disabled || !controller.selectedApplication}
        title={
          controller.unavailableReason ??
          `Open temporary checkout in ${controller.selectedApplication?.name ?? 'application'}`
        }
        aria-label={
          controller.unavailableReason ??
          `Open pull request in ${controller.selectedApplication?.name ?? 'application'}`
        }
        onClick={() => {
          if (controller.selectedApplication) {
            controller.openInApplication(controller.selectedApplication);
          }
        }}
      >
        {controller.isOpening || controller.isLoading ? (
          <Loader2 className="animate-spin" size={15} />
        ) : controller.selectedApplication ? (
          <ApplicationIcon application={controller.selectedApplication} size={18} />
        ) : (
          <MonitorUp size={15} />
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="grid h-[30px] w-6 place-items-center border-l border-[var(--border)] text-[var(--text-3)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)] disabled:opacity-60"
            type="button"
            disabled={disabled}
            title={controller.unavailableReason ?? 'Choose application'}
            aria-label="Choose application for opening this pull request"
          >
            <ChevronDown size={13} />
          </button>
        </DropdownMenuTrigger>
        <ApplicationMenuContent controller={controller} align="end" />
      </DropdownMenu>
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

function ApplicationMenuContent({
  controller,
  align
}: {
  controller: OpenApplicationController;
  align: 'start' | 'center' | 'end';
}): ReactElement {
  return (
    <DropdownMenuContent
      align={align}
      sideOffset={5}
      className="w-56"
      aria-label="Open pull request in"
    >
      <ApplicationMenuItems controller={controller} />
    </DropdownMenuContent>
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
