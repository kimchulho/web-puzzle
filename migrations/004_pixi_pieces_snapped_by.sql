-- Persist who first snapped each puzzle piece.
ALTER TABLE pixi_pieces
ADD COLUMN IF NOT EXISTS snapped_by TEXT;

COMMENT ON COLUMN pixi_pieces.snapped_by IS
  'Username (or guest id) of the player who first snapped/locked the piece.';
