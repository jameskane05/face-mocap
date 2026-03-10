import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let poseLandmarker = null;

export async function initPoseCapture() {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
    runningMode: 'IMAGE',
    numPoses: 1,
    minPoseDetectionConfidence: 0.3,
    minPosePresenceConfidence: 0.3,
  });
  return true;
}

export function getPose(video) {
  if (!poseLandmarker || !video?.videoWidth) return null;
  const result = poseLandmarker.detect(video);
  if (!result?.landmarks?.length) return null;
  return result;
}

export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
};
