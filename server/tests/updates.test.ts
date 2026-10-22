import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import express, { Express } from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { updatesRouter, _resetSubscribersForTesting } from '../src/routes/updates';
import { requireAdminAuth } from '../src/middleware/adminAuth';
import {
  sendVersionUpdateEmail,
  generateVersionUpdateHtml,
  escapeHtml,
  sanitizeUrl,
} from '../src/lib/mailer';

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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/updates', updatesRouter);
  return app;
}

const originalAdminToken = process.env.ADMIN_TOKEN;
const originalHelixAdminToken = process.env.HELIX_ADMIN_TOKEN;

function restoreEnv() {
  if (originalAdminToken !== undefined) {
    process.env.ADMIN_TOKEN = originalAdminToken;
  } else {
    delete process.env.ADMIN_TOKEN;
  }
  if (originalHelixAdminToken !== undefined) {
    process.env.HELIX_ADMIN_TOKEN = originalHelixAdminToken;
  } else {
    delete process.env.HELIX_ADMIN_TOKEN;
  }
}

test('POST /api/updates/subscribe adds a subscriber email', async () => {
  const app = buildApp();
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
    assert.equal(data.message, 'Subscription request accepted by the update service.');
    assert.ok(data.totalSubscribers >= 1);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/updates/subscribe rejects invalid email format', async () => {
  const app = buildApp();
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

test('POST /api/updates/broadcast rejects request with 401 when admin token header is missing', async () => {
  process.env.ADMIN_TOKEN = 'secure-admin-token-123';
  const app = buildApp();
  const { server, baseUrl } = await startServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: '0.2.5',
        title: 'New Security Features',
        changes: ['Enhanced admin endpoints'],
      }),
    });

    const data = (await res.json()) as any;
    assert.equal(res.status, 401);
    assert.equal(data.success, false);
    assert.match(data.error, /admin authentication token is required/i);
  } finally {
    restoreEnv();
    await stopServer(server);
  }
});

test('POST /api/updates/broadcast rejects request with 403 when admin token is invalid', async () => {
  process.env.ADMIN_TOKEN = 'expected-secret-token';
  const app = buildApp();
  const { server, baseUrl } = await startServer(app);
  try {
    // Test with x-admin-token
    const res1 = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'wrong-token',
      },
      body: JSON.stringify({
        version: '0.2.5',
        title: 'New Security Features',
        changes: ['Enhanced admin endpoints'],
      }),
    });
    const data1 = (await res1.json()) as any;
    assert.equal(res1.status, 403);
    assert.equal(data1.success, false);
    assert.match(data1.error, /invalid admin token/i);

    // Test with Authorization: Bearer
    const res2 = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-bearer-token',
      },
      body: JSON.stringify({
        version: '0.2.5',
        title: 'New Security Features',
        changes: ['Enhanced admin endpoints'],
      }),
    });
    const data2 = (await res2.json()) as any;
    assert.equal(res2.status, 403);
    assert.equal(data2.success, false);
    assert.match(data2.error, /invalid admin token/i);
  } finally {
    restoreEnv();
    await stopServer(server);
  }
});

test('POST /api/updates/broadcast rejects request with 403 when ADMIN_TOKEN is not configured', async () => {
  delete process.env.ADMIN_TOKEN;
  delete process.env.HELIX_ADMIN_TOKEN;
  const app = buildApp();
  const { server, baseUrl } = await startServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'any-token',
      },
      body: JSON.stringify({
        version: '0.2.5',
        title: 'New Security Features',
        changes: ['Enhanced admin endpoints'],
      }),
    });
    const data = (await res.json()) as any;
    assert.equal(res.status, 403);
    assert.equal(data.success, false);
    assert.match(data.error, /admin token is not configured/i);
  } finally {
    restoreEnv();
    await stopServer(server);
  }
});

test('POST /api/updates/broadcast rejects request with 400 when no registered subscribers exist', async () => {
  _resetSubscribersForTesting();
  process.env.ADMIN_TOKEN = 'admin-secret-test';
  const app = buildApp();
  const { server, baseUrl } = await startServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'admin-secret-test',
      },
      body: JSON.stringify({
        version: '0.2.5',
        title: 'New Security Features',
        changes: ['Enhanced admin endpoints'],
      }),
    });
    const data = (await res.json()) as any;
    assert.equal(res.status, 400);
    assert.equal(data.success, false);
    assert.match(data.error, /no subscribed recipients found/i);
  } finally {
    restoreEnv();
    await stopServer(server);
  }
});

