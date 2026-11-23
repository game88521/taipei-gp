// Rex <game88521@gmail.com>. A party stays inside one existing social room and authority.
import {PARTY_VERSION,PARTY_ROUND_LIMIT,partyMode,partyChoice} from '../shared/aurora-social.ts';
import {CityReplayRecorder} from './frontier-city-replay-service.mjs';
import {createConvoy,resetConvoy} from './frontier-convoy-service.mjs';
import {createCrown,resetCrown} from './frontier-crown-service.mjs';
import {randomBytes} from 'node:crypto';
export function partySnapshot(r){if(!r.party)return undefined;const votes=[...r.party.votes].filter(([id])=>r.players.has(id)).map(([id,mode])=>({slot:r.players.get(id).slot,mode})).sort((a,b)=>a.slot-b.slot);return{v:PARTY_VERSION,ballot:r.party.ballot,rounds:structuredClone(r.party.rounds),scores:[...r.players.values()].map(p=>({slot:p.slot,points:r.party.scores.get(p.id)??0})).sort((a,b)=>a.slot-b.slot),votes,selected:partyChoice(votes)};}
export function scoreParty(r,reason){
 const party=r.party;if(!party||party.scored.has(r.runId)||party.rounds.length>=PARTY_ROUND_LIMIT)return;party.scored.add(r.runId);
 const players=[...r.players.values()].sort((a,b)=>a.slot-b.slot),valid=players.filter(p=>p.client&&p.outcome!=='left'),competitive=reason==='complete'||reason==='captured'||reason==='timeout';
 const values=[...new Set(valid.map(p=>p.points))].sort((a,b)=>b-a);
 const awards=players.map(p=>{let points=0;if(competitive&&valid.includes(p)){
  if(r.mode==='convoy'&&reason==='complete')points=3;
  if(r.mode==='chase'){const won=p.role==='pursuer'?reason==='captured':p.outcome==='escaped';points=won?3:1;}
  if(r.mode==='crown'&&reason==='complete')points=[5,3,1,1][values.indexOf(p.points)]??1;
 }party.scores.set(p.id,(party.scores.get(p.id)??0)+points);return{slot:p.slot,points};});
 party.rounds.push({number:party.rounds.length+1,mode:r.mode,reason,awards});party.votes.clear();party.ballot++;
}
export function handleParty(service,r,p,m,now){
 if(!m.type.startsWith('party-'))return false;
 const keys=['type','revision','runId',...m.type==='party-vote'?['ballot','mode']:[]];
 if(Object.keys(m).length!==keys.length||Object.keys(m).some(k=>!keys.includes(k))||m.revision!==r.revision||m.runId!==r.runId||p.resumeGrant)throw Error('派對場次已更新，請重新確認');
 if(m.type==='party-finish'){
  if(!r.party||p.id!==r.hostId||r.mode!=='cruise'||r.phase!=='running'||[...r.players.values()].some(q=>Math.hypot(q.car.vx,q.car.vz)>2))throw Error('只有房主可在全隊低速時結束派對巡航');
  service.finish(r,'complete',now);return true;
 }
 if(!['lobby','finished'].includes(r.phase))throw Error('請在派對大廳或本場結束後投票；巡航可由房主先結束');
 if(m.type==='party-enable'){
  if(p.id!==r.hostId||r.party||!partyMode(r.mode)||r.players.size<2||[...r.players.values()].some(q=>!q.client||!q.partyCapable||q.resumeGrant))throw Error('兩至四位隊員均需更新連線，且不在追走模式，才能啟用派對');
  r.party={ballot:1,rounds:[],votes:new Map(),scores:new Map([...r.players.keys()].map(id=>[id,0])),scored:new Set()};r.revision++;for(const q of r.players.values())q.ready=false;
 }else if(m.type==='party-end'){
  if(p.id!==r.hostId||!r.party)throw Error('只有房主可結束派對；請先下載活動成績');r.party=null;r.revision++;for(const q of r.players.values())q.ready=false;
 }else if(m.type==='party-vote'){
  if(!r.party||m.ballot!==r.party.ballot||!partyMode(m.mode)||r.party.rounds.length>=PARTY_ROUND_LIMIT)throw Error('投票已更新、玩法無效或已滿20場');r.party.votes.set(p.id,m.mode);
 }else if(m.type==='party-next'){
  if(p.id!==r.hostId||!r.party||r.party.rounds.length>=PARTY_ROUND_LIMIT||r.players.size<2||[...r.players.values()].some(q=>!q.client||q.resumeGrant||!r.party.votes.has(q.id)))throw Error('請等待兩至四位原隊員連線確認並全部投票，再由房主切換');
  const mode=partySnapshot(r).selected,convoy=mode==='convoy'?createConvoy(service.world().roads,'south-loop'):null;
  r.recorder.reset();r.mode=mode;r.convoy=convoy;r.crown=mode==='crown'?createCrown():null;r.recorder=new CityReplayRecorder({source:'social',mode});r.phase='lobby';r.runId=randomBytes(12).toString('hex');r.revision++;r.startAt=r.endsAt=null;r.reason='';r.leg=0;r.watchHistory=[];r.marks=[];r.party.votes.clear();r.party.ballot++;
  resetConvoy(r);resetCrown(r);for(const q of r.players.values()){q.ready=false;q.role='driver';q.points=q.combo=q.maxCombo=q.captureMs=0;q.outcome='';q.resumeGrant=null;q.resumeExpiresAt=null;service.place(r,q);}
 }else throw Error('不支援的派對指令');
 service.broadcast(r,now);return true;
}
