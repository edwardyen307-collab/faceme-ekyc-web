# Third-party components

| Component | Version | License | Files |
|---|---|---|---|
| MediaPipe Tasks Vision (`@mediapipe/tasks-vision`) | 1.2.2 | Apache-2.0 | `vendor/mediapipe/vision_bundle.mjs`, `vendor/mediapipe/wasm/vision_wasm_internal.{js,wasm}` |
| MediaPipe Face Landmarker model (`face_landmarker.task`, float16 v1) | 1 | Apache-2.0 | `models/face_landmarker.task` (from storage.googleapis.com/mediapipe-models) |

All files are served from this site; nothing is loaded from a CDN at runtime.
Test images in `tests/feeds/` are AI-generated synthetic people / a fake sample card, not real persons or documents.
