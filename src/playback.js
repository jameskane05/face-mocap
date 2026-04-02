function frameTime(f) {
  return Array.isArray(f) ? f[0] : f.t;
}

function frameValues(f, nl) {
  return Array.isArray(f) ? f.slice(1, 1 + nl) : f.values;
}

function frameMatrixArray(f, nl) {
  if (Array.isArray(f)) {
    const m = f.slice(1 + nl, 1 + nl + 16);
    return m.length === 16 ? m : null;
  }
  const m = f.faceMatrix;
  return Array.isArray(m) ? m : null;
}

export function createPlaybackState(recording) {
  const fps = recording.fps || 30;
  const frameDuration = 1 / fps;
  const frames = recording.frames;
  const animationDuration =
    frames.length > 0
      ? frameTime(frames[frames.length - 1]) + frameDuration
      : 0;
  return {
    recording,
    currentTime: 0,
    duration: animationDuration,
    animationDuration,
    audioDuration: 0,
    playing: false,
    frameDuration,
    names: recording.names,
  };
}

export function setPlaybackAudioDuration(state, audioDuration) {
  if (!state) return;
  state.audioDuration = Math.max(0, Number(audioDuration) || 0);
  state.duration = state.animationDuration || 0;
  state.currentTime = Math.max(0, Math.min(state.currentTime, state.duration));
}

export function sampleAt(state) {
  const { recording, currentTime } = state;
  const frames = recording.frames;
  const nl = recording.names.length;
  if (frames.length === 0)
    return {
      names: recording.names,
      values: recording.names.map(() => 0),
      faceMatrix: null,
    };
  if (frames.length === 1) {
    const f0 = frames[0];
    const m = frameMatrixArray(f0, nl);
    return {
      names: recording.names,
      values: frameValues(f0, nl),
      faceMatrix: m ? { data: m } : null,
    };
  }

  let i = 0;
  while (i < frames.length - 1 && frameTime(frames[i + 1]) <= currentTime) i++;
  if (i >= frames.length - 1) {
    const frame = frames[frames.length - 1];
    const m = frameMatrixArray(frame, nl);
    return {
      names: recording.names,
      values: frameValues(frame, nl),
      faceMatrix: m ? { data: m } : null,
    };
  }
  const a = frames[i];
  const b = frames[i + 1];
  const ta = frameTime(a);
  const tb = frameTime(b);
  const span = tb - ta;
  const t = span > 0 ? (currentTime - ta) / span : 0;
  const va = frameValues(a, nl);
  const vb = frameValues(b, nl);
  const values = va.map((v, j) => v + t * (vb[j] - v));
  let faceMatrix = null;
  const ma = frameMatrixArray(a, nl);
  const mb = frameMatrixArray(b, nl);
  if (ma && mb && ma.length === mb.length) {
    faceMatrix = {
      data: ma.map((v, j) => v + t * (mb[j] - v)),
    };
  } else if (ma) {
    faceMatrix = { data: ma };
  } else if (mb) {
    faceMatrix = { data: mb };
  }
  return { names: recording.names, values, faceMatrix };
}

export function tick(state, delta) {
  if (!state.playing) return;
  state.currentTime = Math.min(state.duration, state.currentTime + delta);
  if (state.currentTime >= state.duration) state.playing = false;
}

export function setPlaybackTime(state, t) {
  state.currentTime = Math.max(0, Math.min(state.duration, t));
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
