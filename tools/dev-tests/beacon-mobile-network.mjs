// Rex <game88521@gmail.com>. CDP worker-request completion requires explicit execution evidence.
export const beaconWorkerProbeSource=origin=>`if(location.origin===${JSON.stringify(origin)}){(()=>{const Native=window.Worker;window.__beaconWorkerAudit=[];window.Worker=class extends Native{constructor(...args){super(...args);const record={url:new URL(String(args[0]),location.href).href,tileResults:0,tileErrors:[],errors:[]};__beaconWorkerAudit.push(record);this.addEventListener('message',e=>{if(typeof e.data?.id==='number'){if(e.data.out)record.tileResults++;if(e.data.error)record.tileErrors.push(String(e.data.error));}});this.addEventListener('error',e=>record.errors.push(String(e.message||'worker error')));}};})();}`;

export function auditBeaconCityNetwork(page,browser,context,report,origin){
 const pending=new Map(),paused=new Map(),continued=new Map();
 report.networkCompletionAlternatives=[];report.workerErrors=[];
 page.on('Network.requestWillBeSent',e=>{if(/^https?:/.test(e.request.url))pending.set(e.requestId,{id:e.requestId,url:e.request.url,type:e.type,initiator:e.initiator?.type});});
 page.on('Network.responseReceived',e=>{const r=pending.get(e.requestId);if(r)r.response={status:e.response.status,fromDiskCache:e.response.fromDiskCache??false,fromServiceWorker:e.response.fromServiceWorker??false};});
 page.on('Network.loadingFinished',e=>pending.delete(e.requestId));
 page.on('Network.loadingFailed',e=>{const r=pending.get(e.requestId);pending.delete(e.requestId);report.loadingFailures.push({id:e.requestId,url:r?.url,errorText:e.errorText,canceled:e.canceled??false});});
 page.on('Fetch.requestPaused',async({requestId,networkId,request})=>{paused.set(requestId,{url:request.url,networkId});try{const u=new URL(request.url),allowed=u.origin===origin||['about:','data:','blob:'].includes(u.protocol);if(!allowed)report.externalRequests.push(request.url);await page.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...allowed?{}:{errorReason:'BlockedByClient'}});if(allowed&&networkId)continued.set(networkId,request.url);}finally{paused.delete(requestId);}});
 const snapshot=()=>({pending:[...pending.values()],paused:[...paused.values()]});
 async function proveExecutedWorkers(){
  const candidates=[...pending.values()].filter(r=>r.type==='Script'&&new URL(r.url).origin===origin&&/^\/assets\/tileworker-[^/]+\.js$/.test(new URL(r.url).pathname));
  if(!candidates.length)return;
  const state=await page.evaluate(`({stream:{loaded:__gp.stream.loaded,pending:__gp.stream.pending},workers:window.__beaconWorkerAudit??[],resources:performance.getEntriesByType('resource').map(e=>({name:e.name,responseEnd:e.responseEnd,duration:e.duration,transferSize:e.transferSize}))})`);
  const errors=state.workers.flatMap(w=>[...w.errors,...w.tileErrors].map(error=>({url:w.url,error})));if(errors.length){report.workerErrors.push(...errors);throw Error('City worker reported an error');}
  if(state.stream.pending||!state.stream.loaded)return;
  const targets=(await browser.send('Target.getTargets')).targetInfos.filter(t=>t.browserContextId===context&&t.type==='worker');
  for(const url of new Set(candidates.map(r=>r.url))){
   const requests=candidates.filter(r=>r.url===url),workers=state.workers.filter(w=>w.url===url),resources=state.resources.filter(r=>r.name===url);
   if(workers.length!==requests.length||workers.some(w=>w.tileResults<1)||resources.length<requests.length||resources.some(r=>!Number.isFinite(r.responseEnd)||r.responseEnd<=0)||!requests.every(r=>continued.get(r.id)===url&&targets.some(t=>t.targetId===r.id)))continue;
   // Chrome emits these worker Script ids as Target ids without page loadingFinished.
   // Record alternate completion only after every native Worker returned a real tile,
   // its request was continued, resource timing completed, and its exact target exists.
   report.networkCompletionAlternatives.push({kind:'worker-script-executed',requests,workers,resources,targetIds:targets.map(t=>t.targetId),stream:state.stream});
   for(const request of requests)pending.delete(request.id);
   console.log(JSON.stringify({phase:'worker-script-execution-proved',url,workers:workers.length,tileResults:workers.map(w=>w.tileResults)}));
  }
 }
 async function quiet(label='network-quiet'){
  await page.until('!!window.__gp?.stream&&__gp.stream.pending===0',180000);
  const deadline=Date.now()+90000;let since=Date.now(),nextLog=Date.now()+10000;
  while(Date.now()-since<400){
   await proveExecutedWorkers();
   const streamQuiet=await page.evaluate('!!window.__gp?.stream&&__gp.stream.pending===0');
   if(pending.size||paused.size||!streamQuiet)since=Date.now();
   if(Date.now()>=nextLog){console.log(JSON.stringify({phase:label,...snapshot(),streamQuiet}));nextLog=Date.now()+10000;}
   if(Date.now()>deadline){report.networkPendingAtFailure=snapshot();throw Error('Network did not settle within 90 seconds: '+JSON.stringify(snapshot()));}
   await new Promise(r=>setTimeout(r,80));
  }
 }
 return{quiet,snapshot};
}
