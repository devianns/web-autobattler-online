import { sql } from "@/server/database";
import { createRequestTrace, logServerEvent, traceHeaders } from "@/server/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const trace = createRequestTrace();
  try {
    const startedAt = Date.now();
    const rows = await sql`SELECT now() server_now`;
    const databaseLatencyMs = Date.now() - startedAt;
    return Response.json({
      status: "ok",
      database: "reachable",
      databaseLatencyMs,
      serverNow: rows[0]?.server_now ?? new Date().toISOString(),
    }, { headers: traceHeaders(trace) });
  } catch (error) {
    logServerEvent("error", "health.database.unreachable", {
      requestId: trace.requestId,
      durationMs: Date.now() - trace.startedAt,
    }, error);
    return Response.json({ status: "degraded", database: "unreachable" }, {
      status: 503,
      headers: traceHeaders(trace),
    });
  }
}
