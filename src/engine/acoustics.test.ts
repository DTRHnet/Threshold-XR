import test from 'node:test';
import assert from 'node:assert/strict';
import { FFT_SIZE, analyzeAudioFrame, createAcousticState } from './acoustics';

function makeSineFrame(freqHz: number, amplitude: number, sampleRate = 16000): Float32Array {
  const buf = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    buf[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * amplitude;
  }
  return buf;
}

test('quiet baseline room noise calibrates cleanly without triggering breach', () => {
  let state = createAcousticState();
  const quiet = makeSineFrame(120, 0.005);

  for (let i = 0; i < 20; i++) {
    state = analyzeAudioFrame(quiet, 16000, state, 20, true);
  }
  assert.equal(state.calibrated, true);
  assert.equal(state.breachTriggered, false);
});

test('low-frequency thud (140Hz) does not trigger shriek breach due to low vocal-band ratio', () => {
  let state = createAcousticState();
  const quiet = makeSineFrame(120, 0.005);
  for (let i = 0; i < 16; i++) {
    state = analyzeAudioFrame(quiet, 16000, state, 20, true);
  }

  const thud = makeSineFrame(140, 0.45);
  for (let i = 0; i < 5; i++) {
    state = analyzeAudioFrame(thud, 16000, state, 20, false);
  }
  assert.equal(state.breachTriggered, false);
  assert.ok(state.lastHighFreqRatio < 0.25);
});

test('sustained high-energy vocal shriek (2.4kHz) triggers breach after 3 consecutive frames', () => {
  let state = createAcousticState();
  const quiet = makeSineFrame(120, 0.005);
  for (let i = 0; i < 16; i++) {
    state = analyzeAudioFrame(quiet, 16000, state, 20, true);
  }

  const shriek = makeSineFrame(2400, 0.45);
  state = analyzeAudioFrame(shriek, 16000, state, 20, false);
  assert.equal(state.breachTriggered, false);
  state = analyzeAudioFrame(shriek, 16000, state, 20, false);
  assert.equal(state.breachTriggered, false);
  state = analyzeAudioFrame(shriek, 16000, state, 20, false);
  assert.equal(state.breachTriggered, true);
});
