import { z } from "zod";
import { getSessionId } from "@/server/session";
import { profile, setNickname } from "@/server/lobby-store";
import { consumeRateLimit } from "@/server/rate-limit";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const nicknameSchema = z.object({ nickname: z.string().trim().min(1).max(16).regex(/^[\p{L}\p{N}_ -]+$/u, "닉네임에 사용할 수 없는 문자가 있습니다.") });
const json = (body: unknown, status=200) => Response.json(body,{status,headers:{"Cache-Control":"no-store"}});

export async function GET(){ try{return json({profile:await profile(await getSessionId())})}catch(error){console.error("session.load.failed",error);return json({error:"세션을 불러오지 못했습니다."},500)} }
export async function POST(request:Request){ try{const parsed=nicknameSchema.safeParse(await request.json());if(!parsed.success)return json({error:parsed.error.issues[0]?.message??"닉네임을 확인하세요."},400);const sessionId=await getSessionId();if(!(await consumeRateLimit({sessionId,scope:"nickname",limit:10,windowSeconds:60})).allowed)return json({error:"닉네임 변경 요청이 너무 많습니다."},429);return json({profile:await setNickname(sessionId,parsed.data.nickname)})}catch(error){console.error("session.update.failed",error);return json({error:"닉네임을 저장하지 못했습니다."},500)} }
