---
name: apps-script-deploy
description: Reconnect clasp to the Google account and push/deploy updates to the Apps Script backend in apps-script/. Use when the user asks to update the Google Apps Script code, redeploy the web app, or reconnect/re-login to Google/clasp — each session's container is ephemeral so clasp login does not persist between sessions.
---

# Apps Script deploy

This repo's backend lives in `apps-script/` — a clasp-managed Apps Script project
bound to a Google Sheet ("IT Portal DB", scriptId in `apps-script/.clasp.json`).
It's deployed as a Web App and called from `index.html` via `fetch()`.

The container this session runs in is ephemeral, so `clasp login` credentials
from a previous session are gone. Re-login is required once per session before
pushing or deploying.

## 1. Install clasp if missing

```bash
which clasp || npm install -g @google/clasp
```

## 2. Log in (interactive — needs the user)

Headless container, no local browser, so use the no-localhost flow:

```bash
clasp login --no-localhost
```

This prints a Google OAuth URL. Send it to the user and ask them to:
1. Open it, sign in with the Google account that owns the script
   (`itramilevystock@gmail.com` unless told otherwise), and authorize.
2. The browser will try to load `http://localhost:8888/?code=...` and fail to
   connect — that's expected. They copy the full URL from the address bar
   (it contains `code=...`) and send it back.

Once you have that URL, feed it to the waiting prompt in one shot (don't try
to type into the earlier interactive call — start a fresh one and pipe it in):

```bash
printf '%s\n' "<pasted-url>" | clasp login --no-localhost
```

Confirm success: it prints `You are logged in as <email>.`

Note: the pasted URL contains a one-time OAuth code — don't leave it sitting
in a saved/persisted file longer than necessary.

## 3. Edit code

Edit `apps-script/Code.gs` / `apps-script/appsscript.json` directly.

## 4. Push and deploy

```bash
cd apps-script
clasp push -f
clasp deploy --description "<what changed>"
```

`clasp push` updates the HEAD (editor) version. `clasp deploy` creates a new
numbered deployment/version — but it does **not** change the existing Web App
URL for `@1` etc. unless you deploy a NEW deployment (new URL) vs updating an
existing one's version:

- To ship changes under the **same URL** already hardcoded in `index.html`,
  use `clasp deployments` to find the existing deployment ID, then:
  `clasp deploy --deploymentId <id> --description "..."`.
- Only create a brand-new deployment (new URL) if you intentionally want a
  different endpoint — then update `API_URL` in `index.html` to match and
  tell the user the old URL is now stale.

## 5. First-run authorization for new scopes

If `Code.gs` starts using a new Google service (e.g. Gmail, Calendar) that it
didn't use before, the deploying user must manually authorize the new scope
once via the Apps Script editor before anonymous web app calls will work:

1. Open `https://script.google.com/d/<scriptId>/edit`
2. Pick any function that touches the new service from the function dropdown,
   click **Run**, go through **Review permissions → Advanced → Go to
   <project> (unsafe) → Allow**.

Skipping this step makes the web app return a generic Google "Access Denied"
HTML page instead of JSON for anonymous requests, even with
`access: ANYONE_ANONYMOUS` correctly set in the manifest.

## 6. Verify

Curl the deployed `/exec` URL (the `API_URL` constant in `index.html`) with
`-L` — Apps Script responds with a 302 to `script.googleusercontent.com`,
always follow it:

```bash
curl -sS -L "https://script.google.com/macros/s/<deploymentId>/exec"
```

A working response looks like `{"ok":true,"data":[...]}`. A Google-branded
"Access Denied" or "Page Not Found" HTML page means either the deployment
access isn't `ANYONE_ANONYMOUS` or step 5 (first-run authorization) hasn't
been done yet.
