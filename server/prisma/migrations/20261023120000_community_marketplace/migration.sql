CREATE TABLE "community_items" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(600) NOT NULL,
    "manifest" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "review_note" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "community_items_status_type_created_at_idx"
    ON "community_items"("status", "type", "created_at");

CREATE INDEX "community_items_creator_id_created_at_idx"
    ON "community_items"("creator_id", "created_at");

ALTER TABLE "community_items"
    ADD CONSTRAINT "community_items_creator_id_fkey"
    FOREIGN KEY ("creator_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
