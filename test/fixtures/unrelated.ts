// An App Store lookup that happens to use the same field names.
type App = { adamId: number; servingStatus: string };
export const totalResults = 3;
export function bucket(row: { granularity: string }) { return row.granularity; }
