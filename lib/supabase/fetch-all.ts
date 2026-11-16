const PAGE = 1000; // PostgREST's default max-rows

/**
 * Reads every row of a query that may exceed PostgREST's 1,000-row cap.
 * `page(from, to)` must apply `.range(from, to)` to a query with a stable, unique
 * `.order(...)`, or rows can repeat or go missing between pages.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
