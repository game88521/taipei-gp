import {build} from 'vite';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {parseAst} from 'rolldown/parseAst';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Extract the real public vehicle specs at build time without importing renderer/GP modules into Node.
const code=stripTypeScriptTypes(await readFile(path.join(root,'src/vehicles.ts'),'utf8'),{mode:'transform'}),ast=parseAst(code),decl=ast.body.flatMap(n=>n.type==='ExportNamedDeclaration'?[n.declaration]:[]).find(n=>n?.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='VEHICLES'))?.declarations.find(d=>d.id.name==='VEHICLES');
if(decl?.init?.type!=='ArrayExpression')throw Error('Cannot extract real vehicle specifications');
const allowed=new Set(['sedan','taxi','muscle','f1','super','police','pickup']),entries=[];for(const row of decl.init.elements){if(row?.type!=='ObjectExpression')continue;const id=row.properties.find(p=>p.key?.name==='id')?.value,spec=row.properties.find(p=>p.key?.name==='spec')?.value;if(allowed.has(id?.value)&&spec)entries.push(`${JSON.stringify(id.value)}:${code.slice(spec.start,spec.end)}`);}if(entries.length!==7)throw Error('Incomplete city race vehicle specifications');
const virtual='virtual:summit-city-specs',moduleCode=`import {DEFAULT_SPEC} from ${JSON.stringify(path.join(root,'src/freecar.ts').replaceAll('\\','/'))};export const CITY_RACE_SPECS={${entries.join(',')}};`;
await build({configFile:false,root,plugins:[{name:'city-race-real-specs',resolveId:id=>id===virtual?'\0'+virtual:null,load:id=>id==='\0'+virtual?moduleCode:null}],build:{target:'es2022',outDir:path.join(root,'server'),emptyOutDir:false,copyPublicDir:false,minify:true,lib:{entry:path.join(root,'server/summit-city-physics-entry.ts'),formats:['es'],fileName:()=> 'summit-city-physics.mjs'}}});
