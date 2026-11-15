import { ImportClient } from './import-client';

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">Import expired listings</h1>
      <ImportClient />
    </div>
  );
}
