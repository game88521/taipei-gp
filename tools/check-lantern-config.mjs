// Rex <game88521@gmail.com>. Local environment presence only; never prints a URL/token or contacts a service.
import {pathToFileURL} from 'node:url';
export function lanternConfig(env=process.env){
 const names=['KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 return{configured:!!((env.KV_REST_API_URL??env.UPSTASH_REDIS_REST_URL)&&(env.KV_REST_API_TOKEN??env.UPSTASH_REDIS_REST_TOKEN)),variables:Object.fromEntries(names.map(name=>[name,!!env[name]])),networkChecked:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.stdout.write(JSON.stringify(lanternConfig())+'\n');
