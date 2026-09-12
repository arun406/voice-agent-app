# Local LLM installation guide

How the on-device model actually gets built, installed, and swapped — written from
what was verified working on a real Nothing 4a (Snapdragon, arm64-v8a, Android 16),
not just the plan. If you're setting this up fresh or on a new device, follow this in
order.

## Current model

**Qwen3-0.6B-Instruct, Q4_K_M** quantization (~400MB), from
`unsloth/Qwen3-0.6B-GGUF` on Hugging Face. This is what's wired into
[LocalLLMPlugin.kt](src/android/LocalLLMPlugin.kt) right now.

This isn't the biggest or most "capable" option — it's what we landed on after
measuring the real tradeoff on-device:

| Model | Size | Prefill | Generation | Full turn (plan+phrase) |
|---|---|---|---|---|
| Qwen2.5-1.5B-Instruct Q4_K_M | ~1.1GB | ~68 tok/s | ~13 tok/s | ~4-5s |
| Qwen3-1.7B-Instruct Q4_K_M | ~1.1GB | ~24 tok/s | ~9 tok/s | ~15s |
| **Qwen3-0.6B-Instruct Q4_K_M (current)** | ~400MB | ~150+ tok/s | ~27 tok/s | ~2-3s |

Qwen3-1.7B has more recent training data than Qwen2.5, but is meaningfully slower on
this hardware — likely architectural (more/different attention heads), not something
build flags fix. Qwen3-0.6B keeps the newer training data at a size/speed closer to
Qwen2.5-1.5B. If you want to try a different point on this tradeoff, see
"Swapping models" below.

**Qwen3 quirk:** these models emit a chain-of-thought `<think>...</think>` block by
default, which would blow through the response token budget before ever producing an
answer. Two mitigations are already in place — don't remove them if you swap to
another Qwen3-family model:
- [llama_bridge.cpp](src/android/cpp/llama_bridge.cpp) appends a literal `/no_think`
  suffix to every prompt (Qwen3's documented way to request non-thinking mode).
- [local-llm.service.ts](../../angular-app/src/app/services/local-llm.service.ts)'s
  `chat()` strips any `<think>...</think>` tags from the output regardless, since
  `/no_think` empties the block's contents but doesn't remove the tags themselves.

## One-time build setup

You need the Android NDK to compile the native inference engine — this is a real C++
compile of llama.cpp, not just a Kotlin/Java build.

```bash
sdkmanager --install "ndk;26.1.10909125" "cmake;3.22.1"
```

Then add the plugin to the Cordova project:

```bash
cd cordova-app
cordova plugin add ../plugins-src/local-llm-plugin
```

**If you change anything under `plugins-src/local-llm-plugin/`** (the .kt files, the
.cpp file, or either `.gradle` file), Cordova won't pick it up on a plain rebuild —
plugin files are copied into `cordova-app/plugins/` at `plugin add` time, not
symlinked. Re-run:

```bash
cordova plugin remove com.nothing.voiceagent.localllm
cordova plugin add ../plugins-src/local-llm-plugin
```

before your next `cordova build android`.

### Gotchas already fixed in `lib/android/llama.gradle` — don't reintroduce these

These cost real debugging time; the fixes are already in the file, this is just so
you know why they're there if you're editing it:

1. **CMake path.** Installed plugins land at `cordova-app/plugins/<id>/`, which is
   three directory levels up from `app/build.gradle` — not four. A wrong path here
   fails with `cmake.path is ... but that file doesn't exist`.
2. **NDK version.** Without `ndkVersion` pinned explicitly, AGP silently downloads a
   *different* NDK version than whatever you already have installed (a redundant
   ~1.5GB download) instead of reusing it.
3. **`GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16`.** Without this, ggml's CPU backend
   falls back to a scalar (non-vectorized) path for the quantized matmul that
   dominates inference cost. This alone is roughly a 3x speedup on real hardware.
4. **`CMAKE_BUILD_TYPE=Release`.** This is the big one. AGP's external native build
   defaults to `Debug` (`-O0`, no vectorization or loop unrolling) for a debug APK
   variant, *regardless* of the `-march` flags above. Measured impact: prefill and
   generation were both stuck around ~1 token/sec (indistinguishable speeds — the
   real signature of this bug, since prefill should normally be 10-50x faster than
   generation) until this was set, after which prefill jumped to ~70 tok/s. A
   multi-minute response time came entirely from this one missing flag.

If local LLM responses are ever inexplicably slow again, check `CMAKE_BUILD_TYPE`
first — a `rm -rf cordova-app/platforms/android/app/.cxx` and rebuild will confirm
whether it's still being applied.

## Getting a model onto the device (current method: manual, for development)

The production plan (download-on-first-launch, described further down) isn't
implemented yet. Right now, models are pushed by hand over USB:

```bash
# 1. Download the GGUF (adjust filename/repo for whichever model you're using)
curl -L -o models/qwen3-0.6b-instruct-q4_k_m.gguf \
  "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf"

# 2. Push to device staging (app-private storage isn't directly adb-push-able)
adb push models/qwen3-0.6b-instruct-q4_k_m.gguf /data/local/tmp/model.gguf

# 3. Copy into the app's private files dir (works on a debuggable build via run-as)
adb shell "cat /data/local/tmp/model.gguf | run-as com.nothing.voiceagent sh -c 'cat > files/qwen3-0.6b-instruct-q4_k_m.gguf'"

# 4. Clean up the staging copy
adb shell rm -f /data/local/tmp/model.gguf
```

The filename must exactly match what [LocalLLMPlugin.kt](src/android/LocalLLMPlugin.kt)'s
`ensureModelLoaded()` requests via `loadModel(...)`.

**Uninstalling the app wipes its private `files/` directory — the model included.**
If you `adb uninstall` for a clean install, re-push the model afterward; `adb install
-r` (upgrade in place) preserves it.

## Swapping models

1. Find the exact GGUF filename on Hugging Face — quantization naming isn't always
   consistent. Check the repo's file list first rather than guessing:
   ```bash
   curl -s "https://huggingface.co/api/models/<org>/<repo>" | python3 -c \
     "import json,sys; [print(f['rfilename']) for f in json.load(sys.stdin)['siblings']]"
   ```
   Official model-org repos sometimes only publish one quantization (e.g. Q8_0) —
   community requantizations from `unsloth` or `bartowski` usually have the full
   range including Q4_K_M.
2. Download it, push it to the device (steps above).
3. Update the filename in `ensureModelLoaded()` in
   [LocalLLMPlugin.kt](src/android/LocalLLMPlugin.kt).
4. If switching model *families* (not just size), check whether it needs the same
   `/no_think`-style handling Qwen3 does — read the model card for chat-template
   quirks before assuming it'll behave like whatever was there before.
5. Re-add the plugin and rebuild (see "One-time build setup" above — this step is
   easy to forget after editing a .kt file).

## Model selection guidance

Stick to **3B parameters or under, Q4_K_M quantization** for anything meant to feel
responsive on a phone CPU — this app's job (pick a tool from a short list, phrase one
short sentence) doesn't need a bigger model, and bigger costs real seconds per turn.
Confirm the actual speed on your target device before committing; the table above
shows how much this varies even between similarly-sized models.

