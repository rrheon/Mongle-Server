import { PrismaClient } from '@prisma/client';

// PrismaClient 싱글톤 인스턴스
// Lambda 환경에서 커넥션 풀 관리를 위해 전역으로 관리
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'dev' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export default prisma;
