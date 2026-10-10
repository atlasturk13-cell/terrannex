export const MAX_RAW_FRAME_SAMPLES = 15 * 60 * 60;

export interface RawFrameMetricsSnapshot {
  elapsedMs: number;
  sampleCount: number;
  capacity: number;
  averageFps: number | null;
  p95FrameMs: number | null;
  worstNonLoadingFrameMs: number | null;
  over25MsCount: number;
  over80MsCount: number;
  isCapacityReached: boolean;
}

/**
 * Fixed-capacity recorder for a single reset-to-snapshot measurement window.
 * Recording stops at the capacity instead of shifting the array, so the RAF
 * hot path is one numeric write plus scalar arithmetic with no allocations.
 */
export class RawFrameMetricsRecorder {
  private readonly samples: Float64Array;
  private startedAtMs: number | null = null;
  private count = 0;
  private sumMs = 0;
  private worstMs = 0;
  private over25MsCount = 0;
  private over80MsCount = 0;

  constructor(capacity: number = MAX_RAW_FRAME_SAMPLES) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("Raw frame sample capacity must be a positive integer");
    }
    this.samples = new Float64Array(capacity);
  }

  reset(nowMs: number): void {
    this.startedAtMs = nowMs;
    this.count = 0;
    this.sumMs = 0;
    this.worstMs = 0;
    this.over25MsCount = 0;
    this.over80MsCount = 0;
  }

  isRecording(): boolean {
    return this.startedAtMs !== null;
  }

  record(frameIntervalMs: number): void {
    if (
      this.startedAtMs === null ||
      this.count >= this.samples.length ||
      !Number.isFinite(frameIntervalMs) ||
      frameIntervalMs <= 0
    ) {
      return;
    }

    this.samples[this.count++] = frameIntervalMs;
    this.sumMs += frameIntervalMs;
    this.worstMs = Math.max(this.worstMs, frameIntervalMs);
    if (frameIntervalMs > 25) this.over25MsCount++;
    if (frameIntervalMs > 80) this.over80MsCount++;
  }

  snapshot(nowMs: number): RawFrameMetricsSnapshot {
    const elapsedMs =
      this.startedAtMs === null ? 0 : Math.max(0, nowMs - this.startedAtMs);
    const p95FrameMs =
      this.count === 0
        ? null
        : nearestRankPercentile(this.samples.slice(0, this.count), 0.95);

    return {
      elapsedMs,
      sampleCount: this.count,
      capacity: this.samples.length,
      averageFps:
        this.count === 0 || this.sumMs <= 0
          ? null
          : (this.count * 1000) / this.sumMs,
      p95FrameMs,
      // The first interval after enabling/reset is initialization-only in the
      // overlay, so every recorded interval is post-load measurement data.
      worstNonLoadingFrameMs: this.count === 0 ? null : this.worstMs,
      over25MsCount: this.over25MsCount,
      over80MsCount: this.over80MsCount,
      isCapacityReached: this.count === this.samples.length,
    };
  }
}

/** Nearest-rank percentile using duplicate-safe in-place quickselect. */
export function nearestRankPercentile(
  values: Float64Array,
  percentile: number,
): number | null {
  if (values.length === 0) return null;
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) {
    throw new Error("Percentile must be between 0 and 1");
  }

  const rank = Math.max(0, Math.ceil(percentile * values.length) - 1);
  return quickselect(values, rank);
}

function quickselect(values: Float64Array, rank: number): number {
  let left = 0;
  let right = values.length - 1;

  while (left <= right) {
    const middle = (left + right) >>> 1;
    const pivotValue = medianOfThree(
      values[left],
      values[middle],
      values[right],
    );
    let lower = left;
    let cursor = left;
    let upper = right;

    // Three-way partition prevents equal frame intervals (common at vsync)
    // from degrading quickselect into repeated full-buffer scans.
    while (cursor <= upper) {
      if (values[cursor] < pivotValue) {
        swap(values, lower++, cursor++);
      } else if (values[cursor] > pivotValue) {
        swap(values, cursor, upper--);
      } else {
        cursor++;
      }
    }

    if (rank < lower) right = lower - 1;
    else if (rank > upper) left = upper + 1;
    else return pivotValue;
  }

  return values[rank];
}

function medianOfThree(a: number, b: number, c: number): number {
  if (a < b) {
    if (b < c) return b;
    return a < c ? c : a;
  }
  if (a < c) return a;
  return b < c ? c : b;
}

function swap(values: Float64Array, a: number, b: number): void {
  const value = values[a];
  values[a] = values[b];
  values[b] = value;
}

export interface LongTaskMetricsSnapshot {
  supported: boolean;
  count: number | null;
  durationMs: number | null;
}

interface PerformanceEntryLike {
  duration: number;
}

interface PerformanceObserverEntryListLike {
  getEntries(): PerformanceEntryLike[];
}

interface PerformanceObserverLike {
  observe(options: { type: string; buffered: boolean }): void;
  disconnect(): void;
}

export interface PerformanceObserverConstructorLike {
  new (
    callback: (entries: PerformanceObserverEntryListLike) => void,
  ): PerformanceObserverLike;
  supportedEntryTypes?: readonly string[];
}

export class LongTaskMetricsRecorder {
  private observer: PerformanceObserverLike | null = null;
  private count = 0;
  private durationMs = 0;

  constructor(
    private readonly Observer: PerformanceObserverConstructorLike | undefined,
  ) {}

  isSupported(): boolean {
    return (
      this.Observer !== undefined &&
      this.Observer.supportedEntryTypes?.includes("longtask") === true
    );
  }

  resetAndStart(): void {
    this.disconnect();
    this.count = 0;
    this.durationMs = 0;
    this.resume();
  }

  resume(): void {
    if (!this.isSupported() || this.observer !== null || !this.Observer) return;
    this.observer = new this.Observer((list) => {
      for (const entry of list.getEntries()) {
        this.count++;
        this.durationMs += entry.duration;
      }
    });
    this.observer.observe({ type: "longtask", buffered: false });
  }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  snapshot(): LongTaskMetricsSnapshot {
    if (!this.isSupported()) {
      return { supported: false, count: null, durationMs: null };
    }
    return { supported: true, count: this.count, durationMs: this.durationMs };
  }
}

interface MemoryInfoLike {
  usedJSHeapSize: number;
}

export interface PerformanceWithMemoryLike {
  memory?: MemoryInfoLike;
}

export interface HeapMetricsSnapshot {
  supported: boolean;
  startBytes: number | null;
  endBytes: number | null;
  deltaBytes: number | null;
}

export class HeapMetricsRecorder {
  private startBytes: number | null = null;

  reset(performanceObject: unknown): void {
    this.startBytes = readHeapBytes(performanceObject);
  }

  snapshot(performanceObject: unknown): HeapMetricsSnapshot {
    const endBytes = readHeapBytes(performanceObject);
    if (this.startBytes === null || endBytes === null) {
      return {
        supported: false,
        startBytes: null,
        endBytes: null,
        deltaBytes: null,
      };
    }

    return {
      supported: true,
      startBytes: this.startBytes,
      endBytes,
      deltaBytes: endBytes - this.startBytes,
    };
  }
}

function readHeapBytes(performanceObject: unknown): number | null {
  const bytes = (performanceObject as PerformanceWithMemoryLike | null)?.memory
    ?.usedJSHeapSize;
  return typeof bytes === "number" && Number.isFinite(bytes) ? bytes : null;
}
