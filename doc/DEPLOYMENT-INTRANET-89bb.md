# Intranet Deployment: paperclip-fork:89bb8675d3

This runbook is for moving the current phase-4 Paperclip instance to an intranet
host using the image built on 2026-11-14. It is the exact image and instance
state currently running on 47.

## 1. Artifact

| Item | Value |
| --- | --- |
| Image | `paperclip-fork:89bb8675d3` |
| Commit | `89bb8675d3eed745d80552d307041a675c4c5652` |
| Uncompressed size | 6.49GB |
| Archive | `paperclip-fork-89bb8675d3.tar.gz` (about 1.5GB) |
| SHA256 | `98c75582dd340866a66d083c5d536253c3aab6b560b6cdafd13f66a9270109e6` |
| Download | `http://47.107.161.168/downloads/dl-cfcc1c580e34/paperclip-fork-89bb8675d3.tar.gz` |
| README | `http://47.107.161.168/downloads/dl-cfcc1c580e34/README.txt` |
| Expiry | 24 hours after 2026-11-14T08:11:49+08:00 |

Download the archive **before leaving the network that can reach 47**. The URL is
temporary and the file is deleted by a systemd timer.

Load on the intranet host:

```sh
sha256sum -c paperclip-fork-89bb8675d3.tar.gz.sha256
docker load -i paperclip-fork-89bb8675d3.tar.gz
docker image inspect paperclip-fork:89bb8675d3 --format '{{.Config.Env}}'
```

The image is `linux/amd64`. It is a production-target server/UI image, not an
all-in-one agent runtime.

## 2. What the image contains

- Paperclip server runtime (`server/dist-runtime`) and built UI.
- Database migrations.
- Bundled `paperclip-project-tree` plugin.
- Bundled `paperclip.business-status` plugin 1.5.0.
- Skills catalog, including `business-cockpit` (`defaultInstall: false`).
- `opencode-local` adapter 0.4.0, including direct-workspace per-Agent
  instructions prepend.
- `doc/agents` role templates.

It does **not** contain the instance database, secrets, company/agent
instructions, company skill assignments, or an execution-host OpenCode install.

## 3. Intranet prerequisites

1. Docker Engine on Linux amd64.
2. A persistent instance directory. Use the same absolute path as 47:
   `/home/paperclip/.paperclip`. `config.json` stores host-absolute paths
   (instance dir, embedded Postgres data dir), so a different path requires
   editing config and rebinding paths.
3. UID/GID for the volume. The image is built with `USER_UID=998` and
   `USER_GID=998`; `/home/paperclip/.paperclip` must be owned by `998:998`, or
   rebuild/rechown deliberately.
4. An execution host with:
   - OpenCode 1.19.5 (the image contains no `opencode` CLI);
   - `/etc/opencode` and `~/.config/opencode` configuration;
   - MCP servers `argo` and `graph-mcp`;
   - SSH access from Paperclip to that host, and the project workspace path.
5. A decision on database:
   - migrate the embedded Postgres directory and instance files, or
   - start a fresh instance and reconfigure.
6. TLS/domain/reverse proxy for the intranet URL, or use
   `PAPERCLIP_PUBLIC_URL=http://<host>:3100` temporarily.

## 4. Backup and transfer the instance

Stop the source container before copying the embedded database:

```sh
docker stop paperclip
```

Copy only the durable instance state. Do not copy `workspaces/` or
`isolated-workspaces/` unless you intentionally need old execution worktrees;
they are large and are usually rebuilt on the next run.

```sh
cd /home/paperclip/.paperclip
tar -czf /root/paperclip-instance-89bb.tgz \
  instances/default/config.json \
  instances/default/.env \
  instances/default/secrets \
  instances/default/companies \
  instances/default/skills \
  instances/default/data \
  instances/default/db
sha256sum /root/paperclip-instance-89bb.tgz > /root/paperclip-instance-89bb.tgz.sha256
```

Critical files:

- `instances/default/.env`: contains `PAPERCLIP_AGENT_JWT_SECRET`.
- `instances/default/secrets/master.key`: without it encrypted secrets
  (AI keys, SSH keys) cannot be decrypted.
- `instances/default/db`: embedded Postgres data directory.
- `instances/default/companies`: Agent instructions/managed files.
- `instances/default/skills`: company skill library.
- `instances/default/data`: attachments/storage.

If you use an external Postgres instead of the embedded directory, take a
`pg_dump` and provide `DATABASE_URL`; do not copy the `db` directory.

## 5. Restore on intranet

```sh
mkdir -p /home/paperclip/.paperclip
tar -xzf /root/paperclip-instance-89bb.tgz -C /home/paperclip/.paperclip
chown -R 998:998 /home/paperclip/.paperclip
```

If the intranet host path differs, update every absolute path in
`instances/default/config.json` and the Agent/project environment paths before
starting. The same path is strongly recommended.

Review and update `PAPERCLIP_PUBLIC_URL`, reverse proxy, TLS, firewall, and any
`arp`/Neo4j/MCP endpoint that changes between networks.

