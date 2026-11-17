import { POLICE_DUTIES, newPoliceCareer, parsePoliceCareer, type PoliceCareer, type PoliceDifficulty } from './city-jobs-state';
import type { Police } from './police';
import type { TaxiJob, TaxiPosition } from './taxi';

export interface CityJobsUiOptions {
  policeHost: HTMLElement; tourHost: HTMLElement;
  getPolice(): Police | null; getTaxi(): TaxiJob | null; getPosition(): TaxiPosition;
  getPoliceCareer?(): PoliceCareer | undefined;
  onPoliceCareer(career: PoliceCareer): void;
  acceptTour(id: string, isCurrent: () => boolean): Promise<boolean>;
}
/** 只管理自己的DOM；模式切換、音效解鎖與錢包由main既有流程負責。 */
export function mountCityJobsUi(options: CityJobsUiOptions) {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
    const node = document.createElement(tag); node.textContent = text; return node;
  };
  const dutyPanel = make('div'), title = make('h3', '🚨 巡邏勤務'), label = make('label', '追緝難度 '), select = make('select');
  dutyPanel.className = 'city-jobs-panel gp-tools'; select.id = 'police-duty-difficulty';
  for (const [value, duty] of Object.entries(POLICE_DUTIES)) { const option = make('option', duty.label); option.value = value; select.append(option); }
  label.append(select);
  const detail = make('p'), stats = make('p'), result = make('p'); result.id = 'police-duty-result'; result.setAttribute('role', 'status');
  dutyPanel.append(title, label, detail, stats, result,
    make('p', '使用巡邏車進入自由駕駛後，按「追緝」開始。勤務中固定難度；主動結束會中斷連勝。碰撞評價不改變已顯示的獎金。'));
  options.policeHost.replaceChildren(dutyPanel);
  select.addEventListener('change', () => {
    const police = options.getPolice(), difficulty = select.value as PoliceDifficulty;
    if (!Object.hasOwn(POLICE_DUTIES, difficulty)) return;
    if (police) {
      if (police.setDutyDifficulty(difficulty)) options.onPoliceCareer(police.dutyCareer);
    } else {
      const career = parsePoliceCareer(options.getPoliceCareer?.()) ?? newPoliceCareer();
      options.onPoliceCareer({ ...career, difficulty });
    }
    refreshPolice();
  });
  function refreshPolice() {
    const police = options.getPolice(), career = police?.dutyCareer ?? parsePoliceCareer(options.getPoliceCareer?.()) ?? newPoliceCareer();
    const summary = police?.dutySummary, difficulty = summary?.difficulty ?? career.difficulty, duty = POLICE_DUTIES[difficulty];
    select.value = difficulty; select.disabled = !!summary?.active;
    detail.textContent = `${duty.label}：${duty.seconds} 秒內逮捕，嫌犯耐久 ${duty.hp} 點，最高速度倍率 ${duty.speed}。獎金＝${duty.base}＋剩餘秒數×${duty.perSecond}（四捨五入）。` +
      ` 碰撞0次為A、1～${duty.cleanHits}次為B，其餘為C；0.8秒內持續接觸算一次。${summary?.active ? ` 本次碰撞 ${summary.collisions} 次。` : ''}`;
    stats.textContent = `完成 ${career.completed}／失敗 ${career.failed}，連續成功 ${career.consecutive}，最高連續 ${career.bestConsecutive}。`;
    const last = police?.lastDutyResult;
    result.textContent = last ? `最近勤務：${POLICE_DUTIES[last.difficulty].label} ${last.status === 'arrested' ? '逮捕成功' : last.status === 'timeout' ? '超時' : last.status === 'distance' ? '跟丟' : '已取消'}，${last.elapsed.toFixed(1)}秒／碰撞${last.collisions}次${last.rating ? `／評價${last.rating}` : ''}，獎金 NT$ ${last.reward}。` : '';
  }

  const tourPanel = make('div'), tourTitle = make('h3', '📍 觀光載客'), tourLabel = make('label', '依序停靠 '), count = make('select');
  tourPanel.className = 'city-jobs-panel gp-tools'; count.id = 'taxi-tour-count';
  for (const n of [3, 4, 5]) { const option = make('option', `${n} 個地標`); option.value = String(n); count.append(option); }
  tourLabel.append(count);
  const plan = make('button', '預覽觀光行程'); plan.type = 'button'; plan.id = 'taxi-tour-preview'; plan.className = 'ghost-btn';
  const tourList = make('div'); tourList.id = 'taxi-tour-orders'; tourList.setAttribute('role', 'status');
  tourPanel.append(tourTitle, tourLabel, plan,
    make('p', '休閒不限時；上客後依序在各站同層停穩。固定車資加每站 NT$80 行程獎金，全部完成才收款一次；無時間小費或連單獎勵，中途放棄沒有收入。'), tourList);
  options.tourHost.replaceChildren(tourPanel);
  let generation = 0, accepting = false;
  function renderTours() {
    generation++; tourList.replaceChildren();
    plan.disabled = accepting || options.getTaxi()?.phase === 'ride'; count.disabled = accepting;
    tourList.textContent = options.getTaxi()?.phase === 'ride' ? '目前正在載客，請先完成或放棄目前行程。' : '按「預覽觀光行程」規劃附近可行路線。';
  }
  count.addEventListener('change', renderTours);
  plan.addEventListener('click', () => {
    const taxi = options.getTaxi(), p = options.getPosition();
    if (!taxi || taxi.phase === 'ride' || accepting) { renderTours(); return; }
    const token = ++generation, orders = taxi.previewTours(p.x, p.z, p.y, Number(count.value));
    tourList.replaceChildren();
    if (!orders.length) { tourList.textContent = '附近找不到這個站數的可行觀光路線，請換站數或換個位置。'; return; }
    for (const order of orders) {
      const text = make('p', `上客：${order.from}（接客 ${Math.round(order.pickupDistance)} m）。依序：${order.tourStops.map((s, i) => `${i + 1}.${s.nm}`).join(' → ')}。` +
        ` 全程 ${(order.distance / 1000).toFixed(2)} km，固定車資 NT$ ${order.estimatedFare}＋行程獎金 ${order.tourBonus}＝全部完成 NT$ ${order.estimatedTotal}。`);
      const accept = make('button', '接下觀光單'); accept.type = 'button'; accept.className = 'ghost-btn'; accept.dataset.tourId = order.id;
      accept.addEventListener('click', async () => {
        const isCurrent = () => generation === token && options.tourHost.getClientRects().length > 0;
        if (accepting || !isCurrent()) return;
        accepting = true; accept.disabled = plan.disabled = count.disabled = true;
        try {
          const ok = await options.acceptTour(order.id, isCurrent);
          if (isCurrent() && !ok) { tourList.textContent = '觀光單已失效或目前不能接單，請重新預覽。'; }
        } catch {
          if (isCurrent()) tourList.textContent = '暫時無法接下觀光單，請重新預覽。';
        } finally { accepting = false; plan.disabled = options.getTaxi()?.phase === 'ride'; count.disabled = false; }
      });
      tourList.append(text, accept);
    }
  });
  refreshPolice(); renderTours();
  return { refreshPolice, renderTours };
}
