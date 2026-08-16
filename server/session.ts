import "server-only";
import { cookies } from "next/headers";

const SESSION_COOKIE = "wa_session";
export async function getSessionId() {
  const store = await cookies();
  let id = store.get(SESSION_COOKIE)?.value;
  if (!id) {
    id = crypto.randomUUID();
    store.set(SESSION_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  return id;
}
