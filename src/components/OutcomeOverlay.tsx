import React from 'react';
import type { GameState, RunSummary } from '../engine/types';

interface OutcomeOverlayProps {
  gameState: GameState;
  flashStage: 'none' | 'white' | 'black' | 'verdict';
  summary: RunSummary | null;
  onResume: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
  onOpenBlueprint: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

export const OutcomeOverlay: React.FC<OutcomeOverlayProps> = ({
  gameState,
  flashStage,
  summary,
  onResume,
  onRestart,
  onReturnTitle,
  onOpenBlueprint,
}) => {
  if (gameState === 'paused') {
    return (
      <div
        className="fixed inset-0 z-30 flex items-center justify-center bg-black/80 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Protocol Paused"
      >
        <div className="w-full max-w-sm border border-white/20 bg-[#080808] p-6 text-white">
          <h2 className="text-lg font-semibold tracking-tight">Protocol Paused</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Simulation and acoustic detection suspended.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={onResume}
              className="w-full bg-white py-2.5 text-sm font-semibold text-black transition-colors hover:bg-neutral-200"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={onOpenBlueprint}
              className="w-full border border-white/20 bg-[#111111] py-2 text-xs font-medium text-neutral-200 transition-colors hover:border-white"
            >
              Inspect AI Spatial Blueprint
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="w-full border border-white/20 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-white hover:text-white"
            >
              Restart
            </button>
            <button
              type="button"
              onClick={onReturnTitle}
              className="w-full py-2 text-xs text-neutral-400 transition-colors hover:text-white"
            >
              Return to Title
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState !== 'gameover' || !summary) return null;

  if (flashStage === 'white') {
    return <div className="fixed inset-0 z-50 bg-white" aria-hidden="true" />;
  }

  if (flashStage === 'black') {
    return <div className="fixed inset-0 z-50 bg-black" aria-hidden="true" />;
  }

  const broke = summary.outcome === 'broke';

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black p-6"
      role="dialog"
      aria-modal="true"
      aria-label={broke ? 'Vocalization Detected' : 'Duration Complete'}
    >
      <div className="w-full max-w-md border border-white/20 bg-[#080808] p-8 text-white">
        <div className="font-mono-tabular text-xs tracking-widest text-neutral-400">
          {broke ? 'VOCALIZATION DETECTED' : 'DURATION COMPLETE'}
        </div>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-white">
          {broke ? 'You broke.' : 'Silence maintained.'}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-neutral-400">
          {broke
            ? 'Acoustic monitoring registered a sustained high-band vocal reaction.'
            : 'All manifestations cleared. The room yielded zero acoustic breach.'}
        </p>

        <div className="mt-6 grid grid-cols-3 gap-3 border-y border-white/15 py-4">
          <div>
            <div className="text-xs text-neutral-500">Elapsed</div>
            <div className="font-mono-tabular mt-0.5 text-base font-semibold text-white">
              {formatDuration(summary.elapsedSec)}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Phase</div>
            <div className="mt-0.5 text-sm font-medium text-neutral-200">
              {summary.highestPhase}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">AI Spots</div>
            <div className="font-mono-tabular mt-0.5 text-base font-semibold text-white">
              {summary.spotsUsed}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            data-start="true"
            onClick={onRestart}
            className="flex-1 bg-white py-2.5 text-sm font-semibold text-black transition-colors hover:bg-neutral-200"
          >
            {broke ? 'Try Again' : 'Run Again'}
          </button>
          <button
            type="button"
            onClick={onOpenBlueprint}
            className="border border-white/25 px-4 py-2.5 text-xs font-medium text-neutral-200 transition-colors hover:border-white"
          >
            AI Blueprint
          </button>
          <button
            type="button"
            onClick={onReturnTitle}
            className="border border-white/15 px-4 py-2.5 text-xs text-neutral-400 transition-colors hover:text-white"
          >
            Title
          </button>
        </div>
      </div>
    </div>
  );
};
