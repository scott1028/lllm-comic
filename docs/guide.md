# Large Image Spotter 指南

[README](../README.md) 只帶你裝起來、跑一次。這份指南補上完整流程、送給 LLM 的內容、測試頁和除錯方法。

## 名詞表

| 名詞 | 白話解釋 |
|---|---|
| 標示 | 在圖片外圍畫紅框，左上角加一個標籤 |
| 規則 | 判斷哪些圖要標示的條件，在 popup 裡設定 |
| content script | 注入每個 http / https 頁面（包含 iframe）的腳本，負責掃描、標示、畫翻譯圖層 |
| service worker | 擴充功能的背景程式，負責跨網域查檔案大小、截圖和呼叫 LLM |
| 翻譯圖層 | 疊在圖片上方的透明 canvas，只畫白底、黑框和譯文 |
| 原圖倍率 | 原始寬度 ÷（顯示寬度 × `devicePixelRatio`） |
| tainted canvas | 畫過跨網域圖片的 canvas，瀏覽器不讓程式讀它的像素 |
| OpenAI 相容 API | 和 OpenAI 一樣提供 `/models`、`/chat/completions` 的 HTTP API，例如在本機跑模型的 server |

## 一張圖從掃描到翻譯

這段告訴你一張圖經過哪些角色，出問題時才知道要去哪裡找。

```text
時間 ───────────────────────────────────────────────────────►
content script | 掃描圖片　 | 比對規則　 | 送出翻譯　 | 畫翻譯圖層
service worker | 　　　　　 | 查檔案大小 | 抓圖縮圖　 |
LLM server     | 　　　　　 | 　　　　　 | 找對白翻譯 |
```

content script 只掃 `<img>` 和 `<canvas>`，看不見（寬或高為 0）的元素會略過。
頁面有變動、圖片載入完、捲動、CSS transition 或 animation 結束、視窗大小改變或切回分頁時，都會重新掃描，最多每 0.5 秒一次。
只有比對結果是「符合」、開啟了翻譯，而且至少有一部分在畫面內的圖，才會走到「送出翻譯」。

### 檔案大小從哪裡來

| 圖片來源 | 怎麼拿到檔案大小 |
|---|---|
| `data:` URL | 直接從字串長度算 |
| 同源圖片 | 讀頁面的 Resource Timing（`encodedBodySize`） |
| `blob:` URL | 在頁面裡讀出 blob 的大小 |
| 其他網址 | 交給 service worker：先送 `HEAD`，拿不到再送 `Range: bytes=0-0`；最多同時 6 個請求 |
| `<canvas>` | 沒有檔案，略過檔案大小規則 |

跨網域圖片除非 server 有送 `Timing-Allow-Origin`，否則 Resource Timing 拿到的是 0，所以會改問 service worker。

### 送去翻譯的是什麼

| 元素 | 送出的內容 |
|---|---|
| `<img>` | 圖片網址，由 service worker 去抓；`blob:` 網址只在該頁有效，所以改送圖片的 data URL |
| 同源 `<canvas>` | `toDataURL('image/jpeg', 0.92)` |
| tainted canvas | 分頁截圖，再裁出 canvas 可見的部分 |

canvas 還是單一顏色（還沒畫上內容）時不會送，大約每秒重新檢查一次。
tainted canvas 要等分頁在前景、canvas 至少 90% 可見才會截圖；在 iframe 裡的不支援。
Chrome 每秒大約只允許截圖 2 次，所以截圖之間至少隔 600 ms。

## 送給 LLM 的內容

翻譯時，service worker 會對 `{API URL}/chat/completions` 送一個 `POST`。system 訊息放完整指示，user 訊息放目標語言和圖片。

system prompt（`src/utils/translation.ts` 的 `getTranslationPrompt`，以預設目標語言展開）：

```text
You are a manga translator. Find every speech bubble, thought bubble and narration box in the image. Ignore sound effects and background text. For each one, return its bounding box and its text translated into 繁體中文. Respond with JSON only, no markdown: {"dialogues":[{"box":[x1,y1,x2,y2],"text":"original text","translation":"translated text"}]}. Box coordinates are integers from 0 to 1000, relative to the image width and height.
```

request body（`src/background/translate.ts`）：

