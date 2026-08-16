const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function encodeHistoryCursor(endedAt:string,id:string){return `${endedAt}|${id}`}
export function decodeHistoryCursor(cursor:string){const separator=cursor.lastIndexOf("|");if(separator<1)return null;const endedAt=cursor.slice(0,separator);const id=cursor.slice(separator+1);const timestamp=Date.parse(endedAt);if(!Number.isFinite(timestamp)||!UUID.test(id))return null;return {endedAt:new Date(timestamp).toISOString(),id}}
