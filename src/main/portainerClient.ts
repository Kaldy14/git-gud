import http from 'node:http';
import https from 'node:https';

import type {
  PortainerConnection,
  PortainerConnectionTestResult,
  PortainerImageFreshness,
  PortainerServiceHealth,
  PortainerStackCatalog,
  PortainerStackHealth,
  PortainerStackImages,
  PortainerStackRuntime,
  PortainerStackStatusInput
} from '@shared/types';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_ERROR_LENGTH = 240;
const IMAGE_STATUS_CONCURRENCY = 4;
const STACK_LABEL = 'com.docker.stack.namespace';

export type PortainerClientCredentials = {
  connection: PortainerConnection;
  accessToken: string;
};

export type PortainerClient = {
  testConnection(): Promise<PortainerConnectionTestResult>;
  loadStackCatalog(): Promise<PortainerStackCatalog>;
  loadStackRuntime(input: PortainerStackStatusInput): Promise<PortainerStackRuntime>;
  loadStackImages(
    input: PortainerStackStatusInput,
    refresh?: boolean
  ): Promise<PortainerStackImages>;
};

type JsonRecord = Record<string, unknown>;

type PortainerEnvironment = {
  id: number;
  name: string;
  status: 'up' | 'down' | 'unknown';
  imageNotificationsEnabled: boolean;
};

type SwarmService = {
  id: string;
  name: string;
  image: string;
  desiredTasks?: number;
  runningTasks?: number;
  completedTasks?: number;
  updateState?: string;
};

type SwarmTask = {
  serviceId: string;
  desiredState?: string;
  state?: string;
  timestamp?: string;
  error?: string;
  message?: string;
  image?: string;
};

class PortainerHttpClient implements PortainerClient {
  private readonly baseUrl: URL;

  constructor(private readonly credentials: PortainerClientCredentials) {
    this.baseUrl = new URL(credentials.connection.baseUrl);
  }

  async testConnection(): Promise<PortainerConnectionTestResult> {
    let systemStatus: JsonRecord | undefined;

    try {
      systemStatus = asRecord(await this.getJson('/api/system/status'));
    } catch (error) {
      if (!(error instanceof PortainerHttpError) || error.statusCode !== 404) {
        throw error;
      }
    }

    const environments = parseEnvironments(await this.getJson('/api/endpoints'));
    return {
      version: readString(systemStatus, 'Version', 'version'),
      edition: readString(systemStatus, 'Edition', 'edition'),
      environmentCount: environments.allCount,
      swarmEnvironmentCount: environments.swarm.length
    };
  }

  async loadStackCatalog(): Promise<PortainerStackCatalog> {
    const environments = parseEnvironments(await this.getJson('/api/endpoints')).swarm;
    const catalogEnvironments = await Promise.all(
      environments.map(async (environment) => {
        const filters = JSON.stringify({ EndpointID: String(environment.id) });
        const stacks = asArray(
          await this.getJson('/api/stacks', { filters })
        ).flatMap((value) => {
          const stack = asRecord(value);
          const id = readNumber(stack, 'Id', 'ID');
          const endpointId = readNumber(stack, 'EndpointId', 'EndpointID');
          const name = readString(stack, 'Name');
          const type = readNumber(stack, 'Type');

          if (
            id === undefined ||
            endpointId !== environment.id ||
            name === undefined ||
            type !== 1
          ) {
            return [];
          }

          return [
            {
              id,
              name,
              endpointId,
              status: readNumber(stack, 'Status') === 1 ? ('active' as const) : ('inactive' as const)
            }
          ];
        });

        return {
          ...environment,
          stacks: stacks.sort((left, right) => left.name.localeCompare(right.name))
        };
      })
    );

    return {
      connectionId: this.credentials.connection.id,
      environments: catalogEnvironments.sort((left, right) =>
        left.name.localeCompare(right.name)
      ),
      loadedAt: new Date().toISOString()
    };
  }

