import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import Store from 'electron-store';
import { safeStorage } from 'electron';

import type { PortainerConnection, PortainerConnectionInput } from '@shared/types';

type PortainerConnectionStoreShape = {
  connections: PortainerConnection[];
  encryptedTokens: Record<string, string>;
};

type PortainerConnectionStore = {
  get<TKey extends keyof PortainerConnectionStoreShape>(
    key: TKey,
    defaultValue: PortainerConnectionStoreShape[TKey]
  ): PortainerConnectionStoreShape[TKey];
  set<TKey extends keyof PortainerConnectionStoreShape>(
    key: TKey,
    value: PortainerConnectionStoreShape[TKey]
  ): void;
};

export type PortainerSecretCodec = {
  isAvailable: () => boolean;
  encrypt: (value: string) => string;
  decrypt: (value: string) => string;
};

export type ResolvedPortainerConnection = {
  connection: PortainerConnection;
  accessToken: string;
};

const store = new Store<PortainerConnectionStoreShape>({
  name: 'git-gud-portainer',
  clearInvalidConfig: true,
  ...testStoreDirectory('portainer'),
  defaults: {
    connections: [],
    encryptedTokens: {}
  }
});

const electronSecretCodec: PortainerSecretCodec = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64'))
};

export class PortainerConnectionRepository {
  constructor(
    private readonly connectionStore: PortainerConnectionStore,
    private readonly secretCodec: PortainerSecretCodec
  ) {}

  list(): PortainerConnection[] {
    return normalizeConnections(this.connectionStore.get('connections', [])).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  save(input: PortainerConnectionInput): PortainerConnection[] {
    const connections = this.list();
    const existing = input.id
      ? connections.find((connection) => connection.id === input.id)
      : undefined;
    const now = new Date().toISOString();
    const baseUrl = normalizePortainerBaseUrl(input.baseUrl);
    const connection: PortainerConnection = {
      id: existing?.id ?? randomUUID(),
      name: input.name.trim(),
      baseUrl,
      tlsVerify: input.tlsVerify,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    const accessToken = input.accessToken?.trim();
    const encryptedTokens = normalizeEncryptedTokens(
      this.connectionStore.get('encryptedTokens', {})
    );
    const credentialBoundaryChanged =
      existing !== undefined &&
      portainerCredentialBoundaryChanged(existing, {
        baseUrl,
        tlsVerify: input.tlsVerify
      });

    if (accessToken) {
      if (!this.secretCodec.isAvailable()) {
        throw new Error('Secure credential storage is not available on this system.');
      }

      encryptedTokens[connection.id] = this.secretCodec.encrypt(accessToken);
    } else if (credentialBoundaryChanged) {
      throw new Error(
        'Enter the Portainer access token again when changing the server URL or TLS verification.'
      );
    } else if (!encryptedTokens[connection.id]) {
      throw new Error('Enter a Portainer personal access token.');
    }

    const nextConnections = existing
      ? connections.map((candidate) =>
          candidate.id === existing.id ? connection : candidate
        )
      : [...connections, connection];

    this.connectionStore.set('connections', nextConnections);
    this.connectionStore.set('encryptedTokens', encryptedTokens);
    return this.list();
  }

  delete(connectionId: string): PortainerConnection[] {
    const encryptedTokens = normalizeEncryptedTokens(
      this.connectionStore.get('encryptedTokens', {})
    );
    delete encryptedTokens[connectionId];
    this.connectionStore.set(
      'connections',
      this.list().filter((connection) => connection.id !== connectionId)
    );
    this.connectionStore.set('encryptedTokens', encryptedTokens);
    return this.list();
  }

  resolve(connectionId: string): ResolvedPortainerConnection {
    const connection = this.list().find((candidate) => candidate.id === connectionId);

    if (!connection) {
      throw new Error('The selected Portainer connection no longer exists.');
    }

    const encryptedToken = normalizeEncryptedTokens(
      this.connectionStore.get('encryptedTokens', {})
    )[connectionId];

    if (!encryptedToken) {
      throw new Error('The Portainer connection does not have a stored access token.');
    }

    if (!this.secretCodec.isAvailable()) {
      throw new Error('Secure credential storage is not available on this system.');
    }

    try {
      return {
        connection,
        accessToken: this.secretCodec.decrypt(encryptedToken)
      };
    } catch {
      throw new Error('The Portainer access token could not be read. Edit the connection and enter it again.');
    }
  }
}

const portainerConnectionRepository = new PortainerConnectionRepository(
  store,
  electronSecretCodec
);

export function listPortainerConnections(): PortainerConnection[] {
  return portainerConnectionRepository.list();
}

export function savePortainerConnection(
  input: PortainerConnectionInput
): PortainerConnection[] {
  return portainerConnectionRepository.save(input);
}

export function deletePortainerConnection(connectionId: string): PortainerConnection[] {
  return portainerConnectionRepository.delete(connectionId);
}

export function resolvePortainerConnection(
  connectionId: string
): ResolvedPortainerConnection {
  return portainerConnectionRepository.resolve(connectionId);
}

export function normalizePortainerBaseUrl(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > 2_048) {
    throw new Error('Enter a valid Portainer URL.');
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid Portainer URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The Portainer URL must use HTTP or HTTPS.');
  }

  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new Error(
      'The Portainer URL must use HTTPS. HTTP is allowed only for a loopback address.'
    );
  }

  if (url.username || url.password) {
    throw new Error('Do not include credentials in the Portainer URL.');
  }

  if (url.search || url.hash) {
    throw new Error('The Portainer URL must not include a query string or fragment.');
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function portainerCredentialBoundaryChanged(
  connection: Pick<PortainerConnection, 'baseUrl' | 'tlsVerify'>,
  input: Pick<PortainerConnectionInput, 'baseUrl' | 'tlsVerify'>
): boolean {
  return (
    connection.baseUrl !== normalizePortainerBaseUrl(input.baseUrl) ||
    connection.tlsVerify !== input.tlsVerify
  );
}

function normalizeConnections(value: unknown): PortainerConnection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((connection) => {
    if (!isRecord(connection)) {
      return [];
    }

    if (
      typeof connection.id !== 'string' ||
      typeof connection.name !== 'string' ||
      typeof connection.baseUrl !== 'string' ||
      typeof connection.tlsVerify !== 'boolean' ||
      typeof connection.createdAt !== 'string' ||
      typeof connection.updatedAt !== 'string'
    ) {
      return [];
    }

    return [
      {
        id: connection.id,
        name: connection.name,
        baseUrl: connection.baseUrl,
        tlsVerify: connection.tlsVerify,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt
      }
    ];
  });
}

function normalizeEncryptedTokens(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].length > 0
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function testStoreDirectory(name: string): { cwd: string } | Record<string, never> {
  if (process.env.NODE_ENV !== 'test') {
    return {};
  }

  return {
    cwd: join(tmpdir(), 'git-gud-vitest-store', name)
  };
}
