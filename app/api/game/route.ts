import { z } from "zod";
import { applyCommand, type GameCommand } from "@/game/state";
import { loadOrCreateGame, loadSavedAction, saveGameCommand } from "@/server/prototype-store";
import { getSessionId } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BUY"), slot: z.number().int().min(0).max(4) }),
  z.object({ type: z.literal("REROLL") }),
  z.object({ type: z.literal("MOVE"), uid: z.string().min(1).max(100), x: z.number().int().min(0).max(7), y: z.number().int().min(0).max(7) }),
  z.object({ type: z.literal("BENCH"), uid: z.string().min(1).max(100) }),
  z.object({ type: z.literal("SELL"), uid: z.string().min(1).max(100) }),
  z.object({ type: z.literal("START_COMBAT") }),
  z.object({ type: z.literal("FINISH_COMBAT") }),
  z.object({ type: z.literal("NEXT_ROUND") }),
  z.object({ type: z.literal("RESET") }),
]);
const requestSchema = z.object({ actionId: z.string().uuid(), expectedVersion: z.number().int().positive(), command: commandSchema });

const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  try { return response({ state: await loadOrCreateGame(await getSessionId()), serverNow: new Date().toISOString() }); }
  catch (error) { console.error("game.load.failed", error); return response({ error: "게임 상태를 불러오지 못했습니다." }, 500); }
}

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return response({ error: "잘못된 게임 명령입니다.", issues: parsed.error.issues }, 400);
    const sessionId = await getSessionId();
    const duplicate = await loadSavedAction(sessionId, parsed.data.actionId);
    if (duplicate) return response({ state: duplicate, actionStatus: "DUPLICATE", serverNow: new Date().toISOString() });
    const current = await loadOrCreateGame(sessionId);
    if (current.version !== parsed.data.expectedVersion) return response({ error: "상태가 갱신되었습니다.", state: current }, 409);
    const result = applyCommand(current, parsed.data.command as GameCommand);
    if (result.error) return response({ error: result.error, state: current }, 422);
    const saved = await saveGameCommand({ sessionId, actionId: parsed.data.actionId, expectedVersion: parsed.data.expectedVersion, state: result.state });
    return response({ state: saved.state, actionStatus: saved.status, serverNow: new Date().toISOString() }, saved.status === "CONFLICT" ? 409 : 200);
  } catch (error) { console.error("game.command.failed", error); return response({ error: "게임 명령 처리에 실패했습니다." }, 500); }
}
