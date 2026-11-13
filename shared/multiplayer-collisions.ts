import { HALF_WIDTH, WALL_OFF, heightAt, locate, type Locate, type Track } from '../src/track';

/** Multiplayer-only bodies; the single-player Car and its fixed simulation stay unchanged. */
export const MULTIPLAYER_COLLISION_SHAPE = Object.freeze({ halfLength: 2.6, halfWidth: .95, heightTolerance: 1.5 });
const WALL_LIMIT = WALL_OFF - 1;
const SEPARATION_SLOP = .002;
const RESTITUTION = .05;
const EPSILON = 1e-8;

export type MultiplayerCollisionCar = { x: number; z: number; h: number; v: number; pos: Locate };
export type MultiplayerCollisionBody = {
  id: string;
  car: MultiplayerCollisionCar;
  previous?: { x: number; z: number; h: number };
};
export type MultiplayerCollisionContact = { a: string; b: string; impact: number };
type Axis = { x: number; z: number };
type Contact = { x: number; z: number; depth: number };

function valid(track: Track, car: MultiplayerCollisionCar) {
  return Number.isFinite(car.x) && Number.isFinite(car.z) && Number.isFinite(car.h) && Number.isFinite(car.v)
    && Number.isInteger(car.pos.i) && car.pos.i >= 0 && car.pos.i < track.N
    && Number.isFinite(car.pos.s) && Number.isFinite(car.pos.lat);
}
function axes(car: MultiplayerCollisionCar): [Axis, Axis] {
  const s = Math.sin(car.h), c = Math.cos(car.h);
  return [{ x: s, z: c }, { x: c, z: -s }];
}
function radius(carAxes: [Axis, Axis], axis: Axis, margin = 0) {
  return (MULTIPLAYER_COLLISION_SHAPE.halfLength + margin) * Math.abs(carAxes[0].x * axis.x + carAxes[0].z * axis.z)
    + (MULTIPLAYER_COLLISION_SHAPE.halfWidth + margin) * Math.abs(carAxes[1].x * axis.x + carAxes[1].z * axis.z);
}
function sameLevel(track: Track, a: MultiplayerCollisionCar, b: MultiplayerCollisionCar) {
  const y = (car: MultiplayerCollisionCar) => heightAt(track, car.pos.s)
    + Math.max(-HALF_WIDTH, Math.min(HALF_WIDTH, car.pos.lat)) * track.bank[car.pos.i];
  return Math.abs(y(a) - y(b)) < MULTIPLAYER_COLLISION_SHAPE.heightTolerance;
}
function overlap(a: MultiplayerCollisionCar, b: MultiplayerCollisionCar, margin = 0): Contact | null {
  const aa = axes(a), ba = axes(b), dx = b.x - a.x, dz = b.z - a.z;
  let depth = Infinity, normal: Axis = aa[0];
  for (const axis of [...aa, ...ba]) {
    const projection = dx * axis.x + dz * axis.z;
    const amount = radius(aa, axis, margin) + radius(ba, axis, margin) - Math.abs(projection);
    if (amount < 0) return null;
    if (amount < depth) {
      depth = amount;
      const sign = projection < 0 ? -1 : 1;
      normal = { x: axis.x * sign, z: axis.z * sign };
    }
  }
  return { ...normal, depth };
}

/** Shared contact/proximity query. A margin expands each body, and bridge levels remain separate. */
export function multiplayerCarsOverlap(track: Track, a: MultiplayerCollisionCar, b: MultiplayerCollisionCar, margin = 0) {
  return valid(track, a) && valid(track, b) && sameLevel(track, a, b)
    && overlap(a, b, Math.max(0, Math.min(5, Number.isFinite(margin) ? margin : 0))) !== null;
}

/** Swept separating axes catch a fast crossing even when the final boxes no longer overlap. */
function swept(a: MultiplayerCollisionBody, b: MultiplayerCollisionBody): (Contact & { time: number }) | null {
  if (!a.previous || !b.previous) return null;
  const aa = axes(a.car), ba = axes(b.car);
  const startX = b.previous.x - a.previous.x, startZ = b.previous.z - a.previous.z;
  const moveX = (b.car.x - b.previous.x) - (a.car.x - a.previous.x);
  const moveZ = (b.car.z - b.previous.z) - (a.car.z - a.previous.z);
  let entry = -Infinity, exit = Infinity, normal: Axis = aa[0], startsOverlapping = true;
  for (const axis of [...aa, ...ba]) {
    const r = radius(aa, axis) + radius(ba, axis);
    const start = startX * axis.x + startZ * axis.z;
    const move = moveX * axis.x + moveZ * axis.z;
    if (Math.abs(start) > r) startsOverlapping = false;
    if (Math.abs(move) < EPSILON) { if (Math.abs(start) > r) return null; continue; }
    const first = (-r - start) / move, last = (r - start) / move;
    const axisEntry = Math.min(first, last), axisExit = Math.max(first, last);
    if (axisEntry > entry) {
      entry = axisEntry;
      const sign = start + move * axisEntry < 0 ? -1 : 1;
      normal = { x: axis.x * sign, z: axis.z * sign };
    }
    exit = Math.min(exit, axisExit);
    if (entry > exit) return null;
  }
  if (startsOverlapping || entry < 0 || entry > 1 || exit < 0 || !Number.isFinite(entry)) return null;
  return { ...normal, depth: 0, time: entry };
}

