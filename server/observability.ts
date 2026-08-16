import "server-only";

type LogLevel = "info" | "warn" | "error";
type EventFields = Record<string, string | number | boolean | null | undefined>;

export type RequestTrace = {
  requestId: string;
  startedAt: number;
};

export function createRequestTrace(): RequestTrace {
  return { requestId: crypto.randomUUID(), startedAt: Date.now() };
}

export function traceHeaders(trace: RequestTrace) {
  return {
    "Cache-Control": "no-store",
    "X-Request-Id": trace.requestId,
    "Server-Timing": `app;dur=${Math.max(0, Date.now() - trace.startedAt)}`,
  };
}

export function logServerEvent(level: LogLevel, event: string, fields: EventFields = {}, error?: unknown) {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  if (error instanceof Error) payload.error = { name: error.name, message: error.message };
  else if (error !== undefined) payload.error = { message: String(error) };
  console[level](JSON.stringify(payload));
}
