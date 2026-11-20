import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {pureUrl,pureSource,moduleUrl} from './pure-module-loader.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const m=await import(await pureUrl(root,'horizon-city-models.ts')), cargo=await import(await pureUrl(root,'horizon-cargo.ts'));
const before=resolve(root,'../taipei-gp-horizon-before-b1f70bac2788');
const {FreeCar}=await import(await pureUrl(root,'freecar.ts')),{FreeCar:BeforeFreeCar}=await import(await pureUrl(before,'freecar.ts')),{Collider}=await import(await pureUrl(root,'citydata.ts'));
const sha=b=>createHash('sha256').update(b).digest('hex'),clone=v=>JSON.parse(JSON.stringify(v));
const report={status:'RUNNING',cases:[],localOnly:true,sourceHashes:{},scriptSha256:sha(await readFile(new URL(import.meta.url))),limitations:['四課以真FreeCar與確定控制器完整駕駛，不使用放置車輛／穿點完成；不是人類操作或難度平衡驗證。','地標主題使用合成地標與可達判斷；真城市地標及手機尺寸另由browser驗證。']};
const evidence=`tools/dev-tests/horizon-city-models-evidence-${Date.now()}`;await mkdir(resolve(root,evidence));report.evidence=evidence;
try{await writeFile(resolve(root,evidence,'previous-result.json'),await readFile(resolve(root,'tools/dev-tests/horizon-city-models-result.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
for(const f of ['src/horizon-city-models.ts','src/horizon-cargo.ts','src/horizon-city-ui.ts','src/horizon-appearance.ts','src/save.ts','src/main.ts','src/garage3d.ts','src/freecar.ts','src/citydata.ts'])report.sourceHashes[f]=sha(await readFile(resolve(root,f)));
async function check(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[真TS]').slice(0,3000)});}}
function controller(s){const c=s.car;let gas=false,brake=false,steer=0;if(s.id==='brake'){s._braking ||= s.peaked>=40/3.6&&c.z+c.v*c.v/(2*15.5)>=54.5;brake=s._braking&&c.v>.12;gas=!s._braking;}
else if(s.id==='park'){s._braking ||= -c.z+c.v*c.v/32>=18;brake=!s._braking;gas=s._braking&&c.v<-.12;}
else if(s.id==='smooth'){s._braking ||= c.z+c.v*c.v/32>=130;brake=s._braking&&c.v>.12;gas=!s._braking&&c.v<10.5;}
else{const pts=[{x:0,z:0},...s.gates,{x:3.5,z:105}],look=c.z+7;let a=pts[0],b=pts[1];for(let i=1;i<pts.length;i++){a=pts[i-1];b=pts[i];if(look<=b.z)break;}const t=Math.max(0,Math.min(1,(look-a.z)/(b.z-a.z))),gx=a.x+(b.x-a.x)*t,angle=Math.atan2(gx-c.x,7),err=Math.atan2(Math.sin(angle-c.h),Math.cos(angle-c.h));steer=Math.max(-1,Math.min(1,-err*2.3));s._braking ||= c.z+c.v*c.v/32>=95;brake=s._braking&&c.v>.12;gas=!s._braking&&c.v<5;}
return{steer,throttle:gas,brake};}
for(const id of m.SCHOOL_IDS)await check(`8真FreeCar完整${id}：無傳送、一次成績、原surface不變`,()=>{const s=new m.DrivingSchool();s.start(id);const surface=s.car.constructor.surface;let ticks=0;for(;s.active&&ticks<120*95;ticks++)s.step(1/120,controller(s));assert.equal(s.result?.success,true,JSON.stringify({id,result:s.result,pos:{x:s.car.x,z:s.car.z,h:s.car.h},next:s.next}));assert.equal(s.car.constructor.surface,surface);assert.ok(s.result.score>0);assert.ok(s.result.elapsed>1);assert.ok(s.consume());assert.equal(s.consume(),null);return{ticks,...s.result,position:{x:s.car.x,z:s.car.z},reverse:s.reverse};});
await check('8停車課不能前進穿過或直接傳送進車格',()=>{const s=new m.DrivingSchool();s.start('park');s.car.z=-18;s.step(.02,{steer:0,throttle:false,brake:false});assert.equal(s.result.success,false);assert.match(s.result.reason,/重置/);});
await check('8不繞錐直行及超時失敗；暫停不呼叫step就不扣時',()=>{const s=new m.DrivingSchool();s.start('slalom');for(let i=0;i<120*20&&s.active;i++)s.step(1/120,{steer:0,throttle:s.car.v<5,brake:false});assert.equal(s.result.success,false);assert.match(s.result.reason,/交通錐/);const p=new m.DrivingSchool();p.start('brake');const t=p.elapsed;assert.equal(p.elapsed,t);for(let i=0;i<120*61&&p.active;i++)p.step(1/120,{steer:0,throttle:false,brake:false});assert.match(p.result.reason,/時限/);});
await check('8非法步進不容刷分，停止後不能繼續計時',()=>{for(const dt of[NaN,-1,1]){const s=new m.DrivingSchool();s.start('brake');s.step(dt,{steer:0,throttle:true,brake:false});assert.equal(s.result.success,false);}const s=new m.DrivingSchool();s.start('brake');s.stop();assert.equal(s.step(.02,{steer:0,throttle:true,brake:false}),null);assert.equal(s.elapsed,0);});
await check('8只保存更高分，重試/重領不產生錢包欄位',()=>{const s=m.newHorizonCity();assert.equal(m.recordSchool(s,'brake',75),true);assert.equal(m.recordSchool(s,'brake',74),false);assert.equal(m.recordSchool(s,'brake',90),true);assert.equal(s.school.brake.medal,'gold');assert.equal(m.recordSchool(s,'brake',101),false);assert.equal('money'in s,false);});
await check('12解鎖一次且外觀不鎖車：任一課、四金、探索、GP來源分開',()=>{const s=m.newHorizonCity();assert.deepEqual(m.unlockAppearance(s),[]);m.recordSchool(s,'brake',60);assert.deepEqual(m.unlockAppearance(s),['stripes','silver']);assert.deepEqual(m.unlockAppearance(s),[]);for(const id of m.SCHOOL_IDS)m.recordSchool(s,id,95);assert.deepEqual(m.unlockAppearance(s),['chevron','gold']);s.badges.push('theme:water');assert.deepEqual(m.unlockAppearance(s,true),['wave','cyan','violet']);assert.deepEqual(m.unlockAppearance(s,true),[]);assert.equal('owned'in s,false);});
await check('12存檔往返深複製、非法車號/未解鎖外觀/NaN拒絕',()=>{const s=m.newHorizonCity();s.appearance.sedan={number:'07',decal:'none',rim:'original'};const p=m.parseHorizonCity(s);assert.deepEqual(p,s);p.appearance.sedan.number='99';assert.equal(s.appearance.sedan.number,'07');for(const change of[{number:'<img>',decal:'none',rim:'original'},{number:'100',decal:'none',rim:'original'},{number:'1',decal:'wave',rim:'original'},{number:'1',decal:'none',rim:'gold'}]){const a=clone(s);a.appearance.sedan=change;assert.equal(m.parseHorizonCity(a),null);}const a=clone(s);a.school.brake={score:NaN,medal:'gold'};assert.equal(m.parseHorizonCity(a),null);});
await check('12危險物件key／未知徽章／重複解鎖不被靜默正規化',()=>{for(const key of['__proto__','constructor','prototype']){const s=m.newHorizonCity();s.appearance=JSON.parse('{"'+key+'":{"number":"1","decal":"none","rim":"original"}}');assert.equal(m.parseHorizonCity(s),null);}const a=m.newHorizonCity();a.badges=['theme:forged'];assert.equal(m.parseHorizonCity(a),null);const b=m.newHorizonCity();b.unlocked=['number','number'];assert.equal(m.parseHorizonCity(b),null);});
const marks=[{nm:'河岸橋',x:0,z:0,r:50},{nm:'河畔公園',x:100,z:0,r:50},{nm:'城市博物館',x:200,z:0,r:50},{nm:'古蹟廣場',x:300,z:0,r:50},{nm:'1, 2',x:400,z:0,r:50},{nm:'河上孤島',x:500,z:0,r:50}];
await check('11只建足量真可達地面地標；不拿數字名或不可達點湊任務',()=>{const rows=m.explorationThemes(marks,l=>l.x<500);assert.ok(rows.find(r=>r.id==='theme:water'));assert.ok(rows.find(r=>r.id==='theme:culture'));assert.ok(rows.every(r=>r.marks.every(l=>!['1, 2','河上孤島'].includes(l.nm))));assert.deepEqual(m.explorationThemes(marks,()=>false),[]);});
await check('11既有visited直接認領，未完成不能領、領取冪等且不改visited',()=>{const s=m.newHorizonCity(),theme=m.explorationThemes(marks,()=>true)[0],id=l=>`${l.nm}:${Math.round(l.x)}:${Math.round(l.z)}`;const visited=theme.marks.map(id),old=[...visited];assert.equal(m.claimTheme(s,theme,visited.slice(1)),false);assert.equal(m.claimTheme(s,theme,visited),true);assert.equal(m.claimTheme(s,theme,visited),false);assert.deepEqual(visited,old);assert.equal(s.badges.length,1);assert.ok(s.unlocked.includes('wave'));});
const stops=[{id:'1, 2',name:'1, 2',x:0,z:0,y:-.25},{id:'公園',name:'公園',x:20,z:0,y:-.25},{id:'遠方',name:'遠方',x:200,z:0,y:8}];
await check('2數字站名有可辨識顯示名，legacy id/name/座標原值不變',()=>{const original=clone(stops);assert.match(cargo.cargoLabel(stops[0],stops),/道路配送站.*近公園/);assert.deepEqual(stops,original);assert.equal(cargo.cargoLayer(stops[0],()=>0),'地面');assert.equal(cargo.cargoLayer(stops[2],()=>0),'高架');});
await check('2搜尋全形/原名/別名/地區、附近排序，不更動catalog順序',()=>{const before=clone(stops);assert.equal(cargo.visibleCargoStops(stops,'１, ２',true,{x:0,z:0})[0].id,'1, 2');assert.ok(cargo.visibleCargoStops(stops,'道路配送',true,{x:0,z:0}).length);assert.equal(cargo.visibleCargoStops(stops,'不存在',true,{x:0,z:0}).length,0);assert.equal(cargo.visibleCargoStops(stops,'',true,{x:195,z:0})[0].id,'遠方');assert.deepEqual(stops,before);});
await check('2舊cargo checkpoint按原ID/name仍可認領，不被新顯示名污染',async()=>{const old=await import(await pureUrl(root,'evolution-city-models.ts')),job=new old.FragileCargo();assert.equal(job.start(stops,'sedan',220,{x:0,z:0,y:-.25,h:0}),true);const cp=job.checkpoint({x:0,z:0,y:-.25,h:0});cargo.visibleCargoStops(stops,'',true,{x:0,z:0});assert.equal(new old.FragileCargo().restore(cp,stops,[]),true);assert.equal(cp.stops[0].name,'1, 2');});
await check('存檔parser支援缺欄舊檔／完整新欄，壞新欄要求救援，部分匯入保留',async()=>{globalThis.location={search:''};globalThis.localStorage={getItem(){return null},setItem(){},removeItem(){}};const save=await import(await pureUrl(root,'save.ts')),base={best:null,sectors:[null,null,null],ghost:null,opts:{},taxi:{money:12345,trips:2}};let p=save.parseSaveFile(JSON.stringify(base));assert.equal(p.ok,true);assert.deepEqual(p.dropped,[]);const h=m.newHorizonCity();m.recordSchool(h,'brake',95);h.appearance.sedan={number:'12',decal:'none',rim:'original'};p=save.parseSaveFile(JSON.stringify({...base,horizonCity:h}));assert.deepEqual(p.save.horizonCity,h);assert.equal(p.save.taxi.money,12345);for(const value of[null,{...h,v:2},{...h,school:{brake:{score:-1,medal:'gold'}}}]){const bad=save.parseSaveFile(JSON.stringify({...base,horizonCity:value}));assert.ok(save.criticalSaveDrops(bad.dropped).includes('horizonCity'));}save.save.horizonCity=h;assert.deepEqual(save.prepareImportedSave(base).save.horizonCity,h);});
await check('12真Three外觀層不改共享材質／車輪，替換後只釋放自有geometry/material/texture',async()=>{
  const THREE=await import('three');const api=await import(moduleUrl((await pureSource(root,'horizon-appearance.ts')).replaceAll('three.cjs','three.module.js')));
  const context={clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},fillText(){}};
  globalThis.document={createElement(){return{width:0,height:0,getContext(){return context;}};}};
  const material=new THREE.MeshStandardMaterial({color:'#123456'}),geometry=new THREE.CylinderGeometry(.4,.4,.3).rotateZ(Math.PI/2);let originalDisposed=0;material.addEventListener('dispose',()=>originalDisposed++);geometry.addEventListener('dispose',()=>originalDisposed++);
  function car(){const root=new THREE.Group(),body=new THREE.Group(),wheel=new THREE.Mesh(geometry,material);wheel.position.x=1;root.add(body,wheel);root.userData.paint=material;return{root,body,spin:[wheel],steer:[]};}
  const first=car(),second=car(),appearance={number:'07',decal:'wave',rim:'cyan'};first.root.position.x=500;first.spin[0].position.x=-1;api.applyAppearance(first,'sedan',appearance);assert.ok(first.spin[0].children[0].position.x<0,'wheel side must use car-local coordinates');assert.equal(first.root.userData.horizonAppearance.objects.length,3);assert.equal(second.root.children.length,2);assert.equal(material.color.getHexString(),'123456');
  const layer=first.root.userData.horizonAppearance;let disposed=0;for(const x of [...layer.geometries,...layer.materials,...layer.textures])x.addEventListener('dispose',()=>disposed++);api.applyAppearance(first,'sedan',appearance);assert.equal(first.root.userData.horizonAppearance,layer,'unchanged appearance should not allocate');api.applyAppearance(first,'sedan');assert.equal(disposed,7);assert.equal(first.spin[0].children.length,0);assert.equal(first.body.children.length,0);assert.equal(originalDisposed,0);assert.equal(material.color.getHexString(),'123456');api.disposeAppearance(first);return{ownDisposed:disposed,originalDisposed};
});
await check('物理核心保持Horizon before；授權長軸FreeCar鎖定版本且預設6000格逐位元一致',async()=>{
  let parity;
  for(const f of['src/car.ts','src/track.ts','src/freecar.ts','src/pitlane.ts','server/physics.mjs']) {
    if(f === 'src/freecar.ts') {
      const beforeSha256 = sha(await readFile(resolve(before,f))), reviewedSha256 = sha(await readFile(resolve(root,f)));
      assert.equal(beforeSha256, '655a8bbaee7f4cfbe47d4e7477479a709e8a2ef605d210db96c18ecf058d3ded', 'FreeCar immutable Horizon before');
      assert.equal(reviewedSha256, '99813a7aec638eb6a7c8c5d3b4bc1cb07ea4730f024cebce15db274280847cfb', 'FreeCar reviewed opt-in long-wheelbase version');
      const blank = { attribution:'controlled fixture',buildings:[],roads:[],greens:[],trees:[],signals:[],crossings:[],signs:[],places:[],net:{nodes:[0,0,0,300],ways:[{n:[0,1],w:20,c:0}],y:[0,0]} };
      const collider = new Collider(blank); collider.addEdges([-10,-10,-10,400,10,-10,10,400]);
      const pose = car => Object.fromEntries(['x','z','h','vx','vz','w','steer','y','vy','pitch','roll','landed','touch','jx','jz'].map(key => [key,car[key]]));
      const savedSurface = FreeCar.surface, savedBeforeSurface = BeforeFreeCar.surface;
      const surface = (x,z,y,out={}) => Object.assign(out,{y:.05*Math.sin(z/20),seg:null});
      let contacts = 0;
      try {
        FreeCar.surface = BeforeFreeCar.surface = surface;
        const a = new FreeCar(), b = new BeforeFreeCar(); a.place(0,0,0); b.place(0,0,0);
        assert.equal(a.geometry, undefined, '預設物理不能啟用長軸幾何');
        for(let i=0;i<6000;i++) {
          const dt=1/120,steer=Math.sin(i*.017)*.9,gas=i%700<400,brake=i%700>560; a.drift=b.drift=i%900<100;
          assert.equal(a.update(dt,steer,gas,brake,collider),b.update(dt,steer,gas,brake,collider),`impact frame ${i}`);
          if(i%1300===900) { assert.equal(a.contact(-1,0,.15,a.x+1,a.z+1.3,3,0,.35,.45,.7),b.contact(-1,0,.15,b.x+1,b.z+1.3,3,0,.35,.45,.7),`reaction frame ${i}`); contacts++; }
          assert.deepEqual(pose(a),pose(b),`default FreeCar frame ${i}`);
        }
      } finally { FreeCar.surface=savedSurface; BeforeFreeCar.surface=savedBeforeSurface; }
      parity = { beforeSha256, reviewedSha256, frames:6000, simulatedSeconds:50, forcedContactCases:contacts, bitExact:true, optInGeometry:false };
    } else assert.equal(sha(await readFile(resolve(root,f))),sha(await readFile(resolve(root,'../taipei-gp-horizon-before-b1f70bac2788',f))),f);
  }
  return parity;
});
report.status=report.cases.every(c=>c.status==='PASS')?'PASS':'FAIL';report.summary={passed:report.cases.filter(c=>c.status==='PASS').length,failed:report.cases.filter(c=>c.status==='FAIL').length};const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(resolve(root,evidence,'report.json'),bytes);await writeFile(resolve(root,'tools/dev-tests/horizon-city-models-result.json'),bytes);console.log(JSON.stringify({...report.summary,status:report.status,failures:report.cases.filter(c=>c.status==='FAIL')}));if(report.status!=='PASS')process.exitCode=1;
