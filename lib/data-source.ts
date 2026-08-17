import type { Dataset } from "./dataset";
import * as engine from "./reconciliation.mjs";

// Where the dashboard gets its numbers: the latest reconciliation run stored in
// Postgres, which is what a web upload writes. There is one source and no other.
//
// There used to be a second path that parsed accounting documents from data/ at
// build time and baked the result into the bundle. It is gone. Real guest names,
// phone numbers and bank statement lines have no business inside a deployment
// artifact, and having two sources meant the screen could show numbers that no
// upload ever produced.
//
// With no DATABASE_URL, or with a database that cannot be reached, the app says
// so and shows nothing — it never invents a fallback set of figures.

export type DatasetSource = "database" | "empty";

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

const RULESET_VERSION = engine.RULESET_VERSION as string;

const emptyDataset: Dataset = {
  meta: { generatedAt: "", period: "", periods: [], rulesetVersion: RULESET_VERSION, sources: [] },
  bookings: [],
  receipts: [],
  statements: [],
  reconciliation: {
    rulesetVersion: RULESET_VERSION,
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

const nothing = (extra: Partial<LoadedDataset>): LoadedDataset => ({
  dataset: emptyDataset,
  source: "empty",
  databaseConfigured: false,
  online: false,
  settings: null,
  decisions: [],
  ...extra,
});

export async function loadDataset(): Promise<LoadedDataset> {
  if (!process.env.DATABASE_URL) return nothing({});

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
    // Surface the failure rather than quietly serving numbers from somewhere else.
    return nothing({
      databaseConfigured: true,
      error: error instanceof Error ? error.message : "ต่อฐานข้อมูลไม่สำเร็จ",
    });
  }
}
