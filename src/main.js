import "./style.css";
import {
  initFaceCapture,
  getCoefficients,
  getCoefficientNames,
} from "./faceCapture.js";
import {
  initScene,
  loadVRMFromUrl,
  loadVRMFromFile,
  getVRM,
  applyCoefficientsMapped,
  applyHeadFromFace,
  applyVrmPose,
  setVrmScale,
  setVrmPositionY,
  getVrmScale,
  getVrmPositionY,
  buildCoeffToVrmMapping,
  resetExpressionSmoothing,
  panCameraByDrag,
  zoomCameraByWheel,
  updateScene,
  getClockDelta,
} from "./scene.js";
import {
  createRecording,
  addFrame,
  parseRecording,
  downloadRecordingWithAudio,
} from "./recording.js";
import {
  createPlaybackState,
  sampleAt,
  tick,
  setPlaybackTime,
  setPlaybackAudioDuration,
  formatTime,
} from "./playback.js";
import * as elevenlabs from "./elevenlabs.js";

const canvas = document.getElementById("canvas");
const video = document.getElementById("video");
const startCamBtn = document.getElementById("start-cam");
const camStatus = document.getElementById("cam-status");
const skipBackBtn = document.getElementById("skip-back");
const skipFwdBtn = document.getElementById("skip-fwd");
const stopBtn = document.getElementById("stop-btn");
const recordStatus = document.getElementById("record-status");
const recordEnableBtn = document.getElementById("record-enable-btn");
const loadRecordingInput = document.getElementById("load-recording");
const loadAudioInput = document.getElementById("load-audio");
const playBtn = document.getElementById("play-btn");
const seekSlider = document.getElementById("seek");
const playbackTimeEl = document.getElementById("playback-time");
const playbackToolbar = document.getElementById("playback-toolbar");
const loadVrmInput = document.getElementById("load-vrm");
const sampleVrmSelect = document.getElementById("sample-vrm");
const vrmPoseSelect = document.getElementById("vrm-pose");
const cameraPreview = document.getElementById("camera-preview");
const cameraOverlay = document.getElementById("camera-overlay");
const trackingStatus = document.getElementById("tracking-status");
const audioSidebarToggleBtn = document.getElementById("audio-sidebar-toggle");
const audioSidebar = document.getElementById("audio-sidebar");
const audioSidebarCloseBtn = document.getElementById("audio-sidebar-close");
const audioLibraryEl = document.getElementById("audio-library");
const audioLibraryEmptyEl = document.getElementById("audio-library-empty");
const fileMenuBtn = document.getElementById("file-menu-btn");
const fileMenu = document.getElementById("file-menu");
const importRecordingBtn = document.getElementById("import-recording-btn");
const importAudioBtn = document.getElementById("import-audio-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const exportRecordingBtn = document.getElementById("export-recording-btn");
const elevenlabsApiKeyInput = document.getElementById("elevenlabs-api-key");
const fetchVoicesBtn = document.getElementById("fetch-voices-btn");
const elevenlabsVoiceSelect = document.getElementById("elevenlabs-voice");
const fetchVoicesStatus = document.getElementById("fetch-voices-status");
const applyElevenlabsBtn = document.getElementById("apply-elevenlabs-btn");
const elevenlabsStatus = document.getElementById("elevenlabs-status");

const ELEVENLABS_KEY_STORAGE = "elevenlabs-api-key";

let stream = null;
let faceCaptureReady = false;
let recording = null;
let recordingStartTime = 0;
let mediaRecorder = null;
let audioChunks = [];
let playbackState = null;
let coeffToVrmMapping = {};
let recordArmed = false;
let audioLibrary = [];
let nextAudioClipId = 1;
let activeAudioClipId = null;
const SAMPLE_VRMS = [
  {
    label: "Altair",
    url: "/model_original_1773065783.vrm",
    rotationY: Math.PI,
    positionY: -0.4,
    headPitchSign: -1,
  },
  {
    label: "Ground Control",
    url: "/model_original_1773089969.vrm",
    rotationY: Math.PI,
    headPitchSign: -1,
    positionY: -0.4,
  },
];

const DEFAULT_AVATAR = SAMPLE_VRMS[0];

function setAudioSidebarOpen(open) {
  if (!audioSidebar) return;
  audioSidebar.classList.toggle("hidden", !open);
}

function updateAudioSidebarButton() {
  if (!audioSidebarToggleBtn) return;
  audioSidebarToggleBtn.classList.remove("hidden");
}

function pauseSidebarPreviewAudio(exceptId = null) {
  if (!audioLibraryEl) return;
  for (const audio of audioLibraryEl.querySelectorAll("audio")) {
    const clipId = Number(audio.dataset.clipId);
    if (clipId !== exceptId) audio.pause();
  }
}

function updateApplyElevenlabsButton() {
  const hasActiveClip = !!audioLibrary.find(
    (clip) => clip.id === activeAudioClipId,
  );
  const ok = hasActiveClip && elevenlabsVoiceSelect?.value;
  if (applyElevenlabsBtn) applyElevenlabsBtn.disabled = !ok;
}

function renderAudioLibrary() {
  if (!audioLibraryEl) return;
  audioLibraryEl.innerHTML = "";
  if (audioLibraryEmptyEl)
    audioLibraryEmptyEl.classList.toggle("hidden", audioLibrary.length > 0);
  for (const clip of audioLibrary) {
    const item = document.createElement("div");
    item.className = `audio-clip${clip.id === activeAudioClipId ? " active" : ""}`;

    const header = document.createElement("div");
    header.className = "audio-clip-header";

    const titleWrap = document.createElement("div");

    const title = document.createElement("div");
    title.className = "audio-clip-title";
    title.textContent = clip.label;
    titleWrap.appendChild(title);

    const kind = document.createElement("div");
    kind.className = "audio-clip-kind";
    kind.textContent = clip.kind;
    titleWrap.appendChild(kind);

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "audio-clip-select";
    selectBtn.textContent =
      clip.id === activeAudioClipId ? "Applied" : "Use in playback";
    if (clip.id === activeAudioClipId) selectBtn.disabled = true;
    selectBtn.addEventListener("click", () =>
      applyAudioClipToPlayback(clip.id),
    );

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "audio-clip-remove";
    removeBtn.title = "Remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      if (clip.previewUrl) URL.revokeObjectURL(clip.previewUrl);
      const idx = audioLibrary.findIndex((c) => c.id === clip.id);
      if (idx !== -1) audioLibrary.splice(idx, 1);
      if (activeAudioClipId === clip.id) {
        clearPlaybackAudio();
        activeAudioClipId = null;
        updatePlaybackUI();
        updateTransportButtons();
      }
      renderAudioLibrary();
    });

    header.append(titleWrap, selectBtn, removeBtn);

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = clip.previewUrl;
    audio.dataset.clipId = String(clip.id);
    audio.addEventListener("play", () => pauseSidebarPreviewAudio(clip.id));

    item.append(header, audio);
    audioLibraryEl.appendChild(item);
  }
  updateAudioSidebarButton();
  updateApplyElevenlabsButton();
}

