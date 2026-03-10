import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import { POSE_LANDMARKS } from "./poseCapture.js";

let scene, camera, renderer, loader;
let currentVRM = null;
let clock = new THREE.Clock();
const cameraTarget = new THREE.Vector3(0, 1.28, 0);
let currentHeadPitchSign = 1;

const poseRestDirs = {};
const poseRestUps = {};
const poseRestLocalQuats = {};
const _v3 = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _v3d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _boneWorldQ = new THREE.Quaternion();
const _basisX = new THREE.Vector3();
const _basisY = new THREE.Vector3();
const _basisZ = new THREE.Vector3();
const _headAngles = new THREE.Vector3();
const _targetHeadAngles = new THREE.Vector3();
const _headEuler = new THREE.Euler(0, 0, 0, "YXZ");
const _headMatrix = new THREE.Matrix4();
const SPINE_IK_WEIGHT = 0;
const CHEST_WEIGHT = 0;
const SHOULDER_WEIGHT = 0;
const POSE_SMOOTH = 0.25;
const EXPRESSION_SMOOTH = 0.3;
const MOUTH_EXPRESSION_SMOOTH = 0.6;
const MAX_HEAD_YAW = THREE.MathUtils.degToRad(60);
const MAX_HEAD_PITCH = THREE.MathUtils.degToRad(35);
const MAX_HEAD_ROLL = THREE.MathUtils.degToRad(35);

let smoothedHeadAngles = null;
let smoothedHeadScale = null;
let headScaleBaseline = null;
let smoothedHeadTranslation = null;
let headTranslationBaseline = null;
let smoothedWaistLeanPitch = 0;
let smoothedWaistLeanYaw = 0;
const smoothedExpressionValues = {};
const WAIST_LEAN_PITCH_SENSITIVITY = 0.032;
const WAIST_LEAN_YAW_SENSITIVITY = 0.1;
const WAIST_LEAN_MAX_PITCH = THREE.MathUtils.degToRad(20);
const WAIST_LEAN_MAX_YAW = THREE.MathUtils.degToRad(30);
const WAIST_LEAN_TRANSLATION_SMOOTH = 0.06;
const WAIST_LEAN_ANGLE_SMOOTH = 0.05;

function pickBoneFacingAxes(bone, targetForward) {
  bone.getWorldQuaternion(_boneWorldQ);
  _basisX.set(1, 0, 0).applyQuaternion(_boneWorldQ).normalize();
  _basisY.set(0, 1, 0).applyQuaternion(_boneWorldQ).normalize();
  _basisZ.set(0, 0, 1).applyQuaternion(_boneWorldQ).normalize();

  const candidates = [
    _basisX,
    _basisX.clone().negate(),
    _basisY,
    _basisY.clone().negate(),
    _basisZ,
    _basisZ.clone().negate(),
  ];

  let forward = candidates[0];
  let bestForwardDot = forward.dot(targetForward);
  for (let i = 1; i < candidates.length; i++) {
    const dot = candidates[i].dot(targetForward);
    if (dot > bestForwardDot) {
      bestForwardDot = dot;
      forward = candidates[i];
    }
  }

  const upCandidates = [
    _basisX,
    _basisX.clone().negate(),
    _basisY,
    _basisY.clone().negate(),
    _basisZ,
    _basisZ.clone().negate(),
  ];
  let up = null;
  let bestUpDot = -Infinity;
  for (const candidate of upCandidates) {
    if (Math.abs(candidate.dot(forward)) > 0.5) continue;
    const dot = candidate.dot(THREE.Object3D.DEFAULT_UP);
    if (dot > bestUpDot) {
      bestUpDot = dot;
      up = candidate;
    }
  }
  if (!up) {
    up = _basisY.clone();
  }
  up = up.clone().addScaledVector(forward, -up.dot(forward)).normalize();

  return {
    forward: forward.clone(),
    up,
  };
}

