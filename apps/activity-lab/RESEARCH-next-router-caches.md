# App Router のクライアントデータ保持と破棄(Next 16.3.0-preview.10・実ソース調査)

調査日: 2026-08-02。調査手段: Opus サブエージェントによる `apps/activity-lab/node_modules/next/dist/` 実ソース読解。
目的: external read(owner が publish するキー)の retention 方針を router の寿命管理と整合させる。
結論の要約は OBSERVATIONS.md へ反映予定。以下はレポート全文。

---

対象: `apps/activity-lab/node_modules/next` → 実体 `node_modules/.pnpm/next@16.3.0-preview.10_.../node_modules/next`
`apps/activity-lab/next.config.ts` で `cacheComponents: true`(+ `partialPrefetching` 既定 on)。以下すべて実ソース確認。パスは `.../next/dist/` 以下の相対で記す。

## 0. 前提の訂正(重要)

- **「直近 ~3 個の inactive tree を保持」は不正確**。上限 3 は *active を含む総数* であり、**各 layout-router レベルにつき「表示中 1 + 隠し 2」**。
  `client/components/bfcache-state-manager.js:13`
  ```js
  const MAX_BF_CACHE_ENTRIES = process.env.__NEXT_CACHE_COMPONENTS ? 3 : 1;
  ```
  ループは `n = 1`(新しい active 用)から始まり `while (oldEntry !== null && n < MAX_BF_CACHE_ENTRIES)`(同 55-58)なので、リスト長は最大 3。
- **`<Activity>` は cacheComponents 専用**。`layout-router.js:622-628`
  ```js
  if (process.env.__NEXT_CACHE_COMPONENTS) {
      child = jsx(_react.Activity, { name: ..., mode: stateKey === activeStateKey ? 'visible' : 'hidden', children: child }, stateKey);
  }
  ```
  フラグ off なら `MAX_BF_CACHE_ENTRIES = 1` かつ Activity ラップなしなので、keep-alive は完全に消える。
- このバージョンには **旧 prefetch cache(`prefetch-cache-utils` / `state.prefetchCache`)は存在しない**。`client/components/router-reducer/` 配下に該当ファイルなし、`grep -rn "prefetchCache" client/components` はゼロヒット。**Segment Cache が唯一の prefetch キャッシュ**(cacheComponents の有無に関わらず)。

## 1. クライアントルータがデータを持つ場所(4 つのストア)

| # | ストア | 実体 | 生存範囲 | 内容 |
|---|---|---|---|---|
| A | **Route Cache** | `segment-cache/cache.js:208` `let routeCacheMap = createCacheMap()` | モジュールグローバル(ドキュメント寿命) | ルートツリー構造・canonicalUrl・metadata varyPath |
| B | **Segment Cache** | `segment-cache/cache.js:209` `let segmentCacheMap = createCacheMap()` | 同上 | セグメント単位の RSC payload(prefetch 由来) |
| C | **BFCache (データ側)** | `segment-cache/bfcache.js:53` `const bfcacheMap = createCacheMap()` | 同上 | *ナビゲーション時に実際に描画した* rsc/prefetchRsc/head をそのまま保存 |
| D | **CacheNode ツリー + Router BFCache (ビュー側)** | React state。`state.cache`(`app-router.js:308`)+ 各 `OuterLayoutRouter` の `useRouterBFCache` 連結リスト(`layout-router.js:496`) | React ツリーの寿命 | 実際に render 中の RSC ノード。隠し `<Activity>` 分を含む |

A/B/C は**同一の `cache-map.js` 実装**を共有し、**同一のグローバル LRU**(`segment-cache/lru.js` のモジュールレベル `head` / `lruSize`)に載る。`cache-map.js:145` (`lruPut` on read)、`:224-225` (`lruPut` + `updateLruSize` on write)。

### 復元(戻る)ビューに何が効くか

`popstate` → `dispatchTraverseAction`(`app-router-instance.js:236-243`)→ `ACTION_RESTORE` → `restore-reducer.js:43`:

```js
const task = startPPRNavigation(now, currentUrl, state.renderedSearch, state.cache, state.tree,
    restoreSeed.routeTree, restoreSeed.metadataVaryPath,
    FreshnessPolicy.HistoryTraversal, null, null, restoreSeed.dynamicStaleAt, false, accumulation, false);
...
return completeTraverseNavigation(state, restoredUrl, renderedSearch, task.node, task.route, restoredNextUrl);  // :63
```