  async loadStackRuntime(input: PortainerStackStatusInput): Promise<PortainerStackRuntime> {
    this.assertConnection(input);
    await this.assertStackIdentity(input);
    const services = await this.loadServices(input);
    const tasks = await this.loadTasks(input.endpointId, services.map((service) => service.id));
    const serviceRuntimes = services.map((service) => {
      const serviceTasks = tasks.filter((task) => task.serviceId === service.id);
      const desiredTasks =
        service.desiredTasks ?? serviceTasks.filter(isDesiredRunningTask).length;
      const runningTasks =
        service.runningTasks ?? serviceTasks.filter((task) => task.state === 'running').length;
      const completedTasks =
        service.completedTasks ?? serviceTasks.filter(isCompletedTask).length;
      const health = deriveServiceHealth(service, serviceTasks, desiredTasks, runningTasks);
      const runningSince = oldestRunningTimestamp(serviceTasks);
      const lastError = latestTaskError(serviceTasks);

      return {
        id: service.id,
        name: stripStackPrefix(service.name, input.stackName),
        image: service.image,
        desiredTasks,
        runningTasks,
        completedTasks,
        health,
        ...(runningSince ? { runningSince } : {}),
        ...(lastError ? { lastError } : {})
      };
    });
    const desiredTasks = sum(serviceRuntimes.map((service) => service.desiredTasks));
    const runningTasks = sum(serviceRuntimes.map((service) => service.runningTasks));
    const completedTasks = sum(serviceRuntimes.map((service) => service.completedTasks));

    return {
      connectionId: input.connectionId,
      endpointId: input.endpointId,
      stackId: input.stackId,
      stackName: input.stackName,
      health: deriveStackHealth(
        serviceRuntimes.map((service) => service.health),
        desiredTasks
      ),
      desiredTasks,
      runningTasks,
      completedTasks,
      services: serviceRuntimes,
      portainerUrl: buildStackUrl(this.baseUrl, input),
      loadedAt: new Date().toISOString()
    };
  }

  async loadStackImages(
    input: PortainerStackStatusInput,
    refresh = false
  ): Promise<PortainerStackImages> {
    this.assertConnection(input);
    await this.assertStackIdentity(input);
    const environments = parseEnvironments(await this.getJson('/api/endpoints')).swarm;
    const environment = environments.find((candidate) => candidate.id === input.endpointId);

    if (!environment) {
      throw new Error('The selected Portainer Swarm environment no longer exists.');
    }

    const services = await this.loadServices(input);
    const serviceStatuses = environment.imageNotificationsEnabled
      ? await mapWithConcurrency(
          services.map(
            (service) => async () => {
              const response = asRecord(
                await this.getJson(
                  `/api/docker/${input.endpointId}/services/${encodeURIComponent(service.id)}/image_status`,
                  { refresh: String(refresh) }
                )
              );
              const status = readString(response, 'Status', 'status');
              const message = readString(response, 'Message', 'message');

              return {
                serviceId: service.id,
                freshness: mapImageFreshness(status),
                ...(message ? { message: truncate(message, MAX_ERROR_LENGTH) } : {})
              };
            }
          ),
          IMAGE_STATUS_CONCURRENCY
        )
      : services.map((service) => ({
          serviceId: service.id,
          freshness: 'unknown' as const,
          message: 'Image update notifications are disabled for this environment.'
        }));

    return {
      connectionId: input.connectionId,
      endpointId: input.endpointId,
      stackId: input.stackId,
      services: serviceStatuses,
      loadedAt: new Date().toISOString()
    };
  }

  private assertConnection(input: PortainerStackStatusInput): void {
    if (input.connectionId !== this.credentials.connection.id) {
      throw new Error('The Portainer request does not match the selected connection.');
    }
  }

  private async assertStackIdentity(input: PortainerStackStatusInput): Promise<void> {
    let stack: JsonRecord | undefined;

    try {
      stack = asRecord(await this.getJson(`/api/stacks/${input.stackId}`));
    } catch (error) {
      if (error instanceof PortainerHttpError && error.statusCode === 404) {
        throw new Error(
          `The Portainer stack "${input.stackName}" no longer exists. Remove or replace this dashboard tile.`,
          { cause: error }
        );
      }

      throw error;
    }

    const id = readNumber(stack, 'Id', 'ID');
    const endpointId = readNumber(stack, 'EndpointId', 'EndpointID');
    const name = readString(stack, 'Name');
    const type = readNumber(stack, 'Type');
    const status = readNumber(stack, 'Status');

    if (
      id !== input.stackId ||
      endpointId !== input.endpointId ||
      name !== input.stackName ||
      type !== 1
    ) {
      throw new Error(
        `The Portainer stack "${input.stackName}" changed identity. Remove or replace this dashboard tile.`
      );
    }

    if (status !== 1) {
      throw new Error(`The Portainer stack "${input.stackName}" is inactive.`);
    }
  }

