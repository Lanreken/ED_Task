/**
 * Reconciliation Jobs
 * 
 * Background processes that fix inconsistencies in the distributed system.
 * These jobs run periodically to ensure data consistency across services.
 */

import type { ServiceLogger } from './index';

export type ReconciliationResult = {
  job: string;
  status: 'success' | 'partial' | 'failed';
  itemsProcessed: number;
  itemsFixed: number;
  errors: string[];
  duration: number;
  timestamp: string;
};

export type ReconciliationJob = {
  name: string;
  description: string;
  intervalMs: number;
  run: () => Promise<ReconciliationResult>;
};

/**
 * Reconciliation Manager - Orchestrates all reconciliation jobs
 */
export class ReconciliationManager {
  private jobs = new Map<string, ReconciliationJob>();
  private intervals = new Map<string, NodeJS.Timeout>();
  private running = new Map<string, boolean>();
  private lastResults = new Map<string, ReconciliationResult>();

  constructor(private readonly logger: ServiceLogger) {}

  /**
   * Register a reconciliation job
   */
  register(job: ReconciliationJob): void {
    this.jobs.set(job.name, job);
    this.logger.info('reconciliation_job_registered', {
      job: job.name,
      intervalMs: job.intervalMs,
      description: job.description,
    });
  }

  /**
   * Start all registered reconciliation jobs
   */
  startAll(): void {
    this.jobs.forEach((job) => {
      this.start(job.name);
    });
  }

  /**
   * Start a specific reconciliation job
   */
  start(jobName: string): void {
    const job = this.jobs.get(jobName);
    if (!job) {
      this.logger.warn('reconciliation_job_not_found', { job: jobName });
      return;
    }

    if (this.intervals.has(jobName)) {
      this.logger.info('reconciliation_job_already_running', { job: jobName });
      return;
    }

    // Run immediately on start
    this.runJob(job);

    // Schedule periodic runs
    const interval = setInterval(() => {
      this.runJob(job);
    }, job.intervalMs);

    this.intervals.set(jobName, interval);

    this.logger.info('reconciliation_job_started', {
      job: jobName,
      intervalMs: job.intervalMs,
    });
  }

  /**
   * Stop all reconciliation jobs
   */
  stopAll(): void {
    this.intervals.forEach((interval, jobName) => {
      clearInterval(interval);
      this.logger.info('reconciliation_job_stopped', { job: jobName });
    });
    this.intervals.clear();
  }

