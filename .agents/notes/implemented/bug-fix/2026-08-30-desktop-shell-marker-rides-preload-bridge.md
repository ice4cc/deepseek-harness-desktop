# Agent Note: Desktop shell marker rides the preload bridge, not the URL

Status: implemented

English | [中文](2026-08-30-desktop-shell-marker-rides-preload-bridge.zh.md)

## Problem

In the desktop app the window's top strip stopped moving the window: with a session open the 44 px band above the session header, the blank-draft hero sheet, and the sidebar brand row were all inert. The drag-region CSS was intact — the page simply never received its desktop marker.

The upstream [browser launch-token authentication](../architecture/2026-08-24-browser-token-authentication.md) exchange turned the loaded URL into a one-shot credential: `GET /?token=...` mints the session cookie and 303-redirects to clean `/`, stripping every query parameter. The [desktop shell](../architecture/2026-08-16-desktop-shell-mode-a.md) appended `?shell=desktop&os=<platform>` to that same URL, so the marker died in the redirect and `<html>` never got `data-shell="desktop"` — with no marker, `.dragBand` stays `display: none`, the sidebar brand row is not a drag region, and the traffic-light clearance rules do not apply. Plain browser loads were unaffected only while their session cookie was already minted (no redirect to strip the params).

## Decision

The marker rides the sandboxed preload bridge. `apps/desktop/src/preload.cjs` exposes `window.dshDesktop.shell` (`'desktop'`) and `.os` (Electron main's `process.platform`) beside the existing `setThemeColors`; the bridge's presence alone is the marker. `apps/web/src/main.ts` reads the bridge first and tags `<html data-shell="desktop" data-os="<platform>">` from it; a plain browser load with `?shell=desktop&os=<platform>` still previews the desktop layout while its session cookie is already set (no redirect in that case). `createWindow` loads the readiness URL verbatim — it no longer appends query parameters.

## Verification

Headless Chromium against a booted `dsh web`: before the fix, `/?token=...&shell=desktop&os=darwin` redirected to clean `/` with an empty `<html>` dataset and zero elements computed as `-webkit-app-region: drag`; after the fix, the bridge path sets `data-shell="desktop" data-os="darwin"` with the drag regions live, the query fallback still tags the page, and a plain load keeps the stock layout. The new keyless e2e spec `apps/web/tests/desktop-shell-marker.e2e.ts` pins both sides through the real composition: an injected bridge survives the token redirect and tags `<html>`, and no bridge means no marker. Actual window dragging remains Electron-only (`-webkit-app-region` is inert in plain Chromium); the user-visible defect was reproduced and cleared on the desktop app itself.

## Alternatives considered

**Forward `shell`/`os` through the 303 Location.** Rejected — it edits upstream-owned `browser-auth.ts` against its documented "redirects to clean `/"` contract, re-conflicts at every mainline sync, and keeps a UI hint riding on a credential URL for the one request that carries the token.

**Have the server remember marker params per cookie.** Rejected — it turns an authentication redirect into session state with no consumer beyond this one marker.

**Keep appending the query parameters as a fallback.** Rejected — after the first load they are dead weight: the exchange always strips them, and a second source of truth for one fact invites drift. The plain-browser preview path already covers manual `?shell=desktop` loads.

## Consequences

This partially supersedes the desktop shell note's URL-marker mechanism ("the shell appends `?shell=desktop&os=<platform>` to the loaded URL"); everything else in that note — the drag-strip geometry, the yield flags, the zero-width collapsed sidebar — is unchanged. `window.dshDesktop` gains two read-only properties beside `setThemeColors`; both are listed in `apps/desktop/README.md`'s upstream-sync table. The marker no longer travels with the launch token, so a copied startup URL carries one less parameter that outlives nothing.