```json
{
  "model": "",
  "temperature": 0,
  "reasoning_effort": "none",
  "chat_template_kwargs": { "enable_thinking": false },
  "messages": [
    { "role": "system", "content": "<上面的 system prompt>" },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Target language: 繁體中文" },
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
      ]
    }
  ]
}
```

幾個細節：

- 圖片送出前轉成 JPEG（quality 0.9），長邊超過 1600 px 才會等比縮小。
- 思考程度是 `none` 時，才會多送 `chat_template_kwargs`，給不認得 `reasoning_effort` 的 server（例如 Qwen 的 chat template）用；空白時兩個欄位都不送。
- 每個請求最多等 180 秒。回應外面包了 Markdown 的 json code fence 也能解析；框的座標只要有任一值大於 1000，就改當成像素座標。

## 快取、佇列和重試

翻譯結果存在 `chrome.storage.local`，key 的格式是：

```text
translation:<圖片內容的 SHA-256>:<模型>:<目標語言>:<思考程度>
```

快取不會自動清，而 `chrome.storage.local` 有 10 MB 上限（程式裡留了 TODO）。要清掉翻譯快取但保留 API key，在 service worker 的 DevTools console 跑：

```js
chrome.storage.local.get(null).then((items) =>
  chrome.storage.local.remove(Object.keys(items).filter((key) => key.startsWith('translation:'))),
);
```

service worker 一次只送一張圖，其他的排隊。輪到時會再查一次快取：同一張圖同時從兩個分頁送進來，第一個翻好後，第二個直接用結果，不會再呼叫 LLM。

失敗時怎麼處理，要看是哪種錯誤：

| 錯誤 | 標籤顯示 | 接下來 |
|---|---|---|
| 5xx、429、連不上、逾時 | 翻譯失敗，稍後重試 | 5、10、20、40 秒後重試，之後每 60 秒一次 |
| 其他 4xx（例如 key 錯、模型不存在） | 翻譯失敗 | 不重試，要改設定 |
| 模型沒回 JSON | 翻譯失敗 | 不重試 |

改 popup 設定時：目標語言、API URL、模型、思考程度、啟用翻譯、API key 任一個變了，頁面上的翻譯會全部清掉重新要（快取命中就不會真的呼叫 LLM）。只改文字大小的話，只會重畫翻譯圖層。

## 圖片不見或捲出畫面，翻譯請求會怎樣

圖片已經不在頁面上，或整張捲到畫面外，就沒必要讓 LLM 繼續翻它；就像客人走了，廚房會把還沒做的單撕掉，正在做的那道也喊停。

```text
content script
   │ 斷開這個請求的 port
   ▼
service worker
   ├─ 還在排隊：輪到時直接跳過，不呼叫 LLM
   └─ 已經送出：中斷對 LLM server 的 HTTP 連線
```

每個翻譯請求都有自己的 port（`chrome.runtime.connect` 開的連線），斷開它就是取消。
中斷連線之後，LLM server 會不會真的停下來，要看 server 的實作。

### 哪些情況會取消

| 情況 | 取消哪些請求 |
|---|---|
| 掃描時那張圖已經不在「符合」的名單裡，例如從頁面移除、`<img>` 換了 `src`、變成看不見（寬或高為 0） | 那張圖的 |
| 掃描時那張圖整張在畫面外，例如捲走了、翻到別頁；被 `overflow` 不是 `visible` 的外層元素裁掉的部分也算畫面外 | 那張圖的 |
| 關掉分頁，或分頁載入別的頁面 | 那個分頁的全部 |
| 關掉 popup 最上面的「啟用」 | 所有分頁的全部 |
| 改了上一節列的翻譯設定或 API key | 所有分頁的全部 |

### 三件事要知道

- 還有一部分在畫面內的圖照常翻。畫面外的圖不會先翻好，捲到才送出。
- 切到別的分頁不算捲出畫面，請求不會取消。
- 被取消的請求不算失敗：不會重試，也不會寫進快取。圖片回來時會重新送一次，從頭翻。

## 翻譯圖層怎麼排字

每段對白會先排好字，再決定白底放哪裡：

