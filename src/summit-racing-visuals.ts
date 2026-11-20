import * as THREE from 'three';
import {surfaceY,type Track} from './track';
import type {RoomSnapshot} from '../shared/multiplayer-protocol';
/** The same origin-side service area is available on every supported circuit. */
export class SummitRacingVisuals{
 private group:THREE.Group|null=null;private scene:THREE.Scene|null=null;private track:Track|null=null;
 dispose(){if(this.group){this.group.removeFromParent();const g=new Set<THREE.BufferGeometry>(),m=new Set<THREE.Material>();this.group.traverse(o=>{if(o instanceof THREE.Mesh){g.add(o.geometry);for(const x of Array.isArray(o.material)?o.material:[o.material])m.add(x);}});for(const x of g)x.dispose();for(const x of m)x.dispose();}this.group=this.scene=this.track=null;}
 update(scene:THREE.Scene,track:Track,room:RoomSnapshot|null){
  if((!room?.summit?.settings.endurance&&(!room?.voyager||room.voyager.settings.weather==='legacy')&&!room?.atlas?.settings.damage)||room.summit?.stage==='qualifying'){if(this.group)this.dispose();return;}
  if(this.scene===scene&&this.track===track)return;this.dispose();this.scene=scene;this.track=track;const group=this.group=new THREE.Group();group.name='summit-pit-markers';scene.add(group);
  const mat=new THREE.MeshBasicMaterial({color:0x55e5df,transparent:true,opacity:.45,depthWrite:false,side:THREE.DoubleSide});
  for(let s=5;s<80;s+=5){const i=Math.floor(s/track.ds)%track.N,lat=4;const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2.8,4.5),mat);mesh.rotation.set(-Math.PI/2,0,-Math.atan2(track.tx[i],track.tz[i]));mesh.position.set(track.px[i]-track.tz[i]*lat,surfaceY(track,i,lat)+.07,track.pz[i]+track.tx[i]*lat);group.add(mesh);}
  const markerMaterial=new THREE.MeshBasicMaterial({color:0xffca69});for(const s of[20,70]){const i=Math.floor(s/track.ds)%track.N;const marker=new THREE.Mesh(new THREE.ConeGeometry(.5,1.7,4),markerMaterial);marker.position.set(track.px[i]-track.tz[i]*6,surfaceY(track,i,6)+.85,track.pz[i]+track.tx[i]*6);group.add(marker);}
 }
}
