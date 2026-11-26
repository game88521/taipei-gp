/** Rex <game88521@gmail.com>. Real source centerlines, reduced for menu SVGs only. */
export type LanternPoint = readonly [number, number];
export function lanternTrackPreview(points: readonly LanternPoint[], maxPoints = 180) {
  if (points.length < 3 || points.some(p => p.length !== 2 || !p.every(Number.isFinite))) throw Error('Invalid track centerline');
  const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0]));
  const minZ=Math.min(...points.map(p=>p[1])),maxZ=Math.max(...points.map(p=>p[1]));
  const scale=Math.min(164/Math.max(1,maxX-minX),100/Math.max(1,maxZ-minZ));
  const x=(v:number)=>Number((100+(v-(minX+maxX)/2)*scale).toFixed(2));
  const y=(v:number)=>Number((64+(v-(minZ+maxZ)/2)*scale).toFixed(2));
  // Preserve the actual point order and start. Sampling affects this tiny preview only.
  const count=Math.min(points.length,maxPoints),sampled=Array.from({length:count},(_,i)=>points[Math.floor(i*points.length/count)]);
  let meters=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];meters+=Math.hypot(b[0]-a[0],b[1]-a[1]);}
  return {path:sampled.map((p,i)=>(i?'L':'M')+x(p[0])+','+y(p[1])).join(' ')+' Z',start:[x(points[0][0]),y(points[0][1])],meters};
}
