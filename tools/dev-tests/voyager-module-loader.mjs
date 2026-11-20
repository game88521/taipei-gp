import {build} from 'vite';
import path from 'node:path';
/** Bundle the real TS/JSON dependency graph, without replacing product imports. */
export async function voyagerModule(root,name){const result=await build({root,configFile:false,logLevel:'error',build:{write:false,minify:false,target:'es2022',lib:{entry:path.resolve(root,'src',name),formats:['es'],fileName:'model'},rollupOptions:{output:{inlineDynamicImports:true}}}});const output=Array.isArray(result)?result[0]:result;return import('data:text/javascript;base64,'+Buffer.from(output.output.find(f=>f.type==='chunk').code).toString('base64'));}
