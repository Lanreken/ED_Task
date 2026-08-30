import { model, Schema, Types } from 'mongoose';

export type JobRecordDocument = {
  _id: Types.ObjectId;
  type: 'send_notification';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  payload: Record<string, unknown>;
  attempts: number;
  runAt: Date;
  queueJobId: string;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const jobRecordSchema = new Schema<JobRecordDocument>(
  {
    type: { type: String, required: true, default: 'send_notification', index: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    payload: { type: Schema.Types.Mixed, required: true },
    attempts: { type: Number, default: 0 },
    runAt: { type: Date, required: true, default: () => new Date(), index: true },
    queueJobId: { type: String, required: true, index: true },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

jobRecordSchema.index({ status: 1, runAt: 1 });
jobRecordSchema.index({ type: 1, status: 1 });

export const JobRecordModel = model<JobRecordDocument>('JobRecord', jobRecordSchema, 'jobs');