つまり **戻る操作でも CacheNode ツリーは作り直される**。差分セグメントは `createCacheNodeForSegment` に落ち、`FreshnessPolicy.HistoryTraversal`(=2) 分岐で **C(bfcacheMap)から読む**:

`router-reducer/ppr-navigations.js:605-628`
```js
case 2:
    const bfcacheEntry = readFromBFCache(tree.varyPath);
    if (bfcacheEntry !== null) {
        ...
        return {
            cacheNode: createCacheNode(bfcacheEntry.rsc, dropPrefetchRsc ? null : bfcacheEntry.prefetchRsc,
                                       bfcacheEntry.head, ..., bfcacheEntry.bfcacheId),
            needsDynamicRequest: false
        };
    }
    break;
```
ヒットすれば **元とまったく同一の rsc オブジェクト**が新 CacheNode に入るため、描画結果は完全に一致する。ミスすると下段(B の segment cache → それも無ければ `createDeferredRsc()`)へフォールスルーする(同 638-726)。

**D(`<Activity mode="hidden">`)が保持しているのは React の state / DOM / スクロールであって、RSC payload ではない。** payload は reveal のたびに A/B/C から再供給される。

## 2. 各ストアの寿命と破棄

### 2-1. 共通: 遅延失効(lazy eviction)
`cache-map.js:148-172`
```js
function isValueExpired(now, currentCacheVersion, value) {
    return value.staleAt <= now || value.version < currentCacheVersion;
}
function lazilyEvictIfNeeded(now, currentCacheVersion, entry, onlyMatchFulfilled) {
    ...
    if (isValueExpired(now, currentCacheVersion, value)) {
        deleteMapEntry(entry);   // 読んだ瞬間に削除
        return null;
    }
```
**タイマーによる定期 prune は存在しない。**「読まれたとき」だけ失効判定・削除される(`cache.js:219-220` のコメント「Invalidation does not eagerly evict anything from the cache; entries are lazily evicted when read.」)。

### 2-2. LRU(サイズ上限 50MB、件数上限なし)
`segment-cache/lru.js:40`
```js
const maxLruSize = 50 * 1024 * 1024 // 50 MB
```
`lru.js:118-126` `ensureCleanupIsScheduled()` は超過時に `pingPrefetchScheduler()` を叩くだけ。実際の削除は prefetch スケジューラが**完全に idle になった時**に一度だけ走る:

`segment-cache/scheduler.js:375-381`
```js
// Run LRU cleanup only when the scheduler is fully idle: no queued tasks and
// no in-progress requests. ...
if (task === null && inProgressRequests === 0) {
    cleanup();
}
```
`lru.js:127-144` `cleanup()` は **容量 90% まで tail から削る**。件数上限・時間ベースの掃除は無い。メモリ圧イベントの購読も**未実装**(`lru.js:37-39` / `bfcache.js:74-79` に TODO コメントのみ)。

