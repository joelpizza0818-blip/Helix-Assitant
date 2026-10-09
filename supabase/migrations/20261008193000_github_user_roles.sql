CREATE TABLE IF NOT EXISTS public.github_user_roles (
    github_login TEXT NOT NULL,
    rank TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT github_user_roles_pkey PRIMARY KEY (github_login),
    CONSTRAINT github_user_roles_rank_check CHECK (rank IN ('user', 'admin'))
);

UPDATE public.github_user_roles
SET rank = 'user'
WHERE rank = 'admin'
  AND lower(github_login) <> 'joelpizza0818-blip';

CREATE UNIQUE INDEX IF NOT EXISTS github_user_roles_login_lower_key
    ON public.github_user_roles (lower(github_login));
CREATE UNIQUE INDEX IF NOT EXISTS github_user_roles_single_admin_key
    ON public.github_user_roles (rank)
    WHERE rank = 'admin';

ALTER TABLE public.github_user_roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.github_user_roles TO service_role;

INSERT INTO public.github_user_roles (github_login, rank)
VALUES ('joelpizza0818-blip', 'admin')
ON CONFLICT (github_login)
DO UPDATE SET rank = EXCLUDED.rank;
