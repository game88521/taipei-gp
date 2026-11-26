import {randomUUID,randomBytes} from 'node:crypto';
import {parseAtlasBackup} from '../src/atlas-backup.ts';
import {UUID} from '../shared/lap-proof.js';
import {createStore,requestStore,ApiError,apiReply,failReply,bodyOf,authenticate,accountKey,sha,header,rateLimit,CLOUD_WRITE,CLOUD_DELETE} from '../server/lantern-persistence.mjs';
export function createCloudHandler(options={}){
 const backend=options.store??createStore(options),now=options.now??Date.now;
 return async(req,res)=>{const store=requestStore(backend,options.requestTimeoutMs);try{
  if(!['GET','POST','PUT','DELETE'].includes(req.method)){res.setHeader('Allow','GET, POST, PUT, DELETE');throw new ApiError(405,'method');}
  if(!store.configured)throw new ApiError(503,'not-configured');
  if(req.method==='POST'){
   const b=bodyOf(req,1024);if(b.action!=='create')throw new ApiError(400,'action');
   const ip=sha(header(req,'x-forwarded-for').split(',')[0].trim()||req.socket?.remoteAddress||'unknown');await rateLimit(store,'create:'+ip,60);
   const id=randomUUID(),key=randomBytes(32).toString('base64url'),at=new Date(now()).toISOString(),account={auth:sha(key),revision:0,updatedAt:at,backup:null,operationId:null,fingerprint:null};
   if(!await store.command('SET',accountKey(id),JSON.stringify(account),'NX'))throw new ApiError(503,'unavailable');
   return apiReply(res,201,{accountId:id,recoveryKey:key,revision:0,updatedAt:at});
  }
  const {id,account}=await authenticate(req,store);
  if(req.method==='GET')return apiReply(res,200,{revision:account.revision,updatedAt:account.updatedAt,backup:account.backup});
  const b=bodyOf(req);if(!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0)throw new ApiError(400,'revision');
  if(req.method==='DELETE'){
   const r=await store.command('EVAL',CLOUD_DELETE,1,accountKey(id),account.auth,b.expectedRevision);
   if(r[0]==='conflict')throw new ApiError(409,'revision-conflict',{revision:Number(r[1])});if(r[0]!=='ok')throw new ApiError(401,'unauthorized');return apiReply(res,200,{deleted:true});
  }
  if(typeof b.operationId!=='string'||!UUID.test(b.operationId))throw new ApiError(400,'operation');
  let backup;try{backup=parseAtlasBackup(JSON.stringify(b.backup));}catch{throw new ApiError(400,'backup');}
  const fingerprint=sha(JSON.stringify({expectedRevision:b.expectedRevision,backup}));
  // A receipt retry may bypass the write frequency guard, but cannot change its payload.
  const receiptKey=accountKey(id)+':receipt:'+b.operationId;
  if(account.operationId!==b.operationId&&!await store.command('GET',receiptKey))await rateLimit(store,'upload:'+id,3);
  const next={auth:account.auth,revision:b.expectedRevision+1,backup,updatedAt:new Date(now()).toISOString(),operationId:b.operationId,fingerprint};
  const r=await store.command('EVAL',CLOUD_WRITE,2,accountKey(id),receiptKey,account.auth,b.expectedRevision,b.operationId,fingerprint,JSON.stringify(next));
  if(r[0]==='conflict')throw new ApiError(409,'revision-conflict',{revision:Number(r[1])});if(r[0]==='idempotency')throw new ApiError(409,'idempotency-conflict');if(r[0]!=='ok')throw new ApiError(401,'unauthorized');return apiReply(res,200,{revision:Number(r[1]),updatedAt:r[2]});
 }catch(e){return failReply(res,e);}};
}
export default createCloudHandler();