function resetAudioLibrary() {
  pauseSidebarPreviewAudio();
  for (const clip of audioLibrary) {
    URL.revokeObjectURL(clip.previewUrl);
  }
  audioLibrary = [];
  activeAudioClipId = null;
  setAudioSidebarOpen(false);
  renderAudioLibrary();
}

function addAudioClip(blob, { label, kind }) {
  if (!blob || blob.size <= 0) return null;
  const clip = {
    id: nextAudioClipId++,
    blob,
    label,
    kind,
    previewUrl: URL.createObjectURL(blob),
  };
  audioLibrary.push(clip);
  renderAudioLibrary();
  return clip;
}

function attachPlaybackAudio(blob) {
  if (!playbackState || !blob || blob.size <= 0) return;
  playbackState.audioBlob = blob;
  playbackState.audioUrl = URL.createObjectURL(blob);
  playbackState.audioEl = new Audio(playbackState.audioUrl);
  playbackState.audioEl.addEventListener("loadedmetadata", () => {
    setPlaybackAudioDuration(playbackState, playbackState.audioEl.duration);
    updatePlaybackUI();
  });
  playbackState.audioEl.addEventListener("ended", () => {
    if (!playbackState) return;
    playbackState.playing = false;
    updatePlaybackUI();
    updateTransportButtons();
  });
}

