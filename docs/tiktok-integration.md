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
{ "id": "unique-string", "type": "like|follow|orangeHeart|rose|gift|share", "count": 1, "tsMs": 1731400000000, "giftCoins": 500, "user": "optional" }
```

- `id`: unique per event (duplicates are dropped). `tsMs`: source time in ms since epoch; events older than the current dessert are ignored.
- `count`: batch size (likes 1–1000), otherwise 1. `giftCoins`: value of a gift; at or above `events.largeGiftCoins` (default 100) it completes the current step.
- Event types your provider cannot supply simply never arrive; the game does not depend on any of them.

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
