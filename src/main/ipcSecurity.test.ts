import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isTrustedRendererUrl } from './ipcSecurity';

describe('renderer IPC trust', () => {
  it('only trusts the exact packaged renderer file', () => {
    const rendererPath = '/tmp/git-gud/renderer/index.html';
    const rendererUrl = pathToFileURL(rendererPath).href;

    expect(isTrustedRendererUrl(rendererUrl, undefined, rendererPath)).toBe(true);
    expect(isTrustedRendererUrl(pathToFileURL('/tmp/attacker.html').href, undefined, rendererPath)).toBe(false);
    expect(isTrustedRendererUrl(`${rendererUrl}?spoofed=true`, undefined, rendererPath)).toBe(false);
    expect(isTrustedRendererUrl(`${rendererUrl}#child`, undefined, rendererPath)).toBe(false);
  });

  it('only trusts the exact configured development URL', () => {
    const devUrl = 'http://127.0.0.1:5173/app/';

    expect(isTrustedRendererUrl(devUrl, devUrl)).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/other/', devUrl)).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:5173/app/', devUrl)).toBe(false);
    expect(isTrustedRendererUrl(`${devUrl}?frame=child`, devUrl)).toBe(false);
  });

  it('rejects malformed and non-renderer protocols', () => {
    expect(isTrustedRendererUrl('not a URL', undefined, '/tmp/index.html')).toBe(false);
    expect(isTrustedRendererUrl('data:text/html,hello', undefined, '/tmp/index.html')).toBe(false);
    expect(isTrustedRendererUrl('https://example.com', undefined, '/tmp/index.html')).toBe(false);
  });
});
