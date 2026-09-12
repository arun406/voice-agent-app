# Project context — read this first

This is the single "pick up where we left off" document for this project. It's meant
to let you (or a fresh Claude session) resume work on a different machine without
replaying the whole history. For narrower how-to docs, see:

- [INSTALL.md](INSTALL.md) — from-scratch setup on a brand new computer + phone.
- [MODEL.md](MODEL.md) — the on-device LLM/vision model choices, build gotchas, and
  the exact bugs that were hit and fixed getting them working.
- [README.md](README.md) — short project overview.

---

## What this is

A voice-first Android field-service app for a utilities software company. The company
already has a backend API and an MCP server (TypeScript, built with the Claude Agent
SDK) that wraps it. This app is the mobile front end for utility field workers —
damage assessment, survey/inspection, restoration, switching, and similar tasks — with
no traditional screens: users tap an orb, speak a request ("give me my assignment list
for today"), and an on-device LLM figures out which backend/MCP tool to call, fetches
the data, and shows/speaks the result.

**Dev/test device note:** development and on-device testing so far has happened on a
Nothing 4a that is the *developer's child's* day-to-day phone (Google Family Link
managed, parent is building this) — that's just the hardware available for testing,
not the intended production device. Production users are the utility company's field
technicians on their own company-managed phones.

**This is a hybrid Cordova + Angular app**, not React Native or native-only — that
stack was an explicit, deliberate choice early on, not a default. Native capability
gaps are filled with custom Cordova plugins (Kotlin + C++/JNI), not a framework switch.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ cordova-app (Android WebView) running angular-app                   │
│  - orb UI: tap to speak, listening/thinking/speaking states         │
│  - response card(s): flat key/value, or a scrollable list of cards  │
│    for array-shaped results (e.g. an assignment list), each with an │
│    optional "Get directions" button if it carries a lat/lng         │
│  - Take photo / Choose photo buttons (vision feature)               │
└───────┬───────────────┬───────────────┬───────────────┬─────────────┘
        ▼               ▼               ▼               ▼
 ┌─────────────┐ ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐
 │ Speech STT/ │ │ local-llm-  │ │ AuthService   │ │ MapsService     │
 │ TTS (cordova│ │ plugin      │ │ (Zitadel OIDC │ │ (InAppBrowser → │
 │ plugins)    │ │ (llama.cpp  │ │ Auth Code +   │ │ Google Maps app)│
 │             │ │ JNI, on-    │ │ PKCE)         │ │                 │
 │             │ │ device)     │ │               │ │                 │
 └─────────────┘ └──────┬──────┘ └───────┬───────┘ └─────────────────┘
                        │                │
                        ▼                ▼
                 planToolCall()   Bearer token attached to:
                 picks a tool          │
                 from the merged       ▼
                 local + MCP    ┌─────────────────────────────┐
                 tool list      │ McpService (MCP Streamable   │
                        │       │ HTTP client: initialize →    │
                        └──────►│ tools/list → tools/call)      │
                                └───────────────┬───────────────┘
                                                ▼
                                  Your MCP server (TypeScript,
                                  Claude Agent SDK) → your backend API
                                  — currently on your office laptop,
                                  plan is to deploy to AWS
```

Voice turn flow (`assistant-orchestrator.service.ts`):
1. Tap orb → `SpeechService.listen()` (Web Speech API via `cordova-plugin-speechrecognition`).
2. If the transcript mentions "photo/picture/image", route deterministically to the
   vision pipeline instead of the LLM router (the small text model was unreliable at
   recognizing "no tool matches" for anything photo-related — see MODEL.md).
3. Otherwise: fetch/cache the MCP server's tool list (`tools/list`), merge with the
   local tools in `tools.config.ts` (e.g. `getCurrentDateTime`, answered on-device
   since a backend can't know "now" any better than the phone can), and ask the
   on-device LLM (`local-llm.service.ts#planToolCall`) to pick one + extract args.
4. Execute: local tools run in-process; MCP tools go through `McpService.callTool()`;
   anything else falls back to a plain REST call using `tools.config.ts`'s
   `method`/`urlTemplate` (mostly kept for browser-preview testing without a live
   MCP server).
5. LLM phrases a short spoken answer from the result; result is also rendered in the
   UI — as flat rows for a single record, or a scrollable card list for an array
   (each card gets a "Get directions" button if it has a lat/lng anywhere in it).
6. Answer is spoken via `cordova-plugin-tts`.

---

## Status — what's done vs. what's still needed

### Done and verified on-device (Nothing 4a)
- Full voice pipeline: listen → plan → execute → phrase → speak, ~2-3s/turn with
  Qwen3-0.6B-Instruct (see MODEL.md for why this model, and the 4 build-flag gotchas
  that made it fast instead of ~1 token/sec).
- General-knowledge fallback when no tool matches (`answerGenerally`).
- Photo description: SmolVLM2-2.2B-Instruct via a second on-device vision model.
  Verified against a real test photo (correctly described a coffee mug on a laptop).
  Two real bugs were found and fixed here — a stray query-string on the image file
  path breaking native file loading, and a missing chat-template application producing
  empty output — both documented in MODEL.md along with a 3x speed optimization
  (capping SmolVLM2's image tiling via `mtmd_context_params.image_max_tokens`).
- Branding: custom icon, transparent splash (no duplicate orb between splash and app),
  green accent color, edge-to-edge display with no white-border artifacts.
- `getCurrentDateTime` local tool (deterministic, not hallucinated by the LLM).

### Built this session, NOT yet tested against real infrastructure
Everything below type-checks and the app still launches/runs normally on-device (auth
gate correctly stays inactive while its config is a placeholder — see "How the
placeholders work" below) — but none of it has been exercised against a real MCP
server or real Zitadel tenant yet, because neither exists at a reachable URL yet.

- **`angular-app/src/app/services/mcp.service.ts`** — generic MCP client over the
  "Streamable HTTP" transport (JSON-RPC 2.0 over a single POST endpoint): does the
  `initialize` handshake, negotiates protocol version, tracks the `Mcp-Session-Id`
  header, exposes `listTools()` and `callTool(name, args)`. This is what should work
  as-is against an MCP server built with `@modelcontextprotocol/sdk`'s
  `StreamableHTTPServerTransport` (which the Claude Agent SDK uses under the hood) —
  but it has never been pointed at a real server, so treat the handshake/header
  details as "written to spec, not yet proven."
- **`angular-app/src/app/config/mcp.config.ts`** — `MCP_SERVER_URL` placeholder.
- **`angular-app/src/app/services/auth.service.ts`** — Zitadel OIDC Authorization
  Code + PKCE flow: opens the login page in an in-app browser tab
  (`cordova-plugin-inappbrowser`), intercepts the redirect URI before the WebView
  tries to actually navigate to it, exchanges the code for tokens, refreshes on
  expiry. **Tokens are stored in plain `localStorage`** — fine for development, but
  flagged in the code as something to swap for a secure-storage Cordova plugin before
  any real field rollout (a rooted device or another app with storage access could
  read them there).
- **`angular-app/src/app/config/auth.config.ts`** — `ZITADEL_ISSUER`,
  `ZITADEL_CLIENT_ID`, `ZITADEL_REDIRECT_URI`, `ZITADEL_SCOPES` placeholders.
- **`angular-app/src/app/app.component.ts/.html/.css`** — the one deliberate
  exception to "no screens": a login gate, active only once `ZITADEL_ISSUER` is a
  real value (see below).
- **`angular-app/src/app/services/maps.service.ts`** +
  **`angular-app/src/app/utils/extract-location.ts`** — "Get directions" hands off to
  the Google Maps app via `cordova-plugin-inappbrowser`'s `_system` target. Looks for
  `latitude`/`longitude`, `lat`/`lng`, or `lat`/`lon` at the top level or nested under
  a `location`/`coordinates`/`gis`/`gisLocation`/`position` key — **field names are a
  guess** until real MCP tool output is seen; adjust `extract-location.ts` once you
  know the real shape (e.g. what a "pole location" or "feeder location" field is
  actually called in your backend's responses).
- **UI list rendering** (`assistant.component.ts/.html/.css`) — array-shaped tool
  results (the "assignment list" case) render as a scrollable list of cards instead of
  flat key/value rows.

### How the placeholders work (important — don't remove this pattern)
Both `MCP_SERVER_URL` and `ZITADEL_ISSUER` start as obvious placeholder strings
(`your-mcp-server.example.com`, `your-instance.zitadel.cloud`). Code that depends on
them checks for that placeholder and no-ops instead of breaking:
- `assistant-orchestrator.service.ts#ensureMcpToolsLoaded` skips fetching MCP tools
  entirely while the URL is a placeholder, so voice/photo/general-chat keep working.
- `app.component.ts`'s `authRequired` is `false` while the issuer is a placeholder, so
  the login screen doesn't appear and block everything else.

This means **the moment you fill in real values, that feature switches on** — there's
no separate feature flag to flip. Good for not forgetting to enable something; also
means if you paste in a real-looking-but-wrong URL, it'll actually try to use it and
fail loudly instead of silently no-op'ing, which is useful for noticing typos.

### Explicitly not done / open questions
1. **MCP server isn't deployed anywhere reachable yet.** It currently only exists on
   the office laptop. Plan (per the developer) is to deploy it to AWS. Once it has a
   URL, put it in `mcp.config.ts`.
2. **Zitadel app registration.** Confirm a **Native** app type exists in Zitadel
   (PKCE, no client secret) and get: issuer URL, client ID, and the scope/audience
   your backend/MCP API actually requires (Zitadel projects typically need their API
   audience requested explicitly, not just `openid profile email`). The redirect URI
   defaults to `com.nothing.voiceagent://callback` in `auth.config.ts` — register that
   exact value in Zitadel, or change both places to match if you'd rather use
   something else.
3. **Real MCP tool result shape is unknown.** `mcp.service.ts#extractContent` assumes
   a tool returns its data as a single JSON-serialized text content block (the common
   MCP convention) — confirm this once you can actually call a real tool, and adjust
   if your server does something else (e.g. multiple content blocks, or a resource
   reference instead of inline text).
4. **GIS field names are guessed** (see `extract-location.ts` above) — needs real data
   to confirm/adjust.
5. **Token storage is not secure-storage-grade.** Explicitly noted as a
   before-production TODO in `auth.service.ts`.
6. **`native-assist-plugin`** (`plugins-src/native-assist-plugin/`) — scaffolded very
   early (Kotlin `VoiceInteractionService`/`VoiceInteractionSessionService` to register
   this app as the system's long-press Assist app, Siri-style) but **never actually
   added to `cordova-app`** (not in `config.xml` or `package.json`'s plugin list) and
   not wired into the current app at all. Current invocation is tap-the-orb only. This
   is dead/unused code right now — either finish wiring it in, or delete it, but don't
   assume it does anything today.
7. **Known LLM tool-routing limitation** (pre-existing, documented in MODEL.md): the
   0.6B on-device model is noticeably unreliable picking the *correct* tool once there
   are more than a few candidates, or when a query is ambiguous. Adding a full MCP
   tool set (assignments, damage assessment, survey, inspection, restoration,
   switching, ...) will likely make this worse, not better — the same problem that was
   partially mitigated for photo-related queries via deterministic keyword
   pre-filtering (see `assistant-orchestrator.service.ts`) may need to be extended to
   other high-frequency intents once real usage shows where the model actually
   misroutes.

---

## Repo layout

```
voice-agent-app/
├── CONTEXT.md              ← this file
├── INSTALL.md              ← from-scratch setup guide
├── MODEL.md                ← LLM/vision model choices, build gotchas, bugs fixed
├── README.md                ← short overview
├── package.json             ← root build scripts (npm run build = ng build + sync to cordova www)
├── scripts/sync-www.sh      ← copies angular-app/dist into cordova-app/www
├── angular-app/              ← the UI, buildable/testable in a plain browser
│   └── src/app/
│       ├── assistant/                    orb UI component
│       ├── config/
│       │   ├── auth.config.ts             Zitadel placeholders
│       │   ├── mcp.config.ts              MCP server URL placeholder
│       │   └── tools.config.ts            local tools + legacy REST-backend placeholder
│       ├── models/assistant.models.ts     shared types
│       ├── services/
│       │   ├── assistant-orchestrator.service.ts   drives one voice turn
│       │   ├── auth.service.ts                     Zitadel OIDC PKCE login
│       │   ├── local-llm.service.ts                bridge to on-device LLM
│       │   ├── maps.service.ts                     Google Maps handoff
│       │   ├── mcp.service.ts                      MCP Streamable HTTP client
│       │   ├── photo.service.ts                    camera/gallery capture
│       │   ├── speech.service.ts                   STT/TTS
│       │   └── tool-executor.service.ts            dispatches a planned tool call
│       └── utils/extract-location.ts      best-effort lat/lng field detection
├── cordova-app/               ← the actual installable Android project
│   ├── config.xml             permissions, icons, splash, edge-to-edge prefs
│   ├── hooks/fix-background-color.js
│   ├── www/                   ← BUILD OUTPUT, gitignored, regenerated by npm run build
│   ├── platforms/             ← gitignored, regenerated by `cordova platform add android`
│   └── plugins/                ← gitignored, regenerated by `cordova plugin add ...`
├── plugins-src/
│   ├── local-llm-plugin/       llama.cpp JNI bridge — see MODEL.md
│   │   └── src/android/cpp/llama.cpp/   ← vendored checkout, gitignored (not a submodule)
│   └── native-assist-plugin/   scaffolded, NOT wired in — see open question #6 above
└── models/                     ← GGUF weights (gitignored) + a few small icon/design assets (kept)
```

---

## Resuming on a new machine

1. Follow [INSTALL.md](INSTALL.md) Parts 1–3 for tool installation and project setup
   (Node/JDK/Android SDK+NDK, `npm install`, `cordova platform add android`, plugin
   adds). The `.devtools/bin/npm` wrapper script mentioned there was a workaround for
   a broken global npm install on the *previous* dev Mac specifically — not needed if
   npm already works normally on the office laptop; it's gitignored, so it won't even
   be present after the transfer.
2. Pull the GGUF model files per [MODEL.md](MODEL.md)'s "Getting a model onto the
   device" section — they're gitignored (multi-GB, don't belong in git) so they won't
   come across with the repo.
3. Fill in the placeholders once you have real values:
   `angular-app/src/app/config/mcp.config.ts` and
   `angular-app/src/app/config/auth.config.ts`.
4. Build: `npm run build` (repo root) → `cordova build android` (in `cordova-app/`) →
   `adb install -r platforms/android/app/build/outputs/apk/debug/app-debug.apk`.
5. If you're driving a real-device test the way this session's testing worked
   (screenshots via `adb exec-out screencap -p`, taps via
   `adb shell input tap <x> <y>`): screenshots come back at the phone's native
   resolution, but if you're eyeballing coordinates from an image that's been
   downscaled for display somewhere, remember to scale up — this tripped up testing
   more than once this session (a tap landed 700px off because of exactly this).
