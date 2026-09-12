# native-assist-plugin

Registers the app as an `android.service.voice.VoiceInteractionService`, which is what
lets it appear under **Settings > Apps > Default apps > Digital assistant app** and be
invoked the way Siri is invoked (assist gesture / long-press).

## What's here

- `VoiceAssistService.kt` — marker service Android binds to.
- `VoiceAssistSessionService.kt` — creates a new session on each invocation.
- `VoiceAssistSession.kt` — the actual overlay UI: a `WebView` loading the same
  `www/index.html` (built from `angular-app`) that the regular launcher-icon app uses,
  so the listening-orb UI is shared between both entry points.
- `NativeAssistPlugin.kt` / `www/nativeassist.js` — lets the Angular app check
  `NativeAssist.isDefaultAssistant()` and prompt the user via
  `NativeAssist.openAssistantSettings()` if it isn't set yet.

## Things to verify once you can build & flash to the Nothing 4a

1. **Whether Nothing OS exposes the "Digital assistant app" setting at all** for
   third-party `VoiceInteractionService` apps. This is stock AOSP behavior and Nothing
   OS is close to stock, but OEM skins occasionally restrict or hide it — check
   Settings > Apps > Default apps on the device directly before investing further here.
2. **`android:recognitionService`** in `res/xml/voice_interaction_service.xml` currently
   points at Google's recognizer as a placeholder — the actual speech-to-text for the
   conversation itself happens through `cordova-plugin-speechrecognition` inside the
   WebView, not through this field, so this can likely be left as-is or removed; confirm
   once testing on-device.
3. **Permission prompts**: the very first time a user selects this app as their
   assistant, Android may show a system warning dialog about assistant apps having
   access to on-screen content — expected, not a bug.
4. **Fallback UX**: if the "set as default assistant" flow proves flaky or restricted on
   this device, the fallback from our design discussion — a floating bubble / launcher
   shortcut that opens the same Angular UI in a normal Activity — is a much simpler,
   guaranteed-to-work alternative and reuses all the same JS-side code.
