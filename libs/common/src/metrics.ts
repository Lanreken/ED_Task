/**
 * Metrics Collection System
 * 
 * Provides counters, gauges, and histograms for monitoring service health.
 */

export type MetricType = 'counter' | 'gauge' | 'histogram';

export type MetricLabels = Record<string, string | number>;

export interface MetricSample {
  name: string;
  type: MetricType;
  value: number;
  labels?: MetricLabels;
  timestamp: number;
}

export interface HistogramBucket {
  le: number; // less than or equal
  count: number;
}

export interface HistogramSample {
  name: string;
  type: 'histogram';
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  labels?: MetricLabels;
  timestamp: number;
}

/**
 * Counter - A monotonically increasing value
 */
export class Counter {
  private value = 0;
  private labels?: MetricLabels;

  constructor(
    public readonly name: string,
    public readonly description: string,
    labels?: MetricLabels
  ) {
    this.labels = labels;
  }

  inc(amount = 1): void {
    this.value += amount;
  }

  get(): number {
    return this.value;
  }

  toSample(): MetricSample {
    return {
      name: this.name,
      type: 'counter',
      value: this.value,
      labels: this.labels,
      timestamp: Date.now(),
    };
  }
}

/**
 * Gauge - A value that can go up or down
 */
export class Gauge {
  private value = 0;
  private labels?: MetricLabels;

  constructor(
    public readonly name: string,
    public readonly description: string,
    labels?: MetricLabels
  ) {
    this.labels = labels;
  }

  set(value: number): void {
    this.value = value;
  }

  inc(amount = 1): void {
    this.value += amount;
  }

  dec(amount = 1): void {
    this.value -= amount;
  }

  get(): number {
    return this.value;
  }

  toSample(): MetricSample {
    return {
      name: this.name,
      type: 'gauge',
      value: this.value,
      labels: this.labels,
      timestamp: Date.now(),
    };
  }
}

/**
 * Histogram - Tracks distribution of values
 */
export class Histogram {
  private buckets: number[];
  private bucketCounts: Map<number, number>;
  private sum = 0;
  private count = 0;
  private labels?: MetricLabels;

  constructor(
    public readonly name: string,
    public readonly description: string,
    bucketBoundaries: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    labels?: MetricLabels
  ) {
    this.buckets = bucketBoundaries;
    this.bucketCounts = new Map();
    this.buckets.forEach(b => this.bucketCounts.set(b, 0));
    this.bucketCounts.set(Infinity, 0);
    this.labels = labels;
  }

  observe(value: number): void {
    this.sum += value;
    this.count++;

    for (const bucket of this.buckets) {
      if (value <= bucket) {
        this.bucketCounts.set(bucket, (this.bucketCounts.get(bucket) || 0) + 1);
      }
    }
    this.bucketCounts.set(Infinity, (this.bucketCounts.get(Infinity) || 0) + 1);
  }

  toSample(): HistogramSample {
    const buckets: HistogramBucket[] = this.buckets.map(le => ({
      le,
      count: this.bucketCounts.get(le) || 0,
    }));

    return {
      name: this.name,
      type: 'histogram',
      buckets,
      sum: this.sum,
      count: this.count,
      labels: this.labels,
      timestamp: Date.now(),
    };
  }
}

/**
 * Metrics Registry - Central place for all metrics
 */
