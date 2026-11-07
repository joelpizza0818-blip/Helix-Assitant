import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface RankReviewProfile {
  profileId: string
  githubUserId: string
  githubLogin: string
  displayName: string
  avatarUrl: string | null
  rank: 'user' | 'admin' | 'master-admin'
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export async function getActiveRankReviewCase(
  admin: SupabaseClient,
  profileId: string,
) {
  const { data, error } = await admin
    .from('github_rank_review_cases')
    .select('id, profile_id, incident_type, attempted_rank, status, created_at, reviewed_at')
    .eq('profile_id', profileId)
    .in('status', ['pending', 'permanent'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error('Could not load rank review status.')
  return data
}

export async function handleRankEscalationAttempt(
  request: Request,
  route: string,
  profile: RankReviewProfile,
  admin: SupabaseClient,
): Promise<Response | null> {
  const match = route.match(/^profiles\/([0-9a-f-]+)\/rank$/i)
  if (!match || request.method !== 'PUT' || profile.rank === 'master-admin') return null

  const targetProfileId = match[1]
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetProfileId)) {
    return jsonResponse(400, { error: 'Profile ID is invalid.' })
  }

  const body: unknown = await request.json().catch(() => null)
  const attemptedRank = body !== null
    && typeof body === 'object'
    && 'rank' in body
    && (body.rank === 'admin' || body.rank === 'master-admin')
    ? body.rank
    : null
  const isEscalation = targetProfileId === profile.profileId
    && attemptedRank !== null
    && (profile.rank === 'user' || attemptedRank === 'master-admin')

  if (!isEscalation) {
    return jsonResponse(403, { error: 'Master admin rank required.' })
  }

  const existing = await getActiveRankReviewCase(admin, profile.profileId)
  if (existing) {
    return jsonResponse(423, {
      error: 'Admin access is suspended pending master-admin review.',
      securityCase: existing,
    })
  }

  const { data, error } = await admin
    .from('github_rank_review_cases')
    .insert({
      profile_id: profile.profileId,
      incident_type: 'rank_escalation',
      attempted_rank: attemptedRank,
    })
    .select('id, profile_id, incident_type, attempted_rank, status, created_at, reviewed_at')
    .single()
  if (error) {
    if (error.code === '23505') {
      const activeCase = await getActiveRankReviewCase(admin, profile.profileId)
      if (activeCase) {
        return jsonResponse(423, {
          error: 'Admin access is suspended pending master-admin review.',
          securityCase: activeCase,
        })
      }
    }
    console.error('Could not record rank escalation review case.')
    return jsonResponse(503, { error: 'The security review case could not be created.' })
  }
  return jsonResponse(423, {
    error: 'Admin access is suspended pending master-admin review.',
    securityCase: data,
  })
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function handleRankReviewRoute(
  request: Request,
  routeParts: string[],
  profile: RankReviewProfile,
  admin: SupabaseClient,
): Promise<Response | null> {
  if (routeParts[0] !== 'security-cases') return null
  const isMasterAdmin = profile.rank === 'master-admin'

  if (routeParts.length === 1 && request.method === 'GET') {
    if (!isMasterAdmin) return jsonResponse(403, { error: 'Master admin rank required.' })
    const { data, error } = await admin
      .from('github_rank_review_cases')
      .select('id, profile_id, incident_type, attempted_rank, status, created_at, reviewed_at, github_user_roles!github_rank_review_cases_profile_id_fkey(github_login, display_name, rank)')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      console.error('Could not load rank review cases.')
      return jsonResponse(503, { error: 'Could not load rank review cases.' })
    }
    return jsonResponse(200, { success: true, cases: data ?? [] })
  }

  const caseId = routeParts[1] ?? ''
  if (!isUuid(caseId)) return jsonResponse(400, { error: 'Security case ID is invalid.' })

  const { data: reviewCase, error: caseError } = await admin
    .from('github_rank_review_cases')
    .select('id, profile_id, status')
    .eq('id', caseId)
    .maybeSingle()
  if (caseError) {
    console.error('Could not load rank review case.')
    return jsonResponse(503, { error: 'Could not load the security review case.' })
  }
  if (!reviewCase || (!isMasterAdmin && reviewCase.profile_id !== profile.profileId)) {
    return jsonResponse(404, { error: 'Security review case was not found.' })
  }

  if (routeParts.length === 3 && routeParts[2] === 'messages' && request.method === 'GET') {
    const { data, error } = await admin
      .from('github_rank_review_messages')
      .select('id, sender_profile_id, body, created_at, github_user_roles!github_rank_review_messages_sender_profile_id_fkey(github_login, display_name, rank)')
      .eq('case_id', caseId)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) {
      console.error('Could not load rank review messages.')
      return jsonResponse(503, { error: 'Could not load security case messages.' })
    }
    return jsonResponse(200, { success: true, messages: data ?? [] })
  }

  if (routeParts.length === 3 && routeParts[2] === 'messages' && request.method === 'POST') {
    const body: unknown = await request.json().catch(() => null)
    if (
      body === null
      || typeof body !== 'object'
      || !('message' in body)
      || typeof body.message !== 'string'
      || !body.message.trim()
      || body.message.trim().length > 2000
      || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body.message)
    ) {
      return jsonResponse(400, { error: 'Message must contain 1 to 2000 safe characters.' })
    }
    if (reviewCase.status === 'dismissed') {
      return jsonResponse(409, { error: 'This security review case is closed.' })
    }
    const { data, error } = await admin.rpc('helix_send_rank_review_message', {
      p_case_id: caseId,
      p_sender_profile_id: profile.profileId,
      p_body: body.message.trim(),
    })
    if (error) {
      const status = error.code === '54000' ? 429 : error.code === 'P0002' ? 404 : 400
      return jsonResponse(status, {
        error: status === 429
          ? 'Message limit reached. Try again later.'
          : status === 404
            ? 'Security review case was not found or is closed.'
            : 'Could not send security case message.',
      })
    }
    const message = Array.isArray(data) ? data[0] : null
    if (!message) return jsonResponse(503, { error: 'Could not send security case message.' })
    return jsonResponse(201, { success: true, message })
  }

  if (routeParts.length === 3 && routeParts[2] === 'decision' && request.method === 'PUT') {
    if (!isMasterAdmin) return jsonResponse(403, { error: 'Master admin rank required.' })
    const body: unknown = await request.json().catch(() => null)
    if (
      body === null
      || typeof body !== 'object'
      || !('decision' in body)
      || (body.decision !== 'dismiss' && body.decision !== 'permanent')
    ) {
      return jsonResponse(400, { error: 'Decision must be dismiss or permanent.' })
    }
    const { data, error } = await admin.rpc('helix_decide_rank_review_case', {
      p_actor_profile_id: profile.profileId,
      p_case_id: caseId,
      p_decision: body.decision,
    })
    if (error) {
      console.error('Could not apply rank review decision.')
      return jsonResponse(409, { error: 'Could not apply the security review decision.' })
    }
    const decidedCase = Array.isArray(data) ? data[0] : null
    if (!decidedCase) return jsonResponse(404, { error: 'Security review case was not found.' })
    return jsonResponse(200, { success: true, securityCase: decidedCase })
  }

  return jsonResponse(405, { error: 'Method not allowed.' })
}
