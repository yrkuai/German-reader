# 計畫：用 GitHub Secret Gist 自動同步電腦和手機的文章

## Context

文章目前只存在各裝置瀏覽器的 localStorage（`gr:articles`，見 `js/storage.js`），電腦和手機互相看不到。
PLAN.md 當初決定「不需要共用」，現在改為需要同步。

需求：
- 免費。
- 盡量自動，手動操作越少越好。

已決定：
- 資料存在 GitHub **Secret Gist**。
- 手機用**掃電腦上的 QR code** 完成設定。

完成後只有兩個一次性的手動步驟：
1. 電腦上建立 token 並貼上。
2. 手機掃 QR code。

之後新增、翻譯、刪除文章和閱讀進度都會自動同步。

**沒有設定同步時（`gr:sync` 沒有 token），同步程式完全不動作，也不發出任何網路請求**；兩台裝置照現在的方式各自使用。

## 使用者流程

1. **電腦**
   - 打開設定 →「同步」區塊 → 點「建立 GitHub 金鑰」。
     - 會開啟 `https://github.com/settings/tokens/new?scopes=gist&description=German%20Reader`，權限已預先勾好，只需要按「Generate」。
   - 把 token 貼回 App。
   - App 先用 `GET /gists` 找有沒有 `german-reader-sync.json`。
     - 找到就沿用。
     - 沒有就自動建立 secret gist，並上傳本機文章。
2. **手機**
   - 設定頁顯示 QR code，內容是 `https://yrkuai.github.io/German-reader/#/pair/<編碼後的 token+gistId>`。
   - 手機相機掃描後自動完成配對，並拉下文章。
   - 資料放在 `#` 後面，不會送到伺服器。配對完成後用 `history.replaceState` 把 token 從網址列移除。
   - **iPhone 例外**：相機會用 Safari 開啟，而 Safari 和主畫面 App 的儲存是分開的。
     - 配對頁要顯示「複製配對碼」按鈕。
     - 主畫面 App 的設定頁有「從剪貼簿貼上配對碼」，沿用 `js/ui/translate.js:66-83` 的 `navigator.clipboard.readText()` 寫法。
     - Android 的 PWA 和 Chrome 共用儲存，掃了就好。
     - iPhone 在 Safari 分頁（不是主畫面 App）打開配對連結時，只顯示「複製配對碼」和操作步驟，**不在 Safari 存 token**，避免 Safari 變成第三個同步裝置。
3. **之後全部自動**。
   - 觸發同步的時機：
     - 開啟 App。
     - 切回 App（`visibilitychange` → visible）。
     - 恢復網路（`online`）。
     - 本機有修改後 3 秒（防抖）；只有閱讀進度變動時等 15 秒，播放時不用每句都上傳。
     - 離開或切走 App（visibility hidden，用 `fetch` 的 `keepalive` 送出）。

## 資料設計

### Gist 檔案

一個 Gist 檔案 `german-reader-sync.json`：

```json
{ "v": 1, "articles": [...], "deleted": { "<id>": <刪除時間> } }
```

### 文章新增兩個時間欄位（`js/storage.js`）

- `updatedAt`：內容（標題、句子、翻譯）變動的時間。
  - `saveArticle` 時設定。
  - `createArticle` 時等於 `createdAt`。
- `readAt`：閱讀進度變動的時間。
  - `setLastIndex` 時只更新 `readAt`，不動 `updatedAt`。
  - 這樣在手機上閱讀，不會蓋掉電腦上剛匯入的翻譯。
- 舊文章缺少這兩個欄位時，用 `createdAt` 當預設值。

### 刪除紀錄

新增 localStorage 鍵 `gr:deleted`，內容是 `{id: 時間}`。
- `deleteArticle` 時寫入。
- 用「復原」按鈕重新 `saveArticle` 時移除該筆，並更新 `updatedAt`。
- 超過 90 天的紀錄清掉。

### 合併規則（純函式，可單元測試）

`mergeData(local, remote) → { data, changedLocal, changedRemote }`

- 以文章 `id` 為單位合併。
- 內容（`title`、`sentences`）取 `updatedAt` 較新的一方。
- `lastIndex` 取 `readAt` 較新的一方。
- 刪除紀錄的時間 ≥ 文章 `updatedAt` 時，那篇文章就刪除。
- 兩邊的刪除紀錄聯集，同一個 id 取較新的時間。

### 同步本機設定

`gr:sync` 存 `{ token, gistId, lastSyncAt }`。
- 不跟著 Gist 同步。
- 一般設定（語音、字級等）各裝置保留自己的，不同步。

## 要修改的檔案

