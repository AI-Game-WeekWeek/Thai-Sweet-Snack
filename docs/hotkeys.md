# Shortcut keys: connecting viewer actions to the game by key presses

Idea: a tool on your own PC (for example TikFinity, if it has a "press a key" action) presses a key whenever a viewer
does something, and the game reacts exactly as if that event had arrived. No bridge needed.

Open the game with **`?keys=live`** (no help panel and no pop-ups on screen) or **`?keys=1`** (with the panel; press `?`).

| Viewer does | Key | What happens in the game |
|---|---|---|
| Gift worth 1 coin | `1` | customer orders ข้าวต้มมัด |
| Gift worth 5 | `2` | บัวลอย |
| Gift worth 10 | `3` | ทองหยอด |
| Gift worth 20 | `4` | ขนมชั้น |
| Gift worth 50 | `5` | ฝอยทอง |
| Gift worth 99 | `6` | ทองหยิบ |
| Gift worth 199 | `7` | ลูกชุบ |
| Gift worth 500 | `8` | ขนมเบื้อง |
| Rose | `R` | rose effect |
| Like (one tap) | `I` | +1 like (heart meter) |
| 30 likes at once | `L` | |
| 400 likes at once | `K` | |
| Follow | `F` | lucky cat + meow |
| Orange heart / fan club | `O` | VIP customer + tip rain |
| Share | `S` | +1 shaman visit (max 5) and score bonus |

Other keys (for testing, you probably do not want them on a viewer action): `P` phone/ghost, `Q W E T Y` the five ghost kinds,
`Z` squeeze now, `X` shaman, `C` finish the dessert, `B` backdrop, `V` voices, `J` reward sound, `G` ghost sound, `M` mute.

## Things that matter

- **A key press goes only to the window that has focus.** The game window (a normal browser window) must be the active
  window whenever a key is pressed. If you click another program, the keys go there instead and are lost.
  If you capture the game in TikTok LIVE Studio as a *Link* source (a hidden browser), it never receives key presses:
  capture the browser window instead (window capture), or use the bridge (no focus needed, see `docs/tiktok-integration.md`).
- Works with a Thai keyboard layout (the physical key is matched) and with the number pad.
- Combinations with Ctrl, Alt or the Windows/Command key are ignored; a held-down key is ignored (one press = one event).
- A gift "streak" sent as many key presses makes many customers. The bridge route merges a streak into one customer.
- Likes pressed as `I` once per like can be very frequent: that is fine, the game caps and merges them.
- Treat the keys as trusted input: anyone who can press keys on your PC can trigger them.
