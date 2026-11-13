import {
  angleFromPlayerForwardRad,
  azimuthDegRelativeToPlayer,
  scoreSlotsLocally,
  yawToForward,
} from './spatial';
import type {
  AIScarePlan,
  ActiveThreat,
  AttentionState,
  HorrorPhase,
  RoomLayout,
  SpatialSlot,
  Vec3,
} from './types';

export type SpatialAudioCueKind =
  | 'scrape'
  | 'breath'
  | 'creak'
  | 'inhale'
  | 'knocks'
  | 'whisper'
  | 'footstep';

export type VisualAnomalyKind = 'brownout' | 'peripheral_dart' | 'shadow_crawl' | 'blackout';

export interface ScareImpactTrigger {
  kind: 'face_stinger' | 'snap_stinger' | 'intercept_hit' | 'blackout_reveal';
  intensity: number;
  cameraPunch: boolean;
  azimuthDeg: number;
}

export interface DirectorState {
  phase: HorrorPhase;
  progress: number;
  activeThreats: ActiveThreat[];
  recentlyUsedSlotIds: string[];
  nextEventAtSec: number;
  nextAnomalyAtSec: number;
  stillnessSeconds: number;
  scareReadiness: number;
  lastScareHitAtSec: number;
  lastPlayerYawRad: number;
  spotsUsedCount: number;
  subThresholdGasps: number;
  lastBaitAtSec: number;
}

export function computeHorrorPhase(progress: number): HorrorPhase {
  // Baseline is a short breath, not dead air: it exists to let the player settle and
  // register the silence before the first intrusion, not to stall them for 20+ seconds.
  if (progress < 0.05) return 'Baseline';
  if (progress < 0.36) return 'PeripheralDoubt';
  if (progress < 0.68) return 'Occupation';
  if (progress < 0.88) return 'SpatialBetrayal';
  return 'Compression';
}

export function createDirectorState(targetDurationSec: number): DirectorState {
  const firstEventDelay = Math.max(4.5, targetDurationSec * 0.055);
  return {
    phase: 'Baseline',
    progress: 0,
    activeThreats: [],
    recentlyUsedSlotIds: [],
    nextEventAtSec: firstEventDelay,
    nextAnomalyAtSec: Math.max(3.5, targetDurationSec * 0.05),
    stillnessSeconds: 0,
    scareReadiness: 0.15,
    lastScareHitAtSec: -999,
    lastPlayerYawRad: 0,
    spotsUsedCount: 0,
    subThresholdGasps: 0,
    lastBaitAtSec: -999,
  };
}

export interface DirectorTickResult {
  state: DirectorState;
  audioBaitToTrigger: { azimuthDeg: number; kind: SpatialAudioCueKind } | null;
  visualAnomalyToTrigger: { kind: VisualAnomalyKind; azimuthDeg: number } | null;
  scareImpactToTrigger: ScareImpactTrigger | null;
  tensionTelemetry: {
    tensionLevel: number;
    nearestThreatAngleDeg: number;
    stillnessSeconds: number;
    scareReadiness: number;
    hasActiveThreat: boolean;
  };
  needsAiRefresh: boolean;
}

function clampToRoom(room: RoomLayout, x: number, z: number): { x: number; z: number } {
  // Keep positions comfortably inside virtual presets while allowing free XR physical coordinates
  if (room.id === 'xr-live-room' && room.walls.length === 0) {
    return { x, z };
  }
  const hw = Math.max(1.2, room.width * 0.5 - 0.38);
  const hd = Math.max(1.2, room.depth * 0.5 - 0.38);
  return {
    x: Math.max(-hw, Math.min(hw, x)),
    z: Math.max(-hd, Math.min(hd, z)),
  };
}

