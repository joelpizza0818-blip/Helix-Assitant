import assert from 'node:assert/strict';
import { test } from 'node:test';
import express, { Express } from 'express';
import rateLimit from 'express-rate-limit';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { createApp } from '../src/app';
import { createHealthRouter } from '../src/routes/health';

async function startServer(app: Express) {
  const server = app.listen(0, '127.0.0.1');

  await new Promise<void>((resolve) => server.once('listening', resolve));

  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function startHealthServer(databaseProbe: () => Promise<unknown>) {
  const app = express();
  app.use(createHealthRouter(databaseProbe));
  return startServer(app);
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('readiness reports a connected database with HTTP 200', async () => {
  const { server, baseUrl } = await startHealthServer(async () => undefined);
  try {
    const response = await fetch(`${baseUrl}/health/ready`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'healthy');
    assert.equal(body.database, 'connected');
  } finally {
    await stopServer(server);
  }
});

test('readiness reports an unreachable database with HTTP 503', async () => {
  const { server, baseUrl } = await startHealthServer(async () => {
    throw new Error('database unavailable');
  });
  try {
    const response = await fetch(`${baseUrl}/health/ready`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.database, 'unreachable');
  } finally {
    await stopServer(server);
  }
});

test('the legacy health endpoint remains a readiness check', async () => {
  const { server, baseUrl } = await startHealthServer(async () => {
    throw new Error('database unavailable');
  });
  try {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.database, 'unreachable');
  } finally {
    await stopServer(server);
  }
});

test('liveness remains healthy without checking the database', async () => {
  let probeCalled = false;
  const { server, baseUrl } = await startHealthServer(async () => {
    probeCalled = true;
    throw new Error('database unavailable');
  });
  try {
    const response = await fetch(`${baseUrl}/health/live`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'healthy');
    assert.equal(probeCalled, false);
  } finally {
    await stopServer(server);
  }
});

test('liveness bypasses the app rate limit while readiness remains rate limited', async () => {
  const app = createApp({
    healthRouter: createHealthRouter(async () => undefined),
    rateLimiter: rateLimit({
      windowMs: 60_000,
      max: 1,
      standardHeaders: false,
      legacyHeaders: false,
    }),
  });
  const { server, baseUrl } = await startServer(app);

  try {
    const firstReadiness = await fetch(`${baseUrl}/api/health/ready`);
    const limitedReadiness = await fetch(`${baseUrl}/api/health/ready`);
    const liveness = await fetch(`${baseUrl}/api/health/live`);
    const livenessHead = await fetch(`${baseUrl}/api/health/live`, {
      method: 'HEAD',
    });

    assert.equal(firstReadiness.status, 200);
    assert.equal(limitedReadiness.status, 429);
    assert.equal(liveness.status, 200);
    assert.equal(livenessHead.status, 200);
  } finally {
    await stopServer(server);
  }
});
