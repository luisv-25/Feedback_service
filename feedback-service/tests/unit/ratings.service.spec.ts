import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { RatingsService } from "../../src/ratings/ratings.service";

// Pruebas UNITARIAS de RatingsService: el repositorio (BD) y el publicador (RabbitMQ) son mocks.
describe("RatingsService (unitaria, con mocks)", () => {
  const getRawOne = jest.fn();
  const qb: any = { select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getRawOne };
  const repo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
    create: jest.fn((x) => x),
    createQueryBuilder: jest.fn(() => qb),
  };
  const publisher = { publishFeedbackRatingUpdated: jest.fn() };
  const service = new RatingsService(repo as any, publisher as any);

  beforeEach(() => jest.clearAllMocks());

  it("Unitaria 1: calificar rechaza reserva no completada (404), de otro estudiante (403) o ya calificada (400), sin publicar eventos", async () => {
    const dto = { bookingId: "b1", score: 5 } as any;

    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.submit("est-1", dto)).rejects.toBeInstanceOf(NotFoundException);

    repo.findOne.mockResolvedValueOnce({ student_id: "otro", rated_at: null });
    await expect(service.submit("est-1", dto)).rejects.toBeInstanceOf(ForbiddenException);

    repo.findOne.mockResolvedValueOnce({ student_id: "est-1", rated_at: new Date() });
    await expect(service.submit("est-1", dto)).rejects.toBeInstanceOf(BadRequestException);

    expect(repo.save).not.toHaveBeenCalled();
    expect(publisher.publishFeedbackRatingUpdated).not.toHaveBeenCalled();
  });

  it("Unitaria 2: una calificación válida se guarda y publica feedback.rating.updated con el promedio redondeado a 2 decimales", async () => {
    repo.findOne.mockResolvedValue({ booking_id: "b1", student_id: "est-1", tutor_id: "tut-1", rated_at: null, score: null });
    getRawOne.mockResolvedValue({ avg: "4.3333333", count: "3" });

    const res = await service.submit("est-1", { bookingId: "b1", score: 4, comment: "Muy clara" } as any);

    expect(res.score).toBe(4);
    expect(res.comment).toBe("Muy clara");
    expect(res.rated_at).toBeInstanceOf(Date);
    expect(publisher.publishFeedbackRatingUpdated).toHaveBeenCalledWith({ tutorId: "tut-1", avgRating: 4.33, ratingCount: 3 });
  });

  it("markEligible es idempotente: si la fila ya existe no crea otra", async () => {
    repo.findOne.mockResolvedValue({ id: "r1" });
    await service.markEligible("b1", "est-1", "tut-1");
    expect(repo.save).not.toHaveBeenCalled();
  });
});
