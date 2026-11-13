import React from 'react';
import { Compass, Glasses, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import type { RoomPresetId, RunDurationSeconds } from '../engine/types';

interface TitleScreenProps {
  durationSec: RunDurationSeconds;
  onSelectDuration: (d: RunDurationSeconds) => void;
  roomPreset: RoomPresetId;
  onSelectRoom: (preset: RoomPresetId) => void;
  onRandomizeRoom: () => void;
  micEnabled: boolean;
  onToggleMic: () => void;
  webcamEnabled: boolean;
  onToggleWebcam: () => void;
  xrSupported: boolean | null;
  onEnterWebXR: () => void;
  capabilityNotice: string | null;
  sensitivityDb: number;
  onChangeSensitivity: (val: number) => void;
  aiSourceLabel: string;
  onOpenBlueprint: () => void;
  onStart: () => void;
}

const DURATIONS: Array<{ sec: RunDurationSeconds; label: string }> = [
  { sec: 60, label: '1 MIN' },
  { sec: 180, label: '3 MIN' },
  { sec: 300, label: '5 MIN' },
  { sec: 600, label: '10 MIN' },
];

const ROOMS: Array<{ id: RoomPresetId; label: string }> = [
  { id: 'studio', label: 'Studio' },
  { id: 'hallway', label: 'Hallway' },
  { id: 'office', label: 'Office' },
];

export const TitleScreen: React.FC<TitleScreenProps> = ({
  durationSec,
  onSelectDuration,
  roomPreset,
  onSelectRoom,
  onRandomizeRoom,
  micEnabled,
  onToggleMic,
  webcamEnabled,
  onToggleWebcam,
  xrSupported,
  onEnterWebXR,
  capabilityNotice,
  sensitivityDb,
  onChangeSensitivity,
  aiSourceLabel,
  onOpenBlueprint,
  onStart,
}) => {
  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-6 md:p-10 pointer-events-none">
      {/* Top Left: Bespoke Inline SVG Title Lockup over calm negative space */}
      <div className="max-w-xl pointer-events-auto">
        <svg
          viewBox="0 0 380 56"
          className="h-11 w-auto text-white"
          role="img"
          aria-label="THRESHOLD"
        >
          <rect x="2" y="8" width="4" height="40" fill="currentColor" />
          <rect x="10" y="8" width="2" height="40" fill="currentColor" opacity="0.45" />
          <text
            x="24"
            y="40"
            fill="currentColor"
            fontFamily="Archivo, sans-serif"
            fontWeight="700"
            fontSize="36"
            letterSpacing="0.16em"
          >
            THRESHOLD
          </text>
        </svg>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-300">
          Sit still in your room and maintain total silence until the timer expires. The spatial director scans your surroundings and stages threats inside your blind spots.
        </p>
      </div>

      {/* Bottom Left Configuration Dock + Primary CTA */}
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="w-full max-w-xl border border-white/15 bg-[#080808]/92 p-5 pointer-events-auto">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Duration */}
            <div>
              <div className="mb-1.5 text-xs font-medium text-neutral-400">
                Endurance Duration
              </div>
              <div className="grid grid-cols-4 gap-1 border border-white/15 bg-black p-1">
                {DURATIONS.map((d) => (
                  <button
                    key={d.sec}
                    type="button"
                    onClick={() => onSelectDuration(d.sec)}
                    className={`py-1.5 font-mono-tabular text-xs font-medium transition-colors whitespace-nowrap ${
                      durationSec === d.sec
                        ? 'bg-white text-black'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Room Geometry */}
            <div>
              <div className="mb-1.5 text-xs font-medium text-neutral-400">
                Room Geometry
              </div>
              <div className="flex gap-1 border border-white/15 bg-black p-1">
                {ROOMS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelectRoom(r.id)}
                    className={`flex-1 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      roomPreset === r.id
                        ? 'bg-white text-black'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onRandomizeRoom}
                  className={`px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    roomPreset === 'random'
                      ? 'bg-white text-black'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Random
                </button>
              </div>
            </div>
          </div>

          {/* Acoustic & Passthrough Row */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onEnterWebXR}
                className="inline-flex items-center gap-1.5 border border-white/40 bg-[#141414] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white hover:text-black whitespace-nowrap"
              >
                <Glasses className="h-3.5 w-3.5" />
                {xrSupported ? 'Enter WebXR AR' : 'WebXR AR'}
              </button>

              <button
                type="button"
                onClick={onToggleMic}
                className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  micEnabled
                    ? 'border-white bg-white text-black'
                    : 'border-white/20 bg-black text-neutral-300 hover:border-white/40'
                }`}
              >
                {micEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                {micEnabled ? 'Mic Active' : 'Enable Mic'}
              </button>

              <button
                type="button"
                onClick={onToggleWebcam}
                className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  webcamEnabled
                    ? 'border-white bg-white text-black'
                    : 'border-white/20 bg-black text-neutral-300 hover:border-white/40'
                }`}
              >
                {webcamEnabled ? (
                  <Video className="h-3.5 w-3.5" />
                ) : (
                  <VideoOff className="h-3.5 w-3.5" />
                )}
                {webcamEnabled ? 'Camera Feed On' : 'Camera Passthrough'}
              </button>

              <button
                type="button"
                onClick={onOpenBlueprint}
                className="inline-flex items-center gap-1.5 border border-white/25 bg-[#121212] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:border-white whitespace-nowrap"
              >
                <Compass className="h-3.5 w-3.5" />
                AI Spatial Blueprint
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <span>Threshold</span>
              <input
                type="range"
                min={14}
                max={32}
                step={1}
                value={sensitivityDb}
                onChange={(e) => onChangeSensitivity(Number(e.target.value))}
                className="w-20 accent-white"
              />
              <span className="font-mono-tabular text-neutral-200">+{sensitivityDb} dB</span>
            </label>
          </div>

          {capabilityNotice && (
            <div
              role="status"
              className="mt-3 border border-white/20 bg-black px-3 py-2 text-xs text-neutral-200"
            >
              {capabilityNotice}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-neutral-400">
              Director: <span className="text-neutral-200">{aiSourceLabel}</span>
            </span>
            <button
              type="button"
              data-start="true"
              onClick={onStart}
              className="bg-white px-7 py-2.5 text-sm font-semibold tracking-wide text-black transition-colors hover:bg-neutral-200 whitespace-nowrap"
            >
              Begin Protocol
            </button>
          </div>
        </div>

        {/* Clean single-line control hint */}
        <div className="text-xs text-neutral-400 pointer-events-none">
          Headset 6DoF / Drag Look · Sit Still &amp; Stay Silent · P Pause · Enter Start
        </div>
      </div>
    </div>
  );
};
