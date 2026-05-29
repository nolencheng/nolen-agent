/**
 * Timing Analyzer Module
 * 檢測時序關係、約束、序列和因果關係
 */

/**
 * 檢測同時刻的邏輯關係
 * @param {object[]} events - 時序事件數組
 * @param {object[]} signals - 信號定義數組
 * @returns {object[]} 邏輯關係列表
 */
export function detectLogicRelations(events, signals) {
  const relations = [];
  const timeToEvents = {};

  // 按時刻分組事件
  events.forEach(event => {
    if (!timeToEvents[event.time]) {
      timeToEvents[event.time] = [];
    }
    timeToEvents[event.time].push(event);
  });

  // 在每個時刻尋找關係
  Object.entries(timeToEvents).forEach(([time, eventsAtTime]) => {
    if (eventsAtTime.length >= 2) {
      // 多個信號在同一時刻發生變化
      const signalNames = [...new Set(eventsAtTime.map(e => e.signal))];

      if (signalNames.length >= 2) {
        // 檢測邊沿類型
        const risingEdges = eventsAtTime.filter(e => e.eventType === 'rising_edge');
        const fallingEdges = eventsAtTime.filter(e => e.eventType === 'falling_edge');

        if (risingEdges.length >= 2) {
          relations.push({
            type: 'simultaneous_rising_edges',
            signals: risingEdges.map(e => e.signal),
            time: parseInt(time),
            description: `${risingEdges.map(e => e.signal).join(', ')} 在同一時刻上升`
          });
        }

        if (fallingEdges.length >= 2) {
          relations.push({
            type: 'simultaneous_falling_edges',
            signals: fallingEdges.map(e => e.signal),
            time: parseInt(time),
            description: `${fallingEdges.map(e => e.signal).join(', ')} 在同一時刻下降`
          });
        }

        if (risingEdges.length > 0 && fallingEdges.length > 0) {
          relations.push({
            type: 'mixed_edges',
            rising: risingEdges.map(e => e.signal),
            falling: fallingEdges.map(e => e.signal),
            time: parseInt(time),
            description: `${risingEdges.map(e => e.signal).join(', ')} 上升; ${fallingEdges.map(e => e.signal).join(', ')} 下降`
          });
        }
      }
    }
  });

  return relations;
}

/**
 * 檢測 Setup Time 約束
 * Data 必須在 Clock 邊沿之前的時間內保持穩定
 * @param {object[]} events - 時序事件
 * @param {string[]} clockSignals - 時鐘信號名稱
 * @param {number} setupMargin - Setup time 邊界（時間單位）
 * @returns {object[]} Setup time 約束
 */
export function detectSetupTimeConstraints(events, clockSignals, setupMargin = 2) {
  const constraints = [];

  // 找所有時鐘邊沿
  const clockEdges = events.filter(e =>
    clockSignals.includes(e.signal) &&
    (e.eventType === 'rising_edge' || e.eventType === 'falling_edge')
  );

  // 對每個時鐘邊沿，檢查之前的數據變化
  clockEdges.forEach((clockEdge, idx) => {
    // 在時鐘邊沿前 setupMargin 時間單位內尋找數據變化
    const setupWindow = events.filter(e =>
      e.time < clockEdge.time &&
      e.time >= clockEdge.time - setupMargin &&
      !clockSignals.includes(e.signal) &&
      (e.eventType === 'data_change' || e.eventType === 'state')
    );

    setupWindow.forEach(dataEvent => {
      const setupTime = clockEdge.time - dataEvent.time;

      // 檢查是否違反 setup time（數據在時鐘邊沿前足夠提前）
      constraints.push({
        type: 'setup_time',
        dataSignal: dataEvent.signal,
        clockSignal: clockEdge.signal,
        clockEdge: clockEdge.eventType,
        setupTime: setupTime,
        dataTime: dataEvent.time,
        clockTime: clockEdge.time,
        description: `${dataEvent.signal} → ${clockEdge.signal} (${clockEdge.eventType}): setup = ${setupTime} ns`,
        violation: setupTime < setupMargin
      });
    });
  });

  return constraints;
}

