import { listHistory } from "@/server/lobby-store";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){try{return Response.json({history:await listHistory(),serverNow:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}})}catch(error){console.error("history.list.failed",error);return Response.json({error:"게임 기록을 불러오지 못했습니다."},{status:500})}}