function clearPlaybackAudio() {
  if (playbackState?.audioEl) playbackState.audioEl.pause();
  if (playbackState?.audioUrl) URL.revokeObjectURL(playbackState.audioUrl);
  if (playbackState) playbackState.audioUrl = null;
  if (playbackState) playbackState.audioEl = null;
  if (playbackState) playbackState.audioBlob = null;
  if (playbackState) setPlaybackAudioDuration(playbackState, 0);
}

function applyAudioClipToPlayback(clipId, { autoplay } = {}) {
  const clip = audioLibrary.find((entry) => entry.id === clipId);
  if (!clip || !playbackState) return;
  const shouldPlay = autoplay ?? playbackState.playing;
  const currentTime = playbackState.currentTime || 0;
  clearPlaybackAudio();
  attachPlaybackAudio(clip.blob);
  activeAudioClipId = clip.id;
  renderAudioLibrary();
  if (playbackState.audioEl) {
    const syncAudio = () => {
      if (!playbackState?.audioEl) return;
      playbackState.audioEl.currentTime = currentTime;
      if (shouldPlay) playbackState.audioEl.play();
    };
    if (playbackState.audioEl.readyState >= 1) syncAudio();
    else
      playbackState.audioEl.addEventListener("loadedmetadata", syncAudio, {
        once: true,
      });
  }
  if (playbackState) playbackState.playing = shouldPlay;
  updatePlaybackUI();
  updateTransportButtons();
}

function setOriginalAudioClip(
  blob,
  { label = "Original audio", autoplay = false } = {},
) {
  resetAudioLibrary();
  const clip = addAudioClip(blob, { label, kind: "original" });
  if (!clip) return;
  activeAudioClipId = clip.id;
  applyAudioClipToPlayback(clip.id, { autoplay });
}

const cameraPreviewBody = document.getElementById("camera-preview-body");

function resizeCameraOverlay() {
  if (!cameraOverlay) return;
  const el = cameraPreviewBody || cameraPreview;
  if (!el) return;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (
    w > 0 &&
    h > 0 &&
    (cameraOverlay.width !== w || cameraOverlay.height !== h)
  ) {
    cameraOverlay.width = w;
    cameraOverlay.height = h;
  }
}

function drawLandmarks(ctx, landmarks) {
  if (!ctx || !landmarks?.length) return;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0, 255, 128, 0.7)";
  ctx.strokeStyle = "rgba(0, 200, 100, 0.9)";
  for (const p of landmarks) {
    const x = p.x * w;
    const y = p.y * h;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function updateTransportButtons() {
  const canRecord = !!(stream && faceCaptureReady);
  const canPlayback = !!playbackState;
  if (playBtn) {
    playBtn.disabled = !canPlayback && !(recordArmed && canRecord);
    playBtn.classList.toggle(
      "playing",
      !!recording || !!playbackState?.playing,
    );
  }
  if (stopBtn) stopBtn.disabled = !recording && !playbackState;
  if (recordEnableBtn) recordEnableBtn.classList.toggle("armed", recordArmed);
  if (exportRecordingBtn) {
    const canExport = !!playbackState?.recording;
    exportRecordingBtn.classList.toggle("hidden", !canExport);
    exportRecordingBtn.disabled = !canExport;
  }
}

function setFileMenuOpen(open) {
  if (!fileMenu || !fileMenuBtn) return;
  fileMenu.classList.toggle("hidden", !open);
  fileMenuBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function isFileMenuOpen() {
  return !!fileMenu && !fileMenu.classList.contains("hidden");
}

if (settingsBtn && settingsPanel) {
  settingsBtn.addEventListener("click", () =>
    settingsPanel.classList.toggle("hidden"),
  );
}
if (fileMenuBtn && fileMenu) {
  fileMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setFileMenuOpen(!isFileMenuOpen());
  });
  fileMenu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => setFileMenuOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setFileMenuOpen(false);
  });
}
if (audioSidebarToggleBtn && audioSidebar) {
  audioSidebarToggleBtn.addEventListener("click", () =>
    setAudioSidebarOpen(true),
  );
  audioSidebar.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", (e) => {
    const onToggle = audioSidebarToggleBtn.contains(e.target);
    const onToolbar = playbackToolbar?.contains(e.target);
    if (!audioSidebar.contains(e.target) && !onToggle && !onToolbar) {
      setAudioSidebarOpen(false);
    }
  });
}
if (audioSidebarCloseBtn) {
  audioSidebarCloseBtn.addEventListener("click", () =>
    setAudioSidebarOpen(false),
  );
}
updateAudioSidebarButton();
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setAudioSidebarOpen(false);
});
if (importRecordingBtn && loadRecordingInput) {
  importRecordingBtn.addEventListener("click", () => {
    setFileMenuOpen(false);
    loadRecordingInput.click();
  });
}
if (importAudioBtn && loadAudioInput) {
  importAudioBtn.addEventListener("click", () => {
    setFileMenuOpen(false);
    loadAudioInput.click();
  });
}
try {
  const stored = localStorage.getItem(ELEVENLABS_KEY_STORAGE);
  if (stored && elevenlabsApiKeyInput) elevenlabsApiKeyInput.value = stored;
} catch (_) {}
if (elevenlabsApiKeyInput) {
  elevenlabsApiKeyInput.addEventListener("change", () => {
    try {
      if (elevenlabsApiKeyInput.value.trim())
        localStorage.setItem(
          ELEVENLABS_KEY_STORAGE,
          elevenlabsApiKeyInput.value,
        );
      else localStorage.removeItem(ELEVENLABS_KEY_STORAGE);
    } catch (_) {}
  });
}

