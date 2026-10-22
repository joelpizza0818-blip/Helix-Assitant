CREATE TABLE "update_subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "update_subscribers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "update_subscribers_email_key" ON "update_subscribers"("email");
CREATE INDEX "update_subscribers_is_active_idx" ON "update_subscribers"("is_active");
