export const HUD_LAYOUT_KEY='taipei-gp-expedition-hud-v1';
export const HUD_WIDGETS=['speed','timing','board','map','status','tyres'] as const;
export type HudWidget=typeof HUD_WIDGETS[number];
export type HudProfile='main-mobile'|'main-desktop'|'multiplayer-mobile'|'multiplayer-desktop';
export type HudPosition={x:number;y:number};
export interface HudLayouts{v:1;profiles:Partial<Record<HudProfile,Partial<Record<HudWidget,HudPosition>>>>}
export const HUD_PROFILES:HudProfile[]=['main-mobile','main-desktop','multiplayer-mobile','multiplayer-desktop'];
export function parseHudLayouts(raw:string):HudLayouts|null{try{if(raw.length>16000)return null;const v=JSON.parse(raw);if(!v||v.v!==1||!v.profiles||typeof v.profiles!=='object'||Array.isArray(v.profiles)||Object.keys(v).some(k=>!['v','profiles'].includes(k)))return null;for(const[k,positions]of Object.entries(v.profiles)){if(!HUD_PROFILES.includes(k as HudProfile)||!positions||typeof positions!=='object'||Array.isArray(positions))return null;for(const[id,p]of Object.entries(positions)){const point=p as HudPosition;if(!HUD_WIDGETS.includes(id as HudWidget)||!point||typeof point!=='object'||Object.keys(point).some(k=>!['x','y'].includes(k))||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>1||point.y>1)return null;}}return v;}catch{return null;}}
export function clampHudPosition(point:HudPosition,width:number,height:number,widgetWidth:number,widgetHeight:number){const gap=8;return {left:Math.max(gap,Math.min(Math.max(gap,width-widgetWidth-gap),point.x*width)),top:Math.max(gap,Math.min(Math.max(gap,height-widgetHeight-gap),point.y*height))};}
export class HudLayoutStore{
 value:HudLayouts={v:1,profiles:{}};blocked=false;private raw:string|null=null;
 constructor(private storage:Pick<Storage,'getItem'|'setItem'>|null){try{this.raw=storage?.getItem(HUD_LAYOUT_KEY)??null;if(this.raw!==null){const parsed=parseHudLayouts(this.raw);if(!parsed)throw Error();this.value=parsed;}}catch{this.blocked=true;}}
 save(profile:HudProfile,positions:Partial<Record<HudWidget,HudPosition>>){const next={v:1 as const,profiles:{...this.value.profiles,[profile]:structuredClone(positions)}};if(!parseHudLayouts(JSON.stringify(next)))throw Error('HUD位置格式無效');this.value=next;if(!this.blocked&&this.storage)try{if(this.storage.getItem(HUD_LAYOUT_KEY)!==this.raw){this.blocked=true;return;}const raw=JSON.stringify(next);this.storage.setItem(HUD_LAYOUT_KEY,raw);this.raw=raw;}catch{this.blocked=true;}}
}