test('POST /api/updates/broadcast ignores arbitrary recipients in payload and broadcasts only to registered subscribers', async () => {
  _resetSubscribersForTesting();
  process.env.ADMIN_TOKEN = 'admin-secret-test';
  const app = buildApp();
  const { server, baseUrl } = await startServer(app);
  try {
    // Register two valid subscribers
    await fetch(`${baseUrl}/api/updates/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user1@example.com' }),
    });
    await fetch(`${baseUrl}/api/updates/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user2@example.com' }),
    });

    // Attempt broadcast with an attacker trying to inject arbitrary recipients
    const res = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'admin-secret-test',
      },
      body: JSON.stringify({
        version: '0.2.5',
        title: 'Security Hardening',
        changes: ['XSS Sanitization', 'Admin Token Enforcement'],
        recipients: ['attacker@evil.com', 'spam@victim.com'],
      }),
    });

    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    // Must only send to the 2 registered subscribers, NOT the 2 injected recipients!
    assert.equal(data.sentCount, 2);
    assert.match(data.message, /Update v0\.2\.5 sent to 2 users/);
  } finally {
    restoreEnv();
    await stopServer(server);
  }
});

test('POST /api/updates/broadcast succeeds with Authorization: Bearer token and HELIX_ADMIN_TOKEN fallback', async () => {
  _resetSubscribersForTesting();
  delete process.env.ADMIN_TOKEN;
  process.env.HELIX_ADMIN_TOKEN = 'helix-bearer-secret';

  const app = buildApp();
  const { server, baseUrl } = await startServer(app);
  try {
    // Register a subscriber
    await fetch(`${baseUrl}/api/updates/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'subscriber@example.com' }),
    });

    const res = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer helix-bearer-secret',
      },
      body: JSON.stringify({
        version: '0.2.5',
        title: 'Release Title',
        changes: ['Changelog entry 1'],
        downloadUrl: 'https://helix-assistant.dev/download',
      }),
    });

    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.sentCount, 1);
  } finally {
    restoreEnv();
    await stopServer(server);
  }
});

test('POST /api/updates/broadcast enforces strict Zod validation on payload fields', async () => {
  _resetSubscribersForTesting();
  process.env.ADMIN_TOKEN = 'admin-secret-test';

  const app = buildApp();
  const { server, baseUrl } = await startServer(app);
  try {
    // Subscribe one user so the subscriber count check passes
    await fetch(`${baseUrl}/api/updates/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'subscriber@example.com' }),
    });

    const authHeaders = {
      'Content-Type': 'application/json',
      'x-admin-token': 'admin-secret-test',
    };

    // 1. Version exceeds 50 characters
    const resVersionLong = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: 'v'.repeat(51),
        title: 'Valid Title',
        changes: ['Valid change'],
      }),
    });
    assert.equal(resVersionLong.status, 400);

    // 2. Empty version
    const resVersionEmpty = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: '   ',
        title: 'Valid Title',
        changes: ['Valid change'],
      }),
    });
    assert.equal(resVersionEmpty.status, 400);

    // 3. Title exceeds 200 characters
    const resTitleLong = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: '0.2.5',
        title: 'T'.repeat(201),
        changes: ['Valid change'],
      }),
    });
    assert.equal(resTitleLong.status, 400);

    // 4. Empty title
    const resTitleEmpty = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: '0.2.5',
        title: '   ',
        changes: ['Valid change'],
      }),
    });
    assert.equal(resTitleEmpty.status, 400);

    // 5. Empty changes array
    const resChangesEmpty = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: '0.2.5',
        title: 'Valid Title',
        changes: [],
      }),
    });
    assert.equal(resChangesEmpty.status, 400);

    // 6. Changes item exceeds 500 characters
    const resChangeTooLong = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: '0.2.5',
        title: 'Valid Title',
        changes: ['C'.repeat(501)],
      }),
    });
    assert.equal(resChangeTooLong.status, 400);

    // 7. Changes array exceeds 50 items
    const resTooManyChanges = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: '0.2.5',
        title: 'Valid Title',
        changes: Array.from({ length: 51 }, (_, i) => `Change #${i}`),
      }),
    });
    assert.equal(resTooManyChanges.status, 400);

    // 8. Invalid download URL
    const resInvalidUrl = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: '0.2.5',
        title: 'Valid Title',
        changes: ['Change 1'],
        downloadUrl: 'not-a-valid-url',
      }),
    });
    assert.equal(resInvalidUrl.status, 400);

    // 9. Version contains CRLF injection characters
    const resVersionCrlf = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: '0.2.5\r\nBcc: victim@example.com',
        title: 'Valid Title',
        changes: ['Change 1'],
      }),
    });
    assert.equal(resVersionCrlf.status, 400);
    const dataVersionCrlf = (await resVersionCrlf.json()) as any;
    assert.match(dataVersionCrlf.error, /cannot contain newline characters/i);

    // 10. Title contains CRLF injection characters
    const resTitleCrlf = await fetch(`${baseUrl}/api/updates/broadcast`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: '0.2.5',
        title: 'Release Title\nInjected-Header: evil',
        changes: ['Change 1'],
      }),
    });
    assert.equal(resTitleCrlf.status, 400);
    const dataTitleCrlf = (await resTitleCrlf.json()) as any;
    assert.match(dataTitleCrlf.error, /cannot contain newline characters/i);
  } finally {
    restoreEnv();
    await stopServer(server);
  }
});

