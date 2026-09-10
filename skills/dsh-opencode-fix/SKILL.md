---
name: dsh-opencode-fix
description: 修复 DeepSeek Harness / DSH 使用 OpenCode 或 OpenCode Go 时的 400 MissingSessionID、x-opencode-session 缺失、dsh-opencode-session 插件无效等问题；适用于 DSH Desktop、dsh web、provider 为 opencode / opencode-go 的场景。
---

# DSH OpenCode Session Header Fix

## Purpose

Starting 2026-09-05, OpenCode Go requires every inference request to carry a
stable per-conversation `x-opencode-session` header. Some DSH versions execute
LLM calls in a session worker, so host-side plugins that patch
`globalThis.fetch` do not intercept the actual request. This skill fixes the
real `@deepseek-ai/dsh-llm-pi-ai` adapter.

Use this skill when:

- DSH reports `400 MissingSessionID`.
- The provider error mentions `Console Go` or missing `x-opencode-session`.
- Models include `opencode`, `opencode-go`, or display names such as
  `go/glm-5.3-flash`.
- A DSH restart or the community `dsh-opencode-session` plugin did not fix it.

## Safety

- Do not edit the app until the current error is confirmed to be
  `MissingSessionID`.
- Always back up the original `app.asar`.
- Keep the backup under `~/.dsh/backups/`.
- Do not leave a static `x-opencode-session` header in `~/.dsh/settings.yaml`;
  it destroys per-conversation cache affinity and makes all sessions share one ID.

## Diagnosis

Run these checks first:

```sh
dsh --version
rg -n 'MissingSessionID|x-opencode-session' \
  "$HOME/Library/Application Support/DSH Desktop/logs/host" \
  ~/.local/lib/dsh-cli/node_modules/@deepseek-ai \
  2>/dev/null | tail -80
```

Confirm the affected provider in `~/.dsh/settings.yaml`:

```sh
python3 - <<'PY'
import yaml
p = yaml.safe_load(open('/Users/admin/.dsh/settings.yaml'))
for name, provider in p['llm-pi-ai']['providers'].items():
    if name in ('opencode', 'opencode-go'):
        print(name, provider)
PY
```

Check whether an old fix is already present:

```sh
rg -n 'x-opencode-session' \
  ~/.local/lib/dsh-cli/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
```

## Fix CLI Runtime

Edit:

```text
~/.local/lib/dsh-cli/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
```

Find this call in `PiAiAdapter.streamWithSnapshot`:

```js
const iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {
  ...
  headers: requestHeaders(profile.headers)
}), ...)
```

Replace the header construction with:

```js
const headers = requestHeaders(profile.headers)
if (options.provider === "opencode" || options.provider === "opencode-go") {
  headers["x-opencode-session"] = options.sessionId === undefined
    ? globalThis.crypto.randomUUID()
    : String(options.sessionId)
}
const iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {
  ...
  headers
}), ...)
```

Then validate:

```sh
node --check \
  ~/.local/lib/dsh-cli/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
```

Test with an isolated server before touching Desktop:

```sh
dsh web --no-open --port 3081
```

Send a tiny message in that UI using an OpenCode Go model. A successful reply
proves the adapter fix works.

## Fix DSH Desktop

DSH Desktop runs its own copy inside `app.asar`, so patching the CLI alone is
not enough.

### 1. Quit and back up

```sh
osascript -e 'quit app "DSH Desktop"'
mkdir -p ~/.dsh/backups
cp '/Applications/DSH Desktop.app/Contents/Resources/app.asar' \
  ~/.dsh/backups/DSH-Desktop-$(plutil -extract CFBundleShortVersionString raw '/Applications/DSH Desktop.app/Contents/Info.plist')-app.asar
```

### 2. Extract and patch

```sh
DEST=/tmp/dsh-desktop-asar-patch
npx --yes asar extract \
  '/Applications/DSH Desktop.app/Contents/Resources/app.asar' "$DEST"
```

Apply exactly the same adapter patch to:

```text
$DEST/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
```

Then check syntax:

