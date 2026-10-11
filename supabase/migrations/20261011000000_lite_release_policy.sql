INSERT INTO public.release_policies (id, public_version, channel, auto_update, check_interval_hours)
VALUES ('lite', '0.1.10', 'stable', true, 24)
ON CONFLICT (id) DO NOTHING;
