import { model, Schema, Types } from 'mongoose';

export type NotificationDocument = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  taskId: Types.ObjectId;
  sourceEventId: string;
  type: 'push' | 'email' | 'sms' | 'browser';
  message: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt?: Date | null;
  retryCount: number;
  providerResponse?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

const notificationSchema = new Schema<NotificationDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, required: true, index: true },
    sourceEventId: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['push', 'email', 'sms', 'browser'], required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    sentAt: { type: Date, default: null },
    retryCount: { type: Number, default: 0 },
    providerResponse: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ status: 1, createdAt: 1 });

export const NotificationModel = model<NotificationDocument>('Notification', notificationSchema);
