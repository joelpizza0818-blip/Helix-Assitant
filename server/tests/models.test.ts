import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import express, { RequestHandler } from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { AuthenticatedRequest } from '../src/types';

const apiKey = 'test-key-never-use-a-real-secret';

process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
const { createModelsRouter } = require('../src/routes/models') as {
  createModelsRouter: (options?: any) => express.Router;
};

function createCredentialStore(
  upsert: (args: any) => Promise<any>,
  findMany: () => Promise<any[]> = async () => []
) {
  return {
    findMany,
    upsert,
  };
}

const authenticate: RequestHandler = (req, _res, next) => {
  (req as AuthenticatedRequest).user = {
    id: 'user-1',
    email: 'test@example.com',
    supabaseId: 'supabase-user-1',
  };
  next();
};

async function startModelsServer(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use('/api/models', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api/models`;
  return { server, url: `${baseUrl}/credentials`, modelsUrl: baseUrl };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('persists healthy only after an injected provider validator succeeds', async () => {
  let upsertArgs: any;
  let validatorCalls = 0;
  const router = createModelsRouter({
    credentialStore: createCredentialStore(async (args) => {
      upsertArgs = args;
      return {
        provider: 'openai',
        keySlot: 1,
        healthStatus: args.create.healthStatus,
        lastValidatedAt: args.create.lastValidatedAt,
      };
    }) as any,
    authenticate,
    validateCredential: async (provider, submittedKey) => {
      validatorCalls += 1;
      assert.equal(provider, 'openai');
      assert.equal(submittedKey, apiKey);
      return true;
    },
  });
  const { server, url } = await startModelsServer(router);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', keySlot: 1, apiKey }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.healthStatus, 'healthy');
    assert.ok(body.data.lastValidatedAt);
    assert.equal(validatorCalls, 1);
    assert.equal(upsertArgs.create.healthStatus, 'healthy');
    assert.equal(upsertArgs.update.healthStatus, 'healthy');
    assert.equal(upsertArgs.create.keyHash, crypto.createHash('sha256').update(apiKey).digest('hex'));
    assert.equal(JSON.stringify(body).includes(apiKey), false);
  } finally {
    await stopServer(server);
  }
});

test('rejects an invalid provider credential without persisting it', async () => {
  let upsertCalls = 0;
  const router = createModelsRouter({
    credentialStore: createCredentialStore(async () => {
      upsertCalls += 1;
      throw new Error('must not persist rejected credentials');
    }) as any,
    authenticate,
    validateCredential: async () => false,
  });
  const { server, url } = await startModelsServer(router);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', keySlot: 1, apiKey }),
    });
    const body = await response.json();

    assert.equal(response.status, 422);
    assert.equal(body.error.code, 'INVALID_CREDENTIAL');
    assert.equal(upsertCalls, 0);
  } finally {
    await stopServer(server);
  }
});

test('does not persist healthy when provider validation errors and omits provider details', async () => {
  let upsertCalls = 0;
  const router = createModelsRouter({
    credentialStore: createCredentialStore(async () => {
      upsertCalls += 1;
      throw new Error('must not persist after provider failure');
    }) as any,
    authenticate,
    validateCredential: async () => {
      throw new Error(`provider error included secret ${apiKey}`);
    },
  });
  const { server, url } = await startModelsServer(router);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', keySlot: 1, apiKey }),
    });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.error.code, 'PROVIDER_VALIDATION_FAILED');
    assert.equal(JSON.stringify(body).includes(apiKey), false);
    assert.equal(upsertCalls, 0);
  } finally {
    await stopServer(server);
  }
});

test('stores credentials as configured when no provider validator is configured', async () => {
  let upsertArgs: any;
  const router = createModelsRouter({
    credentialStore: createCredentialStore(async (args) => {
      upsertArgs = args;
      return {
        provider: 'openai',
        keySlot: 1,
        healthStatus: args.create.healthStatus,
        lastValidatedAt: args.create.lastValidatedAt,
      };
    }) as any,
    authenticate,
  });
  const { server, url } = await startModelsServer(router);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', keySlot: 1, apiKey }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.healthStatus, 'configured');
    assert.equal(body.data.lastValidatedAt, null);
    assert.equal(upsertArgs.create.healthStatus, 'configured');
    assert.equal(upsertArgs.update.healthStatus, 'configured');
    assert.equal(upsertArgs.create.lastValidatedAt, null);
  } finally {
    await stopServer(server);
  }
});

test('rejects a structurally invalid credential without persisting it', async () => {
  let upsertCalls = 0;
  const router = createModelsRouter({
    credentialStore: createCredentialStore(async () => {
      upsertCalls += 1;
      throw new Error('must not persist invalid payload');
    }) as any,
    authenticate,
    validateCredential: async () => true,
  });
  const { server, url } = await startModelsServer(router);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', keySlot: 1, apiKey: 'short' }),
    });

    assert.equal(response.status, 400);
    assert.equal(upsertCalls, 0);
  } finally {
    await stopServer(server);
  }
});

test('lists models for configured providers without claiming they are healthy', async () => {
  const router = createModelsRouter({
    credentialStore: createCredentialStore(
      async () => {
        throw new Error('not used');
      },
      async () => [{ provider: 'openai', healthStatus: 'configured' }]
    ) as any,
    authenticate,
  });
  const { server, modelsUrl } = await startModelsServer(router);

  try {
    const response = await fetch(modelsUrl);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.configuredProviders, ['openai']);
    assert.equal(body.data.availableModels[0].provider, 'openai');
  } finally {
    await stopServer(server);
  }
});

test('lists current Google Gemini model IDs', async () => {
  const router = createModelsRouter({
    credentialStore: createCredentialStore(
      async () => {
        throw new Error('not used');
      },
      async () => [{ provider: 'google', healthStatus: 'configured' }]
    ) as any,
    authenticate,
  });
  const { server, modelsUrl } = await startModelsServer(router);

  try {
    const response = await fetch(modelsUrl);
    const body = await response.json();
    const googleModels = body.data.availableModels
      .filter((model: { provider: string }) => model.provider === 'google')
      .map((model: { id: string }) => model.id);

    assert.deepEqual(googleModels, [
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-pro-preview',
    ]);
  } finally {
    await stopServer(server);
  }
});
