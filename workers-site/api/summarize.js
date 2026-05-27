import { validateAndCleanText, analyzeText, extractMetadata, validateTextSize } from './pdf-extractor.js';
import { intelligentChunk, getChunkStats } from './chunker.js';

/**
 * 處理 POST /api/summarize 請求
 * Phase 1: 文本分塊（客户端負責 PDF 提取）
 *
 * 請求格式（JSON）：
 * {
 *   "text": "提取後的 PDF 文本",
 *   "fileName": "原始文件名",
 *   "metadata": { "title": "...", "author": "..." },
 *   "options": { "language": "zh", "summaryStyle": "outline" }
 * }
 */
export async function handleSummarize(request, env, ctx) {
  try {
    // 驗證請求方法
    if (request.method !== 'POST') {
      return errorResponse('Only POST method is supported', 405);
    }

    // 解析 JSON 請求體
    const payload = await request.json();
    const { text, fileName = '未命名文檔', metadata = {}, options = {} } = payload;

    // 驗證文本
    if (!text || typeof text !== 'string') {
      return errorResponse('Missing or invalid text field', 400);
    }

    if (text.trim().length === 0) {
      return errorResponse('Text cannot be empty', 400);
    }

    // 驗證文本大小
    const sizeValidation = validateTextSize(text);
    if (!sizeValidation.isValid) {
      return errorResponse(
        `Text is too large: ${sizeValidation.estimatedTokens} tokens, max ${sizeValidation.maxTokens}`,
        413
      );
    }

    // 解析選項
    const language = options.language || 'zh';
    const summaryStyle = options.summaryStyle || 'outline';

    // Phase 1：文本清理和分塊
    console.log(`[文本處理] 開始處理: ${fileName}`);

    // 步驟 1：清理文本
    const cleanedText = validateAndCleanText(text);
    console.log(`[文本清理] 完成`);

    // 步驟 2：分析文本
    const textAnalysis = analyzeText(cleanedText);
    console.log(
      `[文本分析] Token 數估算: ${textAnalysis.estimatedTokens}, 段落數: ${textAnalysis.totalParagraphs}`
    );

    // 步驟 3：智能分塊
    const chunks = intelligentChunk(cleanedText, language);
    const chunkStats = getChunkStats(chunks);
    console.log(
      `[分塊完成] ${chunkStats.totalChunks} 個塊，總 tokens: ${chunkStats.totalTokens}`
    );

    // 步驟 4：提取元數據
    const extractedMetadata = extractMetadata(metadata);

    // 步驟 5：準備響應（Phase 1 - 返回分塊結果）
    const response = {
      status: 'success',
      phase: 'Phase 1: Text Chunking',
      fileName,
      metadata: extractedMetadata,
      textAnalysis: {
        totalCharacters: textAnalysis.totalCharacters,
        totalParagraphs: textAnalysis.totalParagraphs,
        estimatedTokens: textAnalysis.estimatedTokens,
      },
      chunks: chunks.map(chunk => ({
        chunkNum: chunk.chunkNum,
        estimatedTokens: chunk.estimatedTokens,
        previewText: chunk.text.substring(0, 150) + '...', // 預覽文本
      })),
      chunkStats: chunkStats,
      readyForSummarization: true,
      message: 'Text successfully chunked. Ready for Phase 2: Claude API summarization.',
    };

    // 添加 CORS 標頭
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  } catch (error) {
    console.error('Error in handleSummarize:', error);

    // 特定錯誤處理
    if (error instanceof SyntaxError) {
      return errorResponse('Invalid JSON format', 400);
    }

    return errorResponse(`伺服器錯誤: ${error.message}`, 500);
  }
}

/**
 * 返回錯誤響應
 */
function errorResponse(message, status = 500) {
  return new Response(
    JSON.stringify({
      status: 'error',
      message: message,
    }),
    {
      status: status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
