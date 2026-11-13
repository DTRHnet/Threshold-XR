import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomPreset } from './rooms';
import { createInitialAttention, extractSpatialSlots } from './spatial';
import {
  computeHorrorPhase,
  createDirectorState,
  stepThreatDirector,
} from './director';

test('computeHorrorPhase maps normalized progress across all 5 phases', () => {
  assert.equal(computeHorrorPhase(0.05), 'Baseline');
  assert.equal(computeHorrorPhase(0.2), 'PeripheralDoubt');
  assert.equal(computeHorrorPhase(0.5), 'Occupation');
  assert.equal(computeHorrorPhase(0.75), 'SpatialBetrayal');
  assert.equal(computeHorrorPhase(0.95), 'Compression');
});

test('stepThreatDirector spawns zero threats in Baseline and stages AI spot in PeripheralDoubt', () => {
  const studio = createRoomPreset('studio');
  const slots = extractSpatialSlots(studio);
  const attention = createInitialAttention(studio.spawnPosition, 0, 0);
  let director = createDirectorState(60);

  // Baseline at t = 4s -> no threats
  let res = stepThreatDirector(director, studio, slots, attention, null, 4, 60, 0.1, 0);
  director = res.state;
  assert.equal(director.phase, 'Baseline');
  assert.equal(director.activeThreats.length, 0);

  // PeripheralDoubt at t = 10s -> stages first threat
  res = stepThreatDirector(director, studio, slots, attention, null, 10, 60, 0.1, 0);
  director = res.state;
  assert.equal(director.phase, 'PeripheralDoubt');
  assert.equal(director.activeThreats.length, 1);
  assert.equal(director.spotsUsedCount, 1);
});

test('stepThreatDirector schedules non-jumpscare visual/audio anomalies when player sits still', () => {
  const studio = createRoomPreset('studio');
  const slots = extractSpatialSlots(studio);
  const attention = createInitialAttention(studio.spawnPosition, 0, 0);
  let director = createDirectorState(60);

  let triggeredAnomaly = false;
  for (let i = 1; i <= 80; i++) {
    const res = stepThreatDirector(director, studio, slots, attention, null, i * 0.1, 60, 0.1, 0);
    director = res.state;
    if (res.visualAnomalyToTrigger) {
      triggeredAnomaly = true;
    }
  }

  assert.equal(triggeredAnomaly, true);
  assert.ok(director.stillnessSeconds > 3);
});

test('stepThreatDirector intercepts active head rotation with LookIntercept ahead of gaze', () => {
  const studio = createRoomPreset('studio');
  const slots = extractSpatialSlots(studio);
  let attention = createInitialAttention(studio.spawnPosition, 0, 0);
  // Rotate fast left (+yaw) across 0.2s so signedYawVelocity & predictedYaw build cleanly
  attention = {
    ...attention,
    playerYawRad: 0.32,
    signedYawVelocityRadPerSec: 1.4,
    angularVelocityRadPerSec: 1.4,
    predictedYawRad: 0.62,
  };

  const director = {
    ...createDirectorState(100),
    scareReadiness: 0.6,
  };
  const res = stepThreatDirector(director, studio, slots, attention, null, 20, 100, 0.1, 0);
  assert.equal(res.state.activeThreats.length, 1);
  assert.equal(res.state.activeThreats[0].scarePattern, 'LookIntercept');
  assert.equal(res.scareImpactToTrigger?.kind, 'intercept_hit');
  assert.ok(res.state.scareReadiness < 0.2);
});

test('stepThreatDirector snaps PeripheralSnap toward camera when player glances toward it', () => {
  const studio = createRoomPreset('studio');
  const slots = extractSpatialSlots(studio);
  const attention = createInitialAttention(studio.spawnPosition, 0, 10);
  let director = createDirectorState(100);
  director = {
    ...director,
    activeThreats: [
      {
        id: 'threat-lure',
        slotId: 'cam-periph-snap',
        slotType: 'WallPeelSlot',
        archetype: 'InterceptStalker',
        scarePattern: 'PeripheralSnap',
        awaitingGlanceSnap: true,
        position: { x: -1.6, y: 0, z: -0.9 }, // ~60° left of yaw=0
        normal: { x: 0.85, y: 0, z: 0.5 },
        manifestation: 0.6,
        prevAngleDeg: 60,
        state: 'active',
        spawnedAtSec: 20,
        timeInGazeSec: 0,
        audioBaitPlayed: true,
        audioBaitAzimuthDeg: -60,
        psychologyReason: 'Peripheral lure',
      },
    ],
  };

  // Player rotates ~30° left toward the lure -> triggers PeripheralSnap lunge!
  const glanced = {
    ...attention,
    playerYawRad: 0.55,
    signedYawVelocityRadPerSec: 1.2,
    angularVelocityRadPerSec: 1.2,
  };
  const res = stepThreatDirector(director, studio, slots, glanced, null, 20.5, 100, 0.1, 0);
  assert.equal(res.scareImpactToTrigger?.kind, 'snap_stinger');
  assert.equal(res.state.activeThreats[0].awaitingGlanceSnap, false);
  assert.ok((res.state.activeThreats[0].lungeProgress ?? 0) > 0);
});

test('stepThreatDirector fires near-plane FaceAssault after prolonged quiet stillness in SpatialBetrayal', () => {
  const studio = createRoomPreset('studio');
  const slots = extractSpatialSlots(studio);
  const attention = createInitialAttention(studio.spawnPosition, 0, 75);
  const director = {
    ...createDirectorState(100),
    scareReadiness: 0.9,
    stillnessSeconds: 4.5,
  };

  const res = stepThreatDirector(director, studio, slots, attention, null, 75, 100, 0.1, 0);
  assert.equal(res.state.phase, 'SpatialBetrayal');
  assert.equal(res.state.activeThreats[0].scarePattern, 'FaceAssault');
  assert.equal(res.state.activeThreats[0].archetype, 'FaceAssault');
  assert.equal(res.scareImpactToTrigger?.kind, 'face_stinger');
});
