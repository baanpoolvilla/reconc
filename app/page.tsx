import { loadDataset } from "../lib/data-source";
import Workspace from "./workspace";

// Rendered per request so a web upload shows up immediately. With no
// DATABASE_URL this resolves to the dataset built from data/ and is effectively
// static anyway.
export const dynamic = "force-dynamic";

export default async function Page() {
  const { dataset, source, databaseConfigured, error } = await loadDataset();
  return <Workspace dataset={dataset} source={source} databaseConfigured={databaseConfigured} loadError={error} />;
}
