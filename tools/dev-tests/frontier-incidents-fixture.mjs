// Rex <game88521@gmail.com>. Production GP authority over loopback WS; explicit contact-position and short-run DNF fixtures.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createMultiplayerServer} from '../../server/index.mjs';
import {PROTOCOL_VERSION,PHYSICS_VERSION,CATALOG_STAMP} from '../../shared/multiplayer-protocol.ts';
import {decodeMultiplayerReplay,REPLAY_CHUNK_CHARS} from '../../shared/nexus-replay.ts';
import {WireClient,ORIGIN,settle,drivingInput} from './multiplayer-test-helpers.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const identity={version:PROTOCOL_VERSION,physics:PHYSICS_VERSION,catalogStamp:CATALOG_STAMP,clientCapabilities:{roomRules:true,evolution:true,horizon:true,nexusArena:true,summit:true,atlasRacing:true,voyagerRacing:true,odysseyRacing:true,expeditionRacing:true}};
const STEP=1000/60;
const authority=(room)=>JSON.stringify([...room.players.values()].map(p=>({slot:p.slot,car:p.car.snapshot(),input:p.input,receivedSeq:p.receivedSeq,ackSeq:p.ackSeq,completedLaps:p.completedLaps,distance:p.distance,finishMs:p.finishMs,dnf:p.dnf,dnfReason:p.dnfReason,expedition:p.expedition??null,atlas:p.atlas??null,summit:p.summit??null})));

