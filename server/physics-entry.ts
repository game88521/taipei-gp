// 同一份車輛／賽道原始碼供常駐伺服器使用，不複製另一套物理參數。
export { Car } from '../src/car';
export { buildTrack } from '../src/track';
export { MULTIPLAYER_COLLISION_SHAPE, multiplayerCarsOverlap, resolveMultiplayerCollisions } from '../shared/multiplayer-collisions';
export { buildMultiplayerTrackGeometry } from '../shared/multiplayer-track-recipe';
export { MULTIPLAYER_TRACKS, getMultiplayerTrack, verifyMultiplayerTrackData, DEFAULT_MULTIPLAYER_TRACK_ID } from '../shared/multiplayer-tracks';
