CREATE TYPE "public"."request_event_type" AS ENUM('created', 'status_changed', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."request_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('open', 'in_review', 'reviewed', 'rejected');--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"type" "request_event_type" NOT NULL,
	"from_status" "request_status",
	"to_status" "request_status" NOT NULL,
	"actor" varchar(160),
	"trace_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(140) NOT NULL,
	"description" text NOT NULL,
	"priority" "request_priority" NOT NULL,
	"status" "request_status" DEFAULT 'open' NOT NULL,
	"created_by" varchar(160) NOT NULL,
	"reviewed_by" varchar(160),
	"reviewed_at" timestamp with time zone,
	"created_trace_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_request_events_request_id_created_at" ON "request_events" USING btree ("request_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_request_events_trace_id" ON "request_events" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_requests_created_at" ON "requests" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_requests_created_by_created_at" ON "requests" USING btree ("created_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_requests_status_created_at" ON "requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_requests_status_created_by_created_at" ON "requests" USING btree ("status","created_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_requests_created_trace_id" ON "requests" USING btree ("created_trace_id");