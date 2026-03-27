import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  const { error } = await supabase.from('pixi_pieces').upsert([{ room_id: 1, piece_index: 0, x: 0, y: 0, is_locked: false }], { onConflict: 'room_id, piece_index' });
  console.log('Error:', error);
}
test();
