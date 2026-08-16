import { describe,expect,it } from "vitest";
import { decodeHistoryCursor,encodeHistoryCursor } from "./history-cursor";
describe("history cursor",()=>{it("round trips a stable timestamp and id",()=>{const cursor=encodeHistoryCursor("2026-08-16T10:00:00.000Z","123e4567-e89b-42d3-a456-426614174000");expect(decodeHistoryCursor(cursor)).toEqual({endedAt:"2026-08-16T10:00:00.000Z",id:"123e4567-e89b-42d3-a456-426614174000"})});it("rejects malformed cursors",()=>{expect(decodeHistoryCursor("bad")).toBeNull();expect(decodeHistoryCursor("2026-01-01|not-uuid")).toBeNull()})});
