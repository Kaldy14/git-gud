import type {
  PortainerConnection,
  PortainerConnectionInput,
  PortainerConnectionTestResult,
  PortainerStackCatalog,
  PortainerStackImages,
  PortainerStackImagesInput,
  PortainerStackRuntime,
  PortainerStackStatusInput
} from '@shared/types';

import { createPortainerClient } from './portainerClient';
import {
  listPortainerConnections,
  normalizePortainerBaseUrl,
  portainerCredentialBoundaryChanged,
  resolvePortainerConnection
} from './portainerConnections';

export async function testPortainerConnection(
  input: PortainerConnectionInput
): Promise<PortainerConnectionTestResult> {
  const suppliedAccessToken = input.accessToken?.trim();
  const storedConnection = input.id
    ? listPortainerConnections().find((connection) => connection.id === input.id)
    : undefined;

  if (input.id && !storedConnection) {
    throw new Error('The selected Portainer connection no longer exists.');
  }

  if (
    storedConnection &&
    !suppliedAccessToken &&
    portainerCredentialBoundaryChanged(storedConnection, input)
  ) {
    throw new Error(
      'Enter the Portainer access token again when changing the server URL or TLS verification.'
    );
  }

  const storedAccessToken =
    !suppliedAccessToken && input.id
      ? resolvePortainerConnection(input.id).accessToken
      : undefined;
  const accessToken = suppliedAccessToken || storedAccessToken;

  if (!accessToken) {
    throw new Error('Enter a Portainer personal access token.');
  }

  const now = new Date().toISOString();
  const connection: PortainerConnection = {
    id: storedConnection?.id ?? 'portainer:connection-test',
    name: input.name.trim(),
    baseUrl: normalizePortainerBaseUrl(input.baseUrl),
    tlsVerify: input.tlsVerify,
    createdAt: storedConnection?.createdAt ?? now,
    updatedAt: now
  };

  return createPortainerClient({ connection, accessToken }).testConnection();
}

export function loadPortainerStackCatalog(
  connectionId: string
): Promise<PortainerStackCatalog> {
  return clientForConnection(connectionId).loadStackCatalog();
}

export function loadPortainerStackRuntime(
  input: PortainerStackStatusInput
): Promise<PortainerStackRuntime> {
  return clientForConnection(input.connectionId).loadStackRuntime(input);
}

export function loadPortainerStackImages(
  input: PortainerStackImagesInput
): Promise<PortainerStackImages> {
  return clientForConnection(input.connectionId).loadStackImages(input, input.refresh);
}

function clientForConnection(connectionId: string) {
  return createPortainerClient(resolvePortainerConnection(connectionId));
}
