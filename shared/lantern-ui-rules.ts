/** Rex <game88521@gmail.com>. Read-only guidance derived from authoritative game state. */
import type {CrewRoom} from './expedition-duty.ts';
import type {SocialRoom} from './expedition-social.ts';
import type {RoomSnapshot} from './multiplayer-protocol.ts';
import {crewRolesFor,TEAM_ROLE_LABELS} from './aurora-duty.ts';
import {ctfReadout} from './lantern-ctf.ts';
export interface LanternRuleState{mode:string;objective:string;role:string;scoring:string;phase:string;hint:string}
const phases:Record<string,string>={lobby:'賽前準備',countdown:'同步倒數',running:'進行中',racing:'比賽中',finished:'已結束',results:'賽後結算'};
const social:Record<string,[string,string,string]>={
 cruise:['自由巡航','與朋友沿城市道路駕駛、標記集合點。','合作探索，不比較勝負。'],
 convoy:['車隊巡遊','全隊依序沿路過門，到每一站會合。','至少兩人同層低速停妥兩秒，再出發。'],
 crown:['王冠爭奪','碰撞奪冠，留在同層競賽區保住王冠。','180秒內有效持冠秒數最多者獲勝。'],
 chase:['警匪追逐','追捕方攔截；逃跑方在限時內避免被捕。','同層6公尺內雙方低速連續兩秒才算攔截。'],
 tandem:['追走甩尾','交換領跑與追走；追走方保持同向滑移。','追走距離3～25公尺、速度25.2km/h以上，碰撞會斷連段。'],
 ctf:['城市搶旗','取敵旗、運回己方基地，並保護己旗。','四人2對2，先得3旗或三分鐘結束時分高者勝。'],
};
export function socialLanternRuleState(room:SocialRoom|null,selfId:string|null,selected:string,watching=false,watchPhase?:string):LanternRuleState{
 const mode=room?.mode??selected,def=social[mode]??social.cruise,self=room?.players.find(p=>p.id===selfId),phase=room?.phase??watchPhase;
 const roles:Record<string,string>={driver:'車手',pursuer:'追捕方',runner:'逃跑方',leader:'領跑方',follower:'追走方'};
 let role=watching?'觀眾：唯讀跟車，不占車手席。':self?roles[self.role]??'車手':'加入房間後顯示你的職責。';
 if(mode==='ctf'&&self&&!watching)role=(self.slot%2===0?'紅隊':'藍隊')+'車手';
 let hint=watching?'觀戰不會取得操控權；競技畫面依服務設定延遲。':!room?'先建立或加入房間，核對規則再準備。':phase==='lobby'?'所有車手準備後，由房主開始。':phase==='countdown'?'倒數中，等待同步放行。':phase==='finished'?'查看結果；房主可再開一場。':self?.outcome?'你已結束本輪，等候其餘車手。':def[1];
 if(room?.phase==='running'&&!watching&&self&&!self.outcome){
  if(mode==='convoy'&&room.convoy)hint=room.convoy.participants.find(p=>p.slot===self.slot)?.arrived?'你已到站，等候隊友；全隊達成條件後才前往下一站。':'依序通過道路門，前往 '+room.convoy.leg.target.name+'，同層低速停妥兩秒。';
  if(mode==='crown'&&room.crown){const member=room.crown.members.find(m=>m.slot===self.slot);hint=member?.zone!=='inside'?'返回同層競賽區，區外不累積持冠時間。':room.crown.holderSlot===self.slot?'你正持冠：保持在競賽區並避開對手。':'接近持冠車，透過真實車輛接觸奪冠。';}
  if(mode==='tandem')hint=self.role==='follower'?'你是追走：同向靠近前車並維持滑角；避免車碰。':self.role==='leader'?'你是領跑：持續沿道路駕駛，讓隊友追走。':'本輪候場，觀看目前領跑與追走。';
  if(mode==='chase')hint=self.role==='pursuer'?'接近同層逃跑車；雙方低速連續攔截兩秒。':'你是逃跑方：保持距離，避免低速被連續攔截。';
  if(mode==='ctf'&&room.ctf){role=(self.slot%2===0?'紅隊':'藍隊')+'車手';hint=ctfReadout(room.ctf,self.slot);}
 }
 return{mode:def[0],objective:def[1],role,scoring:def[2],phase:phases[phase??'']??(watching?'觀戰中':'尚未加入'),hint};
}
const dutyStages:Record<string,[string,string]>={approach:['前往現場','司機沿路依序通過檢查點，到救援現場停穩。'],warning:['布置警示','協助者完成警示作業；多人隊另須完成前後警戒及簡報。'],positioning:['平台定位','司機依目標方向對準，低速停穩後確認平台定位。'],winch:['絞盤作業','技師調整左右與收放；車輛偏斜時先修正，再收進。'],securing:['固定車輛','司機確認固定；作業完成後才可滿載返回。'],returning:['滿載返站','司機沿返站道路過門；調度員依現況完成返站接收。'],unloading:['返站卸載','協助者完成卸載；全案結束前不要離開房間。'],complete:['救援完成','本次勤務已結束，可查看紀錄或重新接班。']};
export function dutyLanternRuleState(room:CrewRoom|null,selfId:string|null,watching=false):LanternRuleState{
 const roles=room&&selfId?crewRolesFor(room.players,room.team,selfId):[],stage=dutyStages[room?.stage??'approach'];
 return{mode:'合作救援',objective:'全隊共用平板車，沿路出勤、救援並完整返站卸載。',role:watching?'觀眾：唯讀跟車，不執行作業。':roles.length?roles.map(r=>TEAM_ROLE_LABELS[r]).join('／'):'加入後依實際席位分工，可由房主輪換下場職責。',scoring:'保留完整度與完成時間；多案件依序完成，不切案傳送。',phase:!room?'尚未出勤':room.phase==='finished'?'勤務結束':room.paused?'安全暫停':room.phase==='lobby'?'出勤準備':stage[0],hint:watching?'目前階段：'+stage[0]+'。觀眾沒有作業權限。':!room?'建立或加入救援房，確認職責後各自準備。':room.phase==='finished'?(room.stage==='complete'?stage[1]:'勤務已結束，請查看本場原因與紀錄。'):room.paused?'必要職責尚未到齊，車輛與作業安全暫停；等待原席續接。':room.phase==='lobby'?'核對事故與職責，全員準備後由房主出勤。':stage[1]};
}
export function racingLanternRuleState(room:RoomSnapshot|null,selfId:string|null,selected='off'):LanternRuleState{
 const m=room?.meridian,mode=m?.settings.mode??selected,relay=mode==='relay-endurance',self=room?.players.find(p=>p.id===selfId),phase=room?.phase;
 const stage=relay?'耐久接力':m?.stage==='qualifying'?'排位':m?.stage==='sprint'?'衝刺':'正賽';
 let hint=!m?'在大廳選擇賽制，核對條件後由房主套用。':m.aborted?'本階段已中止，依結果頁說明處理；不視為一般完賽。':m.complete?'整個賽事已完成，查看最終積分與成績。':phase==='lobby'?'原席到齊、載圖並重新準備後，由房主起跑。':phase==='countdown'?'等待同步倒數結束後放行。':phase==='results'?'查看結果；由房主前往下一階段，正賽站間可保存續局。':relay?(self?.meridian?.active?'你正在駕駛：達成交棒與實駕要求，於指定維修區低速停妥才可換棒。':'你正在原席候場，可追看隊友，等待正式交棒。'):m.stage==='qualifying'?'完成乾淨單圈；擦牆使本圈無效，同場暫時無車碰。':'依目前發車順序完成本階段，正賽與衝刺分開計分。';
 return{mode:relay?'耐久接力':'跨圖錦標賽',objective:relay?'四人兩隊共用車況與距離，輪流駕駛完成耐久。':'跨圖依序完成排位、可選衝刺與正賽。',role:relay?(m?(self?.meridian?.active?'目前實駕車手':'目前候場車手'):'每隊兩位真人，起跑後保留原席。'):'原席車手，每階段重新載圖與準備。',scoring:relay?'依實際房規完成交棒與每人實駕要求；未達要求為DNF。':'正賽10／6／4／2分；衝刺3／2／1／0分，DNF零分。',phase:m?stage+' · '+(phases[phase??'']??'等待同步'):'尚未套用',hint};
}
