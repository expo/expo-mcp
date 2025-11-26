export interface LogCollectorOptions {
  /**
   * Duration in milliseconds to collect logs before stopping the collector.
   * Defaults to 5000ms when not provided by the individual collector.
   */
  durationMs?: number;

  /**
   * Optional RegExp pattern to filter logs by message content.
   */
  filterRegexp?: RegExp;

  /**
   * Optional log level filter. Only logs matching this level will be returned.
   */
  logLevel?: string;
}

export interface LogRecord {
  /**
   * Identifies where the log originated from (e.g. 'cdp', 'android-logcat', 'ios-simulator-log').
   */
  source: string;

  /**
   * Epoch timestamp when the log line was recorded.
   */
  timestamp: number;

  /**
   * Optional severity level if one can be determined.
   */
  level?: string;

  /**
   * Primary log message when available.
   */
  message?: string;

  /**
   * Optional structured arguments associated with the log event.
   */
  args?: unknown[];

  /**
   * Raw log line for collectors that cannot parse structured output.
   */
  raw?: string;

  /**
   * Additional metadata preserved by a given collector.
   */
  metadata?: Record<string, unknown>;

  /**
   * Optional log type identifier (e.g. console, log, stderr).
   */
  type?: string;
}

export interface TransformedLogRecord extends LogRecord {
  /**
   * Primary transformed log data in `[level] message` format.
   */
  data: string;
}

export interface LogCollector {
  /**
   * Friendly name for the collector, used in diagnostics.
   */
  readonly name: string;

  /**
   * Additional metadata preserved by a given collector.
   */
  get metadata(): Record<string, unknown>;

  /**
   * Collects logs and resolves with stringified logs.
   */
  collectAsync(): Promise<string>;

  /**
   * Collects logs and resolves with the raw records.
   */
  collectRawRecordsAsync(): Promise<TransformedLogRecord[]>;
}

/**
 * Determines if a log record should be included based on the log level and filter regex.
 */
export function shouldIncludeRecord({
  record,
  logLevel,
  filterRegex,
}: {
  record: TransformedLogRecord;
  logLevel?: string;
  filterRegex?: RegExp;
}): boolean {
  if (logLevel && record.level && record.level !== logLevel) {
    return false;
  }

  if (filterRegex) {
    return filterRegex.test(record.data);
  }

  return true;
}
