// Rex <game88521@gmail.com>. Real authoritative Car, all catalog maps, no network or time/result shortcuts.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {RoomService,TICK_MS} from '../../server/room-service.mjs';
import {PROTOCOL_VERSION,PHYSICS_VERSION,CATALOG_STAMP} from '../../shared/multiplayer-protocol.ts';
import {MULTIPLAYER_TRACKS} from '../../shared/multiplayer-tracks.ts';
import {ATLAS_AI_LEVELS} from '../../shared/atlas-racing.ts';
class Socket extends EventEmitter{readyState=1;bufferedAmount=0;send(){}close(){this.readyState=3;this.emit('close');}}
const paths=['server/atlas-racing-service.mjs','server/summit-racing-service.mjs','server/room-service.mjs','server/physics.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(new URL('../../'+p,import.meta.url))).digest('hex')])));
const report={status:'FAIL',startedAt:new Date().toISOString(),localOnly:true,externalRequests:0,realAuthoritativeCar:true,explicitFixtures:['single isolated AI; other roster seat marked DNF','dry track; 60Hz deterministic simulation clock'],sourceHashes:await hashes(),rows:[]};
const caps={roomRules:true,evolution:true,horizon:true,nexusArena:true,summit:true,atlasRacing:true,voyagerRacing:true,expeditionRacing:true};
for(const map of MULTIPLAYER_TRACKS)for(const level of ATLAS_AI_LEVELS){
 let now=1000000;const s=new RoomService({now:()=>now}),c=s.accept(new Socket());
 s.receive(c,{type:'create',version:PROTOCOL_VERSION,physics:PHYSICS_VERSION,catalogStamp:CATALOG_STAMP,clientCapabilities:caps,name:'Calibration',laps:1,trackId:map.id});
 const r=c.room,lobby=()=>({roomCode:r.code,expectedLobbyRevision:r.lobbyRevision});
 s.receive(c,{type:'set-atlas',...lobby(),settings:{aiLevel:level,damage:false,flags:false}});
 s.receive(c,{type:'set-summit',...lobby(),settings:{weekend:false,ai:1,endurance:0}});
 const bot=[...r.players.values()].find(p=>p.isAi);assert.ok(bot);s.markDnf(c.player,'left');
 r.phase='racing';r.matchId='calibration';r.startAt=now;r.simAt=now;
 let walls=0,lastTouch=false,maxLat=0,steps=0;
 while(bot.finishMs===null&&steps<36000){now=r.startAt+(++steps)*TICK_MS;r.simAt=now;s.simulate(r,now);if(bot.car.touch&&!lastTouch)walls++;lastTouch=bot.car.touch;maxLat=Math.max(maxLat,Math.abs(bot.car.pos.lat));}
 const row={trackId:map.id,level,completed:bot.finishMs!==null,lapMs:bot.finishMs===null?null:Math.round(bot.finishMs*1000)/1000,wallContacts:walls,maxLat:Math.round(maxLat*1000)/1000,gates:bot.completedLaps*3+bot.nextGate-1,steps};report.rows.push(row);console.log(JSON.stringify(row));s.close();
}
report.completedAt=new Date().toISOString();report.sourceUnchanged=JSON.stringify(report.sourceHashes)===JSON.stringify(await hashes());
report.summary={runs:report.rows.length,completed:report.rows.filter(r=>r.completed).length,wallContacts:report.rows.reduce((n,r)=>n+r.wallContacts,0),orderedMaps:MULTIPLAYER_TRACKS.filter(t=>{const rows=report.rows.filter(r=>r.trackId===t.id);return rows.every(r=>r.completed)&&rows[0].lapMs>rows[1].lapMs&&rows[1].lapMs>rows[2].lapMs;}).length};
report.limitations=['CPU量測不是四真人延遲、真機FPS或免費主機容量證明。單車全圖校準不代表真人競爭平衡。'];
report.status=report.sourceUnchanged&&report.summary.completed===72&&report.summary.wallContacts===0&&report.summary.orderedMaps===24?'PASS':'FAIL';
if(process.argv.includes('--write-reference')&&report.status==='PASS')await writeFile(new URL('../../shared/expedition-ai-calibration.json',import.meta.url),JSON.stringify({version:'expedition-ai-v1',physics:PHYSICS_VERSION,catalogStamp:CATALOG_STAMP,conditions:'dry-isolated-standing-start-60hz',tracks:Object.fromEntries(MULTIPLAYER_TRACKS.map(t=>[t.id,Object.fromEntries(report.rows.filter(r=>r.trackId===t.id).map(r=>[r.level,r.lapMs]))]))},null,2)+'\n');
await writeFile(new URL('expedition-ai-calibration-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary}));if(report.status!=='PASS')process.exitCode=1;