function cachePoseRestDirections(vrm) {
  const h = vrm?.humanoid;
  if (!h) return;
  Object.keys(poseRestDirs).forEach((k) => (poseRestDirs[k] = null));
  Object.keys(poseRestUps).forEach((k) => (poseRestUps[k] = null));
  Object.keys(poseRestLocalQuats).forEach(
    (k) => (poseRestLocalQuats[k] = null),
  );
  vrm.scene.updateMatrixWorld(true);
  for (const [key, boneName] of [
    ["spine", "spine"],
    ["chest", "chest"],
    ["neck", "neck"],
    ["head", "head"],
  ]) {
    const bone = h.getNormalizedBoneNode(boneName);
    if (!bone) continue;
    bone.getWorldPosition(_v3);
    camera.getWorldPosition(_v3b);
    const targetForward = _v3b.sub(_v3).normalize();
    const axes = pickBoneFacingAxes(bone, targetForward);
    poseRestDirs[key] = axes.forward;
    poseRestUps[key] = axes.up;
    poseRestLocalQuats[key] = bone.quaternion.clone();
  }
  for (const [key, boneName, childName] of [
    ["leftUpperArm", "leftUpperArm", "leftLowerArm"],
    ["rightUpperArm", "rightUpperArm", "rightLowerArm"],
  ]) {
    const bone = h.getNormalizedBoneNode(boneName);
    const tail = h.getNormalizedBoneNode(childName);
    if (!bone || !tail) continue;
    bone.getWorldPosition(_v3);
    tail.getWorldPosition(_v3b);
    poseRestDirs[key] = _v3b.clone().sub(_v3).normalize();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getShoulderBone(h, side) {
  return (
    h.getNormalizedBoneNode(
      side === "left" ? "leftShoulder" : "rightShoulder",
    ) ??
    h.getNormalizedBoneNode(side === "left" ? "leftUpperArm" : "rightUpperArm")
  );
}

function autoFaceCamera(vrm) {
  const h = vrm?.humanoid;
  if (!h || !camera) return;
  const left = getShoulderBone(h, "left");
  const right = getShoulderBone(h, "right");
  if (!left || !right) return;
  left.getWorldPosition(_v3);
  right.getWorldPosition(_v3b);
  _v3b.sub(_v3).setY(0);
  if (_v3b.lengthSq() < 0.0001) return;
  _v3b.normalize();
  _v3c.crossVectors(_v3b, THREE.Object3D.DEFAULT_UP).setY(0);
  if (_v3c.lengthSq() < 0.0001) return;
  _v3c.normalize();
  const head =
    h.getNormalizedBoneNode("head") ?? h.getNormalizedBoneNode("neck");
  if (head) {
    head.getWorldQuaternion(_boneWorldQ);
    _v3d.set(0, 0, 1).applyQuaternion(_boneWorldQ).setY(0);
    if (_v3d.lengthSq() > 0.0001) {
      _v3d.normalize();
      if (_v3c.dot(_v3d) < 0) _v3c.negate();
    }
  }
  vrm.scene.getWorldPosition(_v3d);
  camera.getWorldPosition(_v3);
  _v3.sub(_v3d).setY(0);
  if (_v3.lengthSq() < 0.0001) return;
  _v3.normalize();
  const currentYaw = Math.atan2(_v3c.x, _v3c.z);
  const targetYaw = Math.atan2(_v3.x, _v3.z);
  vrm.scene.rotation.y += targetYaw - currentYaw;
  vrm.scene.updateMatrixWorld(true);
}

function headScaleFromFaceMatrix(faceMatrix) {
  const data = faceMatrix?.data;
  if (!data || data.length < 16) return null;
  const sx = data[0];
  const sy = data[1];
  const sz = data[2];
  return Math.sqrt(sx * sx + sy * sy + sz * sz);
}

function headTranslationFromFaceMatrix(faceMatrix) {
  const data = faceMatrix?.data;
  if (!data || data.length < 16) return null;
  return { x: data[12], y: data[13], z: data[14] };
}

function headAxesFromFaceMatrix(faceMatrix, camera) {
  const data = faceMatrix?.data;
  if (!data || data.length < 16) return null;
  const yx = data[4];
  const yy = data[5];
  const yz = data[6];
  const zx = data[8];
  const zy = data[9];
  const zz = data[10];
  const forward = _v3
    .set(-zx, zy, zz)
    .normalize()
    .applyQuaternion(camera.quaternion)
    .clone();
  const up = _v3b
    .set(-yx, yy, yz)
    .normalize()
    .applyQuaternion(camera.quaternion)
    .clone();
  up.addScaledVector(forward, -up.dot(forward)).normalize();
  return { forward, up };
}

function setBoneDir(h, boneName, restDir, currentDir) {
  const bone = h.getNormalizedBoneNode(boneName);
  if (!bone || !restDir || restDir.lengthSq() < 0.001) return;
  if (currentDir.lengthSq() < 0.001) return;
  _q.setFromUnitVectors(restDir, currentDir);
  const parent = bone.parent;
  if (parent) {
    parent.getWorldQuaternion(_parentQ);
    bone.quaternion.copy(_parentQ).invert().premultiply(_q);
  } else {
    bone.quaternion.copy(_q);
  }
}

function setBoneAxes(
  h,
  boneName,
  restForward,
  restUp,
  currentForward,
  currentUp,
) {
  const bone = h.getNormalizedBoneNode(boneName);
  if (!bone || !restForward || !restUp || !currentForward || !currentUp) return;
  if (restForward.lengthSq() < 0.001 || restUp.lengthSq() < 0.001) return;
  if (currentForward.lengthSq() < 0.001 || currentUp.lengthSq() < 0.001) return;
  const restRight = _v3.copy(restUp).cross(restForward).normalize();
  const restOrthoUp = _v3b.copy(restForward).cross(restRight).normalize();
  const currentRight = _v3c.copy(currentUp).cross(currentForward).normalize();
  const currentOrthoUp = _v3d
    .copy(currentForward)
    .cross(currentRight)
    .normalize();
  const restM = new THREE.Matrix4().makeBasis(
    restRight,
    restOrthoUp,
    restForward,
  );
  const currentM = new THREE.Matrix4().makeBasis(
    currentRight,
    currentOrthoUp,
    currentForward,
  );
  const restQ = new THREE.Quaternion().setFromRotationMatrix(restM);
  const currentQ = new THREE.Quaternion().setFromRotationMatrix(currentM);
  _q.copy(restQ).invert().premultiply(currentQ);
  const parent = bone.parent;
  if (parent) {
    parent.getWorldQuaternion(_parentQ);
    bone.quaternion.copy(_parentQ).invert().premultiply(_q);
  } else {
    bone.quaternion.copy(_q);
  }
}

function tiltBoneUp(restUp, headUp, targetForward, weight) {
  if (!restUp) return null;
  _v3b.copy(restUp);
  if (headUp && weight > 0) _v3b.lerp(headUp, weight);
  _v3b.addScaledVector(targetForward, -_v3b.dot(targetForward));
  if (_v3b.lengthSq() < 0.001) {
    _v3b
      .copy(restUp)
      .addScaledVector(targetForward, -restUp.dot(targetForward));
  }
  return _v3b.normalize();
}

function headAnglesFromAxes(forward, up) {
  _v3c.copy(up).cross(forward).normalize();
  _v3d.copy(forward).cross(_v3c).normalize();
  _headMatrix.makeBasis(_v3c, _v3d, forward);
  _headEuler.setFromRotationMatrix(_headMatrix, "YXZ");
  _targetHeadAngles.set(
    clamp(_headEuler.x, -MAX_HEAD_PITCH, MAX_HEAD_PITCH),
    clamp(_headEuler.y, -MAX_HEAD_YAW, MAX_HEAD_YAW),
    clamp(_headEuler.z, -MAX_HEAD_ROLL, MAX_HEAD_ROLL),
  );
  return _targetHeadAngles;
}

function applyHeadBoneLocalRotation(h, boneName, restQ, pitch, yaw, roll) {
  const bone = h.getNormalizedBoneNode(boneName);
  if (!bone || !restQ) return;
  _headEuler.set(pitch, yaw, roll, "YXZ");
  _q.setFromEuler(_headEuler);
  bone.quaternion.copy(restQ).multiply(_q);
}

export function applyHeadFromFace(vrm, faceResult) {
  const h = vrm?.humanoid;
  if (!h || !camera) return;
  const rawAxes = headAxesFromFaceMatrix(faceResult?.faceMatrix, camera);
  if (!rawAxes) return;
  const rawTrans = headTranslationFromFaceMatrix(faceResult?.faceMatrix);
  if (rawTrans != null) {
    if (headTranslationBaseline == null) {
      headTranslationBaseline = { x: rawTrans.x, y: rawTrans.y, z: rawTrans.z };
      smoothedHeadTranslation = { ...rawTrans };
    } else {
      if (smoothedHeadTranslation == null) smoothedHeadTranslation = { ...rawTrans };
      smoothedHeadTranslation.x += (rawTrans.x - smoothedHeadTranslation.x) * WAIST_LEAN_TRANSLATION_SMOOTH;
      smoothedHeadTranslation.y += (rawTrans.y - smoothedHeadTranslation.y) * WAIST_LEAN_TRANSLATION_SMOOTH;
      smoothedHeadTranslation.z += (rawTrans.z - smoothedHeadTranslation.z) * WAIST_LEAN_TRANSLATION_SMOOTH;
    }
    const deltaX = smoothedHeadTranslation.x - headTranslationBaseline.x;
    const deltaZ = smoothedHeadTranslation.z - headTranslationBaseline.z;
    const targetPitch = THREE.MathUtils.clamp(
      -deltaZ * WAIST_LEAN_PITCH_SENSITIVITY,
      -WAIST_LEAN_MAX_PITCH,
      WAIST_LEAN_MAX_PITCH,
    );
    const targetYaw = THREE.MathUtils.clamp(
      deltaX * WAIST_LEAN_YAW_SENSITIVITY,
      -WAIST_LEAN_MAX_YAW,
      WAIST_LEAN_MAX_YAW,
    );
    smoothedWaistLeanPitch += (targetPitch - smoothedWaistLeanPitch) * WAIST_LEAN_ANGLE_SMOOTH;
    smoothedWaistLeanYaw += (targetYaw - smoothedWaistLeanYaw) * WAIST_LEAN_ANGLE_SMOOTH;
    vrm.scene.updateMatrixWorld(true);
    if (poseRestLocalQuats.spine) {
      applyHeadBoneLocalRotation(h, "spine", poseRestLocalQuats.spine, smoothedWaistLeanPitch * 0.6, smoothedWaistLeanYaw * 0.6, 0);
    }
    if (poseRestLocalQuats.chest) {
      applyHeadBoneLocalRotation(h, "chest", poseRestLocalQuats.chest, smoothedWaistLeanPitch * 0.4, smoothedWaistLeanYaw * 0.4, 0);
    }
    const neckBone = h.getNormalizedBoneNode("neck");
    const headBone = h.getNormalizedBoneNode("head");
    if (neckBone) neckBone.position.set(0, 0, 0);
    if (headBone) headBone.position.set(0, 0, 0);
  }
  const { forward: rawDir, up: rawUp } = rawAxes;
  const rawAngles = headAnglesFromAxes(rawDir, rawUp);
  if (!smoothedHeadAngles) {
    smoothedHeadAngles = rawAngles.clone();
  } else {
    smoothedHeadAngles.lerp(rawAngles, POSE_SMOOTH);
  }
  const pitch = smoothedHeadAngles.x * currentHeadPitchSign;
  const yaw = smoothedHeadAngles.y;
  const roll = -smoothedHeadAngles.z;
  vrm.scene.updateMatrixWorld(true);
  if (SPINE_IK_WEIGHT > 0 && poseRestDirs.spine) {
    applyHeadBoneLocalRotation(
      h,
      "spine",
      poseRestLocalQuats.spine,
      pitch * SPINE_IK_WEIGHT,
      yaw * SPINE_IK_WEIGHT,
      roll * SPINE_IK_WEIGHT,
    );
  }
  if (CHEST_WEIGHT > 0 && poseRestDirs.chest) {
    applyHeadBoneLocalRotation(
      h,
      "chest",
      poseRestLocalQuats.chest,
      pitch * CHEST_WEIGHT,
      yaw * CHEST_WEIGHT,
      roll * CHEST_WEIGHT,
    );
  }
  applyHeadBoneLocalRotation(
    h,
    "neck",
    poseRestLocalQuats.neck,
    pitch * 0.35,
    yaw * 0.35,
    roll * 0.35,
  );
  applyHeadBoneLocalRotation(
    h,
    "head",
    poseRestLocalQuats.head,
    pitch * 0.65,
    yaw * 0.65,
    roll * 0.65,
  );
  if (SHOULDER_WEIGHT > 0 && poseRestDirs.leftUpperArm) {
    vrm.scene.updateMatrixWorld(true);
    _v3
      .lerpVectors(
        poseRestDirs.leftUpperArm,
        poseRestDirs.head,
        SHOULDER_WEIGHT,
      )
      .normalize();
    setBoneDir(h, "leftUpperArm", poseRestDirs.leftUpperArm, _v3);
  }
  if (SHOULDER_WEIGHT > 0 && poseRestDirs.rightUpperArm) {
    vrm.scene.updateMatrixWorld(true);
    _v3
      .lerpVectors(
        poseRestDirs.rightUpperArm,
        poseRestDirs.head,
        SHOULDER_WEIGHT,
      )
      .normalize();
    setBoneDir(h, "rightUpperArm", poseRestDirs.rightUpperArm, _v3);
  }
}

export function initScene(canvas) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.38, 1.2);
  camera.lookAt(cameraTarget);
  scene.add(camera);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(1, 2, 3);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  resize();

  loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  window.addEventListener("resize", resize);
  return { scene, camera, renderer };
}

