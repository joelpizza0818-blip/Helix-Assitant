DROP POLICY IF EXISTS landing_installer_catalog_public_read
    ON public.landing_installer_catalog;

CREATE POLICY landing_installer_catalog_public_read
    ON public.landing_installer_catalog
    FOR SELECT
    TO anon, authenticated
    USING (
        is_published = TRUE
        OR (
            is_prerelease = FALSE
            AND installer_url IS NOT NULL
            AND checksum_url IS NOT NULL
        )
    );
