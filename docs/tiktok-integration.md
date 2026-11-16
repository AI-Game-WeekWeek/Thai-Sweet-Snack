# TikTok Live integration

## What is and is not available

As of this build, **no official public TikTok API for reading LIVE events (likes, gifts, follows, shares) was found.**
Vendor docs and open-source READMEs searched (Euler Stream, tik.tools, TikTok-Live-Connector, TikFinity) all say TikTok
does not offer one; what exists are (a) third-party services that deliver events by WebSocket/webhook and
(b) reverse-engineered connectors that can break whenever TikTok changes its service and may conflict with TikTok's terms.
TikTok's own developer pages could not be reached to confirm. **Check TikTok's current terms and your provider's terms
before using any source on a real stream.**

This project therefore does not bundle a reverse-engineered connector. It defines one provider-neutral event format and a
small local bridge. Any source you are entitled to use only has to POST events in that format.

## Event format (`LiveEvent`)

```json
{ "id": "unique-string", "type": "like|follow|orangeHeart|rose|gift|share", "count": 1, "tsMs": 1731400000000, "giftCoins": 500, "giftCoins": 500 }
```

- `id`: unique per event (duplicates are dropped). `tsMs`: source time in ms, advisory only: the game stamps the receive time, never trusts a future time, and treats nothing as older than `events.maxSourceLagMs` (3 s), so provider clock skew costs at most the first 3 s of a dessert. Events that are genuinely late (from an earlier dessert) are ignored.
- `count`: batch size (likes 1–1000), otherwise 1. `giftCoins`: value of a gift; in classic and vote mode, at or above `events.largeGiftCoins` (default 100) it completes the current step; in café mode every gift is an order instead.
- Event types your provider cannot supply simply never arrive; the game does not depend on any of them.
- **Gifts** (café mode): `{"id":"g1","type":"gift","giftCoins":50,"displayName":"พี่ต้น","avatarUrl":"https://…/p.jpg","tsMs":...}`.
  `giftCoins` picks the dessert (missing = 1 coin; `count` may be omitted for single events and defaults to 1; treat `giftCoins` as the value of one gift); `displayName` (cleaned, max 16 characters shown) and `avatarUrl` (https only) are
  kept **only on gift and rose events**, shown while that customer is on screen, never saved. The bridge relays them, so use a
  provider you trust with viewer names. Pictures are not loaded unless you allow their host in `cafe.avatar.hosts`.
- **Follow** `{"id":"f1","type":"follow","tsMs":...}` switches the lucky cat on; **orange heart / fan club** `{"id":"o1","type":"orangeHeart","tsMs":...}`
  (one event for both) sends a VIP customer and a tip rain. Both are counted in every game state; **any name or picture sent on
  them is discarded** (nothing about followers or fans is shown, relayed to the game or saved). Whether a provider sends these events is not verified.
- **Menu votes** (vote mode) use `{"id":"c1","type":"comment","text":"2","userId":"opaque-viewer-key","tsMs":...}`. Only comments that are exactly
  `1`, `2` or `3` (or `#1`..`#3`) count; ordinary chat is accepted and ignored (the bridge answers 202 with `ignored` > 0, so a provider never sees an error for
  chatter; 400 is only for requests where nothing is understood). The bridge reduces a comment to `{"type":"comment","vote":2,"userId":...}` and **drops the text**, so it never
  reaches the game. `userId` should be an opaque key (not a nickname) and is used only for one vote per viewer per round.
  Without `userId`, votes are capped per second.

Suggested mapping (verify against your provider's docs): like → `like`, follow → `follow`, "Orange Heart"/small heart → `orangeHeart`, Rose gift → `rose`, other gifts → `gift` with `giftCoins`, share → `share`.

## Run it

```bash
export BRIDGE_TOKEN="$(openssl rand -hex 16)"   # at least 16 characters
npm run bridge                                  # listens on 127.0.0.1:8787
```

Send an event (from your provider's webhook handler, or by hand for testing):

```bash
curl -X POST http://127.0.0.1:8787/event \
  -H "Authorization: Bearer $BRIDGE_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"t1","type":"like","count":50,"tsMs":'"$(date +%s%3N)"'}'
```

Open the game with the bridge:

```
http://localhost:5173/?bridge=ws://127.0.0.1:8787&token=YOUR_TOKEN
```

The token is in the URL of your OBS browser source: keep that URL private and keep the bridge on `127.0.0.1`
(set `BRIDGE_HOST` only if you understand the exposure). Without `?bridge=` the game runs standalone; `?mock=1` simulates viewers.

## Behaviour on failure

The page shows `connected | reconnecting | offline`. If the bridge dies the game keeps cooking; the page retries with
backoff (1 s up to 30 s) and resumes when the bridge returns. Malformed or oversized messages are ignored.

## Who is in the live (viewer count and "still here")

TikTok gives no "viewer left" signal, so the game cannot know **who** left. It keeps the line fresh with two hints, both optional:

- **How many people are in the live** (TikFinity's `roomUser` message). The bridge reads the count (fields tried: `viewerCount`, `viewers`, `total` and a few more; the real field name is not confirmed, `/monitor` shows what arrived) and sends it to the game pages as `{"cmd":"viewers","count":N}`. When more viewers are waiting in the line than `ceil(N * 1.25) + 2`, the excess is cleared: only viewers who merely joined, waited over a minute and are off screen (never the front places, gifting viewers, VIPs or ghosts). A reading older than 90 s is ignored. If no count arrives nothing is removed.
- **Who is still active**: a like, comment, share, follow, gift or join that carries a viewer name proves that viewer is still here. The bridge passes the names (batched each second, in memory only) as `{"cmd":"present","names":[...]}`; the game remembers when each name was last seen and clears the quietest viewers first. `/monitor` shows only COUNTS per kind (with a name / without), never names, so you can see whether likes and comments carry names at all. Silent watchers look the same as people who left.

By hand: the control panel (`/panel`) has "clear the line" buttons (viewers who joined and fillers, or everybody waiting; gifting viewers, the customer being served and a ghost are kept in the first mode).

## Who becomes a customer: tapping the heart (or joining)

A viewer who taps the heart (a **like with a name**) becomes a customer who orders the free dessert (ข้าวต้มมัด) right away, so the line is made of people who are plainly still here. The adapter turns such a like into the like itself plus a `join` event marked `via: "like"` (at most one per name every 30 s, name and picture kept like a join); the line's own rules then apply (same name once a minute, not while already waiting, behind everyone already waiting; only gifts cut in).

`ORDER_ON` (environment variable of `npm run live` / `start-live.bat`) chooses who becomes a customer:

| value | who |
| --- | --- |
| `auto` (default) | likes with a name once one has arrived; until then real joins, so a source whose likes carry no names still works |
| `like` | only viewers who tap the heart |
| `join` | only viewers who come into the live (the old way) |
| `both` | both |

A like always counts as a heart (it speeds the cooking) whatever the mode. `/monitor` shows which way is in use. Whether TikFinity puts the viewer's name on its like messages is not confirmed against real data: `/monitor` shows "who is still here" counts (named / unnamed per kind) so you can see it.