initScene(canvas);

if (canvas) {
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomCameraByWheel(e.deltaY);
    },
    { passive: false },
  );

  let middlePanning = false;
  let lastPanX = 0;
  let lastPanY = 0;

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    middlePanning = true;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
  });

  window.addEventListener("mousemove", (e) => {
    if (!middlePanning) return;
    const dx = e.clientX - lastPanX;
    const dy = e.clientY - lastPanY;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    panCameraByDrag(dx, dy);
  });

  window.addEventListener("mouseup", (e) => {
    if (e.button === 1) middlePanning = false;
  });
}

sampleVrmSelect.innerHTML =
  '<option value="">-- Sample VRM (load from URL) --</option>' +
  SAMPLE_VRMS.map((s, i) => `<option value="${i}">${s.label}</option>`).join(
    "",
  );

loadVRMFromUrl(DEFAULT_AVATAR.url, {
  rotationY: DEFAULT_AVATAR.rotationY,
  positionY: DEFAULT_AVATAR.positionY,
  headPitchSign: DEFAULT_AVATAR.headPitchSign,
})
  .then(() => {
    if (DEFAULT_AVATAR.positionY !== undefined)
      setVrmPositionY(DEFAULT_AVATAR.positionY);
    coeffToVrmMapping = buildCoeffToVrmMapping(getCoefficientNames());
    syncModelOptionsFromScene();
    if (sampleVrmSelect) sampleVrmSelect.value = "0";
  })
  .catch((e) => console.error("Default avatar load failed:", e));

function syncModelOptionsFromScene() {
  const vrm = getVRM();
  if (!vrm) return;
  if (vrmPoseSelect) vrmPoseSelect.value = "arms-at-sides";
}

loadVrmInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  loadVRMFromFile(file)
    .then((vrm) => {
      coeffToVrmMapping = buildCoeffToVrmMapping(getCoefficientNames());
      syncModelOptionsFromScene();
    })
    .catch((e) => console.error(e));
  e.target.value = "";
});

sampleVrmSelect.addEventListener("change", () => {
  const i = sampleVrmSelect.value;
  if (i === "") return;
  const sample = SAMPLE_VRMS[Number(i)];
  if (!sample) return;
  loadVRMFromUrl(sample.url, {
    rotationY: sample.rotationY,
    positionY: sample.positionY,
    headPitchSign: sample.headPitchSign,
  })
    .then(() => {
      if (sample.positionY !== undefined) setVrmPositionY(sample.positionY);
      coeffToVrmMapping = buildCoeffToVrmMapping(getCoefficientNames());
      syncModelOptionsFromScene();
    })
    .catch((e) => console.error(e));
});

if (vrmPoseSelect) {
  vrmPoseSelect.addEventListener("change", () => {
    const vrm = getVRM();
    if (vrm) applyVrmPose(vrm, vrmPoseSelect.value);
  });
}

