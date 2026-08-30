export const aiServiceConfig = {
  serviceName: 'ai-service',
  port: Number(process.env.PORT ?? 3005),
  mongoUri: process.env.MONGO_URI,
};