なお **bfcacheMap のエントリはサイズを 100 バイト固定**で申告する(`bfcache.js:74-79`「This is just a heuristic … The LRU will still evict it, we just won't have a fully accurate total LRU size.」)。実質、bfcache が LRU 圧で落ちるのは segment cache が 50MB を食い潰したときのみ。

### 2-3. staleTime
`router-reducer/reducers/navigate-reducer.js:30-31`
```js
const DYNAMIC_STALETIME_MS = Number(process.env.__NEXT_CLIENT_ROUTER_DYNAMIC_STALETIME) * 1000;
const STATIC_STALETIME_MS  = getStaleTimeMs(Number(process.env.__NEXT_CLIENT_ROUTER_STATIC_STALETIME));
```
既定値は `build/define-env.js:117-118` — **dynamic = 0 秒、static = 300 秒(5 分)**(`experimental.staleTimes` で上書き可、`cacheComponents` では変わらない)。
下限 30 秒のクランプ: `segment-cache/cache.js:198-199`
```js
function getStaleTimeMs(staleTimeSeconds) { return Math.max(staleTimeSeconds, 30) * 1000; }
```
(`getStaleTimeMs` は static / サーバ由来の `x-nextjs-stale-time` にのみ適用。dynamic には未適用なので 0 のままになりうる。)

- Route entry: `cache.js:939-941` `fulfilledEntry.staleAt = now + STATIC_STALETIME_MS`(構造は deploy 単位でしか変わらないので常に static 扱い)。
- Segment entry: `cache.js:2611-2630` `resolveStaleAt()` — サーバの `s` ストリーム最終値 → なければ `x-nextjs-stale-time` ヘッダ(`cache.js:2606-2611`)→ なければ `STATIC_STALETIME_MS`。`cacheLife({stale})` はここに乗る。
- **BFCache entry**: `bfcache.js:84` `staleAt: dynamicStaleAt`、`bfcache.js:50-52`
  ```js
  function computeDynamicStaleAt(now, dynamicStaleTimeSeconds) {
      return dynamicStaleTimeSeconds !== UnknownDynamicStaleTime
          ? now + dynamicStaleTimeSeconds * 1000
          : now + DYNAMIC_STALETIME_MS;   // 既定 0
  }
  ```
  → **既定設定では bfcache エントリは書いた瞬間から stale**。

### 2-4. 版数(version)による一括無効化
`cache.js:221-243`, `bfcache.js:54-60`。`currentRouteCacheVersion` / `currentSegmentCacheVersion` / `currentBfCacheVersion` をインクリメントするだけ。読まれた時に `value.version < currentCacheVersion` で削除される(§2-1)。

### まとめ表

| ストア | 件数上限 | サイズ上限 | 時間失効 | 版数失効 | 破棄タイミング |
|---|---|---|---|---|---|
| Route Cache | なし | 共有 50MB LRU | 5 分 (static) | `invalidateRouteCacheEntries` / `invalidateEntirePrefetchCache` | 読み取り時 or スケジューラ idle 時 |
| Segment Cache | なし | 共有 50MB LRU | サーバ指定 or 5 分(下限 30 秒) | `invalidateSegmentCacheEntries` / 同上 | 同上 |
| BFCache (data) | なし | 共有 50MB LRU(size=100 固定申告) | dynamic staleTime(既定 0)**ただし履歴走査時は無視** | `invalidateBfCache` | 同上 |
| Router BFCache (view) | **レベルごとに 3(表示1+隠し2)** | なし | なし | なし | 4 本目の tree が active になった瞬間、React が unmount |

## 3. Router BFCache(`<Activity>` keep-alive)の詳細

**場所**: `client/components/bfcache-state-manager.js`。`OuterLayoutRouter` が **並列ルートスロットごと・階層ごとに** 呼ぶ(`layout-router.js:496`)。したがってアプリ全体の隠しツリー数は「レベル数 × スロット数 × 2」まで増えうる。ルート直下の `cache.rsc` は Activity で包まれない(`app-router.js:379-388`、`RootLayoutBoundary` に直接渡している)。

**上限**: 3(表示 1 + 隠し 2)。`bfcache-state-manager.js:13`。

**順序と退避規則**: MRU 連結リスト。
- 新しい active は常に head に挿入(同 46-51)。
- 既存 `stateKey` が再び active になった場合は **fast path** — 一致エントリを捨てて head の clone に置き換え、残りは無コピーで再利用(同 59-68)。したがって「戻る」でリストが伸びることはない。
- それ以外は old エントリを clone しながら追加し、`n === 3` でループを抜ける → **4 本目以降は単に連結リストから外れる**(同 69-82)。
- コメントにある通り**履歴順ではなく MRU 順**(同 18-23 の TODO: "Once we start tracking back/forward history at each route level, we should use the history order instead")。

**退避されたツリーはどうなるか**: `layout-router.js:629` の `children.push(child)` に含まれなくなる → その `<Activity key={stateKey}>` が render 出力から消える → **React が unmount**。DOM・client component の `useState`・スクロール位置は破棄される。エントリが握っていた `cacheNode` 参照も React state から落ちる(ただし `bfcacheMap` 側には同じ `rsc` が残りうる → §6 のケース B)。

**隠しツリーの識別**: `layout-router.js:588` で `isActive: isActive && stateKey === activeStateKey` が `LayoutRouterContext` に流れる。また `useRouter().bfcacheId`(`client/components/navigation.js:154-175`)が直近 CacheNode の `bfcacheId` を `_b_<n>_` 形式で公開する。`bfcacheId` は履歴走査時に BFCacheEntry から復元され(`ppr-navigations.js:621-625`)、refresh では前 CacheNode から引き継がれる(同 168-171)。**lane のキー空間を「ビューのインスタンス」で分けたいなら、これが公式に用意された識別子。**

## 4. 【最重要】データが消えた隠しツリーを reveal できるか

**答え: reveal 自体は必ず起こる。しかし「復元されたビュー」は自己完結していない。RSC payload は reveal のたびに A/B/C から取り直される。**

根拠は 3 点。

**(1) 戻る操作は必ず CacheNode ツリーを再構築する。**
`restore-reducer.js:43` で `startPPRNavigation(..., FreshnessPolicy.HistoryTraversal, ...)`。共有レイアウトなど「セグメントが一致する」枝だけが `reuseSharedCacheNode` で使い回される(`ppr-navigations.js:155-163`)。戻り先のページセグメントは一致しないので `createCacheNodeOnNavigation` → `createCacheNodeForSegment` を通る(同 106-122, 341-359)。

**(2) `useRouterBFCache` は reveal 時に「新しい cacheNode」を差し込む。**
`layout-router.js:487-489` で `activeCacheNode = maybeParentSlots[parallelRouterKey]`(=いま作り直された CacheNode)。`bfcache-state-manager.js:46-51` の `newActiveEntry` はこの**新しい** `cacheNode` を持ち、`:59-68` の fast path は **古い同一 stateKey のエントリを捨てる**。React は `key={stateKey}` が同じなので Activity をアンマウントせず state を保つが、`InnerLayoutRouter` に渡る `cacheNode` は新しいものに差し替わる(`layout-router.js:581-589`)。

**(3) 従って payload キャッシュが消えていれば、reveal しても「古い中身」は出ない。**
`createCacheNodeForSegment` で `readFromBFCache` が null → segment cache も null → `ppr-navigations.js:719` `rsc = createDeferredRsc()`。`InnerLayoutRouter` は `layout-router.js:326-342` で
```js
if (isDeferredRsc(rsc)) { const unwrappedRsc = use(rsc); if (unwrappedRsc === null) { use(unresolvedThenable); } ... }
```
としてサスペンドし、`spawnDynamicRequests`(`restore-reducer.js:48`)がサーバへ取りに行く。**復元されたビューは「保存された client state を纏った、サーバから取り直した新しい payload」になる。**

補足: 履歴走査は staleness を無視するので**時間経過だけでこの状態にはならない**。
`bfcache.js:106-115`
```js
return getFromCacheMap(
    // During a back/forward navigation, it doesn't matter how stale the data
    // might be. Pass -1 instead of the actual current time to bypass staleness checks.
    -1, currentBfCacheVersion, bfcacheMap, varyPath, isRevalidation, false);
```
`readFromBFCache` が null を返す経路は **(a) `invalidateBfCache()` による版数バンプ、(b) 50MB LRU eviction、(c) そもそも書かれなかった(Gesture ナビゲーション: `ppr-navigations.js:811` `if (freshness !== 5)`)** の 3 つだけ。

さらに **通常の前進ナビゲーションでは既定設定で bfcache はヒットしない**: `ppr-navigations.js:554-573` の `case 0:` は `readFromBFCacheDuringRegularNavigation(now, ...)` を使い(`bfcache.js:116-122`、`now` を渡すので staleness 判定が効く)、`dynamicStaleAt = now + 0`(§2-3)なので即 stale → `lazilyEvictIfNeeded` が**その場でエントリを削除**する。ドキュメントの記述と一致: `docs/01-app/04-glossary.md`「Pages are not cached by default but are reused during browser back/forward navigation.」

## 5. revalidate / refresh / Server Action の影響

| トリガ | Route Cache | Segment Cache | BFCache (data) | 隠し `<Activity>` |
|---|---|---|---|---|
| `router.refresh()` | 温存 | **版数バンプ** | **版数バンプ** | 手つかず(古い UI のまま) |
| Server Action(`refresh()` = DynamicOnly) | 温存 | 温存 | **版数バンプ** | 手つかず |
| Server Action(`revalidatePath`/`revalidateTag`/`updateTag`/`cookies.set` = StaticAndDynamic) | **版数バンプ** | **版数バンプ** | **版数バンプ** | 手つかず |
| Server Action(無 revalidation) | 温存 | 温存 | 温存 | 手つかず |

証拠:
- `refresh-reducer.js:39-45`
  ```js
  // During a refresh, we invalidate the segment cache but not the route cache. ...
  if (!bypassCacheInvalidation) { ...; invalidateSegmentCacheEntries(currentNextUrl, currentRouterState); }
  return refreshDynamicData(state, FreshnessPolicy.RefreshAll, undefined);
  ```
  `refresh-reducer.js:47-49`
  ```js
  function refreshDynamicData(state, freshnessPolicy, signal) {
      // During a refresh, invalidate the BFCache, which may contain dynamic data.
      invalidateBfCache();
  ```
- `server-action-reducer.js:218-238`
  ```js
  if (revalidationKind !== ActionDidNotRevalidate) {
      invalidateBfCache();                                   // :221
      action.didRevalidate = true;
      if (revalidationKind === ActionDidRevalidateStaticAndDynamic) {
          invalidateEntirePrefetchCache(nextUrl, state.tree); // :234  (route + segment 両方)
      }
      startRevalidationCooldown();                            // :238  再prefetch を 300ms 抑制
  }
  ```
  `revalidatePath`/`revalidateTag` → `StaticAndDynamic`(`server/web/spec-extension/revalidate.js:215`)、`cookies.set/delete` → 同(`server/web/spec-extension/adapters/request-cookies.js:120`)、`refresh()` → `DynamicOnly`(`revalidate.js:83`)。
- **無効化は「即時パージ」ではなく「mark-stale(版数バンプ)」**。`cache.js:229-234`
  ```js
  function invalidateEntirePrefetchCache(nextUrl, tree) {
      currentRouteCacheVersion++;
      currentSegmentCacheVersion++;
      pingVisibleLinks(nextUrl, tree);
      pingInvalidationListeners(nextUrl, tree);
  }
  ```
  実際のメモリ解放は次の読み取り時(`lazilyEvictIfNeeded`)。ただし `pingVisibleLinks` により**画面内 `<Link>` は即座に再 prefetch される**ので、実質すぐ埋め直される。
- **再取得が届くのは active tree だけ**。`refreshDynamicData` は `navigateToKnownRoute(..., state.tree, ...)` を現在のツリーに対して呼ぶ(`refresh-reducer.js:70-80`)。`FreshnessPolicy.RefreshAll`(=3) は `ppr-navigations.js:135-138` で `shouldRefreshDynamicData = true` になり、全 CacheNode が再構築されるが、**対象は `state.cache` のツリーのみ**。隠し `<Activity>` は `bfcache-state-manager.js:72-77` でクローンされる際に**古い `cacheNode` をそのまま持ち回る**ため、再検証は届かない。

> **結論(Q5)**: revalidation は隠しツリーに即座には届かない。届くのは**そのツリーが次に reveal される時**(= back navigation で CacheNode が作り直され、版数バンプ済みの bfcacheMap がミスし、サーバから取り直される時)。

## 6. lane 向けまとめ — 「router が GC するが lane は保持し続ける」不一致シナリオ

App Router は **時間・容量・版数** の 3 軸で確実に「GC」する。superseded-only(キーごとに最新値を永久保持)の lane と食い違いうる具体シナリオ:

### A. データは捨てたが、古いビューは出したまま(← lane が「余分に持つ」方向で**安全**)
- `router.refresh()` / server action の revalidation 直後。`invalidateBfCache()` で bfcacheMap は論理的に死ぬが、隠し `<Activity>` は古い CacheNode を描画し続ける(§5)。
- この間、**router が画面に見せている値**は lane が保持している「その時点の published 値」と一致する。lane が古い値を捨てていたら不一致になるので、**保持する方が正しい**。

### B. ビューは捨てたが、データは残っている(← lane が持ち続けても**無害**)
- 同一レベルで 4 本目の tree が active になり、最古の hidden Activity が unmount(§3)。React state は消えるが `bfcacheMap` のエントリは生きているので、その後 back すると**同一の rsc で再描画され、client state だけが初期化される**。
- lane が値を保持していれば、この再描画時にも同じ値を供給できる。むしろ捨てると復元が壊れる。

### C. データもビューも捨てられ、reveal 時に**サーバの新しい値**が出る(← lane が古い値を出すと**不一致になる唯一の危険地帯**)
成立条件は次のいずれか:
1. **revalidation 後に隠しツリーへ戻る** — `invalidateBfCache()` 済み → `readFromBFCache` ミス → segment cache も版数バンプ済み(StaticAndDynamic の場合)→ サーバ再取得(§4, §5)。
2. **50MB LRU 超過**で bfcacheMap / segmentCacheMap のエントリが落ちた後に戻る(`lru.js:127-144`, `scheduler.js:379-381`)。
3. **通常の前進ナビゲーションで同じ route を再訪** — 既定 `staleTimes.dynamic = 0` のため bfcache は必ずミス(§4 末尾)。`<Activity>` は `stateKey` 一致で保たれるので**client state は古いまま、payload だけ新しい**という混成状態になる。
4. **prefetch 経由の更新** — `attemptToUpgradeSegmentFromBFCache`(`cache.js:869-892`)/ `attemptToFulfillDynamicSegmentFromBFCache`(`cache.js:834-864`)が bfcache データを segment cache へ昇格させるが、`navigatedAt + STATIC_STALETIME_MS`(5 分)で切る。5 分経過後は prefetch がサーバから取り直す。
5. **route tree 自体の 5 分失効**(`cache.js:941`)→ 再ナビゲーションで route cache ミス → `navigateToUnknownRoute`(`segment-cache/navigation.js:228`)でフル再取得。

> **推奨**: lane の retention はケース A/B を担保するために「superseded-only(永久保持)」で問題ない。**ケース C だけが router と食い違う**。router が新しい payload を配ったのに lane が古い published 値を保持していると、同じ画面上で不整合が起きる。対策は「保持期間を router に合わせて短くする」ことではなく(router は最短 0 秒 = 実質キャッシュなし、最長は無期限で、揃えようがない)、**新しい RSC payload seed が届いたら必ずそのキーを上書きする(supersede)**ことを保証する側にある。router の再取得は必ず新しい seed の配信を伴う(`writeDynamicDataIntoNavigationTask` → `finishPendingCacheNode`、`ppr-navigations.js:1205-1318`)ため、seed 駆動の supersede が抜けなく走るなら不一致は生じない。

### 逆方向の注意(lane が「消しすぎる」リスク)
- `bfcacheId`(`navigation.js:162-172`, `ppr-navigations.js:836-847`)で lane のエントリをスコープすると、**refresh では ID が引き継がれ(`ppr-navigations.js:168-171`)、履歴走査では BFCacheEntry から復元される(同 621-625)**が、**通常の前進ナビゲーションでは毎回新しい ID が採番される**。ID をライフサイクル境界に使うと、同じ URL を再訪しただけでキャッシュが割れる。
- 隠しツリーは unmount されるまで**普通にレンダリングされ続ける**(`layout-router.js:498-631` のループは hidden 分も毎回 render 対象に含める)。lane 側で「マウント中 = アクティブ」と見なす実装は誤り。`LayoutRouterContext.isActive`(`layout-router.js:588`)を見る必要がある。

## 7. 参照ファイル一覧

すべて `apps/activity-lab/node_modules/next/dist/` 配下:

- `client/components/bfcache-state-manager.js` — Activity keep-alive の上限と MRU リスト
- `client/components/layout-router.js` — `<Activity>` レンダリング、CacheNode 読み出し、suspend 条件
- `client/components/app-router.js` — ルート CacheNode、popstate 登録
- `client/components/app-router-instance.js` — action queue、`dispatchTraverseAction`
- `client/components/navigation.js` — `useRouter().bfcacheId`
- `client/components/segment-cache/cache.js` — route/segment cache 本体、staleAt 解決、版数無効化
- `client/components/segment-cache/cache-map.js` — 共通キャッシュマップ、lazy eviction
- `client/components/segment-cache/lru.js` — 50MB グローバル LRU
- `client/components/segment-cache/bfcache.js` — bfcacheMap(データ側 BFCache)
- `client/components/segment-cache/navigation.js` — navigate / traverse の完了処理
- `client/components/segment-cache/scheduler.js` — idle 時 LRU cleanup、revalidation cooldown
- `client/components/router-reducer/ppr-navigations.js` — FreshnessPolicy、CacheNode 構築の中核
- `client/components/router-reducer/reducers/restore-reducer.js` — back/forward
- `client/components/router-reducer/reducers/refresh-reducer.js` — `router.refresh()`
- `client/components/router-reducer/reducers/server-action-reducer.js` — server action / revalidation
- `client/components/router-reducer/reducers/navigate-reducer.js` — staleTime 定数
- `build/define-env.js` — staleTimes 既定値の注入
- `docs/01-app/04-glossary.md`(Client Cache 節)、`docs/01-app/03-api-reference/04-functions/cacheLife.md`(Client cache behavior 節)、`docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md`、`docs/01-app/02-guides/prefetching.md`
