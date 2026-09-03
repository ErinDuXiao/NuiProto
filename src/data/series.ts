export type SeriesDef = {
  id: string;
  name: string;
};

export const SERIES: SeriesDef[] = [
  { id: "forest_friends", name: "もりのおともだち" },
  { id: "ocean_friends", name: "うみのおともだち" },
];

const BY_ID = new Map(SERIES.map((s) => [s.id, s]));

export function seriesName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}
