import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface MoodRecordDTO {
  id: string;
  mood: string;
  note: string | null;
  date: string; // YYYY-MM-DD
}

export interface SaveMoodResult {
  record: MoodRecordDTO;
}

export class MoodService {

  async saveMood(userId: string, mood: string, note?: string, dateStr?: string): Promise<SaveMoodResult> {
    const date = dateStr ? new Date(dateStr) : new Date();
    // Normalize to date-only (midnight UTC)
    const normalizedDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

    const record = await prisma.moodRecord.upsert({
      where: { userId_date: { userId, date: normalizedDate } },
      create: { userId, mood, note: note ?? null, date: normalizedDate },
      update: { mood, note: note ?? null },
    });

    return {
      record: this.toDTO(record),
    };
  }

  async getMoods(userId: string, days: number): Promise<MoodRecordDTO[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceNorm = new Date(Date.UTC(since.getFullYear(), since.getMonth(), since.getDate()));

    const records = await prisma.moodRecord.findMany({
      where: { userId, date: { gte: sinceNorm } },
      orderBy: { date: 'desc' },
    });

    return records.map(r => this.toDTO(r));
  }

  private toDTO(r: { id: string; mood: string; note: string | null; date: Date }): MoodRecordDTO {
    const d = r.date;
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    return { id: r.id, mood: r.mood, note: r.note, date: dateStr };
  }
}
