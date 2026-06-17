-- 장식 "착용 모델 단일화" 백필 SQL (feat/deco-single-equip)
--
-- 목적: 기존 User 의 3컬럼(equipped_head_id / equipped_back_id / equipped_feet_id)
--       장착 데이터를 단일 컬럼 equipped_decoration_id 로 이전한다.
--
-- 우선순위: head > back > feet (COALESCE 순서). 다중 장착 유저는 head 우선 1개만
--          살아남고 나머지는 폐기된다. 풍선(deco_balloon_bunch)은 이번 범위에선
--          여전히 head slot 이므로 그대로 단일 id 로 보존된다.
--
-- 실행 시점: prisma db push #1(equipped_decoration_id 컬럼 추가, 구 3컬럼은 아직 보존)
--           직후 1회. 행수 검증 후 db push #2(구 3컬럼 drop) 진행.
--
-- ⚠️ prod 실행은 사용자 몫. 실행 전 dev 스테이지 리허설 권장.

UPDATE "User"
SET equipped_decoration_id = COALESCE(equipped_head_id, equipped_back_id, equipped_feet_id)
WHERE equipped_decoration_id IS NULL
  AND (equipped_head_id IS NOT NULL
    OR equipped_back_id IS NOT NULL
    OR equipped_feet_id IS NOT NULL);

-- 백필 검증: 이전 대상 건수 vs 단일 컬럼 채워진 건수 확인
-- SELECT count(*) AS backfilled FROM "User" WHERE equipped_decoration_id IS NOT NULL;
