export type MetricType = 'bigint' | 'double';

export enum MetricFormat {
  NUMBER = 'NUMBER',
  BYTES = 'BYTES',
  MILLISECONDS = 'MILLISECONDS',
  /**
   * USD currency format. Renders with $ prefix; per-request LLM costs are
   * routinely in fractions of a cent so the formatter uses adaptive
   * precision (4-6 decimals for tiny values, 2 decimals for $1+).
   */
  CURRENCY = 'CURRENCY',
}

export type MetricDefinition = {
  name: string;
  type: MetricType;
  format: MetricFormat;
};
