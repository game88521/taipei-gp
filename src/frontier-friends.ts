// Rex <game88521@gmail.com>. Ephemeral presentation of existing room snapshots; never sends or persists player positions.
import * as THREE from 'three';
import type {SocialRoom,SocialRole} from '../shared/expedition-social';

export const FRIEND_SLOT_COLORS=['#58d4f2','#ffd166','#c3a1ff','#7ee3ad'] as const;
export const FRIEND_NAME_RANGE=100;
export const FRIEND_OPPONENT_RANGE=80;
export const FRIEND_SAME_LEVEL=1.8;
export const FRIEND_STALE_MS=2500;
export interface FriendRadarPoint{x:number;z:number;h:number;color:string;label:string;dy:number;slot:number}
export interface FriendView extends FriendRadarPoint{id:string;y:number;distance:number;nameVisible:boolean;relation:'friend'|'teammate'|'opponent';role:SocialRole}
type Position={x:number;y:number;z:number};
type Room=Pick<SocialRoom,'mode'|'players'>;
export function friendDisplayName(name:string){return Array.from(String(name).replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069<>]/g,'').trim()).slice(0,20).join('')||'未命名車手';}
/** All newly exposed coordinates share this policy, including radar, nameplates and textual distances. */
export function collectFriendViews(room:Room|null,selfId:string,own:Position,ageMs=0):readonly FriendView[]{
  if(!room||!Array.isArray(room.players)||!Number.isFinite(ageMs)||ageMs<0||ageMs>FRIEND_STALE_MS||![own.x,own.y,own.z].every(Number.isFinite))return [];
  const self=room.players.find(p=>p.id===selfId);if(!self?.connected)return [];
  const seenIds=new Set([selfId]),seenSlots=new Set([self.slot]),views:FriendView[]=[];
  for(const p of room.players.slice(0,4).sort((a,b)=>a.slot-b.slot)){
    if(!p.connected||p.outcome==='left'||seenIds.has(p.id)||!Number.isInteger(p.slot)||p.slot<0||p.slot>3||seenSlots.has(p.slot)||![p.pose.x,p.pose.y,p.pose.z,p.pose.h].every(Number.isFinite))continue;
    seenIds.add(p.id);seenSlots.add(p.slot);
    const distance=Math.hypot(p.pose.x-own.x,p.pose.z-own.z),dy=p.pose.y-own.y,competitive=room.mode==='ctf'||room.mode==='crown'||room.mode==='chase'&&['pursuer','runner'].includes(self.role),opponent=competitive&&(room.mode==='ctf'?p.slot%2!==self.slot%2:room.mode==='crown'||p.role!==self.role);
    if(opponent&&(distance>FRIEND_OPPONENT_RANGE||Math.abs(dy)>=FRIEND_SAME_LEVEL))continue;
    views.push({id:p.id,x:p.pose.x,y:p.pose.y,z:p.pose.z,h:p.pose.h,color:FRIEND_SLOT_COLORS[p.slot],label:`${p.slot+1} ${friendDisplayName(p.name)}`,dy,slot:p.slot,distance,nameVisible:distance<=FRIEND_NAME_RANGE,relation:opponent?'opponent':competitive?'teammate':'friend',role:p.role});
  }
  return views.slice(0,3);
}
/** Explicit public view: no seat IDs, tokens, role internals or arbitrary snapshot fields. */
export function friendRadarPoints(views:readonly FriendView[]):readonly FriendRadarPoint[]{return views.slice(0,3).map(({x,z,h,color,label,dy,slot})=>({x,z,h,color,label,dy,slot}));}
export function friendReadout(view:FriendView){const distance=view.distance>=1000?(view.distance/1000).toFixed(1)+'公里':Math.round(view.distance)+'公尺',height=Math.abs(view.dy)<FRIEND_SAME_LEVEL?'同層':(view.dy>0?'上方':'下方')+Math.round(Math.abs(view.dy))+'公尺',relation=view.relation==='opponent'?'對手':view.relation==='teammate'?'隊友':'好友';return `${view.label} · ${relation} · ${distance} · ${height}`;}
export interface FriendNameVisual{sprite:THREE.Sprite;dispose():void}
/** Owns only its canvas texture/material. Never traverses or disposes borrowed car assets. */
export function createFriendName(view:Pick<FriendView,'label'|'color'|'slot'>,canvasFactory:()=>HTMLCanvasElement=()=>document.createElement('canvas')):FriendNameVisual|null{
  const canvas=canvasFactory();canvas.width=512;canvas.height=80;const ctx=canvas.getContext('2d');if(!ctx)return null;
  ctx.fillStyle='#081421ed';ctx.fillRect(0,0,512,80);ctx.fillStyle=view.color;ctx.fillRect(0,0,8,80);ctx.font='600 32px sans-serif';ctx.textAlign='left';ctx.fillText(view.label,20,52,472);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;
  const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false,toneMapped:false}),sprite=new THREE.Sprite(material);sprite.name='frontier-friend-name-'+view.slot;sprite.scale.set(8,1.25,1);sprite.center.set(.5,0);sprite.userData.frontierFriendName=true;
  let disposed=false;return{sprite,dispose(){if(disposed)return;disposed=true;sprite.removeFromParent();texture.dispose();material.dispose();}};
}