test('generateVersionUpdateHtml strictly escapes HTML entities and prevents XSS injection', () => {
  const maliciousPayload = {
    version: '0.2.5<script>alert("xss-version")</script>',
    title: 'New release & updates <img src=x onerror=alert(1)> "quoted"',
    changes: [
      '<script>alert("xss-change")</script>',
      '<b onmouseover="alert(\'hover\')">Bold text</b>',
      'Normal feature & improvements: 5 > 3 & 2 < 4',
    ],
    downloadUrl: 'javascript:alert("exploit")',
    releaseDate: 'October 2026<script>evil()</script>',
  };

  const html = generateVersionUpdateHtml(maliciousPayload);

  // Assert NO executable script tags or dangerous html attributes survive unescaped
  assert.ok(!html.includes('<script>'), 'Generated HTML must not contain raw <script> tags');
  assert.ok(!html.includes('</script>'), 'Generated HTML must not contain raw </script> tags');
  assert.ok(!html.includes('<img src=x onerror'), 'Generated HTML must not contain raw <img onerror>');
  assert.ok(!html.includes('<b onmouseover='), 'Generated HTML must not contain raw <b onmouseover>');

  // Assert malicious javascript: protocol in downloadUrl is sanitized
  assert.ok(!html.includes('href="javascript:'), 'Generated HTML must not contain javascript: URL schemes');
  assert.ok(html.includes('href="https://helix-assistant.dev/download"'), 'Invalid/malicious URL must fall back to safe default');

  // Assert all entities are properly escaped
  assert.ok(html.includes('&lt;script&gt;alert(&quot;xss-version&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&lt;'));
  assert.ok(html.includes('&gt;'));
  assert.ok(html.includes('&quot;'));
  assert.ok(html.includes('&#39;'));
});

test('escapeHtml helper replaces all critical characters reliably', () => {
  assert.equal(escapeHtml(''), '');
  assert.equal(
    escapeHtml(`& < > " ' test`),
    '&amp; &lt; &gt; &quot; &#39; test'
  );
  assert.equal(
    escapeHtml('<script>alert("Hello & \'World\'")</script>'),
    '&lt;script&gt;alert(&quot;Hello &amp; &#39;World&#39;&quot;)&lt;/script&gt;'
  );
});

test('sanitizeUrl helper permits http/https and blocks javascript and dangerous protocols', () => {
  assert.equal(sanitizeUrl(''), 'https://helix-assistant.dev/download');
  assert.equal(sanitizeUrl(undefined), 'https://helix-assistant.dev/download');
  assert.equal(
    sanitizeUrl('https://github.com/helix-assistant/helix/releases/tag/v0.2.5'),
    'https://github.com/helix-assistant/helix/releases/tag/v0.2.5'
  );
  assert.equal(
    sanitizeUrl('http://insecure.dev/download'),
    'http://insecure.dev/download'
  );
  assert.equal(
    sanitizeUrl('javascript:alert(1)'),
    'https://helix-assistant.dev/download'
  );
  assert.equal(
    sanitizeUrl('data:text/html,<script>alert(1)</script>'),
    'https://helix-assistant.dev/download'
  );
  assert.equal(
    sanitizeUrl('vbscript:msgbox(1)'),
    'https://helix-assistant.dev/download'
  );
});

