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
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "parent_project_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_parent_project_id_projects_id_fk') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_parent_project_id_projects_id_fk" FOREIGN KEY ("parent_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_parent_project_idx" ON "projects" USING btree ("parent_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_lead_agent_uq" ON "projects" USING btree ("lead_agent_id") WHERE "projects"."lead_agent_id" is not null;