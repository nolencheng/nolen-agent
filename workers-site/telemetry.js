/**
 * Telemetry & Observability System for SVA Generator
 * Tracks: performance metrics, errors, usage patterns, system health
 */

/**
 * 性能指標收集器
 */
export class PerformanceMetrics {
  constructor(requestId) {
    this.requestId = requestId;
    this.startTime = performance.now();
    this.marks = {};
    this.measures = {};
  }

  /**
   * 標記時間點
   */
  mark(name) {
    this.marks[name] = performance.now();
  }

  /**
   * 測量時間段
   */
  measure(name, startMark, endMark) {
    const start = this.marks[startMark] || this.startTime;
    const end = this.marks[endMark] || performance.now();
    const duration = end - start;

    this.measures[name] = {
      duration,
      startTime: start - this.startTime,
      endTime: end - this.startTime
    };

    return duration;
  }

  /**
   * 獲取所有指標
   */
  getMetrics() {
    const totalDuration = performance.now() - this.startTime;

    return {
      requestId: this.requestId,
      totalDuration: Math.round(totalDuration * 100) / 100,
      marks: this.marks,
      measures: this.measures,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 獲取格式化的摘要
   */
  getSummary() {
    const metrics = this.getMetrics();
    const marks = Object.entries(metrics.marks)
      .map(([name, time]) => `${name}:${Math.round(time - this.startTime)}ms`)
      .join(', ');

    return `Total: ${metrics.totalDuration}ms | Marks: ${marks}`;
  }
}

/**
 * 錯誤追踪系統
 */
export class ErrorTracker {
  constructor(env = {}) {
    this.env = env;
    this.errors = [];
    this.sentryDsn = env.SENTRY_DSN || null;
  }

  /**
   * 追踪錯誤
   */
  trackError(error, context = {}) {
    const errorRecord = {
      id: generateErrorId(),
      timestamp: new Date().toISOString(),
      type: error.name || 'Error',
      message: error.message,
      stack: error.stack || 'No stack trace',
      context,
      severity: context.severity || 'error'
    };

    this.errors.push(errorRecord);

    // 發送到 Sentry（如果配置）
    if (this.sentryDsn) {
      this.sendToSentry(errorRecord);
    }

    return errorRecord.id;
  }

  /**
   * 發送錯誤到 Sentry
   */
  async sendToSentry(errorRecord) {
    try {
      const payload = {
        eventId: errorRecord.id,
        timestamp: errorRecord.timestamp,
        level: errorRecord.severity,
        exception: {
          values: [{
            type: errorRecord.type,
            value: errorRecord.message,
            stacktrace: {
              frames: parseStackTrace(errorRecord.stack)
            }
          }]
        },
        extra: errorRecord.context
      };

      // 發送到 Sentry（非同步，不阻塞）
      if (typeof fetch !== 'undefined') {
        fetch(this.sentryDsn, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {
          // Sentry 發送失敗，不影響主流程
        });
      }
    } catch (err) {
      // Sentry 集成失敗，忽略
    }
  }

  /**
   * 獲取最近的錯誤
   */
  getRecentErrors(limit = 10) {
    return this.errors.slice(-limit).reverse();
  }

  /**
   * 獲取錯誤統計
   */
  getErrorStats() {
    const stats = {
      total: this.errors.length,
      byType: {},
      bySeverity: {},
      recent24h: 0
    };

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const error of this.errors) {
      // 按類型計數
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;

      // 按嚴重程度計數
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;

      // 24 小時內的錯誤
      if (new Date(error.timestamp).getTime() > oneDayAgo) {
        stats.recent24h++;
      }
    }

    return stats;
  }
}

/**
 * 使用統計收集器
 */
export class UsageTracker {
  constructor(db = null) {
    this.db = db;
    this.sessionMetrics = {
      requestCount: 0,
      totalBytes: 0,
      endpointStats: {},
      errorCount: 0
    };
  }

