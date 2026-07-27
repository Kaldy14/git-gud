import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { PortainerConnection, PortainerStackStatusInput } from '@shared/types';

import { createPortainerClient } from './portainerClient';

type FixtureRequest = {
  url: URL;
  headers: http.IncomingHttpHeaders;
};

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

describe('Portainer client', () => {
  it('tests a subpath connection and counts Docker and Swarm environments', async () => {
    const requests: FixtureRequest[] = [];
    const baseUrl = await startFixtureServer(requests, (request, response) => {
      if (request.url.pathname === '/portainer/api/system/status') {
        json(response, 200, {
          Version: '2.39.0',
          InstanceID: '299ab403-70a8-4c05-92f7-bf7a994d50df'
        });
        return;
      }
      json(response, 200, [
        swarmEnvironment({ Id: 3, Name: 'Production' }),
        dockerEnvironment({ Id: 4, Name: 'Docker' })
      ]);
    });
    const client = createPortainerClient(credentials(`${baseUrl}/portainer`));

    await expect(client.testConnection()).resolves.toEqual({
      version: '2.39.0',
      environmentCount: 2,
      dockerEnvironmentCount: 2,
      swarmEnvironmentCount: 1
    });
    expect(requests.map((request) => request.url.pathname)).toEqual([
      '/portainer/api/system/status',
      '/portainer/api/endpoints'
    ]);
    expect(requests.every((request) => request.headers['x-api-key'] === 'secret-token')).toBe(true);
  });

  it('continues when the optional system-status endpoint is unavailable', async () => {
    const baseUrl = await startFixtureServer([], (request, response) => {
      if (request.url.pathname === '/api/system/status') {
        json(response, 404, { message: 'Not found' });
        return;
      }
      json(response, 200, [swarmEnvironment({ Id: 3, Name: 'Production' })]);
    });

    await expect(createPortainerClient(credentials(baseUrl)).testConnection()).resolves.toEqual({
      environmentCount: 1,
      dockerEnvironmentCount: 1,
      swarmEnvironmentCount: 1
    });
  });

  it('loads Swarm and Compose stacks with their version-correct Portainer filters', async () => {
    const requests: FixtureRequest[] = [];
    const baseUrl = await startFixtureServer(requests, (request, response) => {
      if (request.url.pathname === '/api/endpoints') {
        json(response, 200, [
          swarmEnvironment({
            Id: 7,
            Name: 'Zeta',
            Status: 2,
            EnableImageNotification: true
          }),
          dockerEnvironment({ Id: 8, Name: 'Alpha', Status: 1 }),
          {
            Id: 9,
            Name: 'Kubernetes',
            Type: 5,
            ContainerEngine: '',
            Status: 1,
            Snapshots: []
          }
        ]);
        return;
      }

      if (request.url.pathname === '/api/endpoints/7/docker/swarm') {
        json(response, 200, { ID: 'swarm-zeta' });
        return;
      }

      const filters = JSON.parse(request.url.searchParams.get('filters') ?? '{}');
      if (filters.EndpointID === 7) {
        json(response, 200, [
          { Id: 13, Name: 'compose', EndpointId: 7, Type: 2, Status: 1 },
          { Id: 12, Name: 'wrong type', EndpointId: 7, Type: 1, Status: 1 }
        ]);
        return;
      }
      if (filters.EndpointID === 8) {
        json(response, 200, [
          { Id: 15, Name: 'api', EndpointId: 8, Type: 2, Status: 2 }
        ]);
        return;
      }
      if (filters.SwarmID === 'swarm-zeta') {
        json(response, 200, [
          { Id: 12, Name: 'web', EndpointId: 7, Type: 1, Status: 1 },
          { Id: 16, Name: 'wrong endpoint', EndpointId: 8, Type: 1, Status: 1 }
        ]);
        return;
      }

      json(response, 400, { message: 'Invalid query parameter: filters' });
    });
    const client = createPortainerClient(credentials(baseUrl));

    const catalog = await client.loadStackCatalog();

    expect(catalog.environments).toEqual([
      {
        id: 8,
        name: 'Alpha',
        status: 'up',
        imageNotificationsEnabled: false,
        stacks: [
          {
            id: 15,
            name: 'api',
            endpointId: 8,
            stackType: 'compose',
            status: 'inactive'
          }
        ]
      },
      {
        id: 7,
        name: 'Zeta',
        status: 'down',
        imageNotificationsEnabled: true,
        stacks: [
          {
            id: 13,
            name: 'compose',
            endpointId: 7,
            stackType: 'compose',
            status: 'active'
          },
          {
            id: 12,
            name: 'web',
            endpointId: 7,
            stackType: 'swarm',
            status: 'active'
          }
        ]
      }
    ]);
    const stackRequests = requests.filter((request) => request.url.pathname === '/api/stacks');
    expect(stackRequests).toHaveLength(3);
    expect(
      stackRequests.map((request) =>
        JSON.parse(request.url.searchParams.get('filters') ?? '{}')
      )
    ).toEqual(
      expect.arrayContaining([
        { EndpointID: 7 },
        { EndpointID: 8 },
        { SwarmID: 'swarm-zeta' }
      ])
    );
    expect(
      requests.filter((request) => request.url.pathname.endsWith('/docker/swarm'))
    ).toHaveLength(1);
  });

  it('derives degraded runtime, service uptime, and bounded recent task errors', async () => {
    const requests: FixtureRequest[] = [];
    const longError = `registry unavailable ${'x'.repeat(300)}`;
    const baseUrl = await startFixtureServer(requests, (request, response) => {
      if (respondWithStackFixture(request, response)) {
        return;
      }
      if (request.url.pathname.endsWith('/services')) {
        json(response, 200, [
          serviceFixture({
            ID: 'service-api',
            name: 'shop_api',
            image: 'registry.example/api:latest@sha256:new',
            desired: 2,
            running: 1,
            completed: 4
          }),
          serviceFixture({
            ID: 'wrong-stack',
            name: 'other_worker',
            image: 'worker:latest',
            desired: 1,
            running: 1,
            completed: 0,
            labels: { 'com.docker.stack.namespace': 'other' }
          })
        ]);
        return;
      }
      json(response, 200, [
        taskFixture({
          ServiceID: 'service-api',
          state: 'running',
          timestamp: '2026-07-20T10:00:00Z',
          image: 'registry.example/api:latest@sha256:new'
        }),
        taskFixture({
          ServiceID: 'service-api',
          state: 'rejected',
          timestamp: '2026-07-26T10:00:00Z',
          error: longError
        }),
        taskFixture({
          ServiceID: 'service-api',
          state: 'failed',
          timestamp: '2026-07-25T10:00:00Z',
          error: 'older failure'
        }),
        taskFixture({
          ServiceID: 'service-api',
          state: 'shutdown',
          timestamp: '2026-07-27T10:00:00Z',
          message: 'shutdown'
        }),
        taskFixture({
          ServiceID: 'wrong-stack',
          state: 'running',
          timestamp: '2026-07-20T10:00:00Z'
        })
      ]);
    });
    const client = createPortainerClient(credentials(baseUrl));

    const runtime = await client.loadStackRuntime(stackInput());

    expect(runtime).toMatchObject({
      connectionId: 'connection-1',
      endpointId: 7,
      stackId: 12,
      stackName: 'shop',
      stackType: 'swarm',
      health: 'degraded',
      desiredTasks: 2,
      runningTasks: 1,
      completedTasks: 4,
      services: [
        {
          id: 'service-api',
          name: 'api',
          health: 'degraded',
          runningSince: '2026-07-20T10:00:00Z'
        }
      ]
    });
    expect(runtime.services[0]?.lastError).toHaveLength(240);
    expect(runtime.portainerUrl).toBe(
      `${baseUrl}/#!/7/docker/stacks/shop?id=12&type=1&regular=true`
    );
    const servicesRequest = requests.find((request) => request.url.pathname.endsWith('/services'));
    expect(JSON.parse(servicesRequest?.url.searchParams.get('filters') ?? '{}')).toEqual({
      label: ['com.docker.stack.namespace=shop']
    });
    const tasksRequest = requests.find((request) => request.url.pathname.endsWith('/tasks'));
    expect(JSON.parse(tasksRequest?.url.searchParams.get('filters') ?? '{}')).toEqual({
      service: ['service-api']
    });
  });

  it('groups Compose containers by service and builds a Compose stack link', async () => {
    const requests: FixtureRequest[] = [];
    const baseUrl = await startFixtureServer(requests, (request, response) => {
      if (request.url.pathname === '/api/stacks/12') {
        json(response, 200, {
          Id: 12,
          Name: 'shop',
          EndpointId: 7,
          Type: 2,
          Status: 1
        });
        return;
      }
      if (request.url.pathname.endsWith('/containers/json')) {
        json(response, 200, [
          composeContainerFixture({
            id: 'web-a',
            service: 'web',
            image: 'web:latest',
            state: 'running',
            status: 'Up 2 hours (healthy)'
          }),
          composeContainerFixture({
            id: 'web-b',
            service: 'web',
            image: 'web:latest',
            state: 'exited',
            status: 'Exited (1) 10 minutes ago'
          }),
          composeContainerFixture({
            id: 'db-a',
            service: 'db',
            image: 'postgres:17',
            state: 'running',
            status: 'Up 2 hours'
          }),
          composeContainerFixture({
            id: 'oneoff',
            service: 'web',
            image: 'web:latest',
            state: 'exited',
            status: 'Exited (0) 1 minute ago',
            oneoff: true
          }),
          composeContainerFixture({
            id: 'other',
            service: 'api',
            image: 'api:latest',
            state: 'running',
            status: 'Up 1 hour',
            project: 'other'
          })
        ]);
        return;
      }

      json(response, 500, { message: 'Unexpected request' });
    });

    const runtime = await createPortainerClient(credentials(baseUrl)).loadStackRuntime(
      stackInput()
    );

    expect(runtime).toMatchObject({
      stackType: 'compose',
      health: 'degraded',
      desiredTasks: 3,
      runningTasks: 2,
      completedTasks: 1,
      services: [
        {
          id: 'db',
          name: 'db',
          image: 'postgres:17',
          desiredTasks: 1,
          runningTasks: 1,
          completedTasks: 0,
          health: 'healthy'
        },
        {
          id: 'web',
          name: 'web',
          image: 'web:latest',
          desiredTasks: 2,
          runningTasks: 1,
          completedTasks: 1,
          health: 'degraded',
          lastError: 'Exited (1) 10 minutes ago'
        }
      ]
    });
    expect(runtime.portainerUrl).toBe(
      `${baseUrl}/#!/7/docker/stacks/shop?id=12&type=2&regular=true`
    );
    const containersRequest = requests.find((request) =>
      request.url.pathname.endsWith('/containers/json')
    );
    expect(containersRequest?.url.searchParams.get('all')).toBe('true');
    expect(JSON.parse(containersRequest?.url.searchParams.get('filters') ?? '{}')).toEqual({
      label: ['com.docker.compose.project=shop']
    });
  });

  it('recognizes active mixed-image rollouts as updating', async () => {
    const baseUrl = await startFixtureServer([], (request, response) => {
      if (respondWithStackFixture(request, response)) {
        return;
      }
      if (request.url.pathname.endsWith('/services')) {
        json(response, 200, [
          serviceFixture({
            ID: 'service-web',
            name: 'shop_web',
            image: 'web:latest@sha256:new',
            desired: 2,
            running: 2,
            completed: 0,
            updateState: 'updating'
          })
        ]);
        return;
      }
      json(response, 200, [
        taskFixture({
          ServiceID: 'service-web',
          state: 'running',
          timestamp: '2026-07-20T10:00:00Z',
          image: 'web:latest@sha256:old'
        }),
        taskFixture({
          ServiceID: 'service-web',
          state: 'running',
          timestamp: '2026-07-21T10:00:00Z',
          image: 'web:latest@sha256:new'
        })
      ]);
    });

    const runtime = await createPortainerClient(credentials(baseUrl)).loadStackRuntime(stackInput());

    expect(runtime.health).toBe('updating');
    expect(runtime.services[0]?.health).toBe('updating');
    expect(runtime.services[0]?.runningSince).toBe('2026-07-20T10:00:00Z');
  });

  it('maps Business Edition image statuses and passes explicit refresh intent', async () => {
    const requests: FixtureRequest[] = [];
    const imageStatuses = new Map([
      ['service-a', { Status: 'updated', Message: 'Current' }],
      ['service-b', { Status: 'outdated', Message: 'A newer digest exists' }],
      ['service-c', { Status: 'processing' }],
      ['service-d', { Status: 'error', Message: 'Registry unavailable' }]
    ]);
    const baseUrl = await startFixtureServer(requests, (request, response) => {
      if (respondWithStackFixture(request, response)) {
        return;
      }
      if (request.url.pathname === '/api/endpoints') {
        json(response, 200, [
          swarmEnvironment({ Id: 7, Name: 'Production', EnableImageNotification: true })
        ]);
        return;
      }
      if (request.url.pathname.endsWith('/services')) {
        json(
          response,
          200,
          [...imageStatuses.keys()].map((id) =>
            serviceFixture({
              ID: id,
              name: `shop_${id}`,
              image: `${id}:latest`,
              desired: 1,
              running: 1,
              completed: 0
            })
          )
        );
        return;
      }
      const serviceId = request.url.pathname.split('/').at(-2) ?? '';
      json(response, 200, imageStatuses.get(serviceId));
    });
    const client = createPortainerClient(credentials(baseUrl));

    const images = await client.loadStackImages(stackInput(), true);

    expect(images.services).toEqual([
      { serviceId: 'service-a', freshness: 'up-to-date', message: 'Current' },
      {
        serviceId: 'service-b',
        freshness: 'update-available',
        message: 'A newer digest exists'
      },
      { serviceId: 'service-c', freshness: 'checking' },
      { serviceId: 'service-d', freshness: 'unknown', message: 'Registry unavailable' }
    ]);
    const statusRequests = requests.filter((request) =>
      request.url.pathname.endsWith('/image_status')
    );
    expect(statusRequests).toHaveLength(4);
    expect(statusRequests.every((request) => request.url.searchParams.get('refresh') === 'true')).toBe(true);
  });

  it('aggregates Compose container image statuses by service', async () => {
    const requests: FixtureRequest[] = [];
    const imageStatuses = new Map([
      ['web-a', { Status: 'updated', Message: 'Current' }],
      ['web-b', { Status: 'outdated', Message: 'A newer digest exists' }],
      ['db-a', { Status: 'updated' }]
    ]);
    const baseUrl = await startFixtureServer(requests, (request, response) => {
      if (request.url.pathname === '/api/stacks/12') {
        json(response, 200, {
          Id: 12,
          Name: 'shop',
          EndpointId: 7,
          Type: 2,
          Status: 1
        });
        return;
      }
      if (request.url.pathname === '/api/endpoints') {
        json(response, 200, [
          dockerEnvironment({
            Id: 7,
            Name: 'Production',
            EnableImageNotification: true
          })
        ]);
        return;
      }
      if (request.url.pathname.endsWith('/containers/json')) {
        json(response, 200, [
          composeContainerFixture({
            id: 'web-a',
            service: 'web',
            image: 'web:latest',
            state: 'running',
            status: 'Up 2 hours'
          }),
          composeContainerFixture({
            id: 'web-b',
            service: 'web',
            image: 'web:latest',
            state: 'running',
            status: 'Up 2 hours'
          }),
          composeContainerFixture({
            id: 'db-a',
            service: 'db',
            image: 'postgres:17',
            state: 'running',
            status: 'Up 2 hours'
          })
        ]);
        return;
      }

      const containerId = request.url.pathname.split('/').at(-2) ?? '';
      json(response, 200, imageStatuses.get(containerId));
    });

    const images = await createPortainerClient(credentials(baseUrl)).loadStackImages(
      stackInput(),
      true
    );

    expect(images.services).toEqual([
      { serviceId: 'db', freshness: 'up-to-date' },
      {
        serviceId: 'web',
        freshness: 'update-available',
        message: 'Current · A newer digest exists'
      }
    ]);
    const statusRequests = requests.filter((request) =>
      request.url.pathname.endsWith('/image_status')
    );
    expect(statusRequests).toHaveLength(3);
    expect(
      statusRequests.every((request) => request.url.searchParams.get('refresh') === 'true')
    ).toBe(true);
  });

  it('does not call image-status endpoints when notifications are disabled', async () => {
    const requests: FixtureRequest[] = [];
    const baseUrl = await startFixtureServer(requests, (request, response) => {
      if (respondWithStackFixture(request, response)) {
        return;
      }
      if (request.url.pathname === '/api/endpoints') {
        json(response, 200, [swarmEnvironment({ Id: 7, Name: 'Production' })]);
        return;
      }
      json(response, 200, [
        serviceFixture({
          ID: 'service-a',
          name: 'shop_api',
          image: 'api:latest',
          desired: 1,
          running: 1,
          completed: 0
        })
      ]);
    });

    const images = await createPortainerClient(credentials(baseUrl)).loadStackImages(stackInput());

    expect(images.services).toEqual([
      {
        serviceId: 'service-a',
        freshness: 'unknown',
        message: 'Image update notifications are disabled for this environment.'
      }
    ]);
    expect(requests.some((request) => request.url.pathname.endsWith('/image_status'))).toBe(false);
  });

  it('bounds concurrent image-status requests for large stacks', async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const serviceIds = Array.from({ length: 10 }, (_, index) => `service-${index}`);
    const baseUrl = await startFixtureServer([], (request, response) => {
      if (respondWithStackFixture(request, response)) {
        return;
      }
      if (request.url.pathname === '/api/endpoints') {
        json(response, 200, [
          swarmEnvironment({ Id: 7, Name: 'Production', EnableImageNotification: true })
        ]);
        return;
      }
      if (request.url.pathname.endsWith('/services')) {
        json(
          response,
          200,
          serviceIds.map((id) =>
            serviceFixture({
              ID: id,
              name: `shop_${id}`,
              image: `${id}:latest`,
              desired: 1,
              running: 1,
              completed: 0
            })
          )
        );
        return;
      }

      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      setTimeout(() => {
        activeRequests -= 1;
        json(response, 200, { Status: 'updated' });
      }, 10);
    });

    const images = await createPortainerClient(credentials(baseUrl)).loadStackImages(
      stackInput()
    );

    expect(images.services).toHaveLength(serviceIds.length);
    expect(maxActiveRequests).toBeLessThanOrEqual(4);
  });

  it('rejects a deleted or changed stack before loading services', async () => {
    const requests: FixtureRequest[] = [];
    const baseUrl = await startFixtureServer(requests, (request, response) => {
      if (request.url.pathname === '/api/stacks/12') {
        json(response, 404, { message: 'Not found' });
        return;
      }

      json(response, 500, { message: 'Unexpected request' });
    });
    const client = createPortainerClient(credentials(baseUrl));

    await expect(client.loadStackRuntime(stackInput())).rejects.toThrow(
      'no longer exists'
    );
    expect(requests.map((request) => request.url.pathname)).toEqual(['/api/stacks/12']);
  });

  it('rejects a stack whose endpoint or name no longer matches the tile', async () => {
    const baseUrl = await startFixtureServer([], (request, response) => {
      if (request.url.pathname === '/api/stacks/12') {
        json(response, 200, {
          Id: 12,
          Name: 'replacement',
          EndpointId: 9,
          Type: 1,
          Status: 1
        });
        return;
      }

      json(response, 500, { message: 'Unexpected request' });
    });

    await expect(
      createPortainerClient(credentials(baseUrl)).loadStackRuntime(stackInput())
    ).rejects.toThrow('changed identity');
  });

  it.each([
    [401, 'rejected the access token'],
    [403, 'does not have permission'],
    [500, 'Portainer returned HTTP 500: database unavailable']
  ])('reports useful HTTP %s errors', async (status, message) => {
    const baseUrl = await startFixtureServer([], (_request, response) => {
      json(response, status, { message: 'database unavailable' });
    });

    await expect(createPortainerClient(credentials(baseUrl)).testConnection()).rejects.toThrow(
      message
    );
  });

  it('rejects redirects without sending the token to their target', async () => {
    let targetRequests = 0;
    const targetUrl = await startFixtureServer([], (_request, response) => {
      targetRequests += 1;
      json(response, 200, {});
    });
    const sourceUrl = await startFixtureServer([], (_request, response) => {
      response.writeHead(302, { Location: `${targetUrl}/stolen` });
      response.end();
    });

    await expect(createPortainerClient(credentials(sourceUrl)).testConnection()).rejects.toThrow(
      'redirected the API request'
    );
    expect(targetRequests).toBe(0);
  });

  it('rejects oversized responses before buffering their body', async () => {
    const baseUrl = await startFixtureServer([], (_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(6 * 1024 * 1024)
      });
      response.end();
    });

    await expect(createPortainerClient(credentials(baseUrl)).testConnection()).rejects.toThrow(
      'response that is too large'
    );
  });
});

