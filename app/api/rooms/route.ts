import { z } from "zod";
import { createRoom, listRooms, profile } from "@/server/lobby-store";
import { getSessionId } from "@/server/session";

export const runtime="nodejs";export const dynamic="force-dynamic";
const schema=z.object({name:z.string().trim().min(1).max(30)});
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(){try{return json({rooms:await listRooms(),serverNow:new Date().toISOString()})}catch(error){console.error("rooms.list.failed",error);return json({error:"방 목록을 불러오지 못했습니다."},500)}}
export async function POST(request:Request){try{const parsed=schema.safeParse(await request.json());if(!parsed.success)return json({error:"방 이름은 1~30자로 입력하세요."},400);const sessionId=await getSessionId();const user=await profile(sessionId);if(!user.nickname)return json({error:"닉네임을 먼저 설정하세요."},403);const roomId=await createRoom(sessionId,parsed.data.name);if(!roomId)return json({error:"방을 만들지 못했습니다."},409);return json({roomId},201)}catch(error){console.error("rooms.create.failed",error);return json({error:"방 생성에 실패했습니다."},500)}}
