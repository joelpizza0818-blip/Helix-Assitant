import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { createApp } from '../src/app';
import { logger } from '../src/lib/logger';

async function startServer(app: express.Express) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));

  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('createApp logs request details without query strings and returns a stable 404', async () => {
  const secret = 'secret=access-log-sentinel';
  const pathSecret = 'secret=path-access-log-sentinel';
  const tenantSecret = 'PATH_SENTINEL';
  const app = createApp({
    healthRouter: express.Router(),
    rateLimiter: (_req, _res, next) => next(),
    additionalRoutes: [
      {
        path: '/api/items',
        router: express.Router().get('/:id', (_req, res) => {
          res.json({ success: true });
        }),
      },
      {
        path: '/api/tenant/:tenant',
        router: express.Router().get('/items/:id', (_req, res) => {
          res.json({ success: true });
        }),
      },
    ],
  });
  const loggedCalls: unknown[][] = [];
  const originalLoggerInfo = logger.info;
  logger.info = ((...args: unknown[]) => {
    loggedCalls.push(args);
    return logger;
  }) as typeof logger.info;

  const { server, baseUrl } = await startServer(app);
  try {
    const matchedResponse = await fetch(`${baseUrl}/api/items/42?${secret}`);
    const tenantResponse = await fetch(
      `${baseUrl}/api/tenant/${tenantSecret}/items/42`
    );
    const unmatchedResponse = await fetch(
      `${baseUrl}/private/${pathSecret}?${secret}`
    );
    const unmatchedBody = await unmatchedResponse.json();
    const loggedOutput = JSON.stringify(loggedCalls);

    assert.equal(matchedResponse.status, 200);
    assert.equal(tenantResponse.status, 200);
    assert.equal(unmatchedResponse.status, 404);
    assert.deepEqual(unmatchedBody, {
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'The requested endpoint does not exist.',
      },
    });
    assert.equal(JSON.stringify(unmatchedBody).includes(secret), false);
    assert.equal(JSON.stringify(unmatchedBody).includes(pathSecret), false);
    assert.equal(loggedOutput.includes(secret), false);
    assert.equal(loggedOutput.includes(pathSecret), false);
    assert.equal(loggedOutput.includes(tenantSecret), false);
    assert.equal(loggedOutput.includes('?'), false);
    assert.match(loggedOutput, /GET \/:id 200 [\d.]+ ms/);
    assert.match(loggedOutput, /GET \/items\/:id 200 [\d.]+ ms/);
    assert.match(loggedOutput, /GET \/unmatched 404 [\d.]+ ms/);
  } finally {
    await stopServer(server);
    logger.info = originalLoggerInfo;
  }
});
