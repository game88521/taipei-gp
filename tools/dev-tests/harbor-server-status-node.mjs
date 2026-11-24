// Rex <game88521@gmail.com>. Request-handler unit check; no listen(), HTTP traffic or live service.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createMultiplayerServer} from '../../server/index.mjs';
const report={status:'FAIL',localOnly:true,externalRequests:0,socketsOpened:0,requestHandlerUnitTest:true,cases:[]};
async function test(name,fn){try{await fn();report.cases.push({name,status:'PASS'});}catch(error){report.cases.push({name,status:'FAIL',error:String(error.stack)});}console.log(JSON.stringify(report.cases.at(-1)));}
const previous={MERIDIAN_CHECKPOINT_SECRET:process.env.MERIDIAN_CHECKPOINT_SECRET,SERIES_RESUME_SECRET:process.env.SERIES_RESUME_SECRET};
delete process.env.MERIDIAN_CHECKPOINT_SECRET;delete process.env.SERIES_RESUME_SECRET;
try{
 for(const configured of[false,true])await test((configured?'固定':'暫存')+'簽章狀態取自真服務，健康回應不包含金鑰',async()=>{
  const meridian=randomBytes(32).toString('hex'),series=randomBytes(32).toString('hex');
  const app=createMultiplayerServer({autoTick:false,prewarmCityRace:false,allowedOrigins:['http://127.0.0.1:4317'],...(configured?{meridianCheckpointKey:meridian,roomOptions:{seriesResumeSecret:series}}:{})});
  try{
   let status,raw;const headers={};
   app.httpServer.emit('request',{method:'GET',url:'/health'},{setHeader(k,v){headers[k]=v;},writeHead(code,h){status=code;Object.assign(headers,h);},end(value){raw=value;}});
   assert.equal(status,200);assert.equal(headers['Cache-Control'],'no-store');assert.ok(!raw.includes(meridian)&&!raw.includes(series));
   const body=JSON.parse(raw);assert.deepEqual(body.continuation,{stationOnly:true,liveRacePersistence:false,meridianPersistentSigning:configured,seriesPersistentSigning:configured});
   assert.equal(body.meridian.persistentSigning,configured);assert.equal(body.capacity.rallyRooms,app.rallyService.maxRooms);assert.equal(body.rooms,0);assert.equal(body.totalConnections,0);
  }finally{await app.close();assert.equal(app.httpServer.listening,false);}
 });
}finally{for(const[key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=report.summary.FAIL?'FAIL':'PASS';await writeFile(new URL('harbor-server-status-node-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary}));if(report.summary.FAIL)process.exitCode=1;