/**
 * 檢測 Hold Time 約束
 * Data 必須在 Clock 邊沿之後保持穩定
 * @param {object[]} events - 時序事件
 * @param {string[]} clockSignals - 時鐘信號名稱
 * @param {number} holdMargin - Hold time 邊界
 * @returns {object[]} Hold time 約束
 */
export function detectHoldTimeConstraints(events, clockSignals, holdMargin = 2) {
  const constraints = [];

  const clockEdges = events.filter(e =>
    clockSignals.includes(e.signal) &&
    (e.eventType === 'rising_edge' || e.eventType === 'falling_edge')
  );

  clockEdges.forEach((clockEdge) => {
    // 在時鐘邊沿後 holdMargin 時間內尋找數據變化
    const holdWindow = events.filter(e =>
      e.time > clockEdge.time &&
      e.time <= clockEdge.time + holdMargin &&
      !clockSignals.includes(e.signal) &&
      (e.eventType === 'data_change' || e.eventType === 'state')
    );

    holdWindow.forEach(dataEvent => {
      const holdTime = dataEvent.time - clockEdge.time;

      constraints.push({
        type: 'hold_time',
        dataSignal: dataEvent.signal,
        clockSignal: clockEdge.signal,
        clockEdge: clockEdge.eventType,
        holdTime: holdTime,
        clockTime: clockEdge.time,
        dataTime: dataEvent.time,
        description: `${clockEdge.signal} (${clockEdge.eventType}) → ${dataEvent.signal}: hold = ${holdTime} ns`,
        violation: holdTime < holdMargin
      });
    });
  });

  return constraints;
}

/**
 * 檢測信號序列（特定順序的信號轉換）
 * @param {object[]} events - 時序事件
 * @param {number} maxSequenceLength - 最大序列長度
 * @returns {object[]} 檢測到的序列
 */
export function detectSequences(events, maxSequenceLength = 5) {
  const sequences = [];
  const sequenceMap = new Map();

  // 按時間排序事件
  const sortedEvents = [...events].sort((a, b) => a.time - b.time);

  // 滑動窗口方法：掃描事件流尋找實際出現的序列
  for (let seqLen = 2; seqLen <= Math.min(maxSequenceLength, Math.min(10, sortedEvents.length)); seqLen++) {
    for (let i = 0; i <= sortedEvents.length - seqLen; i++) {
      // 檢查窗口內是否有重複信號
      const window = sortedEvents.slice(i, i + seqLen);
      const signalsInWindow = window.map(e => e.signal);

      // 跳過有重複信號的序列
      if (new Set(signalsInWindow).size !== signalsInWindow.length) {
        continue;
      }

      // 建立序列鍵
      const sequenceKey = signalsInWindow.join('→');

      if (!sequenceMap.has(sequenceKey)) {
        sequenceMap.set(sequenceKey, []);
      }

      // 計算序列的時間範圍
      const duration = window[window.length - 1].time - window[0].time;

      sequenceMap.get(sequenceKey).push({
        startTime: window[0].time,
        endTime: window[window.length - 1].time,
        duration,
        signals: signalsInWindow
      });
    }
  }

  // 轉換序列映射為輸出格式
  for (const [sequenceKey, occurrences] of sequenceMap.entries()) {
    const signals = sequenceKey.split('→');
    sequences.push({
      type: 'signal_sequence',
      signals,
      occurrences: occurrences.length,
      timings: occurrences,
      description: `序列: ${signals.join(' → ')} (出現 ${occurrences.length} 次)`
    });
  }

  // 按出現次數排序
  sequences.sort((a, b) => b.occurrences - a.occurrences);

  return sequences;
}

