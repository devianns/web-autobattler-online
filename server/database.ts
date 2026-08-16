import "server-only";
import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) throw new Error("DATABASE_URL 또는 POSTGRES_URL이 필요합니다.");
export const sql = neon(connectionString);
