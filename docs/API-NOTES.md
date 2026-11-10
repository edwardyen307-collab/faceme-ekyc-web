# FaceMe eKYC – field list (short)

Brief summary of the fields this app uses. The vendor documents themselves are confidential and are
not part of this repository; ask your FaceMe contact for them.

## Auth headers
- `Authorization`: eKYC Console access token (no `Bearer`). From Console › System Settings › Access Token & Web Demo (the `token=` value of the sample-code link).
- `platform-auth` (platform APIs): per-case token. Create Request returns `platformToken`; the app can use it automatically (inferred mapping – not stated verbatim).

## Console endpoints
| Endpoint | Request | Response (used fields) |
|---|---|---|
| `POST /api/request/` (urlencoded) | `requestTemplateUuid` | `requestUuid`, `platformToken`, `ekycToken` |
| `POST /api/platform/ekyc/face/spoofingcheck` | `img_stg1_act_1` ×N, `detail` JSON `{cameraInfo, stg1_act_1:{still,…}}`, `features` JSON `{enableStrictMode, enableDeepfakeDetect}` (opt.) | `result` liveness/spoofing, `livenessScore`, `clearImageIndex` (liveness only), `deepfakeDetectStatus` real/fake/"", `deepfakeDetectConfidence` |
| `POST /api/platform/ekyc/idcard/ocr` | `type`, `idCardImage` ×N (≥3 recommended), `imageDeskewed` (opt.), `enableBase64Encoding` (opt.) | `result` ok/needMoreImage + info fields (may also be a flat info object) |
| `POST /api/platform/ekyc/face/compare-boost/idcard` | `image1` (ID), `image2` (face), `image1Info`/`image2Info`, `multipleFacePriority1/2` (Not Allowed/Largest/Rightmost/Leftmost), `enableAutoRotate` (all opt.) | `thresholds.idcard`, `isMatch`, `similarity`, `faceInfo`, `face2Info`, `rotatedImage1/2` |
| `POST /api/platform/ekyc/idcard/forgery/requirement` (urlencoded) | `type` | `imageCounts{front, rightSide, full}` |
| `POST /api/platform/ekyc/idcard/forgery` (optional, TW ID front/back) | `type`, `idCardImage` ×N, `idCardDirections` ×N (front/rightSide), `idCardFullImage` ×N (opt.), `imageDeskewed` | `result` real/forgery/unknown, `realScore`, `rejectReason` |

Notes
- `detail` should come from the FaceMe Web SDK; `enableStrictMode` only works with the SDK (web component). The own engine sends a best-effort `detail` (still index 1-based by default, switchable).
- Errors: HTTP status + English message text (no fixed JSON field), mapped to Chinese in `js/upload.js`.

## OCR `type` and info fields
- `TW_ID_CARD_FRONT`: fullName, sex, dateOfBirth, dateOfIssue, parsedDate/Location/TypeFromDateOfIssue, identityNumber
- `TW_ID_CARD_BACK`: Father, Mother, Spouse, militaryService, placeOfBirth, address, serialNumber, barCode
- `TW_ARC_FRONT`: UI_No., name, dateOfBirth, purposeOfResidence, type · `TW_ARC_BACK`: MRZ lines, mrzExtracted*, barCode, serialBarCode, serialNumber
- `TW_HEALTHCARE_CARD_FRONT`: fullName, dateOfBirth, identityNumber, serialNumber
- `TW_DRIVER_LICENSE_FRONT`: identityNumber, fullName, sex, dateOfBirth, bloodType, address, expirationDate, issuanceDate, inspectionDate, type, …
- `TW_DRIVER_LICENSE_BACK`: printSerial, addedCondition, addressChange, inspection, note
- `PASSPORT`: MRZ lines, mrzExtracted*
- `TW_CAR_REGISTRATION` / `TW_MOTORCYCLE_REGISTRATION`: vrcarfront* / vrmobilefront*

## Web SDK (files not in repo)
- Load `sdk/faceme-web-sdk.js` async → `window.facemeAsyncInit`.
- `FaceMe.init(ok, fail, {path})`, `FaceMe.initIDCard(ok, fail, {path})`; models in `sdk/res` (`.fmin` → application/octet-stream, HTTPS).
- `FaceMe.startIDCardCapture({sdkBlockId, hintBlockId, captureMode:'IDCard', idCardStep, enableIdcardAS}, ok(images, fullScreenImage, snapshotScores, maResult), fail)`
  – idCardStep: front, back, nhi_front, driver_license_front/back, arc_front/back, passport_front, front_right, back_right, front_g.
- `FaceMe.startAntiSpoofing({sdkBlockId, hintBlockId}, {antiSpoofingType:'SINGLE_STAGE'}, ok(detail, spoofingcheckImages, clearImage), fail)`.
- `stopIDCardCapture()`, `stopAntiSpoofing()`, `release()`; errors `{code, message}` (100–105 params/init, 300–303 camera, 400 timeout, 404 model missing, 500).
