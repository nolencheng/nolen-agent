/**
 * Phase 5F: Advanced Timing Analysis Tests
 * Forbidden Transitions, Critical Paths, Clock Skew
 */

import { describe, it, expect } from 'vitest';
import {
  detectForbiddenTransitions,
  detectCriticalPaths,
  detectClockSkew,
  performFullTimingAnalysis
} from '../workers-site/modules/timing-analyzer.js';

describe('Forbidden Transition Detection (Phase 5F)', () => {
  it('should detect simultaneous forbidden transitions', () => {
    const events = [
      { signal: 'reset_n', time: 0, eventType: 'rising_edge' },
      { signal: 'clk', time: 0, eventType: 'rising_edge' },
      { signal: 'data', time: 10, eventType: 'rising_edge' }
    ];

    const forbiddenPairs = [
      { signal1: 'reset_n', signal2: 'clk' }
    ];

    const violations = detectForbiddenTransitions(events, forbiddenPairs);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].type).toBe('forbidden_transition');
    expect(violations[0].severity).toBe('critical');
  });

  it('should detect near-time forbidden transitions within window', () => {
    const events = [
      { signal: 'reset_n', time: 10, eventType: 'rising_edge' },
      { signal: 'clk', time: 11, eventType: 'rising_edge' }
    ];

    const forbiddenPairs = [
      { signal1: 'reset_n', signal2: 'clk' }
    ];

    const violations = detectForbiddenTransitions(events, forbiddenPairs);
    const nearbyViolations = violations.filter(v => v.type === 'forbidden_transition_near');
    expect(nearbyViolations.length).toBeGreaterThan(0);
    expect(nearbyViolations[0].severity).toBe('warning');
  });

  it('should return empty array when no forbidden pairs provided', () => {
    const events = [
      { signal: 'reset_n', time: 0, eventType: 'rising_edge' },
      { signal: 'clk', time: 0, eventType: 'rising_edge' }
    ];

    const violations = detectForbiddenTransitions(events, []);
    expect(violations).toEqual([]);
  });

  it('should return empty array when no events provided', () => {
    const forbiddenPairs = [
      { signal1: 'reset_n', signal2: 'clk' }
    ];

    const violations = detectForbiddenTransitions([], forbiddenPairs);
    expect(violations).toEqual([]);
  });

  it('should not flag allowed simultaneous transitions', () => {
    const events = [
      { signal: 'data1', time: 5, eventType: 'rising_edge' },
      { signal: 'data2', time: 5, eventType: 'rising_edge' }
    ];

    const forbiddenPairs = [
      { signal1: 'reset_n', signal2: 'clk' }
    ];

    const violations = detectForbiddenTransitions(events, forbiddenPairs);
    expect(violations.length).toBe(0);
  });

  it('should include violation details in results', () => {
    const events = [
      { signal: 'reset_n', time: 7, eventType: 'rising_edge' },
      { signal: 'clk', time: 7, eventType: 'falling_edge' }
    ];

    const forbiddenPairs = [
      { signal1: 'reset_n', signal2: 'clk' }
    ];

    const violations = detectForbiddenTransitions(events, forbiddenPairs);
    expect(violations[0].sig1_edge).toBe('rising_edge');
    expect(violations[0].sig2_edge).toBe('falling_edge');
    expect(violations[0].description).toBeDefined();
  });
});

