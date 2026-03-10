import lamejs from 'lamejs';

const RECORD_VERSION = 3;
const MP3_CHUNK = 1152;

async function webmBlobToMp3Blob(blob) {
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const channels = buf.numberOfChannels;
  const sampleRate = buf.sampleRate;
  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
  const mp3Chunks = [];
  const left = buf.getChannelData(0);
  const right = channels > 1 ? buf.getChannelData(1) : left;
  for (let i = 0; i < left.length; i += MP3_CHUNK) {
    const sliceL = left.subarray(i, i + MP3_CHUNK);
    const sliceR = right.subarray(i, i + MP3_CHUNK);
    const i16L = new Int16Array(sliceL.length);
    const i16R = new Int16Array(sliceR.length);
    for (let j = 0; j < sliceL.length; j++) {
      i16L[j] = Math.max(-32768, Math.min(32767, sliceL[j] * 32767));
      i16R[j] = Math.max(-32768, Math.min(32767, sliceR[j] * 32767));
    }
    const block = encoder.encodeBuffer(i16L, i16R);
    if (block.length) mp3Chunks.push(block);
  }
  const last = encoder.flush();
  if (last.length) mp3Chunks.push(last);
  const totalLen = mp3Chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const c of mp3Chunks) {
    out.set(c, off);
    off += c.length;
  }
  return new Blob([out], { type: 'audio/mp3' });
}

export function createRecording(names) {
  return {
    version: RECORD_VERSION,
    fps: 30,
    names: [...names],
    frames: [],
  };
}

export function addFrame(recording, t, values, faceMatrix = null) {
  recording.frames.push({
    t,
    values: [...values],
    faceMatrix: faceMatrix?.data ? [...faceMatrix.data] : (Array.isArray(faceMatrix) ? [...faceMatrix] : null),
  });
}

export function exportRecording(recording) {
  return JSON.stringify(recording, null, 0);
}

export function downloadRecording(recording, filename = 'face-mocap.json') {
  const blob = new Blob([exportRecording(recording)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadAudioBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function downloadRecordingWithAudio(recording, audioBlob, baseName = 'face-mocap') {
  const jsonName = baseName.endsWith('.json') ? baseName : `${baseName}.json`;
  const base = baseName.replace(/\.json$/i, '');
  downloadRecording(recording, jsonName);
  if (audioBlob && audioBlob.size > 0) {
    const mp3Blob = await webmBlobToMp3Blob(audioBlob);
    downloadAudioBlob(mp3Blob, `${base}.audio.mp3`);
  }
}

export function parseRecording(jsonText) {
  const data = JSON.parse(jsonText);
  if (data.version < 1 || data.version > RECORD_VERSION || !Array.isArray(data.names) || !Array.isArray(data.frames)) {
    throw new Error('Invalid recording format');
  }
  return data;
}
