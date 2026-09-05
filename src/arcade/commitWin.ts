import { store } from "../state/store";
import { resolveWin, type Crane } from "./craneMachine";
import type { FallenPrize } from "./physics";

/**
 * 獲得の後始末をまとめて行う。
 *
 * **順序が意味を持つ。** 盤面を捨てる前に来歴を保存すること。
 * 逆にすると attemptsOnBoard がリセットされてから読むことになりかねない。
 * 画面側にこの順序を任せず、ここに閉じ込める。
 *
 * craneMachine.ts ではなくこのファイルに置くのは、
 * craneMachine を store から独立させたままにするため。
 * 難易度と状態機械はストレージを知らずにテストできる必要がある。
 *
 * @returns 追加された個体の instanceId
 */
export function commitWin(
  crane: Crane,
  won: FallenPrize,
  watcherInstanceId: string | null
): string {
  const id = store.winPlush(resolveWin(crane, won, watcherInstanceId));
  store.saveBoard(null);
  store.log("shelf_return_after_win", { plushId: won.defId });
  return id;
}
