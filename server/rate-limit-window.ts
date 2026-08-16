export function rateLimitBucket(epochMs:number,windowSeconds:number){return Math.floor(epochMs/1000/windowSeconds)}
