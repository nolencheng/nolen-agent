/**
 * SVA 生成 API 處理器
 * 處理 /api/generate-sva 和 /api/validate-wavedrom 請求
 */

import {
  parseWavedrom,
  validateWavedromStructure,
  getStatistics,
  toReadableText
} from '../modules/wavedrom-parser.js';

import {
  performFullTimingAnalysis
} from '../modules/timing-analyzer.js';

/**
 * 處理 POST /api/generate-sva 請求
 * 接收 Wavedrom JSON + 配置，返回生成的 SVA 代碼
 */
export async function handleGenerateSVA(request, env, ctx) {
  try {
    const payload = await request.json();
    const { wavedrom, config = {} } = payload;

    if (!wavedrom) {
      return errorResponse('缺少 wavedrom 參數', 400);
    }

    // 驗證 Wavedrom 格式
    const validation = validateWavedromStructure(wavedrom);
    if (!validation.valid) {
      return errorResponse(
        'Wavedrom 格式錯誤: ' + validation.errors.join('; '),
        400
      );
    }

    // 解析 Wavedrom
    let analysis;
    try {
      analysis = parseWavedrom(wavedrom);
    } catch (e) {
      return errorResponse('解析 Wavedrom 失敗: ' + e.message, 400);
    }

    console.log(`[SVA Generator] 解析完成: ${analysis.signals.length} 個信號, ${analysis.events.length} 個事件`);

    // Phase 2: 執行完整時序分析
    const timingAnalysis = performFullTimingAnalysis(analysis, {
      setupMargin: config.setup_margin || 2,
      holdMargin: config.hold_margin || 2,
      maxDelay: config.max_delay || 5,
      maxSequenceLength: config.max_sequence_length || 5
    });

    console.log(`[SVA Generator] 時序分析完成:`, timingAnalysis.statistics);

    // 生成包含時序約束的 SVA 代碼
    const svaCode = generateSVAWithConstraints(analysis, timingAnalysis, config);

    // 統計分析結果
    const stats = getStatistics(analysis);

    const response = {
      status: 'success',
      phase: 'Phase 2: Timing Analysis & SVA Generation',
      sva_code: svaCode,
      analysis: {
        detected_relations: timingAnalysis.statistics.total_logic_relations,
        detected_constraints: timingAnalysis.statistics.total_setup_constraints + timingAnalysis.statistics.total_hold_constraints,
        detected_sequences: timingAnalysis.statistics.total_sequences,
        detected_implications: timingAnalysis.statistics.total_implications,
        setup_violations: timingAnalysis.statistics.setup_violations,
        hold_violations: timingAnalysis.statistics.hold_violations,
        signals: analysis.signals.length,
        events: analysis.events.length,
        clock_signals: analysis.clockSignals
      },
      timing_analysis: {
        logic_relations: timingAnalysis.logic_relations,
        setup_constraints: timingAnalysis.setup_time_constraints,
        hold_constraints: timingAnalysis.hold_time_constraints,
        sequences: timingAnalysis.signal_sequences,
        implications: timingAnalysis.implications,
        clock_to_q: timingAnalysis.clock_to_q_delays
      },
      statistics: stats,
      message: timingAnalysis.has_violations
        ? '⚠️ 檢測到時序違規！請查看 setup_violations 和 hold_violations。'
        : '✓ 時序分析完成，未檢測到違規。'
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Error in handleGenerateSVA:', error);
    return errorResponse('伺服器錯誤: ' + error.message, 500);
  }
}

/**
 * 處理 POST /api/validate-wavedrom 請求
 * 驗證 Wavedrom JSON 並返回信號清單
 */
export async function handleValidateWavedrom(request, env, ctx) {
  try {
    const payload = await request.json();
    const { wavedrom } = payload;

    if (!wavedrom) {
      return errorResponse('缺少 wavedrom 參數', 400);
    }

    // 驗證結構
    const validation = validateWavedromStructure(wavedrom);

    if (!validation.valid) {
      return new Response(
        JSON.stringify({
          valid: false,
          errors: validation.errors,
          signals: []
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
      );
    }

    // 解析以提取信號信息
    let analysis;
    try {
      analysis = parseWavedrom(wavedrom);
    } catch (e) {
      return new Response(
        JSON.stringify({
          valid: false,
          errors: [e.message],
          signals: []
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
      );
    }

    const signals = analysis.signals.map(s => ({
      name: s.name,
      type: s.type,
      is_clock: analysis.clockSignals.includes(s.name),
      event_count: s.metadata.eventCount,
      data_values: s.dataValues?.length || 0
    }));

    return new Response(
      JSON.stringify({
        valid: true,
        errors: [],
        signals: signals,
        metadata: {
          total_duration: analysis.duration,
          time_unit: analysis.timeUnit,
          parsed_at: analysis.metadata.parsed_at
        }
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  } catch (error) {
    console.error('Error in handleValidateWavedrom:', error);
    return errorResponse('伺服器錯誤: ' + error.message, 500);
  }
}

/**
 * Phase 2: 生成包含時序約束的 SVA 模組
 * 根據檢測到的時序關係生成具體的 SVA assertions
 */
function generateSVAWithConstraints(analysis, timingAnalysis, config) {
  const moduleName = config.module_name || 'assertions';
  const timeUnit = config.time_unit || analysis.timeUnit;
  const assertionMode = config.assertion_mode || 'strict';
  const clockName = analysis.clockSignals[0] || 'clk';

  let code = `// SystemVerilog Assertions Module\n`;
  code += `// 自動生成自 Wavedrom 時序圖\n`;
  code += `// 生成時間: ${new Date().toISOString()}\n`;
  code += `// 分析版本: Phase 2 - Timing Analysis\n\n`;

  code += `module ${moduleName}(\n`;
  code += `  input logic clk,\n`;
  code += `  input logic reset_n\n`;
  code += `);\n\n`;

  // 信號聲明
  code += `// === 信號聲明 ===\n`;
  code += `// 以下信號應從驗證環境中導入或聲明\n`;
  analysis.signals.forEach(signal => {
    const isClk = analysis.clockSignals.includes(signal.name);
    const type = isClk ? '(時鐘)' : '';
    code += `// logic ${signal.name}; ${type}\n`;
  });
  code += `\n`;

  // 參數化配置
  code += `// === 配置參數 ===\n`;
  code += `parameter TIME_UNIT = "${timeUnit}";\n`;
  code += `parameter ASSERTION_MODE = "${assertionMode}";\n`;
  code += `parameter DISABLE_ON_RESET = 1'b1;\n`;
  code += `parameter SETUP_TIME = ${config.setup_margin || 2}; // ${timeUnit}\n`;
  code += `parameter HOLD_TIME = ${config.hold_margin || 2}; // ${timeUnit}\n\n`;

  // 時鐘信息
  if (analysis.clockSignals.length > 0) {
    code += `// === 時鐘信息 ===\n`;
    analysis.clockSignals.forEach(clockName => {
      const clockSignal = analysis.signals.find(s => s.name === clockName);
      if (clockSignal && clockSignal.period) {
        code += `// ${clockName}: 週期 = ${clockSignal.period} ${timeUnit}, 占空比 = ${(clockSignal.dutyCycle * 100).toFixed(1)}%\n`;
      }
    });
    code += `\n`;
  }

  // Setup Time Constraints
  if (timingAnalysis.setup_time_constraints && timingAnalysis.setup_time_constraints.length > 0) {
    code += `// === Setup Time Constraints ===\n`;
    timingAnalysis.setup_time_constraints.forEach((constraint, idx) => {
      const safetyMargin = constraint.setupTime >= (config.setup_margin || 2) ? '✓' : '✗';
      code += `// [${safetyMargin}] ${constraint.description}\n`;
      code += `// property setup_${constraint.dataSignal}_${idx};\n`;
      code += `//   @(${constraint.clockEdge === 'rising_edge' ? 'posedge' : 'negedge'} ${constraint.clockSignal})\n`;
      code += `//   disable iff(!DISABLE_ON_RESET)\n`;
      code += `//   $stable(${constraint.dataSignal});\n`;
      code += `// endproperty\n`;
      code += `// assert_setup_${constraint.dataSignal}_${idx}: assert property(setup_${constraint.dataSignal}_${idx});\n\n`;
    });
  }

  // Hold Time Constraints
  if (timingAnalysis.hold_constraints && timingAnalysis.hold_constraints.length > 0) {
    code += `// === Hold Time Constraints ===\n`;
    timingAnalysis.hold_constraints.forEach((constraint, idx) => {
      const safetyMargin = constraint.holdTime >= (config.hold_margin || 2) ? '✓' : '✗';
      code += `// [${safetyMargin}] ${constraint.description}\n`;
      code += `// property hold_${constraint.dataSignal}_${idx};\n`;
      code += `//   @(${constraint.clockEdge === 'rising_edge' ? 'posedge' : 'negedge'} ${constraint.clockSignal})\n`;
      code += `//   disable iff(!DISABLE_ON_RESET)\n`;
      code += `//   ##1 $stable(${constraint.dataSignal});\n`;
      code += `// endproperty\n`;
      code += `// assert_hold_${constraint.dataSignal}_${idx}: assert property(hold_${constraint.dataSignal}_${idx});\n\n`;
    });
  }

  // Logic Relations (Simultaneous Edges)
  if (timingAnalysis.logic_relations && timingAnalysis.logic_relations.length > 0) {
    code += `// === Logic Relations (Simultaneous Edges) ===\n`;
    timingAnalysis.logic_relations.forEach((relation, idx) => {
      code += `// ${relation.description}\n`;
      if (relation.type === 'simultaneous_rising_edges') {
        const signals = relation.signals.join(' && ');
        code += `// property simultaneous_rising_${idx};\n`;
        code += `//   @(posedge clk) disable iff(!DISABLE_ON_RESET)\n`;
        code += `//   (${signals});\n`;
        code += `// endproperty\n`;
      } else if (relation.type === 'mixed_edges') {
        code += `// property mixed_edges_${idx};\n`;
        code += `//   @(posedge clk) disable iff(!DISABLE_ON_RESET)\n`;
        code += `//   (${relation.rising.join(' || ')}) && (${relation.falling.join(' || ')});\n`;
        code += `// endproperty\n`;
      }
      code += `// assert_logic_${idx}: assert property(simultaneous_rising_${idx});\n\n`;
    });
  }

  // Signal Sequences
  if (timingAnalysis.sequences && timingAnalysis.sequences.length > 0) {
    code += `// === Signal Sequences ===\n`;
    timingAnalysis.sequences.forEach((seq, idx) => {
      code += `// ${seq.description}\n`;
      code += `// property sequence_${idx};\n`;
      code += `//   @(posedge clk) disable iff(!DISABLE_ON_RESET)\n`;
      // Simple sequence representation
      const seqStr = seq.signals.map(s => `${s}`).join(' ##[*] ');
      code += `//   ${seqStr};\n`;
      code += `// endproperty\n`;
      code += `// assert_sequence_${idx}: assert property(sequence_${idx});\n\n`;
    });
  }

  // Implications
  if (timingAnalysis.implications && timingAnalysis.implications.length > 0) {
    code += `// === Implications (Causal Relationships) ===\n`;
    timingAnalysis.implications.forEach((impl, idx) => {
      code += `// ${impl.description}\n`;
      code += `// property implication_${idx};\n`;
      code += `//   @(posedge clk) disable iff(!DISABLE_ON_RESET)\n`;
      code += `//   ${impl.antecedent} |-> ##[1:${impl.delay}] ${impl.consequent};\n`;
      code += `// endproperty\n`;
      code += `// assert_implication_${idx}: assert property(implication_${idx});\n\n`;
    });
  }

  // Statistics and Summary
  code += `// === Analysis Summary ===\n`;
  code += `// Total Logic Relations: ${timingAnalysis.statistics.total_logic_relations}\n`;
  code += `// Total Setup Constraints: ${timingAnalysis.statistics.total_setup_constraints}\n`;
  code += `// Total Hold Constraints: ${timingAnalysis.statistics.total_hold_constraints}\n`;
  code += `// Total Signal Sequences: ${timingAnalysis.statistics.total_sequences}\n`;
  code += `// Total Implications: ${timingAnalysis.statistics.total_implications}\n`;
  code += `// Clock-to-Q Measurements: ${timingAnalysis.statistics.total_ctq_measurements}\n`;
  code += `// Setup Violations: ${timingAnalysis.statistics.setup_violations}\n`;
  code += `// Hold Violations: ${timingAnalysis.statistics.hold_violations}\n`;
  code += `// Timing Issues: ${timingAnalysis.has_violations ? '⚠️ YES' : '✓ NO'}\n\n`;

  code += `endmodule : ${moduleName}\n`;

  return code;
}

/**
 * 返回錯誤響應
 */
function errorResponse(message, status = 500) {
  return new Response(
    JSON.stringify({
      status: 'error',
      message: message
    }),
    {
      status: status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}
