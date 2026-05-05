export async function selectAllPages(buildQuery, { pageSize = 1000 } = {}) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) {
      return { data: null, error };
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
  }
  return { data: rows, error: null };
}
