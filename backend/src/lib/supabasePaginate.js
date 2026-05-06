export async function selectAllPages(buildQuery, { pageSize = 1000 } = {}) {
  const effectivePageSize = Math.max(1, Math.min(pageSize, 1000));
  const rows = [];
  for (let from = 0; ; from += effectivePageSize) {
    const { data, error } = await buildQuery().range(from, from + effectivePageSize - 1);
    if (error) {
      return { data: null, error };
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < effectivePageSize) {
      break;
    }
  }
  return { data: rows, error: null };
}
