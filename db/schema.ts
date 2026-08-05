import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  documentType: text("document_type").notNull(),
  period: text("period").notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  status: text("status").notNull().default("uploaded"),
  uploadedBy: text("uploaded_by").notNull().default("system"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_documents_created_at").on(table.createdAt)]);

export const exceptions = sqliteTable("exceptions", {
  id: text("id").primaryKey(),
  reasonCode: text("reason_code").notNull(),
  reservationNo: text("reservation_no"),
  amountDeltaSatang: integer("amount_delta_satang").notNull().default(0),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  owner: text("owner"),
  resolution: text("resolution"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reconciliationRuns = sqliteTable("reconciliation_runs", {
  id: text("id").primaryKey(),
  phase: integer("phase").notNull(),
  period: text("period").notNull(),
  rulesetVersion: text("ruleset_version").notNull(),
  sourceType: text("source_type").notNull(),
  matchedCount: integer("matched_count").notNull().default(0),
  exceptionCount: integer("exception_count").notNull().default(0),
  status: text("status").notNull().default("queued"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  invoiceNo: text("invoice_no").notNull().unique(),
  customerName: text("customer_name").notNull(),
  subtotalSatang: integer("subtotal_satang").notNull(),
  vatSatang: integer("vat_satang").notNull(),
  totalSatang: integer("total_satang").notNull(),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  issuedAt: text("issued_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const otaSettlements = sqliteTable("ota_settlements", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  batchRef: text("batch_ref").notNull(),
  bookingCount: integer("booking_count").notNull(),
  grossSatang: integer("gross_satang").notNull(),
  feeSatang: integer("fee_satang").notNull(),
  netSatang: integer("net_satang").notNull(),
  payoutSatang: integer("payout_satang"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detail: text("detail").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_audit_events_created_at").on(table.createdAt)]);

export const rulesets = sqliteTable("rulesets", {
  id: text("id").primaryKey(),
  version: text("version").notNull().unique(),
  config: text("config").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
