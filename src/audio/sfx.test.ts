import { describe, it, expect, afterEach } from "vitest";
import { sfx } from "./sfx";

afterEach(() => sfx.setMuted(false));

describe("sfx", () => {
  it("AudioContextが無い環境でも例外を投げない", () => {
    const orig = globalThis.AudioContext;
    // @ts-expect-error 意図的に消す
    delete globalThis.AudioContext;
    expect(() => {
      sfx.init();
      sfx.koron();
      sfx.success();
      sfx.place();
      sfx.descend();
      sfx.bump(0.5);
      sfx.move(true);
      sfx.move(false);
    }).not.toThrow();
    globalThis.AudioContext = orig;
  });

  it("init前に鳴らしても例外を投げない", () => {
    expect(() => sfx.koron()).not.toThrow();
  });

  it("ミュート状態を保持し、localStorage に残す", () => {
    sfx.setMuted(true);
    expect(sfx.isMuted()).toBe(true);
    expect(localStorage.getItem("plushcrane.muted")).toBe("1");
    sfx.setMuted(false);
    expect(sfx.isMuted()).toBe(false);
  });

  it("ミュート中に鳴らしても例外を投げない", () => {
    sfx.init();
    sfx.setMuted(true);
    expect(() => {
      sfx.success();
      sfx.koron();
      sfx.move(true);
    }).not.toThrow();
  });

  it("bump に異常な強さを渡しても例外を投げない", () => {
    sfx.init();
    expect(() => {
      sfx.bump(Number.NaN);
      sfx.bump(-5);
      sfx.bump(1e9);
    }).not.toThrow();
  });

  it("localStorage が使えなくてもミュート切替が動く", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("denied");
    };
    expect(() => sfx.setMuted(true)).not.toThrow();
    expect(sfx.isMuted()).toBe(true);
    Storage.prototype.setItem = orig;
  });
});
