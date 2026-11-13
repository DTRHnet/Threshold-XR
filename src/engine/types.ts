export type RoomPresetId = 'studio' | 'hallway' | 'office' | 'random';

export type SlotType =
  | 'CornerSlot'
  | 'DoorwaySlot'
  | 'UnderVoidSlot'
  | 'WallPeelSlot'
  | 'CeilingAnchor';

export type ThreatArchetype =
  | 'WallPeel'
  | 'DoorwayPeeker'
  | 'UnderVoidCrawler'
  | 'CeilingHang'
  | 'CornerWatcher'
  | 'InterceptStalker'
  | 'FaceAssault';

export type ScarePattern =
  | 'RoomAnchor'
  | 'LookIntercept'
  | 'PeripheralSnap'
  | 'BlackoutReveal'
  | 'FaceAssault';

export type HorrorPhase =
  | 'Baseline'
  | 'PeripheralDoubt'
  | 'Occupation'
  | 'SpatialBetrayal'
  | 'Compression';

export type GameState = 'title' | 'playing' | 'paused' | 'gameover';

export type RunDurationSeconds = 60 | 180 | 300 | 600;

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface WallSegment {
  id: string;
  start: Vec2;
  end: Vec2;
  height: number;
  thickness: number;
  /** Unit normal pointing into the walkable interior of the room */
  inwardNormal: Vec2;
  hasDoorGap?: boolean;
}

export interface DoorwayOpening {
  id: string;
  center: Vec2;
  width: number;
  height: number;
  /** Direction vector pointing from the room interior through the doorway */
  outwardNormal: Vec2;
  jambLeft: Vec2;
  jambRight: Vec2;
}

export interface FurniturePiece {
  id: string;
  label: string;
  kind: 'desk' | 'table' | 'sofa' | 'bed' | 'cabinet' | 'pillar';
  center: Vec2;
  width: number;
  depth: number;
  height: number;
  /** Clearance underneath (e.g., 0.7m under a desk/table/bed) */
  underClearance: number;
  rotationY: number;
}

export interface RoomLayout {
  id: string;
  name: string;
  preset: RoomPresetId;
  width: number;
  depth: number;
  height: number;
  spawnPosition: Vec3;
  spawnYawRad: number;
  walls: WallSegment[];
  doorways: DoorwayOpening[];
  furniture: FurniturePiece[];
}

export interface SpatialSlot {
  id: string;
  type: SlotType;
  position: Vec3;
  /** Unit normal pointing toward the player / room interior */
  normal: Vec3;
  label: string;
  clearanceMeters: number;
  occlusionAnchorId?: string;
  recommendedArchetype: ThreatArchetype;
}

export interface AttentionSector {
  index: number;
  centerAngleRad: number;
  lastLookedAtSec: number;
  dwellSeconds: number;
}

export interface CameraHistorySample {
  timeSec: number;
  yawRad: number;
  pitchRad: number;
}

export interface AttentionState {
  sectors: AttentionSector[];
  playerPosition: Vec3;
  playerYawRad: number;
  pitchRad: number;
  angularVelocityRadPerSec: number;
  signedYawVelocityRadPerSec: number;
  pitchVelocityRadPerSec: number;
  predictedYawRad: number;
  movementSpeedMps: number;
  moveDirX: number;
  moveDirZ: number;
  history: CameraHistorySample[];
  lastUpdateSec: number;
}

export interface AIScareSpot {
  slotId: string;
  score: number;
  archetype: ThreatArchetype;
  psychologyReason: string;
  audioBaitAzimuthDeg: number;
  recommendedDelaySec: number;
}

export interface AIScarePlan {
  source: 'gemini' | 'heuristic';
  roomAssessment: string;
  spots: AIScareSpot[];
  generatedAtMs: number;
}

export interface ActiveThreat {
  id: string;
  slotId: string;
  slotType: SlotType;
  archetype: ThreatArchetype;
  scarePattern?: ScarePattern;
  position: Vec3;
  lungeStartPos?: Vec3;
  normal: Vec3;
  /** 0 = concealed/flat, 1 = fully manifested */
  manifestation: number;
  /** 0..1 lunge interpolation when snapping from periphery to center */
  lungeProgress?: number;
  /** True when staged in periphery waiting for player to glance toward it */
  awaitingGlanceSnap?: boolean;
  prevAngleDeg?: number;
  state: 'staging' | 'active' | 'retreating' | 'dismissed';
  spawnedAtSec: number;
  timeInGazeSec: number;
  audioBaitPlayed: boolean;
  audioBaitAzimuthDeg: number;
  psychologyReason: string;
}

export interface AcousticState {
  calibrated: boolean;
  calibrationSamples: number;
  adaptiveFloorRms: number;
  prevRmsHistory: number[];
  consecutiveBreachFrames: number;
  lastDbRel: number;
  lastOnsetSlopeDb: number;
  lastHighFreqRatio: number;
  lastZcr: number;
  subThresholdGaspRatio: number;
  breachTriggered: boolean;
}

export interface RunSummary {
  outcome: 'survived' | 'broke';
  elapsedSec: number;
  targetSec: number;
  roomName: string;
  spotsUsed: number;
  subThresholdGasps: number;
  peakDbRel: number;
  aiPlanSource: 'gemini' | 'heuristic';
  highestPhase: HorrorPhase;
}
