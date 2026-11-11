// Detection-engine registry. Every engine implements:
//   prepare(): Promise                    – preload models / SDK
//   captureIdCard(ctx): Promise<{image, frames[]}>
//   captureFace(ctx): Promise<{image, frames[], still?, cameraInfo?, detail?}>
//   cancel(): void
// ctx = { camera, stage, ui:{update(out, rectDisplay?)}, getGuide(), forceRef:{now}, cardType }
import { OpenSourceEngine } from './opensource.js?v=2026-11-11d';
import { FaceMeSdkEngine } from './faceme-sdk.js?v=2026-11-11d';

export function createEngine(kind, opts = {}) {
  if (kind === 'faceme') return new FaceMeSdkEngine({ ...opts, fallback: new OpenSourceEngine() });
  return new OpenSourceEngine();
}
