# Deploying Paperclip to the phase-4 instance (47)

This document is the canonical runbook for the phase-4 production instance.
It is a hard rule set, not a suggestion: the 2026-10-24 incident review found
that copying source from a workstation had silently drifted the server checkout
away from the repository.

## 1. Instance facts

| Item | Value |
|---|---|
| Host | `47.107.161.168` (SSH as `root`, key `id_ed25519`) |
| Checkout | `/home/paperclip/paperclip-fork` |
| Service | `paperclip.service` (drop-in `/etc/systemd/system/paperclip.service.d/fork.conf`) |
| Runtime | `/opt/node24/bin/node .../tsx/dist/cli.mjs server/dist/index.js` (reads `src` through package exports) |
| API bind | `172.18.2.191:3100` |
| Dashboard | `https://paperclip.derekworkspacev5.com` |
| Database | embedded PostgreSQL on `127.0.0.1:54329` (`paperclip` / `paperclip`) |

`/api/health` reports `commit` from the checkout's `git HEAD`, not from a build
stamp. A mismatch between the health commit and the deployed build is a defect.

## 2. Hard rules

1. **Source of truth is GitHub.** `origin` is
   `https://github.com/derekhu0002/paperclip.git`, branch `dev/local-install`.
2. **Never copy source files from a workstation to 47.** Only build artifacts
   (`ui/dist`, plugin `dist/`) may be uploaded.
3. **Never build on 47.** No `vite build`, no `tsc`, no plugin build. Build on
   the workstation from the same commit.
4. **No local commits on 47.** The deploy branch is reset to the GitHub commit
   on every deploy; local commits will be discarded without review.
5. **No `pnpm install` on 47 unless it is a declared recovery action.** The
   runbook does not require it; an interrupted install can leave a partially
   linked `node_modules`.
6. **Back up before replacing anything.**
   - `ui-dist` 鈫?`/root/backups/ui-dist-pre-<slug>-<utc-timestamp>`
   - checkout 鈫?git branch `backup-47-pre-<slug>-<utc-timestamp>`

## 3. Branch model on 47

- `deploy` tracks `origin/dev/local-install`.
- Every deploy: `git fetch origin && git reset --hard origin/dev/local-install`.
- Historical branches are kept only as rollback anchors
  (`backup-47-*`, `deploy-2026-10-21`). They are never deployed from.

### 3.1 Fallback when 47 cannot reach GitHub

47's link to GitHub is intermittent (`GnuTLS recv error -110`, port 443
timeouts). The only permitted fallback is a **git bundle of the exact pushed
commit**, never a copy of the workstation working tree:

```sh
# Workstation, after the push succeeded:
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/dev/local-install)"
git bundle create /tmp/origin.bundle dev/local-install
scp /tmp/origin.bundle root@47.107.161.168:/tmp/origin.bundle
```

```sh
# 47: import the bundle, then prove it is the same commit
cd /home/paperclip/paperclip-fork
git fetch /tmp/origin.bundle 'refs/heads/dev/local-install:refs/remotes/origin/dev/local-install'
test "$(git rev-parse FETCH_HEAD)" = "$SHA"
git reset --hard FETCH_HEAD
rm -f /tmp/origin.bundle
```

The SHA equality check is mandatory. If the bundle's SHA does not match the
commit already on GitHub, the deploy is aborted.


## 4. Standard deploy runbook

Run steps 1-6 on the workstation, steps 7-10 on 47.

```sh
# 1. Workstation: land + publish the change
git status --short                 # expect only intended files
git commit -m "<type>(<scope>): <summary>"
git push origin dev/local-install

# 2. Record the exact commit to deploy
SHA=$(git rev-parse HEAD)

# 3. Workstation: build the UI from that commit
pnpm --filter @paperclipai/ui build

# 4. Workstation: build plugins you are deploying (dist/ is gitignored)
pnpm --filter @paperclipai/plugin-project-tree build

# 5. Workstation: package artifacts only
tar -czf /tmp/ui-dist.tgz -C ui dist
tar -czf /tmp/plugin.tgz -C packages/plugins --exclude node_modules plugin-project-tree

# 6. Upload artifacts
scp /tmp/ui-dist.tgz /tmp/plugin.tgz root@47.107.161.168:/tmp/
```

```sh
# 7. 47: pull source from GitHub (no local edits survive)
cd /home/paperclip/paperclip-fork
git fetch origin --prune --no-tags
git branch "backup-47-pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)"
git checkout -f deploy
git reset --hard origin/dev/local-install
test "$(git rev-parse HEAD)" = "$SHA"

# 8. 47: install/refresh plugins BEFORE swapping the UI
#    Local-path installs need a workspace SDK link (3 levels up):
#    packages/plugins/<plugin>/node_modules/@paperclipai/plugin-sdk -> ../../../sdk
#    Then POST /api/plugins/install {packageName:<abs path>, isLocalPath:true}

# 9. 47: swap the UI bundle
cp -a server/ui-dist "/root/backups/ui-dist-pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)"
rm -rf /tmp/ui-new && mkdir -p /tmp/ui-new && tar -xzf /tmp/ui-dist.tgz -C /tmp/ui-new
mv server/ui-dist server/ui-dist.prev
mv /tmp/ui-new/dist server/ui-dist
rm -rf server/ui-dist.prev
chown -R paperclip:paperclip server/ui-dist

# 10. 47: restart and verify
systemctl restart paperclip.service
```

