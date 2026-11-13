import 'dotenv/config';
import express from 'express';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  angleFromPlayerForwardRad,
  azimuthDegRelativeToPlayer,
  computeOcclusionRatio,
  getSectorAgeForTarget,
  scoreSlotsLocally,
} from './src/engine/spatial';
import type {
  AIScarePlan,
  AIScareSpot,
  AttentionState,
  HorrorPhase,
  RoomLayout,
  SpatialSlot,
  ThreatArchetype,
} from './src/engine/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const aiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

const VALID_ARCHETYPES = new Set<ThreatArchetype>([
  'WallPeel',
  'DoorwayPeeker',
  'UnderVoidCrawler',
  'CeilingHang',
  'CornerWatcher',
]);

interface AnalyzeRoomBody {
  room: RoomLayout;
  slots: SpatialSlot[];
  attention: AttentionState;
  phase: HorrorPhase;
  recentlyUsedSlotIds?: string[];
  elapsedSec?: number;
  subThresholdGasps?: number;
}

function buildSlotTelemetry(
  room: RoomLayout,
  slots: SpatialSlot[],
  attention: AttentionState,
  elapsedSec: number,
) {
  return slots.map((slot) => {
    const angleOffAxisDeg = Math.round(
      (angleFromPlayerForwardRad(attention.playerPosition, attention.playerYawRad, slot.position) *
        180) /
        Math.PI,
    );
    const azimuthDeg = Math.round(
      azimuthDegRelativeToPlayer(attention.playerPosition, attention.playerYawRad, slot.position),
    );
    const distanceM = Number(
      Math.hypot(
        slot.position.x - attention.playerPosition.x,
        slot.position.z - attention.playerPosition.z,
      ).toFixed(2),
    );
    const occlusionFraction = Number(
      computeOcclusionRatio(room, attention.playerPosition, slot).toFixed(2),
    );
    const secondsSinceCleared = Math.round(
      getSectorAgeForTarget(attention, slot.position, elapsedSec),
    );

    return {
      slotId: slot.id,
      type: slot.type,
      label: slot.label,
      recommendedArchetype: slot.recommendedArchetype,
      distanceM,
      angleOffAxisDeg,
      azimuthDeg,
      occlusionFraction,
      secondsSinceCleared: secondsSinceCleared > 500 ? 'uninspected' : secondsSinceCleared,
    };
  });
}

