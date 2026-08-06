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
  error?: string;
};

const emptyDataset: Dataset = {
  meta: { generatedAt: "", period: "", rulesetVersion: buildTimeDataset.meta.rulesetVersion, sources: [] },
  bookings: [],
  receipts: [],
  statements: [],
  reconciliation: {
    rulesetVersion: buildTimeDataset.meta.rulesetVersion,
    accounts: [],
    groups: [],
    exceptions: [],
    outOfScope: [],
    summary: {
      inScopeReceipts: 0, matchedReceipts: 0, matchedGroups: 0, exceptionCount: 0,
      matchRate: 0, matchedSatang: 0, unexplainedReceiptSatang: 0, unexplainedBankSatang: 0, controlBalanced: true,
    },
  },
};

export async function loadDataset(): Promise<LoadedDataset> {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);

  if (!databaseConfigured) {
    const dataset = buildTimeDataset.meta.sources.length ? buildTimeDataset : emptyDataset;
    return { dataset, source: buildTimeDataset.meta.sources.length ? "build" : "empty", databaseConfigured: false };
  }

  try {
    const [{ getDb, migrate }, { latestDataset }] = await Promise.all([
      import("./db/client.mjs"),
      import("./db/repository.mjs"),
    ]);
    const db = await getDb();
    await migrate(db);
    const stored = (await latestDataset(db)) as Dataset | null;
    if (stored) return { dataset: stored, source: "database", databaseConfigured: true };
    return { dataset: emptyDataset, source: "empty", databaseConfigured: true };
  } catch (error) {
    // Surface the failure rather than quietly serving stale build-time numbers.
    return {
      dataset: emptyDataset,
      source: "empty",
      databaseConfigured: true,
      error: error instanceof Error ? error.message : "ต่อฐานข้อมูลไม่สำเร็จ",
    };
  }
}
