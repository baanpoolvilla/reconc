import { loadDataset } from "../../../lib/data-source";

export const dynamic = "force-dynamic";

/**
 * The reconciliation dataset the dashboard renders.
 * `?section=` trims the payload: meta | bookings | receipts | statements | reconciliation.
 */
export async function GET(request: Request) {
  const { dataset, source, databaseConfigured, error } = await loadDataset();
  const section = new URL(request.url).searchParams.get("section");
  const body = section && section in dataset ? { [section]: dataset[section as keyof typeof dataset] } : dataset;
  return Response.json({ ...body, source, databaseConfigured, error }, { status: error ? 500 : 200 });
}
