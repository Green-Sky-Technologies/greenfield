CREATE TABLE "comment_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"thread_id" integer NOT NULL,
	"page_id" integer NOT NULL,
	"node_id" integer,
	"author" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"replies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "comment_threads" CASCADE;--> statement-breakpoint
DROP TABLE "comments" CASCADE;--> statement-breakpoint
ALTER TABLE "comment_index" ADD CONSTRAINT "comment_index_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_index" ADD CONSTRAINT "comment_index_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_index_project_thread_idx" ON "comment_index" USING btree ("project_id","thread_id");--> statement-breakpoint
CREATE INDEX "comment_index_workspace_author_idx" ON "comment_index" USING btree ("workspace_id","author_id");--> statement-breakpoint
DROP TYPE "public"."comment_thread_kind";--> statement-breakpoint
DROP TYPE "public"."comment_thread_status";