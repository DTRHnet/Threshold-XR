import * as THREE from 'three';
import type { ThreatArchetype } from '../engine/types';

/**
 * Declarative entity rigs.
 *
 * Every threat silhouette is described as DATA (shapes, materials, transforms) rather
 * than hard-coded mesh construction. That means a future redesign — sculpted geometry,
 * smoothed/subdivided surfaces, or swapping a rig wholesale for a GLTF/VRM model — only
 * has to touch this file: animation, the director and the callers address parts by
 * NAME, never by index or child order.
 *
 * To make an entity less blocky without rewriting anything else:
 *   1. Bump `segments` on the shapes below (cheap, immediate smoothing).
 *   2. Replace `capsule`/`tapered` shapes with higher-fidelity ones.
 *   3. Or set `modelUrl` (see ThreatRig) and load a real mesh instead.
 */

export type PartMaterialKey = 'void' | 'rim' | 'eye';

export type PartShape =
  | { kind: 'capsule'; radius: number; length: number; capSeg?: number; segments?: number }
  | { kind: 'tapered'; radiusTop: number; radiusBottom: number; height: number; segments?: number }
  | { kind: 'sphere'; radius: number; widthSeg?: number; heightSeg?: number }
  | { kind: 'box'; width: number; height: number; depth: number }
  | { kind: 'cone'; radius: number; height: number; segments?: number };

