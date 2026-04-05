-- 프로필 공개를 기본값으로 (신규 행 + 기존 비공개 행 일괄 공개).
-- 비공개를 원하면 대시보드에서 끄면 됩니다.

ALTER TABLE public.users
  ALTER COLUMN profile_public SET DEFAULT true;

UPDATE public.users
SET profile_public = true
WHERE profile_public = false;

COMMENT ON COLUMN public.users.profile_public IS
  'Default true: public profile at /u/:username. User may turn off in dashboard.';
