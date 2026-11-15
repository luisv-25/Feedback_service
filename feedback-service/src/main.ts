import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { Transport, MicroserviceOptions } from "@nestjs/microservices";
import { AppModule } from "./app.module";
import { setupMetrics } from "./metrics";

// RabbitMQ puede rechazar la conexión (p. ej. límite de conexiones del plan
// gratis de CloudAMQP). Sin esto, Node cierra el proceso con "Exited with
// status 1" y la API HTTP tampoco levanta.
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[feedback-service] unhandledRejection (¿RabbitMQ?):", reason);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupMetrics(app);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix("api/v1");

  // Consumidor asíncrono de booking.completed en su propia cola
  // (feedback_events_queue) -- mismo patrón que payment_events_queue.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672"],
      queue: "feedback_events_queue",
      queueOptions: { durable: true },
    },
  });
  try {
    await app.startAllMicroservices();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[feedback-service] No se pudo conectar el consumidor RabbitMQ; la API HTTP sigue activa", err);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[feedback-service] listening on port ${port}`);
}
bootstrap();

