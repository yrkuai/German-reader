# German Reader

一句一句練習德語的個人網站：貼上德語文章，自動分句，單句重複播放、整篇播放、三段語速，並可透過免費的 ChatGPT / Claude 取得逐句繁體中文翻譯與單字意思。

- 網址：https://yrkuai.github.io/German-reader/
- 純前端（HTML + CSS + JavaScript），沒有後端，不需要任何付費服務
- 文章存在自己的瀏覽器（localStorage）；可選擇開啟同步，透過自己 GitHub 帳號的 Secret Gist 讓電腦和手機的文章自動同步（設定 → 同步）。不開啟就不會上傳任何資料
- 單字本：閱讀時點單字按 ☆ 標記，在單字本用閃卡練習（文章右上角的書籤圖示）；開啟同步時單字本也會同步
- 語音使用瀏覽器內建的 Web Speech API
- 支援加到手機主畫面與離線使用（PWA）

## 本機執行

```
python -m http.server 8765
```

然後打開 http://localhost:8765/

## 測試

```
npm test
```

## 更新網站時

修改或新增檔案後，記得：
1. 新增的 JS 或圖示檔要加進 `sw.js` 的 `APP_FILES`（`npm test` 會檢查）
2. 把 `sw.js` 的 `CACHE` 版本號加 1（例如 `gr-v1` → `gr-v2`），手機才會更新離線快取
