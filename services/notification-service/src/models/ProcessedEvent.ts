import { model, Schema, Types } from 'mongoose';

export type ProcessedEventDocument = {
  _id: Types.ObjectId;
  eventId: string;
  handlerName: string;
  processedAt: Date;
};

const processedEventSchema = new Schema<ProcessedEventDocument>({
  eventId: { type: String, required: true },
  handlerName: { type: String, required: true },
  processedAt: { type: Date, required: true, default: () => new Date() },
});

processedEventSchema.index({ eventId: 1, handlerName: 1 }, { unique: true });

export const ProcessedEventModel = model<ProcessedEventDocument>('ProcessedEvent', processedEventSchema);
