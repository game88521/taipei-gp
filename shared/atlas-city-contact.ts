/** Same-layer street-car contact; never used by legacy single-player physics. */
export interface StreetBody {
  x:number; z:number; y:number; h:number; vx:number; vz:number; w:number;
  spec:{mass:number}; geometry?:{inertia:number;radius:number;offsets:readonly number[]}; jx:number;jz:number;
  contact(nx:number,nz:number,depth:number,cx:number,cz:number,ovx:number,ovz:number,e:number,mu:number,otherInvMass:number):number;
}
export function streetContact(a:StreetBody,b:StreetBody):{touch:boolean;impact:number} {
  if(Math.abs(a.y-b.y)>1.6||Math.hypot(a.x-b.x,a.z-b.z)>8)return{touch:false,impact:0};
  const ar=a.geometry?.radius??.95,br=b.geometry?.radius??.95,ao=a.geometry?.offsets??[1.45,0,-1.45],bo=b.geometry?.offsets??[1.45,0,-1.45];
  let best:{nx:number;nz:number;depth:number;cx:number;cz:number}|null=null;
  for(const u of ao)for(const v of bo){const ax=a.x+Math.sin(a.h)*u,az=a.z+Math.cos(a.h)*u,bx=b.x+Math.sin(b.h)*v,bz=b.z+Math.cos(b.h)*v,dx=ax-bx,dz=az-bz,d=Math.hypot(dx,dz),depth=ar+br-d;
    if(depth<=0||best&&best.depth>=depth)continue;
    const nx=d>.0001?dx/d:1,nz=d>.0001?dz/d:0;best={nx,nz,depth,cx:(ax+bx)/2,cz:(az+bz)/2};
  }
  if(!best)return{touch:false,impact:0};
  const {nx,nz,depth,cx,cz}=best,ratio=Math.max(.1,Math.min(10,a.spec.mass/b.spec.mass));
  const oldBvx=b.vx+b.w*(cz-b.z),oldBvz=b.vz-b.w*(cx-b.x);
  const impact=a.contact(nx,nz,depth*.5,cx,cz,oldBvx,oldBvz,.18,.18,ratio);
  b.x-=nx*(depth*.5+.01);b.z-=nz*(depth*.5+.01);
  b.vx-=a.jx*ratio;b.vz-=a.jz*ratio;
  b.w-=((cz-b.z)*a.jx-(cx-b.x)*a.jz)*ratio/(b.geometry?.inertia??2.2);
  a.w=Math.max(-2.5,Math.min(2.5,a.w));b.w=Math.max(-2.5,Math.min(2.5,b.w));
  return{touch:true,impact};
}
