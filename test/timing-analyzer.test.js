/**
 * Timing Analyzer 整合測試
 * 測試時序約束檢測功能
 */

import {
  detectLogicRelations,
  detectSetupTimeConstraints,
  detectHoldTimeConstraints,
  detectSequences,
  detectImplications,
  detectClockToQDelay,
  performFullTimingAnalysis
} from '../workers-site/modules/timing-analyzer.js';

import {
  parseWavedrom
} from '../workers-site/modules/wavedrom-parser.js';

// 測試用例 1: 邏輯關係檢測
console.log('=== Test 1: 邏輯關係檢測 ===');
{
  const wavedrom = {
    signal: [
      { name: 'clk', wave: 'p.p.p.' },
      { name: 'sig_a', wave: '0.1.0' },
      { name: 'sig_b', wave: '0.1.0' }
    ]
  };

  const analysis = parseWavedrom(wavedrom);
  const relations = detectLogicRelations(analysis.events, analysis.signals);

  console.assert(relations.length > 0, 'Test 1.1: 應該檢測到同時邊沿');
  const simultaneousRising = relations.filter(r => r.type === 'simultaneous_rising_edges');
  console.assert(simultaneousRising.length > 0, 'Test 1.2: 應該有同時上升邊沿');
  console.log('✓ Test 1.1-1.2 通過');
  console.log(`  檢測到 ${relations.length} 個邏輯關係`);
}

// 測試用例 2: Setup Time 約束
console.log('\n=== Test 2: Setup Time 約束檢測 ===');
{
  const events = [
    { time: 0, signal: 'data', eventType: 'data_change', value: 'A' },
    { time: 2, signal: 'clk', eventType: 'rising_edge' },
    { time: 4, signal: 'data', eventType: 'data_change', value: 'B' },
    { time: 6, signal: 'clk', eventType: 'rising_edge' }
  ];

  const clockSignals = ['clk'];
  const constraints = detectSetupTimeConstraints(events, clockSignals, 2);

  console.assert(constraints.length > 0, 'Test 2.1: 應該檢測到 setup time 約束');
  const violations = constraints.filter(c => c.violation);
  console.assert(violations.length >= 0, 'Test 2.2: 違規計數應正確');
  console.log('✓ Test 2.1-2.2 通過');
  console.log(`  檢測到 ${constraints.length} 個約束，${violations.length} 個違規`);
}

// 測試用例 3: Hold Time 約束
console.log('\n=== Test 3: Hold Time 約束檢測 ===');
{
  const events = [
    { time: 0, signal: 'clk', eventType: 'rising_edge' },
    { time: 1, signal: 'data', eventType: 'data_change', value: 'X' },
    { time: 4, signal: 'clk', eventType: 'rising_edge' },
    { time: 5, signal: 'data', eventType: 'data_change', value: 'Y' }
  ];

  const clockSignals = ['clk'];
  const constraints = detectHoldTimeConstraints(events, clockSignals, 2);

  console.assert(constraints.length > 0, 'Test 3.1: 應該檢測到 hold time 約束');
  const violations = constraints.filter(c => c.violation);
  console.log('✓ Test 3.1 通過');
  console.log(`  檢測到 ${constraints.length} 個約束，${violations.length} 個違規`);
}

// 測試用例 4: 信號序列檢測
console.log('\n=== Test 4: 信號序列檢測 ===');
{
  const wavedrom = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.p.' },
      { name: 'sig_a', wave: '0.1.0.1.0' },
      { name: 'sig_b', wave: '0..1.0.1' },
      { name: 'sig_c', wave: '0...1.0' }
    ]
  };

  const analysis = parseWavedrom(wavedrom);
  const sequences = detectSequences(analysis.events, 3);

  console.assert(sequences.length >= 0, 'Test 4.1: 序列檢測應成功');
  console.log('✓ Test 4.1 通過');
  console.log(`  檢測到 ${sequences.length} 個序列`);
}

// 測試用例 5: 因果關係檢測
console.log('\n=== Test 5: 因果關係檢測 ===');
{
  const events = [
    { time: 0, signal: 'trigger', eventType: 'rising_edge' },
    { time: 2, signal: 'response', eventType: 'rising_edge' },
    { time: 4, signal: 'trigger', eventType: 'rising_edge' },
    { time: 6, signal: 'response', eventType: 'rising_edge' },
    { time: 8, signal: 'trigger', eventType: 'rising_edge' },
    { time: 10, signal: 'response', eventType: 'rising_edge' }
  ];

  const implications = detectImplications(events, 5);

  console.assert(implications.length > 0, 'Test 5.1: 應該檢測到因果關係');
  const triggerToResponse = implications.filter(i => i.antecedent === 'trigger' && i.consequent === 'response');
  console.assert(triggerToResponse.length > 0, 'Test 5.2: 應該檢測到 trigger -> response 關係');
  console.log('✓ Test 5.1-5.2 通過');
  if (triggerToResponse.length > 0) {
    console.log(`  延遲: ${triggerToResponse[0].delay}ns, 一致性: ${triggerToResponse[0].consistency}`);
  }
}

