import { supabase } from './supabase'

export type AnnouncementCategory = 'RELEASE' | 'FEATURE' | 'SECURITY' | 'MOBILE' | 'ECOSYSTEM' | 'COMPATIBILITY'

export interface LandingAnnouncement {
  id: string
  category: AnnouncementCategory
  title: string
  summary: string
  content: string[]
  links: Array<{ text: string; url: string; external?: boolean }>
  isPublished: boolean
  publishedAt: string | null
  createdAt: string
}

export type InstallerPlatform = 'windows' | 'linux' | 'macos' | 'android' | 'ios'
export type InstallerEdition = 'normal' | 'lite' | 'mobile'

export interface LandingInstaller {
  id: string
  platform: InstallerPlatform
  edition: InstallerEdition
  version: string
  installerUrl: string | null
  checksumUrl: string | null
  releaseUrl: string
  isPublished: boolean
  isPrerelease: boolean
  publishedAt: string | null
  releaseDate: string
  createdAt: string
}

export interface AdminProfile {
  profileId: string
  githubUserId: string
  githubLogin: string
  displayName: string
  avatarUrl: string | null
  rank: 'user' | 'admin' | 'master-admin'
}

interface AnnouncementRow {
  id: string
  category: AnnouncementCategory
  title: string
  summary: string
  content: unknown
  links: unknown
  is_published: boolean
  published_at: string | null
  created_at: string
}

interface InstallerRow {
  id: string
  platform: InstallerPlatform
  edition: InstallerEdition
  version: string
  installer_url: string | null
  checksum_url: string | null
  release_url: string
  is_published: boolean
  is_prerelease: boolean
  published_at: string | null
  release_date: string
  created_at: string
}

function mapAnnouncement(row: AnnouncementRow): LandingAnnouncement {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    summary: row.summary,
    content: Array.isArray(row.content) ? row.content.filter((item): item is string => typeof item === 'string') : [],
    links: Array.isArray(row.links)
      ? row.links.filter((item): item is LandingAnnouncement['links'][number] => (
        item !== null
        && typeof item === 'object'
        && 'text' in item
        && typeof item.text === 'string'
        && 'url' in item
        && typeof item.url === 'string'
      ))
      : [],
    isPublished: row.is_published,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }
}

function mapInstaller(row: InstallerRow): LandingInstaller {
  return {
    id: row.id,
    platform: row.platform,
    edition: row.edition,
    version: row.version,
    installerUrl: row.installer_url,
    checksumUrl: row.checksum_url,
    releaseUrl: row.release_url,
    isPublished: row.is_published,
    isPrerelease: row.is_prerelease,
    publishedAt: row.published_at,
    releaseDate: row.release_date,
    createdAt: row.created_at,
  }
}

export async function fetchPublicAnnouncements(): Promise<LandingAnnouncement[]> {
  const { data, error } = await supabase
    .from('landing_announcements')
    .select('id, category, title, summary, content, links, is_published, published_at, created_at')
    .eq('is_published', true)
    .order('published_at', { ascending: false })
  if (error) throw new Error(`Could not load announcements: ${error.message}`)
  return (data ?? []).map((row) => mapAnnouncement(row as AnnouncementRow))
}

export async function fetchPublicInstallers(signal?: AbortSignal): Promise<LandingInstaller[]> {
  let query = supabase
    .from('landing_installer_catalog')
    .select('id, platform, edition, version, installer_url, checksum_url, release_url, is_published, is_prerelease, published_at, release_date, created_at')
    .eq('is_published', true)
    .order('published_at', { ascending: false })
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(`Could not load published installers: ${error.message}`)
  return (data ?? []).map((row) => mapInstaller(row as InstallerRow))
}

export async function requestAdmin<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '')
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  if (!baseUrl || !anonKey) throw new Error('Admin services are not configured for this deployment.')

  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw new Error(`Could not verify your session: ${sessionError.message}`)
  if (!session?.access_token) throw new Error('Sign in with GitHub to use the admin panel.')

  const response = await fetch(`${baseUrl}/functions/v1/installer-admin/${path.replace(/^\/+/, '')}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${session.access_token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  })

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `Admin service returned HTTP ${response.status}.`
    throw new Error(message)
  }
  if (payload === null || typeof payload !== 'object') throw new Error('Admin service returned an invalid response.')
  return payload as T
}

export function mapAdminAnnouncement(row: Record<string, unknown>): LandingAnnouncement {
  return mapAnnouncement({
    id: String(row.id),
    category: row.category as AnnouncementCategory,
    title: String(row.title),
    summary: String(row.summary),
    content: row.content,
    links: row.links,
    is_published: Boolean(row.isPublished),
    published_at: typeof row.publishedAt === 'string' ? row.publishedAt : null,
    created_at: String(row.createdAt),
  })
}

export function mapAdminInstaller(row: Record<string, unknown>): LandingInstaller {
  return mapInstaller({
    id: String(row.id),
    platform: row.platform as InstallerPlatform,
    edition: row.edition as InstallerEdition,
    version: String(row.version),
    installer_url: typeof row.installerUrl === 'string' ? row.installerUrl : null,
    checksum_url: typeof row.checksumUrl === 'string' ? row.checksumUrl : null,
    release_url: String(row.releaseUrl),
    is_published: Boolean(row.isPublished),
    is_prerelease: Boolean(row.isPrerelease),
    published_at: typeof row.publishedAt === 'string' ? row.publishedAt : null,
    release_date: typeof row.releaseDate === 'string' ? row.releaseDate : String(row.createdAt),
    created_at: String(row.createdAt),
  })
}
