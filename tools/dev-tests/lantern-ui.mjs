/** Rex <game88521@gmail.com>. Source geometry and real-state guidance; no server/browser. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {lanternTrackPreview} from '../../shared/lantern-ui-tracks.ts';
import {socialLanternRuleState,dutyLanternRuleState,racingLanternRuleState} from '../../shared/lantern-ui-rules.ts';
const root=new URL('../../',import.meta.url),catalog=JSON.parse(await readFile(new URL('shared/multiplayer-catalog.json',root),'utf8')),previews=JSON.parse(await readFile(new URL('shared/lantern-ui-track-previews.json',root),'utf8'));
assert.equal(previews.catalogStamp,catalog.catalogStamp);assert.equal(previews.tracks.length,24);
for(const row of catalog.tracks){const bytes=await readFile(new URL(row.source,root)),data=JSON.parse(bytes),stored=previews.tracks.find(p=>p.id===row.id),actual=lanternTrackPreview(data.points);assert.ok(stored);assert.equal(stored.sourceSha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(stored.path,actual.path);assert.deepEqual(stored.start,actual.start);assert.ok(stored.lengthKm>0);assert.ok(!/NaN|Infinity/.test(stored.path));assert.ok((stored.path.match(/L/g)??[]).length<=179);}
assert.equal(new Set(previews.tracks.map(p=>p.path)).size,24);
assert.throws(()=>lanternTrackPreview([[0,0],[1,NaN],[2,3]]));
const player={id:'self',slot:0,role:'driver',connected:true,outcome:'',ready:false};
const social={mode:'convoy',phase:'running',players:[player],convoy:{participants:[{slot:0,arrived:false}],leg:{target:{name:'河岸站'}}}};
const before=JSON.stringify(social);assert.match(socialLanternRuleState(social,'self','convoy').hint,/河岸站/);assert.equal(JSON.stringify(social),before);
social.convoy.participants[0].arrived=true;assert.match(socialLanternRuleState(social,'self','convoy').hint,/已到站/);
social.mode='crown';social.crown={members:[{slot:0,zone:'outside'}],holderSlot:0};assert.match(socialLanternRuleState(social,'self','crown').hint,/不累積/);social.crown.members[0].zone='inside';assert.match(socialLanternRuleState(social,'self','crown').hint,/你正持冠/);
social.mode='tandem';player.role='follower';assert.match(socialLanternRuleState(social,'self','tandem').hint,/追走/);player.role='leader';assert.match(socialLanternRuleState(social,'self','tandem').hint,/領跑/);social.phase='countdown';assert.match(socialLanternRuleState(social,'self','tandem').hint,/倒數/);assert.match(socialLanternRuleState(null,null,'tandem',true,'running').role,/觀眾/);
const crew={phase:'running',stage:'winch',paused:false,players:[{id:'self',role:'technician',connected:true}],team:undefined};assert.match(dutyLanternRuleState(crew,'self').role,/技師/);assert.match(dutyLanternRuleState(crew,'self').hint,/左右/);crew.paused=true;assert.equal(dutyLanternRuleState(crew,'self').phase,'安全暫停');crew.phase='finished';assert.equal(dutyLanternRuleState(crew,'self').phase,'勤務結束');assert.doesNotMatch(dutyLanternRuleState(crew,'self').hint,/調整左右/);
const race={phase:'racing',players:[{id:'self',meridian:{active:true}}],meridian:{settings:{mode:'relay-endurance'},stage:'endurance',complete:false,aborted:false}};assert.match(racingLanternRuleState(race,'self').hint,/正在駕駛/);race.players[0].meridian.active=false;assert.match(racingLanternRuleState(race,'self').hint,/候場/);race.meridian.complete=true;assert.match(racingLanternRuleState(race,'self').hint,/已完成/);race.meridian.complete=false;race.meridian.aborted=true;assert.match(racingLanternRuleState(race,'self').hint,/已中止/);
console.log(JSON.stringify({status:'PASS',maps:24,uniqueRealCenterlines:24,guidance:'lobby/countdown/running/arrival/roles/pause/finished/aborted',networkRequested:false}));
