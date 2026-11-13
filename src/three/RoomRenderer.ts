import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  ActiveThreat,
  GameState,
  RoomLayout,
  ThreatArchetype,
  Vec3,
} from '../engine/types';
import type {
  DetectedPlaneSnapshot,
  XRFrameWithDetection,
  XRPlaneLike,
} from './webxrTypes';

// Pre-allocated scratch math helpers (zero per-frame GC)
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _xrPos = new THREE.Vector3();
const _xrQuat = new THREE.Quaternion();
const _xrScale = new THREE.Vector3();
const _xrMat = new THREE.Matrix4();
const _xrEuler = new THREE.Euler(0, 0, 0, 'YXZ');

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createMonochromePlasterTexture(
  contrast = 1,
  repeatX = 2,
  repeatY = 2,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Smooth organic base coat + subtle multi-scale speckle (no repeating sine grid)
  ctx.fillStyle = '#868686';
  ctx.fillRect(0, 0, 256, 256);

  // Large soft mottled plaster clouds
  for (let i = 0; i < 42; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 24 + Math.random() * 48;
    const shade = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, shade);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }

  const img = ctx.getImageData(0, 0, 256, 256);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const grain = (Math.random() - 0.5) * 16 * contrast;
    const v = Math.max(0, Math.min(255, Math.round(d[i] + grain)));
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

function createSoftShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.68)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.34)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function createFloorBoardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#3b3b3b';
  ctx.fillRect(0, 0, 512, 512);

  const plankH = 64;
  for (let y = 0; y < 512; y += plankH) {
    const shade = 48 + Math.floor(Math.random() * 22);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(0, y + 2, 512, plankH - 3);
    // Plank seam
    ctx.fillStyle = '#181818';
    ctx.fillRect(0, y, 512, 2);
    // Vertical joint
    const jointX = ((y * 7) % 380) + 60;
    ctx.fillRect(jointX, y, 2, plankH);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

/**
 * Builds a multi-part composite monochrome furniture assembly (legs + top + trim/void)
 * pivoted at bottom-center (y = 0) so under-furniture voids are real 3D negative space.
 */
function buildFurnitureGroup(
  piece: RoomLayout['furniture'][number],
  matDark: THREE.MeshStandardMaterial,
  matMid: THREE.MeshStandardMaterial,
  matTrim: THREE.MeshStandardMaterial,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(piece.center.x, 0, piece.center.z);
  group.rotation.y = piece.rotationY;

  const { width: w, depth: d, height: h, underClearance: uc, kind } = piece;

  if (kind === 'desk' || kind === 'table') {
    const topThick = Math.max(0.05, h - uc);
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, topThick, d), matMid);
    top.position.y = h - topThick * 0.5;
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(top);

    // Subtle beveled apron lip under tabletop
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(w - 0.08, 0.04, d - 0.08),
      matDark,
    );
    apron.position.y = h - topThick - 0.02;
    group.add(apron);

    // 4 slender steel/wood legs leaving genuine empty void underneath
    const legGeo = new THREE.BoxGeometry(0.06, uc, 0.06);
    const lx = w * 0.5 - 0.08;
    const lz = d * 0.5 - 0.08;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, matTrim);
        leg.position.set(sx * lx, uc * 0.5, sz * lz);
        leg.castShadow = true;
        group.add(leg);
      }
    }
  } else if (kind === 'sofa') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.28, d), matDark);
    base.position.y = uc + 0.14;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const back = new THREE.Mesh(new THREE.BoxGeometry(0.24, h - uc, d), matMid);
    back.position.set(-w * 0.5 + 0.12, uc + (h - uc) * 0.5, 0);
    back.castShadow = true;
    group.add(back);

    for (const sz of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(w, 0.42, 0.16), matMid);
      arm.position.set(0, uc + 0.21, sz * (d * 0.5 - 0.08));
      arm.castShadow = true;
      group.add(arm);
    }

    // Seat cushions
    const cushionCount = 2;
    const cw = (d - 0.36) / cushionCount;
    for (let i = 0; i < cushionCount; i++) {
      const c = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.28, 0.12, cw - 0.03),
        matTrim,
      );
      c.position.set(0.1, uc + 0.34, -d * 0.5 + 0.18 + cw * (i + 0.5));
      group.add(c);
    }
  } else {
    // Cabinet / pillar
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h - 0.06, d), matDark);
    body.position.y = (h - 0.06) * 0.5 + 0.06;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(w - 0.06, 0.06, d - 0.06),
      matTrim,
    );
    plinth.position.y = 0.03;
    group.add(plinth);

    const doorPanel = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.015, h * 0.82, d * 0.44),
      matMid,
    );
    doorPanel.position.set(0, h * 0.52, d * 0.24);
    group.add(doorPanel);

    const doorPanelB = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.015, h * 0.82, d * 0.44),
      matMid,
    );
    doorPanelB.position.set(0, h * 0.52, -d * 0.24);
    group.add(doorPanelB);
  }

  return group;
}

