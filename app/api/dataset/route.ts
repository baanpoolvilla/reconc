import { dataset } from "../../../lib/dataset";

/**
 * Serves the reconciliation dataset built from the source documents in data/.
 * `?section=` trims the payload: meta | bookings | receipts | statements | reconciliation.
 */
export async function GET(request: Request) {
  const section = new URL(request.url).searchParams.get("section");
  const body = section && section in dataset ? { [section]: dataset[section as keyof typeof dataset] } : dataset;
  return Response.json(body, { headers: { "cache-control": "public, max-age=300" } });
}
