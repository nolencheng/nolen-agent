/**
 * Cloudflare Workers Middleware for API Reliability
 * Handles: timeout protection, rate limiting, error handling, logging
 */

/**
 * 結構化日誌記錄器
 */
export class StructuredLogger {
  constructor(env = {}) {
    this.env = env;
    this.requestId = crypto.randomUUID();
    this.logLevel = env.LOG_LEVEL || 'info';
  }

  _shouldLog(level) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[this.logLevel];
  }

  debug(message, metadata = {}) {
    if (this._shouldLog('debug')) {
      console.debug(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'DEBUG',
        requestId: this.requestId,
        message,
        ...metadata
      }));
    }
  }

  info(message, metadata = {}) {
    if (this._shouldLog('info')) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        requestId: this.requestId,
        message,
        ...metadata
      }));
    }
  }

  warn(message, metadata = {}) {
    if (this._shouldLog('warn')) {
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'WARN',
        requestId: this.requestId,
        message,
        ...metadata
      }));
    }
  }

  error(message, error, metadata = {}) {
    if (this._shouldLog('error')) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        requestId: this.requestId,
        message,
        error: error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : null,
        ...metadata
      }));
    }
  }
}

/**
 * 帶超時的 Promise 包裝
 */
export function withTimeout(promise, ms, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), ms)
    )
  ]);
}

/**
 * 速率限制檢查 (每 IP 每分鐘最多 N 個請求)
 */
export async function checkRateLimit(request, kv, env) {
  const maxRequests = parseInt(env.RATE_LIMIT_REQUESTS || '10');
  const windowMs = parseInt(env.RATE_LIMIT_WINDOW || '60000');

  // 獲取客戶端 IP (優先使用 CF-Connecting-IP，其次 X-Forwarded-For)
  const clientIp =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';

  if (clientIp === 'unknown') {
    // 開發環境，跳過限制
    return { allowed: true, remaining: maxRequests };
  }

  const key = `rate-limit:${clientIp}`;
  let current = null;

  try {
    const stored = await kv.get(key, 'json');
    current = stored || { count: 0, resetAt: Date.now() + windowMs };
  } catch (err) {
    // KV 失敗，允許請求通過（故障開啟）
    return { allowed: true, remaining: maxRequests };
  }

  const now = Date.now();

  // 檢查是否應重置計數器
  if (now > current.resetAt) {
    current = { count: 0, resetAt: now + windowMs };
  }

  // 檢查是否超過限制
  if (current.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfter: Math.ceil((current.resetAt - now) / 1000)
    };
  }

  // 增加計數並保存
  current.count++;
  try {
    await kv.put(key, JSON.stringify(current), {
      expirationTtl: Math.ceil(windowMs / 1000)
    });
  } catch (err) {
    // KV 寫入失敗，不影響請求
  }

  return {
    allowed: true,
    remaining: maxRequests - current.count,
    resetAt: current.resetAt
  };
}

/**
 * 標準化錯誤響應
 */
export function createErrorResponse(code, message, statusCode, details = {}) {
  return {
    status: 'error',
    code,
    message,
    requestId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    details,
    statusCode: statusCode || 400
  };
}

/**
 * 創建帶超時和速率限制的 API 處理器
 */
export async function withReliability(
  handler,
  request,
  env,
  context,
  options = {}
) {
  const {
    timeout = 30000,
    enableRateLimit = true,
    logger = null
  } = options;

  const log = logger || new StructuredLogger(env);

  log.info('API request received', {
    method: request.method,
    url: request.url,
    userAgent: request.headers.get('User-Agent')
  });

  // 檢查速率限制
  if (enableRateLimit && env.RATE_LIMIT_KV) {
    const rateLimitResult = await checkRateLimit(
      request,
      env.RATE_LIMIT_KV,
      env
    );

    if (!rateLimitResult.allowed) {
      log.warn('Rate limit exceeded', {
        ip: request.headers.get('CF-Connecting-IP'),
        retryAfter: rateLimitResult.retryAfter
      });

      return new Response(
        JSON.stringify(
          createErrorResponse(
            'RATE_LIMIT_EXCEEDED',
            'Too many requests. Please try again later.',
            429,
            { retryAfter: rateLimitResult.retryAfter }
          )
        ),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(rateLimitResult.retryAfter)
          }
        }
      );
    }
  }

  // 帶超時執行處理器
  try {
    const response = await withTimeout(
      handler(request, env, context),
      timeout,
      `Request timed out after ${timeout}ms`
    );

    log.info('API request completed', {
      status: response.status,
      size: response.headers.get('Content-Length') || 'unknown'
    });

    return response;
  } catch (error) {
    log.error('API request failed', error, {
      errorCode: error.code || 'UNKNOWN',
      errorMessage: error.message
    });

    // 區分不同的錯誤類型
    if (error.message.includes('timed out')) {
      return new Response(
        JSON.stringify(
          createErrorResponse(
            'ANALYSIS_TIMEOUT',
            `SVA analysis exceeded ${timeout}ms limit`,
            504,
            { timeout }
          )
        ),
        {
          status: 504,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (error.message.includes('JSON')) {
      return new Response(
        JSON.stringify(
          createErrorResponse(
            'INVALID_JSON',
            'Request body contains invalid JSON',
            400,
            { error: error.message }
          )
        ),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // 通用服務器錯誤
    return new Response(
      JSON.stringify(
        createErrorResponse(
          'INTERNAL_ERROR',
          'An unexpected error occurred',
          500,
          { errorMessage: error.message }
        )
      ),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * 添加安全標頭
 */
export function addSecurityHeaders(response) {
  const headers = new Headers(response.headers);

  // 安全標頭
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '1; mode=block');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // CORS (根據需要調整)
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