export class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();
  private serviceLabel: string;

  constructor(serviceName: string) {
    this.serviceLabel = serviceName;
  }

  // Counter methods
  createCounter(name: string, description: string, labels?: MetricLabels): Counter {
    const key = this.makeKey(name, labels);
    if (!this.counters.has(key)) {
      this.counters.set(key, new Counter(name, description, { ...labels, service: this.serviceLabel }));
    }
    return this.counters.get(key)!;
  }

  getCounter(name: string, labels?: MetricLabels): Counter | undefined {
    const key = this.makeKey(name, labels);
    return this.counters.get(key);
  }

  // Gauge methods
  createGauge(name: string, description: string, labels?: MetricLabels): Gauge {
    const key = this.makeKey(name, labels);
    if (!this.gauges.has(key)) {
      this.gauges.set(key, new Gauge(name, description, { ...labels, service: this.serviceLabel }));
    }
    return this.gauges.get(key)!;
  }

  getGauge(name: string, labels?: MetricLabels): Gauge | undefined {
    const key = this.makeKey(name, labels);
    return this.gauges.get(key);
  }

  // Histogram methods
  createHistogram(name: string, description: string, buckets?: number[], labels?: MetricLabels): Histogram {
    const key = this.makeKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, new Histogram(name, description, buckets, { ...labels, service: this.serviceLabel }));
    }
    return this.histograms.get(key)!;
  }

  getHistogram(name: string, labels?: MetricLabels): Histogram | undefined {
    const key = this.makeKey(name, labels);
    return this.histograms.get(key);
  }

  private makeKey(name: string, labels?: MetricLabels): string {
    if (!labels) return name;
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  // Get all metrics
  getAllSamples(): (MetricSample | HistogramSample)[] {
    const samples: (MetricSample | HistogramSample)[] = [];
    
    this.counters.forEach(counter => samples.push(counter.toSample()));
    this.gauges.forEach(gauge => samples.push(gauge.toSample()));
    this.histograms.forEach(histogram => samples.push(histogram.toSample()));

    return samples;
  }

  // Get metrics in Prometheus format
  toPrometheusFormat(): string {
    const lines: string[] = [];

    this.counters.forEach(counter => {
      const sample = counter.toSample();
      lines.push(`# HELP ${sample.name} ${counter.description}`);
      lines.push(`# TYPE ${sample.name} counter`);
      const labelStr = this.formatLabels(sample.labels);
      lines.push(`${sample.name}${labelStr} ${sample.value}`);
    });

    this.gauges.forEach(gauge => {
      const sample = gauge.toSample();
      lines.push(`# HELP ${sample.name} ${gauge.description}`);
      lines.push(`# TYPE ${sample.name} gauge`);
      const labelStr = this.formatLabels(sample.labels);
      lines.push(`${sample.name}${labelStr} ${sample.value}`);
    });

    this.histograms.forEach(histogram => {
      const sample = histogram.toSample();
      lines.push(`# HELP ${sample.name} ${histogram.description}`);
      lines.push(`# TYPE ${sample.name} histogram`);
      const labelStr = this.formatLabels(sample.labels);
      
      sample.buckets.forEach(bucket => {
        lines.push(`${sample.name}_bucket${labelStr}le="${bucket.le}" ${bucket.count}`);
      });
      lines.push(`${sample.name}_sum${labelStr} ${sample.sum}`);
      lines.push(`${sample.name}_count${labelStr} ${sample.count}`);
    });

    return lines.join('\n') + '\n';
  }

  private formatLabels(labels?: MetricLabels): string {
    if (!labels || Object.keys(labels).length === 0) return '';
    const parts = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`);
    return `{${parts.join(',')}}`;
  }

  // Reset all metrics
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

// Default registry for application-wide use
export const defaultMetricsRegistry = new MetricsRegistry('unknown');

/**
 * Create a metrics registry for a service
 */
export function createMetricsRegistry(serviceName: string): MetricsRegistry {
  return new MetricsRegistry(serviceName);
}

/**
 * Standard metrics that every service should have
 */
export function createStandardServiceMetrics(registry: MetricsRegistry) {
  return {
    // Request metrics
    requestsTotal: registry.createCounter('http_requests_total', 'Total number of HTTP requests'),
    requestErrorsTotal: registry.createCounter('http_request_errors_total', 'Total number of HTTP request errors'),
    requestDuration: registry.createHistogram('http_request_duration_seconds', 'HTTP request duration in seconds'),

    // Queue metrics
    queueJobsTotal: registry.createCounter('queue_jobs_total', 'Total number of queue jobs processed'),
    queueJobsFailed: registry.createCounter('queue_jobs_failed_total', 'Total number of queue jobs failed'),
    queueActiveJobs: registry.createGauge('queue_active_jobs', 'Number of currently active queue jobs'),
    queueWaitingJobs: registry.createGauge('queue_waiting_jobs', 'Number of jobs waiting in queue'),

    // Database metrics
    dbOperationsTotal: registry.createCounter('db_operations_total', 'Total number of database operations'),
    dbOperationErrors: registry.createCounter('db_operation_errors_total', 'Total number of database operation errors'),
    dbOperationDuration: registry.createHistogram('db_operation_duration_seconds', 'Database operation duration in seconds'),

    // Circuit breaker metrics
    circuitBreakerState: registry.createGauge('circuit_breaker_state', 'Circuit breaker state (0=closed, 1=open, 2=half_open)'),
  };
}