import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 질문 시드 데이터 (100개)
const questions = [
  // DAILY - 일상 (30개)
  { content: '오늘 하루 중 가장 좋았던 순간은 언제였나요?', category: 'DAILY' },
  { content: '요즘 가장 좋아하는 음식은 무엇인가요?', category: 'DAILY' },
  { content: '오늘 감사했던 일이 있다면 무엇인가요?', category: 'DAILY' },
  { content: '최근에 웃겼던 일이 있나요?', category: 'DAILY' },
  { content: '요즘 즐겨 보는 드라마나 영화가 있나요?', category: 'DAILY' },
  { content: '오늘 점심은 뭘 먹었나요? 맛있었나요?', category: 'DAILY' },
  { content: '요즘 자주 듣는 노래가 있나요?', category: 'DAILY' },
  { content: '오늘 가장 힘들었던 일은 무엇인가요?', category: 'DAILY' },
  { content: '요즘 하고 싶은 것이 있다면 무엇인가요?', category: 'DAILY' },
  { content: '오늘 날씨를 어떻게 느꼈나요?', category: 'DAILY' },
  { content: '요즘 자주 가는 카페나 식당이 있나요?', category: 'DAILY' },
  { content: '오늘 누군가에게 친절을 베푼 적이 있나요?', category: 'DAILY' },
  { content: '요즘 가장 스트레스받는 일은 무엇인가요?', category: 'DAILY' },
  { content: '이번 주 가장 기억에 남는 순간은?', category: 'DAILY' },
  { content: '오늘 하루를 한 단어로 표현한다면?', category: 'DAILY' },
  { content: '요즘 가장 즐거웠던 취미 활동은?', category: 'DAILY' },
  { content: '오늘 새로 알게 된 것이 있나요?', category: 'DAILY' },
  { content: '이번 주 기분은 어땠나요?', category: 'DAILY' },
  { content: '요즘 가장 설레는 것은 무엇인가요?', category: 'DAILY' },
  { content: '오늘 운동을 했나요? 어떤 운동을 했나요?', category: 'DAILY' },
  { content: '요즘 가장 자주 하는 말은 무엇인가요?', category: 'DAILY' },
  { content: '오늘 기분을 색깔로 표현한다면?', category: 'DAILY' },
  { content: '이번 달 가장 잘한 일은 무엇인가요?', category: 'DAILY' },
  { content: '요즘 어떤 책을 읽고 있나요?', category: 'DAILY' },
  { content: '오늘 아침에 일어나서 제일 먼저 한 일은?', category: 'DAILY' },
  { content: '요즘 푹 쉰다고 느낄 때는 언제인가요?', category: 'DAILY' },
  { content: '이번 주 있었던 재밌는 일 하나 소개해주세요', category: 'DAILY' },
  { content: '오늘 가장 많이 생각한 것은 무엇인가요?', category: 'DAILY' },
  { content: '요즘 어떤 유튜브나 콘텐츠를 즐겨보나요?', category: 'DAILY' },
  { content: '오늘 만난 사람 중 인상 깊었던 사람이 있나요?', category: 'DAILY' },

  // MEMORY - 추억 (20개)
  { content: '어린 시절 가장 좋았던 추억은 무엇인가요?', category: 'MEMORY' },
  { content: '가족과 함께한 여행 중 가장 기억에 남는 여행은?', category: 'MEMORY' },
  { content: '처음으로 요리를 해본 기억이 나나요?', category: 'MEMORY' },
  { content: '학창 시절 가장 친했던 친구는 누구였나요?', category: 'MEMORY' },
  { content: '어릴 때 가장 좋아했던 장난감은 무엇인가요?', category: 'MEMORY' },
  { content: '가장 기억에 남는 생일은 언제인가요?', category: 'MEMORY' },
  { content: '처음 자전거를 탔던 날을 기억하나요?', category: 'MEMORY' },
  { content: '어린 시절 가장 좋아했던 음식은 무엇인가요?', category: 'MEMORY' },
  { content: '학교에서 가장 좋아했던 선생님은 누구였나요?', category: 'MEMORY' },
  { content: '어릴 때 꿈이 무엇이었나요?', category: 'MEMORY' },
  { content: '가족과 함께 먹었던 음식 중 가장 맛있었던 것은?', category: 'MEMORY' },
  { content: '어린 시절 가장 신났던 명절 기억은?', category: 'MEMORY' },
  { content: '처음 해외여행을 갔던 때를 기억하나요?', category: 'MEMORY' },
  { content: '학창 시절 가장 재밌었던 수업은 무엇이었나요?', category: 'MEMORY' },
  { content: '어릴 때 가족과 함께 봤던 영화 중 기억나는 것은?', category: 'MEMORY' },
  { content: '처음 친구를 사귄 기억이 있나요?', category: 'MEMORY' },
  { content: '어린 시절 가장 무서웠던 기억은?', category: 'MEMORY' },
  { content: '가장 기억에 남는 가족 여행지는 어디인가요?', category: 'MEMORY' },
  { content: '학교 때 가장 열심히 했던 활동은?', category: 'MEMORY' },
  { content: '어릴 때 자주 놀던 장소나 놀이는?', category: 'MEMORY' },

  // VALUE - 가치관 (15개)
  { content: '인생에서 가장 중요하게 생각하는 가치는 무엇인가요?', category: 'VALUE' },
  { content: '행복이란 무엇이라고 생각하나요?', category: 'VALUE' },
  { content: '가족이란 어떤 의미인가요?', category: 'VALUE' },
  { content: '좋은 부모/자녀가 되려면 어떻게 해야 할까요?', category: 'VALUE' },
  { content: '돈보다 중요한 것이 있다면 무엇인가요?', category: 'VALUE' },
  { content: '성공이란 무엇이라고 생각하나요?', category: 'VALUE' },
  { content: '우정에서 가장 중요한 것은 무엇인가요?', category: 'VALUE' },
  { content: '나에게 가장 중요한 관계는 무엇인가요?', category: 'VALUE' },
  { content: '용기란 무엇이라고 생각하나요?', category: 'VALUE' },
  { content: '정직이 중요한 이유는 무엇인가요?', category: 'VALUE' },
  { content: '나만의 인생 철학이 있다면?', category: 'VALUE' },
  { content: '나이가 들어도 변하지 않았으면 하는 것은?', category: 'VALUE' },
  { content: '타인을 위해 할 수 있는 가장 가치 있는 일은?', category: 'VALUE' },
  { content: '실패에서 배운 가장 중요한 교훈은?', category: 'VALUE' },
  { content: '삶에서 포기하지 말아야 할 것이 있다면?', category: 'VALUE' },

  // DREAM - 꿈/목표 (15개)
  { content: '어린 시절 꿈은 무엇이었나요?', category: 'DREAM' },
  { content: '지금 가장 이루고 싶은 목표는 무엇인가요?', category: 'DREAM' },
  { content: '10년 후 어떤 모습이고 싶나요?', category: 'DREAM' },
  { content: '버킷리스트에 있는 것이 있다면 무엇인가요?', category: 'DREAM' },
  { content: '가족과 함께 꼭 해보고 싶은 일이 있나요?', category: 'DREAM' },
  { content: '다음 여행지로 가고 싶은 곳은 어디인가요?', category: 'DREAM' },
  { content: '배워보고 싶은 새로운 기술이나 취미가 있나요?', category: 'DREAM' },
  { content: '올해 안에 꼭 이루고 싶은 것이 있다면?', category: 'DREAM' },
  { content: '5년 후 어떤 삶을 살고 싶나요?', category: 'DREAM' },
  { content: '꿈꾸는 이상적인 하루는 어떤 모습인가요?', category: 'DREAM' },
  { content: '가족에게 이루어주고 싶은 소원이 있다면?', category: 'DREAM' },
  { content: '언젠가 꼭 가보고 싶은 나라는 어디인가요?', category: 'DREAM' },
  { content: '새로운 도전을 해보고 싶은 분야가 있나요?', category: 'DREAM' },
  { content: '미래의 나에게 하고 싶은 말이 있다면?', category: 'DREAM' },
  { content: '지금 가장 열심히 준비하고 있는 것은?', category: 'DREAM' },

  // GRATITUDE - 감사 (10개)
  { content: '가족에게 감사한 점은 무엇인가요?', category: 'GRATITUDE' },
  { content: '최근에 누군가에게 고마웠던 일이 있나요?', category: 'GRATITUDE' },
  { content: '오늘 당연하게 여겼지만 감사한 것은?', category: 'GRATITUDE' },
  { content: '부모님께 가장 감사한 점은 무엇인가요?', category: 'GRATITUDE' },
  { content: '건강에 대해 감사한 마음이 든 적이 있나요?', category: 'GRATITUDE' },
  { content: '나의 일상에서 감사한 것 세 가지는?', category: 'GRATITUDE' },
  { content: '나를 성장시켜준 경험에 감사한 것은?', category: 'GRATITUDE' },
  { content: '지금 이 순간 감사하다고 느끼는 것은?', category: 'GRATITUDE' },
  { content: '나에게 도움을 준 사람에게 감사의 말을 전한다면?', category: 'GRATITUDE' },
  { content: '오늘 가족에게 고마운 점 하나를 이야기해주세요', category: 'GRATITUDE' },

  // SPECIAL - 특별한 날 (10개)
  { content: '올해 가장 특별했던 날은 언제인가요?', category: 'SPECIAL' },
  { content: '가장 기억에 남는 명절은 언제인가요?', category: 'SPECIAL' },
  { content: '새해 다짐이 있다면 무엇인가요?', category: 'SPECIAL' },
  { content: '가족과 보낸 가장 특별한 하루는 언제였나요?', category: 'SPECIAL' },
  { content: '가장 감동적인 선물을 받은 적이 있나요?', category: 'SPECIAL' },
  { content: '내 생애 가장 행복했던 날은 언제인가요?', category: 'SPECIAL' },
  { content: '가족과 함께 가장 즐거웠던 이벤트는?', category: 'SPECIAL' },
  { content: '잊을 수 없는 기념일이 있나요?', category: 'SPECIAL' },
  { content: '가족에게 깜짝 선물을 준 적이 있나요?', category: 'SPECIAL' },
  { content: '가장 최근의 특별한 날을 기억하나요?', category: 'SPECIAL' },
];

async function main() {
  console.log('🌱 Seeding database...');

  // 기존 질문 삭제 (이미 존재하는 경우 스킵)
  const existingCount = await prisma.question.count({ where: { isCustom: false } });
  if (existingCount >= 100) {
    console.log(`✅ Questions already seeded (${existingCount} found). Skipping.`);
    return;
  }

  // 기존 데이터 초기화 (첫 실행 시에만)
  await prisma.dailyQuestion.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.question.deleteMany({ where: { isCustom: false } });

  // 질문 생성
  for (const question of questions) {
    await prisma.question.create({
      data: {
        content: question.content,
        category: question.category as any,
        isActive: true,
      },
    });
  }

  console.log(`✅ Created ${questions.length} questions`);
  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
