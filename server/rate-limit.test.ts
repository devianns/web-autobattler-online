import { describe,expect,it } from "vitest";
import { rateLimitBucket } from "./rate-limit-window";

describe("rate limit window",()=>{it("groups timestamps into stable fixed windows",()=>{expect(rateLimitBucket(59_999,60)).toBe(0);expect(rateLimitBucket(60_000,60)).toBe(1);expect(rateLimitBucket(119_999,60)).toBe(1)})});
