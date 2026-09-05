import { useEffect } from "react";
import { getPlush } from "../data/plushies";
import { seriesName } from "../data/series";
import { PlushSVG } from "../render/PlushSVG";
import { NEUTRAL_POSE } from "../render/pose";
import { store, useGame } from "../state/store";
import { provenanceLines } from "./provenance";

type Props = {
  instanceId: string;
  onClose: () => void;
};

/**
 * タップした1匹の来歴を見せる小さなカード（仕様4.5）。
 *
 * 「ステータス画面」に見せないため、数値・レアリティ・能力値は一切出さない。
 * 目的は獲得体験そのものを思い出として保存すること。図鑑・コレクション
 * 一覧の入口には絶対にしない。
 */
export function PlushProfile({ instanceId, onClose }: Props) {
  const game = useGame();
  const inst = game.instances.find((o) => o.instanceId === instanceId);

  useEffect(() => {
    if (!inst) return;
    store.log("plush_profile_opened", {
      meta: { plushTypeId: inst.plushTypeId, origin: inst.origin },
    });
    // instanceId が変わったとき（＝新しいカードを開いたとき）だけ記録する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  // 開いている間に本人が棚から消える（レアケース）ことがある。
  // その場合は何も語らず静かに閉じる。
  if (!inst) return null;

  const def = getPlush(inst.plushTypeId);
  const lines = provenanceLines(inst, game.instances, Date.now());

  return (
    <div className="profile-sheet" onPointerDown={onClose} role="dialog" aria-label={`${def.name}のプロフィール`}>
      <div className="profile-card" onPointerDown={(e) => e.stopPropagation()}>
        <svg className="profile-art" viewBox="-48 -92 96 96" width="72" height="72">
          <PlushSVG def={def} pose={NEUTRAL_POSE} seed={inst.personalitySeed} />
        </svg>
        <p className="profile-name">{def.name}</p>
        <div className="profile-lines">
          {lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
        <p className="profile-series">{seriesName(def.series)}</p>
      </div>
    </div>
  );
}
