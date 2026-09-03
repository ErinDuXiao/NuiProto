import { describe, it, expect } from "vitest";
import { ceremonyAt, ceremonyDuration } from "./ceremonyTimeline";

describe("ceremonyDuration", () => {
  it("初回はフル4.0秒", () => {
    expect(ceremonyDuration(true)).toBe(4000);
  });
  it("2回目以降は短縮2.4秒", () => {
    expect(ceremonyDuration(false)).toBe(2400);
  });
});

describe("ceremonyAt (初回)", () => {
  it("開始時は先輩がまだ向いていない", () => {
    expect(ceremonyAt(0, true).hostLook).toBe(0);
  });

  it("新入りは上から落ちてくる", () => {
    expect(ceremonyAt(0, true).guestDrop).toBeGreaterThan(0);
    expect(ceremonyAt(600, true).guestDrop).toBe(0);
  });

  it("落下中は伸び、着地の直後に潰れる（ころん）", () => {
    expect(ceremonyAt(300, true).guestSquash).toBeGreaterThan(1);
    expect(ceremonyAt(500, true).guestSquash).toBeLessThan(0.9);
  });

  it("潰れは落下が終わってから起きる（順序が逆転しない）", () => {
    let minAt = 0;
    let min = Infinity;
    for (let t = 0; t <= 4000; t += 10) {
      const s = ceremonyAt(t, true).guestSquash;
      if (s < min) {
        min = s;
        minAt = t;
      }
    }
    expect(min).toBeLessThan(0.85);
    expect(ceremonyAt(minAt, true).guestDrop).toBe(0);
  });

  it("0.6秒以降に先輩が新入りを向く", () => {
    expect(Math.abs(ceremonyAt(900, true).hostLook)).toBeGreaterThan(0.5);
  });

  it("1.0秒に「はじめまして！」が出る", () => {
    expect(ceremonyAt(1100, true).hostLine).toBe("はじめまして！");
  });

  it("1.8秒に新入りが跳ねて粒子が出る", () => {
    const p = ceremonyAt(1900, true);
    expect(p.guestHop).toBeGreaterThan(0);
    expect(p.sparkle).toBe(true);
  });

  it("新入りは2回跳ねる（仕様8章）", () => {
    // 単一時刻で正の値を見るだけでは1回跳ねただけでも通ってしまう。
    // hop の山の数を数えて2回であることを確かめる。
    const samples: number[] = [];
    for (let t = 0; t <= 4000; t += 10) samples.push(ceremonyAt(t, true).guestHop);
    let peaks = 0;
    for (let i = 1; i < samples.length - 1; i++) {
      if (samples[i] > 1 && samples[i] >= samples[i - 1] && samples[i] > samples[i + 1]) peaks++;
    }
    expect(peaks, `山の数=${peaks}`).toBe(2);
  });

  it("跳ねたあとは必ず着地する（浮いたまま終わらない）", () => {
    expect(ceremonyAt(4000, true).guestHop).toBe(0);
    expect(ceremonyAt(2400, false).guestHop).toBe(0);
  });

  it("セリフを差し替えられる（同じ子が続けて迎え役でも同じことを言わない）", () => {
    const p = ceremonyAt(1100, true, { host: "ようこそ。", guest: "わぁ。" });
    expect(p.hostLine).toBe("ようこそ。");
  });

  it("3.2秒に Welcome home. が出る", () => {
    expect(ceremonyAt(3300, true).caption).toBe("Welcome home.");
  });

  it("終了時は両者が静止し、キャプションが残る", () => {
    const p = ceremonyAt(4000, true);
    expect(p.guestHop).toBe(0);
    expect(p.guestDrop).toBe(0);
    expect(p.guestSquash).toBeCloseTo(1, 1);
    expect(p.caption).toBe("Welcome home.");
  });

  it("終了後の時刻を渡しても終了状態のまま安定する", () => {
    const a = ceremonyAt(4000, true);
    const b = ceremonyAt(99999, true);
    expect(b.guestHop).toBe(a.guestHop);
    expect(b.hostLook).toBe(a.hostLook);
  });

  it("GET などの強い文言を一切出さない", () => {
    for (let t = 0; t <= 4000; t += 25) {
      const p = ceremonyAt(t, true);
      const all = `${p.hostLine ?? ""}${p.guestLine ?? ""}${p.caption ?? ""}`;
      expect(/GET|ゲット|レア|RARE|！！|激レア|SUPER/i.test(all), `t=${t}: ${all}`).toBe(false);
    }
  });

  it("全時刻で数値が有限（NaNを描画しない）", () => {
    for (let t = -100; t <= 5000; t += 17) {
      const p = ceremonyAt(t, true);
      for (const v of [p.hostLook, p.guestHop, p.guestDrop, p.guestSquash, p.hostHop]) {
        expect(Number.isFinite(v), `t=${t}`).toBe(true);
      }
    }
  });
});

describe("ceremonyAt (短縮版)", () => {
  it("2.4秒までに「はじめまして！」が出る", () => {
    let seen = false;
    for (let t = 0; t <= 2400; t += 25) if (ceremonyAt(t, false).hostLine) seen = true;
    expect(seen).toBe(true);
  });

  it("短縮版でも先輩が向く", () => {
    expect(Math.abs(ceremonyAt(1200, false).hostLook)).toBeGreaterThan(0.5);
  });

  it("短縮版でも Welcome home. が出る", () => {
    expect(ceremonyAt(2400, false).caption).toBe("Welcome home.");
  });

  it("短縮版は初回より早く先輩が向く", () => {
    const shortT = firstTimeWhere((t) => Math.abs(ceremonyAt(t, false).hostLook) > 0.5);
    const fullT = firstTimeWhere((t) => Math.abs(ceremonyAt(t, true).hostLook) > 0.5);
    expect(shortT).toBeLessThanOrEqual(fullT);
  });
});

function firstTimeWhere(pred: (t: number) => boolean): number {
  for (let t = 0; t <= 4000; t += 10) if (pred(t)) return t;
  return Infinity;
}
