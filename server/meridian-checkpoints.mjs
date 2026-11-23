// Rex <game88521@gmail.com>. HMAC-authenticated station summaries; never accepts a live car or session token.
import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {MERIDIAN_CHECKPOINT_VERSION,MERIDIAN_CHECKPOINT_TTL,MERIDIAN_CHECKPOINT_MAX_TICKET,MERIDIAN_CHECKPOINT_KINDS,parseCheckpointPayload,checkpointStateSafe} from '../shared/meridian-checkpoints.ts';
const id=()=>randomBytes(12).toString('hex'),hash=value=>createHash('sha256').update(value).digest('hex'),fail=message=>{throw Object.assign(Error(message),{code:'CHECKPOINT_REJECTED'});};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export class MeridianCheckpoints{
 constructor(o={}){if(o.key!==undefined&&!/^[a-f0-9]{64}$/.test(o.key))throw Error('MERIDIAN_CHECKPOINT_SECRET must contain exactly 64 lowercase hex characters');this.key=Buffer.from(o.key??randomBytes(32).toString('hex'),'hex');this.persistentSigning=!!o.key;this.version=MERIDIAN_CHECKPOINT_VERSION;this.now=o.now??Date.now;this.ttlMs=o.ttlMs??MERIDIAN_CHECKPOINT_TTL;if(!Number.isSafeInteger(this.ttlMs)||this.ttlMs<1000||this.ttlMs>MERIDIAN_CHECKPOINT_TTL)throw Error('Checkpoint expiry is invalid');this.live=new Map();this.latest=new Map();}
 seal({kind,state,seats,previous}){
  if(!MERIDIAN_CHECKPOINT_KINDS.includes(kind)||!checkpointStateSafe(state)||!Array.isArray(seats)||seats.length<2||seats.length>4||new Set(seats.map(p=>p.ref)).size!==seats.length||seats.some(p=>typeof p.ref!=='string'||!p.ref||p.ref.length>100))fail('站間摘要或原席名單無效');
  this.sweep();if(this.latest.size>=1024&&!previous)fail('站間摘要容量已滿');
  if(previous&&(!/^[a-f0-9]{24}$/.test(previous.lineage)||!Number.isSafeInteger(previous.generation)||previous.generation<1||previous.generation>=10000||this.latest.get(kind+':'+previous.lineage)?.generation>previous.generation))fail('續局世代無效');
  const issuedAt=this.now(),lineage=previous?.lineage??id(),generation=previous?previous.generation+1:1,privateSeats=seats.map(p=>({...p,seatId:id(),secret:randomBytes(32).toString('hex')}));
  const payload=parseCheckpointPayload({v:this.version,kind,id:id(),lineage,generation,issuedAt,expiresAt:issuedAt+this.ttlMs,state:structuredClone(state),roster:privateSeats.map(p=>({seatId:p.seatId,slot:p.slot,name:p.name,proofHash:hash(p.secret)}))});if(!payload)fail('站間摘要欄位無效');
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url'),ticket='MC1.'+body+'.'+createHmac('sha256',this.key).update('MC1.'+body).digest('hex');if(ticket.length>MERIDIAN_CHECKPOINT_MAX_TICKET)fail('站間摘要超過64KiB');
  this.latest.set(kind+':'+lineage,{generation,expiresAt:payload.expiresAt});return{ticket,id:payload.id,lineage,generation,expiresAt:payload.expiresAt,seats:privateSeats.map(({ref,seatId,secret})=>({ref,seatId,secret}))};
 }
 verify(ticket,kind){
  if(typeof ticket!=='string'||ticket.length>MERIDIAN_CHECKPOINT_MAX_TICKET)fail('續局碼格式無效');const parts=ticket.split('.');if(parts.length!==3||parts[0]!=='MC1'||!/^[A-Za-z0-9_-]+$/.test(parts[1])||!same(parts[2],createHmac('sha256',this.key).update('MC1.'+parts[1]).digest('hex')))fail('續局簽章不符，可能被修改或服務簽章金鑰已更換');
  let raw;try{const bytes=Buffer.from(parts[1],'base64url');if(bytes.toString('base64url')!==parts[1])fail('續局編碼無效');raw=JSON.parse(bytes.toString('utf8'));}catch{fail('續局摘要無法解碼');}const payload=parseCheckpointPayload(raw),now=this.now();if(!payload||kind&&payload.kind!==kind||now<payload.issuedAt-60000||now>=payload.expiresAt)fail('續局已到期、類型不符或摘要無效');
  const key=payload.kind+':'+payload.lineage,latest=this.latest.get(key);if(latest&&payload.generation<latest.generation)fail('已有較新的站間續局，不能回退到舊世代');if(!latest||latest.generation<payload.generation)this.latest.set(key,{generation:payload.generation,expiresAt:payload.expiresAt});this.sweep();return payload;
 }
 prove(ticket,seatId,secret,kind){const payload=this.verify(ticket,kind),seat=payload.roster.find(p=>p.seatId===seatId);if(!seat||typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret)||!same(seat.proofHash,hash(secret)))fail('這個瀏覽器沒有該原席的私密恢復證明');return{payload,seat};}
 active(kind,checkpointId,create){this.sweep();const key=kind+':'+checkpointId,old=this.live.get(key);if(old)return old.handle;if(this.live.size>=64)fail('站間恢復房已滿');const handle=create();this.live.set(key,{handle});return handle;}
 forget(kind,checkpointId,handle){const key=kind+':'+checkpointId;if(this.live.get(key)?.handle===handle)this.live.delete(key);}
 sweep(){const now=this.now();for(const [key,value]of this.latest)if(value.expiresAt<=now)this.latest.delete(key);}
}
