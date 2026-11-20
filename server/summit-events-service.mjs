export function summitEventsEnabled(room){return [...room.players.values()].some(p=>p.supportsSummit);}
export function summitEvent(room,at,type,actors=[],detail=''){
 if(!summitEventsEnabled(room)||!room.matchId||room.startAt===null||!['countdown','racing','results'].includes(room.phase))return;
 if(room.summitEventMatch!==room.matchId){room.summitEventMatch=room.matchId;room.summitEvents=[];room.summitEventCooldown=new Map();room.summitOrder=null;}
 const elapsed=Math.max(0,at-room.startAt);if(elapsed>720000||room.summitEvents.length>=512)return;
 const key=type+':'+[...actors].sort().join(',');if(['collision','wall','overtake'].includes(type)&&(room.summitEventCooldown.get(key)??-Infinity)+1000>at)return;
 room.summitEventCooldown.set(key,at);room.summitEvents.push({at:Math.round(elapsed),type,actors:[...actors],detail:String(detail).slice(0,80)});
}
export function summitContacts(room,contacts,at){for(const c of contacts)if(Number.isFinite(c.impact)&&c.impact>=0){const ids=[c.a,c.b].map(slot=>[...room.players.values()].find(p=>String(p.slot)===slot)?.id).filter(Boolean);if(ids.length===2)summitEvent(room,at,'collision',ids,`接觸強度 ${c.impact.toFixed(1)}；未判肇責`);}}
export function summitOvertakes(room,at){
 if(!summitEventsEnabled(room)||room.summit?.stage==='qualifying')return;
 const order=[...room.players.values()].filter(p=>!p.dnf&&p.finishMs===null&&p.arena?.active!==false).sort((a,b)=>b.distance-a.distance||a.slot-b.slot).map(p=>p.id),old=room.summitOrder;
 if(old)for(let i=0;i<order.length;i++)for(let j=i+1;j<order.length;j++){const a=room.players.get(order[i]),b=room.players.get(order[j]);if(old.indexOf(a.id)>old.indexOf(b.id)&&old.includes(a.id)&&old.includes(b.id)&&Math.min(a.distance,b.distance)>30)summitEvent(room,at,'overtake',[a.id,b.id],'伺服器前進進度交換；非肇責判定');}
 room.summitOrder=order;
}
