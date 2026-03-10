import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let faceLandmarker = null;

export async function initFaceCapture() {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    refineLandmarks: true,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
  });
  return true;
}

function eyeAspectRatio(landmarks, indices) {
  const vertical = (i, j) => {
    const a = landmarks[indices[i]];
    const b = landmarks[indices[j]];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const horizontal = (i, j) => {
    const a = landmarks[indices[i]];
    const b = landmarks[indices[j]];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const v1 = vertical(1, 5);
  const v2 = vertical(2, 4);
  const h = horizontal(0, 3);
  return (v1 + v2) / (2 * h);
}

const LEFT_EYE_INDICES = [33, 246, 161, 160, 159, 158];
const RIGHT_EYE_INDICES = [263, 467, 388, 387, 386, 385];

function landmarkToCoefficients(landmarks) {
  const leftEAR = eyeAspectRatio(landmarks, LEFT_EYE_INDICES);
  const rightEAR = eyeAspectRatio(landmarks, RIGHT_EYE_INDICES);
  const blinkThreshold = 0.2;
  const eyeBlinkLeft = Math.max(0, 1 - leftEAR / blinkThreshold);
  const eyeBlinkRight = Math.max(0, 1 - rightEAR / blinkThreshold);

  const mouthTop = landmarks[13];
  const mouthBottom = landmarks[14];
  const mouthOpen = Math.min(1, Math.hypot(mouthBottom.x - mouthTop.x, mouthBottom.y - mouthTop.y) * 8);

  const jaw = landmarks[152];
  const nose = landmarks[1];
  const jawOpen = Math.min(1, Math.max(0, (jaw.y - nose.y) * 4));

  return {
    eyeBlinkLeft: Math.min(1, eyeBlinkLeft),
    eyeBlinkRight: Math.min(1, eyeBlinkRight),
    jawOpen: Math.min(1, jawOpen * 0.5 + mouthOpen * 0.5),
    mouthOpen: Math.min(1, mouthOpen),
  };
}

const ARKIT_NAME_ORDER = [
  'eyeBlinkLeft', 'eyeLookDownLeft', 'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft',
  'eyeSquintLeft', 'eyeWideLeft', 'eyeBlinkRight', 'eyeLookDownRight', 'eyeLookInRight',
  'eyeLookOutRight', 'eyeLookUpRight', 'eyeSquintRight', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawRight', 'jawOpen', 'mouthClose', 'mouthFunnel',
  'mouthPucker', 'mouthLeft', 'mouthRight', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthFrownLeft', 'mouthFrownRight', 'mouthDimpleLeft', 'mouthDimpleRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthRollLower', 'mouthRollUpper',
  'mouthShrugUpper', 'mouthShrugLower', 'mouthPressLeft', 'mouthPressRight',
  'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'noseSneerLeft', 'noseSneerRight',
];

export function getCoefficients(video) {
  if (!faceLandmarker || !video.videoWidth) return null;

  const result = faceLandmarker.detectForVideo(video, performance.now());
  if (!result.faceLandmarks?.length) return null;

  const toCamel = (s) => {
    const parts = s.split('_');
    return parts[0].toLowerCase() + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
  };
  const coeffs = {};
  if (result.faceBlendshapes?.length > 0 && result.faceBlendshapes[0].categories?.length > 0) {
    for (const cat of result.faceBlendshapes[0].categories) {
      coeffs[cat.categoryName] = cat.score;
      coeffs[toCamel(cat.categoryName)] = cat.score;
    }
  }
  const hasBlendshapes = Object.keys(coeffs).length > 0;
  if (!hasBlendshapes) {
    const derived = landmarkToCoefficients(result.faceLandmarks[0]);
    Object.assign(coeffs, derived);
  }

  const names = getCoefficientNames();
  const values = names.map(n => coeffs[n] ?? 0);
  const faceMatrix = result.facialTransformationMatrixes?.[0];
  return { names, values, coeffs, landmarks: result.faceLandmarks[0], faceMatrix };
}

export function getCoefficientNames() {
  return [...ARKIT_NAME_ORDER];
}
