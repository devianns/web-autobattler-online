import { describe,expect,it } from "vitest";
import { UNIT_IDS } from "./content";
import { auditPoolBalance,copiesForStar,poolDelta,reserveShop,type PoolAvailability } from "./pool";

const availability=(count:number)=>Object.fromEntries(UNIT_IDS.map((id)=>[id,count])) as PoolAvailability;

describe("shared unit pool",()=>{
  it("reserves deterministically and never makes inventory negative",()=>{
    const first=reserveShop("shop-seed",availability(2),5);
    expect(reserveShop("shop-seed",availability(2),5)).toEqual(first);
    expect(first.complete).toBe(true);
    expect(Object.values(first.remaining).every((count)=>count>=0)).toBe(true);
  });
  it("skips exhausted units and reports an incomplete shop when the pool is empty",()=>{
    const stock=availability(0); stock.U_MAGE=2;
    const result=reserveShop("scarce",stock,5);
    expect(result.shop).toHaveLength(2); expect(result.shop.every((slot)=>slot.baseId==="U_MAGE")).toBe(true); expect(result.complete).toBe(false);
  });
  it("computes refresh net deltas and star copy counts",()=>{
    const oldShop=reserveShop("old",availability(10),5).shop;
    const newShop=reserveShop("new",availability(10),5).shop;
    expect(Object.values(poolDelta(oldShop,newShop)).reduce((sum,value)=>sum+value,0)).toBe(0);
    expect([copiesForStar(1),copiesForStar(2),copiesForStar(3)]).toEqual([1,3,9]);
  });
  it("detects missing or duplicated copies in the pool ledger",()=>{
    expect(auditPoolBalance({initial:29,available:20,reserved:4,owned:5}).valid).toBe(true);
    expect(auditPoolBalance({initial:29,available:21,reserved:4,owned:5})).toMatchObject({valid:false,difference:-1});
  });
});