export interface RigPart {
  /** Semantic, stable name. Animation and future redesigns target these. */
  name: string;
  shape: PartShape;
  material: PartMaterialKey;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

export interface ThreatRig {
  /** Uniform scale applied to the whole entity (kept separate from animation scale). */
  scale: number;
  parts: RigPart[];
  /**
   * Optional hook for a future redesign: when set, a loader can substitute a real
   * scanned model for the primitive rig while keeping every part name intact.
   */
  modelUrl?: string;
}

const CAP_SEG = 8;
const RADIAL = 16;

/** limb helper: a smooth capsule between two heights. */
function limb(
  name: string,
  radius: number,
  length: number,
  position: [number, number, number],
  rotation?: [number, number, number],
  material: PartMaterialKey = 'void',
): RigPart {
  return {
    name,
    shape: { kind: 'capsule', radius, length, capSeg: CAP_SEG, segments: RADIAL },
    material,
    position,
    rotation,
  };
}

function ball(
  name: string,
  radius: number,
  position: [number, number, number],
  material: PartMaterialKey = 'rim',
  scale?: [number, number, number],
): RigPart {
  return {
    name,
    shape: { kind: 'sphere', radius, widthSeg: 20, heightSeg: 16 },
    material,
    position,
    scale,
  };
}

function taper(
  name: string,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: [number, number, number],
  material: PartMaterialKey = 'void',
  rotation?: [number, number, number],
): RigPart {
  return {
    name,
    shape: { kind: 'tapered', radiusTop, radiusBottom, height, segments: RADIAL },
    material,
    position,
    rotation,
  };
}

/**
 * Tall gaunt standing silhouette (~2.0 m before rig scale). Split into two-segment
 * limbs with explicit joint spheres so it reads organic rather than stacked tubes.
 */
function standingFigure(headTilt: number): RigPart[] {
  const parts: RigPart[] = [
    ball('pelvis', 0.14, [0, 1.02, 0], 'rim', [1.05, 0.8, 0.9]),
    limb('torsoLower', 0.132, 0.26, [0, 1.22, 0]),
    limb('torsoUpper', 0.155, 0.24, [0, 1.5, 0]),
    limb('shoulders', 0.072, 0.34, [0, 1.66, 0.01], [0, 0, Math.PI / 2], 'rim'),
    taper('neck', 0.05, 0.066, 0.17, [0, 1.78, 0]),
    ball('head', 0.125, [0, 1.93, 0.02], 'rim', [0.84, 1.32, 0.92]),
    taper('jaw', 0.058, 0.042, 0.1, [0, 1.845, 0.045], 'void'),
    ball('eyeLeft', 0.021, [-0.037, 1.95, 0.1], 'eye'),
    ball('eyeRight', 0.021, [0.037, 1.95, 0.1], 'eye'),
  ];

  // Head tilt belongs to the head part only, so a future swap keeps the pose.
  const head = parts.find((p) => p.name === 'head');
  if (head) head.rotation = [0, 0, headTilt];

  for (const sx of [-1, 1] as const) {
    const side = sx < 0 ? 'Left' : 'Right';
    parts.push(
      limb(`legUpper${side}`, 0.085, 0.28, [sx * 0.1, 0.86, 0]),
      ball(`knee${side}`, 0.072, [sx * 0.1, 0.66, 0.01], 'rim'),
      limb(`legLower${side}`, 0.072, 0.28, [sx * 0.1, 0.44, 0]),
      limb(`armUpper${side}`, 0.04, 0.28, [sx * 0.24, 1.5, 0.02], [0, 0, sx * -0.07]),
      ball(`elbow${side}`, 0.036, [sx * 0.25, 1.3, 0.03], 'rim'),
      limb(`armLower${side}`, 0.031, 0.32, [sx * 0.26, 1.1, 0.03]),
      ball(`hand${side}`, 0.042, [sx * 0.265, 0.9, 0.04], 'rim', [0.9, 1.35, 0.6]),
    );
  }
  return parts;
}

/** Inverted figure hanging from a ceiling anchor (local y = 0 is the ceiling). */
function ceilingHangFigure(): RigPart[] {
  const head: RigPart = {
    ...ball('head', 0.125, [0, -1.57, 0.02], 'rim', [0.82, 1.42, 0.9]),
    // Droops forward on a broken angle, eyes aimed down at the player
    rotation: [0.42, 0, 0.18],
  };

  const parts: RigPart[] = [
    ball('pelvis', 0.15, [0, -0.2, 0], 'rim', [1.05, 0.85, 0.9]),
    limb('torsoUpper', 0.14, 0.3, [0, -0.45, 0]),
    limb('torsoLower', 0.125, 0.34, [0, -0.82, 0]),
    taper('neck', 0.042, 0.058, 0.3, [0, -1.38, 0]),
    head,
    ball('eyeLeft', 0.023, [-0.046, -1.6, 0.115], 'eye'),
    ball('eyeRight', 0.023, [0.046, -1.6, 0.115], 'eye'),
  ];

  for (const sx of [-1, 1] as const) {
    const side = sx < 0 ? 'Left' : 'Right';
    parts.push(
      limb(`armUpper${side}`, 0.038, 0.3, [sx * 0.17, -1.34, 0.03], [0, 0, sx * 0.1]),
      ball(`elbow${side}`, 0.033, [sx * 0.19, -1.66, 0.05], 'rim'),
      limb(`armLower${side}`, 0.029, 0.34, [sx * 0.21, -1.95, 0.07], [0, 0, sx * 0.05]),
      ball(`palm${side}`, 0.038, [sx * 0.22, -2.29, 0.08], 'rim', [1, 1.15, 0.75]),
    );
    // Too many joints, fingers splayed downward
    for (let f = 0; f < 4; f++) {
      parts.push(
        limb(
          `finger${side}${f}`,
          0.009,
          0.09,
          [sx * 0.22 + (f - 1.5) * 0.019, -2.42, 0.085 + (f - 1.5) * 0.012],
          [0.12, 0, sx * (0.05 + f * 0.025)],
          'rim',
        ),
      );
    }
  }
  return parts;
}

/** Low crouched form peering out from under furniture. */
function crawlerFigure(): RigPart[] {
  const parts: RigPart[] = [
    ball('body', 0.22, [0, 0.24, -0.08], 'void', [1.0, 0.68, 1.35]),
    ball('shoulders', 0.14, [0, 0.3, 0.02], 'rim', [1.35, 0.7, 1.0]),
    ball('head', 0.11, [0, 0.3, 0.24], 'rim', [0.86, 1.15, 0.95]),
    taper('jaw', 0.05, 0.036, 0.09, [0, 0.26, 0.33], 'void'),
    ball('eyeLeft', 0.021, [-0.038, 0.31, 0.33], 'eye'),
    ball('eyeRight', 0.021, [0.038, 0.31, 0.33], 'eye'),
  ];

  // Segmented spine ridge instead of one flat box
  for (let i = 0; i < 4; i++) {
    parts.push(
      ball(`spine${i}`, 0.052 - i * 0.006, [0, 0.35 - i * 0.012, -0.03 - i * 0.1], 'rim', [
        0.5, 1.0, 1.35,
      ]),
    );
  }

  for (const sx of [-1, 1] as const) {
    const side = sx < 0 ? 'Left' : 'Right';
    parts.push(
      limb(`armUpper${side}`, 0.03, 0.24, [sx * 0.2, 0.18, 0.12], [Math.PI * 0.46, 0, sx * 0.16]),
      ball(`elbow${side}`, 0.026, [sx * 0.21, 0.12, 0.28], 'rim'),
      limb(`armLower${side}`, 0.024, 0.22, [sx * 0.215, 0.08, 0.42], [Math.PI * 0.5, 0, sx * 0.1]),
      ball(`hand${side}`, 0.032, [sx * 0.22, 0.055, 0.56], 'rim', [1, 0.7, 1.25]),
    );
  }
  return parts;
}

/** Near-plane skull bust used for direct field-of-view assaults. */
function faceAssaultFigure(): RigPart[] {
  const parts: RigPart[] = [
    ball('cranium', 0.155, [0, 0.08, 0], 'rim', [0.86, 1.38, 1.02]),
    ball('brow', 0.075, [0, 0.15, 0.085], 'rim', [1.6, 0.72, 0.9]),
    taper('mouthVoid', 0.045, 0.03, 0.17, [0, -0.06, 0.095], 'void'),
    ball('chin', 0.068, [0, -0.14, 0.075], 'rim', [0.85, 1.1, 0.9]),
    taper('neck', 0.075, 0.16, 0.34, [0, -0.26, -0.03], 'void'),
  ];
  for (const sx of [-1, 1] as const) {
    const side = sx < 0 ? 'Left' : 'Right';
    parts.push(
      ball(`cavity${side}`, 0.045, [sx * 0.056, 0.1, 0.125], 'void', [1.1, 1.25, 0.65]),
      ball(`iris${side}`, 0.016, [sx * 0.056, 0.1, 0.152], 'eye'),
      ball(`cheek${side}`, 0.045, [sx * 0.068, 0.01, 0.085], 'rim', [0.85, 1.25, 0.95]),
    );
  }
  return parts;
}

/** Lean forward-leaning figure used for look-intercept / peripheral snaps. */
function stalkerFigure(): RigPart[] {
  const parts: RigPart[] = [
    limb('legs', 0.1, 0.85, [0, 0.52, 0]),
    ball('pelvis', 0.12, [0, 0.98, 0], 'rim', [1, 0.8, 0.9]),
    limb('torso', 0.155, 0.55, [0, 1.34, 0.04], [0.14, 0, 0]),
    limb('shoulders', 0.075, 0.4, [0, 1.68, 0.08], [0, 0, Math.PI / 2], 'rim'),
    ball('head', 0.13, [0, 1.9, 0.14], 'rim', [0.84, 1.34, 0.95]),
    taper('jaw', 0.055, 0.04, 0.09, [0, 1.81, 0.2], 'void'),
    ball('eyeLeft', 0.022, [-0.04, 1.92, 0.25], 'eye'),
    ball('eyeRight', 0.022, [0.04, 1.92, 0.25], 'eye'),
  ];
  const head = parts.find((p) => p.name === 'head');
  if (head) head.rotation = [0, 0, -0.18];

  for (const sx of [-1, 1] as const) {
    const side = sx < 0 ? 'Left' : 'Right';
    parts.push(
      limb(`armUpper${side}`, 0.032, 0.36, [sx * 0.26, 1.5, 0.3], [-Math.PI * 0.34, 0, sx * -0.08]),
      ball(`elbow${side}`, 0.029, [sx * 0.27, 1.35, 0.52], 'rim'),
      limb(`armLower${side}`, 0.026, 0.32, [sx * 0.275, 1.28, 0.74], [-Math.PI * 0.42, 0, 0]),
      ball(`hand${side}`, 0.038, [sx * 0.28, 1.22, 0.95], 'rim', [0.9, 0.7, 1.3]),
    );
  }
  return parts;
}

/**
 * Rig scale >1 on purpose: entities read slightly larger than life, which is a large
 * part of why they feel wrong next to real furniture in passthrough.
 */
const RIG_SCALE = 1.12;

export const THREAT_RIGS: Record<ThreatArchetype, ThreatRig> = {
  WallPeel: { scale: RIG_SCALE, parts: standingFigure(0.08) },
  DoorwayPeeker: { scale: RIG_SCALE, parts: standingFigure(0.24) },
  CornerWatcher: { scale: RIG_SCALE, parts: standingFigure(0.24) },
  CeilingHang: { scale: RIG_SCALE, parts: ceilingHangFigure() },
  UnderVoidCrawler: { scale: RIG_SCALE, parts: crawlerFigure() },
  FaceAssault: { scale: 1.0, parts: faceAssaultFigure() },
  InterceptStalker: { scale: RIG_SCALE, parts: stalkerFigure() },
};

function makeGeometry(shape: PartShape): THREE.BufferGeometry {
  switch (shape.kind) {
    case 'capsule':
      return new THREE.CapsuleGeometry(
        shape.radius,
        shape.length,
        shape.capSeg ?? CAP_SEG,
        shape.segments ?? RADIAL,
      );
    case 'tapered':
      return new THREE.CylinderGeometry(
        shape.radiusTop,
        shape.radiusBottom,
        shape.height,
        shape.segments ?? RADIAL,
        1,
      );
    case 'sphere':
      return new THREE.SphereGeometry(
        shape.radius,
        shape.widthSeg ?? 20,
        shape.heightSeg ?? 16,
      );
    case 'box':
      return new THREE.BoxGeometry(shape.width, shape.height, shape.depth);
    case 'cone':
      return new THREE.ConeGeometry(shape.radius, shape.height, shape.segments ?? 12);
  }
}

/**
 * Instantiate a rigid (un-skinned) entity from its declarative rig.
 * Returns the animation root plus a name -> Object3D map for pose work.
 */
export function buildThreatRig(
  archetype: ThreatArchetype,
  materials: Record<PartMaterialKey, THREE.Material>,
): { root: THREE.Group; parts: Map<string, THREE.Object3D> } {
  const rig = THREAT_RIGS[archetype] ?? THREAT_RIGS.CornerWatcher;
  const root = new THREE.Group();

  // Rig scale lives on an inner group so per-frame animation scale on `root`
  // composes with it instead of clobbering it.
  const inner = new THREE.Group();
  inner.name = 'rig';
  inner.scale.setScalar(rig.scale);
  root.add(inner);

  const parts = new Map<string, THREE.Object3D>();
  for (const part of rig.parts) {
    const mesh = new THREE.Mesh(makeGeometry(part.shape), materials[part.material]);
    mesh.name = part.name;
    mesh.position.set(...part.position);
    if (part.rotation) mesh.rotation.set(...part.rotation);
    if (part.scale) mesh.scale.set(...part.scale);
    parts.set(part.name, mesh);
    inner.add(mesh);
  }

  return { root, parts };
}
