# FaceMe API 對照筆記（v2026-11-11a）

> 原始文件在 OneDrive（onedrive_faceme）：`Documents/FaceMe Latest Release/01_GM/...`
> 本次製作時，Grok Bot 這邊的 OneDrive 連線未登入，**PDF 沒能直接下載閱讀**；以下內容來自「工作資料」機器人唯讀查閱後的摘錄（含頁碼）。標「已確認」＝文件摘錄有明寫；標「推測」＝程式先這樣寫，接正式環境前要對照 PDF 修正。

## 1. FaceMe Platform Web SDK（瀏覽器端）
資料夾：`02_FM Platform/FaceMe Platform 6.8.1/Ubuntu/document/FaceMeWebSDK/`
- FaceMe Platform Web SDK API Document.pdf、Web Sample Code Setup Guide.pdf、FAuth Web SDK Document.pdf
- 功能（pp.2, 4–10）：Face Detection、Anti-spoofing（活體）、ID Card Detection、ID Card Quality Check；可吃相機串流或選取影像。**已確認**
- 進入點：`window.facemesasyncinit`、`FaceMe.init`、`FaceMe.startAntispoofing`、`FaceMe.startIDCardCapture`。**已確認（名稱）**
- 參數、回呼、回傳影像格式：**未確認** → `js/engines/faceme-sdk.js` 內以 `TODO(SDK)` 標示。
- 範例包 `FaceMeWebSDK_1.0.0.zip` 只能從 FaceMe Platform Central 的 Developer 頁下載，OneDrive 上沒有。**已確認**
- 範例站台部署：Nginx 或 IIS。

## 2. FaceMe eKYC Console 6.8.1 API（後端）
資料夾：`04_FM eKYC Console/FaceMe eKYC Console 6.8.1/Builds/document/`（API Document 第 6 版、FaceMeEkycSampleCode.pdf）

| 用途 | 方法／路徑 | 內容格式 | 狀態 |
|---|---|---|---|
| 證件與人臉 1:1 比對 | `POST /api/platform/ekyc/face/compare-boost/idcard` | multipart/form-data：`image1`（證件）、`image2`（人臉）→ 回傳含 `isMatch`、`similarity` | **已確認**（pp.71–73） |
| 證件 OCR | `POST /api/platform/ekyc/idcard/ocr` | multipart 上傳證件圖 | 路徑**已確認**（p.49）；欄位名 `image` 為**推測** |
| 證件偽造檢查 | `/api/platform/ekyc/idcard/forgery` | — | 路徑**已確認**；方法／欄位**未確認**，前端未呼叫，proxy 已放行 |
| 人臉活體檢查 | `POST /api/platform/ekyc/face/spoofingcheck` | — | 路徑**已確認**（p.68）；欄位名 `image` 為**推測** |
| 建立 request | `POST /api/request/` | x-www-form-urlencoded：`requestTemplateUuid` | **已確認**（p.38）；本版未使用 |

認證：
- Access token 取自 Console「System Settings > Access Token & Web Demo」，放在 `Authorization` header（p.12）。**已確認**（是否需要 `Bearer ` 前綴：摘錄沒寫，程式**不加前綴**，與 Security Central 一致）
- 平台整合 API 另需 `platform-auth` header。**已確認有此 header**；值的來源**未確認**。

## 3. 前端實作對應
- `js/upload.js`：`ENDPOINTS` 常數、`uploadEkyc()`；比對預設開啟，OCR／活體為選項。
- 瀏覽器直連 Console 幾乎一定會被 CORS 擋，且 token 不應放手機 → 用 `proxy/ekyc-proxy.mjs`（token 放伺服器環境變數）。
