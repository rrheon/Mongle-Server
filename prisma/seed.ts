import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 질문 시드 데이터 (한국어 + 영어 + 일본어)
const questions = [
  // DAILY - 일상 (30개)
  { content: '오늘 하루 중 가장 좋았던 순간은 언제였나요?', contentEn: 'What was the best moment of your day today?', contentJa: '今日一日の中で一番良かった瞬間はいつでしたか？', category: 'DAILY' },
  { content: '요즘 가장 좋아하는 음식은 무엇인가요?', contentEn: 'What is your favorite food these days?', contentJa: '最近一番好きな食べ物は何ですか？', category: 'DAILY' },
  { content: '오늘 감사했던 일이 있다면 무엇인가요?', contentEn: 'What were you grateful for today?', contentJa: '今日感謝したことがあれば何ですか？', category: 'DAILY' },
  { content: '최근에 웃겼던 일이 있나요?', contentEn: 'Has anything funny happened recently?', contentJa: '最近面白かったことはありますか？', category: 'DAILY' },
  { content: '요즘 즐겨 보는 드라마나 영화가 있나요?', contentEn: 'Are you watching any dramas or movies lately?', contentJa: '最近ハマっているドラマや映画はありますか？', category: 'DAILY' },
  { content: '오늘 점심은 뭘 먹었나요? 맛있었나요?', contentEn: 'What did you have for lunch today? Was it good?', contentJa: '今日のお昼は何を食べましたか？美味しかったですか？', category: 'DAILY' },
  { content: '요즘 자주 듣는 노래가 있나요?', contentEn: 'Is there a song you listen to often these days?', contentJa: '最近よく聴いている曲はありますか？', category: 'DAILY' },
  { content: '오늘 가장 힘들었던 일은 무엇인가요?', contentEn: 'What was the hardest thing about today?', contentJa: '今日一番大変だったことは何ですか？', category: 'DAILY' },
  { content: '요즘 하고 싶은 것이 있다면 무엇인가요?', contentEn: 'Is there anything you want to do lately?', contentJa: '最近やりたいことがあれば何ですか？', category: 'DAILY' },
  { content: '오늘 날씨를 어떻게 느꼈나요?', contentEn: 'How did you feel about the weather today?', contentJa: '今日の天気をどう感じましたか？', category: 'DAILY' },
  { content: '요즘 자주 가는 카페나 식당이 있나요?', contentEn: 'Do you have a favorite café or restaurant lately?', contentJa: '最近よく行くカフェやレストランはありますか？', category: 'DAILY' },
  { content: '오늘 누군가에게 친절을 베푼 적이 있나요?', contentEn: 'Did you do something kind for someone today?', contentJa: '今日誰かに親切にしたことはありますか？', category: 'DAILY' },
  { content: '요즘 가장 스트레스받는 일은 무엇인가요?', contentEn: 'What is stressing you out the most these days?', contentJa: '最近一番ストレスを感じていることは何ですか？', category: 'DAILY' },
  { content: '이번 주 가장 기억에 남는 순간은?', contentEn: 'What was the most memorable moment this week?', contentJa: '今週一番印象に残った瞬間は？', category: 'DAILY' },
  { content: '오늘 하루를 한 단어로 표현한다면?', contentEn: 'If you could describe today in one word?', contentJa: '今日一日を一言で表すなら？', category: 'DAILY' },
  { content: '요즘 가장 즐거웠던 취미 활동은?', contentEn: 'What hobby has brought you the most joy lately?', contentJa: '最近一番楽しかった趣味の活動は？', category: 'DAILY' },
  { content: '오늘 새로 알게 된 것이 있나요?', contentEn: 'Did you learn anything new today?', contentJa: '今日新しく知ったことはありますか？', category: 'DAILY' },
  { content: '이번 주 기분은 어땠나요?', contentEn: 'How has your mood been this week?', contentJa: '今週の気分はどうでしたか？', category: 'DAILY' },
  { content: '요즘 가장 설레는 것은 무엇인가요?', contentEn: 'What excites you the most these days?', contentJa: '最近一番ワクワクしていることは何ですか？', category: 'DAILY' },
  { content: '오늘 운동을 했나요? 어떤 운동을 했나요?', contentEn: 'Did you exercise today? What did you do?', contentJa: '今日運動しましたか？どんな運動をしましたか？', category: 'DAILY' },
  { content: '요즘 가장 자주 하는 말은 무엇인가요?', contentEn: 'What phrase do you say most often these days?', contentJa: '最近一番よく言う言葉は何ですか？', category: 'DAILY' },
  { content: '오늘 기분을 색깔로 표현한다면?', contentEn: 'If you could express your mood today as a color?', contentJa: '今日の気分を色で表すなら？', category: 'DAILY' },
  { content: '이번 달 가장 잘한 일은 무엇인가요?', contentEn: 'What did you do best this month?', contentJa: '今月一番うまくいったことは何ですか？', category: 'DAILY' },
  { content: '요즘 어떤 책을 읽고 있나요?', contentEn: 'What book are you reading these days?', contentJa: '最近どんな本を読んでいますか？', category: 'DAILY' },
  { content: '오늘 아침에 일어나서 제일 먼저 한 일은?', contentEn: 'What was the first thing you did when you woke up today?', contentJa: '今朝起きて最初にしたことは？', category: 'DAILY' },
  { content: '요즘 푹 쉰다고 느낄 때는 언제인가요?', contentEn: 'When do you feel like you are truly resting lately?', contentJa: '最近ゆっくり休めていると感じるのはいつですか？', category: 'DAILY' },
  { content: '이번 주 있었던 재밌는 일 하나 소개해주세요', contentEn: 'Share one fun thing that happened this week', contentJa: '今週あった面白い出来事を一つ教えてください', category: 'DAILY' },
  { content: '오늘 가장 많이 생각한 것은 무엇인가요?', contentEn: 'What did you think about the most today?', contentJa: '今日一番考えたことは何ですか？', category: 'DAILY' },
  { content: '요즘 어떤 유튜브나 콘텐츠를 즐겨보나요?', contentEn: 'What YouTube or content do you enjoy watching lately?', contentJa: '最近よく見ているYouTubeやコンテンツはありますか？', category: 'DAILY' },
  { content: '오늘 만난 사람 중 인상 깊었던 사람이 있나요?', contentEn: 'Was there anyone you met today who left an impression?', contentJa: '今日会った人の中で印象深かった人はいますか？', category: 'DAILY' },

  // MEMORY - 추억 (20개)
  { content: '어린 시절 가장 좋았던 추억은 무엇인가요?', contentEn: 'What is your best childhood memory?', contentJa: '子供の頃の一番良い思い出は何ですか？', category: 'MEMORY' },
  { content: '가족과 함께한 여행 중 가장 기억에 남는 여행은?', contentEn: 'What is the most memorable family trip?', contentJa: '家族と一緒に行った旅行で一番印象に残っているのは？', category: 'MEMORY' },
  { content: '처음으로 요리를 해본 기억이 나나요?', contentEn: 'Do you remember the first time you cooked?', contentJa: '初めて料理をした記憶はありますか？', category: 'MEMORY' },
  { content: '학창 시절 가장 친했던 친구는 누구였나요?', contentEn: 'Who was your closest friend during school days?', contentJa: '学生時代に一番仲が良かった友達は誰でしたか？', category: 'MEMORY' },
  { content: '어릴 때 가장 좋아했던 장난감은 무엇인가요?', contentEn: 'What was your favorite toy as a child?', contentJa: '子供の頃一番好きだったおもちゃは何ですか？', category: 'MEMORY' },
  { content: '가장 기억에 남는 생일은 언제인가요?', contentEn: 'What is the most memorable birthday you have had?', contentJa: '一番印象に残っている誕生日はいつですか？', category: 'MEMORY' },
  { content: '처음 자전거를 탔던 날을 기억하나요?', contentEn: 'Do you remember the first time you rode a bicycle?', contentJa: '初めて自転車に乗った日を覚えていますか？', category: 'MEMORY' },
  { content: '어린 시절 가장 좋아했던 음식은 무엇인가요?', contentEn: 'What was your favorite food as a child?', contentJa: '子供の頃一番好きだった食べ物は何ですか？', category: 'MEMORY' },
  { content: '학교에서 가장 좋아했던 선생님은 누구였나요?', contentEn: 'Who was your favorite teacher at school?', contentJa: '学校で一番好きだった先生は誰でしたか？', category: 'MEMORY' },
  { content: '어릴 때 꿈이 무엇이었나요?', contentEn: 'What was your dream when you were young?', contentJa: '子供の頃の夢は何でしたか？', category: 'MEMORY' },
  { content: '가족과 함께 먹었던 음식 중 가장 맛있었던 것은?', contentEn: 'What is the most delicious meal you shared with family?', contentJa: '家族と一緒に食べた料理で一番美味しかったものは？', category: 'MEMORY' },
  { content: '어린 시절 가장 신났던 명절 기억은?', contentEn: 'What is your most exciting holiday memory from childhood?', contentJa: '子供の頃一番ワクワクした祝日の思い出は？', category: 'MEMORY' },
  { content: '처음 해외여행을 갔던 때를 기억하나요?', contentEn: 'Do you remember your first trip abroad?', contentJa: '初めて海外旅行に行った時を覚えていますか？', category: 'MEMORY' },
  { content: '학창 시절 가장 재밌었던 수업은 무엇이었나요?', contentEn: 'What was the most fun class during your school days?', contentJa: '学生時代に一番楽しかった授業は何でしたか？', category: 'MEMORY' },
  { content: '어릴 때 가족과 함께 봤던 영화 중 기억나는 것은?', contentEn: 'What movie do you remember watching with family as a child?', contentJa: '子供の頃家族と一緒に見た映画で覚えているものは？', category: 'MEMORY' },
  { content: '처음 친구를 사귄 기억이 있나요?', contentEn: 'Do you remember making your first friend?', contentJa: '初めて友達ができた記憶はありますか？', category: 'MEMORY' },
  { content: '어린 시절 가장 무서웠던 기억은?', contentEn: 'What was your scariest memory from childhood?', contentJa: '子供の頃一番怖かった記憶は？', category: 'MEMORY' },
  { content: '가장 기억에 남는 가족 여행지는 어디인가요?', contentEn: 'What is the most memorable family travel destination?', contentJa: '一番印象に残っている家族旅行先はどこですか？', category: 'MEMORY' },
  { content: '학교 때 가장 열심히 했던 활동은?', contentEn: 'What activity did you put the most effort into at school?', contentJa: '学校で一番頑張った活動は？', category: 'MEMORY' },
  { content: '어릴 때 자주 놀던 장소나 놀이는?', contentEn: 'What was your favorite place or game as a child?', contentJa: '子供の頃よく遊んでいた場所や遊びは？', category: 'MEMORY' },

  // VALUE - 가치관 (15개)
  { content: '인생에서 가장 중요하게 생각하는 가치는 무엇인가요?', contentEn: 'What values do you consider most important in life?', contentJa: '人生で一番大切にしている価値観は何ですか？', category: 'VALUE' },
  { content: '행복이란 무엇이라고 생각하나요?', contentEn: 'What do you think happiness is?', contentJa: '幸せとは何だと思いますか？', category: 'VALUE' },
  { content: '가족이란 어떤 의미인가요?', contentEn: 'What does family mean to you?', contentJa: '家族とはどんな意味ですか？', category: 'VALUE' },
  { content: '좋은 부모/자녀가 되려면 어떻게 해야 할까요?', contentEn: 'What does it take to be a good parent/child?', contentJa: '良い親/子供になるにはどうすればいいですか？', category: 'VALUE' },
  { content: '돈보다 중요한 것이 있다면 무엇인가요?', contentEn: 'What is more important than money?', contentJa: 'お金より大切なものがあるとしたら何ですか？', category: 'VALUE' },
  { content: '성공이란 무엇이라고 생각하나요?', contentEn: 'What do you think success is?', contentJa: '成功とは何だと思いますか？', category: 'VALUE' },
  { content: '우정에서 가장 중요한 것은 무엇인가요?', contentEn: 'What is the most important thing in friendship?', contentJa: '友情で一番大切なことは何ですか？', category: 'VALUE' },
  { content: '나에게 가장 중요한 관계는 무엇인가요?', contentEn: 'What is the most important relationship to you?', contentJa: '自分にとって一番大切な関係は何ですか？', category: 'VALUE' },
  { content: '용기란 무엇이라고 생각하나요?', contentEn: 'What do you think courage is?', contentJa: '勇気とは何だと思いますか？', category: 'VALUE' },
  { content: '정직이 중요한 이유는 무엇인가요?', contentEn: 'Why is honesty important?', contentJa: '正直さが大切な理由は何ですか？', category: 'VALUE' },
  { content: '나만의 인생 철학이 있다면?', contentEn: 'Do you have your own life philosophy?', contentJa: '自分だけの人生哲学があれば？', category: 'VALUE' },
  { content: '나이가 들어도 변하지 않았으면 하는 것은?', contentEn: 'What do you hope never changes as you age?', contentJa: '年を取っても変わらないでほしいことは？', category: 'VALUE' },
  { content: '타인을 위해 할 수 있는 가장 가치 있는 일은?', contentEn: 'What is the most valuable thing you can do for others?', contentJa: '他人のためにできる一番価値あることは？', category: 'VALUE' },
  { content: '실패에서 배운 가장 중요한 교훈은?', contentEn: 'What is the most important lesson you learned from failure?', contentJa: '失敗から学んだ一番大切な教訓は？', category: 'VALUE' },
  { content: '삶에서 포기하지 말아야 할 것이 있다면?', contentEn: 'What should you never give up on in life?', contentJa: '人生で諦めてはいけないことがあるとしたら？', category: 'VALUE' },

  // DREAM - 꿈/목표 (15개)
  { content: '어린 시절 꿈은 무엇이었나요?', contentEn: 'What was your childhood dream?', contentJa: '子供の頃の夢は何でしたか？', category: 'DREAM' },
  { content: '지금 가장 이루고 싶은 목표는 무엇인가요?', contentEn: 'What is the goal you most want to achieve right now?', contentJa: '今一番達成したい目標は何ですか？', category: 'DREAM' },
  { content: '10년 후 어떤 모습이고 싶나요?', contentEn: 'What do you want to be like in 10 years?', contentJa: '10年後どんな自分でいたいですか？', category: 'DREAM' },
  { content: '버킷리스트에 있는 것이 있다면 무엇인가요?', contentEn: 'What is on your bucket list?', contentJa: 'バケットリストにあるものは何ですか？', category: 'DREAM' },
  { content: '가족과 함께 꼭 해보고 싶은 일이 있나요?', contentEn: 'Is there something you really want to do with your family?', contentJa: '家族と一緒にぜひやりたいことはありますか？', category: 'DREAM' },
  { content: '다음 여행지로 가고 싶은 곳은 어디인가요?', contentEn: 'Where would you like to travel next?', contentJa: '次に行きたい旅行先はどこですか？', category: 'DREAM' },
  { content: '배워보고 싶은 새로운 기술이나 취미가 있나요?', contentEn: 'Is there a new skill or hobby you want to learn?', contentJa: '学んでみたい新しいスキルや趣味はありますか？', category: 'DREAM' },
  { content: '올해 안에 꼭 이루고 싶은 것이 있다면?', contentEn: 'What do you want to accomplish this year?', contentJa: '今年中にぜひ達成したいことは？', category: 'DREAM' },
  { content: '5년 후 어떤 삶을 살고 싶나요?', contentEn: 'What kind of life do you want to live in 5 years?', contentJa: '5年後どんな生活をしたいですか？', category: 'DREAM' },
  { content: '꿈꾸는 이상적인 하루는 어떤 모습인가요?', contentEn: 'What does your ideal day look like?', contentJa: '夢見る理想的な一日はどんな姿ですか？', category: 'DREAM' },
  { content: '가족에게 이루어주고 싶은 소원이 있다면?', contentEn: 'If you could grant one wish for your family?', contentJa: '家族に叶えてあげたい願いがあれば？', category: 'DREAM' },
  { content: '언젠가 꼭 가보고 싶은 나라는 어디인가요?', contentEn: 'What country do you want to visit someday?', contentJa: 'いつか必ず行きたい国はどこですか？', category: 'DREAM' },
  { content: '새로운 도전을 해보고 싶은 분야가 있나요?', contentEn: 'Is there a field you want to challenge yourself in?', contentJa: '新しいチャレンジをしてみたい分野はありますか？', category: 'DREAM' },
  { content: '미래의 나에게 하고 싶은 말이 있다면?', contentEn: 'What would you say to your future self?', contentJa: '未来の自分に言いたいことがあれば？', category: 'DREAM' },
  { content: '지금 가장 열심히 준비하고 있는 것은?', contentEn: 'What are you working hardest on right now?', contentJa: '今一番頑張って準備していることは？', category: 'DREAM' },

  // GRATITUDE - 감사 (10개)
  { content: '가족에게 감사한 점은 무엇인가요?', contentEn: 'What are you grateful to your family for?', contentJa: '家族に感謝していることは何ですか？', category: 'GRATITUDE' },
  { content: '최근에 누군가에게 고마웠던 일이 있나요?', contentEn: 'Has someone done something you were thankful for recently?', contentJa: '最近誰かに感謝したことはありますか？', category: 'GRATITUDE' },
  { content: '오늘 당연하게 여겼지만 감사한 것은?', contentEn: 'What did you take for granted today but are thankful for?', contentJa: '今日当たり前だと思っていたけど感謝していることは？', category: 'GRATITUDE' },
  { content: '부모님께 가장 감사한 점은 무엇인가요?', contentEn: 'What are you most grateful to your parents for?', contentJa: '親に一番感謝していることは何ですか？', category: 'GRATITUDE' },
  { content: '건강에 대해 감사한 마음이 든 적이 있나요?', contentEn: 'Have you ever felt grateful for your health?', contentJa: '健康に対して感謝の気持ちを感じたことはありますか？', category: 'GRATITUDE' },
  { content: '나의 일상에서 감사한 것 세 가지는?', contentEn: 'What are three things you are grateful for in your daily life?', contentJa: '日常で感謝していること三つは？', category: 'GRATITUDE' },
  { content: '나를 성장시켜준 경험에 감사한 것은?', contentEn: 'What experience are you grateful for because it helped you grow?', contentJa: '自分を成長させてくれた経験に感謝していることは？', category: 'GRATITUDE' },
  { content: '지금 이 순간 감사하다고 느끼는 것은?', contentEn: 'What are you feeling grateful for right now?', contentJa: '今この瞬間感謝していると感じることは？', category: 'GRATITUDE' },
  { content: '나에게 도움을 준 사람에게 감사의 말을 전한다면?', contentEn: 'What would you say to someone who has helped you?', contentJa: '助けてくれた人に感謝の言葉を伝えるなら？', category: 'GRATITUDE' },
  { content: '오늘 가족에게 고마운 점 하나를 이야기해주세요', contentEn: 'Share one thing you are thankful for about your family today', contentJa: '今日家族に感謝していることを一つ教えてください', category: 'GRATITUDE' },

  // SPECIAL - 특별한 날 (10개)
  { content: '올해 가장 특별했던 날은 언제인가요?', contentEn: 'What was the most special day this year?', contentJa: '今年一番特別だった日はいつですか？', category: 'SPECIAL' },
  { content: '가장 기억에 남는 명절은 언제인가요?', contentEn: 'What is the most memorable holiday?', contentJa: '一番印象に残っている祝日はいつですか？', category: 'SPECIAL' },
  { content: '새해 다짐이 있다면 무엇인가요?', contentEn: 'What is your New Year resolution?', contentJa: '新年の抱負があれば何ですか？', category: 'SPECIAL' },
  { content: '가족과 보낸 가장 특별한 하루는 언제였나요?', contentEn: 'What was the most special day you spent with family?', contentJa: '家族と過ごした一番特別な日はいつでしたか？', category: 'SPECIAL' },
  { content: '가장 감동적인 선물을 받은 적이 있나요?', contentEn: 'Have you ever received a truly touching gift?', contentJa: '一番感動的なプレゼントをもらったことはありますか？', category: 'SPECIAL' },
  { content: '내 생애 가장 행복했던 날은 언제인가요?', contentEn: 'What was the happiest day of your life?', contentJa: '人生で一番幸せだった日はいつですか？', category: 'SPECIAL' },
  { content: '가족과 함께 가장 즐거웠던 이벤트는?', contentEn: 'What was the most enjoyable family event?', contentJa: '家族と一緒に一番楽しかったイベントは？', category: 'SPECIAL' },
  { content: '잊을 수 없는 기념일이 있나요?', contentEn: 'Is there an unforgettable anniversary?', contentJa: '忘れられない記念日はありますか？', category: 'SPECIAL' },
  { content: '가족에게 깜짝 선물을 준 적이 있나요?', contentEn: 'Have you ever given a surprise gift to your family?', contentJa: '家族にサプライズプレゼントをしたことはありますか？', category: 'SPECIAL' },
  { content: '가장 최근의 특별한 날을 기억하나요?', contentEn: 'Do you remember the most recent special day?', contentJa: '一番最近の特別な日を覚えていますか？', category: 'SPECIAL' },

  // === 세대 간 소통 질문 (100개) ===

  // DAILY - 일상 (25개)
  { content: '요즘 가장 즐겁게 쉬는 방법이 뭔가요?', contentEn: 'What is your favorite way to relax these days?', contentJa: '最近一番楽しく休む方法は何ですか？', category: 'DAILY' },
  { content: '오늘 하루 중 제일 활기찼던 시간은 언제였나요?', contentEn: 'When was the most energetic moment of your day?', contentJa: '今日一日の中で一番活気があった時間はいつでしたか？', category: 'DAILY' },
  { content: '요즘 가장 자주 연락하는 사람은 누구인가요?', contentEn: 'Who do you keep in touch with most often lately?', contentJa: '最近一番よく連絡を取る人は誰ですか？', category: 'DAILY' },
  { content: '최근에 처음 해본 것이 있다면 뭔가요?', contentEn: 'What have you tried for the first time recently?', contentJa: '最近初めてやってみたことがあれば何ですか？', category: 'DAILY' },
  { content: '요즘 가장 많이 웃었던 순간은 언제인가요?', contentEn: 'When did you laugh the most recently?', contentJa: '最近一番たくさん笑った瞬間はいつですか？', category: 'DAILY' },
  { content: '오늘 하루 중 가장 집중했던 일은 무엇인가요?', contentEn: 'What did you focus on the most today?', contentJa: '今日一日の中で一番集中したことは何ですか？', category: 'DAILY' },
  { content: '요즘 건강을 위해 따로 하는 게 있나요?', contentEn: 'Are you doing anything for your health lately?', contentJa: '最近健康のために何かしていますか？', category: 'DAILY' },
  { content: '오늘 밥을 먹으면서 어떤 생각을 했나요?', contentEn: 'What were you thinking about while eating today?', contentJa: '今日ご飯を食べながらどんなことを考えましたか？', category: 'DAILY' },
  { content: '요즘 가장 자주 보는 뉴스나 정보는 무엇인가요?', contentEn: 'What news or information do you check most often lately?', contentJa: '最近一番よく見るニュースや情報は何ですか？', category: 'DAILY' },
  { content: '오늘 기분을 날씨에 비유하면 어떤가요?', contentEn: 'If you compared your mood to weather today, what would it be?', contentJa: '今日の気分を天気に例えるとどんな感じですか？', category: 'DAILY' },
  { content: '요즘 주로 어디서 시간을 보내나요?', contentEn: 'Where do you spend most of your time lately?', contentJa: '最近主にどこで時間を過ごしていますか？', category: 'DAILY' },
  { content: '이번 주 가장 기대되는 일이 있나요?', contentEn: 'Is there anything you are looking forward to this week?', contentJa: '今週一番楽しみなことはありますか？', category: 'DAILY' },
  { content: '요즘 친구들과 주로 무엇을 하며 어울리나요?', contentEn: 'What do you usually do when hanging out with friends lately?', contentJa: '最近友達と主に何をして過ごしていますか？', category: 'DAILY' },
  { content: '오늘 가장 먼저 떠오른 생각은 무엇인가요?', contentEn: 'What was the first thought on your mind today?', contentJa: '今日最初に思い浮かんだことは何ですか？', category: 'DAILY' },
  { content: '요즘 취미 생활을 즐기고 있나요?', contentEn: 'Are you enjoying any hobbies these days?', contentJa: '最近趣味の時間を楽しんでいますか？', category: 'DAILY' },
  { content: '최근에 새로 시작한 것이 있나요?', contentEn: 'Have you started anything new recently?', contentJa: '最近新しく始めたことはありますか？', category: 'DAILY' },
  { content: '오늘 하루를 점수로 매긴다면 몇 점인가요?', contentEn: 'If you rated today out of 10, what score would you give?', contentJa: '今日一日を点数で付けるなら何点ですか？', category: 'DAILY' },
  { content: '요즘 가장 맛있게 먹은 음식은 뭔가요?', contentEn: 'What was the most delicious thing you ate recently?', contentJa: '最近一番美味しかった食べ物は何ですか？', category: 'DAILY' },
  { content: '이번 주말에 뭘 하고 싶나요?', contentEn: 'What would you like to do this weekend?', contentJa: '今週末は何をしたいですか？', category: 'DAILY' },
  { content: '요즘 잠은 잘 자고 있나요?', contentEn: 'Are you sleeping well these days?', contentJa: '最近よく眠れていますか？', category: 'DAILY' },
  { content: '오늘 가장 오래 생각한 것은 무엇인가요?', contentEn: 'What did you spend the longest time thinking about today?', contentJa: '今日一番長く考えたことは何ですか？', category: 'DAILY' },
  { content: '요즘 가장 자주 가는 장소가 어디인가요?', contentEn: 'Where do you go most frequently these days?', contentJa: '最近一番よく行く場所はどこですか？', category: 'DAILY' },
  { content: '최근 새로 사거나 구입한 것이 있나요?', contentEn: 'Have you bought anything new recently?', contentJa: '最近新しく買ったものはありますか？', category: 'DAILY' },
  { content: '오늘 누군가에게 문자나 전화를 했나요?', contentEn: 'Did you text or call anyone today?', contentJa: '今日誰かにメッセージや電話をしましたか？', category: 'DAILY' },
  { content: '요즘 스마트폰으로 뭘 가장 많이 하나요?', contentEn: 'What do you use your smartphone for the most lately?', contentJa: '最近スマートフォンで一番何をしていますか？', category: 'DAILY' },

  // MEMORY - 추억 (20개)
  { content: '20~30대 시절 가장 즐거웠던 기억이 있나요?', contentEn: 'What is your happiest memory from your 20s-30s?', contentJa: '20〜30代の頃一番楽しかった思い出はありますか？', category: 'MEMORY' },
  { content: '부모님께서 어릴 적 나에게 해주신 말 중 아직도 기억나는 것이 있나요?', contentEn: 'Is there something your parents said to you as a child that you still remember?', contentJa: '親が子供の頃に言ってくれた言葉で今でも覚えていることはありますか？', category: 'MEMORY' },
  { content: '처음 취직했을 때 어떤 기분이었나요?', contentEn: 'How did you feel when you got your first job?', contentJa: '初めて就職した時どんな気持ちでしたか？', category: 'MEMORY' },
  { content: '내가 태어났을 때 어떤 마음이었는지 기억하나요?', contentEn: 'Do you remember how you felt when I was born?', contentJa: '私が生まれた時どんな気持ちだったか覚えていますか？', category: 'MEMORY' },
  { content: '처음 월급을 받았던 날 무엇을 했나요?', contentEn: 'What did you do on the day you received your first paycheck?', contentJa: '初めての給料日に何をしましたか？', category: 'MEMORY' },
  { content: '학창 시절 방과 후에 주로 무엇을 했나요?', contentEn: 'What did you usually do after school?', contentJa: '学生時代、放課後に主に何をしていましたか？', category: 'MEMORY' },
  { content: '젊었을 때 가장 열정적으로 했던 것은 무엇인가요?', contentEn: 'What were you most passionate about when you were young?', contentJa: '若い頃一番情熱を注いだことは何ですか？', category: 'MEMORY' },
  { content: '내가 어릴 때 제일 많이 혼난 적이 있다면 기억하나요?', contentEn: 'Do you remember what I got in trouble for the most as a child?', contentJa: '私が子供の頃一番叱られたことを覚えていますか？', category: 'MEMORY' },
  { content: '가족 중 가장 닮고 싶었던 사람은 누구였나요?', contentEn: 'Who in your family did you want to be like the most?', contentJa: '家族の中で一番似たいと思った人は誰でしたか？', category: 'MEMORY' },
  { content: '처음 집을 떠나 독립했을 때 느낌이 어땠나요?', contentEn: 'How did it feel when you first left home to live on your own?', contentJa: '初めて家を出て独立した時どんな気持ちでしたか？', category: 'MEMORY' },
  { content: '어린 시절 가족이 모두 함께했던 가장 행복한 순간은?', contentEn: 'What was the happiest moment when the whole family was together?', contentJa: '子供の頃家族みんなが一緒だった一番幸せな瞬間は？', category: 'MEMORY' },
  { content: '학교 다닐 때 제일 좋아했던 과목은 무엇인가요?', contentEn: 'What was your favorite subject in school?', contentJa: '学校に通っていた時一番好きだった科目は何ですか？', category: 'MEMORY' },
  { content: '가장 기억에 남는 여름방학은 어떻게 보냈나요?', contentEn: 'How did you spend your most memorable summer vacation?', contentJa: '一番印象に残っている夏休みはどう過ごしましたか？', category: 'MEMORY' },
  { content: '어린 시절 즐겨 먹던 간식이 있나요?', contentEn: 'Was there a snack you enjoyed as a child?', contentJa: '子供の頃よく食べていたおやつはありますか？', category: 'MEMORY' },
  { content: '나에게 가장 큰 영향을 준 사람이 있다면 누구인가요?', contentEn: 'Who has had the biggest influence on your life?', contentJa: '自分に一番大きな影響を与えた人は誰ですか？', category: 'MEMORY' },
  { content: '처음 친구에게 서운했던 기억이 있나요?', contentEn: 'Do you remember the first time a friend hurt your feelings?', contentJa: '初めて友達に対して寂しい思いをした記憶はありますか？', category: 'MEMORY' },
  { content: '가장 오래된 가족 사진 속 기억은 무엇인가요?', contentEn: 'What memory do you have of the oldest family photo?', contentJa: '一番古い家族写真の中の思い出は何ですか？', category: 'MEMORY' },
  { content: '어릴 때 가장 갖고 싶었던 것은 무엇이었나요?', contentEn: 'What did you want the most as a child?', contentJa: '子供の頃一番欲しかったものは何でしたか？', category: 'MEMORY' },
  { content: '부모님이 가장 자랑스러웠던 순간은 언제인가요?', contentEn: 'When were you most proud of your parents?', contentJa: '親が一番誇らしかった瞬間はいつですか？', category: 'MEMORY' },
  { content: '지금 자녀를 보면서 내 어린 시절이 떠오를 때가 있나요?', contentEn: 'Do your children sometimes remind you of your own childhood?', contentJa: '今子供を見ていて自分の子供時代を思い出すことはありますか？', category: 'MEMORY' },

  // VALUE - 가치관 (20개)
  { content: '나이가 들수록 더 중요해진 것이 있다면 무엇인가요?', contentEn: 'What has become more important to you as you get older?', contentJa: '年を重ねるほど大切になったことは何ですか？', category: 'VALUE' },
  { content: '젊은 세대에 대해 이해하기 어려운 점이 있나요?', contentEn: 'Is there anything about the younger generation that is hard to understand?', contentJa: '若い世代について理解しにくいことはありますか？', category: 'VALUE' },
  { content: '부모님 세대와 가장 다르다고 느끼는 가치관은 무엇인가요?', contentEn: 'What values feel most different from your parents\' generation?', contentJa: '親の世代と一番違うと感じる価値観は何ですか？', category: 'VALUE' },
  { content: '인생에서 가장 후회되는 결정이 있다면 무엇인가요?', contentEn: 'What decision in life do you regret the most?', contentJa: '人生で一番後悔している決断は何ですか？', category: 'VALUE' },
  { content: '내 자녀에게 꼭 전해주고 싶은 인생 교훈이 있다면?', contentEn: 'What life lesson would you want to pass on to your children?', contentJa: '子供にぜひ伝えたい人生の教訓は？', category: 'VALUE' },
  { content: '요즘 세상에서 가장 걱정되는 것은 무엇인가요?', contentEn: 'What worries you the most about the world today?', contentJa: '今の世の中で一番心配なことは何ですか？', category: 'VALUE' },
  { content: '살면서 가장 잘했다고 생각하는 선택은 무엇인가요?', contentEn: 'What is the best decision you have ever made?', contentJa: '生きてきて一番良かったと思う選択は何ですか？', category: 'VALUE' },
  { content: '자녀에게 솔직하게 말하지 못한 것이 있다면?', contentEn: 'Is there something you could never honestly tell your children?', contentJa: '子供に正直に言えなかったことはありますか？', category: 'VALUE' },
  { content: '부모님께 아직 전하지 못한 말이 있다면 무엇인가요?', contentEn: 'Is there something you have not yet told your parents?', contentJa: '親にまだ伝えられていない言葉はありますか？', category: 'VALUE' },
  { content: '어른이 된다는 것은 어떤 의미라고 생각하나요?', contentEn: 'What do you think it means to be an adult?', contentJa: '大人になるとはどういう意味だと思いますか？', category: 'VALUE' },
  { content: '요즘 젊은이들이 부러운 점이 있다면 무엇인가요?', contentEn: 'What do you envy about young people today?', contentJa: '最近の若者が羨ましいと思うことは何ですか？', category: 'VALUE' },
  { content: '내 부모님에게 닮고 싶은 점은 무엇인가요?', contentEn: 'What qualities of your parents do you want to emulate?', contentJa: '親の真似したいところは何ですか？', category: 'VALUE' },
  { content: '가족 간에 서로 달라도 괜찮다고 생각하는 것이 있나요?', contentEn: 'Is there something you think is okay for family members to disagree on?', contentJa: '家族の間で違っていても大丈夫だと思うことはありますか？', category: 'VALUE' },
  { content: '행복한 가정을 만들기 위해 가장 중요한 것은 무엇인가요?', contentEn: 'What is the most important thing for building a happy family?', contentJa: '幸せな家庭を作るために一番大切なことは何ですか？', category: 'VALUE' },
  { content: '지금 시대를 살아가는 젊은이들에게 해주고 싶은 말이 있나요?', contentEn: 'Do you have any advice for young people living in this era?', contentJa: '今の時代を生きる若者に伝えたいことはありますか？', category: 'VALUE' },
  { content: '부모님 세대가 정말 대단하다고 느낀 점이 있나요?', contentEn: 'Have you ever felt truly impressed by your parents\' generation?', contentJa: '親の世代が本当にすごいと感じたことはありますか？', category: 'VALUE' },
  { content: '내 삶에서 가장 의미 있는 일을 한 가지 꼽는다면?', contentEn: 'What is the single most meaningful thing in your life?', contentJa: '自分の人生で一番意味のあることを一つ挙げるなら？', category: 'VALUE' },
  { content: '자녀가 어른이 된 지금 느끼는 감정은 어떤가요?', contentEn: 'How do you feel now that your children are adults?', contentJa: '子供が大人になった今、感じる気持ちはどうですか？', category: 'VALUE' },
  { content: '내 아이가 나와 다르게 살아도 괜찮다고 느끼나요?', contentEn: 'Are you okay with your children living differently from you?', contentJa: '自分の子供が自分と違う生き方をしても大丈夫だと感じますか？', category: 'VALUE' },
  { content: '삶에서 돌아보았을 때 가장 소중한 시간은 언제였나요?', contentEn: 'Looking back, what was the most precious time in your life?', contentJa: '人生を振り返った時、一番大切な時間はいつでしたか？', category: 'VALUE' },

  // DREAM - 꿈/목표 (20개)
  { content: '지금이라도 해보고 싶은 일이 있다면 무엇인가요?', contentEn: 'Is there anything you want to try even now?', contentJa: '今からでもやってみたいことがあれば何ですか？', category: 'DREAM' },
  { content: '은퇴 후 어떤 삶을 꿈꾸나요?', contentEn: 'What kind of life do you dream of after retirement?', contentJa: '退職後どんな生活を夢見ていますか？', category: 'DREAM' },
  { content: '자녀와 함께 꼭 한번 해보고 싶은 일이 있나요?', contentEn: 'Is there something you really want to do with your children?', contentJa: '子供と一緒にぜひ一度やってみたいことはありますか？', category: 'DREAM' },
  { content: '아직 늦지 않았다고 생각하는 꿈이 있나요?', contentEn: 'Is there a dream you believe is still not too late for?', contentJa: 'まだ遅くないと思っている夢はありますか？', category: 'DREAM' },
  { content: '부모님과 함께 꼭 이루고 싶은 것이 있나요?', contentEn: 'Is there something you want to achieve with your parents?', contentJa: '親と一緒にぜひ叶えたいことはありますか？', category: 'DREAM' },
  { content: '10년 뒤 가족이 어떤 모습이면 좋겠나요?', contentEn: 'What do you hope your family looks like in 10 years?', contentJa: '10年後、家族がどんな姿だったらいいですか？', category: 'DREAM' },
  { content: '만약 다시 젊어진다면 가장 먼저 하고 싶은 일은?', contentEn: 'If you could be young again, what would you do first?', contentJa: 'もし若返ったら一番最初にしたいことは？', category: 'DREAM' },
  { content: '올해 가족과 함께 꼭 이루고 싶은 목표가 있나요?', contentEn: 'Is there a goal you want to achieve with your family this year?', contentJa: '今年家族と一緒にぜひ達成したい目標はありますか？', category: 'DREAM' },
  { content: '언젠가 꼭 살아보고 싶은 곳이 있나요?', contentEn: 'Is there a place you want to live someday?', contentJa: 'いつか住んでみたい場所はありますか？', category: 'DREAM' },
  { content: '지금 배우고 싶은 것이 있다면 무엇인가요?', contentEn: 'What would you like to learn right now?', contentJa: '今学びたいことがあれば何ですか？', category: 'DREAM' },
  { content: '가족에게 큰 선물을 해줄 수 있다면 무엇을 해주고 싶나요?', contentEn: 'If you could give your family a big gift, what would it be?', contentJa: '家族に大きなプレゼントをあげられるなら何をしたいですか？', category: 'DREAM' },
  { content: '노후를 어떻게 보내고 싶은지 생각해본 적 있나요?', contentEn: 'Have you thought about how you want to spend your later years?', contentJa: '老後をどう過ごしたいか考えたことはありますか？', category: 'DREAM' },
  { content: '젊었을 때 포기했지만 지금도 아쉬운 꿈이 있나요?', contentEn: 'Is there a dream you gave up when young but still regret?', contentJa: '若い頃諦めたけど今でも惜しい夢はありますか？', category: 'DREAM' },
  { content: '자녀에게 꼭 경험하게 해주고 싶은 것이 있나요?', contentEn: 'Is there something you want your children to experience?', contentJa: '子供にぜひ経験させたいことはありますか？', category: 'DREAM' },
  { content: '올해 가족과 가고 싶은 여행지가 있나요?', contentEn: 'Is there a place you want to travel with family this year?', contentJa: '今年家族と行きたい旅行先はありますか？', category: 'DREAM' },
  { content: '앞으로 어떤 추억을 더 만들어가고 싶나요?', contentEn: 'What kind of memories do you want to create in the future?', contentJa: 'これからどんな思い出をもっと作りたいですか？', category: 'DREAM' },
  { content: '사회에 기여하고 싶은 방식이 있다면 무엇인가요?', contentEn: 'How would you like to contribute to society?', contentJa: '社会に貢献したい方法があれば何ですか？', category: 'DREAM' },
  { content: '앞으로 부모님과 꼭 함께하고 싶은 것이 있나요?', contentEn: 'Is there something you want to do with your parents in the future?', contentJa: 'これから親と一緒にしたいことはありますか？', category: 'DREAM' },
  { content: '지금 열심히 준비하고 있는 것이 있다면 무엇인가요?', contentEn: 'What are you working hard to prepare for right now?', contentJa: '今一生懸命準備していることがあれば何ですか？', category: 'DREAM' },
  { content: '가장 설레는 미래 계획이 있다면 무엇인가요?', contentEn: 'What is your most exciting plan for the future?', contentJa: '一番ワクワクする将来の計画は何ですか？', category: 'DREAM' },

  // GRATITUDE - 감사 (15개)
  { content: '부모님께서 해주신 것 중 지금도 감사한 일이 있나요?', contentEn: 'Is there something your parents did that you are still grateful for?', contentJa: '親がしてくれたことで今でも感謝していることはありますか？', category: 'GRATITUDE' },
  { content: '자녀가 커가면서 가장 감사하게 느낀 순간은?', contentEn: 'What moment were you most grateful for as your children grew up?', contentJa: '子供が成長する中で一番感謝を感じた瞬間は？', category: 'GRATITUDE' },
  { content: '내 곁에 있어 줘서 감사한 가족이 있다면 누구인가요?', contentEn: 'Who in your family are you thankful for being by your side?', contentJa: 'そばにいてくれて感謝している家族は誰ですか？', category: 'GRATITUDE' },
  { content: '지금 이 순간 가족에게 고맙다고 느끼는 이유는?', contentEn: 'Why do you feel grateful to your family right now?', contentJa: '今この瞬間、家族にありがたいと感じる理由は？', category: 'GRATITUDE' },
  { content: '어려운 시기에 가족이 힘이 됐던 경험이 있나요?', contentEn: 'Was there a difficult time when your family gave you strength?', contentJa: '困難な時期に家族が力になってくれた経験はありますか？', category: 'GRATITUDE' },
  { content: '부모님이 나에게 가장 잘해준 것은 무엇이라고 생각하나요?', contentEn: 'What do you think is the best thing your parents did for you?', contentJa: '親が自分に一番よくしてくれたことは何だと思いますか？', category: 'GRATITUDE' },
  { content: '자녀에게 고마움을 느낀 가장 최근의 일은 무엇인가요?', contentEn: 'What is the most recent thing your children did that you were grateful for?', contentJa: '子供に感謝を感じた一番最近のことは何ですか？', category: 'GRATITUDE' },
  { content: '오늘 가족의 어떤 모습이 마음을 따뜻하게 했나요?', contentEn: 'What about your family warmed your heart today?', contentJa: '今日、家族のどんな姿が心を温かくしましたか？', category: 'GRATITUDE' },
  { content: '내 삶에서 가족이 있어 좋았던 순간을 하나 꼽는다면?', contentEn: 'Name one moment when you were glad to have family in your life', contentJa: '人生で家族がいてよかったと思った瞬間を一つ挙げるなら？', category: 'GRATITUDE' },
  { content: '나를 위해 묵묵히 애써준 가족에게 하고 싶은 말은?', contentEn: 'What would you say to family who quietly worked hard for you?', contentJa: '自分のために黙々と頑張ってくれた家族に伝えたい言葉は？', category: 'GRATITUDE' },
  { content: '사소하지만 가족에게 진심으로 감사한 것이 있나요?', contentEn: 'Is there something small but meaningful you are grateful to your family for?', contentJa: '些細なことだけど家族に心から感謝していることはありますか？', category: 'GRATITUDE' },
  { content: '가족이 나를 이해해줬을 때 가장 감사했던 순간은?', contentEn: 'When were you most grateful for your family understanding you?', contentJa: '家族が自分を理解してくれた時一番感謝した瞬間は？', category: 'GRATITUDE' },
  { content: '지금 가족에게 고마운 마음을 전한다면 어떤 말을 하겠나요?', contentEn: 'If you could express gratitude to your family now, what would you say?', contentJa: '今家族に感謝の気持ちを伝えるなら何と言いますか？', category: 'GRATITUDE' },
  { content: '힘들었을 때 말없이 옆에 있어준 가족이 있나요?', contentEn: 'Was there a family member who silently stayed by your side during tough times?', contentJa: '辛い時に何も言わずそばにいてくれた家族はいますか？', category: 'GRATITUDE' },
  { content: '가족 덕분에 내가 성장했다고 느낀 일이 있나요?', contentEn: 'Is there a time you felt you grew because of your family?', contentJa: '家族のおかげで自分が成長したと感じたことはありますか？', category: 'GRATITUDE' },
];

