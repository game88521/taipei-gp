// Stateful local Redis REST stand-in. Models listed commands, NOT a real Redis/Lua engine.
import {createServer} from 'node:http';
import {createCloudHandler} from '../../api/cloud.js';
import {createWeeklyHandler} from '../../api/weekly.js';
import {createLeaderboardHandler} from '../../api/leaderboard.js';
export async function startLanternApi({timeoutMs=250,requestTimeoutMs,clock={value:Date.UTC(2026,10,26,4)},port=0}={}){
 const values=new Map(),expires=new Map(),trace=[],requests=[];let mode='normal',delay=0;
 const get=k=>{if((expires.get(k)??Infinity)<=clock.value){values.delete(k);expires.delete(k);}return values.get(k)??null;};
 const put=(k,v,seconds)=>{values.set(k,v);if(seconds)expires.set(k,clock.value+seconds*1000);else expires.delete(k);};
 const sorted=k=>[...(get(k)??new Map())].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0]));
 function command(c){const[op,k,...args]=c;trace.push(op);
  if(op==='GET')return get(k);if(op==='DEL'){values.delete(k);expires.delete(k);return 1;}
  if(op==='SET'){if(args.includes('NX')&&get(k)!==null)return null;const ex=args.indexOf('EX');put(k,args[0],ex<0?null:Number(args[ex+1]));return'OK';}
  if(op==='ZRANGE')return sorted(k).slice(Number(args[0]),Number(args[1])+1).flatMap(([id,t])=>[id,String(t)]);
  if(op==='HMGET')return args.map(id=>get(k)?.get(id)??null);if(op==='ZRANK'){const i=sorted(k).findIndex(([id])=>id===args[0]);return i<0?null:i;}if(op==='ZSCORE')return get(k)?.get(args[0])??null;
  if(op!=='EVAL')throw Error('unmodelled command '+op);
  const count=c[2],keys=c.slice(3,3+count),a=c.slice(3+count);
  if(k.startsWith('-- lantern-cloud-write')){const old=get(keys[0]);if(!old)return['missing'];const v=JSON.parse(old);if(v.auth!==a[0])return['auth'];const prior=get(keys[1]);if(prior){const p=JSON.parse(prior);return p.fingerprint===a[3]?['ok',p.revision,p.updatedAt]:['idempotency'];}if(v.revision!==Number(a[1]))return['conflict',v.revision];const next={...JSON.parse(a[4]),auth:v.auth,revision:v.revision+1};put(keys[0],JSON.stringify(next));put(keys[1],JSON.stringify({fingerprint:a[3],revision:next.revision,updatedAt:next.updatedAt}),86400);return['ok',next.revision,next.updatedAt];}
  if(k.startsWith('-- lantern-cloud-delete')){const old=get(keys[0]);if(!old)return['missing'];const v=JSON.parse(old);if(v.auth!==a[0])return['auth'];if(v.revision!==Number(a[1]))return['conflict',v.revision];values.delete(keys[0]);return['ok'];}
  if(k.startsWith('-- lantern-cup-write')){const receipt=get(keys[1]);if(receipt){const v=JSON.parse(receipt);return v.fingerprint===a[1]?['ok',v.revision]:['idempotency'];}if(get(keys[0])!==a[0])return['conflict'];if(a[3]&&get(keys[2])!==a[3])return['attempt'];const v=JSON.parse(a[2]);put(keys[0],a[2],7776000);if(a[3])values.delete(keys[2]);put(keys[1],JSON.stringify({fingerprint:a[1],revision:v.revision}),86400);return['ok',v.revision];}
  // Existing leaderboard EVAL, same branch order and receipt/rate semantics.
  const[scoreKey,namesKey,receiptKey,rateKey]=keys,[id,name,time,fingerprint]=a,receipt=get(receiptKey);if(receipt){const r=JSON.parse(receipt);return r.fingerprint===fingerprint?[0,r.rank]:[2,0];}if(get(rateKey))return[3,0];put(rateKey,'1',10);const scores=get(scoreKey)??new Map();scores.set(id,Math.min(scores.get(id)??Infinity,Number(time)));put(scoreKey,scores);const names=get(namesKey)??new Map();names.set(id,name);put(namesKey,names);const rank=sorted(scoreKey).findIndex(([p])=>p===id)+1;put(receiptKey,JSON.stringify({fingerprint,rank}),86400);return[1,rank];
 }
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const upstream=createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;try{const c=JSON.parse(body);if(mode==='error')return json(res,200,{error:'LOCAL_SECRET_DO_NOT_EXPOSE'});if(mode==='html'){res.writeHead(500);res.end('<html>LOCAL_SECRET_DO_NOT_EXPOSE</html>');return;}const result=command(c),pause=mode==='commit-timeout'&&c[0]==='EVAL'?delay:mode==='slow'?delay:0;if(mode==='commit-timeout'&&c[0]==='EVAL')mode='normal';if(pause)await new Promise(r=>setTimeout(r,pause));if(!res.destroyed)json(res,200,{result});}catch{if(!res.destroyed)json(res,500,{error:'fixture-command'});}});
 await new Promise((r,j)=>{upstream.once('error',j);upstream.listen(0,'127.0.0.1',r);});
 const options={url:`http://127.0.0.1:${upstream.address().port}`,token:'local-fixture',now:()=>clock.value,timeoutMs,requestTimeoutMs};
 const handlers={'/api/cloud':createCloudHandler(options),'/api/weekly':createWeeklyHandler(options),'/api/leaderboard':createLeaderboardHandler(options)};
 const api=createServer(async(req,res)=>{let body='';for await(const b of req){body+=b;if(body.length>4_000_000){json(res,413,{error:'payload-too-large'});return;}}const u=new URL(req.url,'http://local');req.query=Object.fromEntries(u.searchParams);req.body=body;requests.push({path:u.pathname,method:req.method});res.status=function(s){this.statusCode=s;return this;};res.json=function(b){this.end(JSON.stringify(b));return this;};const h=handlers[u.pathname];if(h)await h(req,res);else json(res,404,{error:'not-found'});});
 await new Promise((r,j)=>{api.once('error',j);api.listen(port,'127.0.0.1',r);});
 return{origin:`http://127.0.0.1:${api.address().port}`,upstreamOrigin:options.url,clock,values,trace,requests,get,put,setMode(value,ms=0){mode=value;delay=ms;},async close(){api.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>api.close(r)),new Promise(r=>upstream.close(r))]);}};
}
