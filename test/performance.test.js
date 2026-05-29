/**
 * Performance Benchmark Tests for SVA Generator
 * Measures execution time for different input sizes
 */

import {
  parseWavedrom
} from '../workers-site/modules/wavedrom-parser.js';

import {
  performFullTimingAnalysis
} from '../workers-site/modules/timing-analyzer.js';

// Helper to generate large Wavedrom inputs
function generateLargeWavedrom(signalCount, cycleCount = 8) {
  const signal = [];

  // Add clock signal
  signal.push({
    name: 'clk',
    wave: 'p'.repeat(cycleCount).split('').join('.')
  });

  // Add reset signal
  signal.push({
    name: 'reset_n',
    wave: '0' + '1'.repeat(cycleCount - 1)
  });

  // Add data signals
  for (let i = 0; i < signalCount - 2; i++) {
    const pattern = [];
    for (let j = 0; j < cycleCount; j++) {
      pattern.push(j % 3 === 0 ? '3' : 'x');
    }
    signal.push({
      name: `sig_${i}`,
      wave: pattern.join(''),
      data: ['0x' + (i * 256).toString(16).padStart(2, '0')]
    });
  }

  return { signal };
}

// Performance test suite
console.log('=== SVA Generator Performance Benchmarks ===\n');

const testSizes = [10, 50, 100, 500];
const benchmarks = [];

for (const signalCount of testSizes) {
  console.log(`Testing with ${signalCount} signals...`);

  const wavedrom = generateLargeWavedrom(signalCount);

  // Parsing benchmark
  const parseStart = performance.now();
  const analysis = parseWavedrom(wavedrom);
  const parseDuration = performance.now() - parseStart;

  // Full analysis benchmark
  const analysisStart = performance.now();
  const fullAnalysis = performFullTimingAnalysis(analysis, {
    setupMargin: 2,
    holdMargin: 2,
    maxDelay: 5
  });
  const analysisDuration = performance.now() - analysisStart;

  const totalDuration = parseDuration + analysisDuration;

  benchmarks.push({
    signalCount,
    parseDuration: parseStart,
    analysisDuration,
    totalDuration,
    constraints: fullAnalysis.statistics?.total_setup_constraints || 0,
    sequences: fullAnalysis.statistics?.total_sequences || 0,
    implications: fullAnalysis.statistics?.total_implications || 0
  });

  // Log results
  console.log(`  ✓ Parsing: ${parseDuration.toFixed(2)}ms`);
  console.log(`  ✓ Analysis: ${analysisDuration.toFixed(2)}ms`);
  console.log(`  ✓ Total: ${totalDuration.toFixed(2)}ms`);
  console.log(`  ✓ Results: ${fullAnalysis.statistics?.total_setup_constraints || 0} setup, ` +
              `${fullAnalysis.statistics?.total_hold_constraints || 0} hold, ` +
              `${fullAnalysis.statistics?.total_implications || 0} implications\n`);

  // Verify performance targets
  if (signalCount <= 100) {
    console.assert(totalDuration < 1000, `${signalCount} signals should complete < 1s, took ${totalDuration.toFixed(2)}ms`);
  } else {
    console.assert(totalDuration < 2000, `${signalCount} signals should complete < 2s, took ${totalDuration.toFixed(2)}ms`);
  }
}

// Save benchmarks to file
const benchmarkReport = {
  timestamp: new Date().toISOString(),
  environment: 'Node.js',
  benchmarks,
  summary: {
    smallInput: benchmarks[0],
    largeInput: benchmarks[benchmarks.length - 1],
    performanceRatio: (benchmarks[benchmarks.length - 1].totalDuration / benchmarks[0].totalDuration).toFixed(2)
  }
};

console.log('=== Benchmark Summary ===');
console.log(`Small (10 signals): ${benchmarks[0].totalDuration.toFixed(2)}ms`);
console.log(`Large (${testSizes[testSizes.length - 1]} signals): ${benchmarks[benchmarks.length - 1].totalDuration.toFixed(2)}ms`);
console.log(`Performance ratio: ${benchmarkReport.summary.performanceRatio}x`);
console.log('\n✓ Performance benchmarks complete');
