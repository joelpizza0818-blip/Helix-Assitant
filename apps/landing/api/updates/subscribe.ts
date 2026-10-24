import { createClient } from '@supabase/supabase-js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Allow the canonical domain plus any Vercel preview URLs for the same project
const ALLOWED_ORIGINS = new Set([
  'https://helix-assistant.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
]);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // server-to-server or curl
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Allow any Vercel preview deployment for the helix-assistant project
  if (/^https:\/\/helix-assistant(-[a-z0-9]+)?\.vercel\.app$/.test(origin)) return true;
  return false;
}

function setCors(res: any, origin: string | undefined): void {
  const allowedOrigin = isAllowedOrigin(origin) ? (origin ?? '*') : 'https://helix-assistant.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export default async function handler(req: any, res: any): Promise<void> {
  const origin = req.headers?.origin as string | undefined;
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  if (!isAllowedOrigin(origin)) {
    res.status(403).json({ success: false, error: 'Origin not allowed' });
    return;
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    res.status(400).json({ success: false, error: 'Invalid email' });
    return;
  }

  // Try Supabase first (preferred durable storage)
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  const supabaseKey = supabaseServiceKey ?? supabaseAnonKey;

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await supabase.from('update_subscribers').upsert(
      { email, is_active: true, unsubscribed_at: null },
      { onConflict: 'email' },
    );
    if (error) {
      console.error('[helix/subscribe] Supabase upsert failed:', error.message);
      res.status(503).json({ success: false, error: 'Subscription service temporarily unavailable. Please try again.' });
      return;
    }
    res.status(200).json({
      success: true,
      message: 'Subscription confirmed. You will receive HELIX release updates at this address.',
    });
    return;
  }

  // Fallback: no storage configured — log and acknowledge gracefully
  console.warn('[helix/subscribe] No storage backend configured. SUPABASE_URL or VITE_SUPABASE_URL missing. Email:', email);
  res.status(503).json({
    success: false,
    error: 'Subscription service is not configured on this deployment. Please contact the HELIX team.',
  });
}
