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

    // Phase 1: 簡單的 SVA 代碼框架生成
    const svaCode = generateBasicSVAModule(analysis, config);

    // 統計分析結果
    const stats = getStatistics(analysis);

    const response = {
      status: 'success',
      phase: 'Phase 1: Basic SVA Generation',
      sva_code: svaCode,
      analysis: {
        detected_relations: 0,  // Phase 2 會實現
        detected_constraints: 0,
        detected_sequences: 0,
        signals: analysis.signals.length,
        events: analysis.events.length,
        clock_signals: analysis.clockSignals
      },
      statistics: stats,
      message: 'SVA 框架已生成。Phase 2 將實現完整的時序分析和 assertion 生成。'
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
 * Phase 1: 生成基本的 SVA 模組框架
 * 包含信號聲明、時鐘定義和註釋
 */
function generateBasicSVAModule(analysis, config) {
  const moduleName = config.module_name || 'assertions';
  const timeUnit = config.time_unit || analysis.timeUnit;
  const assertionMode = config.assertion_mode || 'strict';

  let code = `// SystemVerilog Assertions Module\n`;
  code += `// 自動生成自 Wavedrom 時序圖\n`;
  code += `// 生成時間: ${new Date().toISOString()}\n\n`;

  code += `module ${moduleName}(\n`;
  code += `  input logic clk,\n`;
  code += `  input logic reset_n\n`;
  code += `);\n\n`;

  // 信號聲明註釋
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
  code += `parameter DISABLE_ON_RESET = 1'b1;\n\n`;

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

  // 基本 assertion 框架
  code += `// === Assertions ===\n`;
  code += `// Phase 1: 框架已生成\n`;
  code += `// Phase 2 將添加具體的時序檢查\n\n`;

  // 示例 property（註釋）
  code += `// property reset_timing;\n`;
  code += `//   @(posedge clk) disable iff(!DISABLE_ON_RESET)\n`;
  code += `//   reset_n |-> ##1 ready;\n`;
  code += `// endproperty\n`;
  code += `// assert_reset: assert property(reset_timing);\n\n`;

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
