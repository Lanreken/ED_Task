import { createHash } from 'node:crypto';
import mongoose, { type Connection } from 'mongoose';
import { createLogger } from '../../../../libs/common/src/index';
import { cloudSyncConfig, type CloudDatabaseConfig } from '../config';
import { GoogleDriveClient } from '../clients/googleDriveClient';

type DatabaseSnapshot = {
  name: string;
  uri: string;
  collections: Record<string, unknown[]>;
};

export type CloudSnapshot = {
  schemaVersion: number;
  snapshotId: string;
  createdAt: string;
  backupPrefix: string;
  source: {
    projectId: string;
    services: string[];
  };
  databases: DatabaseSnapshot[];
};

type SyncResult = {
  snapshotId: string;
  fileId: string;
  fileName: string;
  createdAt: string;
  uploadedDatabases: number;
};

type RestorePreview = {
  fileId: string;
  fileName: string;
  createdAt?: string;
  databases: Array<{
    name: string;
    collections: Array<{
      name: string;
      count: number;
    }>;
  }>;
};

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (typeof value === 'object') {
    if (typeof (value as { toHexString?: () => string }).toHexString === 'function') {
      return (value as { toHexString: () => string }).toHexString();
    }

    const entries = Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      normalizeValue(nested),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

function createSnapshotId() {
  return createHash('sha256')
    .update(`${cloudSyncConfig.backupPrefix}:${new Date().toISOString()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 24);
}

async function connectDatabase(config: CloudDatabaseConfig) {
  const connection = await mongoose.createConnection(config.uri).asPromise();
  return connection;
}

async function exportCollection(connection: Connection, collectionName: string) {
  const documents = await connection.db!.collection(collectionName).find({}).toArray();
  return documents.map((document) => normalizeValue(document));
}

export class CloudSnapshotService {
  private readonly logger = createLogger(cloudSyncConfig.serviceName);
  private readonly driveClient = new GoogleDriveClient(cloudSyncConfig.googleDrive);
  private connections = new Map<string, Connection>();
  private lastSync: SyncResult | null = null;
  private syncRunning = false;

  async connectAllDatabases() {
    for (const database of cloudSyncConfig.databases) {
      if (this.connections.has(database.name)) {
        continue;
      }

      const connection = await connectDatabase(database);
      this.connections.set(database.name, connection);
      this.logger.info('database_connected', { database: database.name });
    }
  }

  async buildSnapshot(): Promise<CloudSnapshot> {
    await this.connectAllDatabases();

    const databases: DatabaseSnapshot[] = [];
    for (const database of cloudSyncConfig.databases) {
      const connection = this.connections.get(database.name);
      if (!connection) {
        throw new Error(`Missing connection for database: ${database.name}`);
      }

      const collections: Record<string, unknown[]> = {};
      for (const collectionName of database.collections) {
        collections[collectionName] = await exportCollection(connection, collectionName);
      }

      databases.push({
        name: database.name,
        uri: database.uri,
        collections,
      });
    }

    return {
      schemaVersion: 1,
      snapshotId: createSnapshotId(),
      createdAt: new Date().toISOString(),
      backupPrefix: cloudSyncConfig.backupPrefix,
      source: {
        projectId: cloudSyncConfig.googleDrive.projectId,
        services: cloudSyncConfig.databases.map((database) => database.name),
      },
      databases,
    };
  }

  async syncNow(): Promise<SyncResult> {
    if (this.syncRunning) {
      throw new Error('Cloud sync already running');
    }

    this.syncRunning = true;
    try {
      const snapshot = await this.buildSnapshot();
      const fileName = `${cloudSyncConfig.backupPrefix}-snapshot-${snapshot.snapshotId}.json`;
      const uploaded = await this.driveClient.uploadJsonSnapshot({
        fileName,
        content: snapshot,
        appProperties: {
          schemaVersion: String(snapshot.schemaVersion),
          backupPrefix: snapshot.backupPrefix,
          snapshotId: snapshot.snapshotId,
        },
      });

      const result = {
        snapshotId: snapshot.snapshotId,
        fileId: uploaded.fileId,
        fileName: uploaded.name,
        createdAt: snapshot.createdAt,
        uploadedDatabases: snapshot.databases.length,
      };

      this.lastSync = result;
      this.logger.info('cloud_snapshot_uploaded', result);
      return result;
    } finally {
      this.syncRunning = false;
    }
  }

  async listSnapshots() {
    return this.driveClient.listSnapshots();
  }

  async getLatestSnapshotPreview(): Promise<RestorePreview | null> {
    const snapshots = await this.listSnapshots();
    const latest = snapshots[0];
    if (!latest) {
      return null;
    }

    const content = await this.driveClient.downloadSnapshot(latest.id);
    return {
      fileId: latest.id,
      fileName: latest.name,
      createdAt: latest.createdTime,
      databases: Array.isArray((content as { databases?: unknown }).databases)
        ? ((content as { databases: Array<{ name: string; collections: Record<string, unknown[]> }>; }).databases ?? []).map((database) => ({
            name: database.name,
            collections: Object.entries(database.collections ?? {}).map(([name, docs]) => ({
              name,
              count: Array.isArray(docs) ? docs.length : 0,
            })),
          }))
        : [],
    };
  }

  getLastSync() {
    return this.lastSync;
  }

  async shutdown() {
    for (const connection of this.connections.values()) {
      await connection.close();
    }
    this.connections.clear();
  }
}
