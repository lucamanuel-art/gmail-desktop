export interface Orderable { index: number; order?: number }

export function sortByOrder<T extends Orderable>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order ?? a.index) - (b.order ?? b.index));
}
