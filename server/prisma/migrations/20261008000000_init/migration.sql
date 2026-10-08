CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "supabase_id" TEXT NOT NULL,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_supabase_id_key" ON "users"("supabase_id");