function resize() {
  if (!renderer) return;
  const canvas = renderer.domElement;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

export function zoomCameraByWheel(deltaY) {
  if (!camera) return;
  _v3.copy(camera.position).sub(cameraTarget);
  const distance = _v3.length();
  if (distance < 0.0001) return;
  const nextDistance = THREE.MathUtils.clamp(
    distance * (1 + deltaY * 0.001),
    0.5,
    6,
  );
  _v3.normalize().multiplyScalar(nextDistance);
  camera.position.copy(cameraTarget).add(_v3);
  camera.lookAt(cameraTarget);
  camera.updateProjectionMatrix();
}

export function panCameraByDrag(deltaX, deltaY) {
  if (!camera) return;
  camera.getWorldDirection(_v3);
  _v3.normalize();
  _v3b.crossVectors(_v3, THREE.Object3D.DEFAULT_UP).normalize();
  _v3c.copy(THREE.Object3D.DEFAULT_UP);
  const panScale = 0.0025;
  const pan = _v3b
    .multiplyScalar(-deltaX * panScale)
    .add(_v3c.multiplyScalar(deltaY * panScale));
  camera.position.add(pan);
  cameraTarget.add(pan);
  camera.lookAt(cameraTarget);
  camera.updateProjectionMatrix();
}

export function loadVRMFromUrl(url, options = {}) {
  const hasRotationY = options.rotationY !== undefined;
  const rotationY = hasRotationY ? Number(options.rotationY) : 0;
  const positionY =
    options.positionY !== undefined ? Number(options.positionY) : 0;
  const headPitchSign =
    options.headPitchSign !== undefined ? Number(options.headPitchSign) : 1;
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        if (currentVRM) {
          scene.remove(currentVRM.scene);
          currentVRM = null;
        }
        const vrm = gltf.userData.vrm;
        if (!vrm) {
          reject(new Error("No VRM on gltf.userData"));
          return;
        }
        currentVRM = vrm;
        currentHeadPitchSign = headPitchSign >= 0 ? 1 : -1;
        vrm.scene.rotation.y = rotationY;
        vrm.scene.position.y = positionY;
        scene.add(vrm.scene);
        applyVrmPose(vrm, "arms-at-sides");
        vrm.scene.updateMatrixWorld(true);
        if (!hasRotationY) autoFaceCamera(vrm);
        cachePoseRestDirections(vrm);
        smoothedHeadAngles = null;
        smoothedHeadScale = null;
        headScaleBaseline = null;
        smoothedHeadTranslation = null;
        headTranslationBaseline = null;
        smoothedWaistLeanPitch = 0;
        smoothedWaistLeanYaw = 0;
        Object.keys(smoothedExpressionValues).forEach(
          (k) => delete smoothedExpressionValues[k],
        );
        resolve(vrm);
      },
      undefined,
      reject,
    );
  });
}

