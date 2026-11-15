import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Expired Dialer</h1>
      {error === 'not-allowed' && (
        <p role="alert" className="text-sm text-red-700">
          That email is not allowed to use this app.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
