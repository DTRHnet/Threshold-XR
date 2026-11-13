import type {
  DoorwayOpening,
  FurniturePiece,
  RoomLayout,
  RoomPresetId,
  Vec2,
  WallSegment,
} from './types';

function computeInwardNormal(start: Vec2, end: Vec2, roomCenter: Vec2): Vec2 {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const len = Math.hypot(dx, dz) || 1;
  // Two perpendicular candidates
  const n1 = { x: -dz / len, z: dx / len };
  const midX = (start.x + end.x) * 0.5;
  const midZ = (start.z + end.z) * 0.5;
  const toCenterX = roomCenter.x - midX;
  const toCenterZ = roomCenter.z - midZ;
  const dot = n1.x * toCenterX + n1.z * toCenterZ;
  return dot >= 0 ? n1 : { x: -n1.x, z: -n1.z };
}

function makeWall(
  id: string,
  start: Vec2,
  end: Vec2,
  height: number,
  roomCenter: Vec2,
  hasDoorGap = false,
): WallSegment {
  return {
    id,
    start,
    end,
    height,
    thickness: 0.16,
    inwardNormal: computeInwardNormal(start, end, roomCenter),
    hasDoorGap,
  };
}

/**
 * Generates rectangular outer perimeter walls with optional doorway gaps split into left/right jamb walls.
 */
function buildPerimeterWithDoorway(
  width: number,
  depth: number,
  height: number,
  doorWall: 'north' | 'east' | 'west',
  doorOffsetRatio = 0.5,
  doorWidth = 1.05,
): { walls: WallSegment[]; doorways: DoorwayOpening[] } {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const center = { x: 0, z: 0 };
  const walls: WallSegment[] = [];
  const doorways: DoorwayOpening[] = [];

  // South wall (solid, behind default spawn)
  walls.push(
    makeWall('wall-south', { x: -hw, z: hd }, { x: hw, z: hd }, height, center),
  );

  // North wall
  if (doorWall === 'north') {
    const doorCx = -hw + width * doorOffsetRatio;
    const leftEnd = doorCx - doorWidth * 0.5;
    const rightStart = doorCx + doorWidth * 0.5;
    walls.push(
      makeWall(
        'wall-north-l',
        { x: -hw, z: -hd },
        { x: leftEnd, z: -hd },
        height,
        center,
        true,
      ),
    );
    walls.push(
      makeWall(
        'wall-north-r',
        { x: rightStart, z: -hd },
        { x: hw, z: -hd },
        height,
        center,
        true,
      ),
    );
    doorways.push({
      id: 'door-north',
      center: { x: doorCx, z: -hd },
      width: doorWidth,
      height: Math.min(2.15, height - 0.25),
      outwardNormal: { x: 0, z: -1 },
      jambLeft: { x: leftEnd, z: -hd },
      jambRight: { x: rightStart, z: -hd },
    });
  } else {
    walls.push(
      makeWall('wall-north', { x: -hw, z: -hd }, { x: hw, z: -hd }, height, center),
    );
  }

  // West wall
  if (doorWall === 'west') {
    const doorCz = -hd + depth * doorOffsetRatio;
    const topEnd = doorCz - doorWidth * 0.5;
    const botStart = doorCz + doorWidth * 0.5;
    walls.push(
      makeWall(
        'wall-west-t',
        { x: -hw, z: -hd },
        { x: -hw, z: topEnd },
        height,
        center,
        true,
      ),
    );
    walls.push(
      makeWall(
        'wall-west-b',
        { x: -hw, z: botStart },
        { x: -hw, z: hd },
        height,
        center,
        true,
      ),
    );
    doorways.push({
      id: 'door-west',
      center: { x: -hw, z: doorCz },
      width: doorWidth,
      height: Math.min(2.15, height - 0.25),
      outwardNormal: { x: -1, z: 0 },
      jambLeft: { x: -hw, z: topEnd },
      jambRight: { x: -hw, z: botStart },
    });
  } else {
    walls.push(
      makeWall('wall-west', { x: -hw, z: -hd }, { x: -hw, z: hd }, height, center),
    );
  }

  // East wall
  if (doorWall === 'east') {
    const doorCz = -hd + depth * doorOffsetRatio;
    const topEnd = doorCz - doorWidth * 0.5;
    const botStart = doorCz + doorWidth * 0.5;
    walls.push(
      makeWall(
        'wall-east-t',
        { x: hw, z: -hd },
        { x: hw, z: topEnd },
        height,
        center,
        true,
      ),
    );
    walls.push(
      makeWall(
        'wall-east-b',
        { x: hw, z: botStart },
        { x: hw, z: hd },
        height,
        center,
        true,
      ),
    );
    doorways.push({
      id: 'door-east',
      center: { x: hw, z: doorCz },
      width: doorWidth,
      height: Math.min(2.15, height - 0.25),
      outwardNormal: { x: 1, z: 0 },
      jambLeft: { x: hw, z: topEnd },
      jambRight: { x: hw, z: botStart },
    });
  } else {
    walls.push(
      makeWall('wall-east', { x: hw, z: -hd }, { x: hw, z: hd }, height, center),
    );
  }

  return { walls, doorways };
}

