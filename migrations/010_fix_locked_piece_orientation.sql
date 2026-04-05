-- Ensure already-locked pieces are always stored as front-facing, 0-degree.
UPDATE public.pieces
SET
  rotation_quarter = 0,
  is_back_face = false
WHERE is_locked = true
  AND (
    rotation_quarter IS DISTINCT FROM 0
    OR is_back_face IS DISTINCT FROM false
  );
