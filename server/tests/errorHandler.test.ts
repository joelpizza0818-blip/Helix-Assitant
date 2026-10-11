import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { errorHandler } from '../src/middleware/errorHandler';
import { logger } from '../src/lib/logger';

async function startServer(error: unknown) {
  const app = express();
  app.get('/failure', (_req, _res, next) => next(error));
  app.use(errorHandler);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));

  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/failure` };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function withNodeEnv(value: string | undefined) {
  const previous = process.env.NODE_ENV;
  if (value === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = value;
  }
  return () => {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  };
}

test('production hides internal 5xx details while retaining diagnostics safely', async () => {
  const internalSecret = 'database-password-private';
  const querySecret = 'query-token-private';
  const headerSecret = 'authorization-token-private';
  const error = Object.assign(new Error(`Database failed with ${internalSecret}`), {
    statusCode: 503,
    code: 'P2033',
    cause: { credential: internalSecret },
  });
  error.stack = `Error: Database failed with ${internalSecret}\n    at internalOperation (server.js:10:1) { credential: ${internalSecret} }`;

  const restoreNodeEnv = withNodeEnv('production');
  const loggedCalls: unknown[][] = [];
  const originalLoggerError = logger.error;
  logger.error = ((...args: unknown[]) => {
    loggedCalls.push(args);
    return logger;
  }) as typeof logger.error;

  const { server, url } = await startServer(error);
  try {
    const response = await fetch(`${url}?token=${querySecret}`, {
      headers: { authorization: `Bearer ${headerSecret}` },
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(body.error.message, 'An unexpected error occurred');
    assert.equal('stack' in body.error, false);
    assert.equal('cause' in body.error, false);

    const loggedOutput = JSON.stringify(loggedCalls);
    assert.equal(loggedOutput.includes(internalSecret), false);
    assert.equal(loggedOutput.includes(querySecret), false);
    assert.equal(loggedOutput.includes(headerSecret), false);
    assert.equal(loggedOutput.includes(error.stack), false);
    assert.equal(loggedOutput.includes('Database failed'), false);
    assert.equal(loggedOutput.includes('internalOperation'), false);
    assert.equal(loggedOutput.includes('stack'), false);
    assert.equal(loggedOutput.includes('cause'), false);
    assert.match(loggedOutput, /"errorName":"Error"/);
    assert.match(loggedOutput, /"statusCode":503/);
    assert.match(loggedOutput, /"categoryCode":"INTERNAL_ERROR"/);
    assert.match(loggedOutput, /"method":"GET"/);
    assert.match(loggedOutput, /"route":"\/failure"/);
    assert.equal(loggedOutput.includes('?'), false);
  } finally {
    await stopServer(server);
    logger.error = originalLoggerError;
    restoreNodeEnv();
  }
});

test('development responses retain error details for debugging', async () => {
  const error = Object.assign(new Error('Database unavailable in development'), {
    statusCode: 500,
    code: 'DB_UNAVAILABLE',
  });
  const restoreNodeEnv = withNodeEnv('development');
  const { server, url } = await startServer(error);

  try {
    const response = await fetch(url);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error.code, 'DB_UNAVAILABLE');
    assert.equal(body.error.message, 'Database unavailable in development');
    assert.match(body.error.stack, /Database unavailable in development/);
  } finally {
    await stopServer(server);
    restoreNodeEnv();
  }
});

test('production preserves an explicitly public 4xx error', async () => {
  const error = Object.assign(new Error('The supplied value is invalid.'), {
    statusCode: 422,
    code: 'INPUT_INVALID',
    expose: true,
  });
  const restoreNodeEnv = withNodeEnv('production');
  const { server, url } = await startServer(error);

  try {
    const response = await fetch(url);
    const body = await response.json();

    assert.equal(response.status, 422);
    assert.equal(body.error.code, 'INPUT_INVALID');
    assert.equal(body.error.message, 'The supplied value is invalid.');
    assert.equal('stack' in body.error, false);
  } finally {
    await stopServer(server);
    restoreNodeEnv();
  }
});

test('production does not expose an unmarked 4xx error message', async () => {
  const error = Object.assign(new Error('Internal parser detail'), {
    statusCode: 400,
    code: 'PARSER_INTERNAL',
  });
  const restoreNodeEnv = withNodeEnv('production');
  const { server, url } = await startServer(error);

  try {
    const response = await fetch(url);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'REQUEST_ERROR');
    assert.equal(body.error.message, 'The request could not be processed.');
    assert.equal(JSON.stringify(body).includes('Internal parser detail'), false);
  } finally {
    await stopServer(server);
    restoreNodeEnv();
  }
});