async function main() {
  console.log('🌱 Seeding database...');

  const existingCount = await prisma.question.count({ where: { isCustom: false } });

  if (existingCount >= questions.length) {
    // 기존 질문에 영어/일본어 번역 업데이트
    console.log('📝 Updating existing questions with translations...');
    let updated = 0;
    for (const q of questions) {
      const result = await prisma.question.updateMany({
        where: { content: q.content, isCustom: false },
        data: { contentEn: q.contentEn, contentJa: q.contentJa },
      });
      if (result.count > 0) updated += result.count;
    }
    console.log(`✅ Updated ${updated} questions with translations.`);
    return;
  }

  if (existingCount === 0) {
    // 첫 실행: 관련 데이터 초기화 후 전체 삽입
    await prisma.dailyQuestion.deleteMany();
    await prisma.answer.deleteMany();
    await prisma.question.deleteMany({ where: { isCustom: false } });

    for (const question of questions) {
      await prisma.question.create({
        data: {
          content: question.content,
          contentEn: question.contentEn,
          contentJa: question.contentJa,
          category: question.category as any,
          isActive: true,
        },
      });
    }
    console.log(`✅ Created ${questions.length} questions`);
  } else {
    // 추가 실행: 기존에 없는 질문만 삽입 + 기존 질문 번역 업데이트
    const existingContents = new Set(
      (await prisma.question.findMany({ where: { isCustom: false }, select: { content: true } }))
        .map(q => q.content)
    );
    const newQuestions = questions.filter(q => !existingContents.has(q.content));
    for (const question of newQuestions) {
      await prisma.question.create({
        data: {
          content: question.content,
          contentEn: question.contentEn,
          contentJa: question.contentJa,
          category: question.category as any,
          isActive: true,
        },
      });
    }
    // 기존 질문 번역 업데이트
    const existingQuestions = questions.filter(q => existingContents.has(q.content));
    for (const q of existingQuestions) {
      await prisma.question.updateMany({
        where: { content: q.content, isCustom: false },
        data: { contentEn: q.contentEn, contentJa: q.contentJa },
      });
    }
    console.log(`✅ Added ${newQuestions.length} new questions, updated ${existingQuestions.length} with translations (total: ${existingCount + newQuestions.length})`);
  }

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
