-- One project <-> one agent. Existing duplicates keep the earliest project
-- binding per agent; the other projects are unbound and must be re-bound
-- explicitly. This keeps the unique index deployable on existing data.
UPDATE "projects"
SET "lead_agent_id" = NULL
WHERE "lead_agent_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("lead_agent_id") "id"
    FROM "projects"
    WHERE "lead_agent_id" IS NOT NULL
    ORDER BY "lead_agent_id", "created_at", "id"
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_lead_agent_uq" ON "projects" USING btree ("lead_agent_id") WHERE "projects"."lead_agent_id" is not null;