/**
 * Builds an uncanny multi-part monochrome silhouette entity (6-9 articulated parts)
 * tailored to its ThreatArchetype (WallPeel, DoorwayPeeker, UnderVoidCrawler, CeilingHang, CornerWatcher).
 */
function buildThreatEntityGroup(
  archetype: ThreatArchetype,
  voidMat: THREE.MeshStandardMaterial,
  rimMat: THREE.MeshStandardMaterial,
  eyeMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const root = new THREE.Group();

  if (archetype === 'CeilingHang') {
    // Inverted figure descending from ceiling anchor (local y = 0 is ceiling!)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.95, 10), voidMat);
    torso.position.y = -0.65;
    root.add(torso);

    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), rimMat);
    pelvis.position.y = -0.18;
    root.add(pelvis);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.26, 8), voidMat);
    neck.position.y = -1.2;
    root.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), rimMat);
    head.scale.set(0.85, 1.32, 0.9);
    head.position.y = -1.38;
    root.add(head);

    // Two elongated hanging arms reaching downward
    for (const sx of [-1, 1]) {
      const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.025, 0.55, 8), voidMat);
      upperArm.position.set(sx * 0.16, -1.25, 0.03);
      upperArm.rotation.z = sx * 0.08;
      root.add(upperArm);

      const foreArm = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.015, 0.52, 8), rimMat);
      foreArm.position.set(sx * 0.19, -1.75, 0.06);
      root.add(foreArm);
    }
    return root;
  }

  if (archetype === 'UnderVoidCrawler') {
    // Low, spider-like crouched silhouette peeking out from under furniture
    const crouchBody = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), voidMat);
    crouchBody.scale.set(1.0, 0.68, 1.35);
    crouchBody.position.set(0, 0.24, -0.08);
    root.add(crouchBody);

    const spineRidge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.42), rimMat);
    spineRidge.position.set(0, 0.34, -0.12);
    root.add(spineRidge);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), rimMat);
    head.scale.set(0.86, 1.15, 0.95);
    head.position.set(0, 0.3, 0.24);
    root.add(head);

    // Subtle pale eye catchlights
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), eyeMat);
      eye.position.set(sx * 0.038, 0.31, 0.33);
      root.add(eye);
    }

    // Two long splayed arms reaching forward along the floor
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.018, 0.52, 8), voidMat);
      arm.rotation.x = Math.PI * 0.48;
      arm.rotation.z = sx * 0.18;
      arm.position.set(sx * 0.2, 0.09, 0.26);
      root.add(arm);
    }
    return root;
  }

  // Tall gaunt standing/peeling silhouette (WallPeel, DoorwayPeeker, CornerWatcher)
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.09, 0.95, 10), voidMat);
  legs.position.y = 0.475;
  root.add(legs);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.72, 10), voidMat);
  torso.position.y = 1.28;
  root.add(torso);

  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.18), rimMat);
  shoulders.position.y = 1.62;
  root.add(shoulders);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.18, 8), voidMat);
  neck.position.y = 1.74;
  root.add(neck);

  // Tilted elongated head
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.9, 0.02);
  headGroup.rotation.z = archetype === 'CornerWatcher' || archetype === 'DoorwayPeeker' ? 0.24 : 0.08;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), rimMat);
  skull.scale.set(0.82, 1.28, 0.92);
  headGroup.add(skull);

  for (const sx of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), eyeMat);
    socket.position.set(sx * 0.036, 0.02, 0.096);
    headGroup.add(socket);
  }
  root.add(headGroup);

  // Asymmetric hanging arms
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.02, 0.88, 8), voidMat);
    arm.position.set(sx * 0.23, 1.18, 0.02);
    arm.rotation.z = sx * -0.06;
    root.add(arm);
  }

  return root;
}

