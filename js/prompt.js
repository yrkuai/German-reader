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

export function buildPrompt(sentences, start = 1, end = sentences.length) {
  const lines = [];
  for (let n = start; n <= end; n++) lines.push(`${n}. ${sentences[n - 1].de}`);

  return `你是德語老師。以下是編號好的德文句子。請為每一句提供：
1. "zh"：自然的繁體中文翻譯（台灣用語）
2. "w"：句中「每一個」德文單字在這句話裡的中文意思，簡短即可（5 個字以內為佳）
   - key 必須是單字在句子中原本的寫法（大小寫相同，不要改成原形）
   - 可分動詞的兩個部分都要註明原形，例如 "rufe": "打電話(anrufen)"、"an": "(anrufen 的一部分)"
   - 同一個字在句中出現兩次只要寫一次

只輸出 JSON，放在一個 \`\`\`json 程式碼區塊裡，不要任何其他說明文字。
句子編號 "n" 必須和下面的編號相同。格式：
[{"n":${start},"zh":"…","w":{"Ich":"我","rufe":"打電話(anrufen)"}}]

句子：
${lines.join('\n')}`;
}
