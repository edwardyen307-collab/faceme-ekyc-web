# eKYC · FaceMe 預覽（手機瀏覽器）

三步驟手機網頁：**① 自動拍證件 → ② 自動拍人臉 → ③ 確認／上傳**。iPhone Safari 為主要目標，Android Chrome 亦可。

- 線上預覽：https://edwardyen307-collab.github.io/faceme-ekyc-web/
- 版本：v2026-11-11e

## 功能
1. **證件**：後鏡頭，ID-1 證件框（85.6×54 mm 比例）。即時偵測證件四邊，條件全部符合才自動拍：證件填滿框（84–110%）、置中、轉正（傾斜 < 4.5°）、無大面積反光、清晰（Laplacian 變異數）、穩定 0.45 秒（多幀平滑）。即時提示：請把證件放進框內／再靠近一點／太近了／請把證件轉正／證件反光／畫面模糊／請拿穩／正在拍攝…
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
- 標頭加上台北富邦銀行 logo（取自富邦官網，存於 `assets/fubon-logo.png`）與「內部測試」標示；僅供內部同仁測試。
- 右上角「設定」按鈕在三個步驟都能開啟設定面板；變更立即套用並存在本機（Access Token、platform-auth 只放記憶體，不儲存）。修正設定面板勾選框在模擬模式被整組停用、點不動的問題。
- 證件穩定判斷放寬：以最近 5 幀的平均邊框位置判斷晃動（容許 4.5%），畫面差異只擋大幅移動，保持 0.45 秒即拍；單幀誤判有 0.3 秒緩衝；清晰度檢查保留。
- 證件防偽（僅國民身分證正／背面，設定中開啟）：拍完證件後引導加拍 5 張正面＋2 張右上斜拍（張數優先取自 Forgery Requirements API），上傳時呼叫 `idcard/forgery`（帶 `idCardDirections`），結果顯示在確認頁。
- 提示更醒目、更多樣：大字橫幅依狀態變色（紅＝問題、黃＝調整、綠＝保持／拍攝中），附方向箭頭與輕微動畫；拍照時支援的裝置會震動。

v2026-11-11d 起：
- 設定面板改成簡短中文（檢查項目／上傳方式／伺服器網址／存取金鑰）；技術選項收在「進階（技術人員）」。
- 提示穩定：不再輪換句子；新提示需持續約 0.45 秒才更換，每句至少顯示 1.5 秒（變成「保持不動／拍攝中」除外）；同時有多個問題時合併成一句（例：「請把手機靠近一點，並把證件轉正」）。
- 證件真偽辨識：5 張正面在一般拍攝時靜默收集（不顯示張數）；斜拍改用梯形斜框＋手機斜拍動畫與一句提示，偵測到斜角後靜默拍 2 張；確認頁的防偽影像收在可展開的細節中。斜角判斷：外觀長寬比明顯改變、邊框明顯傾斜，或與剛拍的正面影像差異夠大。
- 身分證只剩「身分證正面」「身分證兩面」。兩面：拍完正面後顯示翻面動畫與提示，若鏡頭仍看到同一面會提醒「還是正面喔」；正、背面都呼叫 OCR，開啟防偽時兩面各做一次。
- 確認頁新增「人證比對」：呼叫 `face/compare-boost/idcard`（image1＝證件、image2＝自拍），大字顯示「是同一人／不是同一人」與相似度、門檻。模擬模式明確標示「模擬結果：未實際比對」，不假造結果。完整上傳流程仍包含比對。
- 開啟「先建立案件」時，同一次流程（防偽張數查詢、上傳、人證比對）共用同一個案件。

v2026-11-11e 起（依實機測試修正）：
- 身分證背面拍不下來：原因是反光判斷用「接近白色像素比例」，淺色、低對比的背面整張都很亮，被誤判為反光而一直不拍。改為只把「比證件本身明顯更亮」的像素算反光，背面另用較寬鬆的邊框／清晰度門檻。
- 正反面判斷改用照片偵測：在證件右半部（倒拿時為左半部旋轉 180°）跑人臉模型，有臉＝正面、沒有臉＝背面；只在證件完整、清楚、穩定的影格投票，需連續多幀一致（正面：近 3 次中 2 次有臉；背面：連續 4 次沒臉），證件移出畫面（翻面）時重新計票。背面步驟拿正面會提示「這是正面，請翻到背面」，正面步驟拿背面會提示「這是背面，請翻到有照片的正面」，都不會拍。
- 斜拍改為幾何判斷：以四條邊框直線擬合出證件四邊形，必須右邊比左邊長 12% 以上（從右側拍）、角度偏離 90° 至少 6°、四角都在畫面內、擬合誤差小且清楚才拍；近似長方形（平放或只是轉動）不會通過。會提示「再斜一點」「方向反了」「斜太多了」「一角跑出畫面」等。
- 確認頁直接顯示斜拍照（標示「斜拍照」），其餘真偽辨識影像仍可展開查看。
- 自拍若明顯側臉，提示「偵測到側臉，請把臉往左／右轉，正面對鏡頭」。

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
右上角「設定」→ 選「實際上傳」，填 Console 或代理網址；token 只存在記憶體，不存 localStorage、不進程式碼與網址。
依序呼叫：（選用）`/api/request/` 建立案件 → `face/spoofingcheck`（`img_stg1_act_1`×N、`detail`、`features`）→ `idcard/ocr`（`type`、`idCardImage`×3）→ `face/compare-boost/idcard`（`image1`、`image2`、`multipleFacePriority1`）。開啟證件真偽辨識時再呼叫 `idcard/forgery`（`idCardImage`×7、`idCardDirections`）。欄位清單見 [docs/API-NOTES.md](docs/API-NOTES.md)。

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
