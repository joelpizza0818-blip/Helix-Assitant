import assert from 'node:assert/strict';
import { test } from 'node:test';
import express, { Express } from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { updatesRouter } from '../src/routes/updates';
import { sendVersionUpdateEmail } from '../src/lib/mailer';

async function startServer(app: Express) {
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

test('POST /api/updates/subscribe adds a subscriber email', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/updates', updatesRouter);

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/updates/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'developer@example.com' }),
    });

    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.totalSubscribers >= 1);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/updates/subscribe rejects invalid email format', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/updates', updatesRouter);

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/updates/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    const data = (await res.json()) as any;
    assert.equal(res.status, 400);
    assert.equal(data.success, false);
  } finally {
    await stopServer(server);
  }
});

test('sendVersionUpdateEmail sends version update email with Nodemailer', async () => {
  const result = await sendVersionUpdateEmail(['user@test.local'], {
    version: '0.2.0',
    title: 'Stagger transitions, HELIX Lite & Privacy Gates',
    changes: ['New scrollytelling cards', 'HELIX Lite distribution'],
  });

  assert.equal(result.success, true);
  assert.equal(result.sentCount, 1);
});