function impulse(a: MultiplayerCollisionCar, b: MultiplayerCollisionCar, contact: Contact) {
  const af = axes(a)[0], bf = axes(b)[0];
  const av = Math.max(0, a.v), bv = Math.max(0, b.v);
  const closing = (af.x * av - bf.x * bv) * contact.x + (af.z * av - bf.z * bv) * contact.z;
  if (closing <= 0) return 0;
  const kick = (1 + RESTITUTION) * closing / 2, speedLimit = Math.max(av, bv);
  // Equal-mass, low-restitution impulse, projected back to the arcade car's forward velocity.
  // Projection only removes energy; the cap also prevents collisions becoming a speed boost.
  a.v = Math.max(0, Math.min(speedLimit, av - kick * (af.x * contact.x + af.z * contact.z)));
  b.v = Math.max(0, Math.min(speedLimit, bv + kick * (bf.x * contact.x + bf.z * contact.z)));
  return closing;
}

function constrain(track: Track, car: MultiplayerCollisionCar) {
  locate(track, car.x, car.z, car.pos);
  const excess = Math.abs(car.pos.lat) - WALL_LIMIT;
  if (excess > 0) {
    const side = Math.sign(car.pos.lat), i = car.pos.i;
    car.x -= -track.tz[i] * side * excess;
    car.z -= track.tx[i] * side * excess;
    locate(track, car.x, car.z, car.pos);
  }
}
function movementRoom(track: Track, car: MultiplayerCollisionCar, x: number, z: number) {
  const i = car.pos.i, lateral = x * -track.tz[i] + z * track.tx[i];
  if (Math.abs(lateral) < EPSILON) return Infinity;
  return Math.max(0, (WALL_LIMIT - Math.sign(lateral) * car.pos.lat) / Math.abs(lateral));
}
function separate(track: Track, a: MultiplayerCollisionCar, b: MultiplayerCollisionCar, contact: Contact) {
  const distance = contact.depth + SEPARATION_SLOP;
  const aRoom = movementRoom(track, a, -contact.x, -contact.z);
  const bRoom = movementRoom(track, b, contact.x, contact.z);
  let aMove = Math.min(distance / 2, aRoom), bMove = Math.min(distance / 2, bRoom);
  let left = Math.max(0, distance - aMove - bMove);
  const extraA = Math.min(left, Math.max(0, aRoom - aMove)); aMove += extraA; left -= extraA;
  bMove += Math.min(left, Math.max(0, bRoom - bMove));
  a.x -= contact.x * aMove; a.z -= contact.z * aMove;
  b.x += contact.x * bMove; b.z += contact.z * bMove;
  constrain(track, a); constrain(track, b);
}

/** Resolve only the room's active cars after all Car.update calls and before lap accounting. */
export function resolveMultiplayerCollisions(track: Track, bodies: readonly MultiplayerCollisionBody[], dt = 1 / 60): MultiplayerCollisionContact[] {
  const ordered = bodies.filter(body => valid(track, body.car)).slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const contacts = new Map<string, MultiplayerCollisionContact>();
  const duration = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0));
  const remember = (a: MultiplayerCollisionBody, b: MultiplayerCollisionBody, impact: number) => {
    const key = `${a.id}\0${b.id}`, previous = contacts.get(key);
    contacts.set(key, { a: a.id, b: b.id, impact: Math.max(previous?.impact ?? 0, impact) });
  };
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i], b = ordered[j];
      if (!sameLevel(track, a.car, b.car)) continue;
      const crossing = pass === 0 ? swept(a, b) : null;
      if (crossing) {
        const ap = a.previous!, bp = b.previous!;
        a.car.x = ap.x + (a.car.x - ap.x) * crossing.time; a.car.z = ap.z + (a.car.z - ap.z) * crossing.time;
        b.car.x = bp.x + (b.car.x - bp.x) * crossing.time; b.car.z = bp.z + (b.car.z - bp.z) * crossing.time;
        remember(a, b, impulse(a.car, b.car, crossing));
        const remaining = duration * (1 - crossing.time);
        a.car.x += Math.sin(a.car.h) * a.car.v * remaining; a.car.z += Math.cos(a.car.h) * a.car.v * remaining;
        b.car.x += Math.sin(b.car.h) * b.car.v * remaining; b.car.z += Math.cos(b.car.h) * b.car.v * remaining;
        constrain(track, a.car); constrain(track, b.car);
        changed = true;
      }
      const contact = overlap(a.car, b.car);
      if (!contact || contact.depth <= EPSILON) continue;
      remember(a, b, impulse(a.car, b.car, contact));
      separate(track, a.car, b.car, contact);
      changed = true;
    }
    if (!changed) break;
  }
  return [...contacts.values()];
}
