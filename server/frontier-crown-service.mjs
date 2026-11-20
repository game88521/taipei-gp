// Rex <game88521@gmail.com>. Contact candidates must come from actual streetContact calls in this simulation step.
import {CROWN_VERSION,CROWN_ARENA,CROWN_PROTECTION_MS,CROWN_OUTSIDE_MS,crownZone,crownSeconds} from '../shared/frontier-crown.ts';
export function createCrown(){return{holderSlot:null,protectedUntil:0,transfers:0,lastChange:'none',winnerPoints:null};}
export function resetCrown(r,started=false){if(!r.crown)return;Object.assign(r.crown,createCrown());for(const p of r.players.values())p.crownOutside=0;if(started){const players=[...r.players.values()].sort((a,b)=>a.slot-b.slot);r.crown.holderSlot=players[(r.round-1)%players.length].slot;r.crown.protectedUntil=r.startAt+CROWN_PROTECTION_MS;r.crown.lastChange='start';}}
export function crownSnapshot(r){const c=r.crown;if(!c)return undefined;return{v:CROWN_VERSION,arena:{...CROWN_ARENA},holderSlot:c.holderSlot,protectedUntil:c.protectedUntil,transfers:c.transfers,lastChange:c.lastChange,winnerPoints:c.winnerPoints,members:[...r.players.values()].map(p=>({slot:p.slot,zone:p.outcome==='left'?'left':!p.client?'offline':crownZone(p.car),outsideMs:p.client?Math.min(CROWN_OUTSIDE_MS,Math.round(p.crownOutside??0)):0}))};}
export function finishCrown(r,reason){if(!r.crown)return;r.crown.winnerPoints=reason==='complete'?Math.max(0,...[...r.players.values()].filter(p=>!p.outcome).map(p=>crownSeconds(p.points))):null;}
export function stepCrown(r,contacts,at,finish,event){
 const c=r.crown;if(!c||r.phase!=='running')return;const players=[...r.players.values()].sort((a,b)=>a.slot-b.slot);
 for(const p of players){if(p.outcome)continue;const zone=crownZone(p.car);p.crownOutside=p.client&&zone!=='inside'?(p.crownOutside??0)+1000/60:0;if(p.crownOutside>=CROWN_OUTSIDE_MS-.0001){p.crownOutside=CROWN_OUTSIDE_MS;p.outcome='left';p.input={steer:0,throttle:false,brake:false,handbrake:false,active:false};p.queue=[];p.car.vx=p.car.vz=p.car.w=0;event(at,'leave',[p.id]);}}
 const active=players.filter(p=>!p.outcome);if(active.length<2){finish('left',at);return;}
 const eligible=active.filter(p=>p.client&&crownZone(p.car)==='inside');let holder=active.find(p=>p.slot===c.holderSlot);
 if(!holder){const next=eligible[0];if(next){c.holderSlot=next.slot;c.protectedUntil=at+CROWN_PROTECTION_MS;c.lastChange='reassign';event(at,'crown',[next.id],'crown-return');holder=next;}else return;}
 if(!eligible.includes(holder))return;
 // Credit exactly one authoritative dt to the holder before a contact at the end of this step.
 holder.points=Math.min(180,holder.points+1/60);
 if(at+.0001<c.protectedUntil)return;
 const candidates=eligible.filter(p=>p!==holder&&contacts.some(([a,b])=>a===holder.id&&b===p.id||b===holder.id&&a===p.id));
 const next=candidates[0];if(!next)return;
 const old=holder;c.holderSlot=next.slot;c.protectedUntil=at+CROWN_PROTECTION_MS;c.transfers++;c.lastChange='contact';event(at,'crown',[old.id,next.id],'crown-transfer');
}
