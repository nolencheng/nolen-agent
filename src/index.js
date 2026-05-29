import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import { handleSummarize } from '../workers-site/api/summarize.js';
import { handleGenerateSVA, handleValidateWavedrom } from '../workers-site/api/sva-generator.js';
import { handlePresetsAPI } from '../workers-site/api/presets.js';
import { withReliability, StructuredLogger, addSecurityHeaders } from '../workers-site/middleware.js';
import { TelemetrySystem } from '../workers-site/telemetry.js';

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
 * 使用遙測追蹤 API 響應
 */
async function recordTelemetry(handler, telemetry, endpoint, request, startTime, ctx) {
  try {
    const response = await handler();
    const duration = performance.now() - startTime;

    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(
        telemetry.recordRequest(
          endpoint,
          request.method,
          0, // requestSize approximated
          0, // responseSize approximated
          duration,
          response.status
        )
      );
    }

    return response;
  } catch (error) {
    telemetry.errorTracker.trackError(error, {
      endpoint,
      method: request.method,
      severity: error.name === 'TimeoutError' ? 'critical' : 'error'
    });
    throw error;
  }
}

/**
 * 處理 API 路由
 */
async function handleApiRoute(pathname, request, env, ctx) {
  const logger = new StructuredLogger(env);
  const telemetry = new TelemetrySystem(env);
  const startTime = performance.now();

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

  // Presets API（預設管理）
  if (pathname.startsWith('/api/presets')) {
    return recordTelemetry(
      async () => withReliability(
        async (req, e, c) => handlePresetsAPI(req, e, c, pathname),
        request,
        env,
        ctx,
        {
          timeout: 5000,
          enableRateLimit: true,
          logger
        }
      ).then(addSecurityHeaders),
      telemetry,
      pathname,
      request,
      startTime,
      ctx
    );
  }

  // SVA 生成 API - 帶超時和速率限制保護
  if (pathname === '/api/generate-sva' && request.method === 'POST') {
    return recordTelemetry(
      async () => withReliability(
        handleGenerateSVA,
        request,
        env,
        ctx,
        {
          timeout: parseInt(env.ANALYSIS_TIMEOUT || '30000'),
          enableRateLimit: true,
          logger
        }
      ).then(addSecurityHeaders),
      telemetry,
      pathname,
      request,
      startTime,
      ctx
    );
  }

  // Wavedrom 驗證 API - 帶速率限制保護
  if (pathname === '/api/validate-wavedrom' && request.method === 'POST') {
    return recordTelemetry(
      async () => withReliability(
        handleValidateWavedrom,
        request,
        env,
        ctx,
        {
          timeout: 5000,
          enableRateLimit: true,
          logger
        }
      ).then(addSecurityHeaders),
      telemetry,
      pathname,
      request,
      startTime,
      ctx
    );
  }

  // PDF 摘要 API (舊功能保留)
  if (pathname === '/api/summarize' && request.method === 'POST') {
    return recordTelemetry(
      async () => withReliability(
        handleSummarize,
        request,
        env,
        ctx,
        {
          timeout: 60000, // 60 秒用於 PDF 處理
          enableRateLimit: true,
          logger
        }
      ).then(addSecurityHeaders),
      telemetry,
      pathname,
      request,
      startTime,
      ctx
    );
  }

  // 健康檢查 (不受速率限制)
  if (pathname === '/api/health' && request.method === 'GET') {
    const response = new Response(
      JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: ['pdf-summarizer', 'sva-generator'],
        environment: env.ENVIRONMENT || 'development'
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return addSecurityHeaders(response);
  }

  return new Response(
    JSON.stringify({
      status: 'error',
      code: 'NOT_FOUND',
      message: `路由 ${pathname} 不存在`,
      timestamp: new Date().toISOString()
    }),
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
