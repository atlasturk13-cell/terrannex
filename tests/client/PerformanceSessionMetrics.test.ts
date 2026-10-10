import { describe, expect, test, vi } from "vitest";
import {
  HeapMetricsRecorder,
  LongTaskMetricsRecorder,
  MAX_RAW_FRAME_SAMPLES,
  nearestRankPercentile,
  PerformanceObserverConstructorLike,
  RawFrameMetricsRecorder,
} from "../../src/client/hud/PerformanceSessionMetrics";

describe("RawFrameMetricsRecorder", () => {
  test("reports exact nearest-rank p95, buckets, worst, and average FPS", () => {
    const recorder = new RawFrameMetricsRecorder(10);
    recorder.reset(100);
    for (const frameMs of [10, 15, 20, 25, 26, 30, 40, 50, 80, 81]) {
      recorder.record(frameMs);
    }

    expect(recorder.snapshot(1100)).toEqual({
      elapsedMs: 1000,
      sampleCount: 10,
      capacity: 10,
      averageFps: (10 * 1000) / 377,
      p95FrameMs: 81,
      worstNonLoadingFrameMs: 81,
      over25MsCount: 6,
      over80MsCount: 1,
      isCapacityReached: true,
    });
  });

  test("reset clears every measurement and invalid samples are ignored", () => {
    const recorder = new RawFrameMetricsRecorder(3);
    recorder.record(99);
    expect(recorder.snapshot(0).sampleCount).toBe(0);

    recorder.reset(0);
    recorder.record(20);
    recorder.record(Number.NaN);
    recorder.record(0);
    recorder.reset(500);

    expect(recorder.snapshot(750)).toEqual({
      elapsedMs: 250,
      sampleCount: 0,
      capacity: 3,
      averageFps: null,
      p95FrameMs: null,
      worstNonLoadingFrameMs: null,
      over25MsCount: 0,
      over80MsCount: 0,
      isCapacityReached: false,
    });
  });

  test("never retains more than the configured 15-minute capacity", () => {
    const recorder = new RawFrameMetricsRecorder();
    recorder.reset(0);
    for (let i = 0; i < MAX_RAW_FRAME_SAMPLES + 10; i++) {
      recorder.record(16);
    }

    const snapshot = recorder.snapshot(900_000);
    expect(snapshot.sampleCount).toBe(MAX_RAW_FRAME_SAMPLES);
    expect(snapshot.capacity).toBe(54_000);
    expect(snapshot.isCapacityReached).toBe(true);
    expect(snapshot.worstNonLoadingFrameMs).toBe(16);
  });
});

test("nearestRankPercentile selects without sorting the caller's data", () => {
  const values = new Float64Array([5, 1, 4, 2, 3]);
  expect(nearestRankPercentile(values.slice(), 0.95)).toBe(5);
  expect(nearestRankPercentile(values.slice(), 0.5)).toBe(3);
  expect(Array.from(values)).toEqual([5, 1, 4, 2, 3]);
});

describe("optional browser diagnostics", () => {
  test("uses explicit nulls when long-task and heap APIs are unsupported", () => {
    const longTasks = new LongTaskMetricsRecorder(undefined);
    longTasks.resetAndStart();
    expect(longTasks.snapshot()).toEqual({
      supported: false,
      count: null,
      durationMs: null,
    });

    const heap = new HeapMetricsRecorder();
    heap.reset({});
    expect(heap.snapshot({})).toEqual({
      supported: false,
      startBytes: null,
      endBytes: null,
      deltaBytes: null,
    });
  });

  test("counts supported long tasks and measures heap delta", () => {
    const callbackHolder: {
      value?: (list: { getEntries(): { duration: number }[] }) => void;
    } = {};
    const disconnect = vi.fn();
    class FakeObserver {
      static supportedEntryTypes = ["longtask"];
      constructor(
        nextCallback: (list: { getEntries(): { duration: number }[] }) => void,
      ) {
        callbackHolder.value = nextCallback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    }

    const longTasks = new LongTaskMetricsRecorder(
      FakeObserver as PerformanceObserverConstructorLike,
    );
    longTasks.resetAndStart();
    expect(callbackHolder.value).toBeDefined();
    callbackHolder.value?.({
      getEntries: () => [{ duration: 55 }, { duration: 82.5 }],
    });
    expect(longTasks.snapshot()).toEqual({
      supported: true,
      count: 2,
      durationMs: 137.5,
    });
    longTasks.disconnect();
    expect(disconnect).toHaveBeenCalledOnce();

    const heap = new HeapMetricsRecorder();
    heap.reset({ memory: { usedJSHeapSize: 1000 } });
    expect(heap.snapshot({ memory: { usedJSHeapSize: 1250 } })).toEqual({
      supported: true,
      startBytes: 1000,
      endBytes: 1250,
      deltaBytes: 250,
    });
  });
});