export function loadVRMFromFile(file, options = {}) {
  const url = URL.createObjectURL(file);
  return loadVRMFromUrl(url, options).finally(() => URL.revokeObjectURL(url));
}

export function getVRM() {
  return currentVRM;
}

export function resetExpressionSmoothing() {
  Object.keys(smoothedExpressionValues).forEach(
    (k) => delete smoothedExpressionValues[k],
  );
  smoothedHeadAngles = null;
  smoothedHeadScale = null;
  headScaleBaseline = null;
  smoothedHeadTranslation = null;
  headTranslationBaseline = null;
  smoothedWaistLeanPitch = 0;
  smoothedWaistLeanYaw = 0;
}

const ARMS_DOWN_ANGLE = THREE.MathUtils.degToRad(68);
const ARMS_DOWN_SIN = Math.sin(ARMS_DOWN_ANGLE / 2);
const ARMS_DOWN_COS = Math.cos(ARMS_DOWN_ANGLE / 2);
const ARMS_AT_SIDES_POSE = {
  leftUpperArm: { rotation: [0, 0, ARMS_DOWN_SIN, ARMS_DOWN_COS] },
  rightUpperArm: { rotation: [0, 0, -ARMS_DOWN_SIN, ARMS_DOWN_COS] },
};

export function applyVrmPose(vrm, preset) {
  const h = vrm?.humanoid;
  if (!h) return;
  if (preset === "arms-at-sides") {
    h.setNormalizedPose(ARMS_AT_SIDES_POSE);
  } else {
    h.resetNormalizedPose();
  }
}

