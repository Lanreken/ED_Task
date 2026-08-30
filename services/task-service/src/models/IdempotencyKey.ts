import { model, Schema, Types } from 'mongoose';

export type IdempotencyKeyDocument = {
  _id: Types.ObjectId;
  key: string;
  userId: Types.ObjectId;
  requestHash: string;
  response: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
};

const idempotencyKeySchema = new Schema<IdempotencyKeyDocument>(
  {
    key: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    requestHash: { type: String, required: true },
    response: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

idempotencyKeySchema.index({ userId: 1, key: 1 }, { unique: true });
idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyKeyModel = model<IdempotencyKeyDocument>('IdempotencyKey', idempotencyKeySchema);
