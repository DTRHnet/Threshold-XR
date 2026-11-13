import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HorrorAudioEngine } from './audio/horrorAudio';
import { BlueprintModal } from './components/BlueprintModal';
import { GameplayHud } from './components/GameplayHud';
import { OutcomeOverlay } from './components/OutcomeOverlay';
import { TitleScreen } from './components/TitleScreen';
import {
  createDirectorState,
  stepThreatDirector,
  type DirectorState,
} from './engine/director';
import { createRoomPreset } from './engine/rooms';
import {
  createInitialAttention,
  extractSpatialSlots,
  scoreSlotsLocally,
  updateAttention,
} from './engine/spatial';
import { buildRoomFromWebXRPlanes } from './engine/webxrSpatial';
import type {
  AIScarePlan,
  AttentionState,
  GameState,
  HorrorPhase,
  RoomLayout,
  RoomPresetId,
  RunDurationSeconds,
  RunSummary,
  SpatialSlot,
  Vec3,
} from './engine/types';
import { ThresholdRoomRenderer, type RendererCallbacks } from './three/RoomRenderer';
import type { DetectedPlaneSnapshot } from './three/webxrTypes';

export default function App() {
  const rootOverlayRef = useRef<HTMLDivElement | null>(null);
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<ThresholdRoomRenderer | null>(null);
  const audioRef = useRef<HorrorAudioEngine | null>(null);

  const [roomPreset, setRoomPreset] = useState<RoomPresetId>('studio');
  const [randomSeed, setRandomSeed] = useState<number>(1);
  const [xrLiveRoom, setXrLiveRoom] = useState<{ room: RoomLayout; slots: SpatialSlot[] } | null>(
    null,
  );
  const [xrActive, setXrActive] = useState<boolean>(false);
  const [xrSupported, setXrSupported] = useState<boolean | null>(null);
  const [xrPlaneCount, setXrPlaneCount] = useState<number>(0);

  const baseRoom: RoomLayout = useMemo(
    () => createRoomPreset(roomPreset, randomSeed),
    [roomPreset, randomSeed],
  );
  const baseSlots: SpatialSlot[] = useMemo(() => extractSpatialSlots(baseRoom), [baseRoom]);

  const room = xrActive && xrLiveRoom ? xrLiveRoom.room : baseRoom;
  const slots = xrActive && xrLiveRoom ? xrLiveRoom.slots : baseSlots;

  const [durationSec, setDurationSec] = useState<RunDurationSeconds>(180);
  const [sensitivityDb, setSensitivityDb] = useState<number>(20);
  const [micEnabled, setMicEnabled] = useState<boolean>(false);
  const [webcamEnabled, setWebcamEnabled] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(false);
  const [capabilityNotice, setCapabilityNotice] = useState<string | null>(null);

  const [gameState, setGameState] = useState<GameState>('title');
  const [blueprintOpen, setBlueprintOpen] = useState<boolean>(false);
  const [analyzingAi, setAnalyzingAi] = useState<boolean>(false);
  const [aiPlan, setAiPlan] = useState<AIScarePlan | null>(null);

  // Live HUD state (updated at <= 10 Hz)
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [phase, setPhase] = useState<HorrorPhase>('Baseline');
  const [dbRel, setDbRel] = useState<number>(0);
  const [flashStage, setFlashStage] = useState<'none' | 'white' | 'black' | 'verdict'>('none');
  const [summary, setSummary] = useState<RunSummary | null>(null);

  // Mutable simulation refs so Three.js render loop & 10Hz director never tear down canvas
  const gameStateRef = useRef<GameState>('title');
  const roomRef = useRef<RoomLayout>(room);
  const slotsRef = useRef<SpatialSlot[]>(slots);
  const durationRef = useRef<RunDurationSeconds>(durationSec);
  const sensitivityRef = useRef<number>(sensitivityDb);
  const attentionRef = useRef<AttentionState>(
    createInitialAttention(room.spawnPosition, room.spawnYawRad, 0),
  );
  const directorRef = useRef<DirectorState>(createDirectorState(durationSec));
  const aiPlanRef = useRef<AIScarePlan | null>(null);
  const elapsedRef = useRef<number>(0);
  const peakDbRef = useRef<number>(0);
  const highestPhaseRef = useRef<HorrorPhase>('Baseline');
  const flashTimersRef = useRef<number[]>([]);

  useEffect(() => {
    roomRef.current = room;
    slotsRef.current = slots;
    if (!xrActive) {
      attentionRef.current = createInitialAttention(room.spawnPosition, room.spawnYawRad, 0);
      rendererRef.current?.setRoom(room);
    }
  }, [room, slots, xrActive]);

  useEffect(() => {
    durationRef.current = durationSec;
  }, [durationSec]);

  useEffect(() => {
    sensitivityRef.current = sensitivityDb;
  }, [sensitivityDb]);

  useEffect(() => {
    gameStateRef.current = gameState;
    document.body.dataset.state = gameState;
    rendererRef.current?.setGameState(gameState);
  }, [gameState]);

  // Check WebXR immersive-ar capability on mount
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.xr) {
      navigator.xr
        .isSessionSupported('immersive-ar')
        .then((ok) => setXrSupported(ok))
        .catch(() => setXrSupported(false));
    } else {
      setXrSupported(false);
    }
  }, []);

  const requestAiRoomAnalysis = useCallback(
    async (
      targetPhase: HorrorPhase,
      targetRoom = roomRef.current,
      targetSlots = slotsRef.current,
      targetAttention = attentionRef.current,
      recentlyUsed: string[] = [],
      elapsed = 0,
      gasps = 0,
    ) => {
      const immediatePlan: AIScarePlan = {
        source: 'heuristic',
        roomAssessment:
          'Evaluating architectural blind spots, doorway occlusions, and peripheral seams.',
        spots: scoreSlotsLocally(
          targetRoom,
          targetSlots,
          targetAttention,
          targetPhase,
          recentlyUsed,
          elapsed,
        ),
        generatedAtMs: Date.now(),
      };
      if (!aiPlanRef.current) {
        aiPlanRef.current = immediatePlan;
        setAiPlan(immediatePlan);
      }

      setAnalyzingAi(true);
      try {
        const res = await fetch('/api/ai/analyze-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room: targetRoom,
            slots: targetSlots,
            attention: targetAttention,
            phase: targetPhase,
            recentlyUsedSlotIds: recentlyUsed,
            elapsedSec: elapsed,
            subThresholdGasps: gasps,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const plan = (await res.json()) as AIScarePlan;
        aiPlanRef.current = plan;
        setAiPlan(plan);
      } catch {
        aiPlanRef.current = immediatePlan;
        setAiPlan(immediatePlan);
      } finally {
        setAnalyzingAi(false);
      }
    },
    [],
  );

  // Trigger initial AI analysis whenever room preset changes (outside active XR scan)
  useEffect(() => {
    if (xrActive) return;
    aiPlanRef.current = null;
    void requestAiRoomAnalysis(
      'PeripheralDoubt',
      baseRoom,
      baseSlots,
      createInitialAttention(baseRoom.spawnPosition, baseRoom.spawnYawRad, 0),
    );
  }, [baseRoom, baseSlots, xrActive, requestAiRoomAnalysis]);

  const triggerOutcome = useCallback((outcome: 'survived' | 'broke') => {
    flashTimersRef.current.forEach((id) => window.clearTimeout(id));
    flashTimersRef.current = [];

    audioRef.current?.stopRoomTone();
    document.exitPointerLock?.();

    const snap: RunSummary = {
      outcome,
      elapsedSec: elapsedRef.current,
      targetSec: durationRef.current,
      roomName: roomRef.current.name,
      spotsUsed: directorRef.current.spotsUsedCount,
      subThresholdGasps: directorRef.current.subThresholdGasps,
      peakDbRel: Number(peakDbRef.current.toFixed(1)),
      aiPlanSource: aiPlanRef.current?.source ?? 'heuristic',
      highestPhase: highestPhaseRef.current,
    };
    setSummary(snap);
    setGameState('gameover');

    if (outcome === 'broke') {
      setFlashStage('white');
      const t1 = window.setTimeout(() => setFlashStage('black'), 1000);
      const t2 = window.setTimeout(() => setFlashStage('verdict'), 2200);
      flashTimersRef.current = [t1, t2];
    } else {
      rendererRef.current?.clearThreats();
      setFlashStage('verdict');
    }
  }, []);

  const startRun = useCallback(() => {
    flashTimersRef.current.forEach((id) => window.clearTimeout(id));
    flashTimersRef.current = [];
    (document.activeElement as HTMLElement | null)?.blur();

    elapsedRef.current = 0;
    peakDbRef.current = 0;
    highestPhaseRef.current = 'Baseline';
    attentionRef.current = createInitialAttention(
      roomRef.current.spawnPosition,
      roomRef.current.spawnYawRad,
      0,
    );
    directorRef.current = createDirectorState(durationRef.current);

    audioRef.current?.resetAcousticState();
    audioRef.current?.startRoomTone();
    if (!rendererRef.current?.isXrActive()) {
      rendererRef.current?.resetPlayerToSpawn();
    }
    rendererRef.current?.clearThreats();
    rendererRef.current?.setPassthroughDimness(0);

    setElapsedSec(0);
    setPhase('Baseline');
    setDbRel(0);
    setFlashStage('none');
    setSummary(null);
    setBlueprintOpen(false);
    setGameState('playing');

    void requestAiRoomAnalysis(
      'PeripheralDoubt',
      roomRef.current,
      slotsRef.current,
      attentionRef.current,
      [],
      0,
      0,
    );
  }, [requestAiRoomAnalysis]);

  const enterWebXRPassthrough = useCallback(async () => {
    if (!rendererRef.current) return;
    setCapabilityNotice(null);
    const res = await rendererRef.current.enterWebXRPassthrough(rootOverlayRef.current);
    if (!res.ok) {
      setCapabilityNotice(res.reason || 'Unable to start WebXR immersive-ar session.');
      return;
    }
    setXrActive(true);
    // Initialize immediate relative room slots until Quest/Pico detectedPlanes stream in
    const initialXr = buildRoomFromWebXRPlanes(
      [],
      attentionRef.current.playerPosition,
      attentionRef.current.playerYawRad,
    );
    setXrLiveRoom(initialXr);
    startRun();
  }, [startRun]);

  const pauseRun = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    audioRef.current?.stopRoomTone();
    document.exitPointerLock?.();
    setGameState('paused');
  }, []);

  const resumeRun = useCallback(() => {
    if (gameStateRef.current !== 'paused') return;
    (document.activeElement as HTMLElement | null)?.blur();
    audioRef.current?.startRoomTone();
    setGameState('playing');
  }, []);

  const returnToTitle = useCallback(() => {
    flashTimersRef.current.forEach((id) => window.clearTimeout(id));
    flashTimersRef.current = [];
    audioRef.current?.stopRoomTone();
    void rendererRef.current?.exitWebXR();
    rendererRef.current?.clearThreats();
    rendererRef.current?.setPassthroughDimness(0);
    setFlashStage('none');
    setGameState('title');
  }, []);

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    const next = !audioRef.current.isMuted();
    audioRef.current.setMuted(next);
    setMuted(next);
  }, []);

  const toggleMic = useCallback(async () => {
    if (!audioRef.current) return;
    setCapabilityNotice(null);
    if (audioRef.current.isMicEnabled()) {
      audioRef.current.disableMicrophone();
      setMicEnabled(false);
    } else {
      const res = await audioRef.current.enableMicrophone();
      setMicEnabled(res.ok);
      if (!res.ok && res.reason) {
        setCapabilityNotice(res.reason);
      }
    }
  }, []);

  const toggleWebcam = useCallback(async () => {
    if (!rendererRef.current) return;
    setCapabilityNotice(null);
    const next = !webcamEnabled;
    const res = await rendererRef.current.toggleWebcamPassthrough(next);
    setWebcamEnabled(res.ok);
    if (next && !res.ok && res.reason) {
      setCapabilityNotice(res.reason);
    }
  }, [webcamEnabled]);

  const simulateVocalSpike = useCallback(() => {
    if (gameStateRef.current !== 'playing' || !audioRef.current) return;
    const acState = audioRef.current.injectSyntheticVocalSpike(sensitivityRef.current);
    peakDbRef.current = Math.max(peakDbRef.current, acState.lastDbRel);
    setDbRel(acState.lastDbRel);
    if (acState.breachTriggered) {
      triggerOutcome('broke');
    }
  }, [triggerOutcome]);


  const rendererCallbacksRef = useRef<RendererCallbacks>({
    onPoseUpdate: (pos: Vec3, yawRad: number) => {
      attentionRef.current = updateAttention(
        attentionRef.current,
        pos,
        yawRad,
        elapsedRef.current,
      );
    },
    onXrPlanesUpdated: (planes: DetectedPlaneSnapshot[]) => {
      setXrPlaneCount(planes.length);
      const converted = buildRoomFromWebXRPlanes(
        planes,
        attentionRef.current.playerPosition,
        attentionRef.current.playerYawRad,
      );
      setXrLiveRoom(converted);
      roomRef.current = converted.room;
      slotsRef.current = converted.slots;
      void requestAiRoomAnalysis(
        directorRef.current.phase === 'Baseline' ? 'PeripheralDoubt' : directorRef.current.phase,
        converted.room,
        converted.slots,
        attentionRef.current,
        directorRef.current.recentlyUsedSlotIds,
        elapsedRef.current,
        directorRef.current.subThresholdGasps,
      );
    },
    onXrSessionEnded: () => {
      setXrActive(false);
      setXrLiveRoom(null);
      setXrPlaneCount(0);
    },
  });

  // Mount Three.js renderer and Web Audio engine once
  useEffect(() => {
    if (!canvasMountRef.current) return;
    const audio = new HorrorAudioEngine();
    audioRef.current = audio;

    const renderer = new ThresholdRoomRenderer(
      canvasMountRef.current,
      roomRef.current,
      rendererCallbacksRef,
    );
    rendererRef.current = renderer;

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      startRun();
    }

    return () => {
      flashTimersRef.current.forEach((id) => window.clearTimeout(id));
      renderer.dispose();
      audio.dispose();
    };
  }, [startRun]);

  // 10 Hz Director & Acoustic Monitor Loop
  useEffect(() => {
    const dt = 0.1;
    const timer = window.setInterval(() => {
      if (gameStateRef.current !== 'playing') return;

      const nextElapsed = elapsedRef.current + dt;
      elapsedRef.current = nextElapsed;
      const target = durationRef.current;

      const isCalibrating = nextElapsed < 5.0;
      const acState = audioRef.current?.sampleMicrophone(
        sensitivityRef.current,
        isCalibrating,
      );
      if (acState) {
        peakDbRef.current = Math.max(peakDbRef.current, acState.lastDbRel);
        setDbRel(acState.lastDbRel);
        if (acState.breachTriggered) {
          triggerOutcome('broke');
          return;
        }
      }

      const tickRes = stepThreatDirector(
        directorRef.current,
        roomRef.current,
        slotsRef.current,
        attentionRef.current,
        aiPlanRef.current,
        nextElapsed,
        target,
        dt,
        acState?.subThresholdGaspRatio ?? 0,
      );
      directorRef.current = tickRes.state;
      highestPhaseRef.current = tickRes.state.phase;

      rendererRef.current?.setActiveThreats(tickRes.state.activeThreats);
      if (tickRes.state.phase === 'Compression') {
        rendererRef.current?.setPassthroughDimness(
          (tickRes.state.progress - 0.88) / 0.12,
        );
      }

      if (tickRes.audioBaitToTrigger) {
        audioRef.current?.playSpatialCue(
          tickRes.audioBaitToTrigger.azimuthDeg,
          tickRes.audioBaitToTrigger.kind,
        );
      }

      if (tickRes.needsAiRefresh) {
        void requestAiRoomAnalysis(
          tickRes.state.phase,
          roomRef.current,
          slotsRef.current,
          attentionRef.current,
          tickRes.state.recentlyUsedSlotIds,
          nextElapsed,
          tickRes.state.subThresholdGasps,
        );
      }

      setElapsedSec(nextElapsed);
      setPhase(tickRes.state.phase);

      if (nextElapsed >= target) {
        triggerOutcome('survived');
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [requestAiRoomAnalysis, triggerOutcome]);

  // Global keyboard shortcuts for shell states
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (blueprintOpen) {
        if (e.code === 'Escape') setBlueprintOpen(false);
        return;
      }
      if (gameStateRef.current === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          startRun();
        }
      } else if (gameStateRef.current === 'playing') {
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          pauseRun();
        } else if (e.code === 'KeyM') {
          toggleMute();
        } else if (e.code === 'KeyV') {
          simulateVocalSpike();
        }
      } else if (gameStateRef.current === 'paused') {
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          resumeRun();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [blueprintOpen, pauseRun, resumeRun, simulateVocalSpike, startRun, toggleMute]);

  return (
    <div ref={rootOverlayRef} className="relative h-full w-full overflow-hidden bg-[#050505]">
      {/* Dedicated WebGL / WebXR mount container isolated from React HUD */}
      <div
        ref={canvasMountRef}
        data-testid="three-viewport"
        className={`h-full w-full ${webcamEnabled ? 'grayscale contrast-150' : ''}`}
      />

      {/* Subtle analog film grain & cold vignette overlay (disabled in WebXR AR so passthrough stays sharp) */}
      {!xrActive && (
        <div
          className="film-grain-overlay pointer-events-none fixed inset-0 z-10"
          aria-hidden="true"
        />
      )}

      {gameState === 'title' && (
        <TitleScreen
          durationSec={durationSec}
          onSelectDuration={setDurationSec}
          roomPreset={roomPreset}
          onSelectRoom={setRoomPreset}
          onRandomizeRoom={() => {
            setRoomPreset('random');
            setRandomSeed((s) => s + 1);
          }}
          micEnabled={micEnabled}
          onToggleMic={toggleMic}
          webcamEnabled={webcamEnabled}
          onToggleWebcam={toggleWebcam}
          xrSupported={xrSupported}
          onEnterWebXR={enterWebXRPassthrough}
          capabilityNotice={capabilityNotice}
          sensitivityDb={sensitivityDb}
          onChangeSensitivity={setSensitivityDb}
          aiSourceLabel={
            aiPlan?.source === 'gemini'
              ? 'Gemini Spatial Threat Director'
              : 'Local Spatial Utility (no GEMINI_API_KEY)'
          }
          onOpenBlueprint={() => setBlueprintOpen(true)}
          onStart={startRun}
        />
      )}

      {gameState === 'playing' && (
        <GameplayHud
          remainingSec={Math.max(0, durationSec - elapsedSec)}
          isCalibrating={elapsedSec < 5.0}
          phase={phase}
          muted={muted}
          micEnabled={micEnabled}
          xrActive={xrActive}
          xrPlaneCount={xrPlaneCount}
          dbRel={dbRel}
          sensitivityDb={sensitivityDb}
          onToggleMute={toggleMute}
          onPause={pauseRun}
          onExitXr={() => void rendererRef.current?.exitWebXR()}
          onOpenBlueprint={() => {
            pauseRun();
            setBlueprintOpen(true);
          }}
          onSimulateVocalSpike={simulateVocalSpike}
        />
      )}

      <OutcomeOverlay
        gameState={gameState}
        flashStage={flashStage}
        summary={summary}
        onResume={resumeRun}
        onRestart={startRun}
        onReturnTitle={returnToTitle}
        onOpenBlueprint={() => setBlueprintOpen(true)}
      />

      {blueprintOpen && (
        <BlueprintModal
          room={room}
          slots={slots}
          attention={attentionRef.current}
          aiPlan={aiPlan}
          analyzing={analyzingAi}
          onReanalyze={(ph) => {
            void requestAiRoomAnalysis(ph);
          }}
          onClose={() => setBlueprintOpen(false)}
        />
      )}
    </div>
  );
}
