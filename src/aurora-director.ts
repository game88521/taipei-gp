/** Rex <game88521@gmail.com>. Bounded deterministic edit list; rendered frames remain presentation only. */
export type DirectorCamera='follow'|'overhead'|'side';
export interface DirectorClip {start:number;end:number;actor:number;camera:DirectorCamera;speed:number;caption:string}
export function parseDirectorClip(value:unknown,duration:number,actors:number):DirectorClip|null{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='actor,camera,caption,end,speed,start')return null;
 const v=value as DirectorClip;if(![v.start,v.end,v.speed].every(Number.isFinite)||v.start<0||v.end>duration||v.end-v.start<500||v.end-v.start>30000||!Number.isInteger(v.actor)||v.actor<0||v.actor>=actors||!['follow','overhead','side'].includes(v.camera)||![.25,.5,1,2].includes(v.speed)||typeof v.caption!=='string'||v.caption.length>80||/[\x00-\x1f\x7f<>]/.test(v.caption))return null;return{...v};
}
export function directorDuration(clips:DirectorClip[]){return clips.reduce((n,c)=>n+(c.end-c.start)/c.speed,0);}
export function directorPosition(clips:DirectorClip[],elapsed:number){if(!Number.isFinite(elapsed)||elapsed<0||!clips.length)return null;let left=elapsed;for(let i=0;i<clips.length;i++){const c=clips[i],duration=(c.end-c.start)/c.speed;if(left<duration||i===clips.length-1&&left===duration)return{index:i,at:Math.min(c.end,c.start+left*c.speed),clip:c,done:left===duration&&i===clips.length-1};left-=duration;}return{index:clips.length-1,at:clips.at(-1)!.end,clip:clips.at(-1)!,done:true};}
export function chooseRecorderMime(supported:(mime:string)=>boolean){return ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4;codecs=avc1.42E01E','video/webm','video/mp4'].find(supported)??null;}
