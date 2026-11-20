import {lazyCity} from './summit-lazy-city';
type RallyMount=typeof import('./frontier-rally-ui').mountFrontierRally;
type PracticeMount=typeof import('./frontier-tandem-practice-ui').mountFrontierTandemPractice;
export const mountFrontierRally:RallyMount=hooks=>lazyCity<ReturnType<RallyMount>>({
 id:'btn-frontier-rally',text:'好友定速拉力 · 2～4人',hooks,insert:button=>hooks.host.append(button),load:async()=>(await import('./frontier-rally-ui')).mountFrontierRally,notify:hooks.notify,
 fallback:{active:false,opened:false,client:null,vehicleId:null,prediction:null,navInfo:()=>null,frame(){},leave(){}},
});
export const mountFrontierTandemPractice:PracticeMount=hooks=>lazyCity<ReturnType<PracticeMount>>({
 id:'btn-frontier-tandem-practice',text:'追走單人陪練',hooks,insert:button=>hooks.host.append(button),load:async()=>(await import('./frontier-tandem-practice-ui')).mountFrontierTandemPractice,notify:hooks.notify,
 fallback:{active:false,opened:false,phase:'idle',ghost:null,latest:null,step(){},frame(){},invalidate(){}},
});
