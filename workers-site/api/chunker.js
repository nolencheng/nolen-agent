/**
 * 文本分塊策略：
 * 1. 優先按段落分割（保留邏輯結構）
 * 2. 當單個段落超過 maxTokens 時，按句子進一步分割
 * 3. 估算 token 數基於語言特性
 */

/**
 * 粗略估算文本的 token 數
 * @param {string} text - 文本
 * @param {string} language - 語言類型 ('zh' 或 'en')
 * @returns {number} 估算的 token 數
 */
function estimateTokens(text, language = 'zh') {
  if (!text) return 0;

  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const englishChars = text.length - chineseChars;

  // 中文：1.5 characters ≈ 1 token
  // 英文：4 characters ≈ 1 token
  const chineseTokens = Math.ceil(chineseChars / 1.5);
  const englishTokens = Math.ceil(englishChars / 4);

  return chineseTokens + englishTokens;
}

/**
 * 將文本分割成句子
 * @param {string} text - 文本
 * @returns {Array<string>} 句子數組
 */
function splitIntoSentences(text) {
  // 中文句子分隔符
  const chineseSeparator = /([。！？\n]+)/;
  // 英文句子分隔符
  const englishSeparator = /([.!?\n]+\s*)/;

  // 按中文或英文分隔符分割
  let sentences = text.split(chineseSeparator);

  // 合併分隔符和文本
  const result = [];
  for (let i = 0; i < sentences.length; i++) {
    if (i % 2 === 0 && sentences[i].trim()) {
      result.push(sentences[i]);
    } else if (i % 2 === 1 && result.length > 0) {
      result[result.length - 1] += sentences[i];
    }
  }

  return result.filter(s => s.trim().length > 0);
}

/**
 * 主要分塊函數：將文本分割成多個塊，每個塊的 token 數不超過 maxTokens
 * @param {string} fullText - 完整文本
 * @param {number} maxTokens - 每個塊的最大 token 數（預設 8000）
 * @param {string} language - 語言類型（'zh' 或 'en'）
 * @returns {Array<{chunkNum: number, text: string, estimatedTokens: number}>}
 */
export function chunkText(fullText, maxTokens = 8000, language = 'zh') {
  if (!fullText || maxTokens <= 0) {
    throw new Error('輸入文本或 maxTokens 無效');
  }

  // 步驟 1：按段落分割
  const paragraphs = fullText
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // 步驟 2：將段落分組成塊
  const chunks = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph, language);

    // 如果單個段落就超過 maxTokens，進一步分割
    if (paragraphTokens > maxTokens) {
      // 先保存當前塊
      if (currentChunk) {
        chunks.push({
          text: currentChunk.trim(),
          estimatedTokens: currentTokens,
        });
        currentChunk = '';
        currentTokens = 0;
      }

      // 按句子分割超大段落
      const sentences = splitIntoSentences(paragraph);
      let subChunk = '';
      let subTokens = 0;

      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence, language);

        if (subTokens + sentenceTokens > maxTokens && subChunk) {
          chunks.push({
            text: subChunk.trim(),
            estimatedTokens: subTokens,
          });
          subChunk = sentence;
          subTokens = sentenceTokens;
        } else {
          subChunk += (subChunk ? ' ' : '') + sentence;
          subTokens += sentenceTokens;
        }
      }

      if (subChunk) {
        chunks.push({
          text: subChunk.trim(),
          estimatedTokens: subTokens,
        });
      }
    } else if (currentTokens + paragraphTokens > maxTokens && currentChunk) {
      // 當前塊加上新段落會超過限制，保存當前塊
      chunks.push({
        text: currentChunk.trim(),
        estimatedTokens: currentTokens,
      });
      currentChunk = paragraph;
      currentTokens = paragraphTokens;
    } else {
      // 將段落添加到當前塊
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      currentTokens += paragraphTokens;
    }
  }

  // 保存最後的塊
  if (currentChunk) {
    chunks.push({
      text: currentChunk.trim(),
      estimatedTokens: currentTokens,
    });
  }

  // 添加塊編號
  return chunks.map((chunk, index) => ({
    chunkNum: index + 1,
    text: chunk.text,
    estimatedTokens: chunk.estimatedTokens,
  }));
}

/**
 * 根據文本長度智能決定分塊策略
 * @param {string} fullText - 完整文本
 * @param {string} language - 語言類型
 * @returns {Array<object>} 分塊結果
 */
export function intelligentChunk(fullText, language = 'zh') {
  const totalTokens = estimateTokens(fullText, language);

  // 根據總大小決定每塊的大小
  let maxTokensPerChunk;
  if (totalTokens < 5000) {
    // 小文本，一個塊搞定
    maxTokensPerChunk = 10000;
  } else if (totalTokens < 20000) {
    // 中等文本，每塊 8000 tokens
    maxTokensPerChunk = 8000;
  } else {
    // 大文本，每塊 6000 tokens（為 Claude API 留更多空間）
    maxTokensPerChunk = 6000;
  }

  return chunkText(fullText, maxTokensPerChunk, language);
}

/**
 * 驗證分塊結果的完整性
 * @param {Array<object>} chunks - 分塊數組
 * @param {string} originalText - 原始文本
 * @returns {boolean} 是否完整
 */
export function validateChunks(chunks, originalText) {
  const reconstructed = chunks.map(c => c.text).join('\n\n');
  // 粗略驗證：檢查主要內容是否都在塊中
  return reconstructed.length >= originalText.length * 0.95;
}

/**
 * 生成分塊統計信息
 * @param {Array<object>} chunks - 分塊數組
 * @returns {object} 統計信息
 */
export function getChunkStats(chunks) {
  const totalTokens = chunks.reduce((sum, c) => sum + c.estimatedTokens, 0);
  const avgTokensPerChunk = Math.round(totalTokens / chunks.length);

  return {
    totalChunks: chunks.length,
    totalTokens,
    avgTokensPerChunk,
    minTokens: Math.min(...chunks.map(c => c.estimatedTokens)),
    maxTokens: Math.max(...chunks.map(c => c.estimatedTokens)),
  };
}
