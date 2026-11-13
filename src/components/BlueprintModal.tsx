import React, { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type {
  AIScarePlan,
  AIScareSpot,
  AttentionState,
  HorrorPhase,
  RoomLayout,
  SpatialSlot,
} from '../engine/types';

interface BlueprintModalProps {
  room: RoomLayout;
  slots: SpatialSlot[];
  attention: AttentionState;
  aiPlan: AIScarePlan | null;
  analyzing: boolean;
  onReanalyze: (phase: HorrorPhase) => void;
  onClose: () => void;
}

const PHASES: Array<{ id: HorrorPhase; label: string }> = [
  { id: 'PeripheralDoubt', label: 'Peripheral Doubt' },
  { id: 'Occupation', label: 'Occupation' },
  { id: 'SpatialBetrayal', label: 'Spatial Betrayal' },
  { id: 'Compression', label: 'Compression' },
];

export const BlueprintModal: React.FC<BlueprintModalProps> = ({
  room,
  slots,
  attention,
  aiPlan,
  analyzing,
  onReanalyze,
  onClose,
}) => {
  const [selectedPhase, setSelectedPhase] = useState<HorrorPhase>('PeripheralDoubt');
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(
    aiPlan?.spots[0]?.slotId ?? null,
  );

  const spots = aiPlan?.spots ?? [];
  const topFive = spots.slice(0, 5);
  const activeSpot: AIScareSpot | undefined =
    spots.find((s) => s.slotId === selectedSpotId) ?? topFive[0];
  const activeSlot = activeSpot
    ? slots.find((sl) => sl.id === activeSpot.slotId)
    : undefined;

  // SVG viewport projection centered on room
  const pad = 1.2;
  const minX = -room.width * 0.5 - pad;
  const minZ = -room.depth * 0.5 - pad;
  const viewW = room.width + pad * 2;
  const viewH = room.depth + pad * 2;

  const yaw = attention.playerYawRad;
  const px = attention.playerPosition.x;
  const pz = attention.playerPosition.z;
  const fwdX = -Math.sin(yaw);
  const fwdZ = -Math.cos(yaw);
  const fovHalf = (38 * Math.PI) / 180;
  const rayLen = 2.6;
  const leftRayX = px + (-Math.sin(yaw + fovHalf)) * rayLen;
  const leftRayZ = pz + (-Math.cos(yaw + fovHalf)) * rayLen;
  const rightRayX = px + (-Math.sin(yaw - fovHalf)) * rayLen;
  const rightRayZ = pz + (-Math.cos(yaw - fovHalf)) * rayLen;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="AI Spatial Blueprint"
    >
      <div className="w-full max-w-5xl border border-white/20 bg-[#080808] text-[#f2f2f2] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/15 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-white">
              AI Spatial Threat Blueprint — {room.name}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-400">
              {room.width.toFixed(1)}m × {room.depth.toFixed(1)}m × {room.height.toFixed(1)}m ·{' '}
              {slots.length} extracted geometry anchors ·{' '}
              <span className="font-mono-tabular text-neutral-200">
                Source: {aiPlan?.source === 'gemini' ? 'Gemini AI Director' : 'Local Spatial Utility'}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI Spatial Blueprint"
            className="flex h-9 w-9 items-center justify-center border border-white/20 text-neutral-300 transition-colors hover:bg-white hover:text-black"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-12">
          {/* Left: Top-Down Architectural Floorplan */}
          <div className="lg:col-span-6">
            <div className="border border-white/15 bg-[#040404] p-3">
              <svg
                viewBox={`${minX} ${minZ} ${viewW} ${viewH}`}
                className="aspect-square w-full"
                aria-label="Top-down architectural room blueprint with AI scare hotspots"
              >
                {/* Floor boundary */}
                <rect
                  x={-room.width * 0.5}
                  y={-room.depth * 0.5}
                  width={room.width}
                  height={room.depth}
                  fill="#0b0b0b"
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth={0.04}
                />

                {/* Furniture */}
                {room.furniture.map((f) => (
                  <g key={f.id}>
                    <rect
                      x={f.center.x - f.width * 0.5}
                      y={f.center.z - f.depth * 0.5}
                      width={f.width}
                      height={f.depth}
                      fill={f.underClearance >= 0.45 ? '#181818' : '#242424'}
                      stroke="rgba(255,255,255,0.35)"
                      strokeDasharray={f.underClearance >= 0.45 ? '0.1 0.08' : undefined}
                      strokeWidth={0.04}
                    />
                    <text
                      x={f.center.x}
                      y={f.center.z + 0.08}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.55)"
                      fontSize={0.24}
                    >
                      {f.label}
                    </text>
                  </g>
                ))}

                {/* Walls */}
                {room.walls.map((w) => (
                  <line
                    key={w.id}
                    x1={w.start.x}
                    y1={w.start.z}
                    x2={w.end.x}
                    y2={w.end.z}
                    stroke="#f2f2f2"
                    strokeWidth={0.12}
                    strokeLinecap="square"
                  />
                ))}

                {/* Doorways */}
                {room.doorways.map((d) => (
                  <g key={d.id}>
                    <line
                      x1={d.jambLeft.x}
                      y1={d.jambLeft.z}
                      x2={d.jambRight.x}
                      y2={d.jambRight.z}
                      stroke="#ffffff"
                      strokeWidth={0.05}
                      strokeDasharray="0.12 0.12"
                    />
                  </g>
                ))}

                {/* Player FOV Cone */}
                <polygon
                  points={`${px},${pz} ${leftRayX},${leftRayZ} ${rightRayX},${rightRayZ}`}
                  fill="rgba(255,255,255,0.08)"
                  stroke="rgba(255,255,255,0.28)"
                  strokeWidth={0.03}
                />
                <circle cx={px} cy={pz} r={0.18} fill="#ffffff" />
                <line
                  x1={px}
                  y1={pz}
                  x2={px + fwdX * 0.55}
                  y2={pz + fwdZ * 0.55}
                  stroke="#ffffff"
                  strokeWidth={0.05}
                />

                {/* All non-top extracted slots */}
                {slots.map((sl) => (
                  <circle
                    key={sl.id}
                    cx={sl.position.x}
                    cy={sl.position.z}
                    r={0.08}
                    fill="rgba(255,255,255,0.22)"
                  />
                ))}

                {/* Top 5 AI-ranked scare hotspots */}
                {topFive.map((spot, idx) => {
                  const sl = slots.find((s) => s.id === spot.slotId);
                  if (!sl) return null;
                  const isSelected = activeSpot?.slotId === spot.slotId;
                  return (
                    <g
                      key={spot.slotId}
                      onClick={() => setSelectedSpotId(spot.slotId)}
                      className="cursor-pointer"
                    >
                      <circle
                        cx={sl.position.x}
                        cy={sl.position.z}
                        r={isSelected ? 0.34 : 0.25}
                        fill={isSelected ? '#ffffff' : '#111111'}
                        stroke="#ffffff"
                        strokeWidth={isSelected ? 0.08 : 0.05}
                      />
                      <text
                        x={sl.position.x}
                        y={sl.position.z + 0.09}
                        textAnchor="middle"
                        fill={isSelected ? '#000000' : '#ffffff'}
                        fontSize={0.24}
                        fontWeight="bold"
                      >
                        {idx + 1}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
              <span>Solid line: Wall · Dashed outline: Under-furniture void</span>
              <span>White dot + cone: Player &amp; Gaze FOV</span>
            </div>
          </div>

          {/* Right: Phase Simulation & AI Tactical Ranking */}
          <div className="flex flex-col justify-between gap-4 lg:col-span-6">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1 border border-white/15 bg-[#0e0e0e] p-1">
                  {PHASES.map((ph) => (
                    <button
                      key={ph.id}
                      type="button"
                      onClick={() => setSelectedPhase(ph.id)}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        selectedPhase === ph.id
                          ? 'bg-white text-black'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {ph.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={analyzing}
                  onClick={() => onReanalyze(selectedPhase)}
                  className="inline-flex items-center gap-2 border border-white/30 bg-white px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-neutral-200 disabled:opacity-50 whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${analyzing ? 'animate-spin' : ''}`} />
                  {analyzing ? 'Analyzing Geometry...' : 'Analyze Room Spots with AI'}
                </button>
              </div>

              {aiPlan?.roomAssessment && (
                <div className="border border-white/15 bg-[#0e0e0e] px-3.5 py-2.5 text-xs leading-relaxed text-neutral-300">
                  <span className="font-mono-tabular mr-2 text-white">ASSESSMENT:</span>
                  {aiPlan.roomAssessment}
                </div>
              )}

              <div className="space-y-1.5" role="list" aria-label="AI ranked scare hotspots">
                {topFive.map((spot, idx) => {
                  const slot = slots.find((s) => s.id === spot.slotId);
                  const isSelected = activeSpot?.slotId === spot.slotId;
                  return (
                    <button
                      key={spot.slotId}
                      type="button"
                      onClick={() => setSelectedSpotId(spot.slotId)}
                      className={`w-full border px-3.5 py-2.5 text-left transition-colors ${
                        isSelected
                          ? 'border-white bg-white/10'
                          : 'border-white/10 bg-[#0b0b0b] hover:border-white/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-xs font-semibold text-white">
                          {idx + 1}. {spot.archetype} · {slot?.label ?? spot.slotId}
                        </span>
                        <span className="font-mono-tabular shrink-0 text-xs text-neutral-300 whitespace-nowrap">
                          {spot.score}/99 · {spot.audioBaitAzimuthDeg}°
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-snug text-neutral-400">
                        {spot.psychologyReason}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {activeSpot && activeSlot && (
              <div className="border-t border-white/15 pt-3 text-xs text-neutral-400">
                Selected anchor: <span className="text-neutral-200">{activeSlot.type}</span> at{' '}
                <span className="font-mono-tabular text-neutral-200">
                  ({activeSlot.position.x.toFixed(2)}m, {activeSlot.position.y.toFixed(2)}m,{' '}
                  {activeSlot.position.z.toFixed(2)}m)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