## 6. Run the container

Use the same env/port/mount shape as the 47 production container:

```sh
docker run -d --name paperclip \
  -p 0.0.0.0:3100:3100 \
  --env-file /home/paperclip/.paperclip/instances/default/.env \
  -e HOST=0.0.0.0 \
  -e PAPERCLIP_BIND_HOST=0.0.0.0 \
  -e PORT=3100 \
  -e SERVE_UI=true \
  -e PAPERCLIP_HOME=/home/paperclip/.paperclip \
  -e PAPERCLIP_INSTANCE_ID=default \
  -e PAPERCLIP_CONFIG=/home/paperclip/.paperclip/instances/default/config.json \
  -e PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  -e PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  -e PAPERCLIP_PUBLIC_URL=https://<intranet-domain-or-host> \
  -e PAPERCLIP_BUILD_COMMIT=89bb8675d3eed745d80552d307041a675c4c5652 \
  -e PAPERCLIP_BUILD_VERSION=0.1.0-fork \
  -e USER_UID=998 \
  -e USER_GID=998 \
  -e OPENCODE_ALLOW_ALL_MODELS=true \
  -e GEMINI_SANDBOX=false \
  -e PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH=/opt/paperclip-runner/provider-pack \
  -v /home/paperclip/.paperclip:/home/paperclip/.paperclip \
  --restart unless-stopped \
  --stop-timeout 90 \
  paperclip-fork:89bb8675d3
```

`PAPERCLIP_BUILD_COMMIT` must be the full 40-character SHA. Do not use the short
tag.

## 7. Post-start verification

```sh
curl -fsS -H 'Host: <intranet-domain>' http://127.0.0.1:3100/api/health
docker ps --filter name=paperclip --format '{{.Image}} {{.Status}}'
docker logs --tail 100 paperclip | grep -E 'migration|plugin-loader|ready|error'
```

Expected:

- health `status=ok`, `commit=89bb8675d3...`;
- UI `/` returns 200;
- `plugin-loader` activates `paperclip-project-tree` and
  `paperclip.business-status` 1.5.0;
- no migration or plugin worker errors;
- old data is visible (if the DB was migrated).

If the DB was migrated, plugin rows/config, Agent instructions and company
skills should already be present. Verify:

- Business Cockpit governance in Plugin Settings:
  `profileWriterAgentId`, `snapshotWriterAgentIds`, `allowBoardBackfill=false`;
- Board write returns 403 `writer-not-authorized`;
- KM Agent can read/write under governance;
- `business-cockpit` skill is installed and attached to the KM Agent.

If the DB is fresh, the image auto-installs bundled plugins, but you must:

1. Set the Business Cockpit governance IDs.
2. Install `paperclipai/bundled/paperclip-operations/business-cockpit` and attach
   it to the KM Agent.
3. Put the per-Agent `AGENTS.md` into Agent Instructions (the `doc/agents`
   templates are only templates).
4. Recreate the project/execution environments and remap Agent/project paths.

## 8. Known gaps and risks

| Gap | Impact | Action |
| --- | --- | --- |
| Provider pack absent from image | Native Runner/ACPX/sandbox remote may fail; legacy `opencode_local` remote is fine | Keep legacy `opencode_local`, or build a qualified provider pack separately |
| No `opencode` CLI in container | Container-only/local execution has no agent runtime | Use the remote execution host; install OpenCode 1.19.5 there |
| OpenCode/MCP config is host-level | `/etc/opencode`, `~/.config/opencode`, `argo`, `graph-mcp` are not in the image | Recreate on the intranet execution host |
| Instance data not in image | Fresh instance has no companies/agents/instructions/skills/data | Migrate the instance tar or configure from scratch |
| Tar link, not registry | Web deploy platforms that require a registry cannot pull it | Push to an intranet registry (`docker tag` + `docker push`) or import the tar if supported |
| Image is amd64 | ARM host cannot run it | Use amd64 or build a matching image |
| Absolute paths in config | Different mount path breaks embedded Postgres | Mount at `/home/paperclip/.paperclip` or update config |
| Secrets/master key | Missing `master.key` makes encrypted secrets unreadable | Copy it with the DB; never commit it |

## 9. Rollback

Keep the source image and instance backup until the new instance is verified:

- On the new host: `docker rm -f paperclip`, restore the previous instance
  backup and the previous image tag.
- If the source was only stopped: `docker start paperclip` on 47.
- If a DB migration failed: restore the copied `instances/default/db` or the
  `pg_dump` before starting the container again.

## 10. Deployment method summary

1. Download the tar and checksum before leaving the 47 network.
2. Load the image on the intranet host.
3. Stop the source container, copy the instance state, restore it at the same
   absolute path, and fix ownership.
4. Run the container with the full commit and the intranet public URL.
5. Verify health, UI, migrations, plugin 1.5.0, governance, skill and the
   execution host connection.
6. Push the loaded image to the intranet registry if the Web deployment
   platform requires a registry reference.
