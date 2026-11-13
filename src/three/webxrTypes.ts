export interface XRPlaneLike {
  planeSpace: XRSpace;
  polygon: ReadonlyArray<{ x: number; y: number; z: number; w?: number }>;
  orientation: 'horizontal' | 'vertical';
  lastChangedTime: number;
  semanticLabel?: string;
}

export interface XRMeshLike {
  meshSpace: XRSpace;
  vertices: Float32Array;
  indices: Uint32Array;
  lastChangedTime: number;
  semanticLabel?: string;
}

export interface XRFrameWithDetection extends Omit<XRFrame, 'detectedPlanes' | 'detectedMeshes'> {
  detectedPlanes?: Iterable<XRPlaneLike> & { has(plane: XRPlaneLike): boolean };
  detectedMeshes?: Iterable<XRMeshLike> & { has(mesh: XRMeshLike): boolean };
}

export interface DetectedPlaneSnapshot {
  id: string;
  orientation: 'horizontal' | 'vertical';
  semanticLabel: string;
  center: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  width: number;
  depthOrHeight: number;
  /** World-space horizontal endpoints for vertical walls */
  segmentStart?: { x: number; z: number };
  segmentEnd?: { x: number; z: number };
}
