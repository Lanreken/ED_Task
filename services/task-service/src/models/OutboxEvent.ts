import { model, Schema, Types } from 'mongoose';
import { EventTypes, type EventType } from '../../../../libs/events/src/index';

export type OutboxStatus = 'pending' | 'published' | 'failed';

export type OutboxEventDocument = {
  _id: Types.ObjectId;
  eventId: string;
  type: EventType;
  version: number;
  sourceService: 'task-service';
  aggregateType: 'task';
  aggregateId: Types.ObjectId;
  traceId: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  retryCount: number;
  nextAttemptAt: Date;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date | null;
};

const outboxEventSchema = new Schema<OutboxEventDocument>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true, enum: Object.values(EventTypes), index: true },
    version: { type: Number, required: true, default: 1 },
    sourceService: { type: String, required: true, default: 'task-service' },
    aggregateType: { type: String, required: true, default: 'task' },
    aggregateId: { type: Schema.Types.ObjectId, required: true, index: true },
    traceId: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['pending', 'published', 'failed'], default: 'pending', index: true },
    retryCount: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date(), index: true },
    lastError: { type: String, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

outboxEventSchema.index({ type: 1, status: 1 });
outboxEventSchema.index({ status: 1, nextAttemptAt: 1 });
outboxEventSchema.index({ aggregateId: 1, createdAt: 1 });

export const OutboxEventModel = model<OutboxEventDocument>('OutboxEvent', outboxEventSchema, 'events');
