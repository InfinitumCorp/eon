import { normalizeReport } from "./normalize.ts";
import { TOOL_CATALOG } from "./registry.ts";
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
export async function handleAssuranceRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/assurance/catalog" && request.method === "GET") {
    return Response.json({ product: "E(O)N™ Assurance™", mode: "report-review", tools: TOOL_CATALOG }, { headers });
  }
  if (path !== "/api/assurance/normalize" || request.method !== "POST") {
    return Response.json({ error: "Not found." }, { status: 404, headers });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Use application/json." }, { status: 415, headers });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Body required." }, { status: 400, headers });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) {
        await reader.cancel();
        return Response.json({ error: "Maximum report size is 1 MiB." }, { status: 413, headers });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    return Response.json(normalizeReport(body.source, body.report), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid report." }, { status: 400, headers });
  }
}
