import { PrismaClient } from '@prisma/client';
import { toKstMidnight, getKstToday } from '../utils/kst';

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
    // 클라이언트가 "오늘" 의도로 보낸 요청을 서버 UTC 기준으로 normalize 하면
    // KST 0~8 시 요청이 전날로 저장되던 off-by-one 발생. KST 자정으로 통일.
    const normalizedDate = dateStr ? toKstMidnight(dateStr) : getKstToday();

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
    const today = getKstToday();
    const sinceNorm = new Date(today);
    sinceNorm.setUTCDate(today.getUTCDate() - days);

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
