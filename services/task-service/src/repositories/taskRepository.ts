import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import {
  createEventEnvelope,
  EventTypes,
  type EventEnvelope,
  type TaskCompletedPayload,
  type TaskCreatedPayload,
} from '../../../../libs/events/src/index';
import { IdempotencyKeyModel } from '../models/IdempotencyKey';
import { OutboxEventModel } from '../models/OutboxEvent';
import { TaskModel, type TaskDocument } from '../models/Task';

export type CreateTaskInput = {
  userId: string;
  title: string;
  description?: string | null;
  priority?: number;
  dueAt: string;
  reminderIntervalMinutes?: number;
  tags?: string[];
  traceId: string;
  idempotencyKey?: string;
};

export type TaskResponse = {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  status: string;
  priority: number;
  schedule: {
    dueAt: string;
    reminderIntervalMinutes: number;
  };
  metadata: {
    tags: string[];
    aiBreakdownGenerated: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

function serializeTask(task: TaskDocument): TaskResponse {
  return {
    id: task._id.toString(),
    userId: task.userId.toString(),
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    schedule: {
      dueAt: task.schedule.dueAt.toISOString(),
      reminderIntervalMinutes: task.schedule.reminderIntervalMinutes,
    },
    metadata: {
      tags: task.metadata.tags,
      aiBreakdownGenerated: task.metadata.aiBreakdownGenerated,
    },
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function requestHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export class TaskRepository {
  async findIdempotencyResponse(userId: string, key: string) {
    return IdempotencyKeyModel.findOne({
      userId: new Types.ObjectId(userId),
      key,
    }).lean();
  }

  async saveIdempotencyResponse(input: {
    userId: string;
    key: string;
    requestBody: unknown;
    response: Record<string, unknown>;
  }) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await IdempotencyKeyModel.create({
      userId: new Types.ObjectId(input.userId),
      key: input.key,
      requestHash: requestHash(input.requestBody),
      response: input.response,
      expiresAt,
    });
  }

  async createTaskAndEvent(input: CreateTaskInput): Promise<{
    task: TaskResponse;
    event: EventEnvelope<TaskCreatedPayload>;
  }> {
    const now = new Date();
    const dueAt = new Date(input.dueAt);

    const task = await TaskModel.create({
      userId: new Types.ObjectId(input.userId),
      title: input.title,
      description: input.description ?? null,
      status: 'pending',
      priority: input.priority ?? 3,
      schedule: {
        startAt: now,
        dueAt,
        reminderIntervalMinutes: input.reminderIntervalMinutes ?? 30,
      },
      metadata: {
        tags: input.tags ?? [],
        aiBreakdownGenerated: false,
      },
    });

    const event = createEventEnvelope<TaskCreatedPayload>({
      type: EventTypes.TaskCreated,
      source: 'task-service',
      traceId: input.traceId,
      payload: {
        taskId: task._id.toString(),
        userId: task.userId.toString(),
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueAt: task.schedule.dueAt.toISOString(),
        reminderIntervalMinutes: task.schedule.reminderIntervalMinutes,
        createdAt: task.createdAt.toISOString(),
      },
    });

    await OutboxEventModel.create({
      eventId: event.eventId,
      type: event.type,
      version: event.version,
      sourceService: 'task-service',
      aggregateType: 'task',
      aggregateId: task._id,
      traceId: event.traceId,
      payload: event.payload,
      status: 'pending',
      retryCount: 0,
      nextAttemptAt: new Date(),
    });

    return {
      task: serializeTask(task),
      event,
    };
  }

  async completeTaskAndEvent(input: {
    taskId: string;
    traceId: string;
    userId?: string;
  }): Promise<{ task: TaskResponse; event: EventEnvelope<TaskCompletedPayload> } | null> {
    const query: {
      _id: string;
      status: { $ne: string };
      userId?: Types.ObjectId;
    } = {
      _id: input.taskId,
      status: { $ne: 'deleted' },
    };

    if (input.userId) {
      query.userId = new Types.ObjectId(input.userId);
    }

    const task = await TaskModel.findOneAndUpdate(
      query,
      { $set: { status: 'completed' } },
      { new: true },
    );

    if (!task) {
      return null;
    }

    const event = createEventEnvelope<TaskCompletedPayload>({
      type: EventTypes.TaskCompleted,
      source: 'task-service',
      traceId: input.traceId,
      payload: {
        taskId: task._id.toString(),
        userId: task.userId.toString(),
        completedAt: new Date().toISOString(),
      },
    });

    await OutboxEventModel.create({
      eventId: event.eventId,
      type: event.type,
      version: event.version,
      sourceService: 'task-service',
      aggregateType: 'task',
      aggregateId: task._id,
      traceId: event.traceId,
      payload: event.payload,
      status: 'pending',
      retryCount: 0,
      nextAttemptAt: new Date(),
    });

    return {
      task: serializeTask(task),
      event,
    };
  }

  async getTaskById(id: string, userId?: string): Promise<TaskResponse | null> {
    const query: {
      _id: string;
      userId?: Types.ObjectId;
    } = { _id: id };

    if (userId) {
      query.userId = new Types.ObjectId(userId);
    }

    const task = await TaskModel.findOne(query);
    return task ? serializeTask(task) : null;
  }

  async listTasks(userId: string): Promise<TaskResponse[]> {
    const tasks = await TaskModel.find({ userId: new Types.ObjectId(userId), status: { $ne: 'deleted' } })
      .sort({ createdAt: -1 })
      .limit(100);

    return tasks.map(serializeTask);
  }
}
