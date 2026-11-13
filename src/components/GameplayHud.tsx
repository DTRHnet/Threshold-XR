import React from 'react';
import { Compass, Pause, Volume2, VolumeX, Zap } from 'lucide-react';
import type { HorrorPhase } from '../engine/types';

interface GameplayHudProps {
  remainingSec: number;
  isCalibrating: boolean;
  phase: HorrorPhase;
  muted: boolean;
  micEnabled: boolean;
  xrActive: boolean;
  xrPlaneCount: number;
  dbRel: number;
  sensitivityDb: number;
  onToggleMute: () => void;
  onPause: () => void;
  onExitXr: () => void;
  onOpenBlueprint: () => void;
  onSimulateVocalSpike: () => void;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export const GameplayHud: React.FC<GameplayHudProps> = ({
  remainingSec,
  isCalibrating,
  phase,
  muted,
  micEnabled,
  xrActive,
  xrPlaneCount,
  dbRel,
  sensitivityDb,
  onToggleMute,
  onPause,
  onExitXr,
  onOpenBlueprint,
  onSimulateVocalSpike,
}) => {
  const dbRatio = Math.max(0, Math.min(1, dbRel / Math.max(1, sensitivityDb)));

  return (
    <div className="fixed inset-0 z-20 pointer-events-none select-none">
      {/* Center 4px gaze dot */}
      <div
        className="fixed left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 bg-white/55"
        aria-hidden="true"
      />

      {/* Top-Left: Clinical countdown & phase */}
      <div className="fixed left-6 top-5 flex flex-col gap-0.5">
        <div
          className="font-mono-tabular text-2xl font-semibold tracking-tight text-white"
          style={{ textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}
        >
          {formatTime(remainingSec)}
        </div>
        <div
          className="text-xs text-neutral-300"
          style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}
        >
          {isCalibrating
            ? 'Calibrating baseline silence...'
            : xrActive
              ? `${phase} · WebXR AR (${xrPlaneCount} planes)`
              : `${phase} phase`}
        </div>
      </div>

      {/* Top-Right: Compact utility controls */}
      <div className="fixed right-6 top-5 flex items-center gap-2 pointer-events-auto">
        {xrActive && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onExitXr();
            }}
            className="flex h-9 items-center border border-white/30 bg-black/80 px-2.5 text-xs font-medium text-white transition-colors hover:bg-white hover:text-black whitespace-nowrap"
          >
            Exit AR
          </button>
        )}

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onOpenBlueprint();
          }}
          aria-label="Inspect AI Spatial Blueprint"
          title="AI Spatial Blueprint"
          className="flex h-9 w-9 items-center justify-center border border-white/20 bg-black/75 text-neutral-300 transition-colors hover:border-white hover:text-white"
        >
          <Compass className="h-4 w-4" />
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onSimulateVocalSpike();
          }}
          aria-label="Test Vocal Spike"
          title="Test Vocal Spike [V]"
          className="flex h-9 items-center gap-1.5 border border-white/20 bg-black/75 px-2.5 text-xs font-medium text-neutral-300 transition-colors hover:border-white hover:text-white whitespace-nowrap"
        >
          <Zap className="h-3.5 w-3.5" />
          Test Shriek
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          aria-label={muted ? 'Unmute audio' : 'Mute audio'}
          title="Mute [M]"
          className="flex h-9 w-9 items-center justify-center border border-white/20 bg-black/75 text-neutral-300 transition-colors hover:border-white hover:text-white"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onPause();
          }}
          aria-label="Pause protocol"
          title="Pause [P / Esc]"
          className="flex h-9 w-9 items-center justify-center border border-white/20 bg-black/75 text-neutral-300 transition-colors hover:border-white hover:text-white"
        >
          <Pause className="h-4 w-4" />
        </button>
      </div>

      {/* Bottom-Left: Minimal hairline acoustic floor bar */}
      <div className="fixed bottom-5 left-6 flex items-center gap-3">
        <span
          className="text-xs text-neutral-300"
          style={{ textShadow: '0 1px 4px rgba(0,0,0,0.95)' }}
        >
          {micEnabled ? 'Acoustic Monitor' : 'Silent Mode'}
        </span>
        <div className="h-1 w-28 bg-white/20">
          <div
            className="h-full bg-white transition-transform duration-75 origin-left"
            style={{ transform: `scaleX(${dbRatio})` }}
          />
        </div>
      </div>
    </div>
  );
};