export function setVrmScale(scale) {
  if (!currentVRM?.scene) return;
  const s = Math.max(0.01, Number(scale));
  currentVRM.scene.scale.setScalar(s);
}

export function setVrmPositionY(y) {
  if (!currentVRM?.scene) return;
  currentVRM.scene.position.y = Number(y);
}

export function getVrmScale() {
  return currentVRM?.scene?.scale?.x ?? 1;
}

export function getVrmPositionY() {
  return currentVRM?.scene?.position?.y ?? 0;
}

export function setVrmRotationY(rad, posePreset) {
  if (!currentVRM?.scene) return;
  currentVRM.scene.rotation.y = Number(rad);
  applyVrmPose(currentVRM, posePreset ?? "arms-at-sides");
  cachePoseRestDirections(currentVRM);
  smoothedHeadAngles = null;
  smoothedHeadScale = null;
  headScaleBaseline = null;
  smoothedHeadTranslation = null;
  headTranslationBaseline = null;
  smoothedWaistLeanPitch = 0;
  smoothedWaistLeanYaw = 0;
}

export function getVrmRotationY() {
  return currentVRM?.scene?.rotation?.y ?? 0;
}

export function applyCoefficients(coeffs) {
  if (!currentVRM?.expressionManager || !coeffs) return;
  const em = currentVRM.expressionManager;
  em.resetValues();
  const map = em.expressionMap || {};
  for (const [name, weight] of Object.entries(coeffs)) {
    const w = Math.max(0, Math.min(1, Number(weight)));
    if (map[name] != null) {
      em.setValue(name, w);
    }
  }
}

