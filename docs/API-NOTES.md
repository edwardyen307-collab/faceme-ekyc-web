# FaceMe API 對照筆記（v2026-11-11b）

> 原始文件：OneDrive（onedrive_faceme）`Documents/FaceMe Latest Release/01_GM/04_FM eKYC Console/FaceMe eKYC Console 6.8.1/Builds/document/FaceMe eKYC Console API Document.pdf`（第 6 版）。
> 本頁的 eKYC Console 欄位由「工作資料」機器人逐頁讀文件後確認（v2026-11-11b）。Grok Bot 這邊的 OneDrive 連線仍未登入，沒有直接開 PDF。
> 標示：**已確認**＝文件明寫；**未確認**＝文件沒寫清楚或還沒查到，程式先採保守做法。

## 共通（四支 API 都是）
- `POST`，`multipart/form-data`。**已確認**
- Header `Authorization`：Console 的 access token，**不加 `Bearer`**。**已確認**
  - token 取自 Console「System Settings > Access Token & Web Demo」。
- Header `platform-auth`：文件只寫「The authorization token」。**值從哪裡來：未確認**。前端設定為選填，proxy 用環境變數 `EKYC_PLATFORM_AUTH`。
- Console 內建範例頁：`https://<console>/samplecode/index.html?token=<access token>`。可用來對照實際請求與回應。注意 token 會出現在網址，只在內網或測試時用。
- 文件列出的錯誤（前端已轉成中文，見 `js/upload.js` `explainError`）：

| HTTP | 訊息 | 頁面顯示 |
|---|---|---|
| 400 | Can't find the ID card. | 找不到證件：請重拍證件…（出現「重拍證件」按鈕） |
| 403 | The license does not support TW ID Doc. | 授權不支援台灣證件（TW ID Doc），請聯絡管理者… |
| 503 | Please setup FaceMe Platform first. | FaceMe Platform 尚未設定完成，請管理者… |

錯誤 JSON 的欄位名（message 或 error）**未確認**，所以程式比對整段回應文字，對不到時再看 HTTP 狀態碼。

## 1. 人臉活體 `POST /api/platform/ekyc/face/spoofingcheck`：**已確認**
| 欄位 | 型別 | 本站送出 |
|---|---|---|
| `img_stg1_act_1` | Blob，可重複 | 自拍步驟最後約 1–1.5 秒的人臉序列，10–15 張（≈10 fps，裁切後最寬 720 px，JPEG），依時間順序 |
| `detail` | JSON 字串 | `{"cameraInfo": "<track label; facingMode; 寬x高@fps; UA>", "stg1_act_1": {"still": <靜止幀索引>}}` |
| `features` | JSON（選填） | `{"enableStrictMode": bool, "enableDeepfakeDetect": bool}`，兩個都沒勾就不送 |
| `precisionLevel` | 已棄用 | 不送 |

- 回應：`result` 是 `"liveness"` 或 `"spoofing"`，另有 `livenessScore`、`clearImageIndex`、`deepfakeDetectStatus`、`deepfakeDetectConfidence`。
- 未確認：`still` 從 0 還是 1 起算（本站用 0 起算，指向序列最後一張，也就是自動拍照那一幀）；建議的張數與 fps；`cameraInfo` 有沒有指定格式。

## 2. 證件 OCR `POST /api/platform/ekyc/idcard/ocr`：**已確認**
| 欄位 | 型別 | 本站送出 |
|---|---|---|
| `type` | String | 首頁下拉選單，預設 `TW_ID_CARD_FRONT`。可選值：TW_ID_CARD_FRONT/BACK、TW_ARC_FRONT/BACK、TW_HEALTHCARE_CARD_FRONT、TW_DRIVER_LICENSE_FRONT/BACK、PASSPORT、TW_CAR_REGISTRATION、TW_MOTORCYCLE_REGISTRATION |
| `idCardImage` | Blob，可重複（文件建議至少 3 張） | 自動拍照時，穩定期間通過全部檢查的影格中最清晰的 3 張（依 Laplacian 清晰度排序） |
| `imageDeskewed` | bool，選填，預設 false | 管理者勾選才送 `true` |
| `enableBase64Encoding` | 選填 | 不送 |

- 回應：`result` 是 `"ok"` 或 `"needMoreImage"`，另有 `info`（JSON）。收到 `needMoreImage` 時，頁面提示並顯示「重拍證件」。
- 未確認：`info` 內各欄位的名稱（頁面直接列出原始 JSON）。

## 3. 證件偽造 `POST /api/platform/ekyc/idcard/forgery`：**已確認，但不在預設流程**
- `type` 只接受 TW_ID_CARD_FRONT／TW_ID_CARD_BACK。
- `idCardImage` 可重複，至少 7 張（5 張 front＋2 張 rightSide）。
- `idCardDirections` 可重複，值為 `"front"` 或 `"rightSide"`，與影像一一對應。
- 選填：`idCardFullImage`、`imageDeskewed`。
- 回應：`result` 是 real、forgery 或 unknown，另有 `realScore`、`rejectReason`。
- 現況：`buildForgeryForm()` 已寫好，proxy 也已放行，但前端沒有呼叫。**TODO**：做一段「把證件往右側傾斜」的拍攝引導，收齊 5＋2 張後再啟用。

## 4. 比對 `POST /api/platform/ekyc/face/compare-boost/idcard`：**已確認**（與 11a 相同）
- 送出 `image1`＝證件（最清晰那張）、`image2`＝人臉（靜止幀，最寬 1280 px）。
- 回應有 `isMatch`、`similarity`。

## 實際上傳的順序
`spoofingcheck` → `ocr` → `compare`。三步都會執行，結果全部顯示在確認頁。任一步要求重拍時，頁面會出現對應的「重拍證件」或「重拍人臉」按鈕。

## Proxy（`proxy/ekyc-proxy.mjs`）
- multipart 內容原樣轉送，所以上面所有欄位都會帶到 Console，包括重複欄位。
- `Authorization` 與 `platform-auth` 一律改用伺服器端的環境變數，瀏覽器送來的會被忽略。
- 只放行這四個路徑，以及 `ALLOW_ORIGIN` 指定的網域。上限 30 MB。
