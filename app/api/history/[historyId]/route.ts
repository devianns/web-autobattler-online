import { historyDetail } from "@/server/lobby-store";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{historyId:string}>}){try{const detail=await historyDetail((await params).historyId);return detail?Response.json({history:detail},{headers:{"Cache-Control":"no-store"}}):Response.json({error:"기록을 찾을 수 없습니다."},{status:404})}catch(error){console.error("history.detail.failed",error);return Response.json({error:"게임 장부를 불러오지 못했습니다."},{status:500})}}
