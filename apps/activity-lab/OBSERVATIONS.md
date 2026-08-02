# Activity Lab — Observations

## 到達点(オーナー総括・2026-07-31)

- **loader 付きの routing(Server Components 等)を使う場合**: hydration /
  server-owned な lane(seeded read、republish が唯一の供給源)
- **そうでない場合**: lane の loader(client-owned、pattern B の機構が守る)
- 両者は同じ書き心地(useLane / Suspense / transition の同一意味論)で、
  パターン間の差は最小に保つ
- 残る仕事: **両パターンが Activity を含めて正しく動くことの検証、限界が
  あるならその明示、そしてガイドと実装を作り上げること**

lab フェーズの最終成果物。記入は人間(+ 観察を手伝うエージェント)。シナリオには
**期待値を書かない** — 「main での挙動」「#62 での挙動」を観察のまま記録し、
「望ましい挙動」列が埋まった状態 = 仕様確定 = 実装フェーズの入力。

## 仕様の問い(観察が終わったら答えを書く)

1. reader が古い promise を持っていると render 中に分かったとき、**どの render
   lane なら合流してよいか**(urgent / transition / offscreen prerender / reveal)
   - 答え(確定・2026-08-01): **render lane では判定しない — そもそも render 中の
     無条件照合を行わない。** 合流は次の 4 経路に固定する:
     - **(a) visible への通知**(passive 購読経由): remove は同期適用(即
       fallback)、invalidate は transition 適用(SWR)。従来どおり
     - **(b) reveal =(再)mount 時の useLayoutEffect 照合**: store と held
       promise を比較し、違えば同期 setPromise → その render で re-read →
       suspend → fallback。reveal パスと同一タスク内で完結するため stale は
       構造的に paint 不可能(/reveal-sync で実測)。トークン供給を前提と
       せず、layout effect は本物の reveal と mount でしか再出現しないので
       visible への over-fire も構造的に不在
     - **(c) 初回 mount(コミット前)**: 合流機構は不要。コミット前の render
       試行は毎回 initializer が走り直して store の現在の promise を読む
       (実測済み — stale commit の経路が存在しない)
     - **(d) 最後の render 試行 → passive 購読のマイクロ窓**:
       `syncAfterSubscribe`(現行のまま、通知ソースに合わせた transition 適用)
   - 帰結 1: **#62 の removedPromises(render 中の無条件照合)は廃止**。
     守備範囲は (a)+(b) で完全に覆われ、render 照合固有のリスク(hidden
     render での read 開始 = Q4 違反、invalidate 一般化時の visible urgent
     での fallback 誤爆)ごと消える。#62 で残すのは handoff(republish の
     render 中採用)のみ — pattern A の受け口 + (b) の修正 2 パス目を省く
     fast-path として
   - 帰結 2: トークン(pathname / republish)は (b) の最適化に降格。
     供給がある場合に reveal render 1 パスで drop できる、が正確な位置づけ
   - 留保: 最終確定は packages/lane への実装後、activity.test.ts の書き換えと
     tearing.test.ts 無傷、実機 /bfcache での再計測をもって行う
2. remove と invalidate を同じ合流機構(+ ポリシー差)で扱うべきか
   - 答え: **扱うべき(オーナー判断・2026-07-31)。規範は「visible になる時に
     invalidate/remove 済みの promise の中身を表示しない」。** 実装として不可能だと
     示されるまで、現行の「invalidate は reveal で古い値を描き、コミット後に収束する」
     挙動を仕様として受け付けない。`activity.test.ts` の当該 characterization
     (invalidate の reveal が古い値を見せて background で収束する、を固定している
     テスト)は仕様ではなく、この規範が実装され次第書き換える。
   - 未決の境界: 常時 visible な購読 reader への invalidate(SWR: 値を見せたまま
     background 収束)にもこの規範を適用するか。適用すると tearing.test.ts が守る
     transition 保証と正面衝突するため、範囲の確定が必要
   - **境界の解消(2026-08-01)— invalidate/remove と stale の役割定義**:
     - **invalidate / remove = 明示的な否認(correctness の宣言)**。誰かが
       「この内容は間違っている / もう存在しない」と宣言した。以後これを出す
       ことは既知の誤りの表示。**stale = 経年による疑い(freshness の
       ポリシー)**。staleTime を過ぎただけで、依然として手元の最良の真実。
       表示は正しく、更新は鮮度の最適化にすぎない。
     - 規範は「**出現**」で書く: 否認された値が画面にあってよいのは、**まだ
       完了していない置き換え transition の一部として**(連続した出現の継続)
       だけ。**新しい出現**(mount / reveal)としては一切許されない。
       - remove: 連続出現も許さない(通知で即 fallback、urgent)。
         新規出現も layout 照合で drop → fallback
       - invalidate: 置き換え transition 完了までは見せてよい(SWR)。
         完了後は promise 死。新規出現は layout 照合で drop → fallback
       - stale: staleness はイベントではなくトリガー時点で評価される述語。
         連続出現には何も起きず、新規出現は**見せてよい**(即表示 + 背景
         transition で収束、fallback なし)
     - これで「常時 visible への適用」の未決は消える: visible の SWR は
       進行中の置き換えの**継続出現**であって規範違反ではない。規範が禁じるのは
       否認済み promise の**新規出現**のみ。tearing.test.ts の transition 保証と
       無矛盾。
     - 機構への写像: 否認は**台帳**(invalidate/remove 時点の promise 記録)との
       同一性照合 = layout 照合の対象。stale は台帳不要の**タイムスタンプ述語**
       (`settlement.at`)で、トリガー(remount / focus / reconnect)時点に評価
       して背景 transition — 緊急性の差が実装の置き場所の差にそのまま出る。
     - 現行 main との整合: `refetchOnMount` 等のトリガーは `"always"` 廃止済みで
       `boolean` + `staleTime` に純化(トリガー = stale 述語の評価。無条件
       リフレッシュは `lane.invalidate(key, { onlyIf: "settled" })` に残る)。
       この意味論は上の役割分担そのもの。
     - 将来「stale を新規出現でも見せない」(hard TTL)を足す場合は、第三の
       規則ではなく「**トリガー時点で閾値超過なら invalidate に昇格**」として
       定義する — 『見せない』は常に invalidation の意味論、という一貫性を守る。
