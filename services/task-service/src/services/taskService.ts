import { TaskRepository, type CreateTaskInput } from '../repositories/taskRepository';

export class TaskService {
  private readonly repo = new TaskRepository();

  async createTask(input: CreateTaskInput) {
    if (input.idempotencyKey) {
      const existing = await this.repo.findIdempotencyResponse(input.userId, input.idempotencyKey);
      if (existing) {
        return {
          ...existing.response,
          replayed: true,
        };
      }
    }

    const result = await this.repo.createTaskAndEvent(input);
    const response = {
      replayed: false,
      task: result.task,
      eventId: result.event.eventId,
    };

    if (input.idempotencyKey) {
      try {
        await this.repo.saveIdempotencyResponse({
          userId: input.userId,
          key: input.idempotencyKey,
          requestBody: input,
          response,
        });
      } catch {
        const existing = await this.repo.findIdempotencyResponse(input.userId, input.idempotencyKey);
        if (existing) {
          return {
            ...existing.response,
            replayed: true,
          };
        }
      }
    }

    return response;
  }

  async completeTask(taskId: string, traceId: string, userId?: string) {
    return this.repo.completeTaskAndEvent({ taskId, traceId, userId });
  }

  async getTaskById(id: string, userId?: string) {
    return this.repo.getTaskById(id, userId);
  }

  async listTasks(userId: string) {
    return this.repo.listTasks(userId);
  }
}