export function createRoomPreset(preset: RoomPresetId, seed = 1): RoomLayout {
  if (preset === 'studio') {
    const { walls, doorways } = buildPerimeterWithDoorway(6.4, 5.8, 2.8, 'north', 0.32, 1.05);
    const furniture: FurniturePiece[] = [
      {
        id: 'furn-dining-table',
        label: 'Dining Table',
        kind: 'table',
        center: { x: 1.55, z: -1.1 },
        width: 1.7,
        depth: 0.95,
        height: 0.78,
        underClearance: 0.68,
        rotationY: 0,
      },
      {
        id: 'furn-sofa',
        label: 'Low Sofa',
        kind: 'sofa',
        center: { x: -1.7, z: 0.75 },
        width: 1.05,
        depth: 2.15,
        height: 0.82,
        underClearance: 0.16,
        rotationY: 0,
      },
      {
        id: 'furn-desk',
        label: 'Work Desk',
        kind: 'desk',
        center: { x: 1.9, z: 1.75 },
        width: 1.55,
        depth: 0.75,
        height: 0.76,
        underClearance: 0.66,
        rotationY: 0,
      },
    ];
    return {
      id: 'room-studio',
      name: 'Studio Apartment',
      preset: 'studio',
      width: 6.4,
      depth: 5.8,
      height: 2.8,
      spawnPosition: { x: 0, y: 1.65, z: 1.45 },
      spawnYawRad: 0, // Facing -Z (north doorway & open room)
      walls,
      doorways,
      furniture,
    };
  }

  if (preset === 'hallway') {
    const { walls, doorways } = buildPerimeterWithDoorway(3.2, 8.8, 2.75, 'north', 0.5, 1.0);
    // Add an interior partition stub for an eerie L-bend blind corner
    walls.push(
      makeWall(
        'wall-partition-1',
        { x: -1.6, z: -0.6 },
        { x: -0.2, z: -0.6 },
        2.75,
        { x: 0.6, z: 1.2 },
      ),
    );
    const furniture: FurniturePiece[] = [
      {
        id: 'furn-console-table',
        label: 'Console Table',
        kind: 'table',
        center: { x: 1.15, z: 0.9 },
        width: 0.65,
        depth: 1.6,
        height: 0.84,
        underClearance: 0.72,
        rotationY: 0,
      },
      {
        id: 'furn-hall-cabinet',
        label: 'Storage Cabinet',
        kind: 'cabinet',
        center: { x: -1.18, z: -2.4 },
        width: 0.65,
        depth: 1.1,
        height: 1.65,
        underClearance: 0,
        rotationY: 0,
      },
    ];
    return {
      id: 'room-hallway',
      name: 'Narrow Hallway',
      preset: 'hallway',
      width: 3.2,
      depth: 8.8,
      height: 2.75,
      spawnPosition: { x: 0.25, y: 1.65, z: 3.1 },
      spawnYawRad: 0,
      walls,
      doorways,
      furniture,
    };
  }

  if (preset === 'office') {
    const { walls, doorways } = buildPerimeterWithDoorway(6.8, 6.2, 2.9, 'east', 0.35, 1.1);
    const furniture: FurniturePiece[] = [
      {
        id: 'furn-exec-desk',
        label: 'Conference Desk',
        kind: 'desk',
        center: { x: -1.35, z: -1.25 },
        width: 2.1,
        depth: 1.05,
        height: 0.77,
        underClearance: 0.68,
        rotationY: 0,
      },
      {
        id: 'furn-side-table',
        label: 'Drafting Table',
        kind: 'table',
        center: { x: -2.25, z: 1.55 },
        width: 1.35,
        depth: 0.85,
        height: 0.82,
        underClearance: 0.72,
        rotationY: 0,
      },
      {
        id: 'furn-filing-cabinet',
        label: 'Filing Cabinet',
        kind: 'cabinet',
        center: { x: 2.85, z: 2.1 },
        width: 0.75,
        depth: 1.1,
        height: 1.55,
        underClearance: 0,
        rotationY: 0,
      },
    ];
    return {
      id: 'room-office',
      name: 'Late-Night Office',
      preset: 'office',
      width: 6.8,
      depth: 6.2,
      height: 2.9,
      spawnPosition: { x: 0.35, y: 1.65, z: 1.5 },
      spawnYawRad: 0.22,
      walls,
      doorways,
      furniture,
    };
  }

  // Deterministic pseudo-random room layout
  const s = (n: number) => {
    const x = Math.sin(seed * 9301 + n * 49297) * 233280;
    return x - Math.floor(x);
  };
  const width = 5.2 + s(1) * 2.8;
  const depth = 5.2 + s(2) * 2.8;
  const height = 2.65 + s(3) * 0.55;
  const doorWalls: Array<'north' | 'east' | 'west'> = ['north', 'east', 'west'];
  const doorWall = doorWalls[Math.floor(s(4) * doorWalls.length)];
  const doorOffset = 0.25 + s(5) * 0.5;
  const { walls, doorways } = buildPerimeterWithDoorway(width, depth, height, doorWall, doorOffset, 1.05);

  const furniture: FurniturePiece[] = [
    {
      id: 'furn-rand-desk',
      label: 'Desk',
      kind: 'desk',
      center: {
        x: (s(6) - 0.5) * (width - 2.6),
        z: -depth * 0.25,
      },
      width: 1.65,
      depth: 0.85,
      height: 0.76,
      underClearance: 0.66,
      rotationY: 0,
    },
    {
      id: 'furn-rand-table',
      label: 'Table',
      kind: 'table',
      center: {
        x: (s(7) > 0.5 ? 1 : -1) * (width * 0.28),
        z: depth * 0.12,
      },
      width: 1.25,
      depth: 0.9,
      height: 0.8,
      underClearance: 0.7,
      rotationY: 0,
    },
  ];

  return {
    id: `room-random-${seed}`,
    name: `Mapped Space #${String(seed).padStart(2, '0')}`,
    preset: 'random',
    width: Number(width.toFixed(2)),
    depth: Number(depth.toFixed(2)),
    height: Number(height.toFixed(2)),
    spawnPosition: { x: 0, y: 1.65, z: depth * 0.28 },
    spawnYawRad: 0,
    walls,
    doorways,
    furniture,
  };
}
