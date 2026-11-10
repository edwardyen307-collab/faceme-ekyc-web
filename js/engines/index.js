// Detection-engine registry. Every engine implements:
//   prepare(): Promise            – preload models / SDK
//   captureIdCard(ctx): Promise<Blob>
//   captureFace(ctx): Promise<Blob>
//   cancel(): void
// ctx = { camera, stage, ui:{update(out, rectDisplay?, raw?)}, getGuide():DOMRect-like, forceRef:{now} }
import { OpenSourceEngine } from './opensource.js';
import { FaceMeSdkEngine } from './faceme-sdk.js';

export function createEngine(kind, opts = {}) {
  if (kind === 'faceme') return new FaceMeSdkEngine(opts);
  return new OpenSourceEngine();
}
