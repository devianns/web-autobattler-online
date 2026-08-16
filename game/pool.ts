import { UNIT_IDS } from "./content";
import { createRng } from "./rng";
import type { ShopSlot, UnitBaseId } from "./types";

export type PoolAvailability=Record<UnitBaseId,number>;
export const copiesForStar=(starLevel:1|2|3)=>starLevel===1?1:starLevel===2?3:9;

export function countShopUnits(shop:ShopSlot[]){
  const counts={} as Partial<Record<UnitBaseId,number>>;
  for(const slot of shop)if(!slot.purchased)counts[slot.baseId]=(counts[slot.baseId]??0)+1;
  return counts;
}

/** Rolls against a local availability snapshot. Every rejected candidate still
 * consumes RNG, so retries are deterministic on every server instance. */
export function reserveShop(seed:string,availability:PoolAvailability,size=5){
  const remaining={...availability}; const random=createRng(seed); const shop:ShopSlot[]=[];
  const maxAttempts=Math.max(UNIT_IDS.length*size*4,40); let attempts=0;
  while(shop.length<size&&attempts<maxAttempts){
    const baseId=UNIT_IDS[Math.floor(random()*UNIT_IDS.length)]; attempts+=1;
    if(remaining[baseId]<=0)continue;
    remaining[baseId]-=1; shop.push({slot:shop.length,baseId,purchased:false});
  }
  return {shop,remaining,reserved:countShopUnits(shop),complete:shop.length===size};
}

export function poolDelta(returned:ShopSlot[],reserved:ShopSlot[]){
  const before=countShopUnits(returned); const after=countShopUnits(reserved);
  return Object.fromEntries(UNIT_IDS.map((id)=>[id,(before[id]??0)-(after[id]??0)])) as PoolAvailability;
}
