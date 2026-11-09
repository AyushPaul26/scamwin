import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Assessment, Artifact, CheckMessage, CheckRecord, Observation, PublicWarning, WarningSubmission } from "../scamwin/contracts";

const time = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const scamwinChecks = pgTable("scamwin_checks", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), submissionKey: text("submission_key").notNull(),
  state: text("state").notNull(), generation: integer("generation").notNull(), revision: integer("revision").notNull(),
  record: jsonb("record").$type<CheckRecord>().notNull(), createdAt: time("created_at"), updatedAt: time("updated_at"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [uniqueIndex("scamwin_check_submission_uidx").on(t.ownerId, t.submissionKey), index("scamwin_check_owner_time_idx").on(t.ownerId, t.createdAt), uniqueIndex("scamwin_check_active_owner_uidx").on(t.ownerId).where(sql`${t.deletedAt} is null and ${t.state} in ('queued','validating','collecting','analyzing','cancel_requested')`)]);
export const scamwinRuns = pgTable("scamwin_runs", {
  id: text("id").primaryKey(), checkId: text("check_id").notNull().references(() => scamwinChecks.id, { onDelete: "cascade" }), generation: integer("generation").notNull(),
  state: text("state").notNull(), deadline: timestamp("deadline", { withTimezone: true }).notNull(), heartbeat: time("heartbeat"), cleanupState: text("cleanup_state").notNull().default("not_created"),
  // Durable admissions stay counted even when a private check is soft deleted.
  ownerId: text("owner_id").notNull(), createdAt: time("created_at"),
}, (t) => [uniqueIndex("scamwin_run_generation_uidx").on(t.checkId, t.generation), index("scamwin_run_admission_idx").on(t.createdAt, t.ownerId)]);
export const scamwinArtifacts = pgTable("scamwin_artifacts", {
  id: text("id").primaryKey(), checkId: text("check_id").notNull().references(() => scamwinChecks.id, { onDelete: "cascade" }), ownerId: text("owner_id").notNull(), runId: text("run_id"),
  kind: text("kind").notNull(), bytes: integer("bytes").notNull(), sha256: text("sha256").notNull(), record: jsonb("record").$type<Artifact>().notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: time("created_at"),
}, (t) => [index("scamwin_artifact_owner_idx").on(t.ownerId, t.checkId), index("scamwin_artifact_expiry_idx").on(t.expiresAt)]);
export const scamwinObservations = pgTable("scamwin_observations", {
  id: text("id").primaryKey(), checkId: text("check_id").notNull().references(() => scamwinChecks.id, { onDelete: "cascade" }), runId: text("run_id").notNull(), ownerId: text("owner_id").notNull(), kind: text("kind").notNull(), record: jsonb("record").$type<Observation>().notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
}, (t) => [index("scamwin_observation_check_kind_idx").on(t.checkId, t.kind, t.observedAt)]);
export const scamwinAssessments = pgTable("scamwin_assessments", {
  id: text("id").primaryKey(), checkId: text("check_id").notNull().references(() => scamwinChecks.id, { onDelete: "cascade" }), runId: text("run_id").notNull(), record: jsonb("record").$type<Assessment>().notNull(), policyVersion: text("policy_version").notNull(), createdAt: time("created_at"),
}, (t) => [uniqueIndex("scamwin_assessment_run_uidx").on(t.runId)]);
export const scamwinIndicators = pgTable("scamwin_indicators", {
  id: text("id").primaryKey(), checkId: text("check_id").notNull().references(() => scamwinChecks.id, { onDelete: "cascade" }), ownerId: text("owner_id").notNull(), kind: text("kind").notNull(), fingerprint: text("fingerprint").notNull(), value: text("value").notNull(),
}, (t) => [index("scamwin_indicator_owner_lookup_idx").on(t.ownerId, t.kind, t.fingerprint)]);
export const scamwinMessages = pgTable("scamwin_messages", {
  id: text("id").primaryKey(), checkId: text("check_id").notNull().references(() => scamwinChecks.id, { onDelete: "cascade" }), ownerId: text("owner_id").notNull(), record: jsonb("record").$type<CheckMessage>().notNull(), createdAt: time("created_at"),
}, (t) => [index("scamwin_message_check_time_idx").on(t.checkId, t.createdAt)]);
export const scamwinWarningSubmissions = pgTable("scamwin_warning_submissions", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), checkId: text("check_id").notNull().references(() => scamwinChecks.id, { onDelete: "cascade" }), status: text("status").notNull(), revision: integer("revision").notNull(), payloadHash: text("payload_hash").notNull(), record: jsonb("record").$type<WarningSubmission>().notNull(), createdAt: time("created_at"), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("scamwin_review_queue_idx").on(t.status, t.createdAt), index("scamwin_warning_owner_idx").on(t.ownerId)]);
export const scamwinPublicWarnings = pgTable("scamwin_public_warnings", {
  id: text("id").primaryKey(), hostname: text("hostname").notNull(), status: text("status").notNull(), revision: integer("revision").notNull(), record: jsonb("record").$type<PublicWarning>().notNull(), createdAt: time("created_at"), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("scamwin_public_hostname_idx").on(t.hostname, t.status)]);
export const scamwinPublications = pgTable("scamwin_publications", {
  id: text("id").primaryKey(), warningId: text("warning_id").notNull().references(() => scamwinPublicWarnings.id), revision: integer("revision").notNull(), operationId: text("operation_id").notNull(), status: text("status").notNull(), record: jsonb("record").notNull(), createdAt: time("created_at"),
}, (t) => [uniqueIndex("scamwin_publication_operation_uidx").on(t.operationId), uniqueIndex("scamwin_publication_revision_uidx").on(t.warningId, t.revision)]);
export const scamwinJobOutbox = pgTable("scamwin_job_outbox", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), aggregateId: text("aggregate_id").notNull(), generation: integer("generation").notNull(), idempotencyKey: text("idempotency_key").notNull(), state: text("state").notNull().default("pending"), attempts: integer("attempts").notNull().default(0), leaseUntil: timestamp("lease_until", { withTimezone: true }), createdAt: time("created_at"),
}, (t) => [uniqueIndex("scamwin_outbox_idempotency_uidx").on(t.idempotencyKey), index("scamwin_outbox_dispatch_idx").on(t.state, t.createdAt)]);
export const scamwinRoles = pgTable("scamwin_roles", { id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), role: text("role").notNull(), createdAt: time("created_at") }, (t) => [uniqueIndex("scamwin_role_owner_uidx").on(t.ownerId, t.role)]);
export const scamwinAuditEvents = pgTable("scamwin_audit_events", { id: text("id").primaryKey(), actorClass: text("actor_class").notNull(), action: text("action").notNull(), objectId: text("object_id").notNull(), code: text("code").notNull(), createdAt: time("created_at") });
export const scamwinRegistrySync = pgTable("scamwin_registry_sync", { id: text("id").primaryKey(), deployment: text("deployment").notNull(), record: jsonb("record").notNull(), updatedAt: time("updated_at") }, (t) => [uniqueIndex("scamwin_registry_deployment_uidx").on(t.deployment)]);
