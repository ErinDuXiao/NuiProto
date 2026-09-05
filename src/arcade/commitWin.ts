import { store } from "../state/store";
import { resolveWin, type Crane, type CraneState } from "./craneMachine";
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

/**
 * 盤面を保存してよいか。
 *
 * **獲得したあとは保存しない。** 画面は獲得後もすぐには閉じず、
 * 棚へ帰るまでの余韻のあいだループが回り続ける。盤面は静止し、
 * クレーンは idle に戻り、賑やかしの景品はまだ残っている。
 * そこで保存すると commitWin が捨てた盤面が書き戻り、
 * 次に入ったとき attemptsOnBoard を引き継いでしまう。
 * 「2回目で取れた」はずの次の子が「5回目で取れた」ことになる。
 *
 * 画面の中の条件式にしておくとテストが届かないので、ここへ出してある。
 */
export function canSaveBoard(
  state: CraneState,
  resting: boolean,
  bodyCount: number,
  alreadyWon: boolean
): boolean {
  return state === "idle" && resting && bodyCount > 0 && !alreadyWon;
}
