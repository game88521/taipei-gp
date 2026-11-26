// Rex <game88521@gmail.com>. Persistent REST commands; no process-local production fallback.
import {createHash,timingSafeEqual} from 'node:crypto';
import {UUID} from '../shared/lap-proof.js';
export class ApiError extends Error {constructor(status,code,detail){super(code);this.status=status;this.detail=detail;}}
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const header=(req,name)=>String(req.headers?.[name.toLowerCase()]??'');
export const accountKey=id=>'taipei-gp:lantern:account:'+id;
export function bodyOf(req,max=3_200_000){try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body??{});if(Buffer.byteLength(raw)>max)throw new ApiError(413,'payload-too-large');const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))throw Error();return b;}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,'invalid-request');}}
export function apiReply(res,status,value){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');return res.status(status).json(value);}
export const MAX_REQUEST_TIMEOUT_MS=7000;
const timeoutError=()=>new ApiError(504,'upstream-timeout');
/** A fresh scope per incoming request; concurrent requests must never share a deadline. */
export function requestStore(store,requestedMs=MAX_REQUEST_TIMEOUT_MS){
 const budget=Number.isFinite(requestedMs)&&requestedMs>0?Math.min(MAX_REQUEST_TIMEOUT_MS,requestedMs):MAX_REQUEST_TIMEOUT_MS,deadline=performance.now()+budget;
 if(typeof store.withDeadline==='function')return store.withDeadline(deadline);
 // Injectable stores retain the same response deadline; only native REST stores expose abort.
 return{configured:store.configured,async command(...cmd){const remaining=deadline-performance.now();if(remaining<=0)throw timeoutError();let timer;try{return await Promise.race([Promise.resolve().then(()=>store.command(...cmd)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeoutError()),remaining);})]);}finally{clearTimeout(timer);}}};
}
export function createStore(options={}){
 const url=options.url??process.env.KV_REST_API_URL??process.env.UPSTASH_REDIS_REST_URL,token=options.token??process.env.KV_REST_API_TOKEN??process.env.UPSTASH_REDIS_REST_TOKEN;
 const fetcher=options.fetch??globalThis.fetch;
 const scoped=deadline=>({configured:!!(url&&token),withDeadline:next=>scoped(Math.min(deadline,next)),async command(...cmd){
  if(!url||!token)throw new ApiError(503,'not-configured');
  const remaining=Math.min(options.timeoutMs??4000,deadline-performance.now());if(remaining<=0)throw timeoutError();
  const control=new AbortController();let timer;
  const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{control.abort();reject(timeoutError());},remaining);});
  const work=async()=>{const response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(cmd),signal:control.signal});if(!response.ok)throw Error();const data=await response.json();if(data.error||!Object.hasOwn(data,'result'))throw Error();return data.result;};
  try{return await Promise.race([work(),expired]);}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(control.signal.aborted||e?.name==='AbortError'?504:503,control.signal.aborted||e?.name==='AbortError'?'upstream-timeout':'unavailable');}finally{clearTimeout(timer);}
 }});
 return scoped(Infinity);
}
export async function authenticate(req,store){
 const id=header(req,'x-sync-account').toLowerCase(),key=header(req,'authorization').replace(/^Bearer /,'');
 if(!UUID.test(id)||! /^[A-Za-z0-9_-]{43}$/.test(key))throw new ApiError(401,'unauthorized');
 const raw=await store.command('GET',accountKey(id));let account;try{account=JSON.parse(raw);}catch{}
 const digest=sha(key);if(!account||typeof account.auth!=='string'||account.auth.length!==64||!timingSafeEqual(Buffer.from(account.auth),Buffer.from(digest)))throw new ApiError(401,'unauthorized');
 return{id,account,raw};
}
export async function rateLimit(store,key,seconds=3){if(!await store.command('SET','taipei-gp:lantern:rate:'+key,'1','NX','EX',seconds))throw new ApiError(429,'slow-down');}
export function failReply(res,e){if(e instanceof ApiError){if(e.status===429)res.setHeader('Retry-After','3');return apiReply(res,e.status,{error:e.message,...e.detail});}return apiReply(res,503,{error:'unavailable'});}
export const CLOUD_WRITE=`-- lantern-cloud-write-v1
local raw=redis.call('GET',KEYS[1]);if not raw then return {'missing'} end
local value=cjson.decode(raw);if value.auth~=ARGV[1] then return {'auth'} end
local receipt=redis.call('GET',KEYS[2]);if receipt then local r=cjson.decode(receipt);if r.fingerprint~=ARGV[4] then return {'idempotency'} end return {'ok',r.revision,r.updatedAt} end
if value.revision~=tonumber(ARGV[2]) then return {'conflict',value.revision} end
local next=cjson.decode(ARGV[5]);if next.auth~=value.auth or next.revision~=value.revision+1 then return {'conflict',value.revision} end
redis.call('SET',KEYS[1],ARGV[5]);redis.call('SET',KEYS[2],cjson.encode({fingerprint=ARGV[4],revision=next.revision,updatedAt=next.updatedAt}),'EX',86400);return {'ok',next.revision,next.updatedAt}`;
export const CLOUD_DELETE=`-- lantern-cloud-delete-v1
local raw=redis.call('GET',KEYS[1]);if not raw then return {'missing'} end
local value=cjson.decode(raw);if value.auth~=ARGV[1] then return {'auth'} end
if value.revision~=tonumber(ARGV[2]) then return {'conflict',value.revision} end
redis.call('DEL',KEYS[1]);return {'ok'}`;
export const CUP_WRITE=`-- lantern-cup-write-v1
local receipt=redis.call('GET',KEYS[2]);if receipt then local r=cjson.decode(receipt);if r.fingerprint~=ARGV[2] then return {'idempotency'} end return {'ok',r.revision} end
local raw=redis.call('GET',KEYS[1]);if raw~=ARGV[1] then return {'conflict'} end
if ARGV[4]~='' and redis.call('GET',KEYS[3])~=ARGV[4] then return {'attempt'} end
local value=cjson.decode(ARGV[3]);redis.call('SET',KEYS[1],ARGV[3],'EX',7776000)
if ARGV[4]~='' then redis.call('DEL',KEYS[3]) end
redis.call('SET',KEYS[2],cjson.encode({fingerprint=ARGV[2],revision=value.revision}),'EX',86400);return {'ok',value.revision}`;
