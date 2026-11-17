import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pureUrl } from './pure-module-loader.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),project=path.resolve(here,'../..');
const {placeHudNotice}=await import(await pureUrl(project,'hud-notices.ts'));
const cases=[],overlaps=(a,b)=>a.left<b.left+b.width&&a.left+a.width>b.left&&a.top<b.top+b.height&&a.top+a.height>b.top;
function check(name,fn){try{fn();cases.push({name,status:'PASS'});}catch(e){cases.push({name,status:'FAIL',error:String(e)});throw e;}}
check('short_landscape_warning_is_separate_from_expanded_strategy',()=>{
 const panel={left:170,top:64,width:444,height:136},r=placeHudNotice(844,220,{width:120,height:44},[panel]);
 assert.ok(!overlaps(r,panel));assert.ok(r.left>=8&&r.top>=8&&r.left+r.width<=836&&r.top+r.height<=212);
});
check('portrait_warning_avoids_strategy_and_orientation_notice',()=>{
 const panels=[{left:170,top:198,width:210,height:234},{left:110,top:8,width:170,height:28}];
 const r=placeHudNotice(390,844,{width:140,height:44},panels);assert.ok(panels.every(p=>!overlaps(r,p)));assert.ok(r.top+r.height<=836);
});
check('closed_strategy_keeps_notice_near_centre',()=>{
 const r=placeHudNotice(1280,800,{width:120,height:44},[]);assert.equal(r.left,580);assert.equal(r.top,368);
});
check('touch_buttons_remain_clear',()=>{
 const panels=[{left:8,top:50,width:200,height:162},{left:650,top:80,width:180,height:132},{left:170,top:64,width:444,height:44}];
 const r=placeHudNotice(844,220,{width:110,height:38},panels);assert.ok(panels.every(p=>!overlaps(r,p)));
});
check('oversized_text_is_bounded_by_viewport',()=>{
 const r=placeHudNotice(250,150,{width:700,height:40},[]);assert.equal(r.width,234);assert.ok(r.left>=0&&r.left+r.width<=250&&r.top+r.height<=150);
});
check('invalid_obstacle_does_not_produce_nan',()=>{
 const r=placeHudNotice(390,844,{width:140,height:44},[{left:NaN,top:0,width:50,height:50}]);assert.ok(Object.values(r).every(Number.isFinite));
});
const sourceHashes={};for(const p of['src/hud-notices.ts','src/style.css'])sourceHashes[p]=createHash('sha256').update(await readFile(path.join(project,p))).digest('hex');
const report={status:'PASS',cases,sourceHashes,localOnly:true};await writeFile(path.join(here,'tenpack-hud-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:cases.length}));
