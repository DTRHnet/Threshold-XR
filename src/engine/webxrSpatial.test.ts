import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoomFromWebXRPlanes } from './webxrSpatial';
import type { DetectedPlaneSnapshot } from '../three/webxrTypes';

test('buildRoomFromWebXRPlanes extracts walls, doorways, tables, and ceiling slots from XR planes', () => {
  const planes: DetectedPlaneSnapshot[] = [
    {
      id: 'p1',
      orientation: 'vertical',
      semanticLabel: 'wall',
      center: { x: 0, y: 1.3, z: -2.4 },
      normal: { x: 0, y: 0, z: 1 },
      width: 4.0,
      depthOrHeight: 2.6,
      segmentStart: { x: -2.0, z: -2.4 },
      segmentEnd: { x: 2.0, z: -2.4 },
    },
    {
      id: 'p2',
      orientation: 'vertical',
      semanticLabel: 'wall',
      center: { x: -2.0, y: 1.3, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      width: 4.8,
      depthOrHeight: 2.6,
      segmentStart: { x: -2.0, z: -2.4 },
      segmentEnd: { x: -2.0, z: 2.4 },
    },
    {
      id: 'p3',
      orientation: 'vertical',
      semanticLabel: 'door frame',
      center: { x: 2.0, y: 1.05, z: -0.8 },
      normal: { x: -1, y: 0, z: 0 },
      width: 0.95,
      depthOrHeight: 2.1,
    },
    {
      id: 'p4',
      orientation: 'horizontal',
      semanticLabel: 'table',
      center: { x: 1.1, y: 0.76, z: 0.6 },
      normal: { x: 0, y: 1, z: 0 },
      width: 1.4,
      depthOrHeight: 0.85,
    },
    {
      id: 'p5',
      orientation: 'horizontal',
      semanticLabel: 'ceiling',
      center: { x: 0, y: 2.6, z: 0 },
      normal: { x: 0, y: -1, z: 0 },
      width: 4.0,
      depthOrHeight: 4.8,
    },
  ];

  const { room, slots } = buildRoomFromWebXRPlanes(planes, { x: 0, y: 1.65, z: 0 }, 0);
  assert.equal(room.walls.length, 2);
  assert.equal(room.doorways.length, 1);
  assert.equal(room.furniture.length, 1);

  const types = new Set(slots.map((s) => s.type));
  assert.equal(types.has('CornerSlot'), true);
  assert.equal(types.has('DoorwaySlot'), true);
  assert.equal(types.has('UnderVoidSlot'), true);
  assert.equal(types.has('WallPeelSlot'), true);
  assert.equal(types.has('CeilingAnchor'), true);
});

test('buildRoomFromWebXRPlanes synthesizes fallback relative slots when room has no scanned planes', () => {
  const { slots } = buildRoomFromWebXRPlanes([], { x: 0, y: 1.65, z: 0 }, 0);
  assert.ok(slots.length >= 4);
});