  private async loadServices(input: PortainerStackStatusInput): Promise<SwarmService[]> {
    const labelValue = `${STACK_LABEL}=${input.stackName}`;
    const filters = JSON.stringify({ label: [labelValue] });
    const response = asArray(
      await this.getJson(`/api/endpoints/${input.endpointId}/docker/services`, {
        status: 'true',
        filters
      })
    );

    return response.flatMap((value) => {
      const service = asRecord(value);
      const spec = asRecord(service?.Spec);
      const labels = asRecord(spec?.Labels);
      const id = readString(service, 'ID', 'Id');
      const name = readString(spec, 'Name');

      if (
        id === undefined ||
        name === undefined ||
        readString(labels, STACK_LABEL) !== input.stackName
      ) {
        return [];
      }

      const taskTemplate = asRecord(spec?.TaskTemplate);
      const containerSpec = asRecord(taskTemplate?.ContainerSpec);
      const serviceStatus = asRecord(service?.ServiceStatus);
      const updateStatus = asRecord(service?.UpdateStatus);

      return [
        {
          id,
          name,
          image: readString(containerSpec, 'Image') ?? 'Unknown image',
          desiredTasks: readNumber(serviceStatus, 'DesiredTasks'),
          runningTasks: readNumber(serviceStatus, 'RunningTasks'),
          completedTasks: readNumber(serviceStatus, 'CompletedTasks'),
          updateState: readString(updateStatus, 'State')
        }
      ];
    });
  }

  private async loadTasks(endpointId: number, serviceIds: string[]): Promise<SwarmTask[]> {
    if (serviceIds.length === 0) {
      return [];
    }

    const filters = JSON.stringify({ service: serviceIds });
    return asArray(
      await this.getJson(`/api/endpoints/${endpointId}/docker/tasks`, { filters })
    ).flatMap((value) => {
      const task = asRecord(value);
      const serviceId = readString(task, 'ServiceID', 'ServiceId');

      if (!serviceId || !serviceIds.includes(serviceId)) {
        return [];
      }

      const status = asRecord(task?.Status);
      const spec = asRecord(task?.Spec);
      const containerSpec = asRecord(spec?.ContainerSpec);
      return [
        {
          serviceId,
          desiredState: readString(task, 'DesiredState')?.toLowerCase(),
          state: readString(status, 'State')?.toLowerCase(),
          timestamp: readString(status, 'Timestamp'),
          error: readString(status, 'Err'),
          message: readString(status, 'Message'),
          image: readString(containerSpec, 'Image')
        }
      ];
    });
  }

  private async getJson(
    apiPath: string,
    query?: Record<string, string>
  ): Promise<unknown> {
    const url = buildApiUrl(this.baseUrl, apiPath, query);
    return requestJson(url, this.credentials.accessToken, this.credentials.connection.tlsVerify);
  }
}

class PortainerHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'PortainerHttpError';
  }
}

export function createPortainerClient(
  credentials: PortainerClientCredentials
): PortainerClient {
  return new PortainerHttpClient(credentials);
}

function requestJson(url: URL, accessToken: string, tlsVerify: boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-Key': accessToken
        },
        ...(url.protocol === 'https:' ? { rejectUnauthorized: tlsVerify } : {})
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const contentLength = Number(response.headers['content-length']);

        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
          response.resume();
          reject(new Error('Portainer returned a response that is too large.'));
          return;
        }

        let receivedBytes = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('Portainer returned a response that is too large.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');

          if (statusCode >= 300 && statusCode < 400) {
            reject(
              new PortainerHttpError(
                'Portainer redirected the API request. Update the connection URL to the final Portainer address.',
                statusCode
              )
            );
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            reject(new PortainerHttpError(httpErrorMessage(statusCode, body), statusCode));
            return;
          }

          if (body.length === 0) {
            resolve(undefined);
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Portainer returned an invalid JSON response.'));
          }
        });
      }
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('The Portainer request timed out after 10 seconds.'));
    });
    request.on('error', (error) => reject(mapNetworkError(error)));
    request.end();
  });
}

