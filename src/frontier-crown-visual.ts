/** Rex <game88521@gmail.com>. Owns only code-generated crown geometry/materials. */
import * as THREE from 'three';
export function createCrownVisual(){
 const root=new THREE.Group();root.name='frontier-moving-crown';root.visible=false;
 const material=new THREE.MeshBasicMaterial({color:'#ffd45e',depthTest:true,depthWrite:false}),bandGeometry=new THREE.TorusGeometry(.7,.11,6,20),tipGeometry=new THREE.ConeGeometry(.19,.65,4),band=new THREE.Mesh(bandGeometry,material);band.rotation.x=Math.PI/2;root.add(band);
 for(let i=0;i<5;i++){const angle=i*Math.PI*2/5,tip=new THREE.Mesh(tipGeometry,material);tip.position.set(Math.cos(angle)*.62,.25,Math.sin(angle)*.62);root.add(tip);}
 let disposed=false;return{root,dispose(){if(disposed)return;disposed=true;root.removeFromParent();root.clear();bandGeometry.dispose();tipGeometry.dispose();material.dispose();}};
}