/**
 * 檢測因果關係（一個信號的轉換導致另一個信號轉換）
 * @param {object[]} events - 時序事件
 * @param {number} maxDelay - 最大因果延遲
 * @returns {object[]} 因果關係
 */
export function detectImplications(events, maxDelay = 5) {
  const implications = [];
  const eventsBySignal = {};

  // 按信號分組事件
  events.forEach(event => {
    if (!eventsBySignal[event.signal]) {
      eventsBySignal[event.signal] = [];
    }
    eventsBySignal[event.signal].push(event);
  });

  const signals = Object.keys(eventsBySignal);
  const uniqueImplications = new Map(); // 去重用

  // 只檢查信號對一次（優化：避免對稱檢查）
  for (let i = 0; i < signals.length; i++) {
    const signal1 = signals[i];
    const events1 = eventsBySignal[signal1];

    for (let j = 0; j < signals.length; j++) {
      if (i === j) continue;

      const signal2 = signals[j];
      const events2 = eventsBySignal[signal2];
      const pairKey = `${signal1}→${signal2}`;

      // 快速一致性檢查：計算events1中有多少導致events2轉換
      let totalMatches = 0;
      let bestMatch = null;

      for (const event1 of events1) {
        const followingInRange = events2.filter(e =>
          e.time > event1.time &&
          e.time <= event1.time + maxDelay
        );

        if (followingInRange.length > 0) {
          totalMatches += followingInRange.length;
          if (!bestMatch || followingInRange[0].time - event1.time < bestMatch.delay) {
            bestMatch = {
              event: followingInRange[0],
              delay: followingInRange[0].time - event1.time,
              count: followingInRange.length
            };
          }
        }
      }

      // 計算一致性並檢查是否超過閾值
      if (bestMatch) {
        const consistency = totalMatches / (events1.length * events2.length);

        if (consistency > 0.3 && !uniqueImplications.has(pairKey)) {
          uniqueImplications.set(pairKey, {
            type: 'implication',
            antecedent: signal1,
            antecedentEvent: 'rising_edge',
            consequent: signal2,
            consequentEvent: bestMatch.event.eventType,
            delay: bestMatch.delay,
            occurrences: totalMatches,
            consistency: (consistency * 100).toFixed(1) + '%',
            description: `${signal1} |-> ${signal2} [延遲: ${bestMatch.delay}ns, 一致性: ${(consistency * 100).toFixed(1)}%]`
          });
        }
      }
    }
  }

  return Array.from(uniqueImplications.values());
}

/**
 * 檢測 Clock-to-Q 延遲（時鐘到輸出的延遲）
 * @param {object[]} events - 時序事件
 * @param {string[]} clockSignals - 時鐘信號
 * @returns {object[]} CtoQ 延遲
 */
export function detectClockToQDelay(events, clockSignals) {
  const delays = [];
  const clockEdges = events.filter(e =>
    clockSignals.includes(e.signal) &&
    (e.eventType === 'rising_edge' || e.eventType === 'falling_edge')
  );

  clockEdges.forEach(clockEdge => {
    // 找時鐘邊沿後的數據變化（輸出）
    const outputChanges = events.filter(e =>
      e.time > clockEdge.time &&
      e.time <= clockEdge.time + 5 &&
      !clockSignals.includes(e.signal) &&
      e.eventType === 'data_change'
    );

    outputChanges.forEach(output => {
      const ctqDelay = output.time - clockEdge.time;

      delays.push({
        type: 'clock_to_q',
        clockSignal: clockEdge.signal,
        clockEdge: clockEdge.eventType,
        outputSignal: output.signal,
        delay: ctqDelay,
        clockTime: clockEdge.time,
        outputTime: output.time,
        description: `${clockEdge.signal} (${clockEdge.eventType}) → ${output.signal}: CtoQ = ${ctqDelay} ns`
      });
    });
  });

  return delays;
}

/**
 * 執行完整的時序分析
 * @param {object} analysis - parseWavedrom 的結果
 * @param {object} config - 配置選項
 * @returns {object} 完整的分析結果
 */
