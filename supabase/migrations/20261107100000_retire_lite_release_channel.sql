UPDATE public.landing_installer_catalog
SET is_published = FALSE,
    published_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE edition = 'lite'
  AND is_published = TRUE;

ALTER TABLE public.landing_installer_catalog
    ADD CONSTRAINT landing_installer_catalog_retired_lite_check
    CHECK (edition <> 'lite' OR is_published = FALSE);

UPDATE public.release_policies
SET auto_update = FALSE,
    channel = 'retired',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'lite';
