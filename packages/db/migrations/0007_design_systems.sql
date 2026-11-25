CREATE TYPE "public"."design_system_managers" AS ENUM('admins', 'admins_and_editors');--> statement-breakpoint
CREATE TABLE "design_system_attachments" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"design_system_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_system_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"managers" "design_system_managers" DEFAULT 'admins' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_system_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"design_system_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source_key" text NOT NULL,
	"guide" text DEFAULT '' NOT NULL,
	"items" jsonb NOT NULL,
	"dropped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"library_key" text,
	"summary" jsonb,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"published_version_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_system_attachments" ADD CONSTRAINT "design_system_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_attachments" ADD CONSTRAINT "design_system_attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_attachments" ADD CONSTRAINT "design_system_attachments_design_system_id_design_systems_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_attachments" ADD CONSTRAINT "design_system_attachments_version_id_design_system_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."design_system_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_settings" ADD CONSTRAINT "design_system_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_versions" ADD CONSTRAINT "design_system_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_versions" ADD CONSTRAINT "design_system_versions_design_system_id_design_systems_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_systems" ADD CONSTRAINT "design_systems_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_systems" ADD CONSTRAINT "design_systems_published_version_id_design_system_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."design_system_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_system_attachments_system_idx" ON "design_system_attachments" USING btree ("design_system_id");--> statement-breakpoint
CREATE UNIQUE INDEX "design_system_versions_idx" ON "design_system_versions" USING btree ("design_system_id","version");--> statement-breakpoint
CREATE INDEX "design_systems_workspace_idx" ON "design_systems" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "design_systems_default_idx" ON "design_systems" USING btree ("workspace_id") WHERE "design_systems"."is_default";