## 5. Verification (must all pass)

```sh
curl -s http://172.18.2.191:3100/api/health          # status=ok, commit=SHA
curl -s -o /dev/null -w '%{http_code}\n' http://172.18.2.191:3100/<prefix>/organization
# plugin page only: GET /api/plugins/ui-contributions contains the page slot
# plugin page only: POST /api/plugins/<id>/bridge/data returns the expected payload
```

Also confirm `git status --porcelain -uno` is empty and
`git rev-parse HEAD` equals `origin/dev/local-install`.

## 6. Rollback

1. Checkout: `git reset --hard <backup-47-pre-*>`.
2. Restore `server/ui-dist` from the matching `/root/backups/ui-dist-pre-*`.
3. Restart `paperclip.service` and re-run the verification block.

## 7. Plugin notes

- A local-path plugin keeps referencing its directory; it must live inside the
  checkout and keep its `dist/`.
- Worker spawn uses the checkout's `tsx` loader for local-path installs, so
  plain `node` cannot import the plugin SDK outside that loader.
- Installing requires instance-admin; use a short-lived board key and delete it
  in the same transaction window.

## 8. Known traps

- Piping a PowerShell here-string to `ssh bash -s` injects CRLF; write an LF
  file, `scp` it, then run it.
- Replacing `ui-dist` before installing the plugin leaves the retired route
  returning 404 for the duration of the swap.
- The old shell had two sidebar files (`Sidebar.tsx`, `Sidebar.production.tsx`);
  removing a nav entry means touching both.
## 9. Container deployment (current production mode, 2026-10-24)

The instance now runs from an image; the source-checkout service is disabled but
kept as a rollback path. Container facts:

- Image: `paperclip-fork:1215d44f47bd` (6.32GB, built locally from
  `1215d44f47bde0bda0952b9d6f5c97b7a609ab92`, transferred with
  `docker save | ssh docker load`; ACR push pending).
- Command: `docker run -d --name paperclip -p 172.18.2.191:3100:3100
  --env-file /home/paperclip/.paperclip/instances/default/.env
  -e HOST=0.0.0.0 -e PAPERCLIP_BIND_HOST=0.0.0.0 -e PORT=3100 -e SERVE_UI=true
  -e PAPERCLIP_HOME=/home/paperclip/.paperclip
  -e PAPERCLIP_INSTANCE_ID=default
  -e PAPERCLIP_CONFIG=/home/paperclip/.paperclip/instances/default/config.json
  -e PAPERCLIP_DEPLOYMENT_MODE=authenticated
  -e PAPERCLIP_DEPLOYMENT_EXPOSURE=private
  -e PAPERCLIP_PUBLIC_URL=https://paperclip.derekworkspacev5.com
  -e PAPERCLIP_BUILD_COMMIT=<FULL_40_CHAR_SHA>
  -v /home/paperclip/.paperclip:/home/paperclip/.paperclip
  --restart unless-stopped --stop-timeout 90 paperclip-fork:<tag>`
- **Mount at the same absolute path**, not `/paperclip`: `config.json` stores
  host-absolute paths (instance dir, embedded Postgres data dir), so a different
  container path makes the embedded cluster try to initialize elsewhere.
- `PAPERCLIP_BIND_HOST=0.0.0.0` is required because the existing config has
  `server.bind=custom`; without it the server exits with
  `server.customBindHost is required when server.bind=custom`.
- `PAPERCLIP_BUILD_COMMIT` must be the **full 40-char** SHA; a short SHA is
  rejected and health falls back to the stale stamp baked into the image.
- The plugin row is deleted before the first container boot so the image's
  self-hosted auto-install recreates it at
  `/app/packages/plugins/plugin-project-tree`. This is the fresh-device path.
- Health is hostname-guarded: use `-H 'Host: paperclip.derekworkspacev5.com'`
  when curling `172.18.2.191:3100` directly.
- Rollback: `docker rm -f paperclip && systemctl start paperclip` (the systemd
  unit is disabled, not removed).

Known image gaps: the provider pack is skipped (agents use the legacy
`opencode_local` remote adapter, so runs are unaffected). The image is 6.32GB:
the five agent CLIs were dropped, and `.argo`, `server/dist`, `server/ui-dist`
and `ui/dist` are excluded from the build context. On the first boot after the
2026-10-24 upstream merge it applied migrations 0370-0378 (upstream 0370-0377
plus the fork's idempotent 0378).