import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { withSecureCors } from '../_shared/http-security.ts'
import { isAllowedAnnouncementUrl, isExternalAnnouncementUrl, isHttpsUrl } from '../_shared/url-validation.ts'

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function getPublicClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw new Error('Public content storage is not configured.')
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeAnnouncementLinks(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (
      !isRecord(item)
      || typeof item.text !== 'string'
      || !item.text.trim()
      || item.text.trim().length > 80
      || typeof item.url !== 'string'
      || item.url.length > 2048
      || !isAllowedAnnouncementUrl(item.url)
    ) return []
    const url = item.url.trim()
    return [{ text: item.text.trim(), url, external: isExternalAnnouncementUrl(url) }]
  }).slice(0, 10)
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (request.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed.' })

  const resource = new URL(request.url).searchParams.get('resource')
  if (resource !== 'announcements' && resource !== 'installers' && resource !== 'release-history') {
    return jsonResponse(400, { error: 'Requested public resource is invalid.' })
  }

  try {
    const client = getPublicClient()
    if (resource === 'announcements') {
      const { data, error } = await client
        .from('landing_announcements')
        .select('id, category, title, summary, content, links, is_published, published_at, created_at')
        .eq('is_published', true)
        .order('published_at', { ascending: false })
        .limit(100)
      if (error) {
        console.error('Could not load public announcements.')
        return jsonResponse(503, { error: 'Could not load public announcements.' })
      }
      const announcements = (data ?? []).map((item) => ({
        ...item,
        content: Array.isArray(item.content)
          ? item.content.filter((line): line is string => typeof line === 'string' && line.length <= 1500).slice(0, 20)
          : [],
        links: safeAnnouncementLinks(item.links),
      }))
      return jsonResponse(200, { success: true, announcements })
    }

    let query = client
      .from('landing_installer_catalog')
      .select('id, platform, edition, version, installer_url, checksum_url, release_url, is_published, is_prerelease, published_at, release_date, created_at')
      .eq('is_published', true)
      .neq('edition', 'lite')
      .order(resource === 'release-history' ? 'release_date' : 'published_at', { ascending: false })
      .limit(250)

    if (resource === 'release-history') {
      query = query
        .eq('is_prerelease', false)
        .not('installer_url', 'is', null)
        .not('checksum_url', 'is', null)
    }

    const { data, error } = await query
    if (error) {
      console.error(`Could not load public ${resource}.`)
      return jsonResponse(503, { error: `Could not load public ${resource}.` })
    }
    const installers = (data ?? []).filter((item) => (
      isHttpsUrl(item.release_url)
      && (item.installer_url === null || isHttpsUrl(item.installer_url))
      && (item.checksum_url === null || isHttpsUrl(item.checksum_url))
    ))
    return jsonResponse(200, { success: true, installers })
  } catch (error) {
    console.error('Public content service is unavailable:', error)
    return jsonResponse(503, { error: 'Public content service is unavailable.' })
  }
}

Deno.serve(async (request) => {
  const response = await handleRequest(request)
  return withSecureCors(request, response, 'GET, OPTIONS')
})
