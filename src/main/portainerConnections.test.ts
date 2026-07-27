import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  default: {},
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => ''
  }
}));

import {
  normalizePortainerBaseUrl,
  portainerCredentialBoundaryChanged,
  PortainerConnectionRepository
} from './portainerConnections';

type StoredShape = {
  connections: Array<{
    id: string;
    name: string;
    baseUrl: string;
    tlsVerify: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  encryptedTokens: Record<string, string>;
};

class MemoryStore {
  readonly data: StoredShape = {
    connections: [],
    encryptedTokens: {}
  };

  get<TKey extends keyof StoredShape>(
    key: TKey,
    defaultValue: StoredShape[TKey]
  ): StoredShape[TKey] {
    return this.data[key] ?? defaultValue;
  }

  set<TKey extends keyof StoredShape>(key: TKey, value: StoredShape[TKey]): void {
    this.data[key] = value;
  }
}

describe('Portainer connection storage', () => {
  it('normalizes a Portainer origin with an optional subpath', () => {
    expect(normalizePortainerBaseUrl(' https://portainer.example.com/edge/ ')).toBe(
      'https://portainer.example.com/edge'
    );
    expect(normalizePortainerBaseUrl('http://localhost:9443/')).toBe(
      'http://localhost:9443'
    );
    expect(normalizePortainerBaseUrl('http://127.0.0.1:9443/')).toBe(
      'http://127.0.0.1:9443'
    );
  });

  it.each([
    'ftp://portainer.example.com',
    'http://portainer.example.com',
    'https://user:secret@portainer.example.com',
    'https://portainer.example.com/?token=secret',
    'https://portainer.example.com/#/home'
  ])('rejects unsafe or unsupported URL %s', (value) => {
    expect(() => normalizePortainerBaseUrl(value)).toThrow();
  });

  it('stores only encrypted token material and retains it on metadata edits', () => {
    const store = new MemoryStore();
    const codec = {
      isAvailable: () => true,
      encrypt: vi.fn((value: string) => `encrypted:${value.length}`),
      decrypt: vi.fn(() => 'ptr_secret')
    };
    const repository = new PortainerConnectionRepository(store, codec);

    const saved = repository.save({
      name: 'Production',
      baseUrl: 'https://portainer.example.com/',
      accessToken: 'ptr_secret',
      tlsVerify: true
    });
    const connection = saved[0];

    expect(connection).toBeDefined();
    expect(store.data.encryptedTokens[connection!.id]).toBe('encrypted:10');
    expect(JSON.stringify(store.data)).not.toContain('ptr_secret');
    expect(repository.resolve(connection!.id)).toEqual({
      connection,
      accessToken: 'ptr_secret'
    });

    repository.save({
      id: connection!.id,
      name: 'Production EU',
      baseUrl: 'https://portainer.example.com',
      tlsVerify: true
    });

    expect(store.data.encryptedTokens[connection!.id]).toBe('encrypted:10');
    expect(repository.list()[0]).toMatchObject({
      id: connection!.id,
      name: 'Production EU',
      tlsVerify: true
    });
    expect(codec.encrypt).toHaveBeenCalledTimes(1);
  });

  it('requires token re-entry before changing the server or TLS trust policy', () => {
    const store = new MemoryStore();
    const repository = new PortainerConnectionRepository(store, {
      isAvailable: () => true,
      encrypt: (value) => `encrypted:${value}`,
      decrypt: () => 'ptr_secret'
    });
    const connection = repository.save({
      name: 'Production',
      baseUrl: 'https://portainer.example.com',
      accessToken: 'ptr_secret',
      tlsVerify: true
    })[0]!;

    expect(() =>
      repository.save({
        id: connection.id,
        name: 'Production',
        baseUrl: 'https://attacker.example.com',
        tlsVerify: true
      })
    ).toThrow('Enter the Portainer access token again');
    expect(() =>
      repository.save({
        id: connection.id,
        name: 'Production',
        baseUrl: connection.baseUrl,
        tlsVerify: false
      })
    ).toThrow('Enter the Portainer access token again');
    expect(repository.list()[0]).toMatchObject({
      baseUrl: 'https://portainer.example.com',
      tlsVerify: true
    });
    expect(
      portainerCredentialBoundaryChanged(connection, {
        baseUrl: 'https://attacker.example.com',
        tlsVerify: true
      })
    ).toBe(true);
    expect(
      portainerCredentialBoundaryChanged(connection, {
        baseUrl: 'https://portainer.example.com/',
        tlsVerify: true
      })
    ).toBe(false);
  });

  it('requires secure storage and deletes both metadata and encrypted token', () => {
    const unavailableRepository = new PortainerConnectionRepository(new MemoryStore(), {
      isAvailable: () => false,
      encrypt: () => '',
      decrypt: () => ''
    });

    expect(() =>
      unavailableRepository.save({
        name: 'Production',
        baseUrl: 'https://portainer.example.com',
        accessToken: 'ptr_secret',
        tlsVerify: true
      })
    ).toThrow('Secure credential storage');

    const store = new MemoryStore();
    const repository = new PortainerConnectionRepository(store, {
      isAvailable: () => true,
      encrypt: () => 'ciphertext',
      decrypt: () => 'ptr_secret'
    });
    const connection = repository.save({
      name: 'Production',
      baseUrl: 'https://portainer.example.com',
      accessToken: 'ptr_secret',
      tlsVerify: true
    })[0]!;

    expect(repository.delete(connection.id)).toEqual([]);
    expect(store.data.encryptedTokens).toEqual({});
  });
});