| 檔案 | 改動 |
|---|---|
| `js/storage.js` | 寫入 `updatedAt` 和 `readAt`；處理 `gr:deleted`；新增 `onArticlesChanged(cb)` 通知，在本機寫入後觸發防抖同步；匯出 `loadSync`/`saveSync`；新增 `replaceAll(articles, deleted)`，讓同步一次寫回 |
| `js/sync.js`（新增） | 見下方說明 |
| `js/app.js` | 新增路由 `#/pair/<code>`；啟動時呼叫 `startSync()`；同步後如果本機資料有變，而且目前在文章列表頁，就重新 `route()`。閱讀頁不打斷，只默默更新資料 |
| `js/ui/settings.js` | 新增「同步」區塊（排在「外觀」上方），內容依狀態而定（見下方） |
| `js/vendor/qrcode.js`（新增） | 放入 MIT 授權的 `qrcode-generator`（Kazuhiko Arase），約 20KB，轉成 ES module，輸出 SVG |
| `sw.js` | `APP_FILES` 加上 `js/sync.js`、`js/vendor/qrcode.js`；`CACHE` 從 `gr-v42` 改成 `gr-v43` |
| `tests/sync.test.js`（新增） | 測試 `mergeData` 的情境 |
| `README.md`、`PLAN.md` | 改寫「文章只存在瀏覽器、不上傳」的說明，補上同步設定步驟 |

### `js/sync.js` 的內容

- `mergeData`。
- `findOrCreateGist(token)`。
- `pull()`：`GET /gists/{id}`。如果檔案的 `truncated` 為 true，改抓 `raw_url`。
- `push(data)`：`PATCH /gists/{id}`。只有合併結果和遠端不同時才送出。
- `syncNow()`：pull → merge → 寫回本機 → 需要時 push。同時防止多個同步重疊執行。
- `startSync(onLocalChanged)`：註冊所有觸發同步的事件。
- `encodePairCode` / `decodePairCode`。
- 錯誤處理：
  - 401：token 失效，在設定頁提示重新設定。
  - 離線：不顯示錯誤，等 `online` 事件再同步。

### 設定頁「同步」區塊的三種狀態

- **未設定**：「建立 GitHub 金鑰」連結、token 輸入框、「從剪貼簿貼上配對碼」。
- **已設定**：
  - 上次同步時間。
  - 「立即同步」按鈕，同一行靠右是「⋯」選單，選單裡有：
    - 「配對裝置」：打開置中彈窗顯示 QR code，右上角 × 關閉（點遮罩、按 Esc 也可以）。提醒 QR code 裡含有金鑰，不要截圖分享。
    - 「複製配對碼」：複製後用提示訊息回饋。給沒辦法掃 QR code 的情況（兩台電腦、相機掃不到）。
    - 分隔線，再來是紅字的「停止同步」：只清掉 `gr:sync`，本機文章保留；提示訊息 5 秒內可以「復原」。
- **錯誤**：顯示原因。

沿用現有元件：
- `h()`：`js/ui/dom.js`。
- 按鈕樣式：`.btn` 和 `.settings-section`。
- 錯誤或成功提示：`js/ui/toast.js`。

## 注意事項

- **Secret Gist 不是真正私密**，知道網址的人看得到。使用者已接受這一點。
- **token 只給 `gist` 權限。**
  - 同一個帳號底下的 `*.github.io` 網站共用 localStorage，所以其他 Pages 專案也讀得到這個 token。
  - 實作時確認 fine-grained token 是否支援 Gist 權限；不支援就用 classic token。
- **GitHub API 支援 CORS，`sw.js` 只攔截同網域的請求**，所以不會影響 API 呼叫。
- **兩台裝置剛好同時寫入**時，後寫的會蓋掉先寫的（Gist 不支援條件式更新）。
  - 因為每次都先拉再合併，實際風險很小。
- **iPhone 先在 Safari 配對、再加到主畫面時，資料會不會一起帶過去**，iOS 各版本行為不一，沒有驗證。所以保留剪貼簿配對碼的做法。

## 實作時的調整

- 同步區塊和配對頁放在新檔 `js/ui/sync.js`（`settings.js` 只引用），`sw.js` 一併列入。
- `js/vendor/qrcode.js` 直接使用 `qrcode-generator` 2.0.4 官方的 ES module 版（`dist/qrcode.mjs`），約 52KB。
- 設定頁「未設定」狀態只有一個輸入框，金鑰或配對碼都可以貼，自動判斷。
- 金鑰連結用 classic token（`scopes=gist`）。fine-grained token 是否支援 Gist 尚未確認。

## 驗證

0. **未設定同步時**：新增、翻譯、刪除、閱讀都和現在一樣，而且不會送出任何網路請求。
1. `npm test`：`tests/sync.test.js` 涵蓋以下情境：
   - 只有一邊新增文章。
   - 兩邊各改不同欄位（翻譯 vs 進度）。
   - 刪除後另一邊仍有舊版文章。
   - 「復原」刪除。
   - 舊文章沒有時間欄位。
   - 刪除紀錄過期清除。
2. `npm test` 的 `sw.test.js` 確認新檔案已列入 `APP_FILES`。
3. 用 `python -m http.server 8765` 在本機測試，以 Chrome 和 Edge（或兩個瀏覽器設定檔）模擬兩台裝置：
   - A 新增文章後，切到 B 時自動出現。
   - A 匯入翻譯、B 同時閱讀，兩邊的翻譯和進度都保留。
   - A 刪除後，B 也消失。
   - 離線時新增，恢復網路後自動上傳。
   - 確認 GitHub 上的 Gist 內容正確。
4. 部署後實機測試：
   - Android 掃 QR code。
   - iPhone 用 Safari 掃描 → 複製配對碼 → 在主畫面 App 貼上。
