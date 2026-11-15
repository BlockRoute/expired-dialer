/** Reject privileged keys before they can be embedded in a browser bundle. */
export function validatePublicKey(key: string): string {
  if (key.startsWith('sb_publishable_')) return key;
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role === 'anon') return key;
  } catch {
    // Invalid JWTs and secret keys are not public credentials.
  }
  throw new Error('Supabase public key must be a publishable or anon key, never a service-role or secret key.');
}

export function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const legacy = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Next.js can inline both variables, even when the fallback is not selected.
  if (publishable) validatePublicKey(publishable);
  if (legacy) validatePublicKey(legacy);
  const key = publishable || legacy;
  if (!url || !key) throw new Error('Supabase URL and public key are required. See .env.example.');
  return { url, key: validatePublicKey(key) };
}
