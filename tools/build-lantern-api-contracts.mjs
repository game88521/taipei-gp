// Local reviewable contracts, no workspace publication or credentials.
import {readFile,writeFile} from 'node:fs/promises';
const tracks=JSON.parse(await readFile('shared/multiplayer-catalog.json','utf8')).tracks.map(t=>t.id);
const spec=JSON.parse(await readFile('postman/leaderboard.openapi.json','utf8'));
spec.info.title='全GP賽道計時排行榜';spec.info.version='4.0.0';spec.info.description='24圖、經典／2026、版本分榜；台北舊榜唯讀。軌跡合理性檢查不是權威防作弊。';
spec.components.schemas.Board.properties.track={type:'string',enum:tracks};spec.components.schemas.Submission.properties.time={type:'number',minimum:10,maximum:1200};
if(!spec.paths['/api/leaderboard'].get.parameters.some(p=>p.name==='track'))spec.paths['/api/leaderboard'].get.parameters.unshift({name:'track',in:'query',schema:{type:'string',enum:tracks,default:'taipei'}});
await writeFile('postman/leaderboard.openapi.json',JSON.stringify(spec,null,2)+'\n');
const error={description:'固定error代碼；409不覆寫，429依Retry-After稍後重試，503未設定／上游不可用，504期限已到。',content:{'application/json':{schema:{type:'object',required:['error'],properties:{error:{type:'string'},revision:{type:'integer'}}}}}};
const response=description=>({description,content:{'application/json':{schema:{type:'object'}}}});
const request=schema=>({required:true,content:{'application/json':{schema}}});
const statuses=success=>Object.fromEntries([[success,response('成功；不自動變更任何本機存檔。')],...[400,401,403,404,405,409,410,413,429,503,504].map(s=>[s,error])]);
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required});const str={type:'string'},uuid={type:'string',format:'uuid'};
const auth=[{syncAccount:[],syncKey:[]}];
const doc={openapi:'3.1.0',info:{title:'Lantern個人同步與每週好友盃',version:'1.0.0',description:'同源、明確確認的雲端進度與私人異步比賽。完整規則見lantern-contract.md。私人同步金鑰不放URL、邀請或備份。'},servers:[{url:'http://127.0.0.1:4329'}],components:{securitySchemes:{syncAccount:{type:'apiKey',in:'header',name:'X-Sync-Account'},syncKey:{type:'http',scheme:'bearer',description:'32隨機bytes的base64url個人復原金鑰'}}},paths:{
 '/api/cloud':{
  post:{operationId:'createSyncAccount',summary:'建立個人同步帳戶；每來源60秒限制',requestBody:request(object({action:{const:'create'}})),responses:statuses(201)},
  get:{operationId:'readCloudProfile',security:auth,summary:'讀取revision、updatedAt與backup（初始為null）',responses:statuses(200)},
  put:{operationId:'writeCloudProfile',security:auth,summary:'預期版本原子上傳；同operationId收據保留24小時',requestBody:request(object({expectedRevision:{type:'integer',minimum:0},operationId:uuid,backup:{type:'object',description:'AtlasBackup v1；白名單分類，最大3MB，完整前端逐類驗證。'}})),responses:statuses(200)},
  delete:{operationId:'deleteSyncAccount',security:auth,summary:'版本相符才刪除帳戶與雲端進度；本機不變',requestBody:request(object({expectedRevision:{type:'integer',minimum:0}})),responses:statuses(200)}},
 '/api/weekly':{
  get:{operationId:'readWeeklyCup',summary:'依私人邀請碼讀取三站與榜單；90天保存',parameters:[{name:'cup',in:'query',required:true,schema:{type:'string',pattern:'^[A-HJ-NP-Z2-9]{8}$'}}],responses:statuses(200)},
  post:{operationId:'changeWeeklyCup',security:auth,summary:'建立／加入／啟用單次挑戰／提交有效圈',requestBody:request({oneOf:[object({action:{const:'create'},name:str,driverName:str},['action','name']),object({action:{const:'join'},cup:str,name:str}),object({action:{const:'start'},cup:str,track:{enum:tracks}}),object({action:{const:'submit'},cup:str,track:{enum:tracks},time:{type:'number',minimum:10,maximum:1200},proof:spec.components.schemas.Proof,attempt:str,operationId:uuid})]}),responses:statuses(200)}}}};
doc.paths['/api/weekly'].post.responses[201]=response('已建立好友盃或單次挑戰；挑戰回傳attempt、serverTime、expiresAt與stamp。');
await writeFile('postman/lantern.openapi.json',JSON.stringify(doc,null,2)+'\n');
const item=(name,method,path,body,privateAccount=false)=>({name,request:{method,header:[{key:'Content-Type',value:'application/json'},...(privateAccount?[{key:'X-Sync-Account',value:'{{syncAccount}}'},{key:'Authorization',value:'Bearer {{syncKey}}'}]:[])],url:'{{baseUrl}}'+path,...body?{body:{mode:'raw',raw:JSON.stringify(body,null,2),options:{raw:{language:'json'}}}}:{}},event:[{listen:'test',script:{type:'text/javascript',exec:['pm.test("JSON與固定狀態", function () { pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json"); pm.expect([200,201,400,401,403,404,409,410,413,429,503,504]).to.include(pm.response.code); });']}}]});
await writeFile('postman/lantern.postman_collection.json',JSON.stringify({info:{name:'Lantern本機契約',schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',description:'只含localhost預設；請使用Postman秘密變數填入自己的同步憑證，勿提交真值。狀態化邊界與故障的可執行證據由lantern-api-node/deadline-node覆蓋。'},variable:[{key:'baseUrl',value:'http://127.0.0.1:4329'},{key:'syncAccount',value:''},{key:'syncKey',value:''},{key:'cup',value:''}],item:[item('建立個人同步帳戶','POST','/api/cloud',{action:'create'}),item('讀取雲端版本','GET','/api/cloud',null,true),item('讀取台北榜','GET','/api/leaderboard?track=taipei&rules=classic&version=1'),item('建立本週好友盃','POST','/api/weekly',{action:'create',name:'本機好友盃',driverName:'車手'},true),item('讀取好友盃','GET','/api/weekly?cup={{cup}}')]},null,2)+'\n');
console.log(JSON.stringify({status:'GENERATED',tracks:tracks.length,networkRequested:false}));