async function createGeminiScarePlan(body: AnalyzeRoomBody): Promise<AIScarePlan> {
  const {
    room,
    slots,
    attention,
    phase,
    recentlyUsedSlotIds = [],
    elapsedSec = 0,
    subThresholdGasps = 0,
  } = body;

  const fallbackSpots = scoreSlotsLocally(
    room,
    slots,
    attention,
    phase,
    recentlyUsedSlotIds,
    elapsedSec,
  );

  if (!aiClient || slots.length === 0) {
    return {
      source: 'heuristic',
      roomAssessment:
        'Local spatial utility model active. Prioritizing peripheral blind spots, doorway occlusions, and uninspected architectural seams.',
      spots: fallbackSpots,
      generatedAtMs: Date.now(),
    };
  }

  const telemetry = buildSlotTelemetry(room, slots, attention, elapsedSec);
  const validSlotIds = new Set(slots.map((s) => s.id));

  const systemInstruction = [
    'You are the Spatial Threat Director for THRESHOLD, a cold, clinical, black-and-white passthrough AR psychological endurance horror experience.',
    'Your job is to evaluate real architectural geometry and player gaze telemetry to pick the cleverest, most psychologically unsettling spots in the room to stage threats.',
    'Never suggest cheap jumpscares directly in the center of vision. Prioritize:',
    '1. Peripheral seams (55-105 deg off-axis) where slow wall-peels or crouched void forms are noticed only after they shift.',
    '2. Partial real-world occlusion (occlusionFraction 0.20-0.65) behind doorframes or corners.',
    '3. Cleared-space betrayal (sectors inspected 4-16s ago) and rear blind spots (>105 deg) paired with an audioBaitAzimuthDeg to coax a head turn.',
    'Keep psychologyReason concise, clinical, and specific to the room geometry (1 sentence).',
  ].join(' ');

  const prompt = JSON.stringify({
    roomName: room.name,
    dimensionsMeters: { width: room.width, depth: room.depth, height: room.height },
    currentPhase: phase,
    elapsedSeconds: Math.round(elapsedSec),
    subThresholdGaspsDetected: subThresholdGasps,
    recentlyUsedSlotIds,
    candidateSlots: telemetry,
  });

  const primaryModel = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';

  const runModel = async (modelName: string) => {
    const useThinking = modelName.startsWith('gemini-4') || modelName.startsWith('gemini-3');
    return aiClient.models.generateContent({
      model: modelName,
      contents: `Analyze these room slots and return the top 5 ranked scare placements:\n${prompt}`,
      config: {
        systemInstruction,
        ...(useThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            roomAssessment: {
              type: Type.STRING,
              description: 'One concise clinical sentence summarizing the room geometry weaknesses.',
            },
            spots: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  slotId: { type: Type.STRING },
                  score: { type: Type.INTEGER },
                  archetype: { type: Type.STRING },
                  psychologyReason: { type: Type.STRING },
                  audioBaitAzimuthDeg: { type: Type.INTEGER },
                  recommendedDelaySec: { type: Type.NUMBER },
                },
                required: [
                  'slotId',
                  'score',
                  'archetype',
                  'psychologyReason',
                  'audioBaitAzimuthDeg',
                  'recommendedDelaySec',
                ],
              },
            },
          },
          required: ['roomAssessment', 'spots'],
        },
      },
    });
  };

  try {
    let response;
    try {
      response = await runModel(primaryModel);
    } catch (firstErr) {
      const msg = (firstErr as Error)?.message || '';
      if (primaryModel === 'gemini-4-hydrogen' && (msg.includes('404') || msg.includes('NOT_FOUND'))) {
        response = await runModel('gemini-2.5-flash');
      } else {
        throw firstErr;
      }
    }

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      roomAssessment?: string;
      spots?: Array<Partial<AIScareSpot>>;
    };

    const sanitizedSpots: AIScareSpot[] = [];
    const seen = new Set<string>();
    for (const item of parsed.spots ?? []) {
      if (!item.slotId || !validSlotIds.has(item.slotId) || seen.has(item.slotId)) continue;
      seen.add(item.slotId);
      const slot = slots.find((s) => s.id === item.slotId)!;
      const archetype =
        item.archetype && VALID_ARCHETYPES.has(item.archetype as ThreatArchetype)
          ? (item.archetype as ThreatArchetype)
          : slot.recommendedArchetype;
      sanitizedSpots.push({
        slotId: item.slotId,
        score: Math.max(1, Math.min(99, Math.round(Number(item.score) || 75))),
        archetype,
        psychologyReason:
          typeof item.psychologyReason === 'string' && item.psychologyReason.trim().length > 0
            ? item.psychologyReason.trim()
            : `Exploits ${slot.label} blindspot.`,
        audioBaitAzimuthDeg: Math.max(
          -180,
          Math.min(180, Math.round(Number(item.audioBaitAzimuthDeg) || 0)),
        ),
        recommendedDelaySec: Math.max(
          0.2,
          Math.min(5, Number(item.recommendedDelaySec) || 1.0),
        ),
      });
    }

    // Fill remaining slots from local scorer so full room blueprint is always ranked
    for (const fb of fallbackSpots) {
      if (!seen.has(fb.slotId)) {
        sanitizedSpots.push(fb);
      }
    }

    if (sanitizedSpots.length === 0) {
      throw new Error('Gemini returned zero valid room slots');
    }

    return {
      source: 'gemini',
      roomAssessment:
        parsed.roomAssessment?.trim() ||
        'Gemini Spatial Director mapped blind spots and geometric occlusion vectors.',
      spots: sanitizedSpots,
      generatedAtMs: Date.now(),
    };
  } catch (err) {
    console.warn('[AI Spatial Director] Falling back to local scorer:', (err as Error).message);
    return {
      source: 'heuristic',
      roomAssessment:
        'Local spatial utility model active. Prioritizing peripheral blind spots, doorway occlusions, and uninspected architectural seams.',
      spots: fallbackSpots,
      generatedAtMs: Date.now(),
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(aiClient),
      appUrl: process.env.APP_URL || null,
    });
  });

  app.post('/api/ai/analyze-room', async (req, res) => {
    const body = req.body as AnalyzeRoomBody | undefined;
    if (!body?.room || !Array.isArray(body?.slots) || !body?.attention) {
      res.status(400).json({ error: 'Missing room, slots, or attention telemetry.' });
      return;
    }
    const plan = await createGeminiScarePlan(body);
    res.json(plan);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    // Express 4 (path-to-regexp v0) needs '*' for the catch-all; '/{*splat}' is Express 5 syntax.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (process.env.HTTPS === '1') {
    // Prefer locally trusted mkcert material (SANs cover the LAN IP), so a headset can
    // trust the CA once and keep a real secure context for WebXR.
    const keyPath = process.env.SSL_KEY_PATH || path.resolve(__dirname, '.certs/lan-key.pem');
    const certPath = process.env.SSL_CERT_PATH || path.resolve(__dirname, '.certs/lan.pem');
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      // Browsers ignore CN entirely and require a SAN, and WebXR needs the LAN IP covered.
      const sanEntries = ['DNS:localhost', 'IP:127.0.0.1'];
      for (const addrs of Object.values(os.networkInterfaces())) {
        for (const addr of addrs ?? []) {
          if (addr.family === 'IPv4' && !addr.internal) sanEntries.push(`IP:${addr.address}`);
        }
      }
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-days',
          '30',
          '-nodes',
          '-subj',
          '/CN=threshold-dev',
          '-addext',
          `subjectAltName=${sanEntries.join(',')}`,
        ],
        { stdio: 'ignore' },
      );
      console.warn(`[TLS] Generated self-signed cert for ${sanEntries.join(', ')}`);
      console.warn('[TLS] The headset will show a warning for this cert; use mkcert (see RUN-LAN.md) to avoid it.');
    }
    const creds = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
    https.createServer(creds, app).listen(PORT, '0.0.0.0', () => {
      console.log(`THRESHOLD server listening on https://0.0.0.0:${PORT} (WebXR secure context)`);
      console.log(`  local : https://localhost:${PORT}`);
      for (const addrs of Object.values(os.networkInterfaces())) {
        for (const addr of addrs ?? []) {
          if (addr.family === 'IPv4' && !addr.internal) {
            console.log(`  LAN   : https://${addr.address}:${PORT}`);
          }
        }
      }
    });
  } else {
    app.listen(PORT, '0.0.0.0', () => {
      console.warn(
        `THRESHOLD server listening on http://0.0.0.0:${PORT} — WebXR needs HTTPS (set HTTPS=1).`,
      );
    });
  }
}

startServer();
