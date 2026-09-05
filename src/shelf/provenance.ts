import { getPlush } from "../data/plushies";
import type { PlushInstance } from "../state/types";

/**
 * 来歴を文章にする。
 *
 * `acquiredAt` / `attemptsToAcquire` / `witnessedBy` は null が「分からない」を意味する。
 * 分からないものは行を出さないだけで、0回やナシとして書いてはいけない
 * （Global Constraint「分からない来歴を捏造しない」）。
 *
 * "unknown" / "granted" は v1 移行分・Developer Menu 追加分で、
 * クレーンで取ったのかどうかも分からない。日付や回数を持っていても、
 * それを見せると「分かっている」と誤解させるので、専用の1行だけにする。
 */
export function provenanceLines(
  inst: PlushInstance,
  all: PlushInstance[],
  now: number
): string[] {
  if (inst.origin === "starter") return ["はじめからここにいた"];
  if (inst.origin === "unknown" || inst.origin === "granted") {
    return ["いつからか、ここにいる"];
  }

  // ここから "crane"。分かる行だけを、日付・回数・見守り役の順に積む。
  const lines: string[] = [];

  // 日時が不明（保存データが壊れていた等）なら、日付を言わずに
  // 来歴不明と同じぼかした言い方に落とす。以前はここで現在時刻が
  // 埋められていたため「きょう、やってきた」と断定していた。
  //
  // ただし行ごと消したり "crane" を捨てたりはしない。日付が分からない
  // ことと、クレーンで取ったこと・何回かかったこと・誰が見ていたかを
  // 知っていることは別。分からない1つを隠すために、
  // 分かっている残りまで捨ててはいけない。
  const at = inst.acquiredAt;
  lines.push(
    at === null
      ? "いつからか、ここにいる"
      : sameDay(at, now)
        ? "きょう、やってきた"
        : `${dateLabel(at)}にやってきた`
  );

  if (inst.attemptsToAcquire !== null) {
    lines.push(inst.attemptsToAcquire <= 1 ? "すぐにおうちに来た" : `${inst.attemptsToAcquire}回目でおうちに来た`);
  }

  if (inst.witnessedBy !== null) {
    const witness = all.find((o) => o.instanceId === inst.witnessedBy);
    // 見守り役が既に手元にいない（お別れ済みなど）場合は、
    // いない子の名前を出さない。
    if (witness) {
      lines.push(`${getPlush(witness.plushTypeId).name}が一緒に見ていた`);
    }
  }

  return lines;
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function dateLabel(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
