/**
 * Presets API Handler for D1 Database
 * CRUD operations for SVA Generator presets
 */

import { StructuredLogger, createErrorResponse } from '../middleware.js';

/**
 * 處理預設 API 請求
 */
export async function handlePresetsAPI(request, env, ctx, pathname) {
  const logger = new StructuredLogger(env);
  const method = request.method;
  const pathParts = pathname.split('/').filter(Boolean); // /api/presets/[id]

  try {
    // GET /api/presets - 列出用戶的預設
    if (method === 'GET' && pathParts.length === 2) {
      return handleListPresets(request, env, logger);
    }

    // GET /api/presets/:id - 獲取單個預設
    if (method === 'GET' && pathParts.length === 3) {
      const presetId = pathParts[2];
      return handleGetPreset(presetId, env, logger);
    }

    // POST /api/presets - 創建新預設
    if (method === 'POST' && pathParts.length === 2) {
      return handleCreatePreset(request, env, logger);
    }

    // PUT /api/presets/:id - 更新預設
    if (method === 'PUT' && pathParts.length === 3) {
      const presetId = pathParts[2];
      return handleUpdatePreset(presetId, request, env, logger);
    }

    // DELETE /api/presets/:id - 刪除預設
    if (method === 'DELETE' && pathParts.length === 3) {
      const presetId = pathParts[2];
      return handleDeletePreset(presetId, env, logger);
    }

    // GET /api/presets/:id/versions - 列出預設版本
    if (method === 'GET' && pathParts.length === 4 && pathParts[3] === 'versions') {
      const presetId = pathParts[2];
      return handleGetVersions(presetId, env, logger);
    }

    // POST /api/presets/shared - 列出公開預設
    if (method === 'GET' && pathParts.length === 3 && pathParts[2] === 'shared') {
      return handleListSharedPresets(env, logger);
    }

    return new Response(
      JSON.stringify(createErrorResponse('NOT_FOUND', '端點不存在', 404)),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error('Preset API error', error);
    return new Response(
      JSON.stringify(createErrorResponse(
        'PRESET_ERROR',
        error.message,
        500
      )),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 列出用戶的預設
 */
async function handleListPresets(request, env, logger) {
  // 獲取用戶 ID (來自 Authorization header 或 session)
  const userId = extractUserId(request);

  if (!userId) {
    return new Response(
      JSON.stringify(createErrorResponse(
        'UNAUTHORIZED',
        '需要身份驗證',
        401
      )),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // 如果沒有 D1，返回空列表（localStorage fallback）
    if (!env.DB) {
      return new Response(
        JSON.stringify({
          status: 'success',
          presets: [],
          source: 'localStorage_fallback'
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    const stmt = env.DB.prepare(
      'SELECT id, name, description, is_public, is_default, usage_count, created_at, updated_at FROM presets WHERE user_id = ? ORDER BY updated_at DESC'
    );

    const presets = stmt.bind(userId).all();

    logger.info('Presets listed', {
      userId,
      count: presets.results?.length || 0
    });

    return new Response(
      JSON.stringify({
        status: 'success',
        presets: presets.results || [],
        count: presets.results?.length || 0
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error('Failed to list presets', error, { userId });
    return new Response(
      JSON.stringify(createErrorResponse(
        'DB_ERROR',
        '無法從資料庫讀取預設',
        500
      )),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 獲取單個預設
 */
async function handleGetPreset(presetId, env, logger) {
  if (!env.DB) {
    return new Response(
      JSON.stringify(createErrorResponse(
        'NOT_FOUND',
        '預設不存在',
        404
      )),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const stmt = env.DB.prepare(
      'SELECT * FROM presets WHERE id = ?'
    );

    const preset = stmt.bind(presetId).first();

    if (!preset) {
      return new Response(
        JSON.stringify(createErrorResponse(
          'NOT_FOUND',
          '預設不存在',
          404
        )),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        status: 'success',
        preset
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error('Failed to get preset', error, { presetId });
    return new Response(
      JSON.stringify(createErrorResponse(
        'DB_ERROR',
        '無法從資料庫讀取預設',
        500
      )),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 創建新預設
 */
async function handleCreatePreset(request, env, logger) {
  const userId = extractUserId(request);

  if (!userId) {
    return new Response(
      JSON.stringify(createErrorResponse(
        'UNAUTHORIZED',
        '需要身份驗證',
        401
      )),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { name, description, config, is_public } = body;

    // 驗證必需字段
    if (!name || !config) {
      return new Response(
        JSON.stringify(createErrorResponse(
          'VALIDATION_ERROR',
          '缺少必需字段：name, config',
          400
        )),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 如果沒有 D1，返回模擬成功響應
    if (!env.DB) {
      const presetId = generateId();
      return new Response(
        JSON.stringify({
          status: 'success',
          preset: {
            id: presetId,
            user_id: userId,
            name,
            description: description || '',
            config,
            is_public: is_public || false,
            created_at: new Date().toISOString()
          },
          source: 'localStorage_fallback'
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 201 }
      );
    }

    const presetId = generateId();
    const now = new Date().toISOString();

    const stmt = env.DB.prepare(
      `INSERT INTO presets (id, user_id, name, description, config, is_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    stmt.bind(
      presetId,
      userId,
      name,
      description || '',
      JSON.stringify(config),
      is_public ? 1 : 0,
      now,
      now
    ).run();

    logger.info('Preset created', { presetId, userId, name });

    return new Response(
      JSON.stringify({
        status: 'success',
        preset: {
          id: presetId,
          user_id: userId,
          name,
          description: description || '',
          config,
          is_public: is_public || false,
          created_at: now
        }
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 201 }
    );
  } catch (error) {
    logger.error('Failed to create preset', error);
    return new Response(
      JSON.stringify(createErrorResponse(
        'DB_ERROR',
        '無法保存預設',
        500
      )),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 更新預設
 */
async function handleUpdatePreset(presetId, request, env, logger) {
  const userId = extractUserId(request);

  if (!userId) {
    return new Response(
      JSON.stringify(createErrorResponse(
        'UNAUTHORIZED',
        '需要身份驗證',
        401
      )),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { name, description, config, is_public } = body;

    if (!env.DB) {
      return new Response(
        JSON.stringify({
          status: 'success',
          preset: { id: presetId, ...body },
          source: 'localStorage_fallback'
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();

    const stmt = env.DB.prepare(
      `UPDATE presets
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           config = COALESCE(?, config),
           is_public = COALESCE(?, is_public),
           updated_at = ?
       WHERE id = ? AND user_id = ?`
    );

    const result = stmt.bind(
      name,
      description,
      config ? JSON.stringify(config) : null,
      is_public !== undefined ? (is_public ? 1 : 0) : null,
      now,
      presetId,
      userId
    ).run();

    if (!result.success || result.meta.changes === 0) {
      return new Response(
        JSON.stringify(createErrorResponse(
          'NOT_FOUND',
          '預設不存在或無權限編輯',
          404
        )),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    logger.info('Preset updated', { presetId, userId });

    return new Response(
      JSON.stringify({
        status: 'success',
        message: '預設已更新'
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error('Failed to update preset', error);
    return new Response(
      JSON.stringify(createErrorResponse(
        'DB_ERROR',
        '無法更新預設',
        500
      )),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 刪除預設
 */
async function handleDeletePreset(presetId, env, logger) {
  const userId = extractUserId(null); // 從上下文獲取

  if (!env.DB) {
    return new Response(
      JSON.stringify({ status: 'success', message: '預設已刪除' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const stmt = env.DB.prepare(
      'DELETE FROM presets WHERE id = ? AND user_id = ?'
    );

    const result = stmt.bind(presetId, userId).run();

    if (!result.success || result.meta.changes === 0) {
      return new Response(
        JSON.stringify(createErrorResponse(
          'NOT_FOUND',
          '預設不存在',
          404
        )),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    logger.info('Preset deleted', { presetId });

    return new Response(
      JSON.stringify({
        status: 'success',
        message: '預設已刪除'
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error('Failed to delete preset', error);
    return new Response(
      JSON.stringify(createErrorResponse(
        'DB_ERROR',
        '無法刪除預設',
        500
      )),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 列出預設版本
 */
async function handleGetVersions(presetId, env, logger) {
  if (!env.DB) {
    return new Response(
      JSON.stringify({
        status: 'success',
        versions: [],
        source: 'localStorage_fallback'
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const stmt = env.DB.prepare(
      'SELECT * FROM preset_versions WHERE preset_id = ? ORDER BY version_number DESC LIMIT 10'
    );

    const versions = stmt.bind(presetId).all();

    return new Response(
      JSON.stringify({
        status: 'success',
        versions: versions.results || [],
        count: versions.results?.length || 0
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error('Failed to get versions', error);
    return new Response(
      JSON.stringify(createErrorResponse(
        'DB_ERROR',
        '無法讀取版本歷史',
        500
      )),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 列出公開預設
 */
async function handleListSharedPresets(env, logger) {
  if (!env.DB) {
    return new Response(
      JSON.stringify({
        status: 'success',
        presets: [],
        source: 'localStorage_fallback'
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const stmt = env.DB.prepare(
      `SELECT id, name, description, usage_count, created_at
       FROM presets
       WHERE is_public = 1
       ORDER BY usage_count DESC
       LIMIT 20`
    );

    const presets = stmt.all();

    return new Response(
      JSON.stringify({
        status: 'success',
        presets: presets.results || [],
        count: presets.results?.length || 0
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error('Failed to list shared presets', error);
    return new Response(
      JSON.stringify(createErrorResponse(
        'DB_ERROR',
        '無法讀取共享預設',
        500
      )),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 輔助函數：提取用戶 ID
 */
function extractUserId(request) {
  // 從 Authorization header 提取用戶 ID
  // 簡單實現：使用 header 中的用戶 ID
  // 實際應用應使用 JWT 或 session
  if (request) {
    const auth = request.headers.get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
      return auth.slice(7); // 簡化版本，實際應解析 JWT
    }
  }
  return null;
}

/**
 * 輔助函數：生成唯一 ID
 */
function generateId() {
  return 'preset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}
