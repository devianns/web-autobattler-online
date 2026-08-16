import { z } from "zod";
import { applyCommand, type GameCommand } from "@/game/state";
import { getSessionId } from "@/server/session";
import { loadOnlineAction, loadOnlineGame, loadOnlineGameView, rerollOnlineShop, saveOnlineCommand } from "@/server/online-game-store";
import { reconcileOnlineGame } from "@/server/online-reconcile";

export const runtime="nodejs"; export const dynamic="force-dynamic";
type Context={params:Promise<{gameId:string}>};
const command=z.discriminatedUnion("type",[
  z.object({type:z.literal("BUY"),slot:z.number().int().min(0).max(4)}),
  z.object({type:z.literal("REROLL")}),
  z.object({type:z.literal("MOVE"),uid:z.string().min(1).max(100),x:z.number().int().min(0).max(7),y:z.number().int().min(0).max(7)}),
  z.object({type:z.literal("BENCH"),uid:z.string().min(1).max(100)}),z.object({type:z.literal("SELL"),uid:z.string().min(1).max(100)})
]);
const requestSchema=z.object({actionId:z.string().uuid(),expectedVersion:z.number().int().positive(),command});
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});

export async function GET(_request:Request,{params}:Context){try{const gameId=z.string().uuid().parse((await params).gameId);const sessionId=await getSessionId();const member=await loadOnlineGame(gameId,sessionId);if(!member)return json({error:"게임 참가자가 아닙니다."},404);const reconcileStatus=await reconcileOnlineGame(gameId);const view=await loadOnlineGameView(gameId,sessionId);return json({...view,reconcileStatus,serverNow:new Date().toISOString()})}catch(error){console.error("online.game.load.failed",error);return json({error:"공용 게임을 불러오지 못했습니다."},500)}}
export async function POST(request:Request,{params}:Context){
  try{
    const gameId=z.string().uuid().parse((await params).gameId);const parsed=requestSchema.safeParse(await request.json());
    if(!parsed.success)return json({error:"잘못된 게임 명령입니다."},400);
    const sessionId=await getSessionId();await reconcileOnlineGame(gameId);const view=await loadOnlineGameView(gameId,sessionId);
    if(!view)return json({error:"게임 참가자가 아닙니다."},403);
    if(view.state.hp<=0)return json({error:"탈락한 플레이어는 게임 명령을 실행할 수 없습니다.",state:view.state},403);
    if(view.game.phase!=="SHOP"||new Date(view.game.phaseEndsAt).getTime()<=Date.now())return json({error:"상점 단계가 종료되었습니다.",state:view.state},409);
    const duplicate=await loadOnlineAction(gameId,sessionId,parsed.data.actionId);
    if(duplicate)return json({state:duplicate,actionStatus:"DUPLICATE",serverNow:new Date().toISOString()});
    const current=await loadOnlineGame(gameId,sessionId);if(!current)return json({error:"게임 참가자가 아닙니다."},403);
    if(current.version!==parsed.data.expectedVersion)return json({error:"상태가 갱신되었습니다.",state:current},409);
    if(parsed.data.command.type==="REROLL"){
      const saved=await rerollOnlineShop({gameId,sessionId,actionId:parsed.data.actionId,expectedVersion:parsed.data.expectedVersion,current});
      if(saved.status==="INVALID")return json({error:saved.error,state:saved.state},422);
      return json({state:saved.state,actionStatus:saved.status,serverNow:new Date().toISOString()},saved.status==="CONFLICT"?409:200);
    }
    const gameCommand=parsed.data.command as GameCommand;const result=applyCommand(current,gameCommand);
    if(result.error)return json({error:result.error,state:current},422);
    const saved=await saveOnlineCommand({gameId,sessionId,actionId:parsed.data.actionId,expectedVersion:parsed.data.expectedVersion,state:result.state,previousState:current,command:gameCommand});
    return json({state:saved.state,actionStatus:saved.status,serverNow:new Date().toISOString()},saved.status==="CONFLICT"?409:200);
  }catch(error){console.error("online.game.command.failed",error);return json({error:"공용 게임 명령 처리에 실패했습니다."},500)}
}
