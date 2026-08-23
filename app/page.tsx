import { loadDataset } from "../lib/data-source";
import type { AppSettings, LineHold, MatchDecision } from "../lib/settings";
import Workspace from "./workspace";

// Rendered per request so a web upload — or a decision someone made on another
// device — shows up immediately. With no DATABASE_URL there is nothing to read,
// and the page says so rather than falling back to figures from anywhere else.
export const dynamic = "force-dynamic";

export default async function Page() {
  const { dataset, source, databaseConfigured, online, settings, decisions, holds, error } = await loadDataset();
  return (
    <Workspace
      dataset={dataset}
      source={source}
      databaseConfigured={databaseConfigured}
      online={online}
      serverSettings={(settings as AppSettings | null) ?? null}
      serverDecisions={(decisions as MatchDecision[]) ?? []}
      serverHolds={(holds as LineHold[]) ?? []}
      loadError={error}
    />
  );
}
