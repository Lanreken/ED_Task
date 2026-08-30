import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import {
  connectMongo,
  createErrorHandler,
  createLogger,
  createMetricsRegistry,
  createRedisConnection,
  createStandardServiceMetrics,
} from '../../../libs/common/src/index';
import {
  RedisChannels,
  type EventEnvelope,
  verifyEventEnvelopeSignature,
} from '../../../libs/events/src/index';
import { analyticsServiceConfig } from './config';
import { createAnalyticsServiceRouter } from './routes';

dotenv.config();

const logger = createLogger(analyticsServiceConfig.serviceName);

// Metrics
const metrics = createMetricsRegistry(analyticsServiceConfig.serviceName);
const standardMetrics = createStandardServiceMetrics(metrics);

// Event statistics stored in memory (in production, use Redis or DB)
const eventStats = {
  totalEvents: 0,
  eventsByType: new Map<string, number>(),
  eventsBySource: new Map<string, number>(),
  lastEventAt: null as string | null,
};

type AlertSeverity = 'warning' | 'critical';
type ServiceAlert = {
  id: string;
  severity: AlertSeverity;
  source: string;
  message: string;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
  details?: Record<string, unknown>;
};

const activeAlerts = new Map<string, ServiceAlert>();

function upsertAlert(input: {
  id: string;
  severity: AlertSeverity;
  source: string;
  message: string;
  details?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const current = activeAlerts.get(input.id);

  if (current) {
    current.lastSeenAt = now;
    current.severity = input.severity;
    current.message = input.message;
    current.details = input.details;
    current.active = true;
    return;
  }

  activeAlerts.set(input.id, {
    id: input.id,
    severity: input.severity,
    source: input.source,
    message: input.message,
    firstSeenAt: now,
    lastSeenAt: now,
    active: true,
    details: input.details,
  });

  logger.warn('alert_raised', {
    alertId: input.id,
    source: input.source,
    severity: input.severity,
    message: input.message,
  });
}

function resolveAlert(id: string) {
  const current = activeAlerts.get(id);
  if (!current) {
    return;
  }

  activeAlerts.delete(id);
  logger.info('alert_resolved', {
    alertId: id,
    source: current.source,
  });
}

function parseMetricValue(metricsText: string, metricName: string): number | null {
  const lines = metricsText.split('\n');
  for (const line of lines) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith(`${metricName} `) || line.startsWith(`${metricName}{`)) {
      const value = Number(line.trim().split(' ').pop());
      if (!Number.isNaN(value)) {
        return value;
      }
    }
  }
  return null;
}

async function fetchTextWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Process incoming events and update analytics
 */
async function processEvent(event: EventEnvelope) {
  if (
    analyticsServiceConfig.eventSecurity.enforceSignature
    && !verifyEventEnvelopeSignature(event, analyticsServiceConfig.eventSecurity.sharedSecret)
  ) {
    logger.warn('invalid_event_signature', {
      eventId: event.eventId,
      type: event.type,
      source: event.source,
    });
    return;
  }

  eventStats.totalEvents++;
  
  // Update type stats
  const currentTypeCount = eventStats.eventsByType.get(event.type) || 0;
  eventStats.eventsByType.set(event.type, currentTypeCount + 1);
  
  // Update source stats
  const currentSourceCount = eventStats.eventsBySource.get(event.source) || 0;
  eventStats.eventsBySource.set(event.source, currentSourceCount + 1);
  
  // Update last event time
  eventStats.lastEventAt = new Date().toISOString();
  
  // Update metrics
  standardMetrics.requestsTotal.inc();

  logger.info('event_processed', {
    eventId: event.eventId,
    type: event.type,
    source: event.source,
    totalEvents: eventStats.totalEvents,
  });
}

/**
 * Start consuming events from Redis
 */
function startEventConsumers() {
  const redis = createRedisConnection(
    analyticsServiceConfig.redisUrl,
  );

  // Subscribe to all event channels
  const channels = [
    RedisChannels.TaskEvents,
    RedisChannels.ReminderEvents,
    RedisChannels.NotificationEvents,
    RedisChannels.AiEvents,
    RedisChannels.SystemEvents,
  ];

  redis.psubscribe(...channels);

  redis.on('pmessage', async (_pattern, channel, message) => {
    try {
      const event: EventEnvelope = JSON.parse(message);
      await processEvent(event);
    } catch (error) {
      logger.error('failed_to_process_event', {
        channel,
        error: error instanceof Error ? error.message : String(error),
      });
      standardMetrics.requestErrorsTotal.inc();
    }
  });

  redis.on('connect', () => {
    logger.info('redis_connected_for_events');
  });

  redis.on('error', (error) => {
    logger.error('redis_event_error', {
      error: error.message,
    });
  });

  return redis;
}