export interface RendererCallbacks {
  onPoseUpdate: (pos: Vec3, yawRad: number) => void;
  onXrPlanesUpdated?: (planes: DetectedPlaneSnapshot[]) => void;
  onXrSessionEnded?: () => void;
}

export class ThresholdRoomRenderer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;

  private roomGroup = new THREE.Group();
  private xrOcclusionGroup = new THREE.Group();
  private threatGroup = new THREE.Group();
  private threatMeshes = new Map<string, { group: THREE.Group; archetype: ThreatArchetype }>();

  // Materials & textures
  private wallMat: THREE.MeshStandardMaterial;
  private floorMat: THREE.MeshStandardMaterial;
  private ceilingMat: THREE.MeshStandardMaterial;
  private furnDarkMat: THREE.MeshStandardMaterial;
  private furnMidMat: THREE.MeshStandardMaterial;
  private furnTrimMat: THREE.MeshStandardMaterial;
  private shadowDiscMat: THREE.MeshBasicMaterial;
  private xrOcclusionMat: THREE.MeshBasicMaterial;
  private threatVoidMat: THREE.MeshStandardMaterial;
  private threatRimMat: THREE.MeshStandardMaterial;
  private threatEyeMat: THREE.MeshStandardMaterial;

  private currentRoom: RoomLayout;
  private gameState: GameState = 'title';
  private activeThreats: ActiveThreat[] = [];
  private callbacksRef: React.MutableRefObject<RendererCallbacks>;

  // First-person player state
  private playerPos = new THREE.Vector3(0, 1.65, 1.5);
  private playerYaw = 0;
  private targetYaw = 0;
  private playerPitch = 0;
  private targetPitch = 0;

  // Virtual touch / controller locomotion state
  private virtualForward = 0;
  private virtualStrafe = 0;
  private virtualTurn = 0;

  // Input state
  private keys = new Set<string>();
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private frameId = 0;
  private disposed = false;
  private lastTimeMs = performance.now();
  private tourAngle = 0;

  // WebXR passthrough state
  private xrSession: XRSession | null = null;
  private xrWorldOffset = new THREE.Vector3(0, 0, 0);
  private xrPlaneCache = new Map<XRPlaneLike, { lastChanged: number; mesh: THREE.Mesh }>();
  private lastXrPlaneSyncMs = 0;

  // Optional live monochrome webcam passthrough background
  private webcamVideo: HTMLVideoElement | null = null;
  private webcamTexture: THREE.VideoTexture | null = null;
  private webcamEnabled = false;

  constructor(
    container: HTMLElement,
    initialRoom: RoomLayout,
    callbacksRef: React.MutableRefObject<RendererCallbacks>,
  ) {
    this.container = container;
    this.currentRoom = initialRoom;
    this.callbacksRef = callbacksRef;
    this.isSoftwareGl = detectSoftwareWebGL();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: true,
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x060606, 1);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060606);
    this.scene.fog = new THREE.FogExp2(0x060606, 0.085);

    this.camera = new THREE.PerspectiveCamera(68, width / height, 0.08, 40);

    this.xrOcclusionMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      side: THREE.DoubleSide,
    });

    // Studio monochrome environment reflection map (required for realistic PBR response)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Strict monochrome lighting rig (cold moonlight/ambient contrast)
    const hemi = new THREE.HemisphereLight(0xd8d8d8, 0x1a1a1a, 0.55);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xf5f5f5, 0.95);
    keyLight.position.set(2.5, 4.5, 2.2);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 16;
    keyLight.shadow.camera.left = -6;
    keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 6;
    keyLight.shadow.camera.bottom = -6;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    const rimFill = new THREE.PointLight(0xd0d0d0, 0.4, 10, 2);
    rimFill.position.set(-2.2, 2.3, -1.8);
    this.scene.add(rimFill);

    // Shared monochrome materials
    const plasterTex = createMonochromePlasterTexture(1.1, 3, 2);
    plasterTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const floorTex = createFloorBoardTexture();
    floorTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.wallMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: plasterTex,
      roughness: 0.92,
      metalness: 0.02,
    });
    this.floorMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: floorTex,
      roughness: 0.78,
      metalness: 0.06,
    });
    this.ceilingMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.95,
      metalness: 0.0,
    });

    this.furnDarkMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.85,
      metalness: 0.05,
    });
    this.furnMidMat = new THREE.MeshStandardMaterial({
      color: 0x525252,
      roughness: 0.62,
      metalness: 0.1,
    });
    this.furnTrimMat = new THREE.MeshStandardMaterial({
      color: 0x767676,
      roughness: 0.36,
      metalness: 0.25,
    });

    this.shadowDiscMat = new THREE.MeshBasicMaterial({
      map: createSoftShadowTexture(),
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });

    this.threatVoidMat = new THREE.MeshStandardMaterial({
      color: 0x050505,
      roughness: 0.94,
      metalness: 0.04,
      transparent: true,
      opacity: 0.96,
    });
    this.threatRimMat = new THREE.MeshStandardMaterial({
      color: 0x3b3b3b,
      roughness: 0.52,
      metalness: 0.18,
      transparent: true,
      opacity: 0.96,
    });
    this.threatEyeMat = new THREE.MeshStandardMaterial({
      color: 0xe6e6e6,
      emissive: 0x9c9c9c,
      emissiveIntensity: 0.35,
      roughness: 0.2,
    });

    this.scene.add(this.xrOcclusionGroup);
    this.scene.add(this.roomGroup);
    this.scene.add(this.threatGroup);

    this.buildRoomGeometry(initialRoom);
    this.resetPlayerToSpawn();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.scheduleNextTick();
  }

  public setRoom(room: RoomLayout) {
    this.currentRoom = room;
    this.buildRoomGeometry(room);
    this.resetPlayerToSpawn();
    this.clearThreats();
  }

  public setGameState(state: GameState) {
    this.gameState = state;
    if (state !== 'playing') {
      this.keys.clear();
      this.isDragging = false;
    }
  }

  public resetPlayerToSpawn() {
    const { spawnPosition, spawnYawRad } = this.currentRoom;
    this.playerPos.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
    this.playerYaw = spawnYawRad;
    this.targetYaw = spawnYawRad;
    this.playerPitch = -0.04;
    this.targetPitch = -0.04;
    this.syncCameraPose();
  }

  public setActiveThreats(threats: ActiveThreat[]) {
    this.activeThreats = threats;
    const activeIds = new Set(threats.map((t) => t.id));

    // Remove dismissed threats
    for (const [id, entry] of this.threatMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.threatGroup.remove(entry.group);
        this.threatMeshes.delete(id);
      }
    }

    // Add newly staged threats
    for (const threat of threats) {
      if (!this.threatMeshes.has(threat.id)) {
        const group = buildThreatEntityGroup(
          threat.archetype,
          this.threatVoidMat,
          this.threatRimMat,
          this.threatEyeMat,
        );
        group.position.set(threat.position.x, threat.position.y, threat.position.z);
        // Orient entity facing along its inward slot normal
        const yaw = Math.atan2(threat.normal.x, threat.normal.z);
        group.rotation.y = yaw;
        this.threatGroup.add(group);
        this.threatMeshes.set(threat.id, { group, archetype: threat.archetype });
      }
    }
  }

  public clearThreats() {
    for (const entry of this.threatMeshes.values()) {
      this.threatGroup.remove(entry.group);
    }
    this.threatMeshes.clear();
    this.activeThreats = [];
  }

  public setPassthroughDimness(compressionFactor: number) {
    if (this.xrSession) return;
    // Slightly tighten fog and exposure in final compression phase (strictly grayscale)
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = 0.085 + compressionFactor * 0.065;
    }
    this.renderer.toneMappingExposure = 1.05 - compressionFactor * 0.16;
  }

  public setVirtualMove(forward: number, strafe: number, turn: number) {
    this.virtualForward = forward;
    this.virtualStrafe = strafe;
    this.virtualTurn = turn;
  }

  public isXrActive(): boolean {
    return this.xrSession !== null;
  }

  public async enterWebXRPassthrough(
    overlayRoot?: HTMLElement | null,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!window.isSecureContext) {
      return {
        ok: false,
        reason: 'WebXR passthrough requires HTTPS (secure context). Serve over HTTPS to enter VR on Quest.',
      };
    }
    if (!navigator.xr) {
      return {
        ok: false,
        reason: 'WebXR is unavailable in this browser. Open in Meta Quest Browser or Pico Browser over HTTPS.',
      };
    }
    const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    if (!supported) {
      return {
        ok: false,
        reason: 'This device/browser does not support WebXR immersive-ar passthrough.',
      };
    }

    try {
      const sessionInit: XRSessionInit = {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['plane-detection', 'mesh-detection', 'hit-test', 'dom-overlay'],
      };
      if (overlayRoot) {
        (sessionInit as XRSessionInit & { domOverlay?: { root: Element } }).domOverlay = {
          root: overlayRoot,
        };
      }

      const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
      this.xrSession = session;
      this.xrWorldOffset.set(0, 0, 0);

      // Hide virtual room walls/floor so real hardware Quest/Pico camera passthrough renders cleanly
      this.roomGroup.visible = false;
      this.scene.background = null;
      this.scene.fog = null;
      this.renderer.setClearColor(0x000000, 0);

      // Cancel desktop loop and switch to Three.js XR animation loop
      cancelAnimationFrame(this.frameId);
      clearTimeout(this.frameId);

      session.addEventListener('end', () => {
        this.handleXrSessionEnd();
      });

      await this.renderer.xr.setSession(session);
      this.renderer.setAnimationLoop(this.xrTick);
      return { ok: true };
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to start WebXR immersive-ar session.';
      return { ok: false, reason: msg };
    }
  }

  public async exitWebXR(): Promise<void> {
    if (this.xrSession) {
      await this.xrSession.end().catch(() => undefined);
    }
  }

  private handleXrSessionEnd() {
    this.xrSession = null;
    this.renderer.setAnimationLoop(null);
    this.roomGroup.visible = true;
    this.scene.background = new THREE.Color(0x060606);
    this.scene.fog = new THREE.FogExp2(0x060606, 0.085);
    this.renderer.setClearColor(0x060606, 1);

    for (const entry of this.xrPlaneCache.values()) {
      this.xrOcclusionGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
    }
    this.xrPlaneCache.clear();
    this.callbacksRef.current.onXrSessionEnded?.();
    this.scheduleNextTick();
  }

  public async toggleWebcamPassthrough(
    enable: boolean,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!enable) {
      this.webcamEnabled = false;
      if (this.webcamVideo?.srcObject) {
        const stream = this.webcamVideo.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
      this.webcamTexture?.dispose();
      this.webcamTexture = null;
      this.webcamVideo = null;
      if (!this.xrSession) {
        this.scene.background = new THREE.Color(0x060606);
      }
      this.wallMat.transparent = false;
      this.wallMat.opacity = 1;
      return { ok: false };
    }

    if (!window.isSecureContext) {
      return {
        ok: false,
        reason: 'Camera feed requires HTTPS (secure context).',
      };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return {
        ok: false,
        reason: 'Camera API unavailable in this browser.',
      };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.webcamVideo = video;
      this.webcamTexture = tex;
      this.webcamEnabled = true;
      this.scene.background = tex;
      this.wallMat.transparent = true;
      this.wallMat.opacity = 0.25;
      return { ok: true };
    } catch (err) {
      this.webcamEnabled = false;
      const name = (err as Error)?.name || '';
      const reason =
        name === 'NotAllowedError'
          ? 'Camera permission denied.'
          : name === 'NotFoundError'
            ? 'No camera device found.'
            : 'Camera access blocked (requires HTTPS).';
      return { ok: false, reason };
    }
  }

  private buildRoomGeometry(room: RoomLayout) {
    while (this.roomGroup.children.length > 0) {
      const child = this.roomGroup.children[0];
      this.roomGroup.remove(child);
    }

    // Floor & ceiling
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.width, room.depth), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.roomGroup.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(room.width, room.depth),
      this.ceilingMat,
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = room.height;
    this.roomGroup.add(ceiling);

    // Walls & baseboards
    for (const wall of room.walls) {
      const dx = wall.end.x - wall.start.x;
      const dz = wall.end.z - wall.start.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const angle = Math.atan2(dx, dz);

      const wallMesh = new THREE.Mesh(
        new THREE.BoxGeometry(wall.thickness, wall.height, len),
        this.wallMat,
      );
      wallMesh.position.set(
        (wall.start.x + wall.end.x) * 0.5,
        wall.height * 0.5,
        (wall.start.z + wall.end.z) * 0.5,
      );
      wallMesh.rotation.y = angle;
      wallMesh.receiveShadow = true;
      wallMesh.castShadow = true;
      this.roomGroup.add(wallMesh);

      // Subtle architectural skirting/baseboard
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(wall.thickness + 0.03, 0.11, len),
        this.furnDarkMat,
      );
      trim.position.set(wallMesh.position.x, 0.055, wallMesh.position.z);
      trim.rotation.y = angle;
      this.roomGroup.add(trim);
    }

    // Doorways: top lintel + dark beyond-threshold corridor void so peeks look genuinely occluded
    for (const door of room.doorways) {
      const lintelH = Math.max(0.2, room.height - door.height);
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(door.width + 0.18, lintelH, 0.18),
        this.wallMat,
      );
      const angle = Math.atan2(door.outwardNormal.x, door.outwardNormal.z);
      lintel.position.set(door.center.x, door.height + lintelH * 0.5, door.center.z);
      lintel.rotation.y = angle;
      this.roomGroup.add(lintel);

      // Dim outer corridor alcove behind doorway (with side walls fading into fog)
      const alcoveGroup = new THREE.Group();
      alcoveGroup.position.set(door.center.x, 0, door.center.z);
      alcoveGroup.rotation.y = angle;

      const alcoveFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(door.width + 0.6, 3.2),
        this.furnDarkMat,
      );
      alcoveFloor.rotation.x = -Math.PI / 2;
      alcoveFloor.position.set(0, 0.005, 1.6);
      alcoveGroup.add(alcoveFloor);

      for (const sx of [-1, 1]) {
        const sideWall = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, room.height, 3.2),
          this.furnDarkMat,
        );
        sideWall.position.set(sx * (door.width * 0.5 + 0.14), room.height * 0.5, 1.6);
        alcoveGroup.add(sideWall);
      }
      this.roomGroup.add(alcoveGroup);
    }

    // Composite furniture with contact shadow discs
    for (const piece of room.furniture) {
      const furnGroup = buildFurnitureGroup(
        piece,
        this.furnDarkMat,
        this.furnMidMat,
        this.furnTrimMat,
      );
      this.roomGroup.add(furnGroup);

      const shadowDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(piece.width + 0.25, piece.depth + 0.25),
        this.shadowDiscMat,
      );
      shadowDisc.rotation.x = -Math.PI / 2;
      shadowDisc.position.set(piece.center.x, 0.015, piece.center.z);
      this.roomGroup.add(shadowDisc);
    }
  }

  private bindEvents() {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  }

  private handleResize = () => {
    if (this.disposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (this.gameState !== 'playing') return;
    this.keys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private handleBlur = () => {
    this.keys.clear();
    this.isDragging = false;
  };

  private handlePointerDown = (e: PointerEvent) => {
    if (this.gameState !== 'playing') return;
    this.isDragging = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (this.gameState !== 'playing' || !this.isDragging) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.targetYaw -= dx * 0.0042;
    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - dy * 0.0032, -0.75, 0.75);
  };

  private handlePointerUp = () => {
    this.isDragging = false;
  };

  private updatePlayer(dt: number) {
    // Keyboard + touch/virtual pad turning
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyQ')) this.targetYaw += dt * 1.9;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyE')) this.targetYaw -= dt * 1.9;
    if (this.virtualTurn !== 0) this.targetYaw += this.virtualTurn * dt * 1.9;

    this.playerYaw = THREE.MathUtils.damp(this.playerYaw, this.targetYaw, 14, dt);
    this.playerPitch = THREE.MathUtils.damp(this.playerPitch, this.targetPitch, 14, dt);

    const keyForward =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const keyStrafe =
      (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);

    const forwardInput = THREE.MathUtils.clamp(keyForward + this.virtualForward, -1, 1);
    const strafeInput = THREE.MathUtils.clamp(keyStrafe + this.virtualStrafe, -1, 1);

    if (forwardInput !== 0 || strafeInput !== 0) {
      _fwd.set(-Math.sin(this.playerYaw), 0, -Math.cos(this.playerYaw));
      _right.set(Math.cos(this.playerYaw), 0, -Math.sin(this.playerYaw));
      _move
        .set(0, 0, 0)
        .addScaledVector(_fwd, forwardInput)
        .addScaledVector(_right, strafeInput)
        .normalize()
        .multiplyScalar(2.1 * dt);

      const nextX = this.playerPos.x + _move.x;
      const nextZ = this.playerPos.z + _move.z;
      const hw = this.currentRoom.width * 0.5 - 0.45;
      const hd = this.currentRoom.depth * 0.5 - 0.45;
      this.playerPos.x = THREE.MathUtils.clamp(nextX, -hw, hw);
      this.playerPos.z = THREE.MathUtils.clamp(nextZ, -hd, hd);
    }

    this.syncCameraPose();
    this.callbacksRef.current.onPoseUpdate(
      { x: this.playerPos.x, y: this.playerPos.y, z: this.playerPos.z },
      this.playerYaw,
    );
  }

  private syncCameraPose() {
    this.camera.position.copy(this.playerPos);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.playerYaw;
    this.camera.rotation.x = this.playerPitch;
    this.camera.rotation.z = 0;
  }

  private syncWebXRPlanesAndOcclusion(frame: XRFrameWithDetection, refSpace: XRReferenceSpace) {
    const detected = frame.detectedPlanes;
    if (!detected) return;

    const nowMs = performance.now();
    let changed = false;

    // Remove planes no longer tracked
    for (const [plane, entry] of this.xrPlaneCache.entries()) {
      if (!detected.has(plane)) {
        this.xrOcclusionGroup.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        this.xrPlaneCache.delete(plane);
        changed = true;
      }
    }

    const snapshots: DetectedPlaneSnapshot[] = [];
    let idx = 0;

    for (const plane of detected) {
      idx += 1;
      const pose = frame.getPose(plane.planeSpace, refSpace);
      if (!pose) continue;

      _xrMat.fromArray(pose.transform.matrix);
      _xrMat.decompose(_xrPos, _xrQuat, _xrScale);

      // Compute local plane polygon bounds in XZ (planeSpace Y is normal)
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const pt of plane.polygon) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      }
      const w = Math.max(0.2, maxX - minX);
      const d = Math.max(0.2, maxZ - minZ);

      let cached = this.xrPlaneCache.get(plane);
      if (!cached || cached.lastChanged < plane.lastChangedTime) {
        if (cached) {
          this.xrOcclusionGroup.remove(cached.mesh);
          cached.mesh.geometry.dispose();
        }
        const geo = new THREE.PlaneGeometry(w, d);
        geo.rotateX(-Math.PI / 2);
        const occMesh = new THREE.Mesh(geo, this.xrOcclusionMat);
        occMesh.renderOrder = -1;
        occMesh.position.copy(_xrPos);
        occMesh.quaternion.copy(_xrQuat);
        this.xrOcclusionGroup.add(occMesh);
        cached = { lastChanged: plane.lastChangedTime, mesh: occMesh };
        this.xrPlaneCache.set(plane, cached);
        changed = true;
      }

      // World normal of planeSpace +Y
      _fwd.set(0, 1, 0).applyQuaternion(_xrQuat).normalize();
      const tangentX = new THREE.Vector3(1, 0, 0).applyQuaternion(_xrQuat);

      const snap: DetectedPlaneSnapshot = {
        id: `xr-plane-${idx}`,
        orientation: plane.orientation,
        semanticLabel: plane.semanticLabel || plane.orientation,
        center: { x: _xrPos.x, y: _xrPos.y, z: _xrPos.z },
        normal: { x: _fwd.x, y: _fwd.y, z: _fwd.z },
        width: w,
        depthOrHeight: d,
      };

      if (plane.orientation === 'vertical') {
        snap.segmentStart = {
          x: _xrPos.x - tangentX.x * (w * 0.5),
          z: _xrPos.z - tangentX.z * (w * 0.5),
        };
        snap.segmentEnd = {
          x: _xrPos.x + tangentX.x * (w * 0.5),
          z: _xrPos.z + tangentX.z * (w * 0.5),
        };
      }

      snapshots.push(snap);
    }

    if (changed || nowMs - this.lastXrPlaneSyncMs > 2500) {
      this.lastXrPlaneSyncMs = nowMs;
      this.callbacksRef.current.onXrPlanesUpdated?.(snapshots);
    }
  }

  private xrTick = (time: number, frame?: XRFrame) => {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = (now - this.lastTimeMs) / 1000;
    this.lastTimeMs = now;
    const dt = Math.min(rawDt, 0.05);

    const refSpace = this.renderer.xr.getReferenceSpace();
    if (frame && refSpace) {
      const xrFrame = frame as XRFrameWithDetection;
      const viewerPose = xrFrame.getViewerPose(refSpace);
      if (viewerPose) {
        _xrMat.fromArray(viewerPose.transform.matrix);
        _xrMat.decompose(_xrPos, _xrQuat, _xrScale);
        _xrEuler.setFromQuaternion(_xrQuat, 'YXZ');

        this.playerPos.copy(_xrPos).add(this.xrWorldOffset);
        this.playerYaw = _xrEuler.y;
        this.callbacksRef.current.onPoseUpdate(
          { x: this.playerPos.x, y: this.playerPos.y, z: this.playerPos.z },
          this.playerYaw,
        );
      }

      // Optional Quest/Pico controller thumbstick locomotion for seated play
      if (this.xrSession && this.gameState === 'playing') {
        for (const src of this.xrSession.inputSources) {
          const axes = src.gamepad?.axes;
          if (axes && axes.length >= 4) {
            const stickX = Math.abs(axes[2]) > 0.18 ? axes[2] : 0;
            const stickY = Math.abs(axes[3]) > 0.18 ? axes[3] : 0;
            if (src.handedness === 'left' && (stickX !== 0 || stickY !== 0)) {
              _fwd.set(-Math.sin(this.playerYaw), 0, -Math.cos(this.playerYaw));
              _right.set(Math.cos(this.playerYaw), 0, -Math.sin(this.playerYaw));
              this.xrWorldOffset.addScaledVector(_fwd, -stickY * 1.8 * dt);
              this.xrWorldOffset.addScaledVector(_right, stickX * 1.8 * dt);
            }
          }
        }
      }

      this.syncWebXRPlanesAndOcclusion(xrFrame, refSpace);
    }

    if (this.gameState === 'playing') {
      this.updateThreatVisuals(time / 1000);
    }
    this.renderer.render(this.scene, this.camera);
  };

  private updateThreatVisuals(elapsedSec: number) {
    for (const threat of this.activeThreats) {
      const entry = this.threatMeshes.get(threat.id);
      if (!entry) continue;
      const m = threat.manifestation;

      if (entry.archetype === 'WallPeel') {
        // Starts flattened like a damp wall shadow, slowly peels outward in Z depth
        const depthScale = THREE.MathUtils.lerp(0.05, 1.0, m);
        entry.group.scale.set(1, THREE.MathUtils.lerp(0.85, 1.06, m), depthScale);
        entry.group.position.set(
          threat.position.x + threat.normal.x * (m * 0.16),
          0,
          threat.position.z + threat.normal.z * (m * 0.16),
        );
      } else if (entry.archetype === 'UnderVoidCrawler') {
        // Creeps forward slightly out from beneath furniture shadow
        entry.group.position.set(
          threat.position.x + threat.normal.x * (m * 0.48),
          0,
          threat.position.z + threat.normal.z * (m * 0.48),
        );
        entry.group.scale.setScalar(THREE.MathUtils.lerp(0.65, 1.0, m));
      } else if (entry.archetype === 'CeilingHang') {
        const ceilingY =
          threat.position.y > 1.5 ? threat.position.y : this.currentRoom.height;
        entry.group.position.set(
          threat.position.x,
          ceilingY + (1 - m) * 0.45,
          threat.position.z,
        );
        entry.group.rotation.z = Math.sin(elapsedSec * 0.9) * 0.03;
      } else {
        // DoorwayPeeker / CornerWatcher lean slightly outward along normal
        entry.group.position.set(
          threat.position.x + threat.normal.x * (m * 0.18),
          0,
          threat.position.z + threat.normal.z * (m * 0.18),
        );
        entry.group.scale.setScalar(THREE.MathUtils.lerp(0.82, 1.0, m));
      }
    }
  }

  private tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = (now - this.lastTimeMs) / 1000;
    this.lastTimeMs = now;
    const dt = Math.min(rawDt, 0.05);

    if (this.gameState === 'title') {
      // Slow architectural camera pan inside the monochrome room
      this.tourAngle += dt * 0.11;
      const rx = this.currentRoom.width * 0.22;
      const rz = this.currentRoom.depth * 0.22;
      this.camera.position.set(
        Math.sin(this.tourAngle) * rx,
        1.55 + Math.sin(this.tourAngle * 0.7) * 0.08,
        Math.cos(this.tourAngle) * rz + 0.5,
      );
      _lookTarget.set(0, 1.25, -this.currentRoom.depth * 0.2);
      this.camera.lookAt(_lookTarget);
    } else if (this.gameState === 'playing') {
      this.updatePlayer(dt);
      this.updateThreatVisuals(now / 1000);
    }

    this.renderer.render(this.scene, this.camera);
    this.scheduleNextTick();
  };

  private scheduleNextTick() {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(this.tick, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  public dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    void this.exitWebXR();
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    void this.toggleWebcamPassthrough(false);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
