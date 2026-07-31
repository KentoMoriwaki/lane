# Activity Lab — Observations

lab フェーズの最終成果物。記入は人間(+ 観察を手伝うエージェント)。シナリオには
**期待値を書かない** — 「main での挙動」「#62 での挙動」を観察のまま記録し、
「望ましい挙動」列が埋まった状態 = 仕様確定 = 実装フェーズの入力。

## 仕様の問い(観察が終わったら答えを書く)

1. reader が古い promise を持っていると render 中に分かったとき、**どの render
   lane なら合流してよいか**(urgent / transition / offscreen prerender / reveal)
   - 答え:
2. remove と invalidate を同じ合流機構(+ ポリシー差)で扱うべきか
   - 答え:
3. remove 後に同キーが復活していたとき、古い promise の reader は「削除」と
   「新値あり」のどちらとして合流すべきか
   - 答え:
4. hidden 中の合流は許すべきか(hidden 中の loader 発火を含む)
   - 答え:

## シナリオ表

| # | シナリオ | main での挙動 | #62 での挙動 | 望ましい挙動(判断) | メモ |
| --- | --- | --- | --- | --- | --- |

## /matrix

2×2(Activity なし/あり × Hydration なし/あり)。象限 = P / A / H / AH、各象限は
独立 lane + 同一キー A/B + 象限別 ControllableLoader。操作は全象限ブロードキャスト。
シナリオはページ内ランナーで 1 クリック再生(各ステップは Timeline の
`matrix:scenario` に印が付く)。urgent / flushSync / transition の誘発は zone 内の
`a1` にだけ届き、`a2` / `a1-memo` は対照。FrameStrip の赤 = remove 時点で表示中
だった値がまだ描かれているフレーム。

| # | シナリオ | main での挙動 | #62 での挙動 | 望ましい挙動(判断) | メモ |
| --- | --- | --- | --- | --- | --- |
| m1 | hidden のまま mount(prerender で loader 発火?) | | | | |
| m2 | hide → invalidate → reveal | | | | |
| m3 | hide → remove → reveal(FrameStrip で削除値フレーム) | | | | |
| m4 | m3 を useLanesAll(`matrix:*:all`)視点で | | | | |
| m5 | hide → snapshot 再 publish → reveal(採用は reveal 前か後か) | | | | |
| m6 | refetchOnMount / whenStale 切替で reveal | | | | |
| m7 | hide 中 invalidate で loader が発火するか(購読の間接観測) | | | | |
| m8 | visible 同キー併読 ×2 → remove → 片方だけ urgent / flushSync | | | | |
| m9 | mid-transition(invalidate 収束中・manual loader)→ urgent | | | | |
| m10 | hidden のまま contextTick(remove 後)— hidden 中 loader 発火? | | | | |
| m11 | hidden のまま contextTick(snapshot 再 publish 後) | | | | |
| m12 | invalidate 直後の urgent / flushSync(remove との対照) | | | | |
| m13 | visible × hidden の同キー併読 → remove → reveal | | | | |
| m14 | hide → remove → set で同キー復活 → reveal | | | | |
| m15 | hide → remove → snapshot 再 publish で復活 → reveal | | | | |
| m16 | invalidate→remove / remove→invalidate の連続 | | | | |
| m17 | reveal 直後に再 hide(素早い往復) | | | | |
| m18 | 主要シナリオ(m2/m3/m8/m10/m11)を StrictMode on/off で | | | | |

## /router-sim

3 ルート(list / detail-1 / detail-2)を LabActivity で keep-alive する自作ミニルーター。
各ルートは自分の LaneHydration 境界を持ち、ナビゲーションで入るたびに新 snapshot
(s2, s3, …)を publish する(「publish new snapshot on nav」チェックで抑止可)。
キーは route 固有の own key(`[sim,route,<id>]`)と全ルート共有の shared key
(`[sim,shared]`)の 2 種。**shared key は全ルートの snapshot に含まれる**ので、
route A への復帰が visible な route B の reader の値も書き換える。
loader はデフォルト auto/200ms(パネルで manual + resolve next に切替可)。
プリセットは 500ms 間隔で実行され、各ステップは `sim:preset` チャネルの custom
イベントとして Timeline に刻まれる。

