import { model, Schema, Types } from 'mongoose';

export type ReminderScheduleDocument = {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  dueAt: Date;
  status: 'scheduled' | 'triggered' | 'cancelled' | 'failed';
  runAt: Date;
  sourceEventId: string;
  createdAt: Date;
  updatedAt: Date;
};

const reminderScheduleSchema = new Schema<ReminderScheduleDocument>(
  {
    taskId: { type: Schema.Types.ObjectId, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true },
    dueAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['scheduled', 'triggered', 'cancelled', 'failed'],
      default: 'scheduled',
      index: true,
    },
    runAt: { type: Date, required: true, index: true },
    sourceEventId: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true },
);

reminderScheduleSchema.index({ status: 1, runAt: 1 });

export const ReminderScheduleModel = model<ReminderScheduleDocument>('ReminderSchedule', reminderScheduleSchema);
