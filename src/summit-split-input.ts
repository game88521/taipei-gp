import { StandardPadInput, type PadSample } from './input';
import type { SplitControl } from './summit-split-race';

export type SplitBinding = 'keyboard' | number;
const empty = (): SplitControl => ({ steer: 0, throttle: false, brake: true });
/** Every seat owns its pad reader and an explicit index; devices cannot drive both cars. */
export class SummitSplitInput {
  private readers = [new StandardPadInput(), new StandardPadInput()];
  private keys = new Set<string>();
  private pauseHeld = false;
  bindings: readonly [SplitBinding, SplitBinding] = ['keyboard', 0];
  reset() { this.keys.clear(); this.pauseHeld = false; for (const reader of this.readers) reader.reset(); }
  key(code: string, down: boolean) { if (down) this.keys.add(code); else this.keys.delete(code); }
  bind(bindings: readonly [SplitBinding, SplitBinding]) {
    if (bindings[0] === bindings[1] || bindings.some(b => b !== 'keyboard' && (!Number.isInteger(b) || b < 0 || b > 31))) throw Error('兩位玩家需要不同的輸入裝置。');
    this.bindings = [...bindings]; this.reset();
  }
  read(pads: readonly (PadSample | null)[], active: boolean, required: readonly boolean[] = [true,true]): { controls: SplitControl[]; ready: boolean[]; missing: boolean; pause: boolean } {
    if (!active) { this.reset(); return { controls: [empty(),empty()], ready: [false,false], missing: false, pause: false }; }
    let missing = false; const ready: boolean[] = [];
    const controls = this.bindings.map((binding, index) => {
      if (required[index] === false) { ready.push(true); return empty(); }
      if (binding === 'keyboard') {
        ready.push(true); return { steer: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')), throttle: this.keys.has('KeyW'), brake: this.keys.has('KeyS') || this.keys.has('Space') };
      }
      const pad = pads.find(p => p?.index === binding && p.connected && p.mapping === 'standard') ?? null;
      if (!pad) missing = true;
      const sample = this.readers[index].read(pad, { enabled: true, deadzone: .14, inverted: false }, true);
      ready.push(this.readers[index].status === 'ready');
      return { steer: sample.steer, throttle: sample.throttle, brake: sample.brake };
    });
    const held = this.bindings.some((binding,index) => required[index] !== false && typeof binding === 'number' && pads.some(p => p?.index === binding && p.connected && p.mapping === 'standard' && (p.buttons[9]?.pressed || (p.buttons[9]?.value ?? 0) >= .4)));
    const pause = held && !this.pauseHeld; this.pauseHeld = held;
    return { controls, ready, missing, pause };
  }
}
