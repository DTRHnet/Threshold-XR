import type { AcousticState } from './types';

export const FFT_SIZE = 512;

const HANN_WINDOW = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  HANN_WINDOW[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
}

export function createAcousticState(): AcousticState {
  return {
    calibrated: false,
    calibrationSamples: 0,
    adaptiveFloorRms: 0.008,
    prevRmsHistory: [0.008, 0.008, 0.008, 0.008],
    consecutiveBreachFrames: 0,
    lastDbRel: 0,
    lastOnsetSlopeDb: 0,
    lastHighFreqRatio: 0,
    lastZcr: 0,
    subThresholdGaspRatio: 0,
    breachTriggered: false,
  };
}

/**
 * In-place radix-2 Cooley-Tukey FFT on real input of length 512.
 * Returns magnitude squared power spectrum for bins [0 .. N/2 - 1].
 */
export function computePowerSpectrum(
  windowedSamples: Float32Array,
  outPower: Float32Array,
): void {
  const n = FFT_SIZE;
  const re = new Float32Array(n);
  const im = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    re[i] = windowedSamples[i] * HANN_WINDOW[i];
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
    }
  }

  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angleStep = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const angle = angleStep * k;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * wRe - im[i + k + half] * wIm;
        const vIm = re[i + k + half] * wIm + im[i + k + half] * wRe;

        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
      }
    }
  }

  const halfN = n >> 1;
  for (let k = 0; k < halfN; k++) {
    outPower[k] = re[k] * re[k] + im[k] * im[k];
  }
}

const SCRATCH_POWER = new Float32Array(FFT_SIZE >> 1);

/**
 * Evaluates one 512-sample audio frame for sudden scream/shriek signatures.
 * Separates low-frequency thuds/footsteps (< 400Hz) from high-energy vocal shrieks (1.0 - 4.8 kHz).
 */
export function analyzeAudioFrame(
  samples: Float32Array,
  sampleRate: number,
  prev: AcousticState,
  sensitivityThresholdDb = 20,
  isCalibrating = false,
): AcousticState {
  const count = Math.min(samples.length, FFT_SIZE);
  let sumSq = 0;
  let zeroCrossings = 0;
  let prevSample = samples[0] ?? 0;

  for (let i = 0; i < count; i++) {
    const s = samples[i];
    sumSq += s * s;
    if ((s >= 0 && prevSample < 0) || (s < 0 && prevSample >= 0)) {
      zeroCrossings++;
    }
    prevSample = s;
  }

  const rms = Math.sqrt(sumSq / Math.max(1, count));
  const zcr = zeroCrossings / Math.max(1, count);

  // Adaptive ambient floor updates during calibration or quiet intervals
  let adaptiveFloorRms = prev.adaptiveFloorRms;
  let calibrationSamples = prev.calibrationSamples;
  let calibrated = prev.calibrated;

  if (isCalibrating) {
    calibrationSamples += 1;
    adaptiveFloorRms =
      calibrationSamples === 1
        ? Math.max(0.003, rms)
        : adaptiveFloorRms * 0.85 + Math.max(0.003, rms) * 0.15;
    if (calibrationSamples >= 15) {
      calibrated = true;
    }
  } else {
    const tentativeDb = 20 * Math.log10(Math.max(rms, 1e-6) / Math.max(adaptiveFloorRms, 1e-5));
    if (tentativeDb < 7.5) {
      adaptiveFloorRms = adaptiveFloorRms * 0.97 + Math.max(0.003, rms) * 0.03;
    }
  }

  const dbRel = 20 * Math.log10(Math.max(rms, 1e-6) / Math.max(adaptiveFloorRms, 1e-5));
  const oldestRms = prev.prevRmsHistory[0] ?? adaptiveFloorRms;
  const onsetSlopeDb = 20 * Math.log10(Math.max(rms, 1e-6) / Math.max(oldestRms, 1e-5));
  const nextHistory = [...prev.prevRmsHistory.slice(1), Math.max(rms, 1e-5)];

  // FFT spectral band energy ratio
  const padded = count === FFT_SIZE ? samples : new Float32Array(FFT_SIZE);
  if (count < FFT_SIZE) padded.set(samples.subarray(0, count));
  computePowerSpectrum(padded, SCRATCH_POWER);

  const binHz = sampleRate / FFT_SIZE;
  const minTotalBin = Math.max(1, Math.floor(80 / binHz));
  const minVocalBin = Math.max(minTotalBin, Math.floor(950 / binHz));
  const maxVocalBin = Math.min((FFT_SIZE >> 1) - 1, Math.ceil(4800 / binHz));

  let totalEnergy = 0;
  let vocalEnergy = 0;
  for (let k = minTotalBin; k <= maxVocalBin; k++) {
    const p = SCRATCH_POWER[k];
    totalEnergy += p;
    if (k >= minVocalBin) {
      vocalEnergy += p;
    }
  }

  const highFreqRatio = vocalEnergy / (totalEnergy + 1e-9);

  // Breach requires: loud sudden spike + scream/vocal spectral profile sustained >= 3 frames (~96ms)
  const isAmplitudeSpike =
    !isCalibrating && dbRel >= sensitivityThresholdDb && onsetSlopeDb >= 8.5;
  const isVocalSignature = highFreqRatio >= 0.3 && zcr >= 0.06;

  let consecutiveBreachFrames = prev.consecutiveBreachFrames;
  if (isAmplitudeSpike && isVocalSignature) {
    consecutiveBreachFrames += 1;
  } else {
    consecutiveBreachFrames = Math.max(0, consecutiveBreachFrames - 1);
  }

  const breachTriggered = prev.breachTriggered || (!isCalibrating && consecutiveBreachFrames >= 3);

  // Sub-threshold gasp / stifled reaction ratio (0..1)
  const gaspRaw =
    !isCalibrating && dbRel >= sensitivityThresholdDb * 0.45 && highFreqRatio >= 0.22
      ? Math.min(1, (dbRel - sensitivityThresholdDb * 0.4) / (sensitivityThresholdDb * 0.6))
      : prev.subThresholdGaspRatio * 0.85;

  return {
    calibrated,
    calibrationSamples,
    adaptiveFloorRms,
    prevRmsHistory: nextHistory,
    consecutiveBreachFrames,
    lastDbRel: Math.max(0, dbRel),
    lastOnsetSlopeDb: onsetSlopeDb,
    lastHighFreqRatio: highFreqRatio,
    lastZcr: zcr,
    subThresholdGaspRatio: Math.max(0, Math.min(1, gaspRaw)),
    breachTriggered,
  };
}
