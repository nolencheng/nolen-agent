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
  const signalEvents = {};

  // 按信號分組事件
  events.forEach(event => {
    if (!signalEvents[event.signal]) {
      signalEvents[event.signal] = [];
    }
    signalEvents[event.signal].push(event);
  });

  // 尋找信號轉換序列
  const signals = Object.keys(signalEvents);

  // 檢查所有可能的序列長度
  for (let seqLen = 2; seqLen <= Math.min(maxSequenceLength, signals.length); seqLen++) {
    // 生成所有 seqLen 長度的信號組合
    const combinations = generateCombinations(signals, seqLen);

    combinations.forEach(signalSequence => {
      // 檢查這個序列是否在事件中出現
      const sequenceOccurrences = findSequenceOccurrences(
        events,
        signalSequence,
        signalEvents
      );

      if (sequenceOccurrences.length > 0) {
        sequences.push({
          type: 'signal_sequence',
          signals: signalSequence,
          occurrences: sequenceOccurrences.length,
          timings: sequenceOccurrences,
          description: `序列: ${signalSequence.join(' → ')} (出現 ${sequenceOccurrences.length} 次)`
        });
      }
    });
  }

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

  events.forEach(event => {
    if (!eventsBySignal[event.signal]) {
      eventsBySignal[event.signal] = [];
    }
    eventsBySignal[event.signal].push(event);
  });

  const signals = Object.keys(eventsBySignal);

  // 檢查每對信號之間的關係
  for (let i = 0; i < signals.length; i++) {
    for (let j = 0; j < signals.length; j++) {
      if (i === j) continue;

      const signal1 = signals[i];
      const signal2 = signals[j];
      const events1 = eventsBySignal[signal1];
      const events2 = eventsBySignal[signal2];

      // 檢查 signal1 的每個事件是否導致 signal2 的後續事件
      events1.forEach((event1, idx1) => {
        // 尋找在 event1 之後發生的 signal2 事件
        const followingEvents = events2.filter(e =>
          e.time > event1.time &&
          e.time <= event1.time + maxDelay
        );

        if (followingEvents.length > 0) {
          const followingEvent = followingEvents[0]; // 取最近的後續事件
          const delay = followingEvent.time - event1.time;
          const frequency = followingEvents.length;

          // 計算這個因果關係的一致性（出現頻率）
          const consistency = frequency / Math.max(events1.length, events2.length);

          if (consistency > 0.3) { // 至少 30% 的一致性
            implications.push({
              type: 'implication',
              antecedent: signal1,
              antecedentEvent: event1.eventType,
              consequent: signal2,
              consequentEvent: followingEvent.eventType,
              delay: delay,
              occurrences: frequency,
              consistency: (consistency * 100).toFixed(1) + '%',
              description: `${signal1} (${event1.eventType}) |-> ${signal2} (${followingEvent.eventType}) [延遲: ${delay}ns, 一致性: ${(consistency * 100).toFixed(1)}%]`
            });
          }
        }
      });
    }
  }

  // 去重複
  return implications.filter((v, i, a) =>
    a.findIndex(t =>
      t.antecedent === v.antecedent &&
      t.consequent === v.consequent &&
      t.delay === v.delay
    ) === i
  );
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

  // 統計違規
  const setupViolations = setupConstraints.filter(c => c.violation).length;
  const holdViolations = holdConstraints.filter(c => c.violation).length;

  return {
    logic_relations: logicRelations,
    setup_time_constraints: setupConstraints,
    hold_time_constraints: holdConstraints,
    signal_sequences: sequences,
    implications: implications,
    clock_to_q_delays: ctqDelays,
    statistics: {
      total_logic_relations: logicRelations.length,
      total_setup_constraints: setupConstraints.length,
      setup_violations: setupViolations,
      total_hold_constraints: holdConstraints.length,
      hold_violations: holdViolations,
      total_sequences: sequences.length,
      total_implications: implications.length,
      total_ctq_measurements: ctqDelays.length
    },
    has_violations: setupViolations > 0 || holdViolations > 0
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
