/**
 * Wavedrom Parser Module
 * 將 Wavedrom JSON 格式解析為可分析的時序數據結構
 */

/**
 * Wave pattern 字符的含義
 */
const WAVE_CHARS = {
  'p': { type: 'edge', direction: 'rising', duration: 1 },
  'n': { type: 'edge', direction: 'falling', duration: 1 },
  'P': { type: 'level', level: 'high', duration: 1 },
  'N': { type: 'level', level: 'low', duration: 1 },
  '0': { type: 'level', level: 'low', duration: 1 },
  '1': { type: 'level', level: 'high', duration: 1 },
  '2': { type: 'state', state: 'data_index', dataIndex: 2, duration: 1 },
  '3': { type: 'state', state: 'data_index', dataIndex: 3, duration: 1 },
  '4': { type: 'state', state: 'data_index', dataIndex: 4, duration: 1 },
  '5': { type: 'state', state: 'data_index', dataIndex: 5, duration: 1 },
  '6': { type: 'state', state: 'data_index', dataIndex: 6, duration: 1 },
  '7': { type: 'state', state: 'data_index', dataIndex: 7, duration: 1 },
  '8': { type: 'state', state: 'data_index', dataIndex: 8, duration: 1 },
  '9': { type: 'state', state: 'data_index', dataIndex: 9, duration: 1 },
  'x': { type: 'state', state: 'unknown', duration: 1 },
  'z': { type: 'state', state: 'highz', duration: 1 },
  'u': { type: 'state', state: 'undefined', duration: 1 },
  'm': { type: 'state', state: 'metastable', duration: 1 },
  'd': { type: 'state', state: 'data', duration: 1 },
  '=': { type: 'state', state: 'data', duration: 1 },
  '.': { type: 'hold', duration: 1 },
  '-': { type: 'hold', duration: 1 },
  ' ': { type: 'space', duration: 1 }
};

/**
 * 驗證 Wavedrom JSON 結構
 * @param {object} json - Wavedrom JSON
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function validateWavedromStructure(json) {
  const errors = [];

  if (!json || typeof json !== 'object') {
    errors.push('Wavedrom 必須是 JSON 對象');
    return { valid: false, errors };
  }

  if (!Array.isArray(json.signal)) {
    errors.push('缺少 signal 數組');
    return { valid: false, errors };
  }

  if (json.signal.length === 0) {
    errors.push('signal 數組不能為空');
    return { valid: false, errors };
  }

  // 驗證每個信號
  json.signal.forEach((signal, index) => {
    if (!signal.name || typeof signal.name !== 'string') {
      errors.push(`信號 #${index} 缺少有效的 name`);
    }

    if (!signal.wave || typeof signal.wave !== 'string') {
      errors.push(`信號 "${signal.name}" 缺少 wave 模式`);
    }

    // 驗證 wave 模式字符
    if (signal.wave) {
      for (const char of signal.wave) {
        if (char !== ' ' && !WAVE_CHARS[char]) {
          errors.push(`信號 "${signal.name}" 包含無效的 wave 字符: '${char}'`);
        }
      }
    }

    // 如果有 data，驗證其格式
    if (signal.data && !Array.isArray(signal.data)) {
      errors.push(`信號 "${signal.name}" 的 data 必須是數組`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * 解碼 wave pattern 字符串為時序事件
 * @param {string} pattern - Wave pattern (e.g., "p.p.0.1.x")
 * @param {string[]} dataValues - 關聯的數據值
 * @returns {object[]} 時序事件列表
 */
export function decodeWavePattern(pattern, dataValues = []) {
  const events = [];
  let dataIndex = 0;
  let time = 0;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (!(char in WAVE_CHARS)) {
      continue;
    }

    const info = WAVE_CHARS[char];

    if (char === ' ') {
      time++;
      continue;
    }

    if (char === '.') {
      time++;
      continue;
    }

    if (info.type === 'edge') {
      events.push({
        time,
        eventType: info.direction + '_edge',
        value: info.direction === 'rising' ? 'high' : 'low'
      });
    } else if (info.type === 'level') {
      events.push({
        time,
        eventType: 'level',
        value: info.level
      });
    } else if (info.type === 'state') {
      if ((char === 'd' || char === '=') && dataIndex < dataValues.length) {
        events.push({
          time,
          eventType: 'data_change',
          value: dataValues[dataIndex++]
        });
      } else if (info.state === 'data_index' && info.dataIndex < dataValues.length) {
        // 數字字符（2-9）用於引用 data 數組索引
        events.push({
          time,
          eventType: 'data_change',
          value: dataValues[info.dataIndex]
        });
      } else {
        events.push({
          time,
          eventType: 'state',
          value: info.state
        });
      }
    }

    time++;
  }

  return events;
}

/**
 * 識別時鐘信號（週期性上升/下降邊沿）
 * @param {object[]} signals - 信號定義數組
 * @param {object[]} allEvents - 全部時序事件
 * @returns {string[]} 時鐘信號名稱列表
 */
export function identifyClockSignals(signals, allEvents) {
  const clockSignals = [];

  signals.forEach(signal => {
    // 計算該信號的邊沿
    const edges = allEvents.filter(e =>
      e.signal === signal.name &&
      (e.eventType === 'rising_edge' || e.eventType === 'falling_edge')
    );

    // 如果有至少 2 個邊沿且週期規則，則認為是時鐘
    if (edges.length >= 2) {
      const periods = [];
      for (let i = 1; i < edges.length; i++) {
        periods.push(edges[i].time - edges[i - 1].time);
      }

      // 檢查週期是否一致（允許 ±1 的誤差）
      const firstPeriod = periods[0];
      const isRegular = periods.every(p =>
        Math.abs(p - firstPeriod) <= 1
      );

      if (isRegular) {
        clockSignals.push({
          name: signal.name,
          period: firstPeriod,
          frequency: firstPeriod > 0 ? 1 / firstPeriod : 0
        });
      }
    }
  });

  return clockSignals;
}

