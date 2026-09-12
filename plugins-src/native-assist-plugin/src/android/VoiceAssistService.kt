package com.nothing.voiceagent.assist

import android.service.voice.VoiceInteractionService

/**
 * Registered in the manifest (see plugin.xml) as the handler for
 * `android.service.voice.VoiceInteractionService`. Once the user picks this app under
 * Settings > Apps > Default apps > Digital assistant app, a long-press of the
 * home/side button (or the assist gesture) starts a session via
 * VoiceAssistSessionService -> VoiceAssistSession.
 *
 * This class itself needs no logic — Android only requires it to exist so the
 * <service> in the manifest has something to bind to.
 */
class VoiceAssistService : VoiceInteractionService()
