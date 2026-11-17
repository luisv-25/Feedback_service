# feedback-service

Calificaciones/reseñas de sesiones y progreso del estudiante.

Parte de **EduConecta** (plataforma de tutorías, arquitectura de microservicios). Stack: NestJS · TypeORM · PostgreSQL · RabbitMQ.

## Requisitos
- Node.js 20+
- PostgreSQL 14+ (local o Neon)
- RabbitMQ (CloudAMQP o local)

## Puesta en marcha
```bash
cd feedback-service
cp .env.example .env   # completar valores
npm install
npm run start:dev      # desarrollo
npm run build && npm start   # producción
```
El servicio escucha en `PORT` (por defecto 5438). Salud: `GET /health` y `GET /ready`; métricas: `GET /metrics`.

## Variables de entorno
Ver `.env.example`. Todos los servicios que validan JWT deben usar el **mismo** `JWT_SECRET` (y el gateway también).

## Endpoints
| Método | Ruta |
|---|---|
| POST | `/api/v1/progress` |
| GET | `/api/v1/progress/student/:studentId` |
| POST | `/api/v1/feedback` |
| GET | `/api/v1/feedback/tutor/:tutorId` |

## Mensajería (RabbitMQ)
- Colas: `feedback_events_queue`, `feedback_rating_events_queue`
- Consume: `booking.completed`
- Publica: `feedback.rating.updated`


## Pruebas
```bash
npm run test:unit
npm run test:integration   # requiere PostgreSQL (TEST_DB_PASSWORD)
```
CI/CD: GitHub Actions (`.github/workflows/ci.yml` y `deploy.yml`, despliegue a Render por Deploy Hook).