/**
 * 計算占空比（duty cycle）
 * @param {object[]} events - 信號的時序事件
 * @param {number} period - 信號週期
 * @returns {number} 占空比 (0-1)
 */
function calculateDutyCycle(events, period) {
  if (period <= 0) return 0;

  const risingEdges = events.filter(e => e.eventType === 'rising_edge').length;
  const fallingEdges = events.filter(e => e.eventType === 'falling_edge').length;

  if (risingEdges === 0 || fallingEdges === 0) return 0;

  // 簡單估算：根據邊沿數量估算占空比
  // 更精確的計算需要追蹤高電平持續時間
  const totalEdges = risingEdges + fallingEdges;
  const expectedEdgesPerPeriod = (period > 0 ? 2 : 1);
  const cycles = totalEdges / expectedEdgesPerPeriod;

  return risingEdges / (risingEdges + fallingEdges);
}

/**
 * 主解析函數：將 Wavedrom JSON 轉換為分析用的數據結構
 * @param {object} wavedromJSON - Wavedrom JSON 對象
 * @returns {object} 解析結果 { signals, events, timeUnit, duration, clockSignals, metadata }
 */
export function parseWavedrom(wavedromJSON) {
  // 驗證格式
  const validation = validateWavedromStructure(wavedromJSON);
  if (!validation.valid) {
    throw new Error('Wavedrom 格式驗證失敗: ' + validation.errors.join('; '));
  }

  const signals = [];
  const allEvents = [];
  let maxTime = 0;

  // 處理每個信號
  wavedromJSON.signal.forEach((signal, signalIndex) => {
    const wavePattern = signal.wave || '';
    const dataValues = signal.data || [];

    // 解碼 wave pattern
    const events = decodeWavePattern(wavePattern, dataValues);

    // 為每個事件添加信號名稱
    events.forEach(event => {
      event.signal = signal.name;
      event.signalIndex = signalIndex;
      allEvents.push(event);
      maxTime = Math.max(maxTime, event.time);
    });

    // 保存信號定義
    signals.push({
      name: signal.name,
      type: signal.type || 'digital',
      wavePattern,
      dataValues,
      metadata: {
        index: signalIndex,
        isAnalog: signal.type === 'analog',
        eventCount: events.length
      }
    });
  });

  // 按時間排序事件
  allEvents.sort((a, b) => a.time - b.time);

  // 識別時鐘信號
  const clockSignalsInfo = identifyClockSignals(signals, allEvents);
  const clockSignals = clockSignalsInfo.map(c => c.name);

  // 增強信號信息
  signals.forEach(signal => {
    const signalEvents = allEvents.filter(e => e.signal === signal.name);
    const isClockSignal = clockSignals.includes(signal.name);

    if (isClockSignal) {
      const clockInfo = clockSignalsInfo.find(c => c.name === signal.name);
      signal.period = clockInfo.period;
      signal.frequency = clockInfo.frequency;
      signal.dutyCycle = calculateDutyCycle(signalEvents, clockInfo.period);
    }

    signal.metadata.isClockSignal = isClockSignal;
  });

  const result = {
    signals,
    events: allEvents,
    timeUnit: wavedromJSON.config?.timeUnit || 'ns',
    duration: maxTime + 1,
    clockSignals,
    config: wavedromJSON.config || {},
    metadata: {
      format_version: '1.0',
      total_signals: signals.length,
      total_events: allEvents.length,
      total_time_points: maxTime + 1,
      parsed_at: new Date().toISOString()
    }
  };

  return result;
}

/**
 * 分析文本並提取統計信息
 * @param {object} analysis - parseWavedrom 的輸出
 * @returns {object} 統計信息
 */
export function getStatistics(analysis) {
  const clockCount = analysis.clockSignals.length;
  const signalCount = analysis.signals.length;
  const eventCount = analysis.events.length;

  // 計算事件分佈
  const eventTypes = {};
  analysis.events.forEach(e => {
    eventTypes[e.eventType] = (eventTypes[e.eventType] || 0) + 1;
  });

  return {
    total_signals: signalCount,
    clock_signals: clockCount,
    data_signals: signalCount - clockCount,
    total_events: eventCount,
    total_duration: analysis.duration,
    event_distribution: eventTypes,
    time_unit: analysis.timeUnit
  };
}

/**
 * 轉換為可讀的人類文本
 * @param {object} analysis - parseWavedrom 的輸出
 * @returns {string} 人類可讀的描述
 */
export function toReadableText(analysis) {
  const stats = getStatistics(analysis);
  let text = '=== Wavedrom 分析結果 ===\n\n';

  text += `信號數: ${stats.total_signals}\n`;
  text += `  - 時鐘信號: ${stats.clock_signals}\n`;
  text += `  - 數據信號: ${stats.data_signals}\n`;
  text += `總時序事件: ${stats.total_events}\n`;
  text += `仿真時間: ${stats.total_duration} ${stats.time_unit}\n\n`;

  text += '=== 信號詳情 ===\n';
  analysis.signals.forEach(signal => {
    text += `\n${signal.name}:\n`;
    text += `  類型: ${signal.type}\n`;
    if (signal.metadata.isClockSignal) {
      text += `  [時鐘信號]\n`;
      text += `  週期: ${signal.period} ${stats.time_unit}\n`;
      text += `  占空比: ${(signal.dutyCycle * 100).toFixed(1)}%\n`;
    }
    text += `  事件數: ${signal.metadata.eventCount}\n`;
  });

  return text;
}