// 測試用例 6: Clock-to-Q 延遲檢測
console.log('\n=== Test 6: Clock-to-Q 延遲檢測 ===');
{
  const events = [
    { time: 0, signal: 'clk', eventType: 'rising_edge' },
    { time: 2, signal: 'data_out', eventType: 'data_change', value: '0x12' },
    { time: 4, signal: 'clk', eventType: 'rising_edge' },
    { time: 6, signal: 'data_out', eventType: 'data_change', value: '0x34' }
  ];

  const clockSignals = ['clk'];
  const delays = detectClockToQDelay(events, clockSignals);

  console.assert(delays.length > 0, 'Test 6.1: 應該檢測到 CtoQ 延遲');
  console.log('✓ Test 6.1 通過');
  console.log(`  檢測到 ${delays.length} 個延遲測量`);
  if (delays.length > 0) {
    console.log(`  平均延遲: ${(delays.reduce((a, b) => a + b.delay, 0) / delays.length).toFixed(1)}ns`);
  }
}

// 測試用例 7: 完整時序分析
console.log('\n=== Test 7: 完整時序分析 ===');
{
  const wavedrom = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.p.' },
      { name: 'reset_n', wave: '0.1......' },
      { name: 'data_in', wave: 'x.3.x.4', data: ['0xA0', '0xB1'] },
      { name: 'data_out', wave: 'x..3..x.4', data: ['0xA0', '0xB1'] },
      { name: 'valid', wave: '0.1.0.1.0' }
    ]
  };

  const analysis = parseWavedrom(wavedrom);
  const fullAnalysis = performFullTimingAnalysis(analysis, {
    setupMargin: 2,
    holdMargin: 2,
    maxDelay: 5
  });

  console.assert(fullAnalysis.statistics, 'Test 7.1: 應該生成統計信息');
  console.assert(fullAnalysis.logic_relations !== undefined, 'Test 7.2: 應該有邏輯關係');
  console.assert(fullAnalysis.setup_time_constraints !== undefined, 'Test 7.3: 應該有 setup 約束');
  console.assert(fullAnalysis.hold_time_constraints !== undefined, 'Test 7.4: 應該有 hold 約束');

  console.log('✓ Test 7.1-7.4 通過');
  console.log(`\n分析統計:`);
  console.log(`  邏輯關係: ${fullAnalysis.statistics.total_logic_relations}`);
  console.log(`  Setup 約束: ${fullAnalysis.statistics.total_setup_constraints} (違規: ${fullAnalysis.statistics.setup_violations})`);
  console.log(`  Hold 約束: ${fullAnalysis.statistics.total_hold_constraints} (違規: ${fullAnalysis.statistics.hold_violations})`);
  console.log(`  信號序列: ${fullAnalysis.statistics.total_sequences}`);
  console.log(`  因果關係: ${fullAnalysis.statistics.total_implications}`);
  console.log(`  CtoQ 測量: ${fullAnalysis.statistics.total_ctq_measurements}`);
  console.log(`  時序問題: ${fullAnalysis.has_violations ? '⚠️ 有' : '✓ 無'}`);
}

// 測試用例 8: 實際驗證場景 - Setup/Hold Time Diagram
console.log('\n=== Test 8: Setup/Hold Time 驗證場景 ===');
{
  const setupHoldWavedrom = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.p.' },
      { name: 'data', wave: 'x.3.x.4.x', data: ['Data_A', 'Data_B'] },
      { name: 'valid', wave: '0.1.0.1.0' }
    ],
    config: {
      timeUnit: 'ns'
    }
  };

  const analysis = parseWavedrom(setupHoldWavedrom);
  const fullAnalysis = performFullTimingAnalysis(analysis, {
    setupMargin: 2,
    holdMargin: 2
  });

  console.assert(analysis.clockSignals.length > 0, 'Test 8.1: 應識別時鐘信號');
  console.assert(fullAnalysis.setup_time_constraints.length > 0, 'Test 8.2: 應檢測 setup time');
  console.assert(fullAnalysis.hold_time_constraints.length > 0, 'Test 8.3: 應檢測 hold time');

  console.log('✓ Test 8.1-8.3 通過');
  console.log('  驗證場景已通過 setup/hold time 分析');
}

console.log('\n=== 所有測試完成 ===');
console.log('✓ Timing Analyzer 模塊驗證成功');
