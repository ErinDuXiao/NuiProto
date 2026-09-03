import { PLUSHIES } from "./data/plushies";

/** Task 2 で PlushSVG に、Task 4 で棚画面に置き換える暫定表示。 */
export function App() {
  return (
    <div className="app">
      <ul>
        {PLUSHIES.map((p) => (
          <li key={p.id}>
            {p.name} / {p.series} / {p.rarity}
          </li>
        ))}
      </ul>
    </div>
  );
}
