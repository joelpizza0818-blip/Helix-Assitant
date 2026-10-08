CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.users (
        id,
        email,
        display_name,
        is_active,
        supabase_id,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id::text,
        NEW.email,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
            NULLIF(NEW.raw_user_meta_data ->> 'name', '')
        ),
        TRUE,
        NEW.id::text,
        NOW(),
        NOW()
    )
    ON CONFLICT (supabase_id) DO UPDATE
    SET
        email = EXCLUDED.email,
        display_name = COALESCE(EXCLUDED.display_name, public.users.display_name),
        updated_at = NOW();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_auth_user();

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
GRANT ALL ON TABLE public.users TO service_role;
