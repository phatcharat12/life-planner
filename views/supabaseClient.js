import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const supabaseUrl = 'https://abkyeuwtuyssxtgepnna.supabase.co';
const supabaseAnonKey = 'sb_publishable_nt3hNJLE654YVYFC_z3wXA_2fNfEWvZ';


export const supabase = createClient(supabaseUrl, supabaseAnonKey)