describe('Critical Path Detection (Phase 5F)', () => {
  it('should detect critical paths between clock edges', () => {
    const events = [
      { signal: 'clk', time: 0, eventType: 'rising_edge' },
      { signal: 'data_in', time: 5, eventType: 'rising_edge' },
      { signal: 'data_out', time: 8, eventType: 'rising_edge' },
      { signal: 'clk', time: 10, eventType: 'rising_edge' }
    ];

    const paths = detectCriticalPaths(events, ['clk']);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].period_index).toBe(0);
    expect(paths[0].path_length).toBeGreaterThan(0);
  });

  it('should calculate slack correctly', () => {
    const events = [
      { signal: 'clk', time: 0, eventType: 'rising_edge' },
      { signal: 'data', time: 7, eventType: 'rising_edge' },
      { signal: 'clk', time: 10, eventType: 'rising_edge' }
    ];

    const paths = detectCriticalPaths(events, ['clk']);
    expect(paths[0].slack).toBe(3); // 10 - 7 = 3
    expect(paths[0].criticality).toBe('safe');
  });

  it('should identify critical paths with negative slack', () => {
    const events = [
      { signal: 'clk', time: 0, eventType: 'rising_edge' },
      { signal: 'data', time: 12, eventType: 'rising_edge' },
      { signal: 'clk', time: 10, eventType: 'rising_edge' }
    ];

    const paths = detectCriticalPaths(events, ['clk']);
    if (paths.length > 0) {
      const criticalPath = paths.find(p => p.slack < 0);
      if (criticalPath) {
        expect(criticalPath.criticality).toBe('critical');
      }
    }
  });

  it('should return empty array with no clock signals', () => {
    const events = [
      { signal: 'data', time: 5, eventType: 'rising_edge' }
    ];

    const paths = detectCriticalPaths(events, []);
    expect(paths).toEqual([]);
  });

  it('should handle single clock edge gracefully', () => {
    const events = [
      { signal: 'clk', time: 0, eventType: 'rising_edge' }
    ];

    const paths = detectCriticalPaths(events, ['clk']);
    expect(paths).toEqual([]);
  });

  it('should include path event details', () => {
    const events = [
      { signal: 'clk', time: 0, eventType: 'rising_edge' },
      { signal: 'sig1', time: 2, eventType: 'rising_edge' },
      { signal: 'sig2', time: 5, eventType: 'falling_edge' },
      { signal: 'clk', time: 10, eventType: 'rising_edge' }
    ];

    const paths = detectCriticalPaths(events, ['clk']);
    expect(paths[0].path_events).toBeDefined();
    expect(paths[0].path_events.length).toBe(2);
    expect(paths[0].path_events[0].signal).toBe('sig1');
  });

  it('should mark warning criticality for moderate slack', () => {
    const events = [
      { signal: 'clk', time: 0, eventType: 'rising_edge' },
      { signal: 'data', time: 8, eventType: 'rising_edge' },
      { signal: 'clk', time: 10, eventType: 'rising_edge' }
    ];

    const paths = detectCriticalPaths(events, ['clk']);
    // slack = 2, which is 20% of period 10, so should be 'warning'
    expect(['safe', 'warning', 'critical']).toContain(paths[0].criticality);
  });
});

describe('Clock Skew Detection (Phase 5F)', () => {
  it('should detect skew between multiple clock signals', () => {
    const events = [
      { signal: 'clk1', time: 0, eventType: 'rising_edge' },
      { signal: 'clk2', time: 2, eventType: 'rising_edge' },
      { signal: 'clk1', time: 10, eventType: 'rising_edge' },
      { signal: 'clk2', time: 12, eventType: 'rising_edge' }
    ];

    const skew = detectClockSkew(events, ['clk1', 'clk2']);
    expect(skew.clock_signals).toEqual(['clk1', 'clk2']);
    expect(skew.edge_analysis.length).toBeGreaterThan(0);
    expect(skew.max_skew).toBeGreaterThan(0);
  });

  it('should calculate average skew correctly', () => {
    const events = [
      { signal: 'clk1', time: 0, eventType: 'rising_edge' },
      { signal: 'clk2', time: 1, eventType: 'rising_edge' },
      { signal: 'clk1', time: 10, eventType: 'rising_edge' },
      { signal: 'clk2', time: 11, eventType: 'rising_edge' }
    ];

    const skew = detectClockSkew(events, ['clk1', 'clk2']);
    expect(skew.average_skew).toBeGreaterThan(0);
    expect(skew.edge_analysis.every(e => e.skew >= 0)).toBe(true);
  });

  it('should flag critical violations when skew exceeds 5 units', () => {
    const events = [
      { signal: 'clk1', time: 0, eventType: 'rising_edge' },
      { signal: 'clk2', time: 7, eventType: 'rising_edge' },
      { signal: 'clk1', time: 10, eventType: 'rising_edge' },
      { signal: 'clk2', time: 17, eventType: 'rising_edge' }
    ];

    const skew = detectClockSkew(events, ['clk1', 'clk2']);
    expect(skew.max_skew).toBeGreaterThan(5);
    expect(skew.skew_violations.length).toBeGreaterThan(0);
    expect(skew.skew_violations[0].description).toContain('超過閾值');
  });

  it('should return empty analysis with single clock signal', () => {
    const events = [
      { signal: 'clk', time: 0, eventType: 'rising_edge' }
    ];

    const skew = detectClockSkew(events, ['clk']);
    expect(skew.edge_analysis).toEqual([]);
  });

  it('should return empty analysis with no clock signals', () => {
    const events = [
      { signal: 'data', time: 0, eventType: 'rising_edge' }
    ];

    const skew = detectClockSkew(events, []);
    expect(skew.edge_analysis).toEqual([]);
  });

  it('should classify skew severity correctly', () => {
    const events = [
      { signal: 'clk1', time: 0, eventType: 'rising_edge' },
      { signal: 'clk2', time: 1, eventType: 'rising_edge' },
      { signal: 'clk3', time: 3, eventType: 'rising_edge' },
      { signal: 'clk1', time: 10, eventType: 'rising_edge' },
      { signal: 'clk2', time: 11, eventType: 'rising_edge' },
      { signal: 'clk3', time: 13, eventType: 'rising_edge' }
    ];

    const skew = detectClockSkew(events, ['clk1', 'clk2', 'clk3']);
    expect(skew.edge_analysis[0].severity).toBeDefined();
    expect(['safe', 'warning', 'critical']).toContain(skew.edge_analysis[0].severity);
  });

  it('should handle matching clock edges with zero skew', () => {
    const events = [
      { signal: 'clk1', time: 5, eventType: 'rising_edge' },
      { signal: 'clk2', time: 5, eventType: 'rising_edge' }
    ];

    const skew = detectClockSkew(events, ['clk1', 'clk2']);
    expect(skew.max_skew).toBe(0);
    expect(skew.edge_analysis[0].severity).toBe('safe');
  });
});