1. 排字區是框的四邊各內縮 10%。從 28 px 往下找放得下的最大字級，但不低於 popup 的「文字大小」；設定超過 28 時，一律用設定值。
2. 英數字整個單字不拆開，其他字（中日文、標點）逐字換行；句號、逗號、右括號這類收尾標點不會放在行首。到了最小字級還放不下，字就超出框。
3. 白底是譯文的寬高加上半個字級的留白，置中在框的中心，不受框大小限制。白底 96% 不透明，外圍一圈 2 px 黑框。
4. 白底互相重疊時，從最上面那塊開始，往下推到上一塊的下方，中間留 4 px。

## 用測試頁檢查

測試頁要用兩個 port 開，因為第 4、13 項要從 `127.0.0.1:8001` 載入跨網域圖片。content script 只跑在 http / https 頁面，直接用 `file://` 開不會有作用。

```bash
cd dev/test-page
python3 -m http.server 8000
python3 -m http.server 8001   # 在另一個終端機跑
```

頁面上的預期結果照舊的預設規則寫：任一符合、檔案大小 ≥ 500 KB、寬度 ≥ 2000 px。先在 popup 改成這樣再對照。第 10–13 項還要開啟翻譯、接上 LLM server，而且要捲到畫面內才會送出翻譯。

| 項目 | 測的情況 | 預期 |
|---|---|---|
| 1 | 4000×3000 PNG（41 KB），顯示成 400 px 寬 | 寬度規則命中，標示 |
| 2 | 1000×750 JPG（863 KB），同源 | 從 Resource Timing 拿到大小，標示 |
| 3 | 300×200 JPG（2 KB） | 不標示 |
| 4 | 1000×750 JPG（863 KB），跨網域 | service worker 用 `HEAD` 拿到大小，標示 |
| 5 | 1×1 的 `data:` URL GIF | 不標示 |
| 6 | 2 秒後才插入的圖 | 頁面變動後重新掃描，標示 |
| 7 | 2400×800 的 CSS 背景圖（30 KB） | 頁面寫「標示」，但目前程式不偵測 CSS 背景圖，所以不會標示 |
| 8 | 隱藏的 4000×3000 PNG | 不標示 |
| 9 | 1000×750 JPG（863 KB）的 `blob:` URL | 在頁面裡讀到大小，標示 |
| 10 | 2000×3000 日文對話泡泡圖 | 標示並翻譯 |
| 11 | 同源 canvas，放在 400 px 寬、`overflow: hidden` 的框裡 | 標示並翻譯，翻譯圖層在框的邊緣被裁掉 |
| 12 | 載入 3 秒後才畫上內容的 canvas | 立刻標示，畫上內容後才翻譯 |
| 13 | tainted canvas | 標示，用截圖翻譯；分頁要在前景 |
| 14 | 要捲到下面才載入的 JPG | 捲到之後標示 |

測試圖是 `dev/make-test-images.py` 產生的。要重新產生，需要 Pillow 和系統字型 `NotoSansCJK-Bold.ttc`（Pillow 在 Linux 上會到 `/usr/share/fonts` 找）：

```bash
python3 dev/make-test-images.py
```

## 除錯

| 想看什麼 | 去哪裡看 |
|---|---|
| 實際送給 LLM 的 request | `chrome://extensions` → 這個擴充功能卡片上的 service worker 連結 → DevTools 的 Network，找 `chat/completions` |
| 請求有沒有被取消 | 同一個 Network 分頁，被取消的 `chat/completions` 狀態顯示 `(canceled)`；排隊時就取消的不會送出，所以不會出現 |
| 翻譯失敗的原因 | 頁面的 DevTools console，訊息以 `[LIS] translation failed:` 開頭，每張圖只印第一次 |
| popup 的錯誤 | 在 popup 上按右鍵 →「檢查」 |

## 已知限制

- 只偵測 `<img>` 和 `<canvas>`，CSS 背景圖不會被標示。
- iframe 裡的 tainted canvas 無法翻譯，因為截圖時不知道 iframe 在分頁裡的位置。
- iframe 裡的圖只看它在 iframe 裡看不看得到；整個 iframe 捲出分頁畫面時，裡面的翻譯請求不會取消。
- 翻譯快取不會自動清，`chrome.storage.local` 有 10 MB 上限。
- 白底重疊時只會往下推，推出圖片底部的部分會被裁掉。
