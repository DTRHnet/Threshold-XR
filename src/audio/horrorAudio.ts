import { FFT_SIZE, analyzeAudioFrame, createAcousticState } from '../engine/acoustics';
import type { AcousticState } from '../engine/types';

export class HorrorAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private roomToneGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

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

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;

    this.roomToneGain = ctx.createGain();
    this.roomToneGain.gain.value = 0.028; // Near-silent baseline so player hears their own breathing

    src.connect(filter);
    filter.connect(this.roomToneGain);
    this.roomToneGain.connect(this.masterGain);
    src.start();
    (this.roomToneGain as unknown as { _src?: AudioBufferSourceNode })._src = src;
  }

  public stopRoomTone() {
    if (!this.roomToneGain) return;
    const holder = this.roomToneGain as unknown as { _src?: AudioBufferSourceNode };
    try {
      holder._src?.stop();
    } catch {
      // ignore if already stopped
    }
    this.roomToneGain.disconnect();
    this.roomToneGain = null;
  }

  /**
   * Plays a subtle, localized non-jumpscare audio cue at azimuthDeg (-180..180 relative to facing)
   * designed to coax the player into turning their head toward or past an entity.
   */
  public playSpatialCue(azimuthDeg: number, kind: 'scrape' | 'breath' | 'creak' | 'inhale') {
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
