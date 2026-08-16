import { listHistory } from "@/server/lobby-store";
import { decodeHistoryCursor } from "@/matchmaking/history-cursor";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{const value=new URL(request.url).searchParams.get("cursor");const cursor=value?decodeHistoryCursor(value):null;if(value&&!cursor)return Response.json({error:"잘못된 기록 cursor입니다."},{status:400});const page=await listHistory(cursor??undefined);return Response.json({history:page.items,nextCursor:page.nextCursor,serverNow:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}})}catch(error){console.error("history.list.failed",error);return Response.json({error:"게임 기록을 불러오지 못했습니다."},{status:500})}}
