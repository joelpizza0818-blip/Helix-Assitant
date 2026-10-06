import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env variables not configured. Auth features will be unavailable.');
}

export const supabase = createClient(supabaseUrl || 'http://localhost', supabaseAnonKey || 'dummy');