async function runAlertChecks() {
  const serviceEntries = Object.entries(analyticsServiceConfig.alerting.services);
  const healthTimeout = 3000;

  for (const [serviceName, baseUrl] of serviceEntries) {
    const serviceDownAlertId = `service_down:${serviceName}`;

    try {
      const healthResponse = await fetchTextWithTimeout(`${baseUrl}/health`, healthTimeout);
      if (!healthResponse.ok) {
        upsertAlert({
          id: serviceDownAlertId,
          severity: 'critical',
          source: serviceName,
          message: `Health check failed with status ${healthResponse.status}`,
          details: { url: `${baseUrl}/health`, status: healthResponse.status },
        });
      } else {
        resolveAlert(serviceDownAlertId);
      }
    } catch (error) {
      upsertAlert({
        id: serviceDownAlertId,
        severity: 'critical',
        source: serviceName,
        message: 'Health check request failed',
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }

    const queueAlertId = `queue_backlog:${serviceName}`;
    const queueFailedAlertId = `queue_failed:${serviceName}`;

    try {
      const metricsResponse = await fetchTextWithTimeout(`${baseUrl}/metrics`, healthTimeout);
      if (!metricsResponse.ok) {
        resolveAlert(queueAlertId);
        resolveAlert(queueFailedAlertId);
        continue;
      }

      const metricsText = await metricsResponse.text();
      const queueWaiting = parseMetricValue(metricsText, 'queue_waiting_jobs');
      const queueFailed = parseMetricValue(metricsText, 'queue_jobs_failed_total');

      if (queueWaiting !== null && queueWaiting > analyticsServiceConfig.alerting.maxQueueWaiting) {
        upsertAlert({
          id: queueAlertId,
          severity: 'warning',
          source: serviceName,
          message: `Queue backlog is high: ${queueWaiting}`,
          details: { queueWaiting },
        });
      } else {
        resolveAlert(queueAlertId);
      }

      if (queueFailed !== null && queueFailed > analyticsServiceConfig.alerting.maxQueueFailed) {
        upsertAlert({
          id: queueFailedAlertId,
          severity: 'warning',
          source: serviceName,
          message: `Queue failures are high: ${queueFailed}`,
          details: { queueFailed },
        });
      } else {
        resolveAlert(queueFailedAlertId);
      }
    } catch {
      resolveAlert(queueAlertId);
      resolveAlert(queueFailedAlertId);
    }
  }

  const noEventsAlertId = 'event_flow_stalled';
  const noEventsSinceMs = eventStats.lastEventAt
    ? Date.now() - new Date(eventStats.lastEventAt).getTime()
    : Number.POSITIVE_INFINITY;

  if (noEventsSinceMs > analyticsServiceConfig.alerting.noEventsWindowMs) {
    upsertAlert({
      id: noEventsAlertId,
      severity: eventStats.totalEvents === 0 ? 'warning' : 'critical',
      source: 'analytics-service',
      message: 'No events observed in the expected window',
      details: {
        lastEventAt: eventStats.lastEventAt,
        noEventsSinceMs: Number.isFinite(noEventsSinceMs) ? noEventsSinceMs : null,
        thresholdMs: analyticsServiceConfig.alerting.noEventsWindowMs,
      },
    });
  } else {
    resolveAlert(noEventsAlertId);
  }
}

async function bootstrap() {
  // Connect to MongoDB if URI is provided
  if (analyticsServiceConfig.mongoUri) {
    await connectMongo(analyticsServiceConfig.mongoUri, analyticsServiceConfig.serviceName);
  }

  // Start event consumers
  startEventConsumers();

  if (analyticsServiceConfig.alerting.enabled) {
    setInterval(() => {
      runAlertChecks().catch((error) => {
        logger.error('alert_check_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, analyticsServiceConfig.alerting.pollIntervalMs).unref();
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(createAnalyticsServiceRouter({
    eventStats,
    getAlerts: () => Array.from(activeAlerts.values()),
  }));
  app.use(createErrorHandler(logger));

  // Metrics endpoint
  app.get('/metrics', (_req, res) => {
    res.type('text/plain');
    res.send(metrics.toPrometheusFormat());
  });

  // Analytics summary endpoint
  app.get('/analytics/summary', (_req, res) => {
    res.json({
      totalEvents: eventStats.totalEvents,
      eventsByType: Object.fromEntries(eventStats.eventsByType),
      eventsBySource: Object.fromEntries(eventStats.eventsBySource),
      lastEventAt: eventStats.lastEventAt,
    });
  });

  app.listen(analyticsServiceConfig.port, () => {
    logger.info('service_started', { port: analyticsServiceConfig.port });
  });
}

// Export for testing and external use
export { eventStats, metrics };

bootstrap().catch((error: Error) => {
  logger.error('service_boot_failed', {
    error: error.message,
  });
  process.exit(1);
});
