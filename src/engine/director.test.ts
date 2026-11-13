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
