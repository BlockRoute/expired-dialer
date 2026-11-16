import { cache } from 'react';
import { notFound } from 'next/navigation';
import { Manrope } from 'next/font/google';
import { createClient } from '@supabase/supabase-js';
import { publicSupabaseConfig } from '@/lib/supabase/config';
import { notFoundMetadata, sellerMetadata, type PublishedCma } from '@/lib/cma/seller';
import { SellerPage } from './seller-page';

export const dynamic = 'force-dynamic';

// Scoped to this page: the font class is passed down, not set on the root layout.
const manrope = Manrope({ subsets: ['latin'], display: 'swap' });

// Unguessable slugs are lowercase letters, digits and hyphens; reject anything else before the database.
const SLUG = /^[a-z0-9][a-z0-9-]{0,200}$/;

/** Reads only through the get_published_cma RPC with the public anon key, never the service role. */
const load = cache(async (slug: string): Promise<PublishedCma | null> => {
  if (!SLUG.test(slug)) return null;
  const { url, key } = publicSupabaseConfig();
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc('get_published_cma', { p_slug: slug });
  if (error) throw new Error('Could not load this page.');
  const row = (data as PublishedCma[] | null)?.[0];
  return row ?? null;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const cma = await load((await params).slug);
  return cma ? sellerMetadata(cma.address) : notFoundMetadata();
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const cma = await load((await params).slug);
  if (!cma) notFound();
  return <SellerPage cma={cma} fontClassName={manrope.className} />;
}
