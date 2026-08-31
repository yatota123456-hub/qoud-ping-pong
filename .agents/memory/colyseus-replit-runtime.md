---
name: Colyseus Replit runtime
description: Non-obvious runtime constraints for keeping the Qoud multiplayer app working in this Replit workspace.
---

The workspace root wraps the actual Qoud repository in a nested directory. Replit workflows and publishing execute from the workspace root, so they must explicitly change into the nested app directory. The multiplayer server must serve both the built SPA and Colyseus WebSocket endpoint from one always-running VM process; Static publishing cannot support the game session.

**Why:** The initial Vite-only/static setup made the UI build successfully while leaving the Colyseus server unreachable, and package commands from the root attempted an unrelated dependency sync.

**How to apply:** Keep the root workflow and deployment commands pointed at the nested app's direct Vite/tsx binaries, and use the same port for the SPA, HTTP API, and WebSocket transport.