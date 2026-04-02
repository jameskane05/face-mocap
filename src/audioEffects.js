export const DEFAULT_EFFECTS = {
  reverb: { on: false, wet: 0.35 },
  distortion: { on: false, amount: 0.4 },
  static: { on: false, amount: 0.12 },
};

export function normalizeEffects(clipEffects) {
  return {
    reverb: { ...DEFAULT_EFFECTS.reverb, ...clipEffects?.reverb },
    distortion: { ...DEFAULT_EFFECTS.distortion, ...clipEffects?.distortion },
    static: { ...DEFAULT_EFFECTS.static, ...clipEffects?.static },
  };
}

function createReverbIR(ctx, durationSec = 1.8, decay = 2) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(durationSec * sampleRate);
  const ir = ctx.createBuffer(2, length, sampleRate);
  const left = ir.getChannelData(0);
  const right = ir.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const decayEnv = Math.exp(-t * decay);
    left[i] = (Math.random() * 2 - 1) * decayEnv;
    right[i] = (Math.random() * 2 - 1) * decayEnv;
  }
  return ir;
}

export function makeDistortionCurve(amount) {
  const k = typeof amount === "number" ? amount * 80 + 1 : 1;
  const samples = 44100;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * (20 * x * x + 5)) / (1 + k * Math.abs(x) * (20 * x * x + 5));
  }
  return curve;
}

function createNoiseBuffer(ctx, durationSec = 30) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(durationSec * sampleRate);
  const buf = ctx.createBuffer(1, length, sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < length; i++) ch[i] = Math.random() * 2 - 1;
  return buf;
}

export function buildEffectGraph(ctx, mediaSource, config) {
  const cfg = normalizeEffects(config);
  const dest = ctx.destination;

  const dryGain = ctx.createGain();
  const reverbWetGain = ctx.createGain();
  const distGain = ctx.createGain();
  const staticGain = ctx.createGain();

  mediaSource.connect(dryGain);
  dryGain.connect(dest);

  const conv = ctx.createConvolver();
  conv.buffer = createReverbIR(ctx, 1.8, 2);
  mediaSource.connect(conv);
  conv.connect(reverbWetGain);
  reverbWetGain.connect(dest);

  const curve = makeDistortionCurve(cfg.distortion.amount);
  const shaper = ctx.createWaveShaper();
  shaper.curve = curve;
  shaper.oversample = "4x";
  mediaSource.connect(shaper);
  shaper.connect(distGain);
  distGain.connect(dest);

  const noiseBuf = createNoiseBuffer(ctx, 30);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  noise.connect(staticGain);
  staticGain.connect(dest);

  const nodes = {
    ctx,
    mediaSource,
    dryGain,
    reverbConvolver: conv,
    reverbWetGain,
    waveshaper: shaper,
    distGain,
    staticGain,
    noiseSource: noise,
  };
  try {
    noise.start(0);
  } catch (_) {}
  applyEffectParams(nodes, cfg);
  return nodes;
}

export function applyEffectParams(nodes, config) {
  if (!nodes || !config) return;
  const cfg = normalizeEffects(config);

  const reverbOn = !!cfg.reverb.on;
  const reverbWet = Math.max(0, Math.min(1, Number(cfg.reverb.wet) || 0));
  nodes.dryGain.gain.setTargetAtTime(reverbOn ? 1 - reverbWet : 1, nodes.ctx.currentTime, 0.01);
  nodes.reverbWetGain.gain.setTargetAtTime(reverbOn ? reverbWet : 0, nodes.ctx.currentTime, 0.01);

  const distOn = !!cfg.distortion.on;
  const distAmount = Math.max(0, Math.min(1, Number(cfg.distortion.amount) || 0));
  nodes.distGain.gain.setTargetAtTime(distOn ? distAmount : 0, nodes.ctx.currentTime, 0.01);
  if (distOn) {
    nodes.waveshaper.curve = makeDistortionCurve(distAmount);
  }

  const staticOn = !!cfg.static.on;
  const staticAmount = Math.max(0, Math.min(1, Number(cfg.static.amount) || 0));
  nodes.staticGain.gain.setTargetAtTime(staticOn ? staticAmount * 0.3 : 0, nodes.ctx.currentTime, 0.01);
}

export function disconnectEffectGraph(playbackState) {
  const nodes = playbackState?.effectNodes;
  if (!nodes) return;
  try {
    nodes.noiseSource?.stop();
  } catch (_) {}
  nodes.mediaSource?.disconnect();
  nodes.dryGain?.disconnect();
  nodes.reverbWetGain?.disconnect();
  nodes.distGain?.disconnect();
  nodes.staticGain?.disconnect();
  playbackState.effectNodes = null;
}