/**
 * 檢測禁止轉移（Forbidden Transitions）
 * 某些信號對不應同時發生邊沿
 * @param {object[]} events - 時序事件
 * @param {object[]} forbiddenPairs - 禁止轉移對 [{signal1, signal2}, ...]
 * @returns {object[]} 違規檢測結果
 */
export function detectForbiddenTransitions(events, forbiddenPairs = []) {
  const violations = [];

  if (!forbiddenPairs || forbiddenPairs.length === 0) {
    return violations;
  }

  // 按時刻分組事件以快速查找同時邊沿
  const timeToEvents = {};
  events.forEach(event => {
    if (!timeToEvents[event.time]) {
      timeToEvents[event.time] = [];
    }
    timeToEvents[event.time].push(event);
  });

  // 檢查每個禁止對
  forbiddenPairs.forEach(pair => {
    // 尋找兩個信號同時發生的邊沿
    Object.entries(timeToEvents).forEach(([time, eventsAtTime]) => {
      const sig1Events = eventsAtTime.filter(e => e.signal === pair.signal1);
      const sig2Events = eventsAtTime.filter(e => e.signal === pair.signal2);

      if (sig1Events.length > 0 && sig2Events.length > 0) {
        violations.push({
          type: 'forbidden_transition',
          signals: [pair.signal1, pair.signal2],
          time: parseInt(time),
          sig1_edge: sig1Events[0].eventType,
          sig2_edge: sig2Events[0].eventType,
          severity: 'critical',
          description: `${pair.signal1} (${sig1Events[0].eventType}) 和 ${pair.signal2} (${sig2Events[0].eventType}) 在時刻 ${time} 同時轉移`
        });
      }

      // 也檢查接近的時刻（時間窗口內）
      const timeNum = parseInt(time);
      for (let offset = 1; offset <= 2; offset++) {
        const nearbyTime = timeNum + offset;
        if (timeToEvents[nearbyTime]) {
          const nearbyEventsTime = timeToEvents[nearbyTime];
          const nearbySig1 = nearbyEventsTime.filter(e => e.signal === pair.signal1);
          const nearbySig2 = nearbyEventsTime.filter(e => e.signal === pair.signal2);

          if (sig1Events.length > 0 && nearbySig2.length > 0) {
            violations.push({
              type: 'forbidden_transition_near',
              signals: [pair.signal1, pair.signal2],
              time1: timeNum,
              time2: nearbyTime,
              distance: offset,
              severity: 'warning',
              description: `${pair.signal1} 和 ${pair.signal2} 在相近時刻轉移（距離 ${offset} 個時間單位）`
            });
          }
        }
      }
    });
  });

  return violations;
}

/**
 * 檢測關鍵路徑（Critical Path）
 * 找出最長的組合邏輯路徑
 * @param {object[]} events - 時序事件
 * @param {string[]} clockSignals - 時鐘信號名稱
 * @returns {object[]} 關鍵路徑分析結果
 */