async function startCamera() {
  if (stream) return;
  try {
    camStatus.textContent = "Starting camera…";
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: true,
    });
    video.srcObject = stream;
    await video.play();
    if (!faceCaptureReady) {
      camStatus.textContent = "Loading face model…";
      await initFaceCapture();
      faceCaptureReady = true;
    }
    camStatus.textContent = "Camera on";
    startCamBtn.textContent = "Stop camera";
    cameraPreview.classList.remove("hidden");
    initCameraPreviewPosition();
    updateTransportButtons();
    resizeCameraOverlay();
  } catch (err) {
    camStatus.textContent = "Error: " + err.message;
  }
}

function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
  stream = null;
  cameraPreview.classList.add("hidden");
  camStatus.textContent = "";
  startCamBtn.textContent = "Start camera";
  updateTransportButtons();
}

startCamBtn.addEventListener("click", async () => {
  if (stream) {
    stopCamera();
    return;
  }
  await startCamera();
});

const viewportEl = document.getElementById("viewport");
const cameraPreviewHeader = document.getElementById("camera-preview-header");
const cameraPreviewMinimizeBtn = document.getElementById(
  "camera-preview-minimize",
);
const MIN_PREVIEW_W = 160;
const MIN_PREVIEW_H = 120;

function setCameraPreviewPosition(left, top) {
  if (!cameraPreview) return;
  cameraPreview.style.left = `${left}px`;
  cameraPreview.style.top = `${top}px`;
  cameraPreview.style.bottom = "auto";
}

function setCameraPreviewSize(width, height) {
  if (!cameraPreview) return;
  cameraPreview.style.width = `${width}px`;
  cameraPreview.style.height = `${height}px`;
}

function initCameraPreviewPosition() {
  if (
    !cameraPreview ||
    !viewportEl ||
    cameraPreview.classList.contains("hidden")
  )
    return;
  if (cameraPreview.dataset.positioned === "1") return;
  const r = viewportEl.getBoundingClientRect();
  const headerH = 32;
  const pad = 12;
  const h = 210;
  const viewportH = r.bottom - r.top;
  const totalPreviewH = headerH + h;
  const top = Math.max(pad, (viewportH - totalPreviewH) / 2);
  setCameraPreviewPosition(pad, top);
  cameraPreview.dataset.positioned = "1";
}

if (cameraPreviewHeader) {
  cameraPreviewHeader.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = cameraPreview.getBoundingClientRect();
    const viewportRect = viewportEl?.getBoundingClientRect();
    const startLeft = rect.left - (viewportRect?.left ?? 0);
    const startTop = rect.top - (viewportRect?.top ?? 0);
    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const dy = e2.clientY - startY;
      setCameraPreviewPosition(startLeft + dx, startTop + dy);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

document.querySelectorAll(".camera-preview-resize").forEach((handle) => {
  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const edge = handle.dataset.resize;
    const rect = cameraPreview.getBoundingClientRect();
    const viewportRect = viewportEl?.getBoundingClientRect();
    const startLeft = rect.left - (viewportRect?.left ?? 0);
    const startTop = rect.top - (viewportRect?.top ?? 0);
    const startWidth = rect.width;
    const startHeight = rect.height;
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const dy = e2.clientY - startY;
      let left = startLeft;
      let top = startTop;
      let width = startWidth;
      let height = startHeight;
      if (edge.includes("e")) width = Math.max(MIN_PREVIEW_W, startWidth + dx);
      if (edge.includes("w")) {
        width = Math.max(MIN_PREVIEW_W, startWidth - dx);
        left = startLeft + startWidth - width;
      }
      if (edge.includes("s"))
        height = Math.max(MIN_PREVIEW_H, startHeight + dy);
      if (edge.includes("n")) {
        height = Math.max(MIN_PREVIEW_H, startHeight - dy);
        top = startTop + startHeight - height;
      }
      setCameraPreviewPosition(left, top);
      setCameraPreviewSize(width, height);
      if (cameraPreviewBody) resizeCameraOverlay();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (cameraPreviewBody) resizeCameraOverlay();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
});

if (cameraPreviewMinimizeBtn) {
  cameraPreviewMinimizeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!cameraPreview) return;
    const minimized = cameraPreview.classList.toggle("minimized");
    cameraPreviewMinimizeBtn.textContent = minimized ? "+" : "−";
    cameraPreviewMinimizeBtn.setAttribute(
      "aria-label",
      minimized ? "Restore" : "Minimize",
    );
    cameraPreviewMinimizeBtn.title = minimized ? "Restore" : "Minimize";
    if (!minimized) resizeCameraOverlay();
  });
}

