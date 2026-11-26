// Rex <game88521@gmail.com>. Build from the same GP geometry, never a drawing approximation.
import {build} from 'vite';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const result=await build({root,configFile:false,publicDir:false,logLevel:'warn',build:{write:false,minify:false,target:'node24',lib:{entry:path.join(root,'tools/lantern-manifest-entry.ts'),formats:['es']},rollupOptions:{external:['three']}}});
const entry=(Array.isArray(result)?result:[result]).flatMap(r=>r.output).find(r=>r.type==='chunk'&&r.isEntry);
if(!entry)throw Error('Missing geometry manifest entry');
const temp=path.join(root,'tools','.lantern-manifest-'+process.pid+'.mjs');
await writeFile(temp,entry.code,{flag:'wx'});
try{
 const {buildMultiplayerTrackGeometry,MULTIPLAYER_TRACKS}=await import(pathToFileURL(temp));
 const manifests={};
 const stamp=t=>{const r=v=>Math.round(v*100),m=t.N>>1;return[t.N,r(t.length),r(t.px[0]),r(t.pz[0]),r(t.px[m]),r(t.pz[m]),r(t.px[t.N-1]),r(t.pz[t.N-1])].join(':');};
 for(const d of MULTIPLAYER_TRACKS){const raw=await readFile(path.join(root,d.id==='taipei'?'src/data/track.json':`public/data/circuits/${d.id}.json`),'utf8'),t=buildMultiplayerTrackGeometry(d,JSON.parse(raw));
  const sourceHash=createHash('sha256').update(d.trackStamp).update(raw).update(await readFile(path.join(root,'src/track.ts'))).update(await readFile(path.join(root,'shared/multiplayer-track-recipe.ts'))).digest('hex');
  manifests[d.id]={id:d.id,name:d.name,stamp:stamp(t),length:t.length,ds:t.ds,maxOffset:20,sourceHash,points:Array.from({length:t.N},(_,i)=>[+t.px[i].toFixed(3),+t.pz[i].toFixed(3)])};
 }
 const legacyTaipei=JSON.parse(await readFile(path.join(root,'shared/taipei-track.json'),'utf8'));
 if(manifests.taipei.stamp!==legacyTaipei.stamp)throw Error('Taipei geometry changed: migrate its record version and historical board before publication.');
 const text=JSON.stringify({v:1,tracks:manifests})+'\n',output=path.join(root,'shared/lantern-track-manifests.json');
 let old='';try{old=await readFile(output,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(text!==old)await writeFile(output,text);
 console.log(JSON.stringify({case:'lantern-manifests',maps:Object.keys(manifests).length,changed:text!==old}));
}finally{await unlink(temp);}
