# Voice Agent — field-service voice assistant

A voice-first Android app for a utilities field-service software company. Field
workers tap an orb, speak a request ("give me my assignment list for today"), and an
on-device LLM figures out which tool to call — a local capability (current date/time,
photo description) or a tool on the company's MCP server — fetches the result, and
shows/speaks it back. No traditional screens beyond a login page.

**Start here:** [CONTEXT.md](CONTEXT.md) has the full project state — architecture,
what's built vs. still pending, and exactly what's needed to resume work. This file is
just a short pointer.

Other docs:
- [INSTALL.md](INSTALL.md) — from-scratch setup on a new computer + phone.
- [MODEL.md](MODEL.md) — on-device LLM/vision model choices and build gotchas.

## Stack

Cordova + Angular (not React Native, not native-only — a deliberate choice), with
custom Cordova plugins (Kotlin + C++/JNI) for on-device LLM inference (llama.cpp) and
photo description (SmolVLM2). Auth is Zitadel via OAuth2 Authorization Code + PKCE.
Backend integration is via MCP (Model Context Protocol) over its Streamable HTTP
transport, talking to an MCP server built with the Claude Agent SDK.

## Quick start (UI only, no Android tooling needed)

```bash
cd angular-app
npm start
```

Opens at `localhost:4200` in a normal browser. Tap the orb and speak — runs the full
plan → execute → phrase → speak pipeline against a mock LLM and mock tool responses.
Photo description and the real on-device LLM only work in the actual Android build
(see INSTALL.md).
