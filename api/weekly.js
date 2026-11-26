import {randomBytes} from 'node:crypto';
import {manifestFor,validateLapProof,UUID} from '../shared/lap-proof.js';
import catalog from '../shared/multiplayer-catalog.json' with {type:'json'};
import {CUP_CODE,utcWeek,weeklyTrackIds,weeklyStandings,LANTERN_WEEKLY_VERSION} from '../shared/lantern-weekly.ts';
import {createStore,requestStore,ApiError,apiReply,failReply,bodyOf,authenticate,sha,rateLimit,CUP_WRITE} from '../server/lantern-persistence.mjs';
const clean=s=>typeof s==='string'?s.replace(/[\u0000-\u001f<>"'`\\]/g,'').trim().slice(0,24):'';
const key=code=>'taipei-gp:lantern:cup:'+code;
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code=()=>Array.from(randomBytes(8),b=>alphabet[b%32]).join('');
export function createWeeklyHandler(options={}){
 const backend=options.store??createStore(options),now=options.now??Date.now;
 const read=async (store,code)=>{const raw=await store.command('GET',key(code));if(!raw)throw new ApiError(404,'cup-not-found');let cup;try{cup=JSON.parse(raw);}catch{throw new ApiError(503,'unavailable');}return{raw,cup};};
 const reply=cup=>({version:LANTERN_WEEKLY_VERSION,serverTime:now(),closed:now()>=cup.endAt,cup,standings:weeklyStandings(cup),validation:'trajectory-plausibility'});
 const active=cup=>{if(now()<cup.startAt||now()>=cup.endAt)throw new ApiError(410,'cup-closed');};
 return async(req,res)=>{const store=requestStore(backend,options.requestTimeoutMs);try{
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');throw new ApiError(405,'method');}if(!store.configured)throw new ApiError(503,'not-configured');
  if(req.method==='GET'){const c=req.query?.cup;if(typeof c!=='string'||!CUP_CODE.test(c))throw new ApiError(400,'cup');const {cup}=await read(store,c);return apiReply(res,200,reply(cup));}
  const b=bodyOf(req,800000),{id}=await authenticate(req,store);
  if(!['create','join','start','submit'].includes(b.action))throw new ApiError(400,'action');
  if(b.action==='create'){
   const name=clean(b.name);if(!name)throw new ApiError(400,'name');await rateLimit(store,'cup-create:'+id,30);
   const week=utcWeek(now()),ids=weeklyTrackIds(catalog.tracks.map(t=>t.id),week.startAt),tracks=ids.map(id=>({id,name:catalog.tracks.find(t=>t.id===id).name,stamp:manifestFor(id).stamp}));
   for(let i=0;i<3;i++){const cup={v:1,code:code(),name,createdAt:now(),...week,rules:'classic',tracks,members:[{id,name:clean(b.driverName)||'車手',joinedAt:now(),scores:{}}],revision:1};if(await store.command('SET',key(cup.code),JSON.stringify(cup),'NX','EX',7776000))return apiReply(res,201,reply(cup));}throw new ApiError(503,'unavailable');
  }
  if(typeof b.cup!=='string'||!CUP_CODE.test(b.cup))throw new ApiError(400,'cup');
  const receiptKey=key(b.cup)+':receipt:'+id+':'+b.operationId;
  if(b.action==='submit'&&(!UUID.test(b.operationId??'')||typeof b.attempt!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(b.attempt)))throw new ApiError(400,'operation');
  if(b.action==='submit'&&await store.command('GET',receiptKey)){
   const r=JSON.parse(await store.command('GET',receiptKey));if(r.fingerprint!==sha(JSON.stringify(b)))throw new ApiError(409,'idempotency-conflict');return apiReply(res,200,reply((await read(store,b.cup)).cup));
  }
  for(let tries=0;tries<3;tries++){
   const {raw,cup}=await read(store,b.cup);active(cup);const member=cup.members.find(m=>m.id===id);
   let usedAttempt='',usedAttemptKey=key(b.cup)+':unused';
   if(b.action==='join'){
    if(member)return apiReply(res,200,reply(cup));if(cup.members.length>=16)throw new ApiError(409,'cup-full');const name=clean(b.name);if(!name)throw new ApiError(400,'name');cup.members.push({id,name,joinedAt:now(),scores:{}});
   }else{
    if(!member)throw new ApiError(403,'not-member');const stage=cup.tracks.find(t=>t.id===b.track);if(!stage)throw new ApiError(400,'track');if(manifestFor(stage.id)?.stamp!==stage.stamp)throw new ApiError(409,'track-version-changed');
    if(b.action==='start'){
     await rateLimit(store,'cup-start:'+id,3);const attempt=randomBytes(32).toString('base64url'),attemptState={id,cup:b.cup,track:b.track,createdAt:now(),expiresAt:Math.min(now()+3600000,cup.endAt)};
     await store.command('SET','taipei-gp:lantern:attempt:'+sha(attempt),JSON.stringify(attemptState),'EX',3600);return apiReply(res,201,{attempt,expiresAt:attemptState.expiresAt,serverTime:now(),rules:'classic',track:stage.id,stamp:stage.stamp});
    }
    const aRaw=await store.command('GET','taipei-gp:lantern:attempt:'+sha(b.attempt));let attempt;try{attempt=JSON.parse(aRaw);}catch{}
    if(!attempt||attempt.id!==id||attempt.cup!==b.cup||attempt.track!==b.track||now()>=attempt.expiresAt||now()-attempt.createdAt+500<b.time*1000)throw new ApiError(400,'attempt');
    if(typeof b.time!=='number'||b.time<10||b.time>1200||!validateLapProof(b.proof,b.time,'classic',b.track).ok)throw new ApiError(400,'proof');
    usedAttempt=aRaw;usedAttemptKey='taipei-gp:lantern:attempt:'+sha(b.attempt);
    member.scores[b.track]=Math.min(member.scores[b.track]??Infinity,Math.round(b.time*1000)/1000);
   }
   cup.revision++;
   const op=b.action==='submit'?b.operationId:'join-'+id,receipt=b.action==='submit'?receiptKey:key(b.cup)+':receipt:'+op,fingerprint=sha(JSON.stringify(b));
   const r=await store.command('EVAL',CUP_WRITE,3,key(b.cup),receipt,usedAttemptKey,raw,fingerprint,JSON.stringify(cup),usedAttempt);
   if(r[0]==='idempotency')throw new ApiError(409,'idempotency-conflict');if(r[0]==='attempt')throw new ApiError(400,'attempt');if(r[0]==='conflict')continue;
   return apiReply(res,200,reply((await read(store,b.cup)).cup));
  }
  throw new ApiError(409,'cup-changed');
 }catch(e){return failReply(res,e);}};
}
export default createWeeklyHandler();
