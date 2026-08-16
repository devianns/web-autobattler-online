import "server-only";
import { ensureLobbySchema } from "./lobby-store";
import { sql } from "./database";
import { rateLimitBucket } from "./rate-limit-window";

let schemaReady:Promise<void>|null=null;
let lastCleanup=0;
async function ensureRateLimitSchema(){
  await ensureLobbySchema();
  schemaReady??=(async()=>{await sql`CREATE TABLE IF NOT EXISTS request_rate_limits (scope_key text NOT NULL,window_bucket bigint NOT NULL,request_count integer NOT NULL CHECK (request_count>0),expires_at timestamptz NOT NULL,PRIMARY KEY (scope_key,window_bucket))`;await sql`CREATE INDEX IF NOT EXISTS request_rate_limits_expiry_idx ON request_rate_limits(expires_at)`})();
  return schemaReady;
}

export async function consumeRateLimit(args:{sessionId:string;scope:string;limit:number;windowSeconds:number}){
  await ensureRateLimitSchema();if(Date.now()-lastCleanup>300_000){lastCleanup=Date.now();await sql`DELETE FROM request_rate_limits WHERE expires_at<now()`}const bucket=rateLimitBucket(Date.now(),args.windowSeconds);const key=`${args.scope}:${args.sessionId}`;
  const rows=await sql`INSERT INTO request_rate_limits (scope_key,window_bucket,request_count,expires_at) VALUES (${key},${bucket},1,now()+make_interval(secs=>${args.windowSeconds*2})) ON CONFLICT (scope_key,window_bucket) DO UPDATE SET request_count=request_rate_limits.request_count+1 WHERE request_rate_limits.request_count<${args.limit} RETURNING request_count`;
  return {allowed:rows.length>0,remaining:rows.length?Math.max(0,args.limit-rows[0].request_count):0,retryAfterSeconds:args.windowSeconds-Math.floor(Date.now()/1000)%args.windowSeconds};
}
