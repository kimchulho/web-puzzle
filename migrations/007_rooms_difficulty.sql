-- Add difficulty for room rules/rendering.
ALTER TABLE public.rooms
ADD COLUMN IF NOT EXISTS difficulty TEXT NULL;

UPDATE public.rooms
SET difficulty = 'medium'
WHERE difficulty IS NULL OR difficulty = '';

ALTER TABLE public.rooms
ALTER COLUMN difficulty SET DEFAULT 'medium';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rooms_difficulty_check'
  ) THEN
    ALTER TABLE public.rooms
    ADD CONSTRAINT rooms_difficulty_check
    CHECK (difficulty IN ('easy', 'medium', 'hard', 'nightmare'));
  END IF;
END $$;
