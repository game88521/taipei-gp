import { decodeCity, decodeTile, Collider, type CityData, type TileData } from '../src/citydata';
import { Surface } from '../src/surface';
import { FreeCar } from '../src/freecar';
import { CITY_RACE_SPECS } from 'virtual:summit-city-specs';
import { WorkshopRoads } from '../src/nexus-workshop';
export { FreeCar } from '../src/freecar';
export { streetContact } from '../shared/atlas-city-contact';
export { ROAD_Y } from '../src/surface';
export { decodeWorkshop, encodeWorkshop, parseWorkshop } from '../src/nexus-workshop';
export {decodeStory,encodeStory,buildStoryPlan} from '../src/aurora-story';
export {buildPhotoHunt,CityMissionRun} from '../src/meridian-city-models';
export function createCityRaceWorld(raw: CityData, tiles: TileData[] = []) {
  const data = decodeCity(raw), surface = new Surface(data), collider = new Collider(data);
  surface.tunnels = true; collider.groundAt = (x, z) => surface.groundAt(x, z);
  for (const tile of tiles) collider.addBuildings(decodeTile(tile).buildings);
  for (const r of surface.rails) collider.addWall(r.x1, r.z1, r.x2, r.z2, r.y1, r.y2);
  const roads = new WorkshopRoads(data);
  return { data, surface, collider, roads, surfaceAt: (x: number, z: number, y: number, out?: Parameters<Surface['at']>[3]) => surface.at(x, z, y, out), spec(id: string, wet = false) { const spec = CITY_RACE_SPECS[id]; if (!spec) throw Error('城市競速車款不支援'); return { ...spec, grip: spec.grip * (wet ? .82 : 1) }; } };
}
