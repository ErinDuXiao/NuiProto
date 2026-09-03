/**
 * 効果音。WebAudio でその場生成し、音声ファイルは一切持たない（仕様 13 章）。
 *
 * いちばん作り込むのは「ころん」。ぬいぐるみが落ちて転がる音が
 * 気持ちよければ、失敗しても嫌にならない。
 *
 * AudioContext は最初のユーザー操作まで作れない（自動再生ポリシー）。
 * 存在しない環境では全 API を無害な no-op にする。
 */

const MUTE_KEY = "plushcrane.muted";

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let muted = readMuted();
let moveNodes: { osc: OscillatorNode; gain: GainNode } | null = null;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function AudioCtor(): typeof AudioContext | null {
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** 最初のユーザー操作から呼ぶこと。二度目以降は何もしない。 */
function init(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  const Ctor = AudioCtor();
  if (!Ctor) return;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
}

/** 音を鳴らせる状態か。鳴らせなければ null。 */
function ready(): { c: Ctx; out: GainNode; t: number } | null {
  if (muted || !ctx || !master) return null;
  return { c: ctx, out: master, t: ctx.currentTime };
}

function envelope(
  c: Ctx,
  out: GainNode,
  t: number,
  peak: number,
  attack: number,
  decay: number
): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function tone(
  c: Ctx,
  out: GainNode,
  t: number,
  freq: number,
  type: OscillatorType,
  peak: number,
  attack: number,
  decay: number
): void {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.connect(envelope(c, out, t, peak, attack, decay));
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

function noiseBuffer(c: Ctx, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export const sfx = {
  init,

  isMuted(): boolean {
    return muted;
  },

  setMuted(m: boolean): void {
    muted = m;
    if (master && ctx) {
      master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02);
    }
    if (m) sfx.move(false);
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      // 保存できなくてもその場のミュートは効く
    }
  },

  /** クレーンの横移動。長押し中だけ鳴らすループ音。 */
  move(on: boolean): void {
    if (on) {
      const r = ready();
      if (!r || moveNodes) return;
      const { c, out, t } = r;
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 82;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.06);
      osc.connect(lp);
      lp.connect(gain);
      gain.connect(out);
      osc.start(t);
      moveNodes = { osc, gain };
      return;
    }

    if (!moveNodes) return;
    const nodes = moveNodes;
    moveNodes = null;
    try {
      const t = ctx?.currentTime ?? 0;
      nodes.gain.gain.cancelScheduledValues(t);
      nodes.gain.gain.setValueAtTime(Math.max(0.0001, nodes.gain.gain.value), t);
      nodes.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      nodes.osc.stop(t + 0.12);
    } catch {
      // 既に停止している
    }
  },

  /** アーム下降。降りていくサイン波。 */
  descend(): void {
    const r = ready();
    if (!r) return;
    const { c, out, t } = r;
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.5);
    osc.connect(envelope(c, out, t, 0.09, 0.02, 0.5));
    osc.start(t);
    osc.stop(t + 0.6);
  },

  /** 接触。強さ 0-1 で音量が変わる短いノイズ。 */
  bump(strength: number): void {
    const r = ready();
    if (!r) return;
    const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0.4;
    const { c, out, t } = r;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 0.06);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 1.2;
    src.connect(bp);
    bp.connect(envelope(c, out, t, 0.02 + s * 0.05, 0.004, 0.07));
    src.start(t);
  },

  /**
   * ころん。このゲームでいちばん大事な音。
   *
   * 木質の帯域を通した 2 連のやわらかいアタック。
   * ピッチをわずかに揺らして、繰り返しても機械的にならないようにする。
   */
  koron(): void {
    const r = ready();
    if (!r) return;
    const { c, out, t } = r;
    const base = 300 + Math.random() * 80;

    for (const [i, delay] of [0, 0.075].entries()) {
      const at = t + delay;
      const freq = base * (i === 0 ? 1 : 0.82);
      const peak = i === 0 ? 0.16 : 0.1;

      // 木の胴鳴り
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, at);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.72, at + 0.12);
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 300 + i * 220;
      bp.Q.value = 2.4;
      osc.connect(bp);
      bp.connect(envelope(c, out, at, peak, 0.008, 0.12));
      osc.start(at);
      osc.stop(at + 0.2);

      // 布のあたり
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c, 0.05);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 800;
      src.connect(lp);
      lp.connect(envelope(c, out, at, peak * 0.35, 0.004, 0.05));
      src.start(at);
    }
  },

  /** 獲得。やわらかい3音のアルペジオ。派手にしない。 */
  success(): void {
    const r = ready();
    if (!r) return;
    const { c, out, t } = r;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      tone(c, out, t + i * 0.09, f, "sine", 0.12, 0.015, 0.34);
    });
  },

  /** 棚に置く。布のような低いサム音。 */
  place(): void {
    const r = ready();
    if (!r) return;
    const { c, out, t } = r;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 0.08);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    src.connect(lp);
    lp.connect(envelope(c, out, t, 0.08, 0.006, 0.1));
    src.start(t);
    tone(c, out, t, 150, "sine", 0.06, 0.006, 0.12);
  },
};
