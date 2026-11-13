import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomPreset } from './rooms';
import {
  angleFromPlayerForwardRad,
  computeOcclusionRatio,
  createInitialAttention,
  extractSpatialSlots,
  scoreSlotsLocally,
  updateAttention,
} from './spatial';

test('extractSpatialSlots detects corners, doorways, under-furniture voids, walls, and ceiling', () => {
  const studio = createRoomPreset('studio');
  const slots = extractSpatialSlots(studio);

  const types = new Set(slots.map((s) => s.type));
  assert.equal(types.has('CornerSlot'), true);
  assert.equal(types.has('DoorwaySlot'), true);
  assert.equal(types.has('UnderVoidSlot'), true);
  assert.equal(types.has('WallPeelSlot'), true);
  assert.equal(types.has('CeilingAnchor'), true);

  // Sofa has 0.16m clearance -> should NOT produce an UnderVoidSlot, whereas Dining Table & Work Desk should
  const underVoidLabels = slots.filter((s) => s.type === 'UnderVoidSlot').map((s) => s.label);
  assert.equal(underVoidLabels.length, 2);
  assert.equal(underVoidLabels.some((l) => l.includes('Low Sofa')), false);
});

test('hallway interior partition creates an extra blind corner slot', () => {
  const hallway = createRoomPreset('hallway');
  const slots = extractSpatialSlots(hallway);
  const corners = slots.filter((s) => s.type === 'CornerSlot');
  assert.ok(corners.length >= 4);
});

test('scoreSlotsLocally prefers peripheral / behind-player slots over dead-ahead slots', () => {
  const studio = createRoomPreset('studio');
  const slots = extractSpatialSlots(studio);
  const attention = createInitialAttention(studio.spawnPosition, 0, 0);

  const ranked = scoreSlotsLocally(studio, slots, attention, 'PeripheralDoubt', [], 10);
  assert.ok(ranked.length > 0);
  const topSlot = slots.find((s) => s.id === ranked[0].slotId)!;
  const topAngleDeg =
    (angleFromPlayerForwardRad(attention.playerPosition, attention.playerYawRad, topSlot.position) *
      180) /
    Math.PI;

  assert.ok(topAngleDeg >= 30, `Expected top scare slot off-axis, got ${topAngleDeg.toFixed(1)}°`);
});

test('updateAttention marks front sectors as recently looked at while leaving rear sectors old', () => {
  const studio = createRoomPreset('studio');
  let attention = createInitialAttention(studio.spawnPosition, 0, 0);
  attention = updateAttention(attention, studio.spawnPosition, 0, 5.0);

  // Forward (-Z) sector should be recently looked at (~5.0s)
  const frontSector = attention.sectors[0];
  assert.equal(frontSector.lastLookedAtSec, 5.0);

  // Rear (+Z, ~180 deg) sector should remain unvisited (-999)
  const rearSector = attention.sectors[18];
  assert.equal(rearSector.lastLookedAtSec, -999);
});

test('computeOcclusionRatio returns bounded [0..1] fraction', () => {
  const hallway = createRoomPreset('hallway');
  const slots = extractSpatialSlots(hallway);
  const doorSlot = slots.find((s) => s.type === 'DoorwaySlot')!;
  const ratio = computeOcclusionRatio(hallway, hallway.spawnPosition, doorSlot);
  assert.ok(ratio >= 0 && ratio <= 1);
});
