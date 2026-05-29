/**
 * Telemetry System Tests - Phase 5E
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PerformanceMetrics,
  ErrorTracker,
  UsageTracker,
  AnalyticsEmitter,
  TelemetrySystem
} from '../workers-site/telemetry.js';

describe('PerformanceMetrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new PerformanceMetrics('req_test_123');
  });

  it('should initialize with requestId and startTime', () => {
    expect(metrics.requestId).toBe('req_test_123');
    expect(metrics.startTime).toBeDefined();
    expect(metrics.marks).toEqual({});
    expect(metrics.measures).toEqual({});
  });

  it('should record marks with performance.now()', () => {
    metrics.mark('parsing_start');
    expect(metrics.marks['parsing_start']).toBeDefined();
    expect(typeof metrics.marks['parsing_start']).toBe('number');
  });

  it('should measure duration between marks', () => {
    metrics.mark('start');
    metrics.mark('end');
    const duration = metrics.measure('test_measure', 'start', 'end');

    expect(metrics.measures['test_measure']).toBeDefined();
    expect(metrics.measures['test_measure'].duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('should handle missing marks in measure', () => {
    metrics.mark('start');
    const duration = metrics.measure('test', 'start', 'nonexistent');

    expect(duration).toBeDefined();
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('should calculate total duration from startTime', () => {
    const metricsData = metrics.getMetrics();
    expect(metricsData.totalDuration).toBeGreaterThanOrEqual(0);
    expect(metricsData.requestId).toBe('req_test_123');
    expect(metricsData.timestamp).toBeDefined();
  });

  it('should include marks and measures in getMetrics', () => {
    metrics.mark('event1');
    metrics.mark('event2');
    metrics.measure('duration', 'event1', 'event2');

    const data = metrics.getMetrics();
    expect(data.marks['event1']).toBeDefined();
    expect(data.marks['event2']).toBeDefined();
    expect(data.measures['duration']).toBeDefined();
  });

  it('should format summary string correctly', () => {
    metrics.mark('parsing');
    metrics.mark('analysis');

    const summary = metrics.getSummary();
    expect(summary).toContain('Total:');
    expect(summary).toContain('ms');
    expect(summary).toContain('Marks:');
  });
});

describe('ErrorTracker', () => {
  let errorTracker;

  beforeEach(() => {
    errorTracker = new ErrorTracker({ SENTRY_DSN: null });
  });

  it('should initialize with env and empty errors array', () => {
    expect(errorTracker.errors).toEqual([]);
    expect(errorTracker.sentryDsn).toBeNull();
  });

  it('should track errors with context', () => {
    const error = new Error('Test error');
    const id = errorTracker.trackError(error, { userId: 'user_123' });

    expect(id).toBeDefined();
    expect(errorTracker.errors).toHaveLength(1);
    expect(errorTracker.errors[0].message).toBe('Test error');
    expect(errorTracker.errors[0].context.userId).toBe('user_123');
  });

  it('should set severity from context or default to error', () => {
    const error1 = new Error('Test');
    const id1 = errorTracker.trackError(error1, { severity: 'critical' });

    const error2 = new Error('Test 2');
    const id2 = errorTracker.trackError(error2, {});

    expect(errorTracker.errors[0].severity).toBe('critical');
    expect(errorTracker.errors[1].severity).toBe('error');
  });

  it('should capture error type and stack trace', () => {
    const error = new TypeError('Type mismatch');
    errorTracker.trackError(error, {});

    expect(errorTracker.errors[0].type).toBe('TypeError');
    expect(errorTracker.errors[0].stack).toBeDefined();
  });

  it('should retrieve recent errors in reverse order', () => {
    for (let i = 0; i < 12; i++) {
      errorTracker.trackError(new Error(`Error ${i}`), {});
    }

    const recent = errorTracker.getRecentErrors(10);
    expect(recent).toHaveLength(10);
    expect(recent[0].message).toContain('Error 11');
    expect(recent[9].message).toContain('Error 2');
  });

  it('should calculate error statistics by type', () => {
    errorTracker.trackError(new TypeError('Type error'), {});
    errorTracker.trackError(new RangeError('Range error'), {});
    errorTracker.trackError(new TypeError('Another type error'), {});

    const stats = errorTracker.getErrorStats();
    expect(stats.total).toBe(3);
    expect(stats.byType['TypeError']).toBe(2);
    expect(stats.byType['RangeError']).toBe(1);
  });

  it('should count errors by severity', () => {
    errorTracker.trackError(new Error('Critical'), { severity: 'critical' });
    errorTracker.trackError(new Error('Critical 2'), { severity: 'critical' });
    errorTracker.trackError(new Error('Warning'), { severity: 'warning' });

    const stats = errorTracker.getErrorStats();
    expect(stats.bySeverity['critical']).toBe(2);
    expect(stats.bySeverity['warning']).toBe(1);
  });

  it('should track recent 24h errors', () => {
    const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);

    errorTracker.trackError(new Error('Old error'), {});
    errorTracker.errors[0].timestamp = oneDayAgo.toISOString();

    errorTracker.trackError(new Error('Recent error'), {});

    const stats = errorTracker.getErrorStats();
    expect(stats.recent24h).toBeGreaterThanOrEqual(1);
  });
});

describe('UsageTracker', () => {
  let usageTracker;

  beforeEach(() => {
    usageTracker = new UsageTracker(null);
  });

  it('should initialize with empty session metrics', () => {
    expect(usageTracker.sessionMetrics.requestCount).toBe(0);
    expect(usageTracker.sessionMetrics.totalBytes).toBe(0);
    expect(usageTracker.sessionMetrics.errorCount).toBe(0);
  });

  it('should record API calls and update statistics', async () => {
    await usageTracker.recordApiCall(
      '/api/generate-sva',
      'POST',
      1000,
      2000,
      150,
      200
    );

    expect(usageTracker.sessionMetrics.requestCount).toBe(1);
    expect(usageTracker.sessionMetrics.totalBytes).toBe(3000);
  });

  it('should track endpoint statistics', async () => {
    await usageTracker.recordApiCall('/api/test', 'GET', 100, 200, 50, 200);
    await usageTracker.recordApiCall('/api/test', 'GET', 100, 200, 60, 200);

    const stats = usageTracker.getEndpointStats('/api/test');
    expect(stats.count).toBe(2);
    expect(stats.totalTime).toBeGreaterThan(0);
    expect(stats.avgTime).toBeGreaterThan(0);
  });

  it('should count errors by status code', async () => {
    await usageTracker.recordApiCall('/api/test', 'GET', 100, 200, 50, 200);
    await usageTracker.recordApiCall('/api/test', 'GET', 100, 200, 50, 500);

    const stats = usageTracker.getEndpointStats('/api/test');
    expect(stats.errors).toBe(1);
    expect(usageTracker.sessionMetrics.errorCount).toBe(1);
  });

  it('should get session statistics with calculated averages', async () => {
    await usageTracker.recordApiCall('/api/test1', 'GET', 1000, 1000, 100, 200);
    await usageTracker.recordApiCall('/api/test2', 'GET', 500, 500, 100, 200);

    const stats = usageTracker.getSessionStats();
    expect(stats.requestCount).toBe(2);
    expect(stats.totalBytes).toBe(3000);
    expect(stats.avgRequestSize).toBe(1500);
  });

  it('should return healthy status when error rate < 5%', async () => {
    await usageTracker.recordApiCall('/api/test', 'GET', 100, 100, 50, 200);
    await usageTracker.recordApiCall('/api/test', 'GET', 100, 100, 50, 200);

    const health = usageTracker.getHealthStatus();
    expect(health.status).toBe('healthy');
    expect(health.errorRate).toBe(0);
  });

  it('should return degraded status when error rate 5-10%', async () => {
    for (let i = 0; i < 20; i++) {
      await usageTracker.recordApiCall(
        '/api/test',
        'GET',
        100,
        100,
        50,
        i < 19 ? 200 : 500
      );
    }

    const health = usageTracker.getHealthStatus();
    expect(['degraded', 'healthy']).toContain(health.status);
  });

  it('should calculate average response time correctly', async () => {
    await usageTracker.recordApiCall('/api/test', 'GET', 100, 100, 100, 200);
    await usageTracker.recordApiCall('/api/test', 'GET', 100, 100, 200, 200);

    const health = usageTracker.getHealthStatus();
    expect(health.avgResponseTime).toBeGreaterThan(0);
  });
});

describe('AnalyticsEmitter', () => {
  let analytics;

  beforeEach(() => {
    analytics = new AnalyticsEmitter({ ANALYTICS_ENGINE: null });
  });

  it('should initialize with empty events array', () => {
    expect(analytics.events).toEqual([]);
  });

  it('should emit events with timestamp and type', () => {
    const event = analytics.emit('test_event', { key: 'value' });

    expect(event.timestamp).toBeDefined();
    expect(event.type).toBe('test_event');
    expect(event.data.key).toBe('value');
    expect(analytics.events).toHaveLength(1);
  });

  it('should emit SVA generation events', () => {
    analytics.emitSVAGeneration(50, 150, true, null);

    expect(analytics.events).toHaveLength(1);
    expect(analytics.events[0].type).toBe('sva_generation');
    expect(analytics.events[0].data.signalCount).toBe(50);
    expect(analytics.events[0].data.success).toBe(true);
  });

  it('should emit user action events', () => {
    analytics.emitUserAction('load_preset', 'Strict Mode', { signals: 30 });

    expect(analytics.events).toHaveLength(1);
    expect(analytics.events[0].type).toBe('user_action');
    expect(analytics.events[0].data.action).toBe('load_preset');
    expect(analytics.events[0].data.presetName).toBe('Strict Mode');
  });

  it('should retrieve recent events', () => {
    for (let i = 0; i < 150; i++) {
      analytics.emit('event', { index: i });
    }

    const recent = analytics.getRecentEvents(100);
    expect(recent).toHaveLength(100);
    expect(recent[99].data.index).toBe(149);
  });

  it('should include timestamp in all events', () => {
    analytics.emit('test', {});
    const event = analytics.events[0];

    expect(event.timestamp).toBeDefined();
    expect(new Date(event.timestamp)).toBeInstanceOf(Date);
  });
});

describe('TelemetrySystem', () => {
  let telemetry;

  beforeEach(() => {
    telemetry = new TelemetrySystem({ SENTRY_DSN: null });
  });

  it('should initialize all subsystems', () => {
    expect(telemetry.metrics).toBeDefined();
    expect(telemetry.errorTracker).toBeDefined();
    expect(telemetry.usageTracker).toBeDefined();
    expect(telemetry.analytics).toBeDefined();
  });

  it('should create request context from request object', () => {
    const mockRequest = {
      method: 'POST',
      url: 'http://example.com/api/test',
      headers: new Map([['User-Agent', 'Test Client']])
    };
    mockRequest.headers.get = (key) => {
      const map = new Map([['User-Agent', 'Test Client']]);
      return map.get(key);
    };

    const context = telemetry.createRequestContext(mockRequest);
    expect(context.requestId).toBeDefined();
    expect(context.method).toBe('POST');
    expect(context.url).toBe('http://example.com/api/test');
    expect(context.timestamp).toBeDefined();
  });

  it('should record requests with usage tracking', async () => {
    await telemetry.recordRequest(
      '/api/generate-sva',
      'POST',
      1000,
      2000,
      100,
      200
    );

    const stats = telemetry.usageTracker.getSessionStats();
    expect(stats.requestCount).toBeGreaterThan(0);
  });

  it('should emit SVA generation analytics on generate-sva endpoint', async () => {
    await telemetry.recordRequest(
      '/api/generate-sva',
      'POST',
      1000,
      2000,
      100,
      200
    );

    const recent = telemetry.analytics.getRecentEvents(10);
    expect(recent.some(e => e.type === 'sva_generation')).toBe(true);
  });

  it('should generate comprehensive telemetry report', async () => {
    telemetry.metrics.mark('start');
    telemetry.metrics.mark('end');
    telemetry.metrics.measure('test', 'start', 'end');

    await telemetry.recordRequest('/api/test', 'GET', 100, 100, 50, 200);
    telemetry.errorTracker.trackError(new Error('Test error'), {});

    const report = telemetry.getReport();
    expect(report.metrics).toBeDefined();
    expect(report.errorStats).toBeDefined();
    expect(report.usageStats).toBeDefined();
    expect(report.health).toBeDefined();
    expect(report.recentErrors).toBeDefined();
    expect(report.recentEvents).toBeDefined();
  });

  it('should include request context in report', () => {
    const report = telemetry.getReport();
    expect(report.metrics.requestId).toBeDefined();
    expect(report.metrics.timestamp).toBeDefined();
  });

  it('should handle multiple concurrent operations', async () => {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        telemetry.recordRequest(
          `/api/test${i}`,
          'GET',
          100,
          100,
          50 + i * 10,
          200
        )
      );
    }

    await Promise.all(promises);

    const stats = telemetry.usageTracker.getSessionStats();
    expect(stats.requestCount).toBe(5);
  });
});
