-- Add orientation state for nightmare difficulty.
ALTER TABLE public.pieces
ADD COLUMN IF NOT EXISTS rotation_quarter SMALLINT NULL DEFAULT 0;

ALTER TABLE public.pieces
ADD COLUMN IF NOT EXISTS is_back_face BOOLEAN NULL DEFAULT false;

UPDATE public.pieces
SET rotation_quarter = 0
WHERE rotation_quarter IS NULL;

UPDATE public.pieces
SET is_back_face = false
WHERE is_back_face IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pieces_rotation_quarter_check'
  ) THEN
    ALTER TABLE public.pieces
    ADD CONSTRAINT pieces_rotation_quarter_check
    CHECK (rotation_quarter IN (0, 1, 2, 3));
  END IF;
END $$;
