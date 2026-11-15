'use client';
import { createBrowserClient } from '@supabase/ssr';
import { publicSupabaseConfig } from './config';

export function createSupabaseBrowserClient() {
  const { url, key } = publicSupabaseConfig();
  return createBrowserClient(
    url,
    key,
  );
}