async function startFixtureServer(
  requests: FixtureRequest[],
  handler: (request: FixtureRequest, response: http.ServerResponse) => void
): Promise<string> {
  const server = http.createServer((incoming, response) => {
    const host = incoming.headers.host ?? '127.0.0.1';
    const request = {
      url: new URL(incoming.url ?? '/', `http://${host}`),
      headers: incoming.headers
    };
    requests.push(request);
    handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function respondWithStackFixture(
  request: FixtureRequest,
  response: http.ServerResponse
): boolean {
  if (request.url.pathname !== '/api/stacks/12') {
    return false;
  }

  json(response, 200, {
    Id: 12,
    Name: 'shop',
    EndpointId: 7,
    Type: 1,
    Status: 1
  });
  return true;
}

function credentials(baseUrl: string): {
  connection: PortainerConnection;
  accessToken: string;
} {
  return {
    connection: {
      id: 'connection-1',
      name: 'Production',
      baseUrl,
      tlsVerify: true,
      createdAt: '2026-07-27T10:00:00Z',
      updatedAt: '2026-07-27T10:00:00Z'
    },
    accessToken: 'secret-token'
  };
}

function stackInput(): PortainerStackStatusInput {
  return {
    connectionId: 'connection-1',
    endpointId: 7,
    stackId: 12,
    stackName: 'shop'
  };
}

function swarmEnvironment(
  overrides: Record<string, unknown>
): Record<string, unknown> {
  return {
    Type: 1,
    ContainerEngine: 'docker',
    Status: 1,
    EnableImageNotification: false,
    Snapshots: [{ Swarm: true }],
    ...overrides
  };
}

function dockerEnvironment(
  overrides: Record<string, unknown>
): Record<string, unknown> {
  return {
    Type: 1,
    ContainerEngine: 'docker',
    Status: 1,
    EnableImageNotification: false,
    Snapshots: [{ Swarm: false }],
    ...overrides
  };
}

function serviceFixture(input: {
  ID: string;
  name: string;
  image: string;
  desired: number;
  running: number;
  completed: number;
  labels?: Record<string, string>;
  updateState?: string;
}): Record<string, unknown> {
  return {
    ID: input.ID,
    Spec: {
      Name: input.name,
      Labels: input.labels ?? { 'com.docker.stack.namespace': 'shop' },
      TaskTemplate: { ContainerSpec: { Image: input.image } }
    },
    ServiceStatus: {
      DesiredTasks: input.desired,
      RunningTasks: input.running,
      CompletedTasks: input.completed
    },
    ...(input.updateState ? { UpdateStatus: { State: input.updateState } } : {})
  };
}

function composeContainerFixture(input: {
  id: string;
  service: string;
  image: string;
  state: string;
  status: string;
  project?: string;
  oneoff?: boolean;
}): Record<string, unknown> {
  return {
    Id: input.id,
    Image: input.image,
    State: input.state,
    Status: input.status,
    Labels: {
      'com.docker.compose.project': input.project ?? 'shop',
      'com.docker.compose.service': input.service,
      'com.docker.compose.oneoff': input.oneoff ? 'True' : 'False'
    }
  };
}

function taskFixture(input: {
  ServiceID: string;
  state: string;
  timestamp: string;
  error?: string;
  message?: string;
  image?: string;
}): Record<string, unknown> {
  return {
    ServiceID: input.ServiceID,
    DesiredState: input.state === 'running' ? 'running' : 'shutdown',
    Status: {
      State: input.state,
      Timestamp: input.timestamp,
      ...(input.error ? { Err: input.error } : {}),
      ...(input.message ? { Message: input.message } : {})
    },
    Spec: { ContainerSpec: { Image: input.image } }
  };
}
