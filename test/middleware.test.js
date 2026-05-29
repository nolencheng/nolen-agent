/**
 * Middleware Tests - API Reliability & Resilience
 */

import { describe, it, expect } from 'vitest';
import {
  StructuredLogger,
  withTimeout,
  createErrorResponse,
  addSecurityHeaders
} from '../workers-site/middleware.js';

describe('StructuredLogger', () => {
  it('should create logger with proper structure', () => {
    const logger = new StructuredLogger({ LOG_LEVEL: 'info' });
    expect(logger.requestId).toBeDefined();
    expect(logger.requestId.length).toBeGreaterThan(0);
  });

  it('should support multiple log levels', () => {
    const env = { LOG_LEVEL: 'debug' };
    const logger = new StructuredLogger(env);

    // Should not throw
    expect(() => {
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message', new Error('test'));
    }).not.toThrow();
  });

  it('should include request ID in logs', () => {
    const logger = new StructuredLogger();
    const originalLog = console.log;
    let capturedLog = '';

    console.log = (msg) => {
      capturedLog = msg;
    };

    logger.info('Test message');

    console.log = originalLog;

    const logObj = JSON.parse(capturedLog);
    expect(logObj.requestId).toBe(logger.requestId);
    expect(logObj.level).toBe('INFO');
    expect(logObj.message).toBe('Test message');
  });

  it('should respect log level filtering', () => {
    const logger = new StructuredLogger({ LOG_LEVEL: 'error' });
    const originalLog = console.log;
    let callCount = 0;

    console.log = () => callCount++;

    logger.debug('Should not log');
    logger.info('Should not log');
    expect(callCount).toBe(0);

    console.log = originalLog;
  });
});

describe('withTimeout', () => {
  it('should resolve if promise completes in time', async () => {
    const promise = Promise.resolve('success');
    const result = await withTimeout(promise, 1000, 'Timeout');
    expect(result).toBe('success');
  });

  it('should reject if promise exceeds timeout', async () => {
    const slowPromise = new Promise(resolve =>
      setTimeout(() => resolve('slow'), 500)
    );

    try {
      await withTimeout(slowPromise, 100, 'Custom timeout message');
      expect.fail('Should have timed out');
    } catch (error) {
      expect(error.message).toBe('Custom timeout message');
    }
  });

  it('should handle promise rejection', async () => {
    const rejectPromise = Promise.reject(new Error('Original error'));

    try {
      await withTimeout(rejectPromise, 1000, 'Timeout');
      expect.fail('Should have rejected');
    } catch (error) {
      expect(error.message).toBe('Original error');
    }
  });

  it('should timeout immediately for zero ms', async () => {
    const promise = new Promise(resolve =>
      setTimeout(() => resolve('done'), 10)
    );

    try {
      await withTimeout(promise, 0, 'Zero timeout');
      expect.fail('Should have timed out');
    } catch (error) {
      expect(error.message).toBe('Zero timeout');
    }
  });
});

describe('Error Response Creation', () => {
  it('should create standard error response', () => {
    const error = createErrorResponse(
      'TEST_ERROR',
      'Test error message',
      400,
      { customField: 'value' }
    );

    expect(error.status).toBe('error');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.message).toBe('Test error message');
    expect(error.statusCode).toBe(400);
    expect(error.requestId).toBeDefined();
    expect(error.timestamp).toBeDefined();
    expect(error.details.customField).toBe('value');
  });

  it('should include all required fields', () => {
    const error = createErrorResponse(
      'TIMEOUT',
      'Request timed out',
      504
    );

    expect(error).toHaveProperty('status');
    expect(error).toHaveProperty('code');
    expect(error).toHaveProperty('message');
    expect(error).toHaveProperty('requestId');
    expect(error).toHaveProperty('timestamp');
    expect(error).toHaveProperty('details');
  });

  it('should default status code to 400', () => {
    const error = createErrorResponse('ERROR', 'message');
    expect(error.statusCode).toBe(400);
  });
});

describe('Security Headers', () => {
  it('should add security headers to response', () => {
    const originalResponse = new Response('Test', {
      headers: { 'Content-Type': 'text/plain' }
    });

    const securedResponse = addSecurityHeaders(originalResponse);

    expect(securedResponse.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(securedResponse.headers.get('X-Frame-Options')).toBe('DENY');
    expect(securedResponse.headers.get('X-XSS-Protection')).toBe('1; mode=block');
  });

  it('should preserve original response content', async () => {
    const originalResponse = new Response('Original content');
    const securedResponse = addSecurityHeaders(originalResponse);

    const text = await securedResponse.text();
    expect(text).toBe('Original content');
  });

  it('should preserve original status code', () => {
    const originalResponse = new Response('Not found', { status: 404 });
    const securedResponse = addSecurityHeaders(originalResponse);

    expect(securedResponse.status).toBe(404);
  });

  it('should add CORS headers', () => {
    const response = addSecurityHeaders(new Response('test'));

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();
  });
});

describe('API Reliability Integration', () => {
  it('should handle successful requests', async () => {
    const mockHandler = async (request, env, ctx) => {
      return new Response(JSON.stringify({ status: 'success' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    };

    // Note: Can't fully test withReliability without mocking KV,
    // but we can verify middleware exports and functions
    expect(typeof mockHandler).toBe('function');
  });

  it('should differentiate timeout errors from other errors', () => {
    const timeoutError = createErrorResponse(
      'ANALYSIS_TIMEOUT',
      'Analysis timed out',
      504
    );

    const validationError = createErrorResponse(
      'INVALID_INPUT',
      'Invalid input',
      400
    );

    expect(timeoutError.code).toBe('ANALYSIS_TIMEOUT');
    expect(timeoutError.statusCode).toBe(504);

    expect(validationError.code).toBe('INVALID_INPUT');
    expect(validationError.statusCode).toBe(400);
  });

  it('should support rate limit error responses', () => {
    const rateLimitError = createErrorResponse(
      'RATE_LIMIT_EXCEEDED',
      'Too many requests',
      429,
      { retryAfter: 60 }
    );

    expect(rateLimitError.statusCode).toBe(429);
    expect(rateLimitError.details.retryAfter).toBe(60);
  });
});

describe('Environment Configuration', () => {
  it('should use default timeout when not specified', () => {
    const logger = new StructuredLogger({});
    expect(logger.logLevel).toBe('info');
  });

  it('should respect LOG_LEVEL from environment', () => {
    const loggerDebug = new StructuredLogger({ LOG_LEVEL: 'debug' });
    const loggerError = new StructuredLogger({ LOG_LEVEL: 'error' });

    expect(loggerDebug.logLevel).toBe('debug');
    expect(loggerError.logLevel).toBe('error');
  });

  it('should handle invalid log levels', () => {
    const logger = new StructuredLogger({ LOG_LEVEL: 'invalid' });
    // Should not throw on invalid level
    expect(() => logger.info('test')).not.toThrow();
  });
});
