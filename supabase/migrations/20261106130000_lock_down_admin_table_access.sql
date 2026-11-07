ALTER TABLE public.github_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_error_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_backups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.github_user_roles,
    public.admin_error_reports,
    public.release_policies,
    public.release_backups
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE
    public.admin_error_reports,
    public.release_policies,
    public.release_backups
FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.github_user_roles
    TO service_role;
GRANT SELECT, INSERT, UPDATE
    ON TABLE public.admin_error_reports, public.release_policies, public.release_backups
    TO service_role;