const VRM_PRESET_ALIASES = {
  eyeBlinkLeft: ["blinkLeft", "blink"],
  eyeBlinkRight: ["blinkRight", "blink"],
  jawOpen: ["aa", "ou", "oh"],
  mouthSmileLeft: ["happy"],
  mouthSmileRight: ["happy"],
  mouthFrownLeft: ["sad"],
  mouthFrownRight: ["sad"],
};

function getExpressionSmoothFactor(name) {
  if (!name) return EXPRESSION_SMOOTH;
  return name === "jawOpen" || name === "mouthOpen" || name.startsWith("mouth")
    ? MOUTH_EXPRESSION_SMOOTH
    : EXPRESSION_SMOOTH;
}

export function buildCoeffToVrmMapping(captureNames = []) {
  if (!currentVRM?.expressionManager) return {};
  const map = currentVRM.expressionManager.expressionMap || {};
  const vrmNames = Object.keys(map);
  const mapping = {};
  for (const vrmName of vrmNames) {
    mapping[vrmName] = vrmName;
  }
  for (const captureName of captureNames) {
    if (mapping[captureName] != null) continue;
    const aliases = VRM_PRESET_ALIASES[captureName];
    if (aliases) {
      for (const alias of aliases) {
        if (vrmNames.includes(alias)) {
          mapping[captureName] = alias;
          break;
        }
      }
    }
  }
  return mapping;
}

const EYE_LOOK_SWAP_PAIRS = [
  ["eyeLookInLeft", "eyeLookOutLeft"],
  ["eyeLookInRight", "eyeLookOutRight"],
];

