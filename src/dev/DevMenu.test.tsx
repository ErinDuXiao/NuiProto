import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DangerButton } from "./DevMenu";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * 所持品の全消去は、このゲームで最も起きてはならない事故。
 * 公開ビルドにも Developer Menu が入っている以上、1回の誤タップで
 * 実行されないことをテストで固定する。
 */
describe("DangerButton", () => {
  it("1回押しただけでは実行しない", () => {
    const onConfirm = vi.fn();
    render(<DangerButton label="所持品リセット" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("2回押すと実行する", () => {
    const onConfirm = vi.fn();
    render(<DangerButton label="所持品リセット" onConfirm={onConfirm} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("押せば消えることが文言で分かる", () => {
    render(<DangerButton label="所持品リセット" onConfirm={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("所持品リセット");
    fireEvent.click(btn);
    expect(btn.textContent).toContain("もう一度押すと");
  });

  it("放置すると確認待ちが解除され、次の1回では実行しない", () => {
    const onConfirm = vi.fn();
    render(<DangerButton label="所持品リセット" onConfirm={onConfirm} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(btn.textContent).toBe("所持品リセット");
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("実行後は確認待ちに戻らない（続けて押しても再実行しない）", () => {
    const onConfirm = vi.fn();
    render(<DangerButton label="所持品リセット" onConfirm={onConfirm} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
