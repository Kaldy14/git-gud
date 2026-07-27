import type { FormEvent, ReactElement } from 'react';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  Trash2,
  X
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import {
  clearPortainerConnectionQueries,
  portainerConnectionsQueryKey,
  usePortainerConnections
} from '@renderer/queries/portainer';
import type {
  PortainerConnection,
  PortainerConnectionInput,
  PortainerConnectionTestResult
} from '@shared/types';

type PortainerConnectionDialogProps = {
  initialConnectionId?: string;
  onClose: () => void;
  onSaved: (connectionId: string) => void;
};

type ConnectionFormState = {
  id?: string;
  name: string;
  baseUrl: string;
  accessToken: string;
  tlsVerify: boolean;
};

const emptyConnectionForm: ConnectionFormState = {
  name: '',
  baseUrl: 'https://',
  accessToken: '',
  tlsVerify: true
};

export function PortainerConnectionDialog({
  initialConnectionId,
  onClose,
  onSaved
}: PortainerConnectionDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const connectionsQuery = usePortainerConnections();
  const connections = useMemo(
    () => connectionsQuery.data ?? [],
    [connectionsQuery.data]
  );
  const [editedForm, setEditedForm] = useState<ConnectionFormState>();
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string>();
  const [testResult, setTestResult] = useState<PortainerConnectionTestResult>();
  const initialConnection =
    connections.find((candidate) => candidate.id === initialConnectionId) ??
    connections[0];
  const form =
    editedForm ??
    (initialConnection ? connectionForm(initialConnection) : emptyConnectionForm);

  function selectConnection(connectionId: string): void {
    setError(undefined);
    setTestResult(undefined);
    setConfirmDelete(false);

    if (!connectionId) {
      setEditedForm(emptyConnectionForm);
      return;
    }

    const connection = connections.find((candidate) => candidate.id === connectionId);

    if (connection) {
      setEditedForm(connectionForm(connection));
    }
  }

  async function testConnection(): Promise<void> {
    setIsTesting(true);
    setError(undefined);
    setTestResult(undefined);

    try {
      setTestResult(await window.api.testPortainerConnection(connectionInput(form)));
    } catch (testError) {
      setError(errorMessage(testError));
    } finally {
      setIsTesting(false);
    }
  }

  async function saveConnection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    const previousIds = new Set(connections.map((connection) => connection.id));

    try {
      const nextConnections = await window.api.savePortainerConnection(
        connectionInput(form)
      );
      queryClient.setQueryData(portainerConnectionsQueryKey, nextConnections);
      const savedConnection = form.id
        ? nextConnections.find((connection) => connection.id === form.id)
        : nextConnections.find((connection) => !previousIds.has(connection.id));

      if (!savedConnection) {
        throw new Error('The Portainer connection was saved but could not be selected.');
      }

      if (form.id) {
        clearPortainerConnectionQueries(queryClient, form.id);
      }
      onSaved(savedConnection.id);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteConnection(): Promise<void> {
    if (!form.id) {
      return;
    }

    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setIsDeleting(true);
    setError(undefined);

    try {
      const nextConnections = await window.api.deletePortainerConnection(form.id);
      clearPortainerConnectionQueries(queryClient, form.id);
      queryClient.setQueryData(portainerConnectionsQueryKey, nextConnections);
      setEditedForm(
        nextConnections[0] ? connectionForm(nextConnections[0]) : emptyConnectionForm
      );
      setConfirmDelete(false);
      setTestResult(undefined);
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <ModalSurface
      labelledBy="portainer-connection-dialog-title"
      describedBy="portainer-connection-dialog-description"
      className="dashboard-dialog portainer-connection-dialog"
      onClose={onClose}
    >
      <form onSubmit={(event) => void saveConnection(event)}>
        <header>
          <div>
            <span className="dashboard-kicker">Portainer</span>
            <h2 id="portainer-connection-dialog-title">Connection</h2>
            <p id="portainer-connection-dialog-description">
              Configure a reusable Business Edition API connection.
            </p>
          </div>
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>

        <div className="dashboard-dialog-body">
          {connections.length > 0 ? (
            <label className="dashboard-field">
              <span>Saved connection</span>
              <select
                value={form.id ?? ''}
                onChange={(event) => selectConnection(event.target.value)}
              >
                <option value="">New connection</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="portainer-connection-fields">
            <label className="dashboard-field">
              <span>Name</span>
              <input
                data-modal-initial-focus="true"
                value={form.name}
                maxLength={80}
                placeholder="Production Portainer"
                required
                onChange={(event) =>
                  setEditedForm({ ...form, name: event.target.value })
                }
              />
            </label>
            <label className="dashboard-field">
              <span>Portainer URL</span>
              <input
                type="url"
                value={form.baseUrl}
                maxLength={2_048}
                placeholder="https://portainer.example.com"
                required
                spellCheck={false}
                onChange={(event) =>
                  setEditedForm({ ...form, baseUrl: event.target.value })
                }
              />
            </label>
          </div>

          <label className="dashboard-field">
            <span>Personal access token</span>
            <input
              type="password"
              value={form.accessToken}
              maxLength={8_192}
              placeholder={
                form.id
                  ? 'Leave blank to keep the stored token'
                  : 'Paste token from My account → Access tokens'
              }
              autoComplete="off"
              required={!form.id}
              onChange={(event) =>
                setEditedForm({ ...form, accessToken: event.target.value })
              }
            />
          </label>

          <label className="portainer-tls-field">
            <input
              type="checkbox"
              checked={form.tlsVerify}
              onChange={(event) =>
                setEditedForm({ ...form, tlsVerify: event.target.checked })
              }
            />
            <span>Verify TLS certificate</span>
          </label>

          <div className="dashboard-dialog-note">
            <KeyRound size={13} />
            <span>
              The token is encrypted with macOS secure storage and sent only from the
              Electron main process as <code>X-API-Key</code>.
            </span>
          </div>

          {testResult ? (
            <div className="portainer-connection-success" role="status">
              <CheckCircle2 size={13} />
              <span>
                Connected{testResult.version ? ` to Portainer ${testResult.version}` : ''}.{' '}
                {testResult.dockerEnvironmentCount} Docker environment
                {testResult.dockerEnvironmentCount === 1 ? '' : 's'} available
                {testResult.swarmEnvironmentCount > 0
                  ? ` (${testResult.swarmEnvironmentCount} Swarm)`
                  : ''}
                .
              </span>
            </div>
          ) : null}

          {confirmDelete ? (
            <div className="dashboard-delete-warning">
              <AlertTriangle size={16} />
              <span>
                Delete this connection? Existing tiles will keep their configuration but
                cannot refresh.
              </span>
            </div>
          ) : null}

          {connectionsQuery.error || error ? (
            <div className="dashboard-dialog-error" role="alert">
              <AlertTriangle size={13} />
              {error ?? errorMessage(connectionsQuery.error)}
            </div>
          ) : null}
        </div>

        <footer className="portainer-connection-footer">
          <span>
            {form.id ? (
              <button
                className={confirmDelete ? 'btn-danger' : 'btn-subtle'}
                type="button"
                disabled={isDeleting}
                onClick={() => void deleteConnection()}
              >
                {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {confirmDelete ? 'Confirm delete' : 'Delete'}
              </button>
            ) : (
              <button
                className="btn-subtle"
                type="button"
                onClick={() => selectConnection('')}
              >
                <Plus size={13} />
                New
              </button>
            )}
          </span>
          <span className="portainer-connection-footer-actions">
            <button
              className="btn-subtle"
              type="button"
              disabled={isTesting || !form.name.trim() || !form.baseUrl.trim()}
              onClick={() => void testConnection()}
            >
              {isTesting ? <Loader2 size={13} className="animate-spin" /> : null}
              Test connection
            </button>
            <button
              className="btn-primary"
              type="submit"
              disabled={
                isSaving ||
                !form.name.trim() ||
                !form.baseUrl.trim() ||
                (!form.id && !form.accessToken.trim())
              }
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : null}
              Save connection
            </button>
          </span>
        </footer>
      </form>
    </ModalSurface>
  );
}

function connectionForm(connection: PortainerConnection): ConnectionFormState {
  return {
    id: connection.id,
    name: connection.name,
    baseUrl: connection.baseUrl,
    accessToken: '',
    tlsVerify: connection.tlsVerify
  };
}

function connectionInput(form: ConnectionFormState): PortainerConnectionInput {
  return {
    id: form.id,
    name: form.name,
    baseUrl: form.baseUrl,
    accessToken: form.accessToken.trim() || undefined,
    tlsVerify: form.tlsVerify
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'Unable to update the Portainer connection.';
}