/** All schemas are produced independently by real production configuration, never by changing archive.schema. */
export async function generateIncidentReplayFixture({schema=2,outputDirectory,inspect}={}){
  assert.ok([2,3,4,5,6].includes(schema));
  let now=1_000_000;const app=createMultiplayerServer({autoTick:false,prewarmCityRace:false,allowedOrigins:[ORIGIN],now:()=>now}),wires=[],welcomes=[];
  await new Promise(resolve=>app.httpServer.listen(0,'127.0.0.1',resolve));
  const open=async()=>{const wire=await new WireClient(`ws://127.0.0.1:${app.httpServer.address().port}/ws`).open();wires.push(wire);return wire;};
  const send=async(wire,message,predicate=value=>!!value.room||value.type==='error')=>{await settle();const mark=wire.mark();wire.send(message);return wire.until(predicate,mark);};
  try{
    const a=await open();welcomes.push(await send(a,{...identity,type:'create',name:'琥珀車手',laps:3,trackId:'austria'},m=>['welcome','error'].includes(m.type)));assert.equal(welcomes[0].type,'welcome');
    const b=await open();welcomes.push(await send(b,{...identity,type:'join',name:'青藍車手',code:welcomes[0].room.code},m=>['welcome','error'].includes(m.type)));assert.equal(welcomes[1].type,'welcome');
    const room=app.service.rooms.get(welcomes[0].room.code),lobby=()=>({roomCode:room.code,expectedLobbyRevision:room.lobbyRevision}),selection=()=>({trackId:room.trackId,trackStamp:room.trackStamp,trackRevision:room.trackRevision});
    const configure=async(type,settings)=>{const response=await send(a,{type,...lobby(),settings});assert.notEqual(response.type,'error',JSON.stringify(response));};
    if(schema===3)await configure('set-atlas',{aiLevel:'standard',damage:true,flags:false});
    if(schema===4)await configure('set-voyager',{practiceSeconds:0,weather:'rain',vsc:false});
    if(schema===5){await configure('set-summit',{weekend:false,ai:0,endurance:480});await configure('set-odyssey',{sprintWeekend:false,mandatoryStop:true});}
    if(schema===6)await configure('set-expedition',{boundary:true,vsc:false});
    for(const wire of wires){assert.notEqual((await send(wire,{type:'track-loaded',...selection()})).type,'error');assert.notEqual((await send(wire,{type:'ready',ready:true,...selection()})).type,'error');}
    assert.equal((await send(a,{type:'start',trackRevision:room.trackRevision})).room?.phase,'countdown');now=room.startAt;app.service.tick(now);
    const players=welcomes.map(value=>room.players.get(value.playerId)),positionFixtures=[];
    for(let tick=1;tick<=720;tick++){
      now=room.startAt+tick*STEP;
      if(tick===241){const track=room.track;for(let i=0;i<players.length;i++){players[i].car.placeAt(track,100);players[i].car.v=i===0?30:0;}players[1].car.x+=.5;positionFixtures.push({kind:'close-overlap',at:now-room.startAt,trackIndex:100,speedsMps:[30,0],secondXOffsetM:.5});}
      if(tick===361){const car=players[0].car,track=room.track,index=car.pos.i;car.x-=track.tz[index]*30;car.z+=track.tx[index]*30;car.v=35;positionFixtures.push({kind:'outside-wall',at:now-room.startAt,slot:0,lateralOffsetM:30,speedMps:35});}
      if(tick===1||tick%6===0){for(let i=0;i<players.length;i++)wires[i].send({type:'input',matchId:room.matchId,trackRevision:room.trackRevision,seq:tick,...drivingInput(players[i].car,room.track)});await settle();}
      app.service.tick(now);assert.equal(room.phase,'racing','short run must remain racing until the explicit DNF close');
    }
    assert.ok(room.summitEvents.some(e=>e.type==='collision'&&Math.abs(e.at-4000)<100));assert.ok(room.summitEvents.some(e=>e.type==='wall'&&Math.abs(e.at-6000)<100));
    // Close the twelve-second recording through the real result path. This is not a completed human race.
    for(const player of room.players.values())app.service.markDnf(player,'race-timeout');assert.equal(app.service.maybeFinish(room,now),true);assert.equal(room.phase,'results');const rawEvents=structuredClone(room.summitEvents??[]);
    const descriptor=app.service.snapshot(room,now).replay;assert.equal(descriptor.ready,true);
    let text='',parts=0,total=0;do{const part=await send(a,{type:'replay-chunk',replayId:descriptor.id,offset:text.length},m=>['replay-part','error'].includes(m.type));assert.equal(part.type,'replay-part');assert.equal(part.offset,text.length);assert.ok(part.text.length<=REPLAY_CHUNK_CHARS);total=part.totalChars;text+=part.text;parts++;}while(text.length<total);
    assert.equal(text,room.replayRecording.text);const replay=decodeMultiplayerReplay(text);assert.equal(replay.schema,schema);
    for(const secret of[room.code,room.matchId,...welcomes.flatMap(value=>[value.playerId,value.resumeToken])])assert.equal(text.includes(secret),false,'private room or seat data must not enter the archive');
    const collisionIndex=replay.events.findIndex(e=>e.type==='collision'&&Math.abs(e.at-4000)<100),wallIndex=replay.events.findIndex(e=>e.type==='wall'&&Math.abs(e.at-6000)<100);assert.ok(collisionIndex>=0&&wallIndex>=0);
    const expectedEvents=rawEvents.filter(event=>event.at<=replay.recordedMs&&event.actors.every(id=>room.replayRecording.ids.includes(id))).map(event=>({...event,actors:event.actors.map(id=>`driver-${room.replayRecording.ids.indexOf(id)+1}`)}));assert.deepEqual(replay.events,expectedEvents,'raw authority event time/type/detail/actor order must map exactly to anonymous archive events');
    const before=authority(room),inspection=await inspect?.({replay,text,room,app,wires,send,collisionIndex,wallIndex}),authorityStable=authority(room)===before;assert.equal(authorityStable,true,'analysis must not change inputs, authoritative poses, scores or penalties');
    let fixturePath=null;if(outputDirectory){await mkdir(outputDirectory,{recursive:true});fixturePath=path.join(outputDirectory,`gp-schema${schema}.json`);await writeFile(fixturePath,text+'\n');}
    return{replay,text,collisionIndex,wallIndex,parts,fixturePath,authorityStable,inspection,provenance:{schema,source:'production RoomService + Car/resolveMultiplayerCollisions + summitContacts/summitEvent + observeReplay + replay-chunk',realLoopbackWebSocket:true,externalRequests:0,positionFixtures,closeFixture:'server markDnf after twelve seconds; no human completion claim',recordedMs:replay.recordedMs,frames:replay.frames.length,rawToAnonymousActorsMatched:true}};
  }finally{await Promise.all(wires.map(wire=>wire.close()));await app.close();assert.equal(app.httpServer.listening,false);assert.equal(app.service.clients.size,0);}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const outputDirectory=path.join(root,'tools/dev-tests',`frontier-incidents-service-evidence-${Date.now()}`),generated=[];
  for(const schema of[2,3,4,5,6]){const fixture=await generateIncidentReplayFixture({schema,outputDirectory});generated.push({path:fixture.fixturePath,collisionIndex:fixture.collisionIndex,wallIndex:fixture.wallIndex,...fixture.provenance});}
  await writeFile(path.join(outputDirectory,'provenance.json'),JSON.stringify(generated,null,2)+'\n');console.log(JSON.stringify({outputDirectory,generated}));
}
