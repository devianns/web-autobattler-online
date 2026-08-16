import { z } from "zod";
import { joinRoom, leaveRoom, profile, roomDetail, setReady, startRoom } from "@/server/lobby-store";
import { getSessionId } from "@/server/session";
import { consumeRateLimit } from "@/server/rate-limit";

export const runtime="nodejs";export const dynamic="force-dynamic";
const action=z.discriminatedUnion("type",[
  z.object({type:z.literal("JOIN")}),z.object({type:z.literal("LEAVE")}),z.object({type:z.literal("READY"),ready:z.boolean()}),z.object({type:z.literal("START")}),
]);
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
type Context={params:Promise<{roomId:string}>};

export async function GET(_request:Request,{params}:Context){try{const roomId=z.string().uuid().safeParse((await params).roomId);if(!roomId.success)return json({error:"잘못된 방 ID입니다."},400);const detail=await roomDetail(roomId.data,await getSessionId());return detail?json({room:detail,serverNow:new Date().toISOString()}):json({error:"방을 찾을 수 없습니다."},404)}catch(error){console.error("room.load.failed",error);return json({error:"방 정보를 불러오지 못했습니다."},500)}}
export async function POST(request:Request,{params}:Context){try{const parsed=action.safeParse(await request.json());if(!parsed.success)return json({error:"잘못된 방 명령입니다."},400);const roomId=z.string().uuid().safeParse((await params).roomId);if(!roomId.success)return json({error:"잘못된 방 ID입니다."},400);const sessionId=await getSessionId();if(!(await consumeRateLimit({sessionId,scope:"room-action",limit:60,windowSeconds:60})).allowed)return json({error:"방 요청이 너무 많습니다."},429);await profile(sessionId);let ok=false;
  if(parsed.data.type==="JOIN")ok=await joinRoom(roomId.data,sessionId);
  if(parsed.data.type==="LEAVE")ok=await leaveRoom(roomId.data,sessionId);
  if(parsed.data.type==="READY")ok=await setReady(roomId.data,sessionId,parsed.data.ready);
  if(parsed.data.type==="START")ok=await startRoom(roomId.data,sessionId);
  if(!ok)return json({error:"현재 상태에서는 요청을 처리할 수 없습니다."},409);
  return json({ok:true,room:await roomDetail(roomId.data,sessionId),serverNow:new Date().toISOString()});
}catch(error){console.error("room.action.failed",error);return json({error:"방 명령 처리에 실패했습니다."},500)}}
