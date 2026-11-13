import type {
  DoorwayOpening,
  FurniturePiece,
  RoomLayout,
  SpatialSlot,
  Vec3,
  WallSegment,
} from './types';
import { extractSpatialSlots } from './spatial';
import type { DetectedPlaneSnapshot } from '../three/webxrTypes';

/**
 * Converts live WebXR XRPlane snapshots (from Meta Quest / Pico room scan)
 * into a RoomLayout and SpatialSlots so the AI Spatial Threat Director
 * can analyze the player's actual physical room.
 */
export function buildRoomFromWebXRPlanes(
  planes: DetectedPlaneSnapshot[],
  playerPos: Vec3,
  playerYawRad: number,
): { room: RoomLayout; slots: SpatialSlot[] } {
  const walls: WallSegment[] = [];
  const doorways: DoorwayOpening[] = [];
  const furniture: FurniturePiece[] = [];
  const extraSlots: SpatialSlot[] = [];

  let minX = playerPos.x - 2.2;
  let maxX = playerPos.x + 2.2;
  let minZ = playerPos.z - 2.2;
  let maxZ = playerPos.z + 2.2;
  let ceilingY = 2.65;

  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    const label = (p.semanticLabel || '').toLowerCase();

    if (p.orientation === 'vertical') {
      if (label.includes('door')) {
        const halfW = Math.max(0.45, p.width * 0.5);
        const tx = -p.normal.z;
        const tz = p.normal.x;
        doorways.push({
          id: `xr-door-${i}`,
          center: { x: p.center.x, z: p.center.z },
          width: halfW * 2,
          height: Math.max(1.9, p.depthOrHeight),
          outwardNormal: { x: -p.normal.x, z: -p.normal.z },
          jambLeft: { x: p.center.x - tx * halfW, z: p.center.z - tz * halfW },
          jambRight: { x: p.center.x + tx * halfW, z: p.center.z + tz * halfW },
        });
        continue;
      }

      if (p.segmentStart && p.segmentEnd) {
        walls.push({
          id: `xr-wall-${i}`,
          start: p.segmentStart,
          end: p.segmentEnd,
          height: Math.max(2.1, p.depthOrHeight),
          thickness: 0.14,
          inwardNormal: { x: p.normal.x, z: p.normal.z },
        });
        minX = Math.min(minX, p.segmentStart.x, p.segmentEnd.x);
        maxX = Math.max(maxX, p.segmentStart.x, p.segmentEnd.x);
        minZ = Math.min(minZ, p.segmentStart.z, p.segmentEnd.z);
        maxZ = Math.max(maxZ, p.segmentStart.z, p.segmentEnd.z);
      }
    } else {
      // Horizontal plane
      if (label.includes('ceiling') || (p.normal.y < -0.5 && p.center.y > 1.9)) {
        ceilingY = Math.max(2.1, p.center.y);
        extraSlots.push({
          id: `xr-ceil-${i}`,
          type: 'CeilingAnchor',
          position: { x: p.center.x, y: p.center.y, z: p.center.z },
          normal: { x: 0, y: -1, z: 0 },
          label: `Live XR ceiling (${p.center.x.toFixed(1)}m, ${p.center.z.toFixed(1)}m)`,
          clearanceMeters: p.center.y,
          recommendedArchetype: 'CeilingHang',
        });
      } else if (!label.includes('floor') && p.center.y >= 0.42 && p.center.y <= 1.35) {
        furniture.push({
          id: `xr-furn-${i}`,
          label: p.semanticLabel || 'Real Surface',
          kind: p.center.y >= 0.68 ? 'table' : 'sofa',
          center: { x: p.center.x, z: p.center.z },
          width: Math.max(0.6, p.width),
          depth: Math.max(0.6, p.depthOrHeight),
          height: p.center.y,
          underClearance: p.center.y >= 0.6 ? p.center.y - 0.06 : 0.18,
          rotationY: 0,
        });
      }
    }
  }

  // Fallback relative anchors if headset has not scanned Room Setup planes yet
  if (walls.length === 0) {
    const r = 2.4;
    const cardinals = [
      { dx: 0, dz: -1, label: 'Ahead real space' },
      { dx: 1, dz: 0, label: 'Right flank space' },
      { dx: -1, dz: 0, label: 'Left flank space' },
      { dx: 0, dz: 1, label: 'Rear blind spot' },
    ];
    cardinals.forEach((c, idx) => {
      const px = playerPos.x + c.dx * r;
      const pz = playerPos.z + c.dz * r;
      extraSlots.push({
        id: `xr-rel-wall-${idx}`,
        type: idx % 2 === 0 ? 'CornerSlot' : 'WallPeelSlot',
        position: { x: px, y: 0, z: pz },
        normal: { x: -c.dx, y: 0, z: -c.dz },
        label: `${c.label} (${r.toFixed(1)}m)`,
        clearanceMeters: r,
        recommendedArchetype: idx === 3 ? 'CornerWatcher' : 'WallPeel',
      });
    });
  }

  const width = Math.max(3.2, Number((maxX - minX).toFixed(2)));
  const depth = Math.max(3.2, Number((maxZ - minZ).toFixed(2)));

  const room: RoomLayout = {
    id: 'xr-live-room',
    name: planes.length > 0 ? `Live XR Room (${planes.length} planes)` : 'Live XR Space (Unscanned)',
    preset: 'random',
    width,
    depth,
    height: ceilingY,
    spawnPosition: { ...playerPos },
    spawnYawRad: playerYawRad,
    walls,
    doorways,
    furniture,
  };

  const extracted = extractSpatialSlots(room);
  const merged = [...extracted];
  const seenIds = new Set(merged.map((s) => s.id));
  for (const s of extraSlots) {
    if (!seenIds.has(s.id)) merged.push(s);
  }

  return { room, slots: merged };
}
