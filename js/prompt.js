// 產生貼給免費 ChatGPT / Claude 的翻譯指令（純邏輯）

export const BATCH_SIZE = 30;

// 回傳 [{ start, end }]，編號從 1 開始、包含 end
export function makeBatches(count, size = BATCH_SIZE) {
  const batches = [];
  for (let start = 1; start <= count; start += size) {
    batches.push({ start, end: Math.min(count, start + size - 1) });
  }
  return batches;
}

// 單字資料的格式（importer.js 依此解析）：
// - 名詞：{"t":"n","m":中文,"l":單數原形,"g":"der"|"die"|"das"|"pl","pl":複數形（無複數為 ""）}
// - 動詞：{"t":"v","m":中文,"l":原形}
// - 其他詞類：中文字串
export function buildPrompt(sentences, start = 1, end = sentences.length) {
  const lines = [];
  for (let n = start; n <= end; n++) lines.push(`${n}. ${sentences[n - 1].de}`);

  return `你是德語老師。以下是編號好的德文句子。請為每一句提供：
1. "zh"：自然的繁體中文翻譯（台灣用語）
2. "w"：句中「每一個」德文單字在這句話裡的資料
   - key 必須是單字在句子中原本的寫法（大小寫相同，不要改成原形）
   - 同一個字在句中出現兩次只要寫一次
   - 中文意思要簡短（5 個字以內為佳）
   - 名詞：寫成物件 {"t":"n","m":"中文意思","l":"單數原形","g":"der 或 die 或 das","pl":"複數形"}
     · 沒有複數的名詞，"pl" 寫空字串 ""
     · 只有複數的名詞（例如 Leute），"g" 寫 "pl"
   - 動詞：寫成物件 {"t":"v","m":"中文意思","l":"原形"}
     · 可分動詞的兩個部分都要寫，例如 "rufe": {"t":"v","m":"打電話","l":"anrufen"}、"an": {"t":"v","m":"(anrufen 的一部分)","l":"anrufen"}
   - 其他詞類：直接寫中文意思字串，例如 "und": "和"

只輸出 JSON，放在一個 \`\`\`json 程式碼區塊裡，不要任何其他說明文字。
句子編號 "n" 必須和下面的編號相同。格式範例：
[{"n":${start},"zh":"…","w":{"Ich":"我","kaufe":{"t":"v","m":"買","l":"kaufen"},"Dinge":{"t":"n","m":"東西","l":"Ding","g":"das","pl":"Dinge"}}}]

句子：
${lines.join('\n')}`;
}