export function stepThreatDirector(
  prev: DirectorState,
  room: RoomLayout,
  slots: SpatialSlot[],
  attention: AttentionState,
  aiPlan: AIScarePlan | null,
  elapsedSec: number,
  targetDurationSec: number,
  dt: number,
  subThresholdGaspRatio: number,
): DirectorTickResult {
  const progress = Math.max(0, Math.min(1, elapsedSec / Math.max(1, targetDurationSec)));
  const phase = computeHorrorPhase(progress);
  let audioBaitToTrigger: DirectorTickResult['audioBaitToTrigger'] = null;
  let visualAnomalyToTrigger: DirectorTickResult['visualAnomalyToTrigger'] = null;
  let scareImpactToTrigger: DirectorTickResult['scareImpactToTrigger'] = null;
  let needsAiRefresh = false;

  const yawDelta = Math.abs(attention.playerYawRad - prev.lastPlayerYawRad);
  const isHoldingStill = yawDelta < 0.025 && attention.angularVelocityRadPerSec < 0.18;
  const stillnessSeconds = isHoldingStill ? prev.stillnessSeconds + dt : 0;

  const subThresholdGasps =
    subThresholdGaspRatio > 0.72 && elapsedSec - prev.lastBaitAtSec > 4
      ? prev.subThresholdGasps + 1
      : prev.subThresholdGasps;

  // Readiness builds slowly during quiet safe periods (faster later & while holding still)
  const quietMultiplier =
    phase === 'Baseline'
      ? 0.45
      : phase === 'PeripheralDoubt'
        ? 0.85
        : phase === 'Occupation'
          ? 1.15
          : 1.45;
  let scareReadiness = Math.min(
    1,
    prev.scareReadiness + dt * 0.058 * quietMultiplier + (isHoldingStill ? dt * 0.015 : 0),
  );
  let lastScareHitAtSec = prev.lastScareHitAtSec;
  let spotsUsedCount = prev.spotsUsedCount;

  // Update existing threats including PeripheralSnap glance-lunge & FaceAssault hold
  const updatedThreats: ActiveThreat[] = [];
  let nearestThreatAngleDeg = 180;

  for (const threat of prev.activeThreats) {
    const angleDeg =
      (angleFromPlayerForwardRad(attention.playerPosition, attention.playerYawRad, threat.position) *
        180) /
      Math.PI;
    const liveAz = Math.round(
      azimuthDegRelativeToPlayer(attention.playerPosition, attention.playerYawRad, threat.position),
    );
    nearestThreatAngleDeg = Math.min(nearestThreatAngleDeg, angleDeg);
    const inDirectGaze = angleDeg <= 26;
    const inPeriphery = angleDeg > 26 && angleDeg <= 72;

    let manifestation = threat.manifestation;
    let state = threat.state;
    let timeInGazeSec = threat.timeInGazeSec;
    let audioBaitPlayed = threat.audioBaitPlayed;
    let position = threat.position;
    let normal = threat.normal;
    let lungeStartPos = threat.lungeStartPos;
    let lungeProgress = threat.lungeProgress ?? 0;
    let awaitingGlanceSnap = threat.awaitingGlanceSnap ?? false;

    // 1. Peripheral -> Center Lunge trigger: as soon as player glances/turns toward peripheral lure, snap!
    if (awaitingGlanceSnap && state !== 'retreating' && state !== 'dismissed') {
      const closingAngle =
        threat.prevAngleDeg !== undefined ? angleDeg < threat.prevAngleDeg - 1.5 : false;
      const turningToward =
        liveAz !== 0 &&
        Math.sign(-liveAz) === Math.sign(attention.signedYawVelocityRadPerSec) &&
        attention.angularVelocityRadPerSec > 0.35;

      if (angleDeg <= 44 || (angleDeg <= 64 && closingAngle && turningToward)) {
        awaitingGlanceSnap = false;
        lungeStartPos = { ...position };
        lungeProgress = 0.08;
        state = 'active';
        manifestation = 1;
        scareImpactToTrigger = {
          kind: 'snap_stinger',
          intensity: 0.92,
          cameraPunch: true,
          azimuthDeg: 0,
        };
        scareReadiness = Math.max(0.05, scareReadiness - 0.5);
        lastScareHitAtSec = elapsedSec;
      }
    }

    // Advance active lunge straight toward front near-plane of camera
    if (lungeStartPos && lungeProgress > 0 && lungeProgress < 1) {
      lungeProgress = Math.min(1, lungeProgress + dt * 6.5); // ~0.15s fierce snap
      const fwd = yawToForward(attention.playerYawRad);
      const targetPos: Vec3 = {
        x: attention.playerPosition.x + fwd.x * 0.78,
        y: Math.max(0.95, attention.playerPosition.y - 0.14),
        z: attention.playerPosition.z + fwd.z * 0.78,
      };
      position = {
        x: lungeStartPos.x + (targetPos.x - lungeStartPos.x) * lungeProgress,
        y: lungeStartPos.y + (targetPos.y - lungeStartPos.y) * lungeProgress,
        z: lungeStartPos.z + (targetPos.z - lungeStartPos.z) * lungeProgress,
      };
      normal = { x: -fwd.x, y: 0, z: -fwd.z };
    }

    if (threat.scarePattern === 'FaceAssault') {
      // Hold near-plane face in front of camera briefly (0.72s) then retreat swiftly
      const fwd = yawToForward(attention.playerYawRad);
      position = {
        x: attention.playerPosition.x + fwd.x * 0.64,
        y: Math.max(0.85, attention.playerPosition.y - 0.12),
        z: attention.playerPosition.z + fwd.z * 0.64,
      };
      normal = { x: -fwd.x, y: 0, z: -fwd.z };
      const age = elapsedSec - threat.spawnedAtSec;
      if (age >= 0.72) {
        state = 'retreating';
      } else {
        manifestation = 1;
        state = 'active';
      }
    } else if (state === 'staging') {
      if (!audioBaitPlayed && elapsedSec - threat.spawnedAtSec >= 0.35 && angleDeg > 70) {
        audioBaitPlayed = true;
        audioBaitToTrigger = {
          azimuthDeg: threat.audioBaitAzimuthDeg,
          kind:
            phase === 'Compression'
              ? 'inhale'
              : phase === 'SpatialBetrayal' && prev.spotsUsedCount % 2 === 1
                ? 'knocks'
                : threat.archetype === 'WallPeel'
                  ? 'scrape'
                  : threat.archetype === 'UnderVoidCrawler'
                    ? 'creak'
                    : threat.archetype === 'DoorwayPeeker'
                      ? 'whisper'
                      : 'breath',
        };
      }
      manifestation = Math.min(1, manifestation + dt * 0.42);
      if (manifestation >= 0.45) {
        state = 'active';
      }
    } else if (state === 'active') {
      if (lungeProgress >= 1) {
        timeInGazeSec += dt;
        if (timeInGazeSec >= 0.65) state = 'retreating';
      } else if (inDirectGaze) {
        timeInGazeSec += dt;
        const stareLimit =
          threat.scarePattern === 'LookIntercept'
            ? 0.95
            : threat.archetype === 'WallPeel'
              ? 1.1
              : phase === 'Compression'
                ? 4.0
                : 2.2;
        if (timeInGazeSec >= stareLimit) {
          state = 'retreating';
        }
      } else {
        manifestation = Math.min(1, manifestation + dt * (inPeriphery ? 0.14 : 0.25));
        if (elapsedSec - threat.spawnedAtSec > 20) {
          state = 'retreating';
        }
      }
    }

    if (state === 'retreating') {
      const fadeRate =
        threat.scarePattern === 'FaceAssault' || threat.scarePattern === 'PeripheralSnap'
          ? 3.8
          : inDirectGaze
            ? 0.95
            : 0.55;
      manifestation = Math.max(0, manifestation - dt * fadeRate);
      if (manifestation <= 0.01) {
        state = 'dismissed';
      }
    }

    if (state !== 'dismissed') {
      updatedThreats.push({
        ...threat,
        position,
        normal,
        lungeStartPos,
        lungeProgress,
        awaitingGlanceSnap,
        prevAngleDeg: angleDeg,
        manifestation,
        state,
        timeInGazeSec,
        audioBaitPlayed,
      });
    }
  }

  const maxConcurrent = phase === 'Baseline' ? 0 : phase === 'Compression' ? 2 : 1;
  let nextEventAtSec = prev.nextEventAtSec;
  let nextAnomalyAtSec = prev.nextAnomalyAtSec;
  let recentlyUsedSlotIds = prev.recentlyUsedSlotIds;
  let lastBaitAtSec = prev.lastBaitAtSec;
  if (audioBaitToTrigger) lastBaitAtSec = elapsedSec;

  const canFireCamScare =
    phase !== 'Baseline' &&
    updatedThreats.length === 0 &&
    elapsedSec - lastScareHitAtSec >= 6.5;

  // HIGH-IMPACT PATTERN A: Look-Direction Intercept (head turning fast into predicted view edge)
  if (
    canFireCamScare &&
    scareReadiness >= 0.48 &&
    Math.abs(attention.signedYawVelocityRadPerSec) >= 0.45
  ) {
    const turnDir = Math.sign(attention.signedYawVelocityRadPerSec);
    // Stage 22° past predicted look direction so the turn sweeps straight into it
    const interceptYaw = attention.predictedYawRad + turnDir * 0.38;
    const fwd = yawToForward(interceptYaw);
    const dist = 1.65;
    const clamped = clampToRoom(
      room,
      attention.playerPosition.x + fwd.x * dist,
      attention.playerPosition.z + fwd.z * dist,
    );

    spotsUsedCount += 1;
    updatedThreats.push({
      id: `threat-${spotsUsedCount}`,
      slotId: 'cam-intercept',
      slotType: 'WallPeelSlot',
      archetype: 'InterceptStalker',
      scarePattern: 'LookIntercept',
      position: { x: clamped.x, y: 0, z: clamped.z },
      normal: { x: -fwd.x, y: 0, z: -fwd.z },
      manifestation: 0.92,
      state: 'active',
      spawnedAtSec: elapsedSec,
      timeInGazeSec: 0,
      audioBaitPlayed: true,
      audioBaitAzimuthDeg: turnDir > 0 ? -35 : 35,
      psychologyReason: 'Look-direction intercept staged ahead of active angular head rotation.',
    });

    scareImpactToTrigger = {
      kind: 'intercept_hit',
      intensity: 0.78,
      cameraPunch: true,
      azimuthDeg: turnDir > 0 ? -25 : 25,
    };
    scareReadiness = Math.max(0.05, scareReadiness - 0.52);
    lastScareHitAtSec = elapsedSec;
    nextEventAtSec = elapsedSec + 5.5;
  }
  // HIGH-IMPACT PATTERN B: Direct Face / Near-Plane Assault (after high quiet buildup while still)
  else if (
    canFireCamScare &&
    scareReadiness >= 0.8 &&
    stillnessSeconds >= 3.2 &&
    (phase === 'SpatialBetrayal' || phase === 'Compression')
  ) {
    const fwd = yawToForward(attention.playerYawRad);
    spotsUsedCount += 1;
    updatedThreats.push({
      id: `threat-${spotsUsedCount}`,
      slotId: 'cam-face-assault',
      slotType: 'CornerSlot',
      archetype: 'FaceAssault',
      scarePattern: 'FaceAssault',
      position: {
        x: attention.playerPosition.x + fwd.x * 0.64,
        y: Math.max(0.85, attention.playerPosition.y - 0.12),
        z: attention.playerPosition.z + fwd.z * 0.64,
      },
      normal: { x: -fwd.x, y: 0, z: -fwd.z },
      manifestation: 1.0,
      state: 'active',
      spawnedAtSec: elapsedSec,
      timeInGazeSec: 0,
      audioBaitPlayed: true,
      audioBaitAzimuthDeg: 0,
      psychologyReason: 'Near-plane direct face violation triggered after prolonged quiet stillness.',
    });

    scareImpactToTrigger = {
      kind: 'face_stinger',
      intensity: 1.0,
      cameraPunch: true,
      azimuthDeg: 0,
    };
    visualAnomalyToTrigger = { kind: 'brownout', azimuthDeg: 0 };
    scareReadiness = 0.05;
    lastScareHitAtSec = elapsedSec;
    nextEventAtSec = elapsedSec + 6.5;
  }
  // HIGH-IMPACT PATTERN C: Blackout Pre-Scare -> Immediate Frame Reveal OR PeripheralSnap Lure
  else if (canFireCamScare && scareReadiness >= 0.6 && elapsedSec >= nextAnomalyAtSec) {
    const useBlackout = spotsUsedCount % 2 === 0;
    if (useBlackout) {
      const side = Math.floor(elapsedSec) % 2 === 0 ? 1 : -1;
      const offsetYaw = attention.playerYawRad + side * 0.28; // ~16° off center
      const fwd = yawToForward(offsetYaw);
      const clamped = clampToRoom(
        room,
        attention.playerPosition.x + fwd.x * 1.48,
        attention.playerPosition.z + fwd.z * 1.48,
      );

      spotsUsedCount += 1;
      updatedThreats.push({
        id: `threat-${spotsUsedCount}`,
        slotId: 'cam-blackout-reveal',
        slotType: 'CornerSlot',
        archetype: 'InterceptStalker',
        scarePattern: 'BlackoutReveal',
        position: { x: clamped.x, y: 0, z: clamped.z },
        normal: { x: -fwd.x, y: 0, z: -fwd.z },
        manifestation: 0.96,
        state: 'active',
        spawnedAtSec: elapsedSec,
        timeInGazeSec: 0,
        audioBaitPlayed: true,
        audioBaitAzimuthDeg: side > 0 ? -16 : 16,
        psychologyReason: 'Blackout power-loss reveal exploiting freshly cleared forward frustum.',
      });

      visualAnomalyToTrigger = { kind: 'blackout', azimuthDeg: 0 };
      scareImpactToTrigger = {
        kind: 'blackout_reveal',
        intensity: 0.88,
        cameraPunch: true,
        azimuthDeg: side > 0 ? -16 : 16,
      };
      scareReadiness = Math.max(0.08, scareReadiness - 0.55);
      lastScareHitAtSec = elapsedSec;
      nextAnomalyAtSec = elapsedSec + 8;
      nextEventAtSec = elapsedSec + 5.5;
    } else {
      // Peripheral -> Center Snap Lure staged ~60° off-axis waiting for head turn/glance
      const side = Math.floor(elapsedSec) % 2 === 0 ? 1 : -1;
      const periphYaw = attention.playerYawRad + side * 1.05; // ~60°
      const fwd = yawToForward(periphYaw);
      const clamped = clampToRoom(
        room,
        attention.playerPosition.x + fwd.x * 1.95,
        attention.playerPosition.z + fwd.z * 1.95,
      );

      spotsUsedCount += 1;
      updatedThreats.push({
        id: `threat-${spotsUsedCount}`,
        slotId: 'cam-periph-snap',
        slotType: 'WallPeelSlot',
        archetype: 'InterceptStalker',
        scarePattern: 'PeripheralSnap',
        awaitingGlanceSnap: true,
        position: { x: clamped.x, y: 0, z: clamped.z },
        normal: { x: -fwd.x, y: 0, z: -fwd.z },
        manifestation: 0.62,
        state: 'active',
        spawnedAtSec: elapsedSec,
        timeInGazeSec: 0,
        audioBaitPlayed: true,
        audioBaitAzimuthDeg: side > 0 ? -60 : 60,
        psychologyReason: 'Peripheral lure staged at 60° edge, armed to lunge on player glance.',
      });
      audioBaitToTrigger = { azimuthDeg: side > 0 ? -60 : 60, kind: 'footstep' };
      lastBaitAtSec = elapsedSec;
      nextAnomalyAtSec = elapsedSec + 7.5;
      nextEventAtSec = elapsedSec + 6.5;
    }
  }

  // Ambient subtle non-scare anomalies between big hits
  if (
    !visualAnomalyToTrigger &&
    elapsedSec >= nextAnomalyAtSec &&
    (phase !== 'Baseline' || progress > 0.08)
  ) {
    const sideSign = Math.floor(elapsedSec) % 2 === 0 ? 1 : -1;
    const periphAzimuth = sideSign * 68;
    const rearAzimuth = sideSign * 142;

    if (phase === 'Baseline' || phase === 'PeripheralDoubt') {
      visualAnomalyToTrigger = {
        kind: stillnessSeconds >= 3 ? 'peripheral_dart' : 'brownout',
        azimuthDeg: periphAzimuth,
      };
      if (!audioBaitToTrigger && stillnessSeconds >= 3) {
        audioBaitToTrigger = { azimuthDeg: rearAzimuth, kind: 'footstep' };
        lastBaitAtSec = elapsedSec;
      }
    } else {
      visualAnomalyToTrigger = {
        kind: prev.spotsUsedCount % 2 === 0 ? 'brownout' : 'shadow_crawl',
        azimuthDeg: periphAzimuth,
      };
      if (!audioBaitToTrigger && elapsedSec - lastBaitAtSec > 4.5) {
        audioBaitToTrigger = {
          azimuthDeg: rearAzimuth,
          kind: stillnessSeconds > 4 ? 'whisper' : 'knocks',
        };
        lastBaitAtSec = elapsedSec;
      }
    }

    const cooldown =
      phase === 'Compression' ? 5.2 : phase === 'SpatialBetrayal' ? 7.5 : 10.5;
    nextAnomalyAtSec = elapsedSec + cooldown;
  }

  // Fallback / standard room-anchored spatial threat from AI / Room Geometry slots
  if (
    phase !== 'Baseline' &&
    updatedThreats.length < maxConcurrent &&
    elapsedSec >= nextEventAtSec &&
    slots.length > 0
  ) {
    const activeSlotIds = new Set(updatedThreats.map((t) => t.slotId));
    const recentSet = new Set(recentlyUsedSlotIds.slice(-3));

    let chosenSpot = aiPlan?.spots.find(
      (s) => !activeSlotIds.has(s.slotId) && !recentSet.has(s.slotId),
    );
    if (!chosenSpot) {
      const localSpots = scoreSlotsLocally(
        room,
        slots,
        attention,
        phase,
        recentlyUsedSlotIds.slice(-3),
        elapsedSec,
      );
      chosenSpot = localSpots.find((s) => !activeSlotIds.has(s.slotId)) ?? localSpots[0];
    }

    const slot = slots.find((s) => s.id === chosenSpot?.slotId);
    if (chosenSpot && slot) {
      const liveAzimuth = Math.round(
        azimuthDegRelativeToPlayer(attention.playerPosition, attention.playerYawRad, slot.position),
      );
      spotsUsedCount += 1;
      updatedThreats.push({
        id: `threat-${spotsUsedCount}`,
        slotId: slot.id,
        slotType: slot.type,
        archetype: chosenSpot.archetype,
        scarePattern: 'RoomAnchor',
        position: { ...slot.position },
        normal: { ...slot.normal },
        manifestation: 0.05,
        state: 'staging',
        spawnedAtSec: elapsedSec,
        timeInGazeSec: 0,
        audioBaitPlayed: false,
        audioBaitAzimuthDeg: liveAzimuth,
        psychologyReason: chosenSpot.psychologyReason,
      });

      recentlyUsedSlotIds = [...recentlyUsedSlotIds.slice(-5), slot.id];

      const baseGap = Math.max(4.5, targetDurationSec * 0.09);
      const phaseScale =
        phase === 'PeripheralDoubt'
          ? 1.15
          : phase === 'Occupation'
            ? 0.95
            : phase === 'SpatialBetrayal'
              ? 0.78
              : 0.55;
      nextEventAtSec = elapsedSec + baseGap * phaseScale;
      needsAiRefresh = true;
    }
  }

  const tensionLevel = Math.min(
    1,
    progress * 0.55 +
      scareReadiness * 0.25 +
      (updatedThreats.length > 0 ? 0.2 : 0),
  );

  return {
    state: {
      phase,
      progress,
      activeThreats: updatedThreats,
      recentlyUsedSlotIds,
      nextEventAtSec,
      nextAnomalyAtSec,
      stillnessSeconds,
      scareReadiness,
      lastScareHitAtSec,
      lastPlayerYawRad: attention.playerYawRad,
      spotsUsedCount,
      subThresholdGasps,
      lastBaitAtSec,
    },
    audioBaitToTrigger,
    visualAnomalyToTrigger,
    scareImpactToTrigger,
    tensionTelemetry: {
      tensionLevel,
      nearestThreatAngleDeg,
      stillnessSeconds,
      scareReadiness,
      hasActiveThreat: updatedThreats.length > 0,
    },
    needsAiRefresh,
  };
}