export function detectCriticalPaths(events, clockSignals = []) {
  const paths = [];

  if (!clockSignals || clockSignals.length === 0) {
    return paths;
  }

  // 找所有時鐘邊沿
  const clockEdges = events.filter(e =>
    clockSignals.includes(e.signal) &&
    (e.eventType === 'rising_edge' || e.eventType === 'falling_edge')
  ).sort((a, b) => a.time - b.time);

  if (clockEdges.length < 2) {
    return paths;
  }

  // 計算相鄰時鐘邊沿之間的路徑
  for (let i = 0; i < clockEdges.length - 1; i++) {
    const clockPeriodStart = clockEdges[i];
    const clockPeriodEnd = clockEdges[i + 1];
    const period = clockPeriodEnd.time - clockPeriodStart.time;

    // 找該週期內所有非時鐘信號的邊沿
    const pathEvents = events.filter(e =>
      e.time > clockPeriodStart.time &&
      e.time <= clockPeriodEnd.time &&
      !clockSignals.includes(e.signal) &&
      (e.eventType === 'rising_edge' || e.eventType === 'falling_edge')
    ).sort((a, b) => a.time - b.time);

    if (pathEvents.length > 0) {
      const lastEvent = pathEvents[pathEvents.length - 1];
      const delay = clockPeriodEnd.time - lastEvent.time;
      const slack = delay; // 從最後邊沿到時鐘邊沿的時間

      paths.push({
        period_index: i,
        clock_period: period,
        path_events: pathEvents.map(e => ({
          signal: e.signal,
          time: e.time,
          type: e.eventType
        })),
        path_length: pathEvents.length,
        max_delay: period - slack,
        slack: slack,
        criticality: slack < period * 0.1 ? 'critical' : slack < period * 0.3 ? 'warning' : 'safe',
        description: slack < 0
          ? `關鍵：時序違規，延遲超過時鐘週期 ${Math.abs(slack)} 個單位`
          : `時序安全，裕度 ${slack} 個單位`
      });
    }
  }

  return paths;
}

/**
 * 檢測時鐘偏差（Clock Skew）
 * 分析多個時鐘信號之間的時序差異
 * @param {object[]} events - 時序事件
 * @param {string[]} clockSignals - 時鐘信號名稱
 * @returns {object} 時鐘偏差分析結果
 */
export function detectClockSkew(events, clockSignals = []) {
  const skewAnalysis = {
    clock_signals: clockSignals,
    edge_analysis: [],
    max_skew: 0,
    average_skew: 0,
    skew_violations: []
  };

  if (!clockSignals || clockSignals.length < 2) {
    return skewAnalysis;
  }

  // 為每個時鐘信號收集上升沿事件
  const clockEventsBySignal = {};
  for (const clk of clockSignals) {
    clockEventsBySignal[clk] = events.filter(e =>
      e.signal === clk &&
      e.eventType === 'rising_edge'
    ).sort((a, b) => a.time - b.time);
  }

  // 比較相應邊沿的時序
  const maxEdges = Math.min(...clockSignals.map(c => clockEventsBySignal[c].length));

  for (let edgeIdx = 0; edgeIdx < maxEdges; edgeIdx++) {
    const edgeTimes = {};
    let minTime = Infinity;
    let maxTime = -Infinity;

    clockSignals.forEach(clk => {
      const edgeTime = clockEventsBySignal[clk][edgeIdx].time;
      edgeTimes[clk] = edgeTime;
      minTime = Math.min(minTime, edgeTime);
      maxTime = Math.max(maxTime, edgeTime);
    });

    const edgeSkew = maxTime - minTime;

    skewAnalysis.edge_analysis.push({
      edge_index: edgeIdx,
      times: edgeTimes,
      skew: edgeSkew,
      severity: edgeSkew > 5 ? 'critical' : edgeSkew > 2 ? 'warning' : 'safe'
    });

    skewAnalysis.max_skew = Math.max(skewAnalysis.max_skew, edgeSkew);

    if (edgeSkew > 5) {
      skewAnalysis.skew_violations.push({
        edge_index: edgeIdx,
        max_skew: edgeSkew,
        description: `第 ${edgeIdx} 個邊沿的時鐘偏差 ${edgeSkew} 個單位，超過閾值 5`
      });
    }
  }

  // 計算平均偏差
  if (skewAnalysis.edge_analysis.length > 0) {
    const totalSkew = skewAnalysis.edge_analysis.reduce((sum, e) => sum + e.skew, 0);
    skewAnalysis.average_skew = totalSkew / skewAnalysis.edge_analysis.length;
  }

  return skewAnalysis;
}

