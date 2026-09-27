// Connexion au projet Supabase du club (Project Settings → API).
// La clé "publishable" est publique par conception : la sécurité repose sur les règles RLS de supabase/schema.sql.
export const SUPABASE_URL = 'https://xzzttulqlydcespgkpnx.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_VwLyp5ROGzidc4oHWehoLg_kIehYAcE';
// Clé publique des notifications (Web Push). La clé privée correspondante est une variable d'environnement Vercel.
export const VAPID_PUBLIC = 'BHA2nAZhD5cIT_AR11aLFpXaH9RZyg32nn5W088Es3meXzr0aBAfM6gCCW1lgR7ZTOoKIofXqjZml7s8Prmyh80';
