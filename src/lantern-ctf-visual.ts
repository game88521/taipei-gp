/** Rex <game88521@gmail.com>. Six owned meshes per team; no per-frame allocations. */
import * as THREE from 'three';
import type {CtfState,CtfTeam} from '../shared/lantern-ctf';
export function createCtfVisual(){
 const root=new THREE.Group();root.name='lantern-ctf';root.visible=false;
 const parts=(['red','blue']as CtfTeam[]).map(team=>{const color=team==='red'?'#ff667b':'#69caff',base=new THREE.Mesh(new THREE.RingGeometry(7.5,8,32).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false})),flag=new THREE.Group(),pole=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,3,6),new THREE.MeshBasicMaterial({color:'#f3f7ff'})),cloth=new THREE.Mesh(new THREE.BoxGeometry(1.7,.9,.07),new THREE.MeshBasicMaterial({color}));pole.position.y=1.5;cloth.position.set(.8,2.5,0);flag.add(pole,cloth);root.add(base,flag);return{team,base,flag};});
 return{root,update(state:CtfState|undefined,show:boolean){root.visible=!!state&&show;if(!state)return;for(const p of parts){const b=state.bases[p.team],f=state.flags.find(f=>f.team===p.team)!;p.base.position.set(b.x,b.y+.18,b.z);p.flag.position.set(f.x,f.y+(f.state==='carried'?2.6:.2),f.z);}},dispose(){root.removeFromParent();root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];for(const m of materials)m.dispose();}});}};
}
