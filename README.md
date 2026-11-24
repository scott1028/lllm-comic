# Large Image Spotter（大型圖片偵測）

一個 Chrome 擴充功能：照你訂的規則把網頁上的大圖框出來，還能把漫畫對白交給你自己的 LLM 翻譯，再把譯文貼回圖上。

## 它在做什麼

把它想成一個巡邏員：先照規則巡一遍頁面、把大圖圈起來；你開了翻譯，它就把圈到的圖拿去給翻譯員，翻好的對白貼回原位。

```text
頁面的 <img> / <canvas> ──比對規則──► 紅框 + 左上角標籤
被標示的圖 ──送出圖片──► 你的 LLM server ──回傳對白位置和譯文──► 翻譯圖層
```

只有被標示的圖才會送去翻譯，翻譯預設是關閉的。

> 開啟翻譯後，圖片會送到你填的 API URL（預設 `http://127.0.0.1:8888/v1`）。填的是遠端服務，就等於把圖片交給那個服務。

## 需要準備什麼

- Chrome（開發時用的是 Chrome 158）
- Node.js 和 pnpm（開發時用的是 Node 26.13.0、pnpm 11.0.8）
- 要翻譯的話：一個 OpenAI 相容、能讀圖片的 LLM server，要提供 `GET /models` 和 `POST /chat/completions`
- 要跑測試頁的話：Python 3（只用到內建的 `http.server`）

## 安裝

```bash
pnpm install
pnpm build
```

build 完會產生 `dist/`，接著到 Chrome：

1. 打開 `chrome://extensions`，開啟右上角的「開發人員模式」。
2. 按「載入未封裝項目」，選 `dist/` 資料夾。
3. 把擴充功能釘到工具列，點圖示就會打開設定面板（popup）。

## 先跑一次看看

`dev/test-page/` 是一頁放了各種情況的測試頁。它要用兩個 port 開，因為有幾項要測跨網域的圖片：

```bash
cd dev/test-page
python3 -m http.server 8000   # 另開一個終端機，在同一個資料夾跑 python3 -m http.server 8001
```

打開 `http://localhost:8000/`，符合規則的圖會出現紅框，左上角的標籤寫著檔案大小、原始尺寸和原圖倍率，例如 `863 KB · 1000×750 · 2.0x`。

測試頁上的預期結果是照舊的預設規則寫的。要對得上，先在 popup 把規則改成「任一符合」、檔案大小 ≥ 500 KB、寬度 ≥ 2000 px。每一項在測什麼，見指南的[用測試頁檢查](docs/guide.md#用測試頁檢查)。

## 規則怎麼訂

規則就是「哪種圖算大圖」。每條規則選一個指標、比較方向（≥ 或 ≤）和數值，再決定要全部符合還是任一符合。

| 指標 | 量的是什麼 | 單位 |
|---|---|---|
| 檔案大小 | 圖檔的大小 | KB |
| 寬度 / 高度 | 圖片的原始像素尺寸，不是畫面上顯示的大小 | px |
| 原圖倍率 | 原始寬度 ÷（顯示寬度 × 裝置像素比），也就是圖比實際需要的大幾倍 | x |

預設是「全部符合」：檔案大小 ≥ 200 KB、寬度 ≥ 800 px、高度 ≥ 600 px。`<canvas>` 沒有檔案，判斷時會略過檔案大小規則。

## 接上你的 LLM 做翻譯

在 popup 的「漫畫翻譯」區塊勾「啟用翻譯」，再填這幾欄：

| 欄位 | 預設 | 說明 |
|---|---|---|
| 目標語言 | `繁體中文` | 直接寫進 prompt |
| 文字大小 | 18 px | 譯文的最小字級，可選 12–36 px；框夠大時會自動放大到 28 px |
| API URL | `http://127.0.0.1:8888/v1` | 後面會接 `/models` 和 `/chat/completions` |
| API key | 空白 | 有填才會送 `Authorization: Bearer …` |
| 模型 | 空白 | 下拉清單來自 `GET /models`；按 ✕ 清空後就能看到全部選項 |
| 思考程度 | `none` | 送成 `reasoning_effort`；空白表示交給 server 決定 |

區塊最下面出現「已連線：N 個模型」，就表示 popup 連得到 server。

三件事一定要記得：

- 翻譯結果存在 `chrome.storage.local`，用圖片內容、模型、目標語言、思考程度當 key。改 prompt 或換 API URL，舊結果都不會失效。
- 一次只送一張圖。server 回 5xx、429、連不上或逾時，會在 5、10、20、40 秒後重試，之後每 60 秒再試一次。
- 跨網域的 `<canvas>` 讀不到像素，只能截分頁畫面來翻譯，所以分頁要在前景，而且 canvas 至少 90% 在畫面內。

## 開發與測試

| 指令 | 做什麼 |
|---|---|
| `pnpm test` | 用 Vitest 跑 `src/**/*.test.ts` |
| `pnpm type-check` | 用 `tsc --noEmit` 檢查型別 |
| `pnpm build` | build popup 和 service worker，再把 content script 另外打包成 IIFE，全部輸出到 `dist/` |

幾個容易踩的坑：

- 沒有 watch 模式。改完程式要重跑 `pnpm build`，到 `chrome://extensions` 按這個擴充功能的重新載入，再重新整理已經開著的頁面。舊頁面裡的 content script 發現擴充功能重新載入後，會自己停掉。
- 測試跑在 Node 裡，沒有 DOM 也沒有 canvas。想寫測試的邏輯，請寫成 `src/utils/` 底下的純函式。
- `*.tdd.test.ts` 是用 TDD 開發時留下的測試，Vitest 一樣會跑。

送給 LLM 的 prompt、怎麼看實際送出的 request、翻譯快取怎麼清，都寫在[指南](docs/guide.md)。

## 安全與權限

- API key 存在 `chrome.storage.local`，不會跟 Google 帳號同步；其他設定存在 `chrome.storage.sync`，會同步。
- `host_permissions` 是 `<all_urls>`，因為 service worker 要跨網域讀圖片的檔頭（查檔案大小）和內容（送去翻譯）。
- `declarativeNetRequestWithHostAccess` 只用在抓圖片和查檔案大小時，暫時幫那一個請求補上頁面網域的 `Referer`，讓有防盜連的圖站放行。

## 想知道更多

[docs/guide.md](docs/guide.md) 有這些內容：

- 名詞表
- 從掃描、查檔案大小到翻譯的完整流程
- 送給 LLM 的 prompt 和 request 欄位
- 圖片不見時，翻譯請求怎麼取消
- 翻譯圖層怎麼排字、怎麼避開重疊
- 測試頁每一項在測什麼、怎麼重新產生測試圖
- 除錯方法和已知限制

## 授權

目前沒有授權檔，`package.json` 標記為 `"private": true`。
