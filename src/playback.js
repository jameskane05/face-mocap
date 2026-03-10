export function createPlaybackState(recording) {
  const fps = recording.fps || 30;
  const frameDuration = 1 / fps;
  const animationDuration =
    recording.frames.length > 0
      ? recording.frames[recording.frames.length - 1].t + frameDuration
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
  if (frames.length === 0)
    return {
      names: recording.names,
      values: recording.names.map(() => 0),
      faceMatrix: null,
    };
  if (frames.length === 1) {
    return {
      names: recording.names,
      values: frames[0].values,
      faceMatrix: frames[0].faceMatrix ? { data: frames[0].faceMatrix } : null,
    };
  }

  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].t <= currentTime) i++;
  if (i >= frames.length - 1) {
    const frame = frames[frames.length - 1];
    return {
      names: recording.names,
      values: frame.values,
      faceMatrix: frame.faceMatrix ? { data: frame.faceMatrix } : null,
    };
  }
  const a = frames[i];
  const b = frames[i + 1];
  const span = b.t - a.t;
  const t = span > 0 ? (currentTime - a.t) / span : 0;
  const values = a.values.map((v, j) => v + t * (b.values[j] - v));
  let faceMatrix = null;
  if (
    Array.isArray(a.faceMatrix) &&
    Array.isArray(b.faceMatrix) &&
    a.faceMatrix.length === b.faceMatrix.length
  ) {
    faceMatrix = {
      data: a.faceMatrix.map((v, j) => v + t * (b.faceMatrix[j] - v)),
    };
  } else if (Array.isArray(a.faceMatrix)) {
    faceMatrix = { data: a.faceMatrix };
  } else if (Array.isArray(b.faceMatrix)) {
    faceMatrix = { data: b.faceMatrix };
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
