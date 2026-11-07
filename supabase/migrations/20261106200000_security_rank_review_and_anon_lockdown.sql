REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE SELECT ON TABLES FROM PUBLIC, anon;

REVOKE ALL ON TABLE public.github_user_roles FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.github_user_roles
    ADD COLUMN IF NOT EXISTS auth_user_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS github_user_roles_auth_user_id_key
    ON public.github_user_roles (auth_user_id)
    WHERE auth_user_id IS NOT NULL;

GRANT SELECT ON TABLE public.github_user_roles TO service_role;
GRANT INSERT (github_login, github_user_id, auth_user_id, display_name, avatar_url)
    ON TABLE public.github_user_roles TO service_role;
GRANT UPDATE (github_login, github_user_id, auth_user_id, display_name, avatar_url, updated_at)
    ON TABLE public.github_user_roles TO service_role;
GRANT SELECT (profile_id, rank), UPDATE (rank) ON TABLE public.github_user_roles TO authenticated;

CREATE POLICY github_user_roles_select_own_profile_id
    ON public.github_user_roles
    FOR SELECT
    TO authenticated
    USING (auth_user_id = (SELECT auth.uid()));
CREATE POLICY github_user_roles_rank_attempt_own_profile
    ON public.github_user_roles
    FOR UPDATE
    TO authenticated
    USING (auth_user_id = (SELECT auth.uid()))
    WITH CHECK (auth_user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.github_rank_review_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.github_user_roles(profile_id) ON DELETE CASCADE,
    incident_type TEXT NOT NULL CHECK (incident_type = 'rank_escalation'),
    attempted_rank TEXT NOT NULL CHECK (attempted_rank IN ('admin', 'master-admin')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'permanent')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ,
    reviewed_by_profile_id UUID REFERENCES public.github_user_roles(profile_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS github_rank_review_one_active_case_per_profile
    ON public.github_rank_review_cases (profile_id)
    WHERE status IN ('pending', 'permanent');
CREATE INDEX IF NOT EXISTS github_rank_review_cases_status_created_idx
    ON public.github_rank_review_cases (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.github_rank_review_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES public.github_rank_review_cases(id) ON DELETE CASCADE,
    sender_profile_id UUID NOT NULL REFERENCES public.github_user_roles(profile_id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS github_rank_review_messages_case_created_idx
    ON public.github_rank_review_messages (case_id, created_at);

CREATE TABLE IF NOT EXISTS public.github_rank_review_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES public.github_rank_review_cases(id) ON DELETE CASCADE,
    reviewer_profile_id UUID NOT NULL REFERENCES public.github_user_roles(profile_id) ON DELETE RESTRICT,
    decision TEXT NOT NULL CHECK (decision IN ('dismiss', 'permanent')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS github_rank_review_decisions_case_created_idx
    ON public.github_rank_review_decisions (case_id, created_at DESC);

ALTER TABLE public.github_rank_review_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_rank_review_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_rank_review_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
    public.github_rank_review_cases,
    public.github_rank_review_messages,
    public.github_rank_review_decisions
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.github_rank_review_cases TO service_role;
GRANT SELECT ON TABLE public.github_rank_review_messages TO service_role;
GRANT SELECT, INSERT ON TABLE public.github_rank_review_decisions TO service_role;

CREATE OR REPLACE FUNCTION public.guard_github_user_role_rank_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.rank IS DISTINCT FROM OLD.rank
       AND current_setting('helix.rank_change_authorized', TRUE) IS DISTINCT FROM 'true' THEN
        IF (OLD.rank = 'user' AND NEW.rank IN ('admin', 'master-admin'))
           OR (OLD.rank = 'admin' AND NEW.rank = 'master-admin') THEN
            INSERT INTO public.github_rank_review_cases (profile_id, incident_type, attempted_rank)
            VALUES (OLD.profile_id, 'rank_escalation', NEW.rank)
            ON CONFLICT (profile_id)
                WHERE status IN ('pending', 'permanent')
            DO NOTHING;
            NEW.rank := OLD.rank;
            NEW.updated_at := OLD.updated_at;
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Profile rank changes must use the authorized rank management function.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS github_user_roles_rank_guard ON public.github_user_roles;
CREATE TRIGGER github_user_roles_rank_guard
    BEFORE UPDATE OF rank ON public.github_user_roles
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_github_user_role_rank_change();

CREATE OR REPLACE FUNCTION public.helix_set_profile_rank(
    p_actor_profile_id UUID,
    p_target_profile_id UUID,
    p_rank TEXT
)
RETURNS SETOF public.github_user_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF p_rank IS NULL OR p_rank NOT IN ('user', 'admin') THEN
        RAISE EXCEPTION 'Only user and admin ranks can be assigned.'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.github_user_roles
        WHERE profile_id = p_actor_profile_id
          AND rank = 'master-admin'
    ) THEN
        RAISE EXCEPTION 'Master admin rank required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_actor_profile_id = p_target_profile_id THEN
        RAISE EXCEPTION 'The master admin profile cannot be changed through this function.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM set_config('helix.rank_change_authorized', 'true', TRUE);

    RETURN QUERY
    UPDATE public.github_user_roles
    SET rank = p_rank,
        updated_at = CURRENT_TIMESTAMP
    WHERE profile_id = p_target_profile_id
      AND rank <> 'master-admin'
    RETURNING public.github_user_roles.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.helix_decide_rank_review_case(
    p_actor_profile_id UUID,
    p_case_id UUID,
    p_decision TEXT
)
RETURNS SETOF public.github_rank_review_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF p_decision IS NULL OR p_decision NOT IN ('dismiss', 'permanent') THEN
        RAISE EXCEPTION 'Review decision is invalid.'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.github_user_roles
        WHERE profile_id = p_actor_profile_id
          AND rank = 'master-admin'
    ) THEN
        RAISE EXCEPTION 'Master admin rank required.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    UPDATE public.github_rank_review_cases
    SET status = CASE p_decision
            WHEN 'dismiss' THEN 'dismissed'
            ELSE 'permanent'
        END,
        reviewed_at = CURRENT_TIMESTAMP,
        reviewed_by_profile_id = p_actor_profile_id
    WHERE id = p_case_id
      AND status IN ('pending', 'permanent')
      AND profile_id <> p_actor_profile_id
    RETURNING public.github_rank_review_cases.*;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Review case was not found or cannot be changed.'
            USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.github_rank_review_decisions (case_id, reviewer_profile_id, decision)
    VALUES (p_case_id, p_actor_profile_id, p_decision);
END;
$$;

CREATE OR REPLACE FUNCTION public.helix_send_rank_review_message(
    p_sender_profile_id UUID,
    p_case_id UUID,
    p_body TEXT
)
RETURNS SETOF public.github_rank_review_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    sender_rank TEXT;
BEGIN
    IF p_body IS NULL
       OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 2000
       OR translate(p_body, E'\n\t', '') ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'Message contains invalid content.'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_sender_profile_id::TEXT, 0));

    SELECT rank INTO sender_rank
    FROM public.github_user_roles
    WHERE profile_id = p_sender_profile_id;

    IF sender_rank IS NULL THEN
        RAISE EXCEPTION 'Sender profile was not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.github_rank_review_cases
        WHERE id = p_case_id
          AND status IN ('pending', 'permanent')
          AND (
              profile_id = p_sender_profile_id
              OR sender_rank = 'master-admin'
          )
    ) THEN
        RAISE EXCEPTION 'Security review case was not found or is closed.'
            USING ERRCODE = 'P0002';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM public.github_rank_review_messages
        WHERE sender_profile_id = p_sender_profile_id
          AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
    ) >= 20 THEN
        RAISE EXCEPTION 'Message rate limit exceeded.'
            USING ERRCODE = '54000';
    END IF;

    RETURN QUERY
    INSERT INTO public.github_rank_review_messages (case_id, sender_profile_id, body)
    VALUES (p_case_id, p_sender_profile_id, btrim(p_body))
    RETURNING public.github_rank_review_messages.*;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_github_user_role_rank_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.helix_set_profile_rank(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helix_set_profile_rank(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.helix_decide_rank_review_case(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helix_decide_rank_review_case(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.helix_send_rank_review_message(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helix_send_rank_review_message(UUID, UUID, TEXT) TO service_role;
