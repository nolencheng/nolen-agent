// 簡化的 PDF 文本提取模組
// 說明：由於 Cloudflare Workers 的限制，完整的 PDF 解析應在客户端進行
// 後端主要負責文本分塊和 Claude API 調用

/**
 * 驗證並清理文本（來自客户端的預提取文本）
 * @param {string} rawText - 原始文本
 * @returns {string} 清理後的文本
 */
export function validateAndCleanText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('輸入必須是有效的文本字符串');
  }

  return cleanText(rawText);
}

/**
 * 清理文本：移除過多空白、換行符，保留邏輯結構
 * @param {string} text - 原始文本
 * @returns {string} 清理後的文本
 */
function cleanText(text) {
  return text
    // 移除多個連續換行符，保留段落分隔
    .replace(/\n{3,}/g, '\n\n')
    // 移除行尾空白
    .replace(/[ \t]+$/gm, '')
    // 移除多個連續空格（保留單個空格和換行）
    .replace(/[ \t]{2,}/g, ' ')
    // 移除不可見字符（但保留換行符）
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * 按邏輯段落分割文本
 * @param {string} text - 文本
 * @returns {Array<{paragraphNum: number, text: string}>}
 */
export function splitIntoParagraphs(text) {
  return text
    .split(/\n\n+/)
    .filter(p => p.trim().length > 0)
    .map((text, index) => ({
      paragraphNum: index + 1,
      text: text.trim(),
    }));
}

/**
 * 分析文本的統計信息
 * @param {string} text - 文本
 * @returns {object} 統計信息
 */
export function analyzeText(text) {
  if (!text || typeof text !== 'string') {
    return {
      totalCharacters: 0,
      totalWords: 0,
      totalParagraphs: 0,
      totalSentences: 0,
      estimatedTokens: 0,
      averageWordLength: 0,
    };
  }

  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim()).length;
  const sentences = text.split(/[。！？\.\!\?]+/).filter(s => s.trim()).length;

  // 估算 token 數（粗略）
  // 中文：1.5 characters ≈ 1 token
  // 英文：4 characters ≈ 1 token
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const englishChars = text.replace(/[一-鿿]/g, '').length;
  const estimatedTokens = Math.ceil(chineseChars / 1.5 + englishChars / 4);

  return {
    totalCharacters: text.length,
    totalWords: words,
    totalParagraphs: paragraphs,
    totalSentences: sentences,
    estimatedTokens,
    averageWordLength: words > 0 ? Math.round((text.length / words) * 10) / 10 : 0,
  };
}

/**
 * 从 PDF 元数据提取信息（如可用）
 * @param {object} metadata - PDF 元数据对象
 * @returns {object} 提取的信息
 */
export function extractMetadata(metadata = {}) {
  return {
    title: metadata.title || metadata.Title || '未命名文档',
    author: metadata.author || metadata.Author || '未知',
    subject: metadata.subject || metadata.Subject || '',
    creator: metadata.creator || metadata.Creator || '',
    creationDate: metadata.CreationDate || '',
  };
}

/**
 * 驗證文本是否適合處理
 * @param {string} text - 文本
 * @param {number} maxTokens - 最大允許的 tokens（預設 1M，超過此值應拆分）
 * @returns {object} 驗證結果
 */
export function validateTextSize(text, maxTokens = 1000000) {
  const analysis = analyzeText(text);

  return {
    isValid: analysis.estimatedTokens <= maxTokens,
    estimatedTokens: analysis.estimatedTokens,
    maxTokens,
    warning:
      analysis.estimatedTokens > maxTokens
        ? `文本過大（${analysis.estimatedTokens} tokens），建議拆分為多個檔案處理`
        : null,
  };
}
