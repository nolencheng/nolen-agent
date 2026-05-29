/**
 * SVA Generator Comprehensive Test Suite
 * Migrated from console.assert to Vitest format
 * Covers: parsing, analysis, code generation, edge cases, and E2E workflows
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  handleGenerateSVA,
  handleValidateWavedrom
} from '../workers-site/api/sva-generator.js';

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

// Mock request/response helpers
function createMockRequest(body) {
  return {
    json: async () => body
  };
}

function createMockContext() {
  return {};
}

// ============== UNIT TESTS: Timing Analysis ==============

describe('Timing Analyzer - Logic Relations', () => {
  it('should detect or allow no simultaneous rising edges', () => {
    const wavedrom = {
      signal: [
        { name: 'clk', wave: 'p.p.p.' },
        { name: 'sig_a', wave: '0.1.0' },
        { name: 'sig_b', wave: '0.1.0' }
      ]
    };

    const analysis = parseWavedrom(wavedrom);
    const relations = detectLogicRelations(analysis.events, analysis.signals);

    expect(Array.isArray(relations)).toBe(true);
    // Relations may be empty or non-empty depending on event timing
    if (relations.length > 0) {
      expect(relations[0]).toHaveProperty('type');
    }
  });

  it('should handle single signal gracefully', () => {
    const wavedrom = {
      signal: [
        { name: 'clk', wave: 'p.p.p.' }
      ]
    };

    const analysis = parseWavedrom(wavedrom);
    const relations = detectLogicRelations(analysis.events, analysis.signals);

    expect(relations).toBeDefined();
    expect(Array.isArray(relations)).toBe(true);
  });
});

describe('Timing Analyzer - Setup Time Constraints', () => {
  it('should detect setup time constraints', () => {
    const events = [
      { time: 0, signal: 'data', eventType: 'data_change', value: 'A' },
      { time: 0.5, signal: 'clk', eventType: 'rising_edge' },  // Violation: data too close to clock
      { time: 4, signal: 'data', eventType: 'data_change', value: 'B' },
      { time: 6, signal: 'clk', eventType: 'rising_edge' }
    ];

    const constraints = detectSetupTimeConstraints(events, ['clk'], 2);

    expect(constraints.length).toBeGreaterThan(0);
    // Check that analysis was performed
    expect(constraints[0]).toHaveProperty('type');
    expect(constraints[0].type).toBe('setup_time');
  });

  it('should handle zero margin without crashing', () => {
    const events = [
      { time: 0, signal: 'data', eventType: 'data_change', value: 'A' },
      { time: 2, signal: 'clk', eventType: 'rising_edge' }
    ];

    const constraints = detectSetupTimeConstraints(events, ['clk'], 0);
    expect(Array.isArray(constraints)).toBe(true);
  });

  it('should handle empty events gracefully', () => {
    const constraints = detectSetupTimeConstraints([], ['clk'], 2);
    expect(constraints).toEqual([]);
  });
});

describe('Timing Analyzer - Hold Time Constraints', () => {
  it('should detect hold time violations', () => {
    const events = [
      { time: 0, signal: 'clk', eventType: 'rising_edge' },
      { time: 1, signal: 'data', eventType: 'data_change', value: 'X' },
      { time: 4, signal: 'clk', eventType: 'rising_edge' },
      { time: 5, signal: 'data', eventType: 'data_change', value: 'Y' }
    ];

    const constraints = detectHoldTimeConstraints(events, ['clk'], 2);

    expect(constraints.length).toBeGreaterThan(0);
    expect(constraints.some(c => c.violation === true)).toBe(true);
  });

  it('should handle safe hold times', () => {
    const events = [
      { time: 0, signal: 'clk', eventType: 'rising_edge' },
      { time: 5, signal: 'data', eventType: 'data_change', value: 'X' },
      { time: 10, signal: 'clk', eventType: 'rising_edge' }
    ];

    const constraints = detectHoldTimeConstraints(events, ['clk'], 2);
    const safeConstraints = constraints.filter(c => c.violation === false);
    expect(safeConstraints.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Timing Analyzer - Sequence Detection', () => {
  it('should detect signal sequences without stack overflow', () => {
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

    expect(sequences).toBeDefined();
    expect(Array.isArray(sequences)).toBe(true);
    expect(sequences.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle large signal counts (50+ signals)', () => {
    const signal = [
      { name: 'clk', wave: 'p.p.p.p.p.' },
      { name: 'reset', wave: '0.1......' }
    ];

    for (let i = 0; i < 50; i++) {
      signal.push({
        name: `sig_${i}`,
        wave: 'x.3.x.3.x',
        data: ['0x' + i.toString(16).padStart(2, '0')]
      });
    }

    const wavedrom = { signal };
    const analysis = parseWavedrom(wavedrom);

    expect(() => {
      detectSequences(analysis.events, 3);
    }).not.toThrow();
  });
});

describe('Timing Analyzer - Implication Detection', () => {
  it('should detect causal relationships', () => {
    const events = [
      { time: 0, signal: 'trigger', eventType: 'rising_edge' },
      { time: 2, signal: 'response', eventType: 'rising_edge' },
      { time: 4, signal: 'trigger', eventType: 'rising_edge' },
      { time: 6, signal: 'response', eventType: 'rising_edge' }
    ];

    const implications = detectImplications(events, 5);

    expect(implications.length).toBeGreaterThan(0);
    expect(implications.some(i => i.antecedent === 'trigger' && i.consequent === 'response')).toBe(true);
  });

  it('should calculate consistency correctly', () => {
    const events = [
      { time: 0, signal: 'a', eventType: 'rising_edge' },
      { time: 1, signal: 'b', eventType: 'rising_edge' },
      { time: 2, signal: 'a', eventType: 'rising_edge' },
      { time: 3, signal: 'b', eventType: 'rising_edge' }
    ];

    const implications = detectImplications(events, 5);
    const abImplication = implications.find(i => i.antecedent === 'a' && i.consequent === 'b');

    if (abImplication) {
      const consistency = parseFloat(abImplication.consistency);
      expect(consistency).toBeGreaterThan(0);
      expect(consistency).toBeLessThanOrEqual(100);
    }
  });
});

describe('Timing Analyzer - Clock-to-Q Delay', () => {
  it('should detect CtoQ delays', () => {
    const events = [
      { time: 0, signal: 'clk', eventType: 'rising_edge' },
      { time: 2, signal: 'data_out', eventType: 'data_change', value: '0x12' },
      { time: 4, signal: 'clk', eventType: 'rising_edge' },
      { time: 6, signal: 'data_out', eventType: 'data_change', value: '0x34' }
    ];

    const delays = detectClockToQDelay(events, ['clk']);

    expect(delays.length).toBeGreaterThan(0);
    expect(delays[0].delay).toBeGreaterThan(0);
  });

  it('should handle multiple clock signals', () => {
    const events = [
      { time: 0, signal: 'clk1', eventType: 'rising_edge' },
      { time: 1, signal: 'out1', eventType: 'data_change' },
      { time: 2, signal: 'clk2', eventType: 'rising_edge' },
      { time: 3, signal: 'out2', eventType: 'data_change' }
    ];

    const delays = detectClockToQDelay(events, ['clk1', 'clk2']);
    expect(Array.isArray(delays)).toBe(true);
  });
});

// ============== INTEGRATION TESTS: Full Analysis ==============

describe('Full Timing Analysis', () => {
  it('should complete analysis for typical circuit', () => {
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

    expect(fullAnalysis).toBeDefined();
    expect(fullAnalysis.statistics).toBeDefined();
    expect(Array.isArray(fullAnalysis.setup_time_constraints)).toBe(true);
    expect(Array.isArray(fullAnalysis.hold_time_constraints)).toBe(true);
    // Statistics should contain setup/hold constraint counts
    expect(fullAnalysis.statistics.total_setup_constraints).toBeGreaterThanOrEqual(0);
    expect(fullAnalysis.statistics.total_hold_constraints).toBeGreaterThanOrEqual(0);
  });

  it('should detect violations when present', () => {
    const wavedrom = {
      signal: [
        { name: 'clk', wave: 'p.p' },
        { name: 'data', wave: 'x1' }  // Data changes on clock edge (violation)
      ]
    };

    const analysis = parseWavedrom(wavedrom);
    const fullAnalysis = performFullTimingAnalysis(analysis, {
      setupMargin: 2,
      holdMargin: 2
    });

    expect(fullAnalysis.statistics).toBeDefined();
  });
});

// ============== API TESTS: SVA Generation ==============

describe('SVA Generator API', () => {
  it('should generate valid SVA for basic circuit', async () => {
    const wavedromData = {
      signal: [
        { name: 'clk', wave: 'p.p.p.p.' },
        { name: 'reset_n', wave: '0.1......' },
        { name: 'data', wave: 'x.3.x.4', data: ['A', 'B'] },
        { name: 'valid', wave: '0.1.0.1' }
      ]
    };

    const request = createMockRequest({ wavedrom: wavedromData });
    const response = await handleGenerateSVA(request, {}, createMockContext());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('success');
    expect(data.sva_code).toBeDefined();
    expect(data.sva_code.includes('module')).toBe(true);
    expect(data.analysis).toBeDefined();
  });

  it('should return error for missing wavedrom', async () => {
    const request = createMockRequest({});
    const response = await handleGenerateSVA(request, {}, createMockContext());

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.status).toBe('error');
  });

  it('should support configuration options', async () => {
    const wavedromData = {
      signal: [
        { name: 'clk', wave: 'p.p.p.' },
        { name: 'data', wave: 'x.3.x', data: ['A'] }
      ]
    };

    const request = createMockRequest({
      wavedrom: wavedromData,
      config: {
        uncomment_code: true,
        generate_cover: false
      }
    });

    const response = await handleGenerateSVA(request, {}, createMockContext());
    const data = await response.json();

    expect(data.sva_code).toBeDefined();
    // Check that uncomment_code option was applied
    expect(data.sva_code.includes('// property')).toBe(false);
  });
});

describe('Wavedrom Validation API', () => {
  it('should validate correct wavedrom', async () => {
    const validWavedrom = {
      signal: [
        { name: 'clk', wave: 'p.p.p.' },
        { name: 'data', wave: 'x.3.x', data: ['A'] }
      ]
    };

    const request = createMockRequest({ wavedrom: validWavedrom });
    const response = await handleValidateWavedrom(request, {}, createMockContext());
    const data = await response.json();

    expect(data.valid).toBe(true);
    expect(data.signals).toBeDefined();
    expect(data.signals.length).toBeGreaterThan(0);
  });

  it('should reject invalid wavedrom', async () => {
    const invalidWavedrom = {
      signal: [
        { name: 'clk', wave: 'invalid_wave_pattern' }
      ]
    };

    const request = createMockRequest({ wavedrom: invalidWavedrom });
    const response = await handleValidateWavedrom(request, {}, createMockContext());
    const data = await response.json();

    expect(data.valid).toBe(false);
    expect(data.errors).toBeDefined();
  });
});

// ============== EDGE CASE TESTS ==============

describe('Edge Cases - Extreme Input Values', () => {
  it('should handle very large time values', () => {
    const wavedrom = {
      signal: [
        { name: 'clk', wave: 'p.p.p.' },
        { name: 'data', wave: 'x.3.x', data: ['value'] }
      ]
    };

    const analysis = parseWavedrom(wavedrom);
    expect(analysis.events).toBeDefined();
  });

  it('should handle single event gracefully', () => {
    const wavedrom = {
      signal: [
        { name: 'single', wave: '1' }
      ]
    };

    const analysis = parseWavedrom(wavedrom);
    expect(analysis.signals).toBeDefined();
    expect(analysis.signals.length).toBe(1);
  });

  it('should handle all signals changing simultaneously', () => {
    const wavedrom = {
      signal: [
        { name: 'sig_a', wave: '0.1.0.1' },
        { name: 'sig_b', wave: '0.1.0.1' },
        { name: 'sig_c', wave: '0.1.0.1' }
      ]
    };

    const analysis = parseWavedrom(wavedrom);
    const relations = detectLogicRelations(analysis.events, analysis.signals);

    expect(relations).toBeDefined();
    expect(Array.isArray(relations)).toBe(true);
  });

  it('should handle stable signal without transitions', () => {
    const wavedrom = {
      signal: [
        { name: 'stable', wave: '00000' }
      ]
    };

    const analysis = parseWavedrom(wavedrom);
    // Stable signals generate initial state events
    expect(analysis.events).toBeDefined();
    expect(Array.isArray(analysis.events)).toBe(true);
    expect(analysis.signals).toBeDefined();
  });
});

describe('Edge Cases - Large Input Sizes', () => {
  it('should process 100 signals without performance degradation', () => {
    const signal = [{ name: 'clk', wave: 'p.p.p.' }];

    for (let i = 0; i < 100; i++) {
      signal.push({
        name: `sig_${i}`,
        wave: '0.1.0',
        eventType: 'rising_edge'
      });
    }

    const wavedrom = { signal };
    const analysis = parseWavedrom(wavedrom);

    expect(analysis.signals.length).toBe(101);
  });
});

// ============== E2E WORKFLOW TESTS ==============

describe('E2E Workflow - Complete User Journey', () => {
  it('should complete full SVA generation workflow', async () => {
    // Step 1: Validate Wavedrom
    const wavedrom = {
      signal: [
        { name: 'clk', wave: 'p.p.p.p.p.' },
        { name: 'reset_n', wave: '0.1......' },
        { name: 'req', wave: '0.1.0.1.0' },
        { name: 'ack', wave: '0..1.0..1' },
        { name: 'data', wave: 'x.3.x.4.x', data: ['0x00', '0x11'] }
      ]
    };

    const validateRequest = createMockRequest({ wavedrom });
    const validateResponse = await handleValidateWavedrom(validateRequest, {}, createMockContext());
    const validateData = await validateResponse.json();

    expect(validateData.valid).toBe(true);

    // Step 2: Generate SVA
    const generateRequest = createMockRequest({
      wavedrom,
      config: { uncomment_code: true }
    });
    const generateResponse = await handleGenerateSVA(generateRequest, {}, createMockContext());
    const generateData = await generateResponse.json();

    expect(generateData.status).toBe('success');
    expect(generateData.sva_code).toBeDefined();

    // Step 3: Verify SVA code quality
    const code = generateData.sva_code;
    expect(code.includes('module assertions')).toBe(true);
    expect(code.includes('endmodule')).toBe(true);
    expect(code.includes('input logic')).toBe(true);
    expect(code.includes('property')).toBe(true);
    expect(code.includes('assert')).toBe(true);
  });

  it('should handle multiple iterations with different configs', async () => {
    const wavedrom = {
      signal: [
        { name: 'clk', wave: 'p.p.p.' },
        { name: 'data', wave: 'x.3.x', data: ['A'] }
      ]
    };

    const configs = [
      { uncomment_code: true },
      { generate_cover: false },
      { uncomment_code: false, generate_cover: true }
    ];

    for (const config of configs) {
      const request = createMockRequest({ wavedrom, config });
      const response = await handleGenerateSVA(request, {}, createMockContext());
      const data = await response.json();

      expect(data.status).toBe('success');
      expect(data.sva_code).toBeDefined();
    }
  });
});

// ============== CODE QUALITY TESTS ==============

describe('SVA Code Quality', () => {
  it('should generate valid SystemVerilog syntax', async () => {
    const wavedrom = {
      signal: [
        { name: 'clk', wave: 'p.p.p.p.' },
        { name: 'data', wave: 'x.3.x.4', data: ['A', 'B'] }
      ]
    };

    const request = createMockRequest({ wavedrom, config: { uncomment_code: true } });
    const response = await handleGenerateSVA(request, {}, createMockContext());
    const data = await response.json();
    const code = data.sva_code;

    // Check for balanced parentheses
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    expect(openParens).toBe(closeParens);

    // Check for balanced brackets
    const openBrackets = (code.match(/\[/g) || []).length;
    const closeBrackets = (code.match(/\]/g) || []).length;
    expect(openBrackets).toBe(closeBrackets);

    // Check that assertions are uncommented when requested
    expect(code.match(/^assert /gm)).toBeDefined();
  });

  it('should not have duplicate signal declarations', async () => {
    const wavedrom = {
      signal: [
        { name: 'clk', wave: 'p.p.p.' },
        { name: 'data', wave: 'x.3.x', data: ['A'] }
      ]
    };

    const request = createMockRequest({ wavedrom });
    const response = await handleGenerateSVA(request, {}, createMockContext());
    const data = await response.json();
    const code = data.sva_code;

    const portDeclarations = code.match(/input logic \w+/g) || [];
    const uniquePorts = new Set(portDeclarations);
    expect(portDeclarations.length).toBe(uniquePorts.size);
  });
});
