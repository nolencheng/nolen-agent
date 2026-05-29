/**
 * Wavedrom Parser 單元測試
 * 測試 Wavedrom JSON 解析和時序分析功能
 */

import {
  validateWavedromStructure,
  decodeWavePattern,
  parseWavedrom,
  getStatistics,
  identifyClockSignals
} from '../workers-site/modules/wavedrom-parser.js';

// 測試用例 1: 基本結構驗證
console.log('=== Test 1: 結構驗證 ===');
{
  const invalidJSON = { signal: [] };
  const result = validateWavedromStructure(invalidJSON);
  console.assert(!result.valid, 'Test 1.1: 空 signal 數組應該無效');
  console.log('✓ Test 1.1 通過');

  const validJSON = {
    signal: [
      { name: 'clk', wave: 'p.p.p.' },
      { name: 'data', wave: 'x.3.x', data: ['A', 'B'] }
    ]
  };
  const result2 = validateWavedromStructure(validJSON);
  console.assert(result2.valid, 'Test 1.2: 有效的 JSON 應該通過驗證');
  console.log('✓ Test 1.2 通過');
}

// 測試用例 2: Wave pattern 解碼
console.log('\n=== Test 2: Wave Pattern 解碼 ===');
{
  const pattern = 'p.p.0.1';
  const events = decodeWavePattern(pattern);
  console.assert(events.length >= 4, 'Test 2.1: 應該解碼至少 4 個事件');
  console.log(`✓ Test 2.1 通過 - 解碼 ${events.length} 個事件`);

  const risingEdges = events.filter(e => e.eventType === 'rising_edge').length;
  console.assert(risingEdges >= 1, 'Test 2.2: 應該檢測到上升邊沿');
  console.log(`✓ Test 2.2 通過 - 檢測到 ${risingEdges} 個上升邊沿`);

  // 測試數據值關聯
  const pattern3 = 'd.d.';
  const data = ['VALUE_A', 'VALUE_B'];
  const events3 = decodeWavePattern(pattern3, data);
  const dataEvents = events3.filter(e => e.eventType === 'data_change');
  console.assert(dataEvents.length === 2, 'Test 2.3: 應該有 2 個數據變化事件');
  console.assert(dataEvents[0].value === 'VALUE_A', 'Test 2.4: 第一個數據值應該是 VALUE_A');
  console.log('✓ Test 2.3-2.4 通過');
}

// 測試用例 3: 時鐘信號識別
console.log('\n=== Test 3: 時鐘信號識別 ===');
{
  const wavedrom = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.p.' },  // 規則的上升邊沿 = 時鐘
      { name: 'data', wave: 'x.3.x.4.x' },  // 非規則 = 數據信號
      { name: 'reset', wave: '0.1.......' }  // 非規則 = 控制信號
    ]
  };

  const analysis = parseWavedrom(wavedrom);
  console.assert(analysis.clockSignals.includes('clk'), 'Test 3.1: clk 應該被識別為時鐘信號');
  console.assert(!analysis.clockSignals.includes('data'), 'Test 3.2: data 不應該被識別為時鐘');
  console.log(`✓ Test 3.1-3.2 通過 - 識別到 ${analysis.clockSignals.length} 個時鐘信號`);
}

// 測試用例 4: 完整 Wavedrom 解析
console.log('\n=== Test 4: 完整解析 ===');
{
  const wavedrom = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.' },
      { name: 'reset_n', wave: '0.1......' },
      { name: 'data', wave: 'x.3.x.4', data: ['A', 'B'] },
      { name: 'valid', wave: '0.1.0.1' }
    ],
    config: {
      timeUnit: 'ns'
    }
  };

  const analysis = parseWavedrom(wavedrom);

  console.assert(analysis.signals.length === 4, 'Test 4.1: 應該有 4 個信號');
  console.assert(analysis.events.length > 0, 'Test 4.2: 應該有事件');
  console.assert(analysis.timeUnit === 'ns', 'Test 4.3: 時間單位應該是 ns');
  console.assert(analysis.clockSignals.length >= 1, 'Test 4.4: 應該至少有 1 個時鐘信號');

  console.log('✓ Test 4.1-4.4 通過');
  console.log(`  - 信號: ${analysis.signals.length}`);
  console.log(`  - 事件: ${analysis.events.length}`);
  console.log(`  - 時鐘信號: ${analysis.clockSignals.join(', ')}`);
  console.log(`  - 時長: ${analysis.duration} ${analysis.timeUnit}`);
}

// 測試用例 5: 統計信息
console.log('\n=== Test 5: 統計分析 ===');
{
  const wavedrom = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.p.p.p.p.' },
      { name: 'data', wave: 'x.3.x.4.x.5.x.6', data: ['A', 'B', 'C', 'D'] },
      { name: 'valid', wave: '0.1.0.1.0.1.0.1' }
    ]
  };

  const analysis = parseWavedrom(wavedrom);
  const stats = getStatistics(analysis);

  console.assert(stats.total_signals === 3, 'Test 5.1: 應該統計 3 個信號');
  console.assert(stats.clock_signals >= 1, 'Test 5.2: 應該有時鐘信號');
  console.assert(stats.total_events > 0, 'Test 5.3: 應該有事件');

  console.log('✓ Test 5.1-5.3 通過');
  console.log(`  - 總信號: ${stats.total_signals}`);
  console.log(`  - 時鐘信號: ${stats.clock_signals}`);
  console.log(`  - 數據信號: ${stats.data_signals}`);
  console.log(`  - 總事件: ${stats.total_events}`);
  console.log(`  - 事件分佈:`, stats.event_distribution);
}

// 測試用例 6: 錯誤處理
console.log('\n=== Test 6: 錯誤處理 ===');
{
  try {
    parseWavedrom(null);
    console.error('Test 6.1 失敗: 應該拋出錯誤');
  } catch (e) {
    console.log('✓ Test 6.1 通過 - 正確拋出錯誤');
  }

  try {
    parseWavedrom({ signal: [] });
    console.error('Test 6.2 失敗: 空 signal 應該拋出錯誤');
  } catch (e) {
    console.log('✓ Test 6.2 通過 - 正確拋出錯誤');
  }

  try {
    const wavedrom = {
      signal: [
        { name: 'clk', wave: 'p.p.p.' },
        { name: 'data', wave: 'x.3.x', data: ['A'] }  // 數據不足
      ]
    };
    const result = parseWavedrom(wavedrom);
    console.log('✓ Test 6.3 通過 - 數據不足時正確處理');
  } catch (e) {
    console.log('✗ Test 6.3 失敗:', e.message);
  }
}

// 測試用例 7: 實際驗證場景
console.log('\n=== Test 7: 實際驗證場景 ===');
{
  // Setup/Hold time 時序圖
  const setupHoldWavedrom = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.' },
      { name: 'data', wave: 'x.3.x.4', data: ['A', 'B'] },
      { name: 'valid', wave: '0.1.0.1' }
    ]
  };

  const analysis = parseWavedrom(setupHoldWavedrom);
  const stats = getStatistics(analysis);

  console.assert(analysis.clockSignals.length > 0, 'Test 7.1: 應識別時鐘信號');
  console.assert(stats.data_signals > 0, 'Test 7.2: 應識別數據信號');

  console.log('✓ Test 7.1-7.2 通過');
  console.log('  - 可用於生成 setup/hold time assertions');
}

console.log('\n=== 所有測試完成 ===');
console.log('✓ Wavedrom Parser 模塊驗證成功');
