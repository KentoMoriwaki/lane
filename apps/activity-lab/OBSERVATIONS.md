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
   - 答え:
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
3. remove 後に同キーが復活していたとき、古い promise の reader は「削除」と
   「新値あり」のどちらとして合流すべきか
   - 答え:
4. hidden 中の合流は許すべきか(hidden 中の loader 発火を含む)
   - 答え(確定・2026-07-31): **hidden の間は新しいデータを読まない。read の開始は
     reveal の瞬間。** eager refetch(invalidate 時に即撃つ)も、hidden render を
     契機とした read も却下。drop の照合が hidden render で fallback を(hidden の
     まま)コミットするのは無害だが、そのとき fetch は始めない(armed 状態)。
     ※初回 mount の prerender read(m1)は「まだ何も持っていない reader」の話で
     別枠 — ここで縛るのは「無効化されたものを持っている reader」の再読タイミング。

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
- **モーダルを開いたまま第三ルートへ nav すると、モーダルは開いたまま残る**
  (parallel routes の既知挙動: children slot だけ list に切替、@modal slot は
  保持。このとき初めて下ページ static が hidden 入りする)。結果、
  **「visible なのに pathname ≠ own」の reader が実在する**。したがって
  トークンの意味論は「current === own ⇔ visible」**ではなく**、
  (a) hidden なら必ず current ≠ own(reveal は見逃さない = over-approximate)、
  (b) visible reader への over-fire はあり得るが、visible は購読が生きて
  いるので**未通知ゲート + 記録照合が空振りして無害**、の 2 点で成立する。
  close 時の下ページへの returned-to-own(live=1)も同じ over-fire 類。
- 計測上の注意: hidden Activity の DOM は `display:none` でも textContent に
  残るため、FrameStrip(route subtree の textContent 録画)は閉じたモーダルの
  文字列を拾い続ける。フレーム判定に使うときは probe の値 attribute で絞ること。

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
