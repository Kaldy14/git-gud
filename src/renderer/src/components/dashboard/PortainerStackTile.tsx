import type { ReactElement } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash2,
  ExternalLink,
  Layers,
  Loader2,
  Pencil,
  X,
  XCircle
} from 'lucide-react';

import {
  usePortainerStackImages,
  usePortainerStackRuntime
} from '@renderer/queries/portainer';
import type {
  PortainerServiceHealth,
  PortainerStackDashboardTile
} from '@shared/types';

import {
  formatRunningAge,
  portainerImagePresentation,
  portainerImageSummary,
  portainerServiceHealthPresentation,
  portainerStackHealthPresentation,
  type PortainerStatusTone
} from './portainerPresentation';

type PortainerStackTileProps = {
  tile: PortainerStackDashboardTile;
  dragHandle: ReactElement;
  isSaving: boolean;
  onEdit: () => void;
  onRemove: () => void;
};

export function PortainerStackTile({
  tile,
  dragHandle,
  isSaving,
  onEdit,
  onRemove
}: PortainerStackTileProps): ReactElement {
  const input = {
    connectionId: tile.connectionId,
    endpointId: tile.endpointId,
    stackId: tile.stackId,
    stackName: tile.stackName
  };
  const runtimeQuery = usePortainerStackRuntime(input);
  const imagesQuery = usePortainerStackImages(input);
  const runtime = runtimeQuery.data;
  const imagesByService = new Map(
    (imagesQuery.data?.services ?? []).map((service) => [service.serviceId, service])
  );
  const healthPresentation = runtime
    ? portainerStackHealthPresentation(runtime.health)
    : undefined;
  const imageSummary = portainerImageSummary(
    (imagesQuery.data?.services ?? []).map((service) => service.freshness),
    {
      loading: imagesQuery.isLoading,
      error: Boolean(imagesQuery.error)
    }
  );

  return (
    <article
      className="actions-tile portainer-tile"
      aria-label={`${tile.environmentName}/${tile.stackName} Portainer Swarm stack`}
    >
      <header className="actions-tile-header">
        <div className="actions-tile-identity portainer-tile-identity">
          <span className="portainer-tile-icon" aria-hidden="true">
            <Layers size={14} />
          </span>
          <span className="min-w-0">
            <strong>
              <span>{tile.environmentName}/</span>
              {tile.stackName}
            </strong>
            <small>Portainer · Swarm stack</small>
          </span>
        </div>
        <div className="actions-tile-header-actions">
          {runtimeQuery.isFetching && runtime ? (
            <span className="actions-summary" data-tone="running">
              <Loader2 size={11} className="animate-spin" />
              Refreshing
            </span>
          ) : healthPresentation ? (
            <span className="actions-summary" data-tone={healthPresentation.tone}>
              <StatusIcon tone={healthPresentation.tone} size={11} />
              {healthPresentation.label}
            </span>
          ) : null}
          <button
            className="actions-tile-edit icon-btn"
            type="button"
            disabled={isSaving}
            aria-label={`Edit ${tile.environmentName}/${tile.stackName} tile`}
            title="Edit tile"
            onClick={onEdit}
          >
            <Pencil size={11} />
          </button>
          {dragHandle}
          <button
            className="actions-tile-remove icon-btn"
            type="button"
            disabled={isSaving}
            aria-label={`Remove ${tile.environmentName}/${tile.stackName} tile`}
            title="Remove tile"
            onClick={onRemove}
          >
            <X size={11} />
          </button>
        </div>
      </header>

      {runtimeQuery.error ? (
        <div className="actions-tile-error" role="alert">
          <AlertTriangle size={13} />
          <span>{errorMessage(runtimeQuery.error)}</span>
          <button type="button" onClick={() => void runtimeQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : null}

      {runtimeQuery.isLoading && !runtime ? (
        <div className="actions-tile-loading" role="status">
          <Loader2 size={18} className="animate-spin" />
          <span>Loading Swarm stack…</span>
        </div>
      ) : runtime ? (
        <>
          <div className="portainer-stack-summary">
            <SummaryCell
              label="Services"
              value={`${runtime.services.filter((service) => service.health === 'healthy').length} / ${runtime.services.length}`}
              detail={runtime.services.every((service) => service.health === 'healthy') ? 'healthy' : 'ready'}
              tone={healthPresentation?.tone ?? 'neutral'}
            />
            <SummaryCell
              label="Tasks"
              value={`${runtime.runningTasks} / ${runtime.desiredTasks}`}
              detail="running"
              tone={
                runtime.runningTasks === runtime.desiredTasks
                  ? 'success'
                  : runtime.runningTasks > 0
                    ? 'running'
                    : 'danger'
              }
            />
            <SummaryCell
              label="Images"
              value={imageSummary.value}
              detail={imageSummary.detail}
              tone={imageSummary.tone}
            />
          </div>

          <div className="portainer-service-list">
            {runtime.services.map((service) => {
              const imageStatus = imagesByService.get(service.id);
              const imagePresentation = portainerImagePresentation(
                imageStatus?.freshness ?? (imagesQuery.isLoading ? 'checking' : 'unknown')
              );

              return (
                <div
                  className="portainer-service-row"
                  key={service.id}
                  title={service.lastError}
                >
                  <span
                    className="portainer-service-status"
                    data-tone={portainerServiceHealthPresentation(service.health).tone}
                    aria-label={portainerServiceHealthPresentation(service.health).label}
                  >
                    <ServiceStatusIcon health={service.health} />
                  </span>
                  <span className="portainer-service-copy">
                    <strong title={service.name}>{service.name}</strong>
                    <code title={service.image}>{service.image}</code>
                  </span>
                  <span className="portainer-service-replicas">
                    {service.runningTasks} / {service.desiredTasks}
                  </span>
                  <span
                    className="portainer-image-status"
                    data-tone={imagePresentation.tone}
                    title={imageStatus?.message}
                  >
                    <StatusIcon tone={imagePresentation.tone} size={11} />
                    {imagePresentation.label}
                  </span>
                  <span className="portainer-service-age">
                    {formatRunningAge(service.runningSince)}
                  </span>
                </div>
              );
            })}
          </div>

          <footer className="portainer-tile-footer">
            <span>Health {formatLoadedAt(runtime.loadedAt)}</span>
            <span>
              Images{' '}
              {imagesQuery.data
                ? formatLoadedAt(imagesQuery.data.loadedAt)
                : imagesQuery.error
                  ? 'unavailable'
                  : 'checking'}
            </span>
            <span>Auto · 20s / 10m</span>
            <a
              href={runtime.portainerUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${tile.stackName} in Portainer`}
            >
              Open in Portainer
              <ExternalLink size={11} />
            </a>
          </footer>
        </>
      ) : !runtimeQuery.error ? (
        <div className="actions-tile-empty">
          <CircleSlash2 size={17} />
          <span>No Swarm services found.</span>
        </div>
      ) : null}
    </article>
  );
}

function SummaryCell({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail?: string;
  tone: PortainerStatusTone;
}): ReactElement {
  return (
    <span className="portainer-summary-cell">
      <small>{label}</small>
      <strong data-tone={tone}>
        <span className="portainer-status-dot" />
        {value}
        {detail ? <span>{detail}</span> : null}
      </strong>
    </span>
  );
}

function ServiceStatusIcon({ health }: { health: PortainerServiceHealth }): ReactElement {
  const tone = portainerServiceHealthPresentation(health).tone;
  return <StatusIcon tone={tone} size={13} />;
}

function StatusIcon({
  tone,
  size
}: {
  tone: PortainerStatusTone;
  size: number;
}): ReactElement {
  if (tone === 'success') {
    return <CheckCircle2 size={size} />;
  }

  if (tone === 'running') {
    return <Loader2 size={size} className="animate-spin" />;
  }

  if (tone === 'danger') {
    return <XCircle size={size} />;
  }

  return <CircleSlash2 size={size} />;
}

function formatLoadedAt(value: string): string {
  const elapsedMs = Date.now() - new Date(value).getTime();

  if (!Number.isFinite(elapsedMs) || elapsedMs < 45_000) {
    return 'just now';
  }

  const minutes = Math.floor(elapsedMs / 60_000);
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'Unable to load the Portainer stack.';
}
