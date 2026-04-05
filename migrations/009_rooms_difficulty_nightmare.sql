-- Expand rooms difficulty constraint to include nightmare mode.
ALTER TABLE public.rooms
DROP CONSTRAINT IF EXISTS rooms_difficulty_check;

ALTER TABLE public.rooms
ADD CONSTRAINT rooms_difficulty_check
CHECK (difficulty IN ('easy', 'medium', 'hard', 'nightmare'));