export function performFullTimingAnalysis(analysis, config = {}) {
  const setupMargin = config.setupMargin || 2;
  const holdMargin = config.holdMargin || 2;
  const maxDelay = config.maxDelay || 5;

  const logicRelations = detectLogicRelations(analysis.events, analysis.signals);
  const setupConstraints = detectSetupTimeConstraints(
    analysis.events,
    analysis.clockSignals,
    setupMargin
  );
  const holdConstraints = detectHoldTimeConstraints(
    analysis.events,
    analysis.clockSignals,
    holdMargin
  );
  const sequences = detectSequences(analysis.events, config.maxSequenceLength || 5);
  const implications = detectImplications(analysis.events, maxDelay);
  const ctqDelays = detectClockToQDelay(analysis.events, analysis.clockSignals);

  // Phase 5F: Advanced analysis
  const forbiddenTransitions = detectForbiddenTransitions(
    analysis.events,
    config.forbiddenPairs || []
  );
  const criticalPaths = detectCriticalPaths(
    analysis.events,
    analysis.clockSignals
  );
  const clockSkew = detectClockSkew(
    analysis.events,
    analysis.clockSignals
  );

  // 統計違規
  const setupViolations = setupConstraints.filter(c => c.violation).length;
  const holdViolations = holdConstraints.filter(c => c.violation).length;
  const forbiddenViolations = forbiddenTransitions.filter(v => v.type === 'forbidden_transition').length;
  const criticalPathViolations = criticalPaths.filter(p => p.slack < 0).length;
  const clockSkewViolations = clockSkew.skew_violations.length;

  return {
    logic_relations: logicRelations,
    setup_time_constraints: setupConstraints,
    hold_time_constraints: holdConstraints,
    signal_sequences: sequences,
    implications: implications,
    clock_to_q_delays: ctqDelays,
    forbidden_transitions: forbiddenTransitions,
    critical_paths: criticalPaths,
    clock_skew: clockSkew,
    statistics: {
      total_logic_relations: logicRelations.length,
      total_setup_constraints: setupConstraints.length,
      setup_violations: setupViolations,
      total_hold_constraints: holdConstraints.length,
      hold_violations: holdViolations,
      total_sequences: sequences.length,
      total_implications: implications.length,
      total_ctq_measurements: ctqDelays.length,
      forbidden_transition_violations: forbiddenViolations,
      critical_path_violations: criticalPathViolations,
      clock_skew_violations: clockSkewViolations
    },
    has_violations: setupViolations > 0 || holdViolations > 0 || forbiddenViolations > 0 || criticalPathViolations > 0 || clockSkewViolations > 0
  };
}

/**
 * 輔助函數：生成組合
 */
function generateCombinations(arr, len, start = 0, current = []) {
  if (current.length === len) {
    return [current.slice()];
  }

  const result = [];
  for (let i = start; i < arr.length; i++) {
    current.push(arr[i]);
    result.push(...generateCombinations(arr, len, i + 1, current));
    current.pop();
  }

  return result;
}

/**
 * 輔助函數：尋找序列出現
 */
function findSequenceOccurrences(events, signalSequence, signalEvents) {
  const occurrences = [];
  let currentIdx = 0;

  // 簡單的序列匹配算法
  for (const event of events) {
    if (event.signal === signalSequence[currentIdx]) {
      if (currentIdx === 0) {
        const timing = [event.time];

        // 檢查後續信號
        let matched = true;
        let eventIdx = events.indexOf(event) + 1;
        for (let i = 1; i < signalSequence.length && eventIdx < events.length; i++) {
          const nextSignal = signalSequence[i];
          while (eventIdx < events.length && events[eventIdx].signal !== nextSignal) {
            eventIdx++;
          }

          if (eventIdx < events.length) {
            timing.push(events[eventIdx].time);
            eventIdx++;
          } else {
            matched = false;
            break;
          }
        }

        if (matched && timing.length === signalSequence.length) {
          occurrences.push({
            start_time: timing[0],
            timings: timing,
            duration: timing[timing.length - 1] - timing[0]
          });
        }
      }
    }
  }

  return occurrences;
}