if (recordEnableBtn) {
  recordEnableBtn.addEventListener("click", () => {
    if (recording) {
      recordArmed = false;
      stopRecording();
      return;
    }
    recordArmed = !recordArmed;
    if (recordArmed) resetExpressionSmoothing();
    updateTransportButtons();
  });
}

if (exportRecordingBtn) {
  exportRecordingBtn.addEventListener("click", async () => {
    if (!playbackState?.recording) return;
    setFileMenuOpen(false);
    await downloadRecordingWithAudio(
      playbackState.recording,
      playbackState.audioBlob ?? null,
      `face-mocap-${Date.now()}`,
    );
  });
}

function startRecording() {
  if (recording || !stream || !faceCaptureReady) return;
  const names = getCoefficientNames();
  recording = createRecording(names);
  recordingStartTime = performance.now() / 1000;
  audioChunks = [];
  const audioTrack = stream.getAudioTracks?.()?.[0];
  if (audioTrack) {
    const audioStream = new MediaStream([audioTrack]);
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    mediaRecorder = new MediaRecorder(audioStream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const audioBlob = audioChunks.length
        ? new Blob(audioChunks, { type: mediaRecorder.mimeType })
        : null;
      const finishedRecording = recording;
      recordStatus.textContent = `Captured. ${finishedRecording.frames.length} frames${audioBlob ? ", + audio" : ""}.`;
      recording = null;
      mediaRecorder = null;
      recordArmed = false;
      loadRecordingIntoPlayback(finishedRecording, audioBlob, true);
      updateTransportButtons();
    };
    mediaRecorder.start();
  } else {
    mediaRecorder = null;
  }
  recordStatus.textContent = "Recording… 0:00";
  updateTransportButtons();
}

function stopRecording() {
  if (!recording) return;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  } else {
    const finishedRecording = recording;
    recordStatus.textContent = `Captured. ${finishedRecording.frames.length} frames.`;
    recording = null;
    recordArmed = false;
    loadRecordingIntoPlayback(finishedRecording, null, true);
    updateTransportButtons();
  }
}

function loadRecordingIntoPlayback(rec, audioBlob = null, autoplay = false) {
  clearPlaybackAudio();
  playbackState = createPlaybackState(rec);
  coeffToVrmMapping = buildCoeffToVrmMapping(rec.names);
  seekSlider.max = Math.max(1, Math.floor(playbackState.duration * 100));
  setPlaybackTime(playbackState, 0);
  if (audioBlob && audioBlob.size > 0) {
    setOriginalAudioClip(audioBlob, { autoplay });
  } else {
    resetAudioLibrary();
    updateAudioSidebarButton();
    updateApplyElevenlabsButton();
  }
  const sampled = sampleAt(playbackState);
  applyCoefficientsMapped(sampled.names, sampled.values, coeffToVrmMapping);
  updatePlaybackUI();
  playbackState.playing = autoplay;
  updateTransportButtons();
}

loadRecordingInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  clearPlaybackAudio();
  const r = new FileReader();
  r.onload = () => {
    try {
      const rec = parseRecording(r.result);
      loadRecordingIntoPlayback(rec, null, false);
    } catch (err) {
      console.error(err);
    }
  };
  r.readAsText(file);
  e.target.value = "";
});

loadAudioInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file || !playbackState) return;
  setOriginalAudioClip(file, { label: file.name || "Imported audio" });
  updatePlaybackUI();
  e.target.value = "";
});

playBtn.addEventListener("click", () => {
  if (recordArmed && stream && faceCaptureReady && !recording) {
    startRecording();
    return;
  }
  if (!playbackState) return;
  playbackState.playing = true;
  if (playbackState.audioEl) {
    playbackState.audioEl.currentTime = playbackState.currentTime;
    playbackState.audioEl.play();
  }
  updateTransportButtons();
});

