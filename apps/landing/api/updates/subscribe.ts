import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN = 'https://helix-assistant.vercel.app';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setCors(res: any): void {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export default async function handler(req: any, res: any): Promise<void> {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const origin = req.headers?.origin;
  if (origin && origin !== ALLOWED_ORIGIN) {
    res.status(403).json({ success: false, error: 'Origin not allowed' });
    return;
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    res.status(400).json({ success: false, error: 'Invalid email' });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(503).json({ success: false, error: 'Subscription service unavailable' });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.from('update_subscribers').upsert(
    { email, is_active: true, unsubscribed_at: null },
    { onConflict: 'email' },
  );
  if (error) {
    console.error('Could not persist release subscriber:', error.message);
    res.status(503).json({ success: false, error: 'Subscription service unavailable' });
    return;
  }

  res.status(200).json({
    success: true,
    message: 'Subscription request accepted by the update service.',
  });
}
