/** Display-only data; never used to change simulation, visibility authority or scoring. */
export interface FrontierRadarFriend { x:number; z:number; h:number; color:string; label:string; dy:number; slot:number }
export function radarPoint(x:number,z:number,h:number,friend:FrontierRadarFriend,range=220){
 if(![x,z,h,friend.x,friend.z,friend.h,friend.dy,range].every(Number.isFinite)||range<=0)return null;
 const dx=friend.x-x,dz=friend.z-z,c=Math.cos(h),s=Math.sin(h),rx=-c*dx+s*dz,ry=-s*dx-c*dz,distance=Math.hypot(dx,dz),edge=range*.83,scale=distance>edge?edge/distance:1;
 return{x:rx*scale,y:ry*scale,edge:distance>edge,distance,angle:distance>edge?Math.atan2(rx,-ry):h-friend.h};
}
