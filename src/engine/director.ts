import {
  angleFromPlayerForwardRad,
  azimuthDegRelativeToPlayer,
  scoreSlotsLocally,
} from './spatial';
import type {
  AIScarePlan,
  ActiveThreat,
  AttentionState,
  HorrorPhase,
  RoomLayout,
  SpatialSlot,
} from './types';

export interface DirectorState {
  phase: HorrorPhase;
  progress: number;
  activeThreats: ActiveThreat[];
  recentlyUsedSlotIds: string[];
  nextEventAtSec: number;
  spotsUsedCount: number;
  subThresholdGasps: number;
  lastBaitAtSec: number;
}

export function computeHorrorPhase(progress: number): HorrorPhase {
  if (progress < 0.12) return 'Baseline';
  if (progress < 0.38) return 'PeripheralDoubt';
  if (progress < 0.68) return 'Occupation';
  if (progress < 0.88) return 'SpatialBetrayal';
  return 'Compression';
}

export function createDirectorState(targetDurationSec: number): DirectorState {
  // First subtle event lands just after baseline calibration (~12-15% of run, min 7s)
  const firstEventDelay = Math.max(7, targetDurationSec * 0.13);
  return {
    phase: 'Baseline',
    progress: 0,
    activeThreats: [],
    recentlyUsedSlotIds: [],
    nextEventAtSec: firstEventDelay,
    spotsUsedCount: 0,
    subThresholdGasps: 0,
    lastBaitAtSec: -999,
  };
}

export interface DirectorTickResult {
  state: DirectorState;
  audioBaitToTrigger: { azimuthDeg: number; kind: 'scrape' | 'breath' | 'creak' | 'inhale' } | null;
  needsAiRefresh: boolean;
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
  let needsAiRefresh = false;

  const subThresholdGasps =
    subThresholdGaspRatio > 0.72 && elapsedSec - prev.lastBaitAtSec > 4
      ? prev.subThresholdGasps + 1
      : prev.subThresholdGasps;

  // Update existing threats based on player gaze and time
  const updatedThreats: ActiveThreat[] = [];
  for (const threat of prev.activeThreats) {
    const angleDeg =
      (angleFromPlayerForwardRad(attention.playerPosition, attention.playerYawRad, threat.position) *
        180) /
      Math.PI;
    const inDirectGaze = angleDeg <= 26;
    const inPeriphery = angleDeg > 26 && angleDeg <= 72;

    let manifestation = threat.manifestation;
    let state = threat.state;
    let timeInGazeSec = threat.timeInGazeSec;
    let audioBaitPlayed = threat.audioBaitPlayed;

    if (state === 'staging') {
      // Wait for delay / off-axis cue before rising
      if (!audioBaitPlayed && elapsedSec - threat.spawnedAtSec >= 0.35 && angleDeg > 70) {
        audioBaitPlayed = true;
        audioBaitToTrigger = {
          azimuthDeg: threat.audioBaitAzimuthDeg,
          kind:
            phase === 'Compression'
              ? 'inhale'
              : threat.archetype === 'WallPeel'
                ? 'scrape'
                : threat.archetype === 'UnderVoidCrawler'
                  ? 'creak'
                  : 'breath',
        };
      }
      manifestation = Math.min(1, manifestation + dt * 0.38);
      if (manifestation >= 0.45) {
        state = 'active';
      }
    } else if (state === 'active') {
      if (inDirectGaze) {
        timeInGazeSec += dt;
        // Clever archetype-specific reaction when spotted:
        // WallPeel flattens back into wall if stared at early; Corner/Doorway holds nerve briefly then slips away
        const stareLimit =
          threat.archetype === 'WallPeel'
            ? 1.1
            : phase === 'Compression'
              ? 4.2
              : 2.3;
        if (timeInGazeSec >= stareLimit) {
          state = 'retreating';
        }
      } else {
        // Slowly grows more present while outside direct gaze
        manifestation = Math.min(1, manifestation + dt * (inPeriphery ? 0.14 : 0.25));
        // Auto-expire unseen threats after a long dwell so room keeps shifting
        if (elapsedSec - threat.spawnedAtSec > 24) {
          state = 'retreating';
        }
      }
    } else if (state === 'retreating') {
      manifestation = Math.max(0, manifestation - dt * (inDirectGaze ? 0.95 : 0.55));
      if (manifestation <= 0.01) {
        state = 'dismissed';
      }
    }

    if (state !== 'dismissed') {
      updatedThreats.push({
        ...threat,
        manifestation,
        state,
        timeInGazeSec,
        audioBaitPlayed,
      });
    }
  }

  // Max concurrent threats scales gently with phase
  const maxConcurrent =
    phase === 'Baseline' ? 0 : phase === 'Compression' ? 2 : 1;

  let nextEventAtSec = prev.nextEventAtSec;
  let recentlyUsedSlotIds = prev.recentlyUsedSlotIds;
  let spotsUsedCount = prev.spotsUsedCount;
  let lastBaitAtSec = prev.lastBaitAtSec;

  if (audioBaitToTrigger) {
    lastBaitAtSec = elapsedSec;
  }

  // Spawn next clever spot if budget allows and interval elapsed
  if (
    phase !== 'Baseline' &&
    updatedThreats.length < maxConcurrent &&
    elapsedSec >= nextEventAtSec &&
    slots.length > 0
  ) {
    const activeSlotIds = new Set(updatedThreats.map((t) => t.slotId));
    const recentSet = new Set(recentlyUsedSlotIds.slice(-3));

    // Prefer Gemini AI-ranked spots when available and not active/recent
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
      updatedThreats.push({
        id: `threat-${spotsUsedCount + 1}`,
        slotId: slot.id,
        slotType: slot.type,
        archetype: chosenSpot.archetype,
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
      spotsUsedCount += 1;

      // Normalized pacing interval: shorter in Compression, calmer valleys in longer runs
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

  return {
    state: {
      phase,
      progress,
      activeThreats: updatedThreats,
      recentlyUsedSlotIds,
      nextEventAtSec,
      spotsUsedCount,
      subThresholdGasps,
      lastBaitAtSec,
    },
    audioBaitToTrigger,
    needsAiRefresh,
  };
}
