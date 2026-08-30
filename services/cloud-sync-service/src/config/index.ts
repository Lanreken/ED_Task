import { getEnv } from '../../../../libs/common/src/index';

export type CloudDatabaseConfig = {
  name: string;
  uri: string;
  collections: string[];
};

const sharedCollections = {
  user: ['users', 'audit_logs'],
  task: ['tasks', 'events', 'idempotency_keys'],
  reminder: ['reminder_schedules', 'jobs', 'processed_events'],
  notification: ['notifications', 'jobs', 'dead_letters', 'processed_events'],
  ai: ['ai_requests', 'task_suggestions', 'processed_events'],
  analytics: ['event_projections', 'daily_metrics', 'processed_events'],
} as const;

export const cloudSyncConfig = {
  serviceName: 'cloud-sync-service',
  port: Number(process.env.PORT ?? 3007),
  backupPrefix: process.env.CLOUD_SYNC_BACKUP_PREFIX ?? 'ed-task',
  intervalMs: Number(process.env.CLOUD_SYNC_INTERVAL_MS ?? 300000),
  restoreOnStart: process.env.CLOUD_SYNC_RESTORE_ON_START === 'true',
  googleDrive: {
    projectId: getEnv('GOOGLE_DRIVE_PROJECT_ID'),
    clientEmail: getEnv('GOOGLE_DRIVE_CLIENT_EMAIL'),
    privateKey: getEnv('GOOGLE_DRIVE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    tokenUri: process.env.GOOGLE_DRIVE_TOKEN_URI ?? 'https://oauth2.googleapis.com/token',
    scope: process.env.GOOGLE_DRIVE_SCOPE ?? 'https://www.googleapis.com/auth/drive',
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? '',
    folderName: process.env.GOOGLE_DRIVE_FOLDER_NAME ?? 'ed-task-backups',
  },
  databases: [
    {
      name: 'user-service',
      uri: getEnv('USER_SERVICE_MONGO_URI', 'mongodb://root:rootpass@localhost:27017/ed_user_service?authSource=admin'),
      collections: [...sharedCollections.user],
    },
    {
      name: 'task-service',
      uri: getEnv('TASK_SERVICE_MONGO_URI', 'mongodb://root:rootpass@localhost:27017/ed_task_service?authSource=admin'),
      collections: [...sharedCollections.task],
    },
    {
      name: 'reminder-service',
      uri: getEnv('REMINDER_SERVICE_MONGO_URI', 'mongodb://root:rootpass@localhost:27017/ed_reminder_service?authSource=admin'),
      collections: [...sharedCollections.reminder],
    },
    {
      name: 'notification-service',
      uri: getEnv('NOTIFICATION_SERVICE_MONGO_URI', 'mongodb://root:rootpass@localhost:27017/ed_notification_service?authSource=admin'),
      collections: [...sharedCollections.notification],
    },
    {
      name: 'ai-service',
      uri: getEnv('AI_SERVICE_MONGO_URI', 'mongodb://root:rootpass@localhost:27017/ed_ai_service?authSource=admin'),
      collections: [...sharedCollections.ai],
    },
    {
      name: 'analytics-service',
      uri: getEnv('ANALYTICS_SERVICE_MONGO_URI', 'mongodb://root:rootpass@localhost:27017/ed_analytics_service?authSource=admin'),
      collections: [...sharedCollections.analytics],
    },
  ] satisfies CloudDatabaseConfig[],
};
