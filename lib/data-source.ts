import type { Dataset } from "./dataset";
import generated from "./dataset.generated.json";

// Where the dashboard gets its numbers.
//
//   DATABASE_URL set  → the latest reconciliation run stored in Postgres,
//                       which is what web uploads write to.
//   DATABASE_URL unset→ the dataset built from data/ at build time.
//
// The second path keeps the app deployable and demonstrable before any
// database exists; it is never a silent fallback for a *failing* database.

export const buildTimeDataset = generated as unknown as Dataset;

export type DatasetSource = "database" | "build" | "empty";

export type LoadedDataset = {
  dataset: Dataset;
  source: DatasetSource;
  databaseConfigured: boolean;
  /** true เมื่อการตั้งค่าและการตัดสินใจถูกเก็บบนเซิร์ฟเวอร์ ทุกเครื่องจึงเห็นตรงกัน */
  online: boolean;
  settings: unknown;
  decisions: unknown[];
  error?: string;
};

const emptyDataset: Dataset = {
  meta: { generatedAt: "", period: "", periods: [], rulesetVersion: buildTimeDataset.meta.rulesetVersion, sources: [] },
  bookings: [],
  receipts: [],
  statements: [],
  reconciliation: {
    rulesetVersion: buildTimeDataset.meta.rulesetVersion,
    accounts: [],
    groups: [],
    exceptions: [],
    outOfScope: [],
    staleDecisions: [],
    summary: {
      inScopeReceipts: 0, matchedReceipts: 0, matchedGroups: 0, exceptionCount: 0,
      matchRate: 0, matchedSatang: 0, unexplainedReceiptSatang: 0, unexplainedBankSatang: 0,
      decidedGroups: 0, decidedReceipts: 0, acceptedDifferenceSatang: 0, staleDecisions: 0, controlBalanced: true,
      crossPeriodGroups: 0, crossPeriodSatang: 0, missingStatements: 0,
    },
  },
};

export async function loadDataset(): Promise<LoadedDataset> {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);

  if (!databaseConfigured) {
    const dataset = buildTimeDataset.meta.sources.length ? buildTimeDataset : emptyDataset;
    return {
      dataset,
      source: buildTimeDataset.meta.sources.length ? "build" : "empty",
      databaseConfigured: false,
      online: false,
      settings: null,
      decisions: [],
    };
  }

  try {
    const [{ getDb, ensureSchema }, { latestDataset, listDecisions, loadStoredSettings }] = await Promise.all([
      import("./db/client.mjs"),
      import("./db/repository.mjs"),
    ]);
    const db = await getDb();
    await ensureSchema(db);
    const [stored, settings, decisions] = await Promise.all([
      latestDataset(db) as Promise<Dataset | null>,
      loadStoredSettings(db),
      listDecisions(db),
    ]);
    return {
      dataset: stored ?? emptyDataset,
      source: stored ? "database" : "empty",
      databaseConfigured: true,
      online: true,
      settings,
      decisions,
    };
  } catch (error) {
    // Surface the failure rather than quietly serving stale build-time numbers.
    return {
      dataset: emptyDataset,
      source: "empty",
      databaseConfigured: true,
      online: false,
      settings: null,
      decisions: [],
      error: error instanceof Error ? error.message : "ต่อฐานข้อมูลไม่สำเร็จ",
    };
  }
}
