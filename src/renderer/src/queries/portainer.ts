import { useQuery, type QueryClient } from '@tanstack/react-query';

import type {
  PortainerConnection,
  PortainerStackCatalog,
  PortainerStackImages,
  PortainerStackRuntime,
  PortainerStackStatusInput
} from '@shared/types';

export const portainerConnectionsQueryKey = ['portainer-connections'] as const;

export const portainerStackCatalogQueryKey = (
  connectionId: string
): readonly ['portainer-stack-catalog', string] => [
  'portainer-stack-catalog',
  connectionId
];

export const portainerStackRuntimeQueryKey = (
  input: PortainerStackStatusInput
): readonly ['portainer-stack-runtime', string, number, number, string] => [
  'portainer-stack-runtime',
  input.connectionId,
  input.endpointId,
  input.stackId,
  input.stackName
];

export const portainerStackImagesQueryKey = (
  input: PortainerStackStatusInput
): readonly ['portainer-stack-images', string, number, number, string] => [
  'portainer-stack-images',
  input.connectionId,
  input.endpointId,
  input.stackId,
  input.stackName
];

export function usePortainerConnections(enabled = true) {
  return useQuery({
    queryKey: portainerConnectionsQueryKey,
    queryFn: (): Promise<PortainerConnection[]> =>
      window.api.listPortainerConnections(),
    enabled,
    staleTime: Number.POSITIVE_INFINITY
  });
}

export function usePortainerStackCatalog(
  connectionId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: connectionId
      ? portainerStackCatalogQueryKey(connectionId)
      : ['portainer-stack-catalog', 'none'],
    queryFn: async (): Promise<PortainerStackCatalog> => {
      if (!connectionId) {
        throw new Error('A Portainer connection is required.');
      }

      return window.api.getPortainerStackCatalog(connectionId);
    },
    enabled: enabled && Boolean(connectionId),
    staleTime: 60_000
  });
}

export function usePortainerStackRuntime(input: PortainerStackStatusInput) {
  return useQuery({
    queryKey: portainerStackRuntimeQueryKey(input),
    queryFn: (): Promise<PortainerStackRuntime> =>
      window.api.getPortainerStackRuntime(input),
    staleTime: 10_000,
    refetchInterval: 20_000
  });
}

export function usePortainerStackImages(input: PortainerStackStatusInput) {
  return useQuery({
    queryKey: portainerStackImagesQueryKey(input),
    queryFn: (): Promise<PortainerStackImages> =>
      window.api.getPortainerStackImages(input),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000
  });
}

export async function refreshPortainerStackImages(
  queryClient: QueryClient,
  input: PortainerStackStatusInput
): Promise<void> {
  await queryClient.fetchQuery({
    queryKey: portainerStackImagesQueryKey(input),
    queryFn: (): Promise<PortainerStackImages> =>
      window.api.getPortainerStackImages({ ...input, refresh: true }),
    staleTime: 0
  });
}

export function clearPortainerConnectionQueries(
  queryClient: QueryClient,
  connectionId: string
): void {
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[1] === connectionId &&
      (query.queryKey[0] === 'portainer-stack-catalog' ||
        query.queryKey[0] === 'portainer-stack-runtime' ||
        query.queryKey[0] === 'portainer-stack-images')
  });
}