3. remove 後に同キーが復活していたとき、古い promise の reader は「削除」と
   「新値あり」のどちらとして合流すべきか
   - 答え(確定・2026-08-01): **どちらでもなく、「store の現在」に合流する。**
     reader は自分の promise が「削除されたのか」「復活があったのか」という
     履歴を知る必要がない。layout 照合は `readOrCreate` の返す promise と
     held promise の**同一性**だけを見て、不一致なら返ってきたものを採用する:
     - 復活済みで **settled**(`set` / 完了した他 reader の read / republish)
       → 同期採用、fallback なし、reveal 即新値
     - 復活済みで **pending**(他 reader の in-flight read)→ 採用して
       suspend → fallback → settle で新値。read は共有され重複 fetch なし
       (coalescing 維持)
     - **不在**(復活なし)→ その場で read 開始 → suspend → fallback → 新値
     「削除として合流(fallback 経由)」か「新値ありとして合流(直接採用)」
     かは reader の判断ではなく、**store の状態(settled / pending / 不在)の
     帰結**として自動的に決まる。
   - 機構の裏取り(core.ts): 否認の「台帳」は別リストではなく **entry の
     ライフサイクルそのもの** — invalidate は cache を clear(`lastFulfilled`
     は温存)、remove は entry を削除。どちらも次の `readOrCreate` が新しい
     promise を返すため同一性照合が成立する。逆に merely stale はデフォルト
     (`whenStale: "revalidate"`)の `reuseCache` が**同一 cache を返す**ので
     照合が素通りし、問い 2 の境界(stale は sync 経路に乗らない、背景
     transition で収束)が既存の意味論から自動的に守られる。
     `whenStale: "refetch"` は「stale の新規出現を見せない」(問い 2 補強で
     言う invalidate 昇格)の既存実装 — genuine idle remount のみ discard し、
     adopted / subscriber ガードが pre-commit ループと shared promise の
     yank を防ぐ。reveal の layout 照合は passive 購読の再接続**前**に走るので
     (subscribers.size = 0)、remount と同じ扱いになるのも整合的。
   - 実装ノート: gate 付き invalidate(server action 連動)が hidden reader に
     届かなかった場合、reveal の readOrCreate は gate なしで即読みする。
     action が reveal 時点でまだ in-flight のケースをどう扱うか(gate を
     notification payload ではなく entry に持たせるか)は実装時に決める。
   - **検討して不採用(2026-08-01)— 「混在窓への合流」案**: pending が既に
     in-flight で、held 値が置き換えの baseline(`lastFulfilled`)と同一
     (ちょうど 1 世代前)のときだけ transition 合流して旧値を保つ、という
     精密化を検討したが不採用。理由: (1) **世代距離は原理にならない** —
     一つの transition の中で複数世代が正当に更新され得るので「1 世代前なら
     安全」という境界は成立しない。(2) 導入概念(窓・baseline・メンバー
     シップ)3 つに対し、救われるのは「兄弟の refetch の真っ最中に reveal し、
     かつ baseline をちょうど保持」という稀で過渡的なケースだけで、fallback の
     持続も fetch 残り時間で有界。(3) 採用した不変条件の方が強く単純:
     **reader が commit してよい promise は store の現在のものだけ。**
     visible SWR はこれを破らない(画面の古い値は「古い committed tree の
     残存」であって古い promise の新規 commit ではなく、transition の commit
     時点で世代は揃う)。初回 mount は initializer の再実行が守る。破れる
     唯一の場所が Activity reveal(過去の committed tree の再表示)で、
     そこだけを layout 照合が正す — settled なら同期採用、pending なら即
     fallback。窓も世代も出自も判定しない。判別材料(`lastFulfilled` の
     温存/削除)は core に存在するので、実運用で不整合が目立った場合に
     限り将来再検討する。
4. hidden 中の合流は許すべきか(hidden 中の loader 発火を含む)
   - 答え(確定・2026-07-31): **hidden の間は新しいデータを読まない。read の開始は
     reveal の瞬間。** eager refetch(invalidate 時に即撃つ)も、hidden render を
     契機とした read も却下。drop の照合が hidden render で fallback を(hidden の
     まま)コミットするのは無害だが、そのとき fetch は始めない(armed 状態)。
     ※初回 mount の prerender read(m1)は「まだ何も持っていない reader」の話で
     別枠 — ここで縛るのは「無効化されたものを持っている reader」の再読タイミング。
   - 2026-08-01 追記: 問い 1 の確定(layout 照合)により **armed 状態は不要に
     なった** — hidden render では照合自体を行わない(render 中の無条件照合の
     廃止)。read の開始は reveal パスの layout effect 内 = 文字通り
     「reveal の瞬間」で、この答えの規範は機構から自動的に満たされる。

### 確定した設計原則: 「外が知っている / 知らない」の二パターン分離(2026-07-31)

