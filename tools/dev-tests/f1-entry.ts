// 獨立車模量測入口，不啟動城市、音效或模擬。
// 先由 rivals 進入既有模組循環，與遊戲的初始化順序一致。
export { PLAYER_LIVERY } from '../../src/rivals';
export * as THREE from 'three';
export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
export { makeF1, setLod, setTyre, TEAMS } from '../../src/f1model';
