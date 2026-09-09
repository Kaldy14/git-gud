import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseBugRequest,
  type BugFinderRequest,
  type BugFinderResult
} from '@shared/bugFinder';
import cliSource from './bugFinderCli.mjs?raw';

export async function startBugFinderBridge(
  directory: string,
  handle: (request: BugFinderRequest) => Promise<BugFinderResult>
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    res.setHeader('Content-Type', 'application/json');
    if (
      req.method !== 'POST' ||
      req.url !== '/findings' ||
      req.headers.origin ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res
        .writeHead(403)
        .end(
          JSON.stringify({
            code: 'UNAVAILABLE',
            error: 'Unauthorized Git Gud connection.'
          })
        );
      return;
    }
    try {
      req.setEncoding('utf8');
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 200_000) throw new Error('Input too large.');
      }
      const request = parseBugRequest(JSON.parse(body));
      if (['start', 'prompt', 'post', 'reconcile'].includes(request.action))
        throw new Error(
          'CLI only supports reading and editing finding records.'
        );
      res.end(JSON.stringify(await handle(request)));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Request failed.';
      const code = message.startsWith('CONFLICT:')
        ? 'CONFLICT'
        : message.startsWith('STALE_HEAD:')
          ? 'STALE_HEAD'
          : 'INVALID_REQUEST';
      res.writeHead(400).end(JSON.stringify({ code, error: message }));
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not start the Git Gud CLI connection.');
  const script = join(directory, 'git-gud.mjs'),
    connection = join(directory, 'connection.json');
  try {
    await writeFile(script, cliSource, { mode: 0o700 });
    await writeFile(connection, JSON.stringify({ port: address.port, token }), {
      mode: 0o600
    });
  } catch (error) {
    server.close();
    throw error;
  }
  server.unref();
  return { script, connection, close: () => server.close() };
}
