import type {SocialMode,SocialPhase,SocialRole,SocialRoom} from '../shared/expedition-social';
import {ctfTeam,ctfTeamLabel,type CtfState} from '../shared/lantern-ctf';
export const SOCIAL_PHASE_LABELS:Record<SocialPhase,string>={lobby:'等待準備',countdown:'起跑倒數',running:'進行中',finished:'已結束'};
export const SOCIAL_REASON_LABELS:Record<SocialRoom['reason'],string>={'':'尚未結束',timeout:'時間結束',captured:'所有逃跑方已被逮捕',left:'隊員離席，對局中斷',complete:'任務完成','server-stall':'服務暫停過久，對局中斷'};
export const SOCIAL_OUTCOME_LABELS:Record<string,string>={'':'進行中',captured:'遭逮捕',escaped:'逃脫成功',left:'中途離席'};
type ResultPlayer={role:SocialRole;outcome:string;points?:number;slot?:number};
type ResultRoom={mode:SocialMode;reason:SocialRoom['reason'];players:readonly ResultPlayer[];crown?:{winnerPoints:number|null};ctf?:Pick<CtfState,'scores'|'winner'>};
/** Presentation uses only confirmed authoritative end reasons/outcomes, never elapsed client time. */
export function socialFinishLabel(room:ResultRoom,player:ResultPlayer){
  if(room.reason==='left'||room.reason==='server-stall')return '對局中斷（不計勝負）';
  if(player.outcome==='left')return '中途離席（不計個人勝負）';
  if(room.mode==='cruise')return '巡航結束';
  if(room.mode==='ctf'){const c=room.ctf;if(!c||!c.winner)return '搶旗結果尚未確認';return `紅 ${c.scores.red}：${c.scores.blue} 藍 · `+(c.winner==='draw'?'平手':player.slot===undefined?ctfTeamLabel(c.winner)+'獲勝':ctfTeam(player.slot)===c.winner?'你的隊伍獲勝':'你的隊伍落敗');}
  if(room.mode==='convoy')return room.reason==='complete'?'全隊巡遊完成':room.reason==='timeout'?'巡遊逾時，未全隊完成':'巡遊結果尚未確認';
  if(room.mode==='crown'){if(room.reason!=='complete'||room.crown?.winnerPoints===null||room.crown?.winnerPoints===undefined)return '王冠結果尚未確認';const won=player.points===room.crown.winnerPoints,tied=room.players.filter(p=>!p.outcome&&p.points===room.crown!.winnerPoints).length>1;return won?(tied?'共同王冠得主':'王冠得主'):'完成王冠爭奪';}
  if(room.mode==='tandem')return room.reason==='complete'?'完成雙段追走':'結果尚未確認';
  const runners=room.players.filter(p=>p.role==='runner'),captured=room.reason==='captured'&&runners.length>0&&runners.every(p=>p.outcome==='captured'),escaped=room.reason==='timeout'&&runners.some(p=>p.outcome==='escaped');
  if(player.role==='pursuer')return captured?'追捕方獲勝':escaped?'追捕方落敗（有對手逃脫）':'結果尚未確認';
  if(player.outcome==='escaped'&&escaped)return '逃脫成功（逃跑方獲勝）';
  if(player.outcome==='captured')return captured?'遭逮捕（逃跑方落敗）':escaped?'遭逮捕，隊友成功逃脫':'遭逮捕';
  return '結果尚未確認';
}
