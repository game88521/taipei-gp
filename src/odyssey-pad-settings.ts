export const ODYSSEY_PAD_KEY='taipei-gp-odyssey-pad-v1';
export const PAD_FUNCTIONS=['drs','pit','camera','pause']as const;
export type PadFunction=typeof PAD_FUNCTIONS[number];
export type PadFunctionMap=Record<PadFunction,number>;
export const PAD_FUNCTION_LABELS:Record<PadFunction,string>={drs:'DRS',pit:'進站',camera:'切換鏡頭',pause:'暫停／繼續'};
export const PAD_ALLOWED_BUTTONS=[3,4,5,8,9,10,11,16]as const;
export const defaultPadFunctions=():PadFunctionMap=>({drs:5,pit:4,camera:3,pause:9});
export function parsePadFunctions(raw:unknown):PadFunctionMap|null{if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const r=raw as Record<string,unknown>;if(Object.keys(r).sort().join(',')!=='camera,drs,pause,pit'||PAD_FUNCTIONS.some(k=>!PAD_ALLOWED_BUTTONS.includes(r[k] as typeof PAD_ALLOWED_BUTTONS[number]))||new Set(PAD_FUNCTIONS.map(k=>r[k])).size!==4)return null;return {drs:r.drs as number,pit:r.pit as number,camera:r.camera as number,pause:r.pause as number};}
export function parsePadPreferences(raw:unknown):PadFunctionMap|null{if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='buttons,v'||(raw as {v:unknown}).v!==1)return null;return parsePadFunctions((raw as {buttons:unknown}).buttons);}
