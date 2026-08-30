import { model, Schema, Types } from 'mongoose';

export type DeadLetterDocument = {
  _id: Types.ObjectId;
  originalEventId: string;
  originalType: string;
  payload: Record<string, unknown>;
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
  service: 'notification-service';
  queue: string;
  retryHistory: Array<{
    attempt: number;
    error: string;
    timestamp: Date;
  }>;
  createdAt: Date;
};

const deadLetterSchema = new Schema<DeadLetterDocument>({
  originalEventId: { type: String, required: true, index: true },
  originalType: { type: String, required: true, index: true },
  payload: { type: Schema.Types.Mixed, required: true },
  error: {
    message: { type: String, required: true },
    code: { type: String, default: null },
    stack: { type: String, default: null },
  },
  service: { type: String, required: true, default: 'notification-service', index: true },
  queue: { type: String, required: true },
  retryHistory: [
    {
      attempt: Number,
      error: String,
      timestamp: Date,
    },
  ],
  createdAt: { type: Date, default: () => new Date(), index: true },
});

deadLetterSchema.index({ service: 1, createdAt: -1 });

export const DeadLetterModel = model<DeadLetterDocument>('DeadLetter', deadLetterSchema, 'dead_letters');
