// Prometheus-style metrics collection

interface Counter {
  value: number;
  labels: Map<string, number>;
}

interface Gauge {
  value: number;
}

interface Histogram {
  sum: number;
  count: number;
  buckets: Map<number, number>;
}

class MetricsRegistry {
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();

  // Counter methods
  incCounter(name: string, labels?: Record<string, string>, value = 1): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, { value: 0, labels: new Map() });
    }
    const counter = this.counters.get(name)!;

    if (labels) {
      const key = Object.entries(labels).sort().map(([k, v]) => `${k}="${v}"`).join(",");
      counter.labels.set(key, (counter.labels.get(key) || 0) + value);
    } else {
      counter.value += value;
    }
  }

  getCounter(name: string): number {
    return this.counters.get(name)?.value || 0;
  }

  // Gauge methods
  setGauge(name: string, value: number): void {
    this.gauges.set(name, { value });
  }

  incGauge(name: string, value = 1): void {
    const current = this.gauges.get(name)?.value || 0;
    this.gauges.set(name, { value: current + value });
  }

  decGauge(name: string, value = 1): void {
    const current = this.gauges.get(name)?.value || 0;
    this.gauges.set(name, { value: current - value });
  }

  getGauge(name: string): number {
    return this.gauges.get(name)?.value || 0;
  }

  // Histogram methods (for latency tracking)
  observeHistogram(name: string, value: number): void {
    if (!this.histograms.has(name)) {
      // Default buckets for latency in ms
      const buckets = new Map<number, number>();
      [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000].forEach(b => buckets.set(b, 0));
      this.histograms.set(name, { sum: 0, count: 0, buckets });
    }
    const hist = this.histograms.get(name)!;
    hist.sum += value;
    hist.count += 1;

    // Increment all buckets where value <= bucket threshold
    for (const [bucket, count] of hist.buckets) {
      if (value <= bucket) {
        hist.buckets.set(bucket, count + 1);
      }
    }
  }

  // Export in Prometheus format
  toPrometheus(): string {
    const lines: string[] = [];
    const timestamp = Date.now();

    // Export counters
    for (const [name, counter] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      if (counter.value > 0) {
        lines.push(`${name} ${counter.value}`);
      }
      for (const [labels, value] of counter.labels) {
        lines.push(`${name}{${labels}} ${value}`);
      }
    }

    // Export gauges
    for (const [name, gauge] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${gauge.value}`);
    }

    // Export histograms
    for (const [name, hist] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      for (const [bucket, count] of hist.buckets) {
        lines.push(`${name}_bucket{le="${bucket}"} ${count}`);
      }
      lines.push(`${name}_bucket{le="+Inf"} ${hist.count}`);
      lines.push(`${name}_sum ${hist.sum}`);
      lines.push(`${name}_count ${hist.count}`);
    }

    return lines.join("\n") + "\n";
  }

  // Export as JSON (for debugging)
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [name, counter] of this.counters) {
      if (counter.labels.size > 0) {
        result[name] = Object.fromEntries(counter.labels);
      } else {
        result[name] = counter.value;
      }
    }

    for (const [name, gauge] of this.gauges) {
      result[name] = gauge.value;
    }

    for (const [name, hist] of this.histograms) {
      result[name] = {
        sum: hist.sum,
        count: hist.count,
        avg: hist.count > 0 ? hist.sum / hist.count : 0,
      };
    }

    return result;
  }
}

// Singleton metrics registry
export const metrics = new MetricsRegistry();

// Convenience metric names
export const MetricNames = {
  // Counters
  PROMPTS_TOTAL: "vers_agent_prompts_total",
  PROMPTS_QUEUED: "vers_agent_prompts_queued_total",
  SESSIONS_CREATED: "vers_agent_sessions_created_total",
  TOKENS_INPUT: "vers_agent_tokens_input_total",
  TOKENS_OUTPUT: "vers_agent_tokens_output_total",
  ERRORS_TOTAL: "vers_agent_errors_total",
  TOOL_CALLS_TOTAL: "vers_agent_tool_calls_total",

  // Gauges
  ACTIVE_SESSIONS: "vers_agent_active_sessions",
  QUEUE_LENGTH: "vers_agent_queue_length",
  RUNNING_TASKS: "vers_agent_running_tasks",
  COST_USD: "vers_agent_cost_usd_total",
  SSE_CLIENTS: "vers_agent_sse_clients",

  // Histograms
  PROMPT_DURATION_MS: "vers_agent_prompt_duration_ms",
  TOOL_DURATION_MS: "vers_agent_tool_duration_ms",
} as const;
