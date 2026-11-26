// Rex <game88521@gmail.com>. Only this authority mutates flag ownership or scores.
import {CTF_VERSION,CTF_TARGET,CTF_RETURN_MS,CTF_LOCK_MS,ctfTeam,ctfOther,ctfNear} from '../shared/lantern-ctf.ts';
import {createConvoy} from './frontier-convoy-service.mjs';
export function createCtf(roads){
 const leg=createConvoy(roads,'south-loop').legs[0],red={...leg.start};delete red.name;
 let traveled=0,blue=null;for(let i=1;i<leg.path.length;i++){const a=leg.path[i-1],b=leg.path[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d>.001&&traveled+d>=360){const t=(360-traveled)/d;blue={x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,y:leg.ys[i-1]+(leg.ys[i]-leg.ys[i-1])*t,h:Math.atan2(a[0]-b[0],a[1]-b[1])};break;}traveled+=d;}
 if(!blue||Math.hypot(red.x-blue.x,red.z-blue.z)<40)throw Error('搶旗基地無法連接真道路');
 return{v:CTF_VERSION,bases:{red,blue},flags:[],scores:{red:0,blue:0},winner:null,events:0};
}
function home(c,f,at=0){Object.assign(f,{state:'home',carrierSlot:null,x:c.bases[f.team].x,y:c.bases[f.team].y,z:c.bases[f.team].z,returnAt:0,pickupAfter:at});}
export function resetCtf(r){const c=r.ctf;if(!c)return;c.scores={red:0,blue:0};c.winner=null;c.events=0;for(const p of r.players.values())p.points=0;c.flags=['red','blue'].map(team=>{const f={team};home(c,f);return f;});}
export function ctfSnapshot(r){const c=r.ctf;return c?structuredClone(c):undefined;}
export function dropCtf(r,p,at){const c=r.ctf;if(!c)return;for(const f of c.flags)if(f.carrierSlot===p.slot){Object.assign(f,{state:'dropped',carrierSlot:null,x:p.car.x,y:p.car.y,z:p.car.z,returnAt:at+CTF_RETURN_MS,pickupAfter:at+CTF_LOCK_MS});c.events++;}}
export function finishCtf(r,reason){const c=r.ctf;if(!c)return;for(const p of r.players.values())if(!p.client||p.outcome)dropCtf(r,p,r.simAt);c.winner=reason==='complete'?(c.scores.red===c.scores.blue?'draw':c.scores.red>c.scores.blue?'red':'blue'):null;}
export function stepCtf(r,contacts,at,finish,event){
 const c=r.ctf;if(!c||r.phase!=='running')return;const available=p=>p.client&&!p.resumeGrant&&p.ctfConfirm!==false;const all=[...r.players.values()].sort((a,b)=>a.slot-b.slot);
 if(all.length!==4||all.some(p=>p.outcome)){finish('left',at);return;}
 // Disconnected carriers lose flags immediately; no credit while absent. Resume never restores ownership.
 for(const p of all)if(!available(p))dropCtf(r,p,at);
 for(const [aid,bid]of contacts){const a=r.players.get(aid),b=r.players.get(bid);if(a&&b&&ctfTeam(a.slot)!==ctfTeam(b.slot)){dropCtf(r,a,at);dropCtf(r,b,at);}}
 for(const f of c.flags){
  if(f.state==='carried'){const p=all.find(p=>p.slot===f.carrierSlot);if(!p||!available(p)){if(p)dropCtf(r,p,at);else home(c,f,at);continue;}f.x=p.car.x;f.y=p.car.y;f.z=p.car.z;}
  if(f.state==='dropped'&&at>=f.returnAt){home(c,f,at+CTF_LOCK_MS);c.events++;event(at,'stage',[]);}
  if(f.state==='carried'||at<f.pickupAfter)continue;
  const near=all.filter(p=>available(p)&&ctfNear(p.car,f));
  const returning=f.state==='dropped'&&near.find(p=>ctfTeam(p.slot)===f.team);
  if(returning){home(c,f,at+CTF_LOCK_MS);c.events++;event(at,'stage',[returning.id]);continue;}
  const taker=near.find(p=>ctfTeam(p.slot)!==f.team&&!c.flags.some(q=>q.carrierSlot===p.slot));if(taker){f.state='carried';f.carrierSlot=taker.slot;f.returnAt=0;f.x=taker.car.x;f.y=taker.car.y;f.z=taker.car.z;c.events++;event(at,'operation',[taker.id]);}
 }
 for(const f of c.flags){if(f.state!=='carried')continue;const p=all.find(p=>p.slot===f.carrierSlot),team=ctfTeam(p.slot),own=c.flags.find(q=>q.team===team);if(available(p)&&own.state==='home'&&ctfNear(p.car,c.bases[team])){c.scores[team]++;p.points++;home(c,f,at+CTF_LOCK_MS);c.events++;event(at,'stage',[p.id]);if(c.scores[team]>=CTF_TARGET){finish('complete',at);return;}}}
}
