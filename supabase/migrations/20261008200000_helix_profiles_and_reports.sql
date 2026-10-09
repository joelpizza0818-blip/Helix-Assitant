DROP INDEX IF EXISTS public.github_user_roles_single_admin_key;
ALTER TABLE public.github_user_roles
    DROP CONSTRAINT IF EXISTS github_user_roles_rank_check;
ALTER TABLE public.github_user_roles
    ADD CONSTRAINT github_user_roles_rank_check
    CHECK (rank IN ('user', 'admin', 'master-admin'));

ALTER TABLE public.github_user_roles
    ADD COLUMN IF NOT EXISTS profile_id UUID DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS github_user_id TEXT,
    ADD COLUMN IF NOT EXISTS display_name TEXT,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE public.github_user_roles
SET profile_id = gen_random_uuid()
WHERE profile_id IS NULL;

ALTER TABLE public.github_user_roles
    ALTER COLUMN profile_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS github_user_roles_profile_id_key
    ON public.github_user_roles (profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS github_user_roles_github_user_id_key
    ON public.github_user_roles (github_user_id)
    WHERE github_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS github_user_roles_single_master_admin_key
    ON public.github_user_roles (rank)
    WHERE rank = 'master-admin';

UPDATE public.github_user_roles
SET rank = 'master-admin',
    display_name = COALESCE(display_name, github_login),
    updated_at = CURRENT_TIMESTAMP
WHERE lower(github_login) = 'joelpizza0818-blip';

UPDATE public.github_user_roles
SET rank = 'user'
WHERE rank = 'admin'
  AND lower(github_login) <> 'joelpizza0818-blip';

CREATE TABLE IF NOT EXISTS public.admin_error_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by_profile_id UUID NOT NULL REFERENCES public.github_user_roles(profile_id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 5000),
    app_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS admin_error_reports_status_created_at_idx
    ON public.admin_error_reports (status, created_at DESC);

ALTER TABLE public.admin_error_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_error_reports TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.github_user_roles TO service_role;

INSERT INTO public.github_user_roles (github_login, rank, display_name)
VALUES ('joelpizza0818-blip', 'master-admin', 'joelpizza0818-blip')
ON CONFLICT (github_login)
DO UPDATE SET rank = EXCLUDED.rank,
              display_name = COALESCE(public.github_user_roles.display_name, EXCLUDED.display_name),
              updated_at = CURRENT_TIMESTAMP;
