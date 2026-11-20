/** Rex <game88521@gmail.com>. Multi-case rescue contract, independent of seat credentials. */
export const DUTY_MISSIONS_VERSION='frontier-duty-missions-v1';
export const DUTY_INCIDENTS=[
 {id:'xinan',name:'信安街救援',x:-153.99,z:1283.8,y:-.25,h:0,angle:0},
 {id:'civic',name:'市民大道救援',x:-474.26,z:-819.51,y:-.25,h:0,angle:.10},
 {id:'songshan',name:'松山路救援',x:1598.15,z:-679.48,y:-.25,h:0,angle:-.12},
]as const;
export type DutyIncidentId=typeof DUTY_INCIDENTS[number]['id'];
export const DUTY_DIFFICULTIES={
 relaxed:{label:'協作入門',radius:4,angle:.45,dwell:1,speed:.6,height:1.2,damage:.6},
 standard:{label:'標準勤務',radius:3,angle:.3,dwell:1.5,speed:.4,height:1,damage:1},
 precision:{label:'精準定位',radius:2.2,angle:.16,dwell:2,speed:.25,height:.8,damage:1.4},
}as const;
export interface DutyMissionSettings{incidents:DutyIncidentId[];difficulty:keyof typeof DUTY_DIFFICULTIES}
export interface DutyCompletedCase{incidentId:DutyIncidentId;seconds:number;integrity:number}
export interface DutyMission{version:typeof DUTY_MISSIONS_VERSION;settings:DutyMissionSettings;caseIndex:number;caseStartedElapsed:number;completed:DutyCompletedCase[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const num=(v:unknown,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
export const defaultDutyMissionSettings=():DutyMissionSettings=>({incidents:['xinan'],difficulty:'standard'});
export function parseDutyMissionSettings(v:unknown):DutyMissionSettings|null{
 if(!obj(v)||!exact(v,['incidents','difficulty'])||!Array.isArray(v.incidents)||v.incidents.length<1||v.incidents.length>3||new Set(v.incidents).size!==v.incidents.length||v.incidents.some(id=>!DUTY_INCIDENTS.some(row=>row.id===id))||typeof v.difficulty!=='string'||!Object.hasOwn(DUTY_DIFFICULTIES,v.difficulty))return null;
 return structuredClone(v) as unknown as DutyMissionSettings;
}
export function parseDutyMission(v:unknown):DutyMission|null{
 if(!obj(v)||!exact(v,['version','settings','caseIndex','caseStartedElapsed','completed'])||v.version!==DUTY_MISSIONS_VERSION)return null;const settings=parseDutyMissionSettings(v.settings);
 if(!settings||!Number.isSafeInteger(v.caseIndex)||!num(v.caseIndex,settings.incidents.length-1)||!num(v.caseStartedElapsed,5401)||!Array.isArray(v.completed)||![v.caseIndex,v.caseIndex+1].includes(v.completed.length)||v.completed.length>settings.incidents.length)return null;
 let total=0;for(let i=0;i<v.completed.length;i++){const row=v.completed[i];if(!obj(row)||!exact(row,['incidentId','seconds','integrity'])||row.incidentId!==settings.incidents[i]||!num(row.seconds,1801)||!num(row.integrity,100))return null;total+=row.seconds;}
 if(total>settings.incidents.length*1800+1||Math.abs(v.caseStartedElapsed-(v.completed.length===v.caseIndex?total:total-Number(v.completed.at(-1).seconds)))>1e-5)return null;
 return structuredClone(v) as unknown as DutyMission;
}
export const newDutyMission=(settings:DutyMissionSettings=defaultDutyMissionSettings()):DutyMission=>({version:DUTY_MISSIONS_VERSION,settings:structuredClone(settings),caseIndex:0,caseStartedElapsed:0,completed:[]});