  /**
   * 記錄 API 調用
   */
  async recordApiCall(endpoint, method, requestSize, responseSize, duration, statusCode, userId = null) {
    // 更新內存統計
    this.sessionMetrics.requestCount++;
    this.sessionMetrics.totalBytes += (requestSize + responseSize);

    if (!this.sessionMetrics.endpointStats[endpoint]) {
      this.sessionMetrics.endpointStats[endpoint] = {
        count: 0,
        totalTime: 0,
        avgTime: 0,
        errors: 0
      };
    }

    const stats = this.sessionMetrics.endpointStats[endpoint];
    stats.count++;
    stats.totalTime += duration;
    stats.avgTime = stats.totalTime / stats.count;

    if (statusCode >= 400) {
      stats.errors++;
      this.sessionMetrics.errorCount++;
    }

    // 保存到資料庫（如果可用）
    if (this.db) {
      try {
        const stmt = this.db.prepare(
          `INSERT INTO usage_stats (id, user_id, endpoint, request_size, response_size, execution_time_ms, status_code, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );

        stmt.bind(
          generateId(),
          userId,
          endpoint,
          requestSize,
          responseSize,
          Math.round(duration),
          statusCode,
          new Date().toISOString()
        ).run();
      } catch (err) {
        // 數據庫寫入失敗，不影響主流程
      }
    }
  }

  /**
   * 獲取會話統計
   */
  getSessionStats() {
    return {
      ...this.sessionMetrics,
      avgRequestSize: this.sessionMetrics.requestCount > 0
        ? Math.round(this.sessionMetrics.totalBytes / this.sessionMetrics.requestCount)
        : 0
    };
  }

  /**
   * 獲取端點統計
   */
  getEndpointStats(endpoint) {
    return this.sessionMetrics.endpointStats[endpoint] || null;
  }

  /**
   * 獲取健康狀態
   */
  getHealthStatus() {
    const stats = this.getSessionStats();
    const errorRate = stats.requestCount > 0
      ? (stats.errorCount / stats.requestCount) * 100
      : 0;

    return {
      status: errorRate < 5 ? 'healthy' : errorRate < 10 ? 'degraded' : 'unhealthy',
      errorRate: Math.round(errorRate * 100) / 100,
      requestCount: stats.requestCount,
      avgResponseTime: stats.endpointStats && Object.values(stats.endpointStats).length > 0
        ? Math.round(
            Object.values(stats.endpointStats).reduce((sum, s) => sum + s.avgTime, 0) /
            Object.values(stats.endpointStats).length
          )
        : 0
    };
  }
}

/**
 * 分析事件發射器
 */
export class AnalyticsEmitter {
  constructor(env = {}) {
    this.env = env;
    this.events = [];
    this.analyticsEngine = env.ANALYTICS_ENGINE || null;
  }

  /**
   * 發出分析事件
   */
  emit(eventType, data = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      type: eventType,
      data
    };

    this.events.push(event);

    // 發送到 Analytics Engine（如果可用）
    if (this.analyticsEngine && typeof fetch !== 'undefined') {
      this.sendToAnalyticsEngine(event);
    }

    return event;
  }

  /**
   * 發送事件到 Cloudflare Analytics Engine
   */
  async sendToAnalyticsEngine(event) {
    try {
      // Cloudflare Analytics Engine integration
      // This would be implemented with the actual Analytics Engine API
      // For now, we log the event for future integration
    } catch (err) {
      // 失敗不影響主流程
    }
  }

  /**
   * 發出 SVA 生成事件
   */
  emitSVAGeneration(signalCount, duration, success, errorCode = null) {
    return this.emit('sva_generation', {
      signalCount,
      duration: Math.round(duration),
      success,
      errorCode,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 發出使用者操作事件
   */
  emitUserAction(action, presetName = null, details = {}) {
    return this.emit('user_action', {
      action,
      presetName,
      details,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 獲取最近事件
   */
  getRecentEvents(limit = 100) {
    return this.events.slice(-limit);
  }
}

/**
 * 整合遙測系統
 */
export class TelemetrySystem {
  constructor(env = {}) {
    this.env = env;
    this.metrics = new PerformanceMetrics(generateRequestId());
    this.errorTracker = new ErrorTracker(env);
    this.usageTracker = new UsageTracker(env.DB || null);
    this.analytics = new AnalyticsEmitter(env);
  }

  /**
   * 創建請求上下文
   */
  createRequestContext(request) {
    return {
      requestId: this.metrics.requestId,
      method: request.method,
      url: request.url,
      userAgent: request.headers.get('User-Agent'),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 記錄請求完成
   */
  async recordRequest(endpoint, method, requestSize, responseSize, duration, statusCode, userId = null) {
    await this.usageTracker.recordApiCall(
      endpoint,
      method,
      requestSize,
      responseSize,
      duration,
      statusCode,
      userId
    );

    // 發出分析事件
    if (endpoint.includes('generate-sva')) {
      this.analytics.emitSVAGeneration(
        0, // signalCount would be extracted from context
        duration,
        statusCode < 400
      );
    }
  }

  /**
   * 獲取完整遙測報告
   */
  getReport() {
    return {
      metrics: this.metrics.getMetrics(),
      errorStats: this.errorTracker.getErrorStats(),
      usageStats: this.usageTracker.getSessionStats(),
      health: this.usageTracker.getHealthStatus(),
      recentErrors: this.errorTracker.getRecentErrors(5),
      recentEvents: this.analytics.getRecentEvents(10)
    };
  }
}

/**
 * 輔助函數：解析堆棧跟踪
 */
function parseStackTrace(stackString) {
  if (!stackString) return [];

  return stackString.split('\n')
    .filter(line => line.trim())
    .map(line => ({
      filename: 'worker',
      function: line.trim(),
      lineno: 0,
      colno: 0
    }));
}

/**
 * 輔助函數：生成錯誤 ID
 */
function generateErrorId() {
  return 'error_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 輔助函數：生成通用 ID
 */
function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 輔助函數：生成請求 ID
 */
function generateRequestId() {
  return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}
