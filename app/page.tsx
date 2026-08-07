import { loadDataset } from "../lib/data-source";
import type { AppSettings, MatchDecision } from "../lib/settings";
import Workspace from "./workspace";

// Rendered per request so a web upload — or a decision someone made on another
// device — shows up immediately. With no DATABASE_URL this resolves to the
// dataset built from data/ and is effectively static anyway.
export const dynamic = "force-dynamic";

export default async function Page() {
  const { dataset, source, databaseConfigured, online, settings, decisions, error } = await loadDataset();
  return (
    <Workspace
      dataset={dataset}
      source={source}
      databaseConfigured={databaseConfigured}
      online={online}
      serverSettings={(settings as AppSettings | null) ?? null}
      serverDecisions={(decisions as MatchDecision[]) ?? []}
      loadError={error}
    />
  );
}
