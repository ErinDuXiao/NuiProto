import { PLUSHIES } from "./data/plushies";
import { PlushSVG } from "./render/PlushSVG";
import { NEUTRAL_POSE } from "./render/pose";

/** Task 4 で棚画面に置き換える。今は全種の見た目を確認するためのギャラリー。 */
export function App() {
  return (
    <div className="app" style={{ padding: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
          gap: 8,
        }}
      >
        {PLUSHIES.map((p, i) => (
          <div key={p.id} style={{ textAlign: "center" }}>
            <svg viewBox="-55 -95 110 105" width="100%" style={{ display: "block" }}>
              <PlushSVG def={p} pose={NEUTRAL_POSE} seed={(i * 0.137) % 1} />
            </svg>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{p.name}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, fontSize: 12, opacity: 0.6 }}>個体差（同じ子・別のseed）</div>
      <svg viewBox="-180 -95 360 105" width="100%">
        {[0.05, 0.28, 0.51, 0.74, 0.97].map((s, i) => (
          <g key={s} transform={`translate(${-140 + i * 70} 0)`}>
            <PlushSVG def={PLUSHIES[1]} pose={NEUTRAL_POSE} seed={s} />
          </g>
        ))}
      </svg>
    </div>
  );
}