  /**
   * Stop a specific reconciliation job
   */
  stop(jobName: string): void {
    const interval = this.intervals.get(jobName);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(jobName);
      this.logger.info('reconciliation_job_stopped', { job: jobName });
    }
  }

  /**
   * Run a reconciliation job immediately
   */
  async runJob(job: ReconciliationJob): Promise<ReconciliationResult> {
    // Prevent concurrent runs
    if (this.running.get(job.name)) {
      this.logger.warn('reconciliation_job_already_running', { job: job.name });
      return {
        job: job.name,
        status: 'failed',
        itemsProcessed: 0,
        itemsFixed: 0,
        errors: ['Job already running'],
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    this.running.set(job.name, true);
    const startTime = Date.now();

    try {
      this.logger.info('reconciliation_job_running', { job: job.name });
      const result = await job.run();
      const duration = Date.now() - startTime;

      this.lastResults.set(job.name, { ...result, duration });

      this.logger.info('reconciliation_job_completed', {
        job: job.name,
        status: result.status,
        itemsProcessed: result.itemsProcessed,
        itemsFixed: result.itemsFixed,
        errors: result.errors.length,
        duration,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const result: ReconciliationResult = {
        job: job.name,
        status: 'failed',
        itemsProcessed: 0,
        itemsFixed: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        duration,
        timestamp: new Date().toISOString(),
      };

      this.lastResults.set(job.name, result);

      this.logger.error('reconciliation_job_failed', {
        job: job.name,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      return result;
    } finally {
      this.running.set(job.name, false);
    }
  }

  /**
   * Get the last result for a job
   */
  getLastResult(jobName: string): ReconciliationResult | undefined {
    return this.lastResults.get(jobName);
  }

  /**
   * Get all last results
   */
  getAllLastResults(): Map<string, ReconciliationResult> {
    return new Map(this.lastResults);
  }

  /**
   * Get status of all jobs
   */
  getStatus(): Array<{
    name: string;
    description: string;
    intervalMs: number;
    isRunning: boolean;
    lastResult?: ReconciliationResult;
  }> {
    return Array.from(this.jobs.entries()).map(([name, job]) => ({
      name,
      description: job.description,
      intervalMs: job.intervalMs,
      isRunning: this.intervals.has(name),
      lastResult: this.lastResults.get(name),
    }));
  }
}

/**
 * Create outbox reconciliation job for Task Service
 * 
 * Finds outbox events that are stuck in 'pending' status and attempts to republish them.
 */
export function createOutboxReconciliationJob(
  republishFn: () => Promise<{ republished: number; failed: number; errors: string[] }>,
  logger: ServiceLogger,
): ReconciliationJob {
  return {
    name: 'outbox_reconciliation',
    description: 'Republish stuck outbox events that failed to publish',
    intervalMs: 60_000, // Every minute
    run: async () => {
      const startTime = Date.now();
      let itemsProcessed = 0;
      let itemsFixed = 0;
      const errors: string[] = [];

      try {
        const result = await republishFn();
        itemsProcessed = result.republished + result.failed;
        itemsFixed = result.republished;
        errors.push(...result.errors);

        logger.info('outbox_reconciliation_completed', {
          republished: result.republished,
          failed: result.failed,
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }

      return {
        job: 'outbox_reconciliation',
        status: errors.length === 0 ? 'success' : 'partial',
        itemsProcessed,
        itemsFixed,
        errors,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Create reminder reconciliation job for Reminder Service
 * 
 * Finds tasks that should have reminders but don't, and creates missing reminder schedules.
 */
export function createReminderReconciliationJob(
  reconcileFn: () => Promise<{ tasksScanned: number; remindersCreated: number; errors: string[] }>,
  logger: ServiceLogger,
): ReconciliationJob {
  return {
    name: 'reminder_reconciliation',
    description: 'Find tasks missing reminder schedules and create them',
    intervalMs: 300_000, // Every 5 minutes
    run: async () => {
      const startTime = Date.now();
      let itemsProcessed = 0;
      let itemsFixed = 0;
      const errors: string[] = [];

      try {
        const result = await reconcileFn();
        itemsProcessed = result.tasksScanned;
        itemsFixed = result.remindersCreated;
        errors.push(...result.errors);

        logger.info('reminder_reconciliation_completed', {
          tasksScanned: result.tasksScanned,
          remindersCreated: result.remindersCreated,
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }

      return {
        job: 'reminder_reconciliation',
        status: errors.length === 0 ? 'success' : 'partial',
        itemsProcessed,
        itemsFixed,
        errors,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Create DLQ reconciliation job for Notification Service
 * 
 * Attempts to replay dead letter queue items that might be retryable.
 */
export function createDLQReconciliationJob(
  replayFn: () => Promise<{ itemsScanned: number; itemsReplayed: number; itemsEscalated: number; errors: string[] }>,
  logger: ServiceLogger,
): ReconciliationJob {
  return {
    name: 'dlq_reconciliation',
    description: 'Attempt to replay retryable dead letter queue items',
    intervalMs: 600_000, // Every 10 minutes
    run: async () => {
      const startTime = Date.now();
      let itemsProcessed = 0;
      let itemsFixed = 0;
      const errors: string[] = [];

      try {
        const result = await replayFn();
        itemsProcessed = result.itemsScanned;
        itemsFixed = result.itemsReplayed;
        errors.push(...result.errors);

        logger.info('dlq_reconciliation_completed', {
          itemsScanned: result.itemsScanned,
          itemsReplayed: result.itemsReplayed,
          itemsEscalated: result.itemsEscalated,
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }

      return {
        job: 'dlq_reconciliation',
        status: errors.length === 0 ? 'success' : 'partial',
        itemsProcessed,
        itemsFixed,
        errors,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    },
  };
}