stopBtn.addEventListener("click", () => {
  if (recording) {
    stopRecording();
    return;
  }
  if (playbackState) {
    playbackState.playing = false;
    if (playbackState.audioEl) {
      playbackState.audioEl.pause();
      playbackState.audioEl.currentTime = 0;
    }
    setPlaybackTime(playbackState, 0);
    const sampled = sampleAt(playbackState);
    applyCoefficientsMapped(sampled.names, sampled.values, coeffToVrmMapping);
    if (sampled.faceMatrix && getVRM()) applyHeadFromFace(getVRM(), sampled);
    updatePlaybackUI();
  }
  updateTransportButtons();
});

if (skipBackBtn) {
  skipBackBtn.addEventListener("click", () => {
    if (!playbackState) return;
    const t = Math.max(0, playbackState.currentTime - 5);
    setPlaybackTime(playbackState, t);
    if (playbackState.audioEl) playbackState.audioEl.currentTime = t;
    const sampled = sampleAt(playbackState);
    applyCoefficientsMapped(sampled.names, sampled.values, coeffToVrmMapping);
    if (sampled.faceMatrix && getVRM()) applyHeadFromFace(getVRM(), sampled);
    updatePlaybackUI();
  });
}
if (skipFwdBtn) {
  skipFwdBtn.addEventListener("click", () => {
    if (!playbackState) return;
    const t = Math.min(playbackState.duration, playbackState.currentTime + 5);
    setPlaybackTime(playbackState, t);
    if (playbackState.audioEl) playbackState.audioEl.currentTime = t;
    const sampled = sampleAt(playbackState);
    applyCoefficientsMapped(sampled.names, sampled.values, coeffToVrmMapping);
    if (sampled.faceMatrix && getVRM()) applyHeadFromFace(getVRM(), sampled);
    updatePlaybackUI();
  });
}

seekSlider.addEventListener("input", () => {
  if (!playbackState) return;
  setPlaybackTime(playbackState, Number(seekSlider.value) / 100);
  if (playbackState.audioEl)
    playbackState.audioEl.currentTime = playbackState.currentTime;
  const sampled = sampleAt(playbackState);
  applyCoefficientsMapped(sampled.names, sampled.values, coeffToVrmMapping);
  if (sampled.faceMatrix && getVRM()) applyHeadFromFace(getVRM(), sampled);
  updatePlaybackUI();
});

function updatePlaybackUI() {
  if (!playbackState) return;
  const max = Math.max(1, Math.floor(playbackState.duration * 100));
  seekSlider.max = max;
  seekSlider.value =
    playbackState.duration > 0
      ? Math.floor(playbackState.currentTime * 100)
      : 0;
  playbackTimeEl.textContent = `${formatTime(playbackState.currentTime)} / ${formatTime(playbackState.duration)}`;
}

if (elevenlabsVoiceSelect)
  elevenlabsVoiceSelect.addEventListener("change", updateApplyElevenlabsButton);

if (fetchVoicesBtn && elevenlabsApiKeyInput) {
  fetchVoicesBtn.addEventListener("click", async () => {
    const key =
      elevenlabsApiKeyInput.value?.trim() ||
      (() => {
        try {
          return localStorage.getItem(ELEVENLABS_KEY_STORAGE);
        } catch (_) {
          return null;
        }
      })();
    if (!key) {
      if (fetchVoicesStatus)
        fetchVoicesStatus.textContent = "Enter API key first";
      return;
    }
    if (fetchVoicesStatus) fetchVoicesStatus.textContent = "Fetching…";
    try {
      const voices = await elevenlabs.fetchVoices(key);
      const opts = voices
        .map((v) => `<option value="${v.voice_id}">${v.name}</option>`)
        .join("");
      const placeholder = '<option value="">-- Select voice --</option>';
      if (elevenlabsVoiceSelect)
        elevenlabsVoiceSelect.innerHTML = placeholder + opts;
      if (fetchVoicesStatus) fetchVoicesStatus.textContent = "";
      updateApplyElevenlabsButton();
    } catch (err) {
      if (fetchVoicesStatus)
        fetchVoicesStatus.textContent = err.message || "Failed";
    }
  });
}