```sh
node --check "$DEST/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js"
```

### 3. Repack

```sh
NEW=/tmp/dsh-desktop-asar-patch.new
npx --yes asar pack --unpack '*.node' "$DEST" "$NEW"
```

Verify the patched file exists inside the new archive:

```sh
mkdir -p /tmp/dsh-desktop-patched-check
cd /tmp/dsh-desktop-patched-check
npx --yes asar extract-file "$NEW" \
  node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
rg -n 'x-opencode-session' index.js
node --check index.js
```

### 4. Update Electron ASAR integrity

Electron verifies the ASAR header hash, not the whole-file hash.

Compute the new header hash:

```sh
node - <<'JS'
const asar = require(require('path').join(
  process.env.HOME,
  '.npm/_npx/8b3f11f22d4db0c9/node_modules/asar/lib/asar.js'
))
const file = '/tmp/dsh-desktop-asar-patch.new'
const raw = asar.getRawHeader(file)
require('crypto').createHash('sha256')
  .update(Buffer.from(raw.headerString, 'utf8'))
  .digest('hex')
JS
```

Write that value into `Info.plist`:

```sh
/usr/libexec/PlistBuddy -c \
  'Set :ElectronAsarIntegrity:Resources/app.asar:hash <NEW_HASH>' \
  '/Applications/DSH Desktop.app/Contents/Info.plist'
```

### 5. Replace, sign, and start

```sh
NEW=/tmp/dsh-desktop-asar-patch.new
APP_ASAR='/Applications/DSH Desktop.app/Contents/Resources/app.asar'
mv "$NEW" "$APP_ASAR"
codesign --force --deep --sign - '/Applications/DSH Desktop.app'
codesign --verify --deep --strict '/Applications/DSH Desktop.app'
open -a 'DSH Desktop'
```

Confirm the process stays alive:

```sh
sleep 8
pgrep -f '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop'
```

If it crashes, read the newest report under `~/Library/Logs/DiagnosticReports/`.
An ASAR integrity mismatch usually appears immediately as an early startup trap.

## Clean Up Ineffective Workarounds

If `dsh-opencode-session` was installed, remove it. The plugin does not work on
DSH versions that run LLM calls in the session worker.

```sh
cd ~/.dsh/profiles/web
```

Remove from `package.json`:

```json
"dsh-opencode-session": "^0.1.0"
```

Remove it from `dsh.profile.bundles`.

Remove from `pnpm-workspace.yaml`:

```yaml
patchedDependencies:
  dsh-opencode-session@0.1.0: patches/dsh-opencode-session@0.1.0.patch
```

Delete the patch file and run:

```sh
pnpm install
```

Also ensure every provider's `headers` remains an empty map unless intentionally
configured. Do not keep a static `x-opencode-session` value.

## Validation

1. Fully restart DSH Desktop.
2. Create a new session.
3. Select an OpenCode Go model such as `go/glm-5.3-flash`.
4. Send a minimal message.
5. Confirm a normal assistant response and no `MissingSessionID` error.
6. Check recent logs:

```sh
rg -n 'MissingSessionID' \
  "$HOME/Library/Application Support/DSH Desktop/logs/host" | tail -20
```

No new `MissingSessionID` entry should appear after the restart.

## Rollback

If Desktop cannot start or behaves unexpectedly:

```sh
osascript -e 'quit app "DSH Desktop"'
cp ~/.dsh/backups/DSH-Desktop-<VERSION>-app.asar \
  '/Applications/DSH Desktop.app/Contents/Resources/app.asar'
codesign --force --deep --sign - '/Applications/DSH Desktop.app'
open -a 'DSH Desktop'
```

## Maintenance Notes

- DSH Desktop upgrades replace `app.asar`; rerun the Desktop portion of this
  skill after an upgrade.
- The official upstream fix may land in a later DSH release. Before patching,
  check whether the installed `dsh-llm-pi-ai` already contains
  `x-opencode-session`; if it does, do not patch it.
- The CLI and Desktop copies must both be fixed if both UIs are used.
