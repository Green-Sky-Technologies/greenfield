ALTER TABLE "projects" DROP CONSTRAINT "projects_design_system_id_design_systems_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_design_system_version_id_design_system_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "design_system_id";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "design_system_version_id";--> statement-breakpoint
ALTER TABLE "share_links" DROP COLUMN "doc_version_id";--> statement-breakpoint
ALTER TABLE "agent_messages" DROP COLUMN "snapshot_version_id";--> statement-breakpoint
ALTER TABLE "agent_messages" DROP COLUMN "txn_ids";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "design_system_id";--> statement-breakpoint
DROP TABLE "figma_variable_links" CASCADE;--> statement-breakpoint
DROP TABLE "figma_links" CASCADE;--> statement-breakpoint
DROP TABLE "figma_credentials" CASCADE;--> statement-breakpoint
DROP TABLE "plugin_tokens" CASCADE;--> statement-breakpoint
DROP TABLE "design_system_versions" CASCADE;--> statement-breakpoint
DROP TABLE "design_systems" CASCADE;--> statement-breakpoint
DROP TABLE "design_docs" CASCADE;--> statement-breakpoint
DROP TABLE "doc_ops" CASCADE;--> statement-breakpoint
DROP TABLE "doc_versions" CASCADE;--> statement-breakpoint
DROP TYPE "public"."op_source";--> statement-breakpoint
DROP TYPE "public"."doc_version_kind";--> statement-breakpoint
DROP TYPE "public"."figma_direction";
