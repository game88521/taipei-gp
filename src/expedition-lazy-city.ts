import {lazyCity} from './summit-lazy-city';
type SocialMount=typeof import('./expedition-social-ui').mountExpeditionSocial;
type DutyMount=typeof import('./expedition-duty-ui').mountExpeditionDuty;
export const mountExpeditionSocial:SocialMount=hooks=>lazyCity<ReturnType<SocialMount>>({
 id:'btn-expedition-social',text:'城市巡航／警匪／追走／車隊／王冠',hooks,
 insert:button=>hooks.host.append(button),load:async()=>(await import('./expedition-social-ui')).mountExpeditionSocial,
 notify:hooks.notify,fallback:{active:false,opened:false,client:null,step(){},frame(){},radarInfo:()=>[],navInfo:()=>null},
 selection:button=>{const mode=button.dataset.socialMode;delete button.dataset.socialMode;return mode==='chase'||mode==='tandem'||mode==='convoy'||mode==='crown'?[mode]:[];},
});
export const mountExpeditionDuty:DutyMount=hooks=>lazyCity<ReturnType<DutyMount>>({
 id:'btn-expedition-duty',text:'🛟 雙人合作救援／定速拉力',hooks,
 insert:button=>hooks.host.append(button),load:async()=>(await import('./expedition-duty-ui')).mountExpeditionDuty,
 notify:hooks.notify,fallback:{active:false,opened:false,online:false,vehicleOverride:false,run:null,client:null,step(){},frame(){},navInfo:()=>null,invalidate(){}},
 selection:button=>{const mode=button.dataset.dutyMode;delete button.dataset.dutyMode;return mode==='rally'||mode==='crew'?[mode]:[];},
});
