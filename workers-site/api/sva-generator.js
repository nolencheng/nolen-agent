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

    // Phase 3: 生成可執行的 SVA 代碼（含信號聲明、去重、違規處理）
    const svaCode = generateSVAWithConstraints(analysis, timingAnalysis, {
      ...config,
      uncomment_code: config.uncomment_code !== false,
      generate_cover: config.generate_cover !== false,
      min_implication_consistency: config.min_implication_consistency || 0.3
    });

    // 統計分析結果
    const stats = getStatistics(analysis);

    const response = {
      status: 'success',
      phase: 'Phase 3: SVA Code Generation with Signal Declarations & Deduplication',
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
 * Phase 3: 生成可執行的 SVA 模組
 * 包含信號聲明、實際時序約束和多種 assertion 指令
 */
function generateSVAWithConstraints(analysis, timingAnalysis, config) {
  const moduleName = config.module_name || 'assertions';
  const timeUnit = config.time_unit || analysis.timeUnit;
  const assertionMode = config.assertion_mode || 'strict';
  const uncommentCode = config.uncomment_code !== false; // Default true
  const includeCover = config.generate_cover !== false; // Default true
  const minImplicationConsistency = config.min_implication_consistency || 0.3;

  let code = `// SystemVerilog Assertions Module\n`;
  code += `// 自動生成自 Wavedrom 時序圖\n`;
  code += `// 生成時間: ${new Date().toISOString()}\n`;
  code += `// 分析版本: Phase 3 - SVA Code Generation\n\n`;

  // Phase 3A: 動態生成模組端口聲明（含所有信號）
  code += generateModuleInterface(analysis, moduleName);
  code += `\n`;

  // 信號聲明（現在已在模組端口中）
  code += `// === 內部信號 (已在模組端口中聲明) ===\n`;
  code += `// 所有信號已作為輸入端口在模組介面中宣告\n`;
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
    const deduped = deduplicateSetupConstraints(timingAnalysis.setup_time_constraints);
    deduped.forEach((constraint, idx) => {
      const safetyMargin = constraint.setupTime >= (config.setup_margin || 2) ? '✓' : '✗';
      const directive = constraint.violation ? 'assume' : 'assert';
      const commentPrefix = uncommentCode ? '' : '// ';

      code += `${commentPrefix}// [${safetyMargin}] ${constraint.description}\n`;
      code += `${commentPrefix}property prop_setup_${constraint.dataSignal}_before_${constraint.clockEdge.replace('_edge', '')}_${idx};\n`;
      code += `${commentPrefix}  @(${constraint.clockEdge === 'rising_edge' ? 'posedge' : 'negedge'} ${constraint.clockSignal})\n`;
      code += `${commentPrefix}  disable iff(!DISABLE_ON_RESET)\n`;
      code += `${commentPrefix}  $stable(${constraint.dataSignal});\n`;
      code += `${commentPrefix}endproperty\n`;
      code += `${commentPrefix}${directive}_setup_${constraint.dataSignal}_${idx}: ${directive} property(prop_setup_${constraint.dataSignal}_before_${constraint.clockEdge.replace('_edge', '')}_${idx});\n\n`;
    });
  }

  // Hold Time Constraints
  if (timingAnalysis.hold_constraints && timingAnalysis.hold_constraints.length > 0) {
    code += `// === Hold Time Constraints ===\n`;
    const deduped = deduplicateHoldConstraints(timingAnalysis.hold_constraints);
    deduped.forEach((constraint, idx) => {
      const safetyMargin = constraint.holdTime >= (config.hold_margin || 2) ? '✓' : '✗';
      const directive = constraint.violation ? 'assume' : 'assert';
      const commentPrefix = uncommentCode ? '' : '// ';

      code += `${commentPrefix}// [${safetyMargin}] ${constraint.description}\n`;
      code += `${commentPrefix}property prop_hold_${constraint.dataSignal}_after_${constraint.clockEdge.replace('_edge', '')}_${idx};\n`;
      code += `${commentPrefix}  @(${constraint.clockEdge === 'rising_edge' ? 'posedge' : 'negedge'} ${constraint.clockSignal})\n`;
      code += `${commentPrefix}  disable iff(!DISABLE_ON_RESET)\n`;
      code += `${commentPrefix}  ##1 $stable(${constraint.dataSignal});\n`;
      code += `${commentPrefix}endproperty\n`;
      code += `${commentPrefix}${directive}_hold_${constraint.dataSignal}_${idx}: ${directive} property(prop_hold_${constraint.dataSignal}_after_${constraint.clockEdge.replace('_edge', '')}_${idx});\n\n`;
    });
  }

  // Logic Relations (Simultaneous Edges)
  if (timingAnalysis.logic_relations && timingAnalysis.logic_relations.length > 0) {
    code += `// === Logic Relations (Simultaneous Edges) ===\n`;
    timingAnalysis.logic_relations.forEach((relation, idx) => {
      const commentPrefix = uncommentCode ? '' : '// ';
      code += `${commentPrefix}// ${relation.description}\n`;
      if (relation.type === 'simultaneous_rising_edges') {
        const signals = relation.signals.join(' && ');
        code += `${commentPrefix}property prop_simultaneous_rising_${idx};\n`;
        code += `${commentPrefix}  @(posedge clk) disable iff(!DISABLE_ON_RESET)\n`;
        code += `${commentPrefix}  (${signals});\n`;
        code += `${commentPrefix}endproperty\n`;
        code += `${commentPrefix}assert_logic_${idx}: assert property(prop_simultaneous_rising_${idx});\n\n`;
      } else if (relation.type === 'mixed_edges') {
        code += `${commentPrefix}property prop_mixed_edges_${idx};\n`;
        code += `${commentPrefix}  @(posedge clk) disable iff(!DISABLE_ON_RESET)\n`;
        code += `${commentPrefix}  (${relation.rising.join(' || ')}) && (${relation.falling.join(' || ')});\n`;
        code += `${commentPrefix}endproperty\n`;
        code += `${commentPrefix}assert_logic_${idx}: assert property(prop_mixed_edges_${idx});\n\n`;
      }
    });
  }

  // Signal Sequences
  if (timingAnalysis.sequences && timingAnalysis.sequences.length > 0 && includeCover) {
    code += `// === Signal Sequences ===\n`;
    const deduped = deduplicateSequences(timingAnalysis.sequences);
    deduped.forEach((seq, idx) => {
      const commentPrefix = uncommentCode ? '' : '// ';
      const seqSignals = seq.signals.join('_');
      code += `${commentPrefix}// ${seq.description} (出現 ${seq.occurrences} 次)\n`;
      code += `${commentPrefix}property prop_sequence_${seqSignals}_${idx};\n`;
      code += `${commentPrefix}  @(posedge clk) disable iff(!DISABLE_ON_RESET)\n`;
      const seqStr = seq.signals.map(s => `${s}`).join(' ##[*] ');
      code += `${commentPrefix}  ${seqStr};\n`;
      code += `${commentPrefix}endproperty\n`;
      code += `${commentPrefix}cover_sequence_${idx}: cover property(prop_sequence_${seqSignals}_${idx});\n\n`;
    });
  }

  // Implications
  if (timingAnalysis.implications && timingAnalysis.implications.length > 0) {
    code += `// === Implications (Causal Relationships) ===\n`;
    const deduped = deduplicateImplications(timingAnalysis.implications, minImplicationConsistency);
    deduped.forEach((impl, idx) => {
      const consistencyNum = parseFloat(impl.consistency) / 100;
      const directive = consistencyNum >= 0.5 ? 'assert' : 'assume';
      const commentPrefix = uncommentCode ? '' : '// ';

      code += `${commentPrefix}// ${impl.description}\n`;
      code += `${commentPrefix}property prop_${impl.antecedent}_implies_${impl.consequent}_${idx};\n`;
      code += `${commentPrefix}  @(posedge clk) disable iff(!DISABLE_ON_RESET)\n`;
      code += `${commentPrefix}  ${impl.antecedent} |-> ##[1:${impl.delay}] ${impl.consequent};\n`;
      code += `${commentPrefix}endproperty\n`;
      code += `${commentPrefix}${directive}_implication_${idx}: ${directive} property(prop_${impl.antecedent}_implies_${impl.consequent}_${idx});\n\n`;
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
 * Phase 3A: 生成模組介面（含信號聲明）
 */
function generateModuleInterface(analysis, moduleName) {
  let code = `module ${moduleName}(\n`;
  code += `  input logic clk,\n`;
  code += `  input logic reset_n`;

  // 列舉所有非時鐘、非預先宣告信號的信號作為輸入
  const reservedSignals = new Set(['clk', 'reset_n']);
  const dataSignals = analysis.signals.filter(
    s => !analysis.clockSignals.includes(s.name) && !reservedSignals.has(s.name)
  );

  dataSignals.forEach((signal) => {
    code += `,\n  input logic ${signal.name}`;
  });

  code += `\n);\n`;
  return code;
}

/**
 * Phase 3C: Setup Time 約束去重
 */
function deduplicateSetupConstraints(constraints) {
  const seen = new Map();
  const result = [];

  constraints.forEach(constraint => {
    const key = `${constraint.dataSignal}_${constraint.clockSignal}_${constraint.clockEdge}`;
    if (!seen.has(key)) {
      seen.set(key, constraint);
      result.push(constraint);
    } else {
      // 保留更嚴格的約束（較大的 setupTime）
      const existing = seen.get(key);
      if (constraint.setupTime > existing.setupTime) {
        const idx = result.indexOf(existing);
        result[idx] = constraint;
        seen.set(key, constraint);
      }
    }
  });

  return result;
}

/**
 * Phase 3C: Hold Time 約束去重
 */
function deduplicateHoldConstraints(constraints) {
  const seen = new Map();
  const result = [];

  constraints.forEach(constraint => {
    const key = `${constraint.dataSignal}_${constraint.clockSignal}_${constraint.clockEdge}`;
    if (!seen.has(key)) {
      seen.set(key, constraint);
      result.push(constraint);
    } else {
      // 保留更嚴格的約束（較大的 holdTime）
      const existing = seen.get(key);
      if (constraint.holdTime > existing.holdTime) {
        const idx = result.indexOf(existing);
        result[idx] = constraint;
        seen.set(key, constraint);
      }
    }
  });

  return result;
}

/**
 * Phase 3C: 信號序列去重
 */
function deduplicateSequences(sequences) {
  const seen = new Map();
  const result = [];

  sequences.forEach(seq => {
    const key = seq.signals.join('_');
    if (!seen.has(key)) {
      seen.set(key, seq);
      result.push(seq);
    } else {
      // 累加出現次數
      seen.get(key).occurrences += seq.occurrences;
    }
  });

  return result;
}

/**
 * Phase 3C: 因果關係去重和過濾
 */
function deduplicateImplications(implications, minConsistency) {
  const seen = new Map();
  const result = [];

  implications.forEach(impl => {
    const consistencyNum = parseFloat(impl.consistency) / 100;
    if (consistencyNum < minConsistency) return; // 過濾低一致性

    const key = `${impl.antecedent}_${impl.consequent}`;
    if (!seen.has(key)) {
      seen.set(key, impl);
      result.push(impl);
    } else {
      // 保留較可靠的（更高一致性）
      const existing = seen.get(key);
      if (consistencyNum > (parseFloat(existing.consistency) / 100)) {
        const idx = result.indexOf(existing);
        result[idx] = impl;
        seen.set(key, impl);
      }
    }
  });

  return result;
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
