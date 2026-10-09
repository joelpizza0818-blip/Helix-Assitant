import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const desktopSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const desktopSupabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      flowType: 'pkce',
    },
  })
  : null

export interface HelixProfile {
  profileId: string
  githubUserId: string | null
  githubLogin: string
  displayName: string
  avatarUrl: string | null
  rank: 'user' | 'admin' | 'master-admin'
  createdAt?: string
}

export interface AdminErrorReport {
  id: string
  title: string
  description: string
  app_version: string
  status: 'open' | 'resolved'
  created_at: string
  resolved_at: string | null
  created_by_profile_id: string
  github_user_roles: {
    github_login: string
    display_name: string
    avatar_url: string | null
  }
}

const adminFunctionUrl = `${supabaseUrl}/functions/v1/installer-admin`

export async function startGitHubOAuth(): Promise<void> {
  if (!desktopSupabase) throw new Error('GitHub profile sign-in is not configured in this build.')
  const { data, error } = await desktopSupabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: 'helix://auth/callback',
      skipBrowserRedirect: true,
      scopes: 'read:user',
    },
  })
  if (error) throw error
  if (!data.url) throw new Error('Supabase did not return the GitHub sign-in URL.')
  window.helix.openExternal(data.url)
}

export async function exchangeOAuthCallback(callbackUrl: string): Promise<void> {
  if (!desktopSupabase) throw new Error('GitHub profile sign-in is not configured in this build.')
  let url: URL
  try {
    url = new URL(callbackUrl.trim().replace(/^["']|["']$/g, ''))
  } catch {
    throw new Error('Invalid HELIX authentication callback.')
  }
  const callbackPath = url.pathname.replace(/\/+$/, '')
  const isCallbackRoute = (url.hostname.toLowerCase() === 'auth' && callbackPath === '/callback')
    || (!url.hostname && callbackPath === '/auth/callback')
  if (url.protocol !== 'helix:' || !isCallbackRoute || url.username || url.password || url.port) {
    throw new Error('Invalid HELIX authentication callback.')
  }
  const authError = url.searchParams.get('error_description')
    || url.searchParams.get('error')
  if (authError) throw new Error(authError)
  const code = url.searchParams.get('code')
  if (!code) throw new Error('GitHub sign-in did not return an authorization code.')
  const { error } = await desktopSupabase.auth.exchangeCodeForSession(code)
  if (error) throw error
}

export async function signOutProfile(): Promise<void> {
  if (!desktopSupabase) return
  const { error } = await desktopSupabase.auth.signOut()
  if (error) throw error
}

export async function getAccessToken(): Promise<string | null> {
  if (!desktopSupabase) return null
  const { data, error } = await desktopSupabase.auth.getSession()
  if (error) throw error
  return data.session?.access_token ?? null
}

export async function adminRequest<T>(
  route: string,
  init: RequestInit = {},
): Promise<T> {
  if (!desktopSupabase) throw new Error('Supabase profile features are not configured in this build.')
  const token = await getAccessToken()
  if (!token) throw new Error('Connect your GitHub profile before using this feature.')
  const response = await fetch(`${adminFunctionUrl}/${route}`, {
    ...init,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(15000),
  })
  const result = await response.json().catch(() => null) as { error?: unknown } | null
  if (!response.ok) {
    const message = result && typeof result.error === 'string'
      ? result.error
      : `HELIX account service returned HTTP ${response.status}.`
    throw new Error(message)
  }
  return result as T
}

export async function loadOwnProfile(): Promise<HelixProfile | null> {
  if (!desktopSupabase) return null
  const token = await getAccessToken()
  if (!token) return null
  const result = await adminRequest<{ success: true; profile: HelixProfile }>('profile')
  if (!result.success || !result.profile?.profileId) throw new Error('The profile service returned invalid data.')
  return result.profile
}
