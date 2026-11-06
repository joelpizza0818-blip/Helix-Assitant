DROP POLICY IF EXISTS landing_installer_catalog_public_read
    ON public.landing_installer_catalog;

CREATE POLICY landing_installer_catalog_public_read
    ON public.landing_installer_catalog
    FOR SELECT
    TO anon, authenticated
    USING (is_published IS TRUE);