| # | シナリオ | main での挙動 | #62 での挙動 | 望ましい挙動(判断) | メモ |
| --- | --- | --- | --- | --- | --- |
| RS1 | プリセット conflict(own): detail-1 に入る → list へ離脱 → hidden 中に own key を remove → detail-1 へ復帰(復帰と同時に新 snapshot publish)。removal の drop と re-hydration の採用が同じ reveal に重なる | | | | FrameStrip の flag に削除前の値(例 `own:detail-1#s1`)を入れて残存フレームを見る |
| RS2 | プリセット conflict(shared): 同じ手順を shared key で。list 側の visible reader が同キーを併読したまま remove → 復帰 publish を受ける | | | | visible reader と hidden reader で合流経路が違うか |
| RS3 | プリセット keep-alive: lane 操作なし・snapshot publish なしでルート往復 ×2 | | | | 値が保持されるか(keep-alive の確認)。loader の calls が増えないか |
| RS4 | 通常 nav(publish on)での復帰: 新 snapshot の採用は reveal の前か後か。HYDRATING fallback や旧値のフレームは見えるか | | | | transition nav on/off(urgent nav)で比較 |
| RS5 | 離脱中に invalidate → 復帰: loader は hidden 中に発火するか、reveal で発火するか(購読状態の間接観測) | | | | loader を manual にすると reveal と resolve の順序を制御できる |
| RS6 | 離脱中に set → 復帰: set 値と復帰時の新 snapshot のどちらが最終的に見えるか | | | | |
| RS7 | route A への復帰 publish が shared key を書き換えたとき、visible な route B の reader の更新のされ方(タイミング・pending 表示) | | | | 初回マウント時も 3 ルートが順に shared を seed する(最後勝ち) |
| RS8 | remove 後、復帰せず hidden のまま contextTick で render を誘発: hidden reader は drop するか、hidden 中に loader が発火するか | | | | agitator の contextTick。tick は各ルートの TickConsumer に届く |
| RS9 | conflict 手順を shell variant = instrumented で(useLabVisibility の値がどう変わるかの確認込み) | | | | opaque との差は v1 では器のみ |

## /bfcache

本物の Next ナビゲーション(router bfcache = 直近 3 つの非アクティブルートツリーを
`<Activity mode="hidden">` で keep-alive)での P3 観察。

- ルート: `/bfcache`(index)/ `/bfcache/list` / `/bfcache/detail/[id]`(id=1..3)。
  RSC ページが `connection()` 越しにサーバーのインメモリ版数(`src/server/bfcache-data.ts`、
  取得毎に version++)を読み、`laneSnapshot` + `LaneHydration` で seed。
- キー: ルート固有 `["bf","list"]` / `["bf","detail",id]` + 全ルート共有 `["bf","shared"]`
  (どのルートの RSC render も shared を再 seed する)。
- 値の出自は文字列に刻まれる: `name vN (rsc)` = RSC seed、`name vN (loader)` = client loader
  (`/bfcache/api` 経由なので同じ版数列)、`name set#N (hud)` = HUD の set。
- HUD(layout、ルート subtree の外なので hidden にならない)からキーを選んで
  invalidate / remove / set。Timeline(channel prefix `bfcache`)と、ルート subtree 全体の
  textContent を録る FrameStrip(赤 = `(hud)` 値が DOM にあるフレーム)。
- probe の passive-cleanup が hide の証跡、hidden 中の render ログが offscreen render の証跡。

| # | シナリオ | main での挙動 | #62 での挙動 | 望ましい挙動(判断) | メモ |
| --- | --- | --- | --- | --- | --- |
| BF1 | cached route への復帰: Next は hidden ツリーを reveal するだけか、新 RSC payload(新 snapshot props → `LaneHydration` 再 seed)を流すか | | | | Timeline の `(rsc)` 版数バンプ / seed-fallback render の有無で読む |
| BF2 | 別ルートに居る間に HUD で remove(/ invalidate / set)→ `<Link>` で復帰: 復帰の見え方をフレーム単位で | | | | FrameStrip + probe の render / passive-mount 順。shared キーは復帰時の再 seed と衝突する系 |
| BF3 | BF1–BF2 を `LAB_PARTIAL_PREFETCH=0` で(`LAB_PARTIAL_PREFETCH=0 pnpm --filter @lane/activity-lab dev`) | | | | prefetch 内容の差が復帰時の payload に効くか |
| BF4 | 4 ルート(list + detail/1..3)を回って LRU 追い出しを起こしてから追い出されたルートへ復帰: keep-alive された場合との差 | | | | 追い出し = probe の layout-cleanup 後に一から remount するはず、の確認込み |
