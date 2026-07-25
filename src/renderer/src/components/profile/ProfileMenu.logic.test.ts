import { describe, expect, it } from 'vitest';

import { gitProfileFromDraft, type GitProfileDraft } from './ProfileMenu.logic';

const draft: GitProfileDraft = {
  name: '  Richie  ',
  email: '  rivasek@gmail.com  ',
  avatarColor: 'var(--accent-2)',
  sshKeyPath: '  /tmp/id_ed25519  ',
  ghConfigDir: '',
  githubLogin: '',
  githubHost: '',
  signingKey: '',
  remoteUrlPatterns: 'github.com/ripchie,\ngitlab.example.com'
};

describe('profile menu logic', () => {
  it('builds and connects a profile directly from a clicked GitHub CLI account', () => {
    expect(
      gitProfileFromDraft(
        draft,
        {
          login: 'ripchie',
          host: 'github.com',
          configDir: '/Users/richie/.config/gh',
          gitProtocol: 'https'
        },
        42
      )
    ).toEqual({
      id: 'rivasek-gmail-com-16',
      name: 'Richie',
      email: 'rivasek@gmail.com',
      avatarColor: 'var(--accent-2)',
      sshKeyPath: '/tmp/id_ed25519',
      ghConfigDir: '/Users/richie/.config/gh',
      githubLogin: 'ripchie',
      githubHost: 'github.com',
      signingKey: undefined,
      remoteUrlPatterns: ['github.com/ripchie', 'gitlab.example.com']
    });
  });

  it('keeps the edited profile identity while replacing its GitHub account', () => {
    expect(
      gitProfileFromDraft(
        {
          ...draft,
          editingProfileId: 'richie-profile',
          ghConfigDir: '/old/config',
          githubLogin: 'old-login',
          githubHost: 'github.example.com'
        },
        {
          login: 'ripchie',
          host: 'github.com',
          configDir: '/new/config',
          gitProtocol: 'ssh'
        }
      )
    ).toMatchObject({
      id: 'richie-profile',
      ghConfigDir: '/new/config',
      githubLogin: 'ripchie',
      githubHost: 'github.com'
    });
  });

  it('requires a complete Git identity before switching accounts', () => {
    expect(
      gitProfileFromDraft(
        { ...draft, email: ' ' },
        {
          login: 'ripchie',
          host: 'github.com',
          configDir: '/Users/richie/.config/gh',
          gitProtocol: 'https'
        }
      )
    ).toBeUndefined();
  });
});
