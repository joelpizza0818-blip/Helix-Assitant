CREATE TABLE IF NOT EXISTS public.landing_announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL CHECK (category IN ('RELEASE', 'FEATURE', 'SECURITY', 'MOBILE', 'ECOSYSTEM', 'COMPATIBILITY')),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
    summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 700),
    content JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(content) = 'array'),
    links JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links) = 'array'),
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ,
    created_by_profile_id UUID REFERENCES public.github_user_roles(profile_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS landing_announcements_publication_idx
    ON public.landing_announcements (published_at DESC)
    WHERE is_published = TRUE;

ALTER TABLE public.landing_announcements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.landing_announcements TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.landing_announcements TO service_role;

CREATE POLICY landing_announcements_public_read
    ON public.landing_announcements
    FOR SELECT
    TO anon, authenticated
    USING (is_published = TRUE);

CREATE TABLE IF NOT EXISTS public.landing_installer_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL CHECK (platform IN ('windows', 'linux', 'macos', 'android', 'ios')),
    edition TEXT NOT NULL CHECK (edition IN ('normal', 'lite', 'mobile')),
    version TEXT NOT NULL CHECK (char_length(version) BETWEEN 1 AND 40),
    installer_url TEXT CHECK (installer_url IS NULL OR char_length(installer_url) BETWEEN 1 AND 2048),
    checksum_url TEXT CHECK (checksum_url IS NULL OR char_length(checksum_url) BETWEEN 1 AND 2048),
    release_url TEXT NOT NULL CHECK (char_length(release_url) BETWEEN 1 AND 2048),
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    is_prerelease BOOLEAN NOT NULL DEFAULT FALSE,
    release_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ,
    created_by_profile_id UUID REFERENCES public.github_user_roles(profile_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT landing_installer_platform_edition_check CHECK (
        (edition = 'mobile' AND platform IN ('android', 'ios'))
        OR (edition IN ('normal', 'lite') AND platform IN ('windows', 'linux', 'macos'))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS landing_installer_catalog_version_key
    ON public.landing_installer_catalog (platform, edition, version);
CREATE UNIQUE INDEX IF NOT EXISTS landing_installer_catalog_single_public_key
    ON public.landing_installer_catalog (platform, edition)
    WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS landing_installer_catalog_history_idx
    ON public.landing_installer_catalog (platform, edition, created_at DESC);

ALTER TABLE public.landing_installer_catalog ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.landing_installer_catalog TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.landing_installer_catalog TO service_role;

CREATE POLICY landing_installer_catalog_public_read
    ON public.landing_installer_catalog
    FOR SELECT
    TO anon, authenticated
    USING (is_published = TRUE);

CREATE OR REPLACE FUNCTION public.publish_landing_installer(
    p_installer_id UUID,
    p_updated_by_user_id TEXT
)
RETURNS SETOF public.landing_installer_catalog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    selected_installer public.landing_installer_catalog;
BEGIN
    SELECT * INTO selected_installer
    FROM public.landing_installer_catalog
    WHERE id = p_installer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE public.landing_installer_catalog
    SET is_published = FALSE,
        published_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE platform = selected_installer.platform
      AND edition = selected_installer.edition
      AND is_published = TRUE;

    RETURN QUERY
    UPDATE public.landing_installer_catalog
    SET is_published = TRUE,
        published_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_installer_id
    RETURNING *;

    IF selected_installer.platform = 'windows' AND selected_installer.edition IN ('normal', 'lite') THEN
        INSERT INTO public.release_policies (
            id,
            public_version,
            channel,
            auto_update,
            check_interval_hours,
            updated_by_user_id,
            updated_at
        )
        VALUES (
            CASE WHEN selected_installer.edition = 'normal' THEN 'global' ELSE 'lite' END,
            selected_installer.version,
            'stable',
            TRUE,
            24,
            p_updated_by_user_id,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (id) DO UPDATE
        SET public_version = EXCLUDED.public_version,
            channel = EXCLUDED.channel,
            auto_update = EXCLUDED.auto_update,
            check_interval_hours = EXCLUDED.check_interval_hours,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = CURRENT_TIMESTAMP;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_landing_installer(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_landing_installer(UUID, TEXT) TO service_role;
