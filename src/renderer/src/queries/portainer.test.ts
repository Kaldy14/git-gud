import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearPortainerConnectionQueries,
  portainerStackCatalogQueryKey,
  portainerStackImagesQueryKey,
  portainerStackRuntimeQueryKey,
  refreshPortainerStackImages
} from './portainer';

const input = {
  connectionId: 'portainer:production',
  endpointId: 3,
  stackId: 12,
  stackName: 'storefront'
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Portainer queries', () => {
  it('requests a live image-status refresh for a manual dashboard refresh', async () => {
    const getPortainerStackImages = vi.fn().mockResolvedValue({
      connectionId: input.connectionId,
      endpointId: input.endpointId,
      stackId: input.stackId,
      services: [],
      loadedAt: '2026-07-27T12:00:00.000Z'
    });
    vi.stubGlobal('window', {
      api: { getPortainerStackImages }
    });
    const queryClient = new QueryClient();

    await refreshPortainerStackImages(queryClient, input);

    expect(getPortainerStackImages).toHaveBeenCalledWith({
      ...input,
      refresh: true
    });
  });

  it('clears all connection-scoped catalog, runtime, and image data', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      portainerStackCatalogQueryKey(input.connectionId),
      { environments: [] }
    );
    queryClient.setQueryData(portainerStackRuntimeQueryKey(input), { health: 'healthy' });
    queryClient.setQueryData(portainerStackImagesQueryKey(input), { services: [] });
    queryClient.setQueryData(
      portainerStackCatalogQueryKey('portainer:other'),
      { environments: [] }
    );

    clearPortainerConnectionQueries(queryClient, input.connectionId);

    expect(queryClient.getQueryData(portainerStackCatalogQueryKey(input.connectionId))).toBeUndefined();
    expect(queryClient.getQueryData(portainerStackRuntimeQueryKey(input))).toBeUndefined();
    expect(queryClient.getQueryData(portainerStackImagesQueryKey(input))).toBeUndefined();
    expect(queryClient.getQueryData(portainerStackCatalogQueryKey('portainer:other'))).toBeDefined();
  });
});
