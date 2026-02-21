import * as fs from 'fs';
import * as path from 'path';

/**
 * Log level enumeration
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Structured log entry
 */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, unknown>;
  traceId?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Enhanced logger with structured logging, log levels, rotation, and operation tracing
 */
export class Logger {
  private static currentLogLevel: LogLevel = Logger.parseLogLevel(process.env.LOG_LEVEL || 'info');
  private static logDirectory: string = process.env.LOG_DIR || './logs';
  private static currentDate: string = new Date().toISOString().split('T')[0];
  private static logFile: string = path.join(Logger.logDirectory, `${Logger.currentDate}.log`);
  private static fileHandle: fs.promises.FileHandle | null = null;
  private static operationStack: Map<string, { startTime: number; label: string }> = new Map();
  private static traceIdCounter: number = 0;

  /**
   * Parse log level from string
   */
  private static parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'debug':
        return LogLevel.DEBUG;
      case 'warn':
        return LogLevel.WARN;
      case 'error':
        return LogLevel.ERROR;
      case 'info':
      default:
        return LogLevel.INFO;
    }
  }

  /**
   * Get log level name
   */
  private static getLevelName(level: LogLevel): string {
    return LogLevel[level];
  }

  /**
   * Ensure log directory exists
   */
  private static ensureLogDirectory(): void {
    if (!fs.existsSync(Logger.logDirectory)) {
      fs.mkdirSync(Logger.logDirectory, { recursive: true });
    }
  }

  /**
   * Check if log rotation is needed (daily)
   */
  private static checkLogRotation(): void {
    const today = new Date().toISOString().split('T')[0];
    if (today !== Logger.currentDate) {
      Logger.currentDate = today;
      Logger.logFile = path.join(Logger.logDirectory, `${Logger.currentDate}.log`);
      if (Logger.fileHandle) {
        Logger.fileHandle.close();
        Logger.fileHandle = null;
      }
    }
  }

  /**
   * Format log entry as JSON
   */
  private static formatLogEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  /**
   * Format log entry for console (pretty print)
   */
  private static formatConsoleEntry(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const level = entry.level.padEnd(5);
    const message = entry.message;
    const context = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const duration = entry.duration ? ` (${entry.duration}ms)` : '';
    return `[${timestamp}] [${level}] ${message}${duration}${context}`;
  }

  /**
   * Write log entry to file and console
   */
  private static async writeLog(entry: LogEntry): Promise<void> {
    // Write to console (always)
    const consoleOutput = Logger.formatConsoleEntry(entry);
    if (entry.level === 'ERROR') {
      console.error(consoleOutput);
    } else if (entry.level === 'WARN') {
      console.warn(consoleOutput);
    } else {
      console.log(consoleOutput);
    }

    // Write to file (if not in test environment)
    if (process.env.NODE_ENV !== 'test') {
      try {
        Logger.ensureLogDirectory();
        Logger.checkLogRotation();

        const logJson = Logger.formatLogEntry(entry);
        fs.appendFileSync(Logger.logFile, logJson + '\n');
      } catch (error) {
        // Silently fail if file write fails to avoid breaking operations
      }
    }
  }

  /**
   * Generate unique trace ID for operation tracking
   */
  private static generateTraceId(): string {
    return `trace-${Date.now()}-${++Logger.traceIdCounter}`;
  }

  /**
   * Create log entry
   */
  private static createEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
    traceId?: string,
    duration?: number,
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: Logger.getLevelName(level),
      message,
    };

    if (context) {
      entry.context = context;
    }

    if (traceId) {
      entry.traceId = traceId;
    }

    if (duration !== undefined) {
      entry.duration = duration;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return entry;
  }

  /**
   * Log at INFO level
   */
  static info(message: string, context?: Record<string, unknown>): void {
    if (Logger.currentLogLevel <= LogLevel.INFO) {
      const entry = Logger.createEntry(LogLevel.INFO, message, context);
      void Logger.writeLog(entry);
    }
  }

  /**
   * Log at WARN level
   */
  static warn(message: string, context?: Record<string, unknown>): void {
    if (Logger.currentLogLevel <= LogLevel.WARN) {
      const entry = Logger.createEntry(LogLevel.WARN, message, context);
      void Logger.writeLog(entry);
    }
  }

  /**
   * Log at ERROR level
   */
  static error(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (Logger.currentLogLevel <= LogLevel.ERROR) {
      const entry = Logger.createEntry(LogLevel.ERROR, message, context, error);
      void Logger.writeLog(entry);
    }
  }

  /**
   * Log at DEBUG level
   */
  static debug(message: string, context?: Record<string, unknown>): void {
    if (Logger.currentLogLevel <= LogLevel.DEBUG) {
      const entry = Logger.createEntry(LogLevel.DEBUG, message, context);
      void Logger.writeLog(entry);
    }
  }

  /**
   * Start tracking an operation and return trace ID
   */
  static startOperation(label: string): string {
    const traceId = Logger.generateTraceId();
    Logger.operationStack.set(traceId, { startTime: Date.now(), label });
    Logger.info(`Operation started: ${label}`, { traceId });
    return traceId;
  }

  /**
   * End tracking an operation
   */
  static endOperation(traceId: string, success: boolean = true, context?: Record<string, unknown>): void {
    const operation = Logger.operationStack.get(traceId);
    if (operation) {
      const duration = Date.now() - operation.startTime;
      const entry = Logger.createEntry(
        success ? LogLevel.INFO : LogLevel.WARN,
        `Operation completed: ${operation.label}`,
        { ...context, success },
        undefined,
        traceId,
        duration,
      );
      void Logger.writeLog(entry);
      Logger.operationStack.delete(traceId);
    }
  }

  /**
   * Set log level
   */
  static setLogLevel(level: LogLevel): void {
    Logger.currentLogLevel = level;
    Logger.info(`Log level changed to ${LogLevel[level]}`);
  }

  /**
   * Get current log level
   */
  static getLogLevel(): LogLevel {
    return Logger.currentLogLevel;
  }

  /**
   * Close any open file handles (for graceful shutdown)
   */
  static async close(): Promise<void> {
    if (Logger.fileHandle) {
      await Logger.fileHandle.close();
      Logger.fileHandle = null;
    }
  }
}
