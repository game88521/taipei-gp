// Rex <game88521@gmail.com>. Explicit result fixture; old-message control is preserved as FAIL evidence.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FRONTIER_CUP_VERSION,cupActiveIds} from '../../shared/frontier-cup.ts';
import {PROTOCOL_VERSION,PHYSICS_VERSION,CATALOG_STAMP} from '../../shared/multiplayer-protocol.ts';
import {RoomService} from '../../server/room-service.mjs';
class Socket extends EventEmitter{readyState=1;bufferedAmount=0;messages=[];send(raw){this.messages.push(JSON.parse(raw));}close(){this.readyState=3;this.emit('close');}}
const hashes={};for(const file of['server/frontier-cup-service.mjs','server/room-service.mjs','src/multiplayer-client.ts','shared/frontier-cup.ts','shared/multiplayer-protocol.ts'])hashes[file]=createHash('sha256').update(await readFile(new URL('../../'+file,import.meta.url))).digest('hex');
const identity={version:PROTOCOL_VERSION,physics:PHYSICS_VERSION,catalogStamp:CATALOG_STAMP,clientCapabilities:{roomRules:true,frontierCup:FRONTIER_CUP_VERSION}};
let now=1000000;const service=new RoomService({now:()=>now}),clients=[],report={status:'FAIL',localOnly:true,externalRequests:0,explicitFinishFixture:true,sourceHashes:hashes,cases:[]};
try{
 for(let i=0;i<4;i++){const c=service.accept(new Socket());clients.push(c);service.receive(c,i===0?{type:'create',name:'準備測試'+i,laps:1,...identity}:{type:'join',code:clients[0].room.code,name:'準備測試'+i,...identity});}
 const room=clients[0].room,intent=()=>({roomCode:room.code,cupId:room.cup?.id??null,expectedCupRevision:room.cup?.revision??0,expectedLobbyRevision:room.lobbyRevision,matchId:room.matchId,trackRevision:room.trackRevision});
 for(const c of clients)service.receive(c,{type:'track-loaded',trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});
 service.receive(clients[0],{type:'cup-configure',...intent()});
 const oldReady={type:'ready',ready:true,trackRevision:room.trackRevision,trackStamp:room.trackStamp,cupReady:{cupId:room.cup.id,cupRevision:room.cup.revision,lobbyRevision:room.lobbyRevision}};
 for(const c of clients)service.receive(c,oldReady);
 service.receive(clients[0],{type:'cup-start',...intent()});assert.equal(room.phase,'countdown');now=room.startAt;service.tick(now);
 for(const[i,id]of cupActiveIds(room.cup).entries()){const p=room.players.get(id);p.finishMs=30000+i*1000;}
 service.maybeFinish(room,now);service.receive(clients[0],{type:'cup-next',...intent()});assert.equal(room.phase,'lobby');assert.equal(room.cup.index,1);
 const target=clients[1].player,before=target.ready;service.receive(clients[1],oldReady);const after=target.ready;
 report.cases.push({name:'準決賽A的舊ready不得讓準決賽B原席自動準備',status:after?'FAIL':'PASS',expected:false,actual:after,before,roundIndex:room.cup.index,oldReady});report.status=after?'FAIL':'PASS';report.bugReproduced=after;
}finally{service.close();report.cleanupComplete=service.rooms.size===0&&service.clients.size===0;}
const dir=new URL(`./frontier-cup-ready-control-evidence-${Date.now()}/`,import.meta.url);await mkdir(dir);await writeFile(new URL('result.json',dir),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:dir.pathname}));if(report.status==='FAIL')process.exitCode=1;