export function applyCoefficientsMapped(names, values, mapping) {
  if (!currentVRM?.expressionManager) return;
  const em = currentVRM.expressionManager;
  em.resetValues();
  const adjustedValues = values.slice();
  for (const [a, b] of EYE_LOOK_SWAP_PAIRS) {
    const ia = names.indexOf(a);
    const ib = names.indexOf(b);
    if (ia !== -1 && ib !== -1) {
      const t = adjustedValues[ia];
      adjustedValues[ia] = adjustedValues[ib];
      adjustedValues[ib] = t;
    }
  }
  const byVrm = {};
  for (let i = 0; i < names.length; i++) {
    const vrmName = mapping[names[i]] ?? names[i];
    const w = Math.max(0, Math.min(1, adjustedValues[i]));
    byVrm[vrmName] = Math.max(byVrm[vrmName] ?? 0, w);
  }
  for (const [vrmName, target] of Object.entries(byVrm)) {
    const prev = smoothedExpressionValues[vrmName] ?? target;
    const smoothed =
      prev + (target - prev) * getExpressionSmoothFactor(vrmName);
    smoothedExpressionValues[vrmName] = smoothed;
    try {
      em.setValue(vrmName, Math.max(0, Math.min(1, smoothed)));
    } catch (_) {}
  }
}

function vecFromLandmark(lm) {
  return _v3.set(lm.x, -lm.y, lm.z);
}

function dirFromLandmarks(world, fromIdx, toIdx) {
  vecFromLandmark(world[fromIdx]);
  _v3b.set(world[toIdx].x, -world[toIdx].y, world[toIdx].z);
  return _v3b.sub(_v3).normalize();
}

export function applyPose(vrm, poseResult) {
  const h = vrm?.humanoid;
  const world =
    poseResult?.worldLandmarks?.[0] ?? poseResult?.poseWorldLandmarks?.[0];
  if (!h || !world || world.length < 17) return;
  vrm.scene.updateMatrixWorld(true);
  const setBoneDir = (boneName, restDir, currentDir) => {
    const bone = h.getNormalizedBoneNode(boneName);
    if (!bone || !restDir || restDir.lengthSq() < 0.001) return;
    if (currentDir.lengthSq() < 0.001) return;
    _q.setFromUnitVectors(restDir, currentDir);
    const parent = bone.parent;
    if (parent) {
      parent.getWorldQuaternion(_parentQ);
      bone.quaternion.copy(_parentQ).invert().premultiply(_q);
    } else {
      bone.quaternion.copy(_q);
    }
  };
  const {
    NOSE,
    LEFT_SHOULDER,
    RIGHT_SHOULDER,
    LEFT_ELBOW,
    RIGHT_ELBOW,
    LEFT_WRIST,
    RIGHT_WRIST,
  } = POSE_LANDMARKS;
  const shoulderCx = (world[LEFT_SHOULDER].x + world[RIGHT_SHOULDER].x) / 2;
  const shoulderCy = (world[LEFT_SHOULDER].y + world[RIGHT_SHOULDER].y) / 2;
  const shoulderCz = (world[LEFT_SHOULDER].z + world[RIGHT_SHOULDER].z) / 2;
  _v3.set(shoulderCx, -shoulderCy, shoulderCz);
  _v3b.set(world[NOSE].x, -world[NOSE].y, world[NOSE].z).sub(_v3).normalize();
  setBoneDir("neck", poseRestDirs.neck, _v3b);
  setBoneDir("head", poseRestDirs.head, _v3b);
  setBoneDir(
    "leftUpperArm",
    poseRestDirs.leftUpperArm,
    dirFromLandmarks(world, LEFT_SHOULDER, LEFT_ELBOW),
  );
  setBoneDir(
    "leftLowerArm",
    poseRestDirs.leftLowerArm,
    dirFromLandmarks(world, LEFT_ELBOW, LEFT_WRIST),
  );
  setBoneDir(
    "rightUpperArm",
    poseRestDirs.rightUpperArm,
    dirFromLandmarks(world, RIGHT_SHOULDER, RIGHT_ELBOW),
  );
  setBoneDir(
    "rightLowerArm",
    poseRestDirs.rightLowerArm,
    dirFromLandmarks(world, RIGHT_ELBOW, RIGHT_WRIST),
  );
}

export function updateScene(delta) {
  if (currentVRM) currentVRM.update(delta);
  renderer.render(scene, camera);
}

export function getClockDelta() {
  return clock.getDelta();
}
