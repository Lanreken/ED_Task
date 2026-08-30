import { model, Schema, Types } from 'mongoose';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'deleted';

export type TaskDocument = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: number;
  schedule: {
    startAt?: Date | null;
    dueAt: Date;
    reminderIntervalMinutes: number;
  };
  metadata: {
    tags: string[];
    aiBreakdownGenerated: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
};

const taskSchema = new Schema<TaskDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'overdue', 'deleted'],
      default: 'pending',
      index: true,
    },
    priority: { type: Number, min: 1, max: 5, default: 3 },
    schedule: {
      startAt: { type: Date, default: null },
      dueAt: { type: Date, required: true, index: true },
      reminderIntervalMinutes: { type: Number, min: 0, default: 30 },
    },
    metadata: {
      tags: { type: [String], default: [] },
      aiBreakdownGenerated: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

taskSchema.index({ userId: 1, status: 1 });
taskSchema.index({ userId: 1, createdAt: -1 });
taskSchema.index({ 'schedule.dueAt': 1 });

export const TaskModel = model<TaskDocument>('Task', taskSchema);
