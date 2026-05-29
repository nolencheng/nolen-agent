/**
 * Cloudflare D1 Database Schema for SVA Generator
 * Tables: users, presets, preset_versions
 */

-- 用戶表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME,
  is_active BOOLEAN DEFAULT 1
);

-- 預設配置表
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  config JSON NOT NULL,
  is_public BOOLEAN DEFAULT 0,
  is_default BOOLEAN DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)
);

-- 預設版本歷史（用於回滾）
CREATE TABLE IF NOT EXISTS preset_versions (
  id TEXT PRIMARY KEY,
  preset_id TEXT NOT NULL,
  config JSON NOT NULL,
  version_number INTEGER NOT NULL,
  change_description TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
);

-- 分析結果快取（用於性能優化）
CREATE TABLE IF NOT EXISTS analysis_cache (
  id TEXT PRIMARY KEY,
  wavedrom_hash TEXT UNIQUE NOT NULL,
  analysis_result JSON NOT NULL,
  config_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  hit_count INTEGER DEFAULT 0
);

-- 使用統計（用於分析和改進）
CREATE TABLE IF NOT EXISTS usage_stats (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  endpoint TEXT NOT NULL,
  request_size INTEGER,
  response_size INTEGER,
  execution_time_ms INTEGER,
  status_code INTEGER,
  error_code TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 索引以改善查詢性能
CREATE INDEX IF NOT EXISTS idx_presets_user_id ON presets(user_id);
CREATE INDEX IF NOT EXISTS idx_presets_name ON presets(name);
CREATE INDEX IF NOT EXISTS idx_presets_is_public ON presets(is_public);
CREATE INDEX IF NOT EXISTS idx_preset_versions_preset_id ON preset_versions(preset_id);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_hash ON analysis_cache(wavedrom_hash);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_expires ON analysis_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_usage_stats_user_id ON usage_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_stats_endpoint ON usage_stats(endpoint);
CREATE INDEX IF NOT EXISTS idx_usage_stats_created_at ON usage_stats(created_at);

-- 視圖：用戶的最新預設
CREATE VIEW IF NOT EXISTS user_presets_latest AS
SELECT
  p.id,
  p.user_id,
  p.name,
  p.description,
  p.config,
  p.is_public,
  p.is_default,
  p.usage_count,
  p.created_at,
  p.updated_at,
  (SELECT COUNT(*) FROM preset_versions WHERE preset_id = p.id) as version_count
FROM presets p
ORDER BY p.updated_at DESC;
