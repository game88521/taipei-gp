export interface CoopHistory { id:string;completed:boolean;delivered:number;own:number;at:number;total:5|6;mode:'direct'|'relay'|'special';points?:number }
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** One contract for in-game history and backup restore; old records mean six direct deliveries. */
export function parseCoopHistory(value:unknown):CoopHistory[]|null{
  if(!Array.isArray(value)||value.length>20)return null;
  const result:CoopHistory[]=[],ids=new Set<string>();
  for(const item of value){
    if(!object(item)||typeof item.id!=='string'||!/^[a-f0-9]{24}$/.test(item.id)||ids.has(item.id)||typeof item.completed!=='boolean')return null;
    const total=item.total===undefined?6:item.total,mode=item.mode===undefined?'direct':item.mode;
    if(!['direct','relay','special'].includes(String(mode))||(total!==5&&total!==6)||(mode==='relay'?total!==5:total!==6)||!Number.isInteger(item.delivered)||typeof item.delivered!=='number'||item.delivered<0||item.delivered>total||!Number.isInteger(item.own)||typeof item.own!=='number'||item.own<0||item.own>item.delivered||item.completed!==(item.delivered===total)||typeof item.at!=='number'||!Number.isFinite(item.at)||item.at<0||mode==='special'&&(!Number.isInteger(item.points)||typeof item.points!=='number'||item.points<0||item.points>Math.min(1000,item.delivered*200)))return null;
    ids.add(item.id);result.push({id:item.id,completed:item.completed,delivered:item.delivered,own:item.own,at:item.at,total,mode:mode as CoopHistory['mode'],...mode==='special'?{points:Number(item.points)}:{}});
  }
  return result;
}
