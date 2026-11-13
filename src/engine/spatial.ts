import type {
  AIScareSpot,
  AttentionSector,
  AttentionState,
  HorrorPhase,
  RoomLayout,
  SpatialSlot,
  ThreatArchetype,
  Vec2,
  Vec3,
} from './types';

export const SECTOR_COUNT = 36;

export function normalizeAngleRad(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function extractSpatialSlots(room: RoomLayout): SpatialSlot[] {
  const slots: SpatialSlot[] = [];

  // 1. CornerSlot extraction: pairwise perpendicular wall endpoint intersections
  const seenCorners = new Set<string>();
  for (let i = 0; i < room.walls.length; i++) {
    const a = room.walls[i];
    const aEndpoints = [a.start, a.end];
    for (let j = i + 1; j < room.walls.length; j++) {
      const b = room.walls[j];
      const dot = Math.abs(
        a.inwardNormal.x * b.inwardNormal.x + a.inwardNormal.z * b.inwardNormal.z,
      );
      if (dot > 0.25) continue;

      const bEndpoints = [b.start, b.end];
      for (const pa of aEndpoints) {
        for (const pb of bEndpoints) {
          const dist = Math.hypot(pa.x - pb.x, pa.z - pb.z);
          if (dist <= 0.35) {
            const cx = (pa.x + pb.x) * 0.5;
            const cz = (pa.z + pb.z) * 0.5;
            const key = `${Math.round(cx * 5)}:${Math.round(cz * 5)}`;
            if (seenCorners.has(key)) continue;
            seenCorners.add(key);

            const bx = a.inwardNormal.x + b.inwardNormal.x;
            const bz = a.inwardNormal.z + b.inwardNormal.z;
            const bLen = Math.hypot(bx, bz) || 1;
            const nx = bx / bLen;
            const nz = bz / bLen;

            slots.push({
              id: `slot-corner-${slots.length + 1}`,
              type: 'CornerSlot',
              position: { x: cx + nx * 0.28, y: 0, z: cz + nz * 0.28 },
              normal: { x: nx, y: 0, z: nz },
              label: `Corner seam (${cx.toFixed(1)}m, ${cz.toFixed(1)}m)`,
              clearanceMeters: 1.6,
              recommendedArchetype: 'CornerWatcher',
            });
          }
        }
      }
    }
  }

  // 2. DoorwaySlot extraction: openings framed by solid wall jambs
  for (const door of room.doorways) {
    // Place entity slightly outside threshold & shifted toward left/right jamb so jamb occludes ~40%
    const tangentX = -door.outwardNormal.z;
    const tangentZ = door.outwardNormal.x;
    const peekPos: Vec3 = {
      x: door.center.x + door.outwardNormal.x * 0.28 + tangentX * (door.width * 0.24),
      y: 0,
      z: door.center.z + door.outwardNormal.z * 0.28 + tangentZ * (door.width * 0.24),
    };
    slots.push({
      id: `slot-door-${door.id}`,
      type: 'DoorwaySlot',
      position: peekPos,
      normal: {
        x: -door.outwardNormal.x,
        y: 0,
        z: -door.outwardNormal.z,
      },
      label: `Doorway threshold (${door.center.x.toFixed(1)}m, ${door.center.z.toFixed(1)}m)`,
      clearanceMeters: 1.8,
      occlusionAnchorId: door.id,
      recommendedArchetype: 'DoorwayPeeker',
    });
  }

  // 3. UnderVoidSlot extraction: elevated furniture surfaces with floor clearance >= 0.45m
  for (const furn of room.furniture) {
    if (furn.underClearance >= 0.45) {
      // Direction pointing toward room center from furniture
      const len = Math.hypot(furn.center.x, furn.center.z) || 1;
      const nx = -furn.center.x / len;
      const nz = -furn.center.z / len;
      slots.push({
        id: `slot-void-${furn.id}`,
        type: 'UnderVoidSlot',
        position: {
          x: furn.center.x + nx * (Math.min(furn.width, furn.depth) * 0.22),
          y: 0,
          z: furn.center.z + nz * (Math.min(furn.width, furn.depth) * 0.22),
        },
        normal: { x: nx, y: 0, z: nz },
        label: `Under ${furn.label} (${furn.underClearance.toFixed(2)}m void)`,
        clearanceMeters: furn.underClearance,
        occlusionAnchorId: furn.id,
        recommendedArchetype: 'UnderVoidCrawler',
      });
    }
  }

  // 4. WallPeelSlot extraction: vertical wall spans >= 1.5m wide
  for (const wall of room.walls) {
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
    if (length < 1.5) continue;
    const mx = (wall.start.x + wall.end.x) * 0.5;
    const mz = (wall.start.z + wall.end.z) * 0.5;
    slots.push({
      id: `slot-wall-${wall.id}`,
      type: 'WallPeelSlot',
      position: {
        x: mx + wall.inwardNormal.x * 0.08,
        y: 0,
        z: mz + wall.inwardNormal.z * 0.08,
      },
      normal: { x: wall.inwardNormal.x, y: 0, z: wall.inwardNormal.z },
      label: `Wall plane (${wall.id}, ${length.toFixed(1)}m span)`,
      clearanceMeters: length,
      occlusionAnchorId: wall.id,
      recommendedArchetype: 'WallPeel',
    });
  }

  // 5. CeilingAnchor extraction: inverted hanging zones offset from center
  const ceilingOffsets: Vec2[] = [
    { x: -room.width * 0.26, z: -room.depth * 0.24 },
    { x: room.width * 0.26, z: -room.depth * 0.22 },
  ];
  ceilingOffsets.forEach((pt, idx) => {
    slots.push({
      id: `slot-ceiling-${idx + 1}`,
      type: 'CeilingAnchor',
      position: { x: pt.x, y: room.height, z: pt.z },
      normal: { x: 0, y: -1, z: 0 },
      label: `Overhead ceiling plane (${pt.x.toFixed(1)}m, ${pt.z.toFixed(1)}m)`,
      clearanceMeters: room.height,
      recommendedArchetype: 'CeilingHang',
    });
  });

  return slots;
}

export function createInitialAttention(
  spawnPos: Vec3,
  spawnYawRad: number,
  nowSec = 0,
): AttentionState {
  const sectors: AttentionSector[] = [];
  for (let i = 0; i < SECTOR_COUNT; i++) {
    const centerAngleRad = normalizeAngleRad((i / SECTOR_COUNT) * Math.PI * 2);
    sectors.push({
      index: i,
      centerAngleRad,
      lastLookedAtSec: -999,
      dwellSeconds: 0,
    });
  }
  return {
    sectors,
    playerPosition: { ...spawnPos },
    playerYawRad: spawnYawRad,
    pitchRad: 0,
    angularVelocityRadPerSec: 0,
    signedYawVelocityRadPerSec: 0,
    pitchVelocityRadPerSec: 0,
    predictedYawRad: spawnYawRad,
    movementSpeedMps: 0,
    moveDirX: 0,
    moveDirZ: 0,
    history: [{ timeSec: nowSec, yawRad: spawnYawRad, pitchRad: 0 }],
    lastUpdateSec: nowSec,
  };
}

/**
 * Forward direction in Three.js yaw convention:
 * yaw = 0 faces -Z (0, 0, -1). Turning left (+yaw) rotates toward -X (-sin(yaw), 0, -cos(yaw)).
 */
export function yawToForward(yawRad: number): Vec2 {
  return {
    x: -Math.sin(yawRad),
    z: -Math.cos(yawRad),
  };
}

export function angleFromPlayerForwardRad(
  playerPos: Vec3,
  playerYawRad: number,
  targetPos: Vec3,
): number {
  const fwd = yawToForward(playerYawRad);
  const dx = targetPos.x - playerPos.x;
  const dz = targetPos.z - playerPos.z;
  const len = Math.hypot(dx, dz) || 1;
  const dirX = dx / len;
  const dirZ = dz / len;
  const dot = Math.max(-1, Math.min(1, fwd.x * dirX + fwd.z * dirZ));
  return Math.acos(dot);
}

export function azimuthDegRelativeToPlayer(
  playerPos: Vec3,
  playerYawRad: number,
  targetPos: Vec3,
): number {
  const fwd = yawToForward(playerYawRad);
  const rightX = -fwd.z;
  const rightZ = fwd.x;
  const dx = targetPos.x - playerPos.x;
  const dz = targetPos.z - playerPos.z;
  const forwardProj = dx * fwd.x + dz * fwd.z;
  const rightProj = dx * rightX + dz * rightZ;
  return (Math.atan2(rightProj, forwardProj) * 180) / Math.PI;
}

export function updateAttention(
  prev: AttentionState,
  playerPos: Vec3,
  playerYawRad: number,
  nowSec: number,
  pitchRad = 0,
): AttentionState {
  const dt = Math.max(0.001, nowSec - prev.lastUpdateSec);
  const deltaYaw = normalizeAngleRad(playerYawRad - prev.playerYawRad);
  const deltaPitch = pitchRad - prev.pitchRad;
  const instantSignedYawVel = deltaYaw / dt;
  const pitchVelocityRadPerSec = deltaPitch / dt;

  // Maintain ~0.9s camera orientation history for stable turn-direction prediction (100-300ms ahead)
  const history = prev.history
    .filter((sample) => nowSec - sample.timeSec <= 0.9)
    .concat({ timeSec: nowSec, yawRad: playerYawRad, pitchRad });

  let signedYawVelocityRadPerSec = instantSignedYawVel;
  if (history.length >= 2) {
    const windowAnchor =
      history.find((s) => nowSec - s.timeSec <= 0.25) ?? history[0];
    const windowDt = nowSec - windowAnchor.timeSec;
    if (windowDt >= 0.04) {
      const windowDeltaYaw = normalizeAngleRad(playerYawRad - windowAnchor.yawRad);
      // Blend window turn trend with instantaneous velocity for crisp intercept response
      signedYawVelocityRadPerSec =
        (windowDeltaYaw / windowDt) * 0.65 + instantSignedYawVel * 0.35;
    }
  }

  const angularVelocityRadPerSec = Math.abs(signedYawVelocityRadPerSec);
  const leadOffset = Math.max(-0.8, Math.min(0.8, signedYawVelocityRadPerSec * 0.22));
  const predictedYawRad = normalizeAngleRad(playerYawRad + leadOffset);

  const mdx = playerPos.x - prev.playerPosition.x;
  const mdz = playerPos.z - prev.playerPosition.z;
  const moveDist = Math.hypot(mdx, mdz);
  const movementSpeedMps = moveDist / dt;
  const moveDirX = moveDist > 0.002 ? mdx / moveDist : prev.moveDirX;
  const moveDirZ = moveDist > 0.002 ? mdz / moveDist : prev.moveDirZ;

  // Player heading azimuth in [-PI, PI]
  const fwd = yawToForward(playerYawRad);
  const headingAzimuth = Math.atan2(fwd.x, -fwd.z);
  const halfFov = (42 * Math.PI) / 180; // ~84 deg horizontal central inspection cone

  const sectors = prev.sectors.map((sector) => {
    const diff = Math.abs(normalizeAngleRad(sector.centerAngleRad - headingAzimuth));
    if (diff <= halfFov) {
      return {
        ...sector,
        lastLookedAtSec: nowSec,
        dwellSeconds: sector.dwellSeconds + dt,
      };
    }
    return sector;
  });

  return {
    sectors,
    playerPosition: { ...playerPos },
    playerYawRad,
    pitchRad,
    angularVelocityRadPerSec,
    signedYawVelocityRadPerSec,
    pitchVelocityRadPerSec,
    predictedYawRad,
    movementSpeedMps,
    moveDirX,
    moveDirZ,
    history,
    lastUpdateSec: nowSec,
  };
}

/** 2D ray-segment intersection distance t along ray [0..1] */
function rayIntersectsSegment2D(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDist: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const sx = bx - ax;
  const sz = bz - az;
  const denom = dx * sz - dz * sx;
  if (Math.abs(denom) < 1e-6) return false;

  const qpx = ax - ox;
  const qpz = az - oz;
  const t = (qpx * sz - qpz * sx) / denom;
  const u = (qpx * dz - qpz * dx) / denom;
  return t > 0.05 && t < maxDist - 0.12 && u >= 0 && u <= 1;
}

/**
 * Casts 5 horizontal sample rays across the candidate slot width against room walls & furniture
 * to measure how much of the silhouette is naturally occluded by real geometry (ideal peek: 0.25..0.65).
 */
export function computeOcclusionRatio(
  room: RoomLayout,
  playerPos: Vec3,
  slot: SpatialSlot,
): number {
  const toSlotX = slot.position.x - playerPos.x;
  const toSlotZ = slot.position.z - playerPos.z;
  const dist = Math.hypot(toSlotX, toSlotZ) || 1;
  const dirX = toSlotX / dist;
  const dirZ = toSlotZ / dist;
  const perpX = -dirZ;
  const perpZ = dirX;

  const sampleOffsets = [-0.28, -0.14, 0, 0.14, 0.28];
  let blocked = 0;

  for (const offset of sampleOffsets) {
    const tx = slot.position.x + perpX * offset;
    const tz = slot.position.z + perpZ * offset;
    const rdx = tx - playerPos.x;
    const rdz = tz - playerPos.z;
    const rLen = Math.hypot(rdx, rdz) || 1;
    const ndx = rdx / rLen;
    const ndz = rdz / rLen;

    let hit = false;
    for (const w of room.walls) {
      if (
        rayIntersectsSegment2D(
          playerPos.x,
          playerPos.z,
          ndx,
          ndz,
          rLen,
          w.start.x,
          w.start.z,
          w.end.x,
          w.end.z,
        )
      ) {
        hit = true;
        break;
      }
    }
    if (hit) blocked++;
  }

  return blocked / sampleOffsets.length;
}

export function getSectorAgeForTarget(
  attention: AttentionState,
  targetPos: Vec3,
  nowSec: number,
): number {
  const dx = targetPos.x - attention.playerPosition.x;
  const dz = targetPos.z - attention.playerPosition.z;
  const targetAz = Math.atan2(dx, -dz);
  let best = attention.sectors[0];
  let bestDiff = Infinity;
  for (const s of attention.sectors) {
    const d = Math.abs(normalizeAngleRad(s.centerAngleRad - targetAz));
    if (d < bestDiff) {
      bestDiff = d;
      best = s;
    }
  }
  return best.lastLookedAtSec < 0 ? 999 : Math.max(0, nowSec - best.lastLookedAtSec);
}

/**
 * Deterministic utility scorer used both as local fallback and to provide feature telemetry to Gemini.
 */
export function scoreSlotsLocally(
  room: RoomLayout,
  slots: SpatialSlot[],
  attention: AttentionState,
  phase: HorrorPhase,
  recentlyUsedSlotIds: string[],
  nowSec: number,
): AIScareSpot[] {
  const recentSet = new Set(recentlyUsedSlotIds);

  const scored = slots.map((slot) => {
    const angleDeg =
      (angleFromPlayerForwardRad(attention.playerPosition, attention.playerYawRad, slot.position) *
        180) /
      Math.PI;
    const dist = Math.hypot(
      slot.position.x - attention.playerPosition.x,
      slot.position.z - attention.playerPosition.z,
    );
    const occlusion = computeOcclusionRatio(room, attention.playerPosition, slot);
    const clearedAge = getSectorAgeForTarget(attention, slot.position, nowSec);

    // 1. Blindspot / Peripheral preference
    let blindspotScore = 0;
    if (angleDeg >= 55 && angleDeg <= 105) {
      blindspotScore = 38; // Edge of peripheral vision
    } else if (angleDeg > 105) {
      blindspotScore = 34; // Behind player for audio-baited turn reveal
    } else if (angleDeg >= 30) {
      blindspotScore = 18;
    } else {
      blindspotScore = 6; // Directly in front: poor surprise unless heavily occluded
    }

    // 2. Occlusion peek bonus (best when 20%-60% occluded by doorframe/wall)
    let occlusionScore = 0;
    if (occlusion >= 0.2 && occlusion <= 0.65) {
      occlusionScore = 24;
    } else if (occlusion > 0.65) {
      occlusionScore = 6;
    } else {
      occlusionScore = 14;
    }

    // 3. "Just cleared" betrayal bonus in later phases
    let betrayalScore = 0;
    if (clearedAge >= 4 && clearedAge <= 16 && angleDeg > 60) {
      betrayalScore = phase === 'SpatialBetrayal' || phase === 'Compression' ? 28 : 16;
    }

    // 4. Distance sweet spot (1.5m - 4.8m)
    let distanceScore = 16;
    if (dist < 1.1) distanceScore = 2;
    else if (dist > 6.5) distanceScore = 8;

    // 5. Phase-specific slot type boost
    let phaseBoost = 0;
    if (phase === 'PeripheralDoubt' && (slot.type === 'WallPeelSlot' || slot.type === 'CornerSlot')) {
      phaseBoost = 12;
    } else if (
      phase === 'Occupation' &&
      (slot.type === 'DoorwaySlot' || slot.type === 'UnderVoidSlot')
    ) {
      phaseBoost = 14;
    } else if (phase === 'Compression' && (slot.type === 'CeilingAnchor' || slot.type === 'CornerSlot')) {
      phaseBoost = 14;
    }

    const freshnessPenalty = recentSet.has(slot.id) ? 35 : 0;
    const total = Math.max(
      1,
      Math.min(
        99,
        Math.round(
          blindspotScore + occlusionScore + betrayalScore + distanceScore + phaseBoost - freshnessPenalty,
        ),
      ),
    );

    const azimuthDeg = Math.round(
      azimuthDegRelativeToPlayer(attention.playerPosition, attention.playerYawRad, slot.position),
    );

    const archetype: ThreatArchetype = slot.recommendedArchetype;
    const reasonParts: string[] = [];
    if (angleDeg > 105) reasonParts.push(`outside direct FOV (${Math.round(angleDeg)}° off-axis)`);
    else if (angleDeg >= 55) reasonParts.push(`peripheral edge (${Math.round(angleDeg)}° off-axis)`);
    if (occlusion >= 0.2 && occlusion <= 0.65) {
      reasonParts.push(`${Math.round(occlusion * 100)}% occluded by room geometry`);
    }
    if (clearedAge >= 4 && clearedAge <= 16) {
      reasonParts.push(`sector cleared ${Math.round(clearedAge)}s ago`);
    }
    if (reasonParts.length === 0) {
      reasonParts.push(`${slot.type.replace('Slot', '')} anchor at ${dist.toFixed(1)}m`);
    }

    return {
      slotId: slot.id,
      score: total,
      archetype,
      psychologyReason: `Exploits ${reasonParts.join('; ')}.`,
      audioBaitAzimuthDeg: azimuthDeg,
      recommendedDelaySec: angleDeg > 105 ? 1.4 : 0.4,
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}
