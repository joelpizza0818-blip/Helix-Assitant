UPDATE public.github_user_roles
SET rank = 'user',
    updated_at = CURRENT_TIMESTAMP
WHERE rank = 'master-admin'
  AND lower(github_login) <> 'joelpizza0818-blip';

UPDATE public.github_user_roles
SET rank = 'master-admin',
    display_name = COALESCE(display_name, github_login),
    updated_at = CURRENT_TIMESTAMP
WHERE lower(github_login) = 'joelpizza0818-blip';

INSERT INTO public.github_user_roles (github_login, rank, display_name)
SELECT 'joelpizza0818-blip', 'master-admin', 'joelpizza0818-blip'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.github_user_roles
    WHERE lower(github_login) = 'joelpizza0818-blip'
);
