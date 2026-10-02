type Entry={count:number;reset:number}; const buckets=new Map<string,Entry>();
export function consumeRateLimit(key:string,limit=8,windowMs=15*60_000,now=Date.now()) { const old=buckets.get(key); if(!old||old.reset<=now){buckets.set(key,{count:1,reset:now+windowMs});return true} if(old.count>=limit)return false; old.count++; return true; }
export function resetRateLimitsForTests(){buckets.clear()}
