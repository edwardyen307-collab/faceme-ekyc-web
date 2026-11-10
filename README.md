# eKYC · FaceMe 預覽（手機瀏覽器）

三步驟手機網頁：**① 自動拍證件 → ② 自動拍人臉 → ③ 確認／上傳**。iPhone Safari 為主要目標，Android Chrome 亦可。

- 線上預覽：https://edwardyen307-collab.github.io/faceme-ekyc-web/
- 版本：v2026-11-11c

## 功能
1. **證件**：後鏡頭，ID-1 證件框（85.6×54 mm 比例）。即時偵測證件四邊，條件全部符合才自動拍：證件填滿框（84–110%）、置中、轉正（傾斜 < 4.5°）、無大面積反光、清晰（Laplacian 變異數）、穩定 0.6 秒。即時提示：請把證件放進框內／再靠近一點／太近了／請把證件轉正／證件反光／畫面模糊／請拿穩／正在拍攝…
2. **人臉**：自拍鏡頭，橢圓框。條件：只有一張臉、在框內、大小合適、正臉（yaw／pitch／roll）、眼睛張開、沒有遮蔽（口罩、手、墨鏡；啟發式）、亮度與清晰度足夠、保持不動 ≥ 0.5 秒。即時提示：請把臉移進橢圓框／靠近一點／退後一點／臉偏左了請往右移／頭往左轉一點／稍微低頭／請把頭擺正／臉部被遮住／光線太暗／請保持不動…
3. **確認**：顯示最清晰的證件照與人臉照；「上傳」「重拍證件」「重拍人臉」。

v2026-11-11b 起：
- 首頁可選證件種類（OCR `type`，預設國民身分證正面）。
- 證件步驟保留最清晰的 3 張影格給 OCR。
- 自拍步驟保留 10–15 張人臉序列（≈10 fps），靜止幀索引給活體檢查使用。
- 實際上傳依序呼叫 spoofingcheck → ocr → compare，並把 needMoreImage、spoofing、400／403／503 轉成中文提示與重拍按鈕。

v2026-11-11c 起：
- `faceme` 引擎改為依 FaceMe Web SDK 文件實作（`facemeAsyncInit`、`init`／`initIDCard`、`startIDCardCapture`、`startAntiSpoofing` SINGLE_STAGE），SDK 產生的活體 `detail` 原樣送 Console。
- 可選「先建立 eKYC 案件」：呼叫 `/api/request/` 取得該案件的 platformToken 當 `platform-auth`。
- OCR 支援扁平回應並以中文欄位名顯示；比對顯示門檻；證件影像多臉時取最大（可關）。
- 錯誤訊息對照擴充（模糊、反光、裁切、口罩、多臉、權杖、授權、429 等）。
- `enableStrictMode` 只在 FaceMe SDK 引擎開放；自製引擎的 `still` 預設從 1 起算（可切換）；`cameraInfo` 改為相機名稱。

12 秒內沒有自動拍成會出現「手動拍照」備援按鈕。

## 隱私
- 照片只存在瀏覽器記憶體（Blob），不寫 localStorage／IndexedDB，關頁即消失。
- 預設 **模擬上傳**：不會傳出任何資料。
- 偵測全部在手機上跑；模型與 wasm 都放在本站（`vendor/`、`models/`），執行時不連 CDN。

## 偵測引擎（可替換）
`js/engines/index.js` 定義介面：`prepare()`、`captureIdCard(ctx)`、`captureFace(ctx)`、`cancel()`。
- `opensource`（預設）：證件＝自製邊緣投影四邊偵測（`js/card-detector.js`，無外部套件）；人臉＝MediaPipe Face Landmarker（Apache-2.0）＋品質規則（`js/face-checker.js`）。
- `faceme`：FaceMe Platform Web SDK 轉接（`js/engines/faceme-sdk.js`）。SDK（`FaceMeWebSDK_1.0.0.zip` 內的 `sdk/` 資料夾）由 FaceMe Platform Central 的 Developer 頁下載，不在此 repo（`sdk/`、`faceme-sdk/` 已 gitignore）。放到同網域後用 `?engine=faceme&sdk=./sdk/faceme-web-sdk.js`（模型預設在 `<sdk 目錄>/res`，可用 `&sdkRes=` 指定）。主機需 HTTPS，並把 `.fmin` 設為 `application/octet-stream`。行照類證件 SDK 無自動拍攝，會改用預設引擎。

## 實際上傳（FaceMe eKYC Console）
頁尾「進階設定（管理者）」→ 選「實際上傳」，填 Console 或代理網址；token 只存在記憶體（勾「記住」才存本機 localStorage），不進程式碼與網址。
依序呼叫：（選用）`/api/request/` 建立案件 → `face/spoofingcheck`（`img_stg1_act_1`×N、`detail`、`features`）→ `idcard/ocr`（`type`、`idCardImage`×3）→ `face/compare-boost/idcard`（`image1`、`image2`、`multipleFacePriority1`）。偽造檢查（`idcard/forgery`）需額外右側斜拍，尚未納入流程。欄位清單見 [docs/API-NOTES.md](docs/API-NOTES.md)。

**CORS**：手機頁在 github.io，Console 通常不允許跨網域，且 token 不該放手機。建議跑 `proxy/ekyc-proxy.mjs`（token 放伺服器環境變數、只放行 eKYC 路徑與指定 Origin），並以 HTTPS 對外；頁面設定填代理網址、token 欄留空。案件模式可設 `EKYC_TEMPLATE_UUID`，代理會固定範本並移除回應中的 ekycToken。

## 偵錯
網址加 `?debug=1` 會顯示即時數值；`?manualAfter=毫秒` 調整手動拍照按鈕出現時間。

## 測試
```
python tests/make_feeds.py /tmp/ekyc-feeds        # 產生假相機 y4m（合成人臉／假證件）
python -m http.server 8765 &
python tests/e2e.py http://localhost:8765/ /tmp/ekyc-feeds /tmp/ekyc-   # 假鏡頭：各步驟、提示、自動拍照、按鈕
python tests/e2e_fullflow.py http://localhost:8765/ /tmp/ekyc-         # 前後鏡頭不同影像的完整流程
node tests/mock_console.mjs & # 假 Console（:18790），可配合 proxy 測實際上傳
```

## 已知限制
- 證件偵測是啟發式：背景與證件顏色、亮度都很接近時可能找不到邊；強烈透視（斜拍）只以邊框斜率／長寬比粗略擋下。
- 遮蔽偵測是色彩規則（下半臉與臉頰色差、唇色、眼部亮度），對膚色相近的手遮嘴、透明面罩、瀏海等準確度有限；不是活體／防偽。
- 這不是 FaceMe 的活體檢測；Console 文件說明活體 `detail` 應由 FaceMe Web SDK 產生，自製引擎送出的 `detail` 只是最佳推測，正式環境建議用 `faceme` 引擎。
- iOS：需 HTTPS、Safari 14.3+；第一次要允許相機；前後鏡頭切換時 Safari 可能短暫黑畫面；人臉模型＋wasm 約 18 MB，首次載入需幾秒（在第 1 步背景預載）。
