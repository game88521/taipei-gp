/** Rex <game88521@gmail.com>. No network or simulation writes. */
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {lanternTrackPreview} from '../shared/lantern-ui-tracks.ts';
const root=new URL('../',import.meta.url),catalog=JSON.parse(await readFile(new URL('shared/multiplayer-catalog.json',root),'utf8'));
const tracks=[];
for(const row of catalog.tracks){
 const bytes=await readFile(new URL(row.source,root)),sourceSha256=createHash('sha256').update(bytes).digest('hex');
 if(sourceSha256!==row.fileSha256)throw Error('Rebuild the multiplayer catalog first: '+row.id);
 const data=JSON.parse(bytes),preview=lanternTrackPreview(data.points);
 tracks.push({id:row.id,name:row.name,place:row.place,flag:row.flag,sourceSha256,path:preview.path,start:preview.start,lengthKm:Number((data.info?.lengthKm??preview.meters/1000).toFixed(3))});
}
const output=new URL('shared/lantern-ui-track-previews.json',root),text=JSON.stringify({catalogStamp:catalog.catalogStamp,tracks})+'\n';
let old='';try{old=await readFile(output,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(old!==text)await writeFile(output,text);
console.log(JSON.stringify({maps:tracks.length,changed:old!==text,output:fileURLToPath(output)}));