- **パターン A(外が知っている)**: router/フレームワークは必要データと cache
  lifetime を知っているので、「新データを取ってから reveal」を自分で編成できる。
  lane 側の受け口は LaneHydration の republish → handoff(#62 の機構が正しい形)。
  settled な seed の採用なので fetch も fallback も出ない。
- **パターン B(外が知らない)— トークン方式(確定・2026-07-31)**: reader は
  「reveal 時に変わる値(トークン)」を state に持ち、render 中に prev ≠ current
  を**前後比較**する。変わった render でだけ記録(remove/invalidate 時点の
  promise)を照合し、該当すれば **drop → その render で re-read 開始** → suspend
  → fallback → 新値。fetch の開始 = トークンが変化した render = reveal の render。
  - hidden 中の re-render はトークン不変 → 何もしない(読まない)。visible の
    urgent render もトークン不変 → 照合自体が走らず SWR は構造的に安全(未通知
    ゲート不要)。armed 状態も fallback ホストも不要。
  - これは #62 の handoff("prevSource is state" の render 中比較)の一般化で
    あり、新しいパターンではない。
  - トークンの供給源: (A) Next では復帰時の republish = **hydration source の
    変化がそのままトークン**(復帰ごとに新 payload が流れるのは /bfcache で実測
    済み)。(B) 自作ルーターでは owner が visibility / epoch を流す(instrumented)。
  - remove は従来どおり通知で visible reader も即 fallback(urgent が仕様なので
    無条件照合のままでよい)。invalidate はトークン照合のみ。
  - **既知の限界 — 計測済み(2026-07-31、/bfcache に static・"use cache" ルートと
    snapshot 同一性プローブを追加して確認)**: 「payload を流さずに reveal する」
    ケースは**本番ビルドで実在する**。空集合ではない。
    - dev サーバー: static / cached ルートでも復帰のたびに payload が再ストリーム
      され、snapshots は値同一でも **identity が NEW** → トークンは常に発火
      (dev は判断材料にならない)
    - **本番**: dynamic(PPR、`connection()`)ルートは復帰ごとに NEW + 新値
      (list v1→v2→v3)→ トークン発火 ✓。**static ルートと revalidate 内の
      "use cache" ルートは復帰で NEW にならない**(identity SAME、または subtree
      の re-render 自体が観測されないケースあり)→ **トークン沈黙**
    - 意味論: 沈黙するのは「Next がルートの全データを fresh と判断した reveal」。
      その下で lane が独自に invalidate したキーは信号を受け取れない
    - **BF-Q1 の答え(本番・2026-07-31 計測)**: cached な殻 + dynamic な中身
      (PPR)のルートへ bfcache 経由で復帰したとき、Next は
      **(a) dynamic を待ってから遷移、でも (b) 古い dynamic を見せて後追い更新、
      でもなく、(c) 遷移は即時(殻は 6ms で表示)+ dynamic 部分は保持していた
      旧内容を見せずに Suspense fallback へ落とし、新 payload 到着で新値を表示**。
      dynamic シードに 800ms の人工遅延を入れて位相分離した計測で、離脱前は
      `list v2 (rsc)` を表示していたのに、復帰フレーム 1 発目から 805ms まで
      fallback、その後 `list v3 (rsc)`。旧値のフレームはゼロ。
      → **Next 自身が「無効化相当のものは見せず fallback で新データを待つ」を
      選んでいる**。パターン B の規範(古い中身を描かない + reveal で read)と
      同型であり、lane がそれに合わせることは Next の挙動とも整合する。
    - **back/forward の復帰(本番・2026-07-31 計測)**: browser back は push 再訪と
      別物。**revalidate なしの back は完全な as-is 復元**(旧値を最初のフレーム
      から表示、fallback なし、再フェッチなし、payload なし = トークン沈黙。
      dynamic ルートでも)。一方 **detail 側で `revalidatePath("/bfcache/list")`
      してから back すると、旧値を 1 フレームも見せず fallback(在庫 814ms)→
      新値、payload 再ストリーム(ident NEW)**。つまり Next にとって明示的な
      invalidation は back の as-is 復元より強い。**「visible 時に無効化済みの
      中身を見せない」という lane の規範は Next 自身の意味論と同型**であり、
      back で厳密さを緩める根拠はない。
    - トークンの守備範囲(まとめ): Next 層の invalidation は reveal に republish
      が必ず伴う(トークン自動)。**残る沈黙は「lane 層だけが無効を知っている ×
      payload の流れない復帰(素の back / static / fresh-cached)」の交差のみ**。
      埋める候補: (i) pathname トークン、(ii) lane の invalidate 時にアプリが
      `router.refresh()` / `revalidatePath` で Next にも伝える運用ブリッジ
      (lane に新機構が不要になる可能性)。
    - 次の仮説: **`usePathname()` をトークンにする** — hidden 中に他ルートへ
      移ると pathname が変わり、復帰で自分のパスに戻る。「pathname が自分の
      パスに戻った render」= reveal の前後比較として、サーバーの参加なしに
      機能しうる。→ **検証済み・成立(2026-07-31、下の「検証: usePathname
      トークン」参照)**
- 差は通知側だけ: remove の通知は visible reader も即 fallback(urgent)。
  invalidate の通知は transition で収束(SWR 維持)。**未通知ゲート**(購読経由で
  通知を受けた reader は照合で drop しない)が、visible reader への urgent
  render over-fire から SWR を守る。
- 合成: hidden 中の remove/invalidate + 復帰時 republish は、reveal render の
  drop が store の新 seed(settled)を見つけて fallback なしで採用(RS1 の #62
  挙動と一致)。外が知らなければ fallback + reveal での read。

### 検証: usePathname トークン(本番ビルド・2026-07-31 計測)— 成立

/bfcache の各ルート + HUD(対照)に `pathname-probe.tsx` を追加して計測。
プローブは pattern B と同じ機構をそのまま実行する: prev を state に持ち、
render 中に `prev !== usePathname()` を前後比較(変化時は render 中 setState)。
own path は初回 render の pathname を ref に固定。effect の mount/cleanup で
live フラグを持ち、live=0 の render = hidden render / reveal render(effect
再 mount 前)/ 初回 mount を判別する。

- **ビルド時の発見**: cacheComponents では `usePathname()` は「実行時にしか
  確定しない URL データ」扱い。dynamic ルート(detail/[id])の client
  component が Suspense 外で呼ぶと `next build` が失敗する
  (digest `CLIENT_HOOK_DYNAMIC`、修正は "[stream] Suspense で包む" か
  "[block] `export const instant = false`")。プローブは自前の Suspense で
  包んで解決 — **pathname トークンを使う機構は Suspense boundary の下に
  住むことが構造的に強制される**。Suspense 内なら static ルートは ○ のまま
  (静的性は壊れない)。
- **(a) hidden ツリーに pathname 更新は届く**: ナビゲーションのたびに、
  すべての hidden ルートの probe が live=0 で re-render し、新しい pathname を
  観測した(context は凍結されない。hidden が複数でも全員に届く。例: list と
  static が両方 hidden のとき、cached への nav で両者が `TOKEN-FIRE (away)`)。
- **(b) reveal render で前後比較が成立**: 4 ケースすべてで、reveal の render が
  `prev=<離脱先> → current=<own>` の TOKEN-FIRE を effect 再 mount より前
  (live=0)に観測した。順序は **token render → layout-mount → passive-mount**。
  - 素の back → static ルート(payload なし・ident イベントなし)✓
  - push 再訪 → static ルート(payload なし)✓
  - 素の back → "use cache" ルート(revalidate 窓内・payload なし)✓
  - push 再訪 → dynamic ルート(republish あり、トークンも同時に発火)✓
  - **payload の流れない復帰(従来のトークン沈黙ケース)全てで発火** —
    残っていた沈黙は pathname トークンで埋まる。
- **設計上の注意 — トークンは hide 側でも発火する**: 離脱時にも hidden render
  で `prev=own → current=他` の変化が起きる(live=0)。「変わった」だけを
  合図にすると hide 直後の hidden render で drop+read が始まり、仕様 Q4
  (hidden 中は読まない)に違反する。**drop+re-read の条件は
  「prev ≠ current かつ current === ownPath(mount 時固定)」**とすること。
  current ≠ own の変化は無視(hidden のまま素通り)。
- **限界**: pathname は path しか区別しない。同一 path で searchParams だけ
  異なる再訪はトークンにならない(必要なら `useSearchParams` を追加トークンに
  する — 同じく URL データなので Suspense 前提)。また own path の固定は
  「1 つの probe は 1 つのルートにしか住まない」前提(layout 級の共有
  component が使う場合は要注意)。
- 結論: **client-owned × payload の流れない復帰の「残る沈黙」は、
  usePathname トークン(own path 固定 + reveal 判定付き)で埋められる**。
  pattern B のトークン供給源として採用可。

### 検証: intercepting route(@modal)× Activity(本番ビルド・2026-07-31 計測)

/bfcache に `/bfcache/photo/[id]`(children slot 版)+ `@modal/(.)photo/[id]`
(intercepted 版)を追加。キー `["bf","photo",id]` は**seed しない client-owned**
で、full page と modal が同一 read の 2 つの mount point になる。両方に
PathnameProbe + lane Probe を配置。

- **モーダル open 中、下のページは hidden にならない**: soft nav で
  `/bfcache/static` → photo/1(intercepted)としても、static の probe に
  cleanup は出ず、pathname の away-fire も **live=1**(effect 生存 = 購読生存)。
  interception は「購読が切れる」という Activity の急所をそもそも突かない。
  invalidate は通常の通知チャネル(SWR)で届く。
- **close(router.back)でモーダルツリーは unmount ではなく hidden Activity 入り**:
  layout/passive-cleanup の後に photo-modal の probe が **state を保ったまま
  live=0 で render**(prev=own が生存)。閉じたモーダルは router bfcache の
  keep-alive 対象で、通常ルートの hidden ツリーと同じ物理条件に入る。
- **再オープンは reveal そのもの**: `prev=/bfcache/static → current=own` の
  TOKEN-FIRE が passive-mount 前(live=0)に発火し、**loader 発火 0** で
  state / committed promise ごと復元。pathname トークンは modal ツリーでも
  ルートツリーと同一に機能する(own = intercepted URL が初回 mount で正しく
  固定される)。
- **hidden モーダル中の invalidate → 再オープン(現行 main の挙動)**:
  invalidate 時は完全沈黙(通知・render・loader すべてなし)。再オープンで
  **stale v1 を描画 → effect 復帰後に bg:1 refetch → fallback フラッシュ →
  v2 で収束**。仕様が却下する reveal 挙動が interception 形でもそのまま再現。
  トークンは stale 描画の**直前の render**で発火しており、pattern B の
  drop + re-read がそのまま適用できる位置にある。
- **モーダルを開いたまま第三ルートへ nav したときの挙動は catch-all の有無で
  割れる**(両方計測):
  - catch-all なし(最初の計測): parallel routes の既知挙動でモーダルは
    **開いたまま残る**(children slot だけ list に切替、@modal slot は保持)。
    結果、**「visible なのに pathname ≠ own」の reader が実在する**。
  - `@modal/[...catchAll]`(null を返す)あり = 実アプリの定石形(修正後):
    nav でモーダルは**見た目上閉じる**が、ツリーは unmount ではなく
    **`display:none` の hidden Activity 入り**(下ページ static と同じ nav で
    両方 hidden 化。cleanup 後も state 保持の live=0 render、away-fire)。
    別ルート(list)から再オープンすると、kept ツリーが reveal として復活:
    returned-to-own が passive-mount 前に発火、loader 0、値復元。今度は
    list が visible の下ページになる(live=1 の away-fire)。
  - どちらの形でも、トークンの意味論は「current === own ⇔ visible」
    **ではなく**、(a) hidden なら必ず current ≠ own(reveal は見逃さない =
    over-approximate)、(b) visible reader への over-fire はあり得るが、
    visible は購読が生きているので**未通知ゲート + 記録照合が空振りして
    無害**、の 2 点で成立する。close 時の下ページへの returned-to-own
    (live=1)も同じ over-fire 類。**ライブラリはアプリが catch-all を
    置いているかを仮定できないので、この over-approximation 前提の設計が
    唯一の安全な形**。
- **browser back/forward(traverse)での modal 復帰は as-is reveal ではなく
  republish 型**(2026-07-31 追計測。「Activity で保持されているのに戻るたびに
  ロードが出る」の正体):
  - 事実: forward 復帰のたびに reveal token(returned-to-own、state 保持)の
    直後に **modal の Suspense が `seed-fallback render` に落ち**、この lab では
    約 300ms 後に中身の effect が再 mount する(log 観測が low-pri render を
    再スタートさせる増幅の影響はあり得るので幅は参考値)。初回 traverse は
    `/bfcache/photo/1?_rsc=…` の**再フェッチを伴い**、2 回目はネットワークなし
    (route cache ヒット)でも**同じ再サスペンドが起きる**。lane の loader は
    0 回(store の promise 生存、値はそのまま)。boundary の外の PathnameProbe
    は prev を保持したまま reveal した = ツリー骨格と state は Activity が
    確かに保持している。
  - 機構: interception ルートの payload は **Next-Url(参照元)で vary する**
    (segment-cache は response の `Vary: Next-Url` から `couldBeIntercepted` を
    立て、route cache のキーに nextUrl を含める — 同じ URL でも文脈で中身が
    変わる)。そのため traverse 復元は通常ルートの「素の back = as-is」と
    非対称で、modal slot の中身を payload から作り直す。page が新しい props
    (新しい params promise)を受け取るので、`use(params)` 以下の Suspense は
    **必ず**再サスペンドする。push での再オープン(Link)は既存 cache node を
    そのまま再利用するので再サスペンドしない — この差が traverse だけ
    「ロードが出る」理由。
  - 含意: lane の分類ではこの復帰は「**republish が伴う復帰**」(server-owned
    と同じ形)であり、トークン沈黙ケースではない。client-owned キーは store が
    生きているので remount 後すぐ値が出る(loader 0)— 見えている「ロード」は
    Next 自身の fallback フラッシュで、lane 側で消せる層ではない。トークン
    設計への変更は不要(reveal 検知は traverse でも正常に機能していた)。
    seeded modal(server-owned)にとっては、この republish はむしろ handoff の
    供給源になる。
- 計測上の注意: hidden Activity の DOM は `display:none` でも textContent に
  残るため、FrameStrip(route subtree の textContent 録画)は閉じたモーダルの
  文字列を拾い続ける。フレーム判定に使うときは probe の値 attribute で絞ること。

### 検証: reveal 時の layout-effect 照合(/reveal-sync、本番・2026-07-31)— 成立

仮説(オーナー提起): reader の (再)mount 時の `useLayoutEffect` で「remove /
invalidate 済みの promise を持っていないか」を store と照合し、該当したら
setPromise すれば、**トークンなしで** stale の paint を防げるのではないか。
→ **成立。** 専用シーン `/reveal-sync` で計測(ミニ store + lane 型 reader
2 種: passive 照合のみ = 現行 lane 相当 / + layout 照合。Activity children は
memo 化して「reveal で render が起きない」実機条件を再現。recorder は
rafTicks で「paint された frame」と「コミットされたが paint 前に消えた状態」
を判別)。

- **reveal の解剖**(実測): mode フリップの click タスクでは unhide も effect
  再出現も起きない。React は**別タスクの reveal パス**をスケジュールし、その
  1 タスク内で **unhide → layout effect 再出現 → (軽量シーンでは passive も)**
  を実行する。`end-of-task` マーカーで click タスクとの分離を確認。
- **layout 照合の保証**: 照合 → setPromise → 同期 re-render → suspend →
  fallback コミットが **reveal パスと同一タスク内で完結**する。stale-visible
  状態はタスク境界を越えず(MutationObserver にすら映らない)、ブラウザは
  タスク中に paint しないので、**stale frame は構造的に paint 不可能**。
  invalidate(pending 差し替え)・remove(read-through 再作成)・sync toggle・
  transition toggle の全変種で確認。
- **remove 経路のおまけ**: layout 照合内の `store.read()` が新 promise を
  作る = **loader-call の発火が reveal の瞬間**(仕様 Q4「read の開始は
  reveal の瞬間」が機構から自動的に出る)。
- **hidden 中に resolve 済みだった場合**: 照合が settled promise を採用し、
  suspend なし・fallback なしで新値を直接コミット(handoff と同じ見え方)。
- **対照(layout 照合 OFF、passive のみ)**: stale-visible 状態が**タスク境界を
  越えて存在する**(MO が `display:block v1` の frame を捕捉)。修正は別
  タスクの passive 頼みで、paint との**競争**になる — この軽量シーンでは
  +1.9ms で辛勝(raf:0 = 未 paint)したが、実機 Next の reveal では passive は
  paint 後 ~9ms(実測済み)なので負ける。layout ON ではこの frame 自体が
  存在しない、が決定的な差。
- **設計への含意 — pattern B の大幅な単純化**:
  1. **reveal チャネルの機構は「(再)mount 時の layout-effect 照合」で足りる。
     トークン供給は前提条件ではなくなる**(非 router の素の Activity も
     カバー = 未決 1 が解消)。
  2. layout effect の再出現は**本物の reveal と初回 mount でしか起きない**
     ので、visible reader への over-fire が構造的に存在しない。トークン方式で
     必要だった未通知ゲート・over-approximation の議論は reveal チャネルから
     消える(visible の invalidate は従来どおり通知 → transition の SWR)。
  3. トークン(pathname / republish)は「修正 2 パス目を省き reveal render
     1 パスで drop する」**最適化(fast-path)**に位置づけが変わる。republish
     採用(pattern A handoff)は render 中採用のまま。
- 留保:
  - 「unhide と layout effect 再出現が同一タスク」は React 19.2 の実測挙動
    (useLayoutEffect の paint 前契約とは整合するが、Activity reveal について
    明文の保証があるわけではない)。React 更新時は /reveal-sync の再実行で
    リグレッション検知する。
  - StrictMode(effect 二重実行)での照合の冪等性は未計測(m18 と同枠)。
  - 実機 Next(bfcache の重い reveal コミット)での再確認は未実施 — 機構の
    答えは出たが、次は lane 本体に照合を実装して /bfcache で検証するのが順。
- ハーネスの教訓(再発防止): (1) recorder を Activity 内に置くと hide で
  attach effect ごと破棄され reveal 窓を録り逃す — recorder は境界の外、ref
  だけ host child へ。(2) Activity 初回 mount は子ツリーのコミットが親の
  effect より遅れるため、ref が null の一発 effect は永久に空振りする
  (frame-recorder は rAF リトライで対処済み)。

**追記(2026-08-01): 初回 mount 中の invalidate は隙間ではない(オーナー仮説の
実測確認)。** clear entry → remount(pending で suspend、コミット前)→
suspend 中に invalidate(v2 → v3 差し替え)を実測した結果: コミット前の
render 試行は**毎回 useState initializer を走り直して store の現在の promise を
読む**。invalidate 直後の再試行は `holding v3 (pending)` を掴み、v2 は一度も
コミット・paint されずに fallback → v3 で確定(layout-check は commit 時に
clean = 仕事なし)。つまり「suspend 中に無効化された promise を state に抱えて
commit する」経路は初回 mount には存在しない — hooks state は commit で初めて
永続化され、それまでの試行は使い捨てだから。これにより:
- layout 照合に「一度 commit 済みの reader に限る」等のガードは不要(初回
  commit 時は構造的に clean。render → layout の マイクロ窓で発火しても
  pre-paint の同期 drop なので無害)
- `syncAfterSubscribe` に残る固有の守備範囲は「最後の render 試行 → passive
  購読」のマイクロ窓のみ(+ 通知ソースと pending フラグを揃える transition
  意味論)。reveal の守備は layout 照合へ移る

### 検証: reveal 照合の実機確認(/bfcache × feat/activity-reveal、本番・2026-08-01)— 成立

`feat/activity-reveal`(layout 照合実装、status タグなし)に lab を merge した
このブランチ(`lab/activity-lab-on-reveal`)で、photo モーダル(client-owned
キー)の離脱-復帰を本番ビルドで再計測。

- **invalidate を hidden 中に見逃し → 再オープン**: reveal クラスタ +2.6ms
  (probe の layout-mount より前 = layout 照合の位置)で `changed=true` →
  drop → fallback render(+5.3)→ loader 発火(+5.5、`runLoader` の
  microtask 分遅延)→ 新値で収束。**reveal(+0)〜収束(+9)の窓に rAF
  サンプルはゼロ** — stale も fallback も一度も paint されず、次の paint
  境界は収束後の最終状態だけを見た(localhost の loader が ~4ms で返る
  ため、意図した fallback すら sub-frame で消えた。遅い loader なら
  fallback が仕様どおり見える)。
- **set を hidden 中に見逃し → 再オープン**: `set#1 (hud)` を **loader 0**
  で採用。タグ撤去の帰結である「React 計装までの 1 retry」の過渡 fallback は
  コミット状態としては存在した(MutationObserver が捕捉)が **raf:0 =
  一度も paint されず**。「タグなしで実用上 flash しない」が実機で裏付け
  られた。
- セッション全体で SUSPENDED を含む frame は 3 つ、**すべて raf:0**。
- 無害な観測: 照合の直後に `syncAfterSubscribe` が同じ新 promise を
  transition でもう一度適用しようとする(pending フラグが一瞬立つ)。
  同一 promise の setPromise なので実害なし。気になるなら将来
  「照合が直近に適用済みなら購読 catch-up は skip」の小最適化余地。
- 計測の注意(自分への再発防止): (1) close 直後(<数百 ms)に invalidate
  すると passive-cleanup 前で通知が届き、hidden SWR 収束済みの reveal
  (照合 clean)という**別シナリオ**になる。(2) React の controlled select
  へ素の `dispatchEvent` は value tracker に飲まれ得る — prototype setter
  経由で書く。(3) branch 切替後の `next build` は `.next` キャッシュが
  古い workspace パッケージを抱え得る — 計測前に rm -rf .next。

## 設計結論: App Router における所有権の規律(オーナー判断・2026-07-31)

App Router で Hydration(RSC seed)を使うと、同じデータが Next の payload
キャッシュと lane store の二箇所に写る。**invalidation・mutation が lane 側だけに
届く構成は一貫性を失う**(実測: lane 層の無効化を Next は知らず、payload の
流れない復帰 — 素の back / static / fresh-cached — で古い姿が as-is 復元される。
一方 Next 自身の revalidatePath は back でも旧値を 1 フレームも見せない)。

キーごとの判定則:

| 条件 | 選択 |
| --- | --- |
| client component が誰も反応的に読まない | lane に入れない(RSC 直渡し) |
| client が読むが、真実は server | **hydration(server-owned)** |
| client が鮮度・内容を制御する | **seed しない(client-owned)** |

**server-owned キーの規律**: lane のクライアント側 mutation 面(`update` / `set` /
`invalidate` / `remove`)は**全面的に使わない**。lane は読み取り専用の配布層。
楽観更新は `useOptimistic` を `useLane` の戻り値の上に component レベルで重ねる
(store に書かない — `lane.update` は永続書き込みであり、republish が来ない復帰
経路では精算されず、action 失敗時の巻き戻しも手動になるため、invalidate と同型の
所有権違反)。書き込みは server action → revalidate → republish が唯一のチャネル。

server-owned hydration に残る固有メリット: (1) client-owned キーと同じ読み口
(useLane / Suspense / transition 意味論)、(2) SSR + mount 後 fetch なし、
(3) prop drilling なしの横断読みと republish の一貫収束、(4) Activity 対応が
タダで付く(republish = reveal トークン、#62 の handoff がその受け口)。
これが要らなければ RSC 直渡しでよい。

**server-owned では loader も本質的に不要**(2026-07-31 追記): loader が発火する
経路 — boundary 外 reader の mount 時 read(matrix AH:outside で実測: seed 前に
loader が走り直後に上書きされる)、GC 後の再 read、`refetchOnMount` / `whenStale`
— はすべて「client が Next の知らない vintage を取ってくる」所有権違反の入口。
**loader を定義から消せば違反が構造的に不可能になる**。API 案:
`laneRead({ key, loader })` = client-owned / `laneSeededRead({ key })` =
server-owned(republish だけが供給源)。所有権が read の型にエンコードされるので、
seeded read への `invalidate` / `update` / `set` / トリガー類は**型レベルで拒否**
できる(dev 警告より強い)。宿題: loader なしエントリの retention 仕様(GC 後に
republish の来ない復帰をされた場合 — reader の committed promise で表示は保たれ、
次の republish で再 seed される、で足りるかの明文化)。

ライブラリへの含意: 上記の型分割が本命。次点として **hydration で seed された
キーへのクライアント mutation を dev モードで警告するガード**。
「App Router で hydration は基本やるべきでない」という強い形は、「server-owned
の規律(mutation 全面禁止)を守れないなら client-owned に倒せ — seed したキーを
client で触るのが唯一の罠」というガイダンスに落ちる。

## 設計確定: external read(オーナー承認・2026-08-02)

Issue #63 コメントスレッドの設計議論の到達点。「loader なしの seeded read を型として分ける」
(上記 2026-07-31 追記)の具体化で、当初案(別関数 `laneSeededRead`)から大きく形が変わった。
裏付けの App Router 内部調査は `RESEARCH-next-router-caches.md`(Next 16.3.0-preview.10
実ソース、Opus サブエージェントによる)。

### API: 別関数ではなく sentinel loader

```ts
laneRead<Task>({ key: ["task", id], loader: external })
```

- 命名は `external`(**seeded / serverOwned は不採用**)。供給者は server とは限らない
  (React Router 等の client-only router が publish する構成も同型)ため、確定原則
  「外が知っている / 知らない」の語をそのまま使う。「loader は外にある」と読める
- loader スロットは 3 値のシグナルになる: 関数 = client-owned / `external` =
  外が publish する / `undefined` = disabled(従来どおり)。gating
  (`loader: cond ? external : undefined`)も自然に共存
- `T` は loader から推論できないため明示アノテーション必須(別関数でも同じ負担)

### sentinel は本物の loader — 読み取り経路に分岐なし

`external` は「呼ばれたら resolve しない promise を返し、デフォルト timeout で reject
(key 名入りエラー)、publish が来たら entry 上書きで abort される」**運命づけられた
loader**。fetch は絶対にしない。これにより:

- `useLane` の全読み取り経路(`useState` 初期化・source switch・`syncAfterSubscribe`・
  `reconcileOnReveal`・`onRemove`)は無条件 `readOrCreate` のまま。分岐ゼロ
- boundary 外 reader の publish 前 mount(matrix AH:outside)は「suspend して
  publication を待つ」**サポートされる読み方**に変わる(旧記録の「所有権違反の入口」は
  loader が fetch する場合の話で、external では構造的に無害)。App Router が構造的に
  持たない layout↔page 間のデータチャネル(props の届かない場所への promise 配布)が
  強みとして立つ
- 誰も publish しないキー(typo・boundary 置き忘れ)は timeout エラーで大声で失敗する。
  静かな無限 suspense にはならない
- timeout 調整は `external({ timeout })` が configured 版を返す形(将来拡張)

### 実行時エンフォース(型のキー拒否は不採用)

- publish 時に entry へ external マーク → `invalidate` / `set` / `update` / `remove` は
  **実行時 throw**(dev/prod とも)。branded key + conditional generics による型レベル
  拒否は、素のキー literal 経由の穴が残る割にシグネチャコストが大きいので不採用
- 型は薄く: external overload はトリガー系オプション(`staleTime` / `whenStale` /
  `retry` / `refetchOn*` / `loaderMeta`)を持たず(excess property check で定義箇所
  エラー)、`useLane` 戻り値から `invalidate` を除去。`lane.prefetch` は loader 実行が
  本務なので external spec を型で受けない
- トリガーの effect は元々オプション未設定なら no-op なので実行時対応も不要

### retention: WeakRef による到達可能性委譲(pin は不採用)

App Router は時間・容量・版数の 3 軸で client cache を確実に破棄する(RESEARCH §2)が、
隠し `<Activity>` は payload を持たず reveal は必ずデータの再供給を伴う(同 §4)。
lane 側の保持はこれと**シグナルではなく到達可能性で**揃える:

1. external entry は値(promise)を **WeakRef** で持つ。殻は永続(小さい)、dead の殻は
   Next 同様 lazy に回収
2. publish 時に published promise 群を **snapshots オブジェクトをキーにした WeakMap** へ
   強参照で繋ぐ → 「Next が payload をどこかに持っている限り lane の値も生きる」が自動
3. committed reader の React state が第三の強参照 → 「reveal され得る tree がある限り
   生きる」も自動

解放されるのは「Next の全キャッシュから消え、かつ committed reader も全滅」のとき
だけで、これは Next 側も必ずサーバ再取得する状態。hide と unmount を effect で区別
できない問題(cleanup は両方で走る)を、参照可能性で回避しているのが要点。

**不採用の記録(重要・再提案しないこと)**:

- **throw-on-create(誤用は即クラッシュ)**: GC 後 reveal という誤用でない経路が
  create に到達するため、pin とセットでしか成立せず、wait-for-publish の方が
  横断読みを機能にできる
- **reader からの store 書き戻し(GC 後に committed promise で再 seed)**: reader が
  覚えているのは「自分が最後に見た世代」であり、古い tree の reveal が共有 store に
  古い世代を再注入して visible reader を巻き戻す(publication の単調性違反)。
  防ぐには GC 耐性のある epoch watermark が要り複雑。しかも store entry を消しても
  reader が生きている限り promise は JS GC から解放されない(同一オブジェクト)ので、
  **書き戻しが可能なキーと GC で得するキーは完全に排反** — 効くところでは不要、
  必要なところでは不可能
- **pin(superseded-only 永久保持)**: 一貫性は正しいが、reader ゼロのキーが document
  寿命で残る。WeakRef 方式が同じ一貫性をメモリコストなしで与えるため置き換え
- **timeout 後に fetch する fallback loader**: client が owner の知らない vintage を
  取る穴(AH:outside の実測ハザード)を opt-in で開け直すため見送り。timeout の運命は
  reject のみ
- **`useRouter().bfcacheId` を寿命・キー境界に使う**: 前進ナビゲーションのたびに
  新採番される(RESEARCH §3)ため、同一 URL 再訪でキャッシュが割れる

### 検証残(lab)

- outside-reader シーン新設: streaming SSR での順序(boundary 外 reader が server 側で
  suspend → publish で resolve するか)、素の back、revalidate 後の収束、
  「last publication wins」の横断 reader 挙動
- WeakRef 回収の実測(node `--expose-gc` / 本番ビルド)— BF4 計測はこの検証を兼ねる
- テスト方針: GC タイミングは非決定的なので「生きている / 死んでいる」の両状態を
  正しい状態として扱う(実際どちらも valid な設計になっている)
- 初期値 API(publish 前の placeholder)は outside-reader シーンの実測後に形を決める

## 一次観測(2026-07-31、自動走行による粗い読み)

matrix m1–m17 を main と #62(`lab/activity-lab-on-62`)の両ブランチで自動再生し、
router-sim / bfcache は conflict 系を両ブランチで手動再生した。粒度は「最終値・
FrameStrip の赤カウント・loader-call の有無と順序」。probe 別の fallback フラッシュと
フレーム単位の tearing はまだ計測していない(→ 残課題)。

### 両ブランチで同一だったもの(matrix はこの粒度で差なし)

- **m1**: hidden のまま mount で loader は発火する(prefetch-on-prerender)。
  Hydration 象限は seed が fetch を抑止(H の calls=0)
- **m2/m7**: hidden 中の invalidate に hidden reader は無反応。同キーの visible reader
  (P/H 象限、A/AH の outside)が通知経由で即 refetch し、hidden 側は reveal 後に
  catch-up で収束。**m7 の「hidden 中 loader 発火」は observed だが、発火主は visible
  な outside reader であり hidden reader ではない**(A 象限に outside がいる設計上、
  純粋な「hidden だけ」の観測は B キーで取る必要がある — 設計メモ)
- **m3/m4**: remove → visible reader は fallback→refetch。P/H(visible 象限)で削除値
  が 1–2 フレーム赤に出る(通知〜fallback コミットの隙間)。hidden 象限(A/AH)の
  赤は 0
- **m8**: remove + urgent / flushSync 同一 task — 赤は P/H の 1–2 のみで両ブランチ同一。
  クラッシュ・値の破綻なし。**ただし probe 別 fallback フラッシュ(a1 だけ落ちる
  tearing)はこの計測では見えていない — fine pass 必須**
- **m10**: remove 後、hidden のまま contextTick で render を誘発しても loader 発火なし
- **m12**: invalidate + urgent / flushSync — 異常なし、赤 0
- **RS3 相当**: 操作なしのルート往復では値が保たれ loader も発火しない(keep-alive 成立)

### 両ブランチで同一に出た未解明の現象(重要)

- **m8 実行後、A 象限の reveal 収束が止まる**: m13/14/15(hide → remove →(復活)→
  reveal)で、P 象限は新値に進むのに A 象限の reader は m8 時点の v10 を表示し続けた。
  m16(hide なしの可視操作)でようやく v20 に収束。AH 象限も m8 以降 a2=v9 のまま
  bg:1 / tr:1 が立ちっぱなし。**詰まった transition(または残留 background)が
  hidden→reveal の catch-up を無期限に止めている疑い**。main でも出るので #62 の
  regression ではないが、「stuck transition は reveal 収束を止めてよいか」は仕様の問い
  1 に直結する新しい入力。単離再現(m6/m8 を単独実行後に m13)を fine pass で
- m6(refetchOnMount=always)実行後、bg:1 が残留する reader がいる(上と同根の可能性)

### 差分が出たもの(#62 の効果)— hidden × hydration 系

| 観測 | main | #62 |
| --- | --- | --- |
| RS1: hidden 中 remove → 復帰(+新 snapshot publish) | 復帰時に **loader 1 回発火**し、その結果が新 snapshot に負ける(無駄 fetch + 競争。最終値は同じ) | **loader 発火 0**。render 内で drop → handoff が新 seed を直接採用 |
| BF(実機): 離脱中 HUD remove → 復帰 | (要再計測 — 初回手動確認では新 rsc 値採用まで確認、loader 数未記録) | **loader 0・赤 0** で新 rsc 値(v2 (rsc))を採用 |
| RS2: shared キー(visible 併読あり) | visible 側は通知で refetch(共通) | 同左。hidden の他 boundary は**自分の boundary が republish するまで旧値保持**(handoff は boundary 単位) |

### 計測上の注意(次の pass で直す)

- 象限の lane はシナリオ間でリセットされないため、状態が持ち越される(m6/m8 の残留が
  m13–15 を汚染した可能性と、それ自体が発見である可能性の両方がある)
- probe 別 suspense-fallback カウントとフレーム単位の tearing 判定は未計測。FrameStrip
  の span title を読む形で fine pass を行う
- m6 は完走するが長い(reader opts を数パターン回すため)。m18(StrictMode)は未実施

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