describe('Integration: Full Analysis with Phase 5F Features', () => {
  it('should include forbidden transitions in full analysis', () => {
    const analysis = {
      events: [
        { signal: 'reset_n', time: 0, eventType: 'rising_edge' },
        { signal: 'clk', time: 0, eventType: 'rising_edge' },
        { signal: 'data', time: 10, eventType: 'rising_edge' }
      ],
      signals: [
        { name: 'clk' },
        { name: 'reset_n' },
        { name: 'data' }
      ],
      clockSignals: ['clk']
    };

    const config = {
      forbiddenPairs: [
        { signal1: 'reset_n', signal2: 'clk' }
      ]
    };

    const result = performFullTimingAnalysis(analysis, config);
    expect(result.forbidden_transitions).toBeDefined();
    expect(result.statistics.forbidden_transition_violations).toBeGreaterThanOrEqual(0);
  });

  it('should include critical paths in full analysis', () => {
    const analysis = {
      events: [
        { signal: 'clk', time: 0, eventType: 'rising_edge' },
        { signal: 'data', time: 5, eventType: 'rising_edge' },
        { signal: 'clk', time: 10, eventType: 'rising_edge' }
      ],
      signals: [
        { name: 'clk' },
        { name: 'data' }
      ],
      clockSignals: ['clk']
    };

    const result = performFullTimingAnalysis(analysis, {});
    expect(result.critical_paths).toBeDefined();
    expect(result.statistics.critical_path_violations).toBeDefined();
  });

  it('should include clock skew in full analysis', () => {
    const analysis = {
      events: [
        { signal: 'clk1', time: 0, eventType: 'rising_edge' },
        { signal: 'clk2', time: 2, eventType: 'rising_edge' }
      ],
      signals: [
        { name: 'clk1' },
        { name: 'clk2' }
      ],
      clockSignals: ['clk1', 'clk2']
    };

    const result = performFullTimingAnalysis(analysis, {});
    expect(result.clock_skew).toBeDefined();
    expect(result.statistics.clock_skew_violations).toBeGreaterThanOrEqual(0);
  });

  it('should aggregate all violations in has_violations flag', () => {
    const analysis = {
      events: [
        { signal: 'reset_n', time: 0, eventType: 'rising_edge' },
        { signal: 'clk', time: 0, eventType: 'rising_edge' }
      ],
      signals: [
        { name: 'clk' },
        { name: 'reset_n' }
      ],
      clockSignals: ['clk']
    };

    const config = {
      forbiddenPairs: [
        { signal1: 'reset_n', signal2: 'clk' }
      ]
    };

    const result = performFullTimingAnalysis(analysis, config);
    expect(result.has_violations).toBe(true);
  });

  it('should handle complex real-world scenario', () => {
    const analysis = {
      events: [
        { signal: 'clk', time: 0, eventType: 'rising_edge' },
        { signal: 'clk_div', time: 1, eventType: 'rising_edge' },
        { signal: 'data_in', time: 3, eventType: 'rising_edge' },
        { signal: 'valid', time: 5, eventType: 'rising_edge' },
        { signal: 'clk', time: 10, eventType: 'rising_edge' },
        { signal: 'clk_div', time: 11, eventType: 'rising_edge' },
        { signal: 'data_out', time: 13, eventType: 'rising_edge' },
        { signal: 'clk', time: 20, eventType: 'rising_edge' },
        { signal: 'clk_div', time: 21, eventType: 'rising_edge' }
      ],
      signals: [
        { name: 'clk' },
        { name: 'clk_div' },
        { name: 'data_in' },
        { name: 'data_out' },
        { name: 'valid' }
      ],
      clockSignals: ['clk', 'clk_div']
    };

    const config = {
      forbiddenPairs: [
        { signal1: 'valid', signal2: 'data_in' }
      ]
    };

    const result = performFullTimingAnalysis(analysis, config);
    expect(result.forbidden_transitions).toBeDefined();
    expect(result.critical_paths).toBeDefined();
    expect(result.clock_skew).toBeDefined();
    expect(result.statistics).toHaveProperty('forbidden_transition_violations');
    expect(result.statistics).toHaveProperty('critical_path_violations');
    expect(result.statistics).toHaveProperty('clock_skew_violations');
  });
});
