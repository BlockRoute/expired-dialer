import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CmaRow } from '@/lib/db/types';
import { CmaEditor } from './editor';

export default async function CmaEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('cmas').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  const cma = data as CmaRow | null;
  if (!cma) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/dialer" className="text-sm underline">Back to the dialer</Link>
      <h1 className="text-xl font-semibold">{cma.address}</h1>
      <CmaEditor cma={cma} />
    </div>
  );
}
