import { FFT_SIZE, analyzeAudioFrame, createAcousticState } from '../engine/acoustics';
import type { SpatialAudioCueKind } from '../engine/director';
import type { AcousticState } from '../engine/types';

export class HorrorAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private roomToneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private shimmerGain: GainNode | null = null;
  private roomOscNodes: OscillatorNode[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private lastPulseAtMs = 0;

  // Live microphone monitoring nodes
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micTimeBuffer: Float32Array<ArrayBuffer> = new Float32Array(
    new ArrayBuffer(FFT_SIZE * 4),
  );
  private acousticState: AcousticState = createAcousticState();
  private micEnabled = false;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.85;
      this.masterGain.connect(this.ctx.destination);

      // Generate reusable 2-second noise buffer for whispers, scrapes, and room tone
      const sampleRate = this.ctx.sampleRate;
      const length = sampleRate * 2;
      const buf = this.ctx.createBuffer(1, length, sampleRate);
      const data = buf.getChannelData(0);
      let lastOut = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        // Subtle brownian/pink tint for eerie organic room tone
        lastOut = (lastOut + 0.04 * white) / 1.04;
        data[i] = lastOut * 2.4;
      }
      this.noiseBuffer = buf;
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.03);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public isMicEnabled(): boolean {
    return this.micEnabled;
  }

  public getAcousticState(): AcousticState {
    return this.acousticState;
  }

  public resetAcousticState() {
    this.acousticState = createAcousticState();
  }

  public startRoomTone() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer || this.roomToneGain) return;

    // Layer 1: Quiet dark air bed (still ultra-low so user hears their own breath)
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;

    this.roomToneGain = ctx.createGain();
    this.roomToneGain.gain.value = 0.025;

    src.connect(filter);
    filter.connect(this.roomToneGain);
    this.roomToneGain.connect(this.masterGain);
    src.start();
    (this.roomToneGain as unknown as { _src?: AudioBufferSourceNode })._src = src;

    // Layer 2: Detuned sub-bass architectural resonance (minor-second beating D1/Eb1)
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 54;
    this.droneFilter.Q.value = 3.2;

    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.018;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.masterGain);

    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = 36.71;

    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 38.89; // slow 2.18Hz eerie phase beat

    oscA.connect(this.droneFilter);
    oscB.connect(this.droneFilter);
    oscA.start();
    oscB.start();

    // Layer 3: Bowed harmonic tension shimmer (swells only as dread climbs)
    const shimmerBp = ctx.createBiquadFilter();
    shimmerBp.type = 'bandpass';
    shimmerBp.frequency.value = 311.13;
    shimmerBp.Q.value = 6.0;

    this.shimmerGain = ctx.createGain();
    this.shimmerGain.gain.value = 0.0001;
    shimmerBp.connect(this.shimmerGain);
    this.shimmerGain.connect(this.masterGain);

    const shimOsc = ctx.createOscillator();
    shimOsc.type = 'sawtooth';
    shimOsc.frequency.value = 155.56;
    shimOsc.connect(shimmerBp);
    shimOsc.start();

    this.roomOscNodes = [oscA, oscB, shimOsc];
  }

  public stopRoomTone() {
    if (this.roomToneGain) {
      const holder = this.roomToneGain as unknown as { _src?: AudioBufferSourceNode };
      try {
        holder._src?.stop();
      } catch {
        // ignore if already stopped
      }
      this.roomToneGain.disconnect();
      this.roomToneGain = null;
    }
    for (const osc of this.roomOscNodes) {
      try {
        osc.stop();
      } catch {
        // ignore
      }
      osc.disconnect();
    }
    this.roomOscNodes = [];
    this.droneFilter?.disconnect();
    this.droneGain?.disconnect();
    this.shimmerGain?.disconnect();
    this.droneFilter = null;
    this.droneGain = null;
    this.shimmerGain = null;
  }

  /**
   * Continuously adapts ambient drone & harmonic dissonance to phase dread, gaze contact,
   * and seated stillness without masking real room silence.
   */
  public setTensionState(
    tensionLevel: number,
    nearestThreatAngleDeg: number,
    stillnessSeconds: number,
    hasActiveThreat: boolean,
  ) {
    if (!this.ctx || !this.droneFilter || !this.droneGain || !this.shimmerGain || this.muted) {
      return;
    }
    const now = this.ctx.currentTime;
    const staringAtThreat = hasActiveThreat && nearestThreatAngleDeg < 24;

    // When staring directly at an entity, pull harmonics abruptly into vacuum dread
    const targetDroneGain = staringAtThreat ? 0.008 : 0.018 + tensionLevel * 0.042;
    const targetCutoff = 52 + tensionLevel * 92;
    const targetShimmer = staringAtThreat
      ? 0.0002
      : Math.max(0.0002, (tensionLevel - 0.18) * 0.024);

    this.droneGain.gain.setTargetAtTime(targetDroneGain, now, 0.35);
    this.droneFilter.frequency.setTargetAtTime(targetCutoff, now, 0.4);
    this.shimmerGain.gain.setTargetAtTime(targetShimmer, now, 0.45);

    // Subtle low heartbeat pulse when player sits frozen under high tension
    const wallMs = performance.now();
    const intervalMs = Math.max(850, 1750 - tensionLevel * 850);
    if (tensionLevel > 0.36 && stillnessSeconds > 3.5 && wallMs - this.lastPulseAtMs > intervalMs) {
      this.lastPulseAtMs = wallMs;
      this.playHeartbeatThump(0.03 + tensionLevel * 0.04);
    }
  }

  private playHeartbeatThump(level: number) {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    for (const offset of [0, 0.19]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(offset === 0 ? 58 : 48, now + offset);
      osc.frequency.exponentialRampToValueAtTime(28, now + offset + 0.14);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.linearRampToValueAtTime(offset === 0 ? level : level * 0.65, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    }
  }

  /**
   * Faint electrical transformer dip paired with light/shadow brownout.
   */
  public playPowerHumFlicker() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.linearRampToValueAtTime(88, now + 0.18);
    osc.frequency.linearRampToValueAtTime(120, now + 0.36);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.022, now + 0.05);
    gain.gain.linearRampToValueAtTime(0.005, now + 0.18);
    gain.gain.linearRampToValueAtTime(0.018, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.44);
  }

  /**
   * Rising inverted breath / sub-tone that cuts to dead silence right before blackout reveal.
   */
  public playPreScareRise() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(320, now);
    bp.frequency.exponentialRampToValueAtTime(2200, now + 0.36);
    bp.Q.value = 3.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.34);
    // Hard vacuum drop right before impact
    gain.gain.setValueAtTime(0.0001, now + 0.36);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.38);
  }

  /**
   * High-impact directional scare hit (sub-bass slam + metallic dissonance burst).
   */
  public playScareImpact(
    kind: 'face_stinger' | 'snap_stinger' | 'intercept_hit' | 'blackout_reveal',
    intensity = 0.9,
    azimuthDeg = 0,
    delaySec = 0,
  ) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;

    const t0 = ctx.currentTime + delaySec;
    const rad = (azimuthDeg * Math.PI) / 180;
    const pan = Math.max(-1, Math.min(1, Math.sin(rad)));

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, t0);
    panner.connect(this.masterGain);

    // 1. Sub-bass impact drop
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(104, t0);
    subOsc.frequency.exponentialRampToValueAtTime(27, t0 + 0.36);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, t0);
    subGain.gain.linearRampToValueAtTime(0.42 * intensity, t0 + 0.015);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
    subOsc.connect(subGain);
    subGain.connect(panner);
    subOsc.start(t0);
    subOsc.stop(t0 + 0.44);

    // 2. Sharp dissonant metallic screech chord (very brief transient)
    const freqs =
      kind === 'face_stinger' ? [415, 587, 1175] : [311, 466, 880];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 0.72, t0 + 0.32);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f * 1.4, t0);
      bp.Q.value = 2.6;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.11 * intensity, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);

      osc.connect(bp);
      bp.connect(gain);
      gain.connect(panner);
      osc.start(t0);
      osc.stop(t0 + 0.36);
    }

    // 3. Sharp breath/static crack transient
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, t0);
    nGain.gain.linearRampToValueAtTime(0.18 * intensity, t0 + 0.008);
    nGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    noiseSrc.connect(hp);
    hp.connect(nGain);
    nGain.connect(panner);
    noiseSrc.start(t0);
    noiseSrc.stop(t0 + 0.18);
  }

  /**
   * Plays a subtle, localized non-jumpscare audio cue at azimuthDeg (-180..180 relative to facing)
   * designed to coax the player into turning their head toward or past an entity.
   */
  public playSpatialCue(azimuthDeg: number, kind: SpatialAudioCueKind) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;

    const now = ctx.currentTime;
    const rad = (azimuthDeg * Math.PI) / 180;
    const pan = Math.max(-1, Math.min(1, Math.sin(rad)));
    // Slight attenuation when directly behind
    const rearFactor = Math.cos(rad) < 0 ? 0.72 : 1.0;

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.masterGain);

    if (kind === 'scrape') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(620, now);
      bp.frequency.exponentialRampToValueAtTime(1180, now + 0.9);
      bp.Q.value = 5.5;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.09 * rearFactor, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);

      src.connect(bp);
      bp.connect(gain);
      gain.connect(panner);
      src.start(now);
      src.stop(now + 1.2);
    } else if (kind === 'breath' || kind === 'inhale') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(kind === 'inhale' ? 1450 : 520, now);
      bp.Q.value = 2.8;

      const gain = ctx.createGain();
      const dur = kind === 'inhale' ? 0.65 : 1.5;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime((kind === 'inhale' ? 0.12 : 0.07) * rearFactor, now + dur * 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      src.connect(bp);
      bp.connect(gain);
      gain.connect(panner);
      src.start(now);
      src.stop(now + dur + 0.05);
    } else if (kind === 'knocks') {
      // Two hesitant dry knuckle taps on wall/doorframe
      for (const offset of [0, 0.34, 0.62]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(112, now + offset);
        osc.frequency.exponentialRampToValueAtTime(46, now + offset + 0.07);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.linearRampToValueAtTime(0.08 * rearFactor, now + offset + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.09);

        osc.connect(gain);
        gain.connect(panner);
        osc.start(now + offset);
        osc.stop(now + offset + 0.1);
      }
    } else if (kind === 'whisper') {
      // Unintelligible double-syllable whispered breath behind shoulder
      for (const [offset, freq] of [
        [0, 1080],
        [0.24, 1780],
      ] as const) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(freq, now + offset);
        bp.Q.value = 4.2;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.linearRampToValueAtTime(0.085 * rearFactor, now + offset + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.24);

        src.connect(bp);
        bp.connect(gain);
        gain.connect(panner);
        src.start(now + offset);
        src.stop(now + offset + 0.28);
      }
    } else if (kind === 'footstep') {
      // Single deliberate muffled floor shift off-axis
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(76, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 0.14);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.068 * rearFactor, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      osc.connect(gain);
      gain.connect(panner);
      osc.start(now);
      osc.stop(now + 0.18);
    } else {
      // Dry wood/floor creak
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(135, now);
      osc.frequency.exponentialRampToValueAtTime(78, now + 0.28);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.065 * rearFactor, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

      osc.connect(gain);
      gain.connect(panner);
      osc.start(now);
      osc.stop(now + 0.32);
    }
  }

  public async enableMicrophone(): Promise<{ ok: boolean; reason?: string }> {
    if (!window.isSecureContext) {
      this.micEnabled = false;
      return {
        ok: false,
        reason: 'Microphone requires HTTPS (secure context). Use Test Shriek [V] over plain HTTP.',
      };
    }
    try {
      const ctx = this.ensureContext();
      if (!ctx || !navigator.mediaDevices?.getUserMedia) {
        return { ok: false, reason: 'Microphone API unavailable in this browser.' };
      }
      if (this.micStream) {
        this.micEnabled = true;
        return { ok: true };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.micStream = stream;
      this.micSource = ctx.createMediaStreamSource(stream);
      this.micAnalyser = ctx.createAnalyser();
      this.micAnalyser.fftSize = FFT_SIZE;
      this.micSource.connect(this.micAnalyser);
      this.micEnabled = true;
      return { ok: true };
    } catch (err) {
      this.micEnabled = false;
      const name = (err as Error)?.name || '';
      const reason =
        name === 'NotAllowedError'
          ? 'Microphone permission denied.'
          : name === 'NotFoundError'
            ? 'No microphone detected.'
            : 'Microphone blocked (requires HTTPS or user permission).';
      return { ok: false, reason };
    }
  }

  public disableMicrophone() {
    this.micEnabled = false;
    this.micSource?.disconnect();
    this.micSource = null;
    this.micAnalyser = null;
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
  }

  public sampleMicrophone(sensitivityThresholdDb: number, isCalibrating: boolean): AcousticState {
    if (!this.micEnabled || !this.micAnalyser || !this.ctx) {
      return this.acousticState;
    }
    this.micAnalyser.getFloatTimeDomainData(this.micTimeBuffer);
    this.acousticState = analyzeAudioFrame(
      this.micTimeBuffer,
      this.ctx.sampleRate,
      this.acousticState,
      sensitivityThresholdDb,
      isCalibrating,
    );
    return this.acousticState;
  }

  /**
   * Deterministic test utility so users without a mic (or automated checks) can verify
   * the FFT shriek detector pipeline with a real synthetic 2.4kHz vocal spike.
   */
  public injectSyntheticVocalSpike(sensitivityThresholdDb: number): AcousticState {
    const buf = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      buf[i] = Math.sin((2 * Math.PI * 2400 * i) / 16000) * 0.55;
    }
    // Feed 3 consecutive frames to satisfy the sustained vocal duration gate
    for (let f = 0; f < 3; f++) {
      this.acousticState = analyzeAudioFrame(
        buf,
        16000,
        this.acousticState,
        sensitivityThresholdDb,
        false,
      );
    }
    return this.acousticState;
  }

  public dispose() {
    this.stopRoomTone();
    this.disableMicrophone();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