function buildApiUrl(
  baseUrl: URL,
  apiPath: string,
  query?: Record<string, string>
): URL {
  const url = new URL(baseUrl.toString());
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/${apiPath.replace(/^\/+/, '')}`;
  url.search = '';
  url.hash = '';

  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  return url;
}

function parseEnvironments(value: unknown): {
  allCount: number;
  swarm: PortainerEnvironment[];
} {
  const endpoints = asArray(value);
  return {
    allCount: endpoints.length,
    swarm: endpoints.flatMap((value) => {
      const endpoint = asRecord(value);
      const snapshots = asArray(endpoint?.Snapshots);
      const isSwarm = snapshots.some((snapshot) => asRecord(snapshot)?.Swarm === true);
      const id = readNumber(endpoint, 'Id', 'ID');
      const name = readString(endpoint, 'Name');

      if (!isSwarm || id === undefined || name === undefined) {
        return [];
      }

      return [
        {
          id,
          name,
          status: mapEnvironmentStatus(readNumber(endpoint, 'Status')),
          imageNotificationsEnabled: endpoint?.EnableImageNotification === true
        }
      ];
    })
  };
}

function deriveServiceHealth(
  service: SwarmService,
  tasks: SwarmTask[],
  desiredTasks: number,
  runningTasks: number
): PortainerServiceHealth {
  if (desiredTasks === 0) {
    return 'stopped';
  }

  const updateState = service.updateState?.toLowerCase();
  const desiredImage = service.image;
  const mixedImages = tasks.some(
    (task) =>
      task.state === 'running' && task.image !== undefined && task.image !== desiredImage
  );

  if (
    updateState === 'updating' ||
    updateState === 'rollback_started' ||
    mixedImages
  ) {
    return 'updating';
  }

  if (runningTasks < desiredTasks || updateState === 'paused' || updateState === 'rollback_paused') {
    return 'degraded';
  }

  return 'healthy';
}

function deriveStackHealth(
  serviceHealth: PortainerServiceHealth[],
  desiredTasks: number
): PortainerStackHealth {
  if (serviceHealth.length === 0 || desiredTasks === 0) {
    return 'stopped';
  }
  if (serviceHealth.includes('degraded')) {
    return 'degraded';
  }
  if (serviceHealth.includes('updating')) {
    return 'updating';
  }
  return 'healthy';
}

function oldestRunningTimestamp(tasks: SwarmTask[]): string | undefined {
  return tasks
    .filter((task) => task.state === 'running' && isIsoDate(task.timestamp))
    .map((task) => task.timestamp as string)
    .sort()[0];
}

function latestTaskError(tasks: SwarmTask[]): string | undefined {
  const errorStates = new Set(['failed', 'orphaned', 'rejected']);
  const latest = tasks
    .filter(
      (task) =>
        Boolean(task.error?.trim()) ||
        (Boolean(task.state && errorStates.has(task.state)) && Boolean(task.message?.trim()))
    )
    .sort((left, right) => (right.timestamp ?? '').localeCompare(left.timestamp ?? ''))
    .find((task) => task.error?.trim() || task.message?.trim());
  const message = latest?.error?.trim() || latest?.message?.trim();
  return message ? truncate(message, MAX_ERROR_LENGTH) : undefined;
}

function isDesiredRunningTask(task: SwarmTask): boolean {
  return task.desiredState === 'running';
}

function isCompletedTask(task: SwarmTask): boolean {
  return task.state === 'complete' || task.state === 'shutdown';
}

function mapImageFreshness(status?: string): PortainerImageFreshness {
  switch (status?.toLowerCase()) {
    case 'updated':
      return 'up-to-date';
    case 'outdated':
      return 'update-available';
    case 'processing':
    case 'preparing':
      return 'checking';
    default:
      return 'unknown';
  }
}

function mapEnvironmentStatus(status?: number): PortainerEnvironment['status'] {
  if (status === 1) {
    return 'up';
  }
  if (status === 2) {
    return 'down';
  }
  return 'unknown';
}

function buildStackUrl(baseUrl: URL, input: PortainerStackStatusInput): string {
  const url = new URL(baseUrl.toString());
  url.hash = `!/${input.endpointId}/docker/stacks/${input.stackId}`;
  return url.toString();
}

function stripStackPrefix(serviceName: string, stackName: string): string {
  const prefix = `${stackName}_`;
  return serviceName.startsWith(prefix) ? serviceName.slice(prefix.length) : serviceName;
}

function httpErrorMessage(statusCode: number, body: string): string {
  if (statusCode === 401) {
    return 'Portainer rejected the access token. Edit the connection and enter a valid token.';
  }
  if (statusCode === 403) {
    return 'The Portainer account does not have permission to access this resource.';
  }

  let detail: string | undefined;
  try {
    const parsed = asRecord(JSON.parse(body));
    detail = readString(parsed, 'message', 'Message', 'details');
  } catch {
    detail = body.trim() || undefined;
  }
  const suffix = detail ? `: ${truncate(detail, MAX_ERROR_LENGTH)}` : '';
  return `Portainer returned HTTP ${statusCode}${suffix}`;
}

function mapNetworkError(error: Error & { code?: string }): Error {
  const tlsCodes = new Set([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ]);
  if (error.code && tlsCodes.has(error.code)) {
    return new Error(
      'Portainer TLS certificate verification failed. Check the certificate or disable TLS verification for this connection.'
    );
  }
  return error;
}

function readString(
  value: JsonRecord | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function readNumber(
  value: JsonRecord | undefined,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isIsoDate(value?: string): boolean {
  return value !== undefined && Number.isFinite(Date.parse(value));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

async function mapWithConcurrency<TValue>(
  operations: Array<() => Promise<TValue>>,
  concurrency: number
): Promise<TValue[]> {
  const results = new Array<TValue>(operations.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < operations.length) {
      const operationIndex = nextIndex;
      nextIndex += 1;
      const operation = operations[operationIndex];

      if (operation) {
        results[operationIndex] = await operation();
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, operations.length) },
      () => runWorker()
    )
  );
  return results;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
