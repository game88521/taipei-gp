import * as THREE from 'three';
import {surfaceY,type Track} from './track';
import type {RoomSnapshot} from '../shared/multiplayer-protocol';
/** All geometry belongs to this disposable group; no texture download or world mutation. */
export class MultiplayerArenaVisuals{
 private scene:THREE.Scene|null=null;private track:Track|null=null;private mode='off';private group:THREE.Group|null=null;
 private supplies:THREE.Mesh[]=[];private halos=new Map<string,THREE.Mesh>();
 dispose(){if(this.group){this.group.removeFromParent();const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();this.group.traverse(v=>{if(v instanceof THREE.Mesh){geometries.add(v.geometry);for(const m of Array.isArray(v.material)?v.material:[v.material])materials.add(m);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}this.group=null;this.scene=null;this.track=null;this.supplies=[];this.halos.clear();}
 update(scene:THREE.Scene,track:Track,room:RoomSnapshot|null,now:number){const mode=room?.arena?.mode??'off';
  if(mode==='off'){if(this.group)this.dispose();return;}
  if(scene!==this.scene||track!==this.track||mode!==this.mode){this.dispose();this.scene=scene;this.track=track;this.mode=mode;const group=new THREE.Group();group.name='nexus-arena-markers';this.group=group;scene.add(group);
   if(mode==='relay'){
    const material=new THREE.MeshBasicMaterial({color:0x58efd0,transparent:true,opacity:.27,depthWrite:false,side:THREE.DoubleSide});
    for(let distance=5;distance<80;distance+=5){const i=Math.floor(distance/track.ds)%track.N;const mesh=new THREE.Mesh(new THREE.PlaneGeometry(8,4.5),material);mesh.rotation.set(-Math.PI/2,0,-Math.atan2(track.tx[i],track.tz[i]));mesh.position.set(track.px[i],surfaceY(track,i,0)+.05,track.pz[i]);group.add(mesh);}
   }else for(let j=0;j<3;j++){const i=Math.floor(track.N*(j+.5)/3)%track.N;const mesh=new THREE.Mesh(new THREE.OctahedronGeometry(1.35),new THREE.MeshBasicMaterial({color:j%2?0x75c5ff:0xffca69,wireframe:true}));mesh.position.set(track.px[i],surfaceY(track,i,0)+2.8,track.pz[i]);group.add(mesh);this.supplies.push(mesh);}
  }
  for(const mesh of this.supplies){mesh.rotation.y=now/900;mesh.rotation.z=Math.sin(now/800)*.2;}
  const ids=new Set(room?.players.map(p=>p.id));for(const[id,halo]of this.halos)if(!ids.has(id)){halo.removeFromParent();halo.geometry.dispose();(halo.material as THREE.Material).dispose();this.halos.delete(id);}
  for(const p of room?.players??[]){let halo=this.halos.get(p.id);if(!halo){halo=new THREE.Mesh(new THREE.TorusGeometry(2.2,.12,6,24),new THREE.MeshBasicMaterial({color:0x75c5ff,transparent:true,opacity:.8,depthWrite:false}));halo.rotation.x=Math.PI/2;this.group!.add(halo);this.halos.set(p.id,halo);}
   const shield=(p.arena?.shieldUntil??0)>now,boost=(p.arena?.boostUntil??0)>now;halo.visible=mode==='items'&&(shield||boost)&&!p.dnf&&p.finishMs===null;(halo.material as THREE.MeshBasicMaterial).color.set(shield?0x75c5ff:0xffca69);halo.position.set(p.car.x,surfaceY(track,p.car.pos.i,p.car.pos.lat)+.4,p.car.z);
  }
 }
}
