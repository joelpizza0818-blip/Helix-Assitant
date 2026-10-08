CREATE TABLE IF NOT EXISTS "release_policies" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "public_version" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "auto_update" BOOLEAN NOT NULL DEFAULT true,
    "check_interval_hours" INTEGER NOT NULL DEFAULT 24,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "release_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "release_backups" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "current_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "policy_id" TEXT NOT NULL DEFAULT 'global',
    CONSTRAINT "release_backups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "release_backups_version_key" ON "release_backups"("version");
CREATE INDEX IF NOT EXISTS "release_backups_policy_id_idx" ON "release_backups"("policy_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'release_backups_policy_id_fkey'
          AND conrelid = '"release_backups"'::regclass
    ) THEN
        ALTER TABLE "release_backups"
            ADD CONSTRAINT "release_backups_policy_id_fkey"
            FOREIGN KEY ("policy_id") REFERENCES "release_policies"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

INSERT INTO "release_policies" ("id", "public_version", "channel", "auto_update", "check_interval_hours")
VALUES ('global', '0.1.2', 'stable', true, 24)
ON CONFLICT ("id") DO NOTHING;
