import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import { handleSummarize } from '../workers-site/api/summarize.js';
import { handleGenerateSVA, handleValidateWavedrom } from '../workers-site/api/sva-generator.js';

// 導入靜態資源清單
function importManifest() {
  return {};
}

/**
 * 主 Worker 入口點
 * 處理靜態資源和 API 路由
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // API 路由處理
      if (pathname.startsWith('/api/')) {
        return handleApiRoute(pathname, request, env, ctx);
      }

      // 靜態資源處理（保留原有功能）
      return await handleStatic(request, env, ctx);
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error.message,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },
};

/**
 * 處理 API 路由
 */
async function handleApiRoute(pathname, request, env, ctx) {
  // CORS 預檢請求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // PDF 摘要 API
  if (pathname === '/api/summarize' && request.method === 'POST') {
    return handleSummarize(request, env, ctx);
  }

  // SVA 生成 API
  if (pathname === '/api/generate-sva' && request.method === 'POST') {
    return handleGenerateSVA(request, env, ctx);
  }

  // Wavedrom 驗證 API
  if (pathname === '/api/validate-wavedrom' && request.method === 'POST') {
    return handleValidateWavedrom(request, env, ctx);
  }

  // 健康檢查
  if (pathname === '/api/health' && request.method === 'GET') {
    return new Response(
      JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: ['pdf-summarizer', 'sva-generator']
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(
    JSON.stringify({ error: 'Not Found', message: `路由 ${pathname} 不存在` }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * 處理靜態資源（使用 Cloudflare KV）
 */
async function handleStatic(request, env, ctx) {
  try {
    return await getAssetFromKV(
      {
        request,
        waitUntil: ctx.waitUntil.bind(ctx),
      },
      {
        ASSET_NAMESPACE: env.__STATIC_CONTENT,
        ASSET_MANIFEST: importManifest(),
      }
    );
  } catch (error) {
    // 如果找不到靜態資源，返回 404
    return new Response('Not Found', { status: 404 });
  }
}