## Photo description (vision model)

**SmolVLM2-2.2B-Instruct, Q4_K_M** (base model + a separate mmproj/vision-encoder
GGUF), from `ggml-org/SmolVLM2-2.2B-Instruct-GGUF`. Wired into
[LocalLLMPlugin.kt](src/android/LocalLLMPlugin.kt)'s `ensureVisionModelLoaded()`, used
by the "Take photo"/"Choose photo" buttons. Stepped up from SmolVLM-500M after it
badly misidentified a test photo (a coffee mug called a "tree or person") — same
size-vs-accuracy tradeoff as the text model.

**Bug already fixed — image path query string.** `cordova-plugin-camera`'s
`getPicture()` callback can return a `file://` URI with a cache-busting query string
appended (e.g. `.../cache/55.jpg?1789195067374`). Passing that straight to the native
side fails to open the file (`fopen` doesn't understand `?...`), which surfaced as the
model silently returning an empty description (no error shown in the UI — just no
answer card and back to idle) rather than an obvious crash. Fixed in
[photo.service.ts](../../angular-app/src/app/services/photo.service.ts) by stripping
everything from `?` onward, not just the `file://` prefix. If a future Cordova/camera
plugin update changes the URI shape again, check for this class of bug first if photo
description silently produces nothing.

**Speed: tile count dominates cost, not text generation.** SmolVLM2's preprocessor
(`idefics3`-style) splits any decently-sized photo into a grid of 384x384 tiles plus
one overview tile, and runs the full vision encoder on *each tile separately* — on
this hardware, ~9-10s per tile. A 1024x1024 input was observed splitting into a 3x2
grid (6 tiles) + 1 overview = 7 full encoder passes, ~75s of vision encoding alone
before the LLM even starts generating text (~10-12s for the actual answer). This is
the real cost of "photo description," not model inference speed.

Fixed by capping the tiling via the (public, non-vendored) `mtmd_context_params`
struct in [llama_bridge.cpp](src/android/cpp/llama_bridge.cpp)'s `loadVisionModel()`:
```cpp
mparams.image_max_tokens = 100; // ~one tile's worth — forces a single-tile pass
```
This caps the preprocessor's pixel budget low enough that it resizes to fit in one
tile instead of tiling a grid, cutting a 7-tile run down to 2 (overview + 1 tile) and
total photo-description time from ~90s to ~30s. Trade-off: less fine-grained detail
(the model sees one lower-resolution pass instead of several full-resolution crops) —
in testing this still correctly identified the subject, objects, and setting, just
with slightly less specific phrasing. Raise `image_max_tokens` (or remove the line to
restore default behavior) if description quality matters more than speed for your use
case; there's no single right answer here, only where you want that dial set.

## Known open issue: tool-routing accuracy

Smaller models are noticeably less reliable at picking the *correct* tool from
`tools.config.ts` — observed misrouting a general-knowledge question ("what's the
capital of Germany") to `getCurrentDateTime`. This gets worse as the model shrinks.
If this matters more than raw speed for your use case, weigh that against the
numbers above when choosing a model size — trading some speed for a slightly larger
model may reduce misrouting, though this hasn't been systematically measured here.
