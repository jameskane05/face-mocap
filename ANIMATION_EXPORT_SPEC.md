# Face mocap animation export — format and how to interpret it

Exports from the face-mocap-vrm app are JSON files you can load in another engine (Unity, Unreal, custom, etc.) to drive a character’s face and head.

## File structure

The JSON has this shape:

```json
{
  "version": 3,
  "fps": 30,
  "names": ["eyeBlinkLeft", "eyeLookDownLeft", ...],
  "frames": [
    { "t": 0.0, "values": [0, 0, ...], "faceMatrix": [ ... ] },
    { "t": 0.0333, "values": [0.02, ...], "faceMatrix": [ ... ] }
  ]
}
```

- **version**: Integer. Supported range in the app is 1–4. Reject or warn if outside a range your importer supports.
- **fps**: Number. Frame rate of the capture (usually 30). Use for duration and sampling:  
  `duration_seconds = (last frame's `t`) + (1 / fps)`.
- **names**: Array of strings. **Order is fixed**: the same 52 ARKit-style blend shape names every time (see list below). Each element of `values` corresponds to the same index in `names`.
- **frames**: Array of keyframes, not necessarily evenly spaced. Each frame has:
  - **t**: Time in seconds from the start of the recording.
  - **values**: Array of numbers, length = `names.length`. Weights for each blend shape, typically in `[0, 1]`. Same index = same name (e.g. `values[0]` is `names[0]`).
  - **faceMatrix**: Optional array of 16 numbers. 4×4 transformation matrix for **head pose** (position + orientation) in column-major order (indices 0–3 = column 0, 4–7 = column 1, 8–11 = column 2, 12–15 = column 3). Comes from MediaPipe’s “facial transformation matrix”. If missing, you only have expressions; head pose is unchanged or use identity.

### Version 4 (compact frames)

New exports use `version: 4`. Each element of `frames` is a **single array** of length `1 + names.length + 16`:

- Index `0`: time `t` (seconds).
- Indices `1` … `names.length`: blend shape weights in `names` order.
- Indices `1 + names.length` … end: 16 head matrix values (same column-major 4×4 as v3). If head data was absent at capture, these are zeros.

Sampling and interpolation are unchanged: treat each row as one keyframe with the same `t`, `values`, and `faceMatrix` semantics as v3.

## Blend shape names (order)

Use this exact order when indexing `values`:

1. eyeBlinkLeft  
2. eyeLookDownLeft  
3. eyeLookInLeft  
4. eyeLookOutLeft  
5. eyeLookUpLeft  
6. eyeSquintLeft  
7. eyeWideLeft  
8. eyeBlinkRight  
9. eyeLookDownRight  
10. eyeLookInRight  
11. eyeLookOutRight  
12. eyeLookUpRight  
13. eyeSquintRight  
14. eyeWideRight  
15. jawForward  
16. jawLeft  
17. jawRight  
18. jawOpen  
19. mouthClose  
20. mouthFunnel  
21. mouthPucker  
22. mouthLeft  
23. mouthRight  
24. mouthSmileLeft  
25. mouthSmileRight  
26. mouthFrownLeft  
27. mouthFrownRight  
28. mouthDimpleLeft  
29. mouthDimpleRight  
30. mouthStretchLeft  
31. mouthStretchRight  
32. mouthRollLower  
33. mouthRollUpper  
34. mouthShrugUpper  
35. mouthShrugLower  
36. mouthPressLeft  
37. mouthPressRight  
38. mouthLowerDownLeft  
39. mouthLowerDownRight  
40. mouthUpperUpLeft  
41. mouthUpperUpRight  
42. browDownLeft  
43. browDownRight  
44. browInnerUp  
45. browOuterUpLeft  
46. browOuterUpRight  
47. cheekPuff  
48. cheekSquintLeft  
49. cheekSquintRight  
50. noseSneerLeft  
51. noseSneerRight  

These match Apple ARKit / VRM 0.x expression names. Map them to your engine’s blend shapes or morph targets by name (or by a fixed index table if you keep this order).

## Playback / sampling

- Time is in **seconds**.
- Frames can be irregular. To sample at time `t`:
  1. Find the two frames such that `frames[i].t <= t < frames[i+1].t` (or clamp to first/last frame).
  2. Linearly interpolate:  
     `alpha = (t - frames[i].t) / (frames[i+1].t - frames[i].t)`  
     then for each `j`:  
     `value[j] = lerp(frames[i].values[j], frames[i+1].values[j], alpha)`  
     and if both frames have `faceMatrix`, interpolate the 16 matrix elements the same way (component-wise lerp), then renormalize or use the matrix for position and Slerp for rotation if your engine prefers.
- If a frame has no `faceMatrix`, you can keep the previous head pose or skip head updates for that frame.

## Orienting the avatar to face the camera

Capture is done with the user facing the camera. To have the avatar face your camera in another engine:

1. **Coordinate system**  
   The export assumes **Y-up**. The “camera” during capture is in front of the character (e.g. in the source app, camera at positive Z looking toward the origin). The blend shapes and expressions are view-independent; only head pose (`faceMatrix`) depends on orientation.

2. **Root rotation**  
   Many VRM/GLTF models have the character facing **+Z** in rest pose. To face a camera that is in front of the character (e.g. at +Z looking at the origin), rotate the **avatar root** by **180° around the Y axis** (`rotationY = π`), so the character’s forward is −Z and they look at the camera. If your model already faces −Z at rest, use no rotation (or 0). Adjust to match your engine’s axes and where you place the camera.

3. **Head pose (`faceMatrix`)**  
   The matrix is in **camera/view space** from MediaPipe (head orientation relative to the camera). The source app applies it by transforming the extracted axes by the camera’s orientation so head motion matches the rotated avatar. In your engine:
   - Either apply head pose in **camera-relative space** (so “forward” = toward camera, “up” = world up), then drive the head bone from that, **or**
   - Build head rotation from the matrix in the same way as the source (use columns 1 and 2 of the 4×4 for Y and Z axes; see `headAxesFromFaceMatrix` in this repo’s `scene.js`), then **transform that rotation by your avatar’s root rotation** (e.g. the same 180° Y) so the head motion stays consistent with the character’s forward direction.

4. **Summary**  
   - Y-up; avatar in front of camera during capture.  
   - Rotate avatar root (typically 180° Y) so the character faces the camera.  
   - Apply `faceMatrix` in camera-relative space or transform the derived head rotation by the avatar’s root rotation so the head matches the oriented character.

## Optional audio

The app can export a separate audio file (e.g. `.audio.mp3`) with the same base name. There is no timing metadata in the JSON; sync by aligning start of audio and `t = 0` of the animation.

## Summary for an AI / implementer

- **JSON**: `version`, `fps`, `names` (52 ARKit names), `frames` (v1–v3: objects with `t`, `values`, optional `faceMatrix`; v4: one numeric array per frame as above).
- **Playback**: Advance time by delta; sample `values` and optional `faceMatrix` by interpolating between bracketing frames.
- **Use**: `names[i]` → your character’s blend shape; `faceMatrix` → head bone transform (or extract rotation/position for your rig).
- **Orientation**: Y-up; rotate avatar root (e.g. 180° Y) so the character faces the camera; apply head pose in camera-relative space or transform by that root rotation.
