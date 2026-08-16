import { z } from "zod";
import { getSessionId } from "@/server/session";
import { auditSharedPool } from "@/server/pool-audit";

export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{gameId:string}>}){
  if(process.env.NODE_ENV==="production")return Response.json({error:"찾을 수 없습니다."},{status:404});
  const parsed=z.string().uuid().safeParse((await params).gameId);if(!parsed.success)return Response.json({error:"잘못된 게임 ID입니다."},{status:400});
  try{const audit=await auditSharedPool(parsed.data,await getSessionId());return audit?Response.json(audit,{headers:{"Cache-Control":"no-store"}}):Response.json({error:"방장만 검사할 수 있습니다."},{status:403})}
  catch(error){console.error("pool.audit.failed",error);return Response.json({error:"공유 풀 검사에 실패했습니다."},{status:500})}
}
