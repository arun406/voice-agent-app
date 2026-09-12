# local-llm-plugin

Cordova plugin that runs a small quantized LLM on-device via llama.cpp, exposed to the
Angular app as `window.LocalLLM.chat(prompt)`.

## What's here vs. what's still unverified

- ✅ `www/localllm.js` — JS bridge (matches what `local-llm.service.ts` expects).
- ✅ `src/android/LocalLLMPlugin.kt` — Cordova plugin action routing (`chat`, `loadModel`).
- ✅ `src/android/LlamaBridge.kt` — Kotlin JNI declarations.
- ✅ `src/android/cpp/llama_bridge.cpp` — JNI implementation written against the real
  current llama.cpp C API (see the header comment for exactly which calls it uses):
  loads a model, applies the model's own chat template, tokenizes, decodes one token
  at a time with a low-temperature sampler, detokenizes, returns the string.
- ✅ `src/android/cpp/llama.cpp/` — vendored via a shallow `git clone` (not a git
  submodule, since this repo isn't a git repo yet — see root README if you want to
  convert it to one).
- ✅ `src/android/cpp/CMakeLists.txt` — builds llama.cpp's targets and links
  `llama_bridge.cpp` against them.
- ⚠️ `lib/android/llama.gradle` — wires the CMake project into the generated Android
  Gradle project via Cordova's `gradleReference` framework type. **Written before this
  machine had the NDK installed, so the relative path from the app module to the
  plugin's CMakeLists.txt is an educated guess, not verified.** First thing to check
  once you can run a real build — see the comment at the top of that file.
- ❌ **None of this has been compiled yet.** No Android NDK was installed on this
  machine when it was written; get the NDK in place (`sdkmanager --install
  "ndk;<version>"`), then run `cordova platform add android` from `cordova-app/` and
  try a build — expect to iterate on `llama.gradle`'s path and possibly `CMakeLists.txt`
  once real compiler errors show what's actually wrong.
- ❌ A bundled **GGUF model file** — too large to ship in the app; see `MODEL.md` in
  this folder for the download-on-first-run approach.

## Suggested next steps once you can attempt a build

1. `cordova platform add android` from `cordova-app/`, then try a build immediately —
   expect it to fail on the `llama.gradle` path first; fix that using the real
   generated project structure as a guide.
2. Once it compiles, get a standalone CLI sanity check working too (llama.cpp's own
   `llama-cli` binary, pushed via `adb shell`) to confirm your chosen model +
   quantization performs acceptably on the Nothing 4a's CPU *before* debugging the JNI
   path — this isolates "wrong model" from "bridge bug" if responses look off.
3. `runInference()` in `llama_bridge.cpp` currently samples with temperature 0.3 for
   determinism (JSON tool-calls need to be predictable) — raise it if the phrasing step
   reads too flatly once you're listening to real output.
