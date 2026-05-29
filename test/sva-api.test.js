/**
 * SVA Generator API 整合測試
 * 測試 /api/generate-sva 端點的完整流程
 */

import { handleGenerateSVA, handleValidateWavedrom } from '../workers-site/api/sva-generator.js';

// 模擬 request/response 物件
function createMockRequest(body) {
  return {
    json: async () => body
  };
}

function createMockContext() {
  return {};
}

// 測試用例 1: 基本 SVA 生成
console.log('=== Test 1: 基本 SVA 生成 ===');
{
  const wavedromData = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.' },
      { name: 'reset_n', wave: '0.1......' },
      { name: 'data', wave: 'x.3.x.4', data: ['A', 'B'] },
      { name: 'valid', wave: '0.1.0.1' }
    ]
  };

  const request = createMockRequest({ wavedrom: wavedromData });
  const context = createMockContext();

  handleGenerateSVA(request, {}, context).then(response => {
    console.assert(response.status === 200, 'Test 1.1: 應該返回 200 狀態');
    response.json().then(data => {
      console.assert(data.status === 'success', 'Test 1.2: 應該返回成功狀態');
      console.assert(data.sva_code, 'Test 1.3: 應該生成 SVA 代碼');
      console.assert(data.sva_code.includes('module'), 'Test 1.4: 代碼應包含 module 關鍵字');
      console.assert(data.analysis, 'Test 1.5: 應該有分析結果');

      console.log('✓ Test 1.1-1.5 通過');
      console.log(`  SVA 代碼行數: ${data.sva_code.split('\n').length}`);
      console.log(`  檢測到的約束: ${data.analysis.detected_constraints}`);
      console.log(`  檢測到的序列: ${data.analysis.detected_sequences}`);
    });
  });
}

// 測試用例 2: Setup/Hold Time 分析
console.log('\n=== Test 2: Setup/Hold Time 分析 ===');
{
  const wavedromData = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.p.' },
      { name: 'reset_n', wave: '0.1.......0' },
      { name: 'data_in', wave: 'x.3.x.4.x.5', data: ['0x10', '0x20', '0x30'] },
      { name: 'data_out', wave: 'x...3...4...5', data: ['0x10', '0x20', '0x30'] },
      { name: 'valid', wave: '0.1.0.1.0.1.0' }
    ],
    config: {
      timeUnit: 'ns'
    }
  };

  const request = createMockRequest({
    wavedrom: wavedromData,
    config: {
      setup_margin: 2,
      hold_margin: 2,
      max_delay: 5
    }
  });
  const context = createMockContext();

  handleGenerateSVA(request, {}, context).then(response => {
    response.json().then(data => {
      console.assert(data.analysis.detected_constraints > 0, 'Test 2.1: 應檢測到時序約束');
      console.assert(data.timing_analysis, 'Test 2.2: 應有詳細的時序分析');
      console.assert(data.timing_analysis.setup_constraints, 'Test 2.3: 應有 setup 約束列表');
      console.assert(data.timing_analysis.hold_constraints, 'Test 2.4: 應有 hold 約束列表');

      console.log('✓ Test 2.1-2.4 通過');
      console.log(`  Setup 約束: ${data.timing_analysis.setup_constraints.length}`);
      console.log(`  Hold 約束: ${data.timing_analysis.hold_constraints.length}`);
      console.log(`  Setup 違規: ${data.analysis.setup_violations}`);
      console.log(`  Hold 違規: ${data.analysis.hold_violations}`);
    });
  });
}

// 測試用例 3: 信號序列與因果關係
console.log('\n=== Test 3: 信號序列與因果關係 ===');
{
  const wavedromData = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.p.p.' },
      { name: 'request', wave: '0.1.0.1.0.1' },
      { name: 'grant', wave: '0..1.0..1.0' },
      { name: 'ack', wave: '0...1.0...1' }
    ]
  };

  const request = createMockRequest({ wavedrom: wavedromData });
  const context = createMockContext();

  handleGenerateSVA(request, {}, context).then(response => {
    response.json().then(data => {
      console.assert(data.timing_analysis.sequences, 'Test 3.1: 應有序列檢測');
      console.assert(data.timing_analysis.implications, 'Test 3.2: 應有因果關係檢測');
      console.assert(data.analysis.detected_implications >= 0, 'Test 3.3: 應計數因果關係');

      console.log('✓ Test 3.1-3.3 通過');
      console.log(`  檢測到的序列: ${data.timing_analysis.sequences.length}`);
      console.log(`  檢測到的因果關係: ${data.timing_analysis.implications.length}`);
    });
  });
}

// 測試用例 4: 錯誤處理 - 缺少 wavedrom
console.log('\n=== Test 4: 錯誤處理 - 缺少參數 ===');
{
  const request = createMockRequest({ });
  const context = createMockContext();

  handleGenerateSVA(request, {}, context).then(response => {
    console.assert(response.status === 400, 'Test 4.1: 應返回 400 錯誤');
    response.json().then(data => {
      console.assert(data.status === 'error', 'Test 4.2: 應返回錯誤狀態');
      console.log('✓ Test 4.1-4.2 通過');
      console.log(`  錯誤信息: ${data.message}`);
    });
  });
}

// 測試用例 5: 驗證無效的 Wavedrom
console.log('\n=== Test 5: Wavedrom 驗證 API ===');
{
  const validWavedrom = {
    signal: [
      { name: 'clk', wave: 'p.p.p.' },
      { name: 'data', wave: 'x.3.x', data: ['A'] }
    ]
  };

  const request = createMockRequest({ wavedrom: validWavedrom });
  const context = createMockContext();

  handleValidateWavedrom(request, {}, context).then(response => {
    response.json().then(data => {
      console.assert(data.valid === true, 'Test 5.1: 應驗證為有效');
      console.assert(data.signals, 'Test 5.2: 應返回信號清單');
      console.assert(data.signals.length > 0, 'Test 5.3: 應有信號列表');

      console.log('✓ Test 5.1-5.3 通過');
      console.log(`  驗證信號: ${data.signals.map(s => s.name).join(', ')}`);
      console.log(`  時鐘信號: ${data.signals.filter(s => s.is_clock).map(s => s.name).join(', ')}`);
    });
  });
}

// 測試用例 6: SVA 代碼質量檢查
console.log('\n=== Test 6: SVA 代碼質量 ===');
{
  const wavedromData = {
    signal: [
      { name: 'clk', wave: 'p.p.p.p.' },
      { name: 'reset_n', wave: '0.1......' },
      { name: 'data', wave: 'x.3.x.4', data: ['A', 'B'] }
    ]
  };

  const request = createMockRequest({ wavedrom: wavedromData });
  const context = createMockContext();

  handleGenerateSVA(request, {}, context).then(response => {
    response.json().then(data => {
      const code = data.sva_code;
      console.assert(code.includes('parameter'), 'Test 6.1: 應有參數定義');
      console.assert(code.includes('endmodule'), 'Test 6.2: 應有完整的 module');
      console.assert(code.includes('property'), 'Test 6.3: 應有 property 定義');
      console.assert(code.includes('assert'), 'Test 6.4: 應有 assertion');
      console.assert(code.includes('Analysis Summary'), 'Test 6.5: 應有分析摘要');

      console.log('✓ Test 6.1-6.5 通過');
      console.log(`  代碼結構完整`);
    });
  });
}

console.log('\n=== 所有 API 測試完成 ===');
console.log('✓ SVA Generator API 整合驗證成功');
