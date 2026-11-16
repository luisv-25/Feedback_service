import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { BookingCompletedConsumer } from "../../src/events/booking-completed.consumer";
import { EventsPublisher } from "../../src/events/events.publisher";
import { createTestApp, fakeEventsPublisher, tokenFor } from "../helpers/test-app";

// Prueba de INTEGRACIÓN: HTTP -> controlador -> servicio -> PostgreSQL real.
// Solo RabbitMQ se reemplaza (publicador falso); el consumidor se invoca directamente con un canal falso.
describe("Integración: valoraciones y notas de progreso", () => {
  let app: INestApplication;
  const events = fakeEventsPublisher();
  const channel = { ack: jest.fn(), nack: jest.fn() };
  const ctx: any = { getChannelRef: () => channel, getMessage: () => ({}) };

  const BOOKING = "11111111-1111-4111-8111-111111111111";
  const BOOKING_2 = "22222222-2222-4222-8222-222222222222";
  const SUBJECT = "33333333-3333-4333-8333-333333333333";
  const evento = (bookingId: string) => ({
    eventName: "booking.completed",
    occurredAt: new Date().toISOString(),
    data: { bookingId, studentId: "est-1", tutorId: "tut-1" },
  });

  beforeAll(async () => {
    app = await createTestApp([AppModule], [{ provide: EventsPublisher, useValue: events }]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("habilita la valoración con booking.completed, califica una sola vez, publica el promedio y gestiona notas de progreso con roles", async () => {
    const http = request(app.getHttpServer());
    const est = { Authorization: `Bearer ${tokenFor("est-1", "student")}` };
    const consumer = app.get(BookingCompletedConsumer);

    // Sin evento booking.completed la reserva no es calificable -> 404
    await http.post("/api/v1/feedback").set(est).send({ bookingId: BOOKING, score: 5 }).expect(404);

    // El consumidor habilita la reserva (y es idempotente ante eventos duplicados)
    await consumer.handleBookingCompleted(evento(BOOKING), ctx);
    await consumer.handleBookingCompleted(evento(BOOKING), ctx);
    expect(channel.ack).toHaveBeenCalledTimes(2);

    // Validaciones y autorización
    await http.post("/api/v1/feedback").send({ bookingId: BOOKING, score: 5 }).expect(401);
    await http.post("/api/v1/feedback").set("Authorization", `Bearer ${tokenFor("tut-1", "tutor")}`).send({ bookingId: BOOKING, score: 5 }).expect(403);
    await http.post("/api/v1/feedback").set(est).send({ bookingId: BOOKING, score: 6 }).expect(400);
    await http.post("/api/v1/feedback").set(est).send({ bookingId: BOOKING, score: 0 }).expect(400);
    await http.post("/api/v1/feedback").set("Authorization", `Bearer ${tokenFor("otro", "student")}`).send({ bookingId: BOOKING, score: 5 }).expect(403);

    // Una calificación válida: se guarda y se publica feedback.rating.updated
    const ok = await http.post("/api/v1/feedback").set(est).send({ bookingId: BOOKING, score: 4, comment: "Excelente" }).expect(201);
    expect(ok.body.score).toBe(4);
    expect(events.calls).toHaveLength(1);
    expect(events.calls[0]).toEqual({ event: "publishFeedbackRatingUpdated", args: [{ tutorId: "tut-1", avgRating: 4, ratingCount: 1 }] });

    // Solo una vez por reserva -> 400
    await http.post("/api/v1/feedback").set(est).send({ bookingId: BOOKING, score: 1 }).expect(400);

    // Segunda reserva: el promedio se recalcula (4 y 1 -> 2.5)
    await consumer.handleBookingCompleted(evento(BOOKING_2), ctx);
    await http.post("/api/v1/feedback").set(est).send({ bookingId: BOOKING_2, score: 1 }).expect(201);
    expect(events.calls[1].args[0]).toEqual({ tutorId: "tut-1", avgRating: 2.5, ratingCount: 2 });

    // Consulta pública: solo las ya calificadas
    const lista = await http.get("/api/v1/feedback/tutor/tut-1").expect(200);
    expect(lista.body).toHaveLength(2);
    expect(lista.body[0].score).toBe(1); // la más reciente primero

    // Notas de progreso: solo estudiantes crean; el estudiante ve solo las suyas; tutor/admin ven cualquiera
    await http.post("/api/v1/progress").set("Authorization", `Bearer ${tokenFor("tut-1", "tutor")}`).send({ subjectId: SUBJECT, note: "x" }).expect(403);
    await http.post("/api/v1/progress").set(est).send({ subjectId: "no-uuid", note: "x" }).expect(400);
    await http.post("/api/v1/progress").set(est).send({ subjectId: SUBJECT, note: "Entendí derivadas" }).expect(201);
    const propias = await http.get("/api/v1/progress/student/est-1").set(est).expect(200);
    expect(propias.body).toHaveLength(1);
    await http.get("/api/v1/progress/student/est-1").set("Authorization", `Bearer ${tokenFor("otro", "student")}`).expect(403);
    await http.get("/api/v1/progress/student/est-1").set("Authorization", `Bearer ${tokenFor("tut-1", "tutor")}`).expect(200);
  });
});
