import { Router } from 'express';
import { createHealthHandler } from '../../../../libs/common/src/index';
import { analyticsServiceConfig } from '../config';

type AnalyticsServiceRouterOptions = {
  eventStats: {
    totalEvents: number;
    eventsByType: Map<string, number>;
    eventsBySource: Map<string, number>;
    lastEventAt: string | null;
  };
  getAlerts?: () => Array<{
    id: string;
    severity: 'warning' | 'critical';
    source: string;
    message: string;
    firstSeenAt: string;
    lastSeenAt: string;
    active: boolean;
    details?: Record<string, unknown>;
  }>;
};

export function createAnalyticsServiceRouter(options?: AnalyticsServiceRouterOptions) {
  const router = Router();

  router.get('/health', createHealthHandler(analyticsServiceConfig.serviceName));
  router.get('/ready', createHealthHandler(analyticsServiceConfig.serviceName));

  // Event statistics endpoint
  router.get('/events', (_req, res) => {
    if (!options || !options.eventStats) {
      res.json({
        totalEvents: 0,
        eventsByType: {},
        eventsBySource: {},
        lastEventAt: null,
      });
      return;
    }

    res.json({
      totalEvents: options.eventStats.totalEvents,
      eventsByType: Object.fromEntries(options.eventStats.eventsByType),
      eventsBySource: Object.fromEntries(options.eventStats.eventsBySource),
      lastEventAt: options.eventStats.lastEventAt,
    });
  });

  // Event rate endpoint (events per minute over last hour)
  router.get('/events/rate', (_req, res) => {
    if (!options || !options.eventStats) {
      res.json({
        rate: 0,
        window: '1h',
      });
      return;
    }

    // Simple rate calculation based on total events
    // In production, this would use time-series data
    const rate = options.eventStats.totalEvents / 60;

    res.json({
      rate: Math.round(rate * 100) / 100,
      window: '1h',
      totalEvents: options.eventStats.totalEvents,
    });
  });

  router.get('/alerts', (_req, res) => {
    res.json({
      alerts: options?.getAlerts ? options.getAlerts() : [],
    });
  });

  return router;
}