test('sendVersionUpdateEmail sends version update email with Nodemailer and uses BCC to protect subscriber PII', async () => {
  const recipients = ['user1@test.local', 'user2@test.local'];
  const result = await sendVersionUpdateEmail(recipients, {
    version: '0.2.0',
    title: 'Stagger transitions, HELIX Lite & Privacy Gates',
    changes: ['New scrollytelling cards', 'HELIX Lite distribution'],
  });

  assert.equal(result.success, true);
  assert.equal(result.sentCount, 2);
  assert.ok(result.rawMessage, 'rawMessage should be generated by stream transport');

  // Verify that To: contains sender / subscriber group and does NOT expose the recipients list
  const raw = result.rawMessage;
  assert.ok(
    raw.includes('To: HELIX Updates <updates@helix-assistant.dev>') ||
    raw.includes('To: "HELIX Updates" <updates@helix-assistant.dev>') ||
    raw.includes('To: HELIX Subscribers')
  );
  // The To line itself must not expose the user addresses
  const toLineMatch = raw.match(/^To:[^\r\n]+/m);
  assert.ok(toLineMatch, 'Should have a To: line in raw message');
  assert.ok(!toLineMatch[0].includes('user1@test.local'), 'To: header must not leak user1');
  assert.ok(!toLineMatch[0].includes('user2@test.local'), 'To: header must not leak user2');

  // Verify that recipients are present in Bcc
  assert.ok(raw.includes('user1@test.local'));
  assert.ok(raw.includes('user2@test.local'));
});

test('requireAdminAuth implements timing-safe SHA-256 comparison immune to token length leakage', async () => {
  process.env.ADMIN_TOKEN = 'configured-secret-token-32-chars!';

  // Helper to execute middleware
  function runMiddleware(headers: Record<string, string | string[] | undefined>) {
    return new Promise<{ status?: number; data?: any; calledNext: boolean }>((resolve) => {
      let calledNext = false;
      const req: any = { headers };
      const res: any = {
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(payload: any) {
          resolve({ status: this.statusCode, data: payload, calledNext });
        },
      };
      const next = () => {
        calledNext = true;
        resolve({ calledNext });
      };

      requireAdminAuth(req, res, next);
    });
  }

  try {
    // 1. Missing token -> 401
    const resMissing = await runMiddleware({});
    assert.equal(resMissing.calledNext, false);
    assert.equal(resMissing.status, 401);

    // 2. Exact match -> next() called
    const resExact = await runMiddleware({ 'x-admin-token': 'configured-secret-token-32-chars!' });
    assert.equal(resExact.calledNext, true);

    // 3. Different length tokens (short token) -> 403, without buffer length mismatch error
    const resShort = await runMiddleware({ 'x-admin-token': 'abc' });
    assert.equal(resShort.calledNext, false);
    assert.equal(resShort.status, 403);
    assert.equal(resShort.data.error, 'Invalid admin token');

    // 4. Different length tokens (very long token) -> 403, safely hashed with SHA-256
    const resLong = await runMiddleware({ 'x-admin-token': 'x'.repeat(500) });
    assert.equal(resLong.calledNext, false);
    assert.equal(resLong.status, 403);
    assert.equal(resLong.data.error, 'Invalid admin token');

    // 5. Same length, wrong content -> 403
    const resSameLenWrong = await runMiddleware({ 'x-admin-token': 'wrong-token-same-length-32-chars!' });
    assert.equal(resSameLenWrong.calledNext, false);
    assert.equal(resSameLenWrong.status, 403);

    // 6. Bearer token support
    const resBearer = await runMiddleware({ authorization: 'Bearer configured-secret-token-32-chars!' });
    assert.equal(resBearer.calledNext, true);
  } finally {
    restoreEnv();
  }
});