if (applyElevenlabsBtn) {
  applyElevenlabsBtn.addEventListener("click", async () => {
    const key =
      elevenlabsApiKeyInput?.value?.trim() ||
      (() => {
        try {
          return localStorage.getItem(ELEVENLABS_KEY_STORAGE);
        } catch (_) {
          return null;
        }
      })();
    const voiceId = elevenlabsVoiceSelect?.value;
    const sourceClip = audioLibrary.find(
      (clip) => clip.id === activeAudioClipId,
    );
    if (!key || !voiceId || !sourceClip) return;
    if (elevenlabsStatus) elevenlabsStatus.textContent = "Converting…";
    applyElevenlabsBtn.disabled = true;
    const modelIdEl = document.getElementById("elevenlabs-model-id");
    const stabilityEl = document.getElementById("elevenlabs-stability");
    const similarityEl = document.getElementById("elevenlabs-similarity");
    const removeNoiseEl = document.getElementById("elevenlabs-remove-noise");
    const outputFormatEl = document.getElementById("elevenlabs-output-format");
    const options = {};
    if (modelIdEl?.value?.trim()) options.model_id = modelIdEl.value.trim();
    if (stabilityEl?.value !== "" && stabilityEl?.value != null) options.stability = Number(stabilityEl.value);
    if (similarityEl?.value !== "" && similarityEl?.value != null) options.similarity_boost = Number(similarityEl.value);
    if (removeNoiseEl) options.remove_background_noise = removeNoiseEl.checked;
    if (outputFormatEl?.value?.trim()) options.output_format = outputFormatEl.value.trim();
    try {
      const blob = await elevenlabs.convertToVoice(
        key,
        voiceId,
        sourceClip.blob,
        options,
      );
      const voiceName =
        elevenlabsVoiceSelect?.selectedOptions?.[0]?.textContent?.trim() ||
        voiceId;
      const clip = addAudioClip(blob, {
        label: voiceName,
        kind: "generated",
      });
      if (clip && playbackState) {
        setPlaybackTime(playbackState, 0);
        applyAudioClipToPlayback(clip.id, { autoplay: true });
      }
      if (elevenlabsStatus) elevenlabsStatus.textContent = "Done";
    } catch (err) {
      if (elevenlabsStatus)
        elevenlabsStatus.textContent = err.message || "Failed";
    }
    updateApplyElevenlabsButton();
  });
}

function animate() {
  requestAnimationFrame(animate);
  const delta = getClockDelta();

  if (stream && video.readyState >= 2) {
    const result = getCoefficients(video);
    if (result?.landmarks) {
      trackingStatus.textContent = `1 face · ${result.names.length} blendshapes`;
    } else {
      trackingStatus.textContent = "No face detected";
    }
    if (cameraOverlay?.getContext) {
      try {
        const ctx = cameraOverlay.getContext("2d");
        ctx.clearRect(0, 0, cameraOverlay.width, cameraOverlay.height);
        if (result?.landmarks) drawLandmarks(ctx, result.landmarks);
      } catch (_) {
        const ctx = cameraOverlay.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, cameraOverlay.width, cameraOverlay.height);
      }
    }
    if (result && recordArmed) {
      if (recording) {
        const t = performance.now() / 1000 - recordingStartTime;
        addFrame(recording, t, result.values, result.faceMatrix);
        recordStatus.textContent = `Recording… ${formatTime(t)}`;
      }
      if (getVRM() && !(playbackState && playbackState.playing)) {
        coeffToVrmMapping = buildCoeffToVrmMapping(result.names);
        applyCoefficientsMapped(result.names, result.values, coeffToVrmMapping);
        if (result.faceMatrix) applyHeadFromFace(getVRM(), result);
      }
    }
  }

  if (playbackState) {
    tick(playbackState, delta);
    if (playbackState.audioEl) {
      if (playbackState.playing) {
        playbackState.currentTime = Math.min(
          playbackState.duration,
          playbackState.audioEl.currentTime,
        );
      } else {
        playbackState.audioEl.pause();
      }
    }
    if (!recordArmed) {
      const sampled = sampleAt(playbackState);
      applyCoefficientsMapped(sampled.names, sampled.values, coeffToVrmMapping);
      if (sampled.faceMatrix && getVRM()) applyHeadFromFace(getVRM(), sampled);
    }
    updatePlaybackUI();
  }
  updateTransportButtons();
  updateScene(delta);
}

animate();
startCamera();
