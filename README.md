# RefactorSim Ruby

Internal simulation tool for Ruby/Rails interview rehearsal. Candidates refactor legacy Ruby code, edit visible RSpec examples, run real specs through Docker, and submit a reviewer-ready report.

## Run with Docker

Prerequisites:

- Docker
- Docker Compose

Start the app locally:

```bash
docker compose up --build
```

Open:

```text
http://localhost:3010
```

## Run with Cloudflare Tunnel

Public demo URL:

```text
https://rubytest.cjp-demo.online
```

In Cloudflare Zero Trust, create a Cloudflared tunnel and add this public hostname:

```text
Subdomain: rubytest
Domain: cjp-demo.online
Type: HTTP
URL: http://web:3000
```

Copy the tunnel token into `.env`:

```bash
cp .env.example .env
```

Then edit:

```text
CLOUDFLARED_TUNNEL_TOKEN="..."
```

Start the app and tunnel together:

```bash
docker compose --profile tunnel up -d --build
```

Check status:

```bash
docker compose ps
```

The `cloudflared` service should be running, and the app should be reachable at `https://rubytest.cjp-demo.online`.

Current locally-managed tunnel on this machine:

```text
Tunnel name: refactorsim-rubytest
Tunnel ID: 7d042da8-f061-4d5c-9616-b6936e925d79
Hostname: rubytest.cjp-demo.online
Local service: http://localhost:3010
Config: %USERPROFILE%\.cloudflared\refactorsim-rubytest.yml
```

If the tunnel process is stopped, restart it with:

```powershell
cloudflared --config $env:USERPROFILE\.cloudflared\refactorsim-rubytest.yml tunnel run refactorsim-rubytest
```

## What V1 Includes

- 10 fixed Ruby refactoring challenges.
- Login for admin and candidate users.
- Admin user management for creating and disabling users.
- Editable implementation and visible RSpec tabs.
- Hidden RSpec checks executed in the Ruby runner container.
- Screen recording capture using the browser's display recording permission.
- Local user/session data under `data/`.
- Local submission artifacts, code, specs, reports, and recordings under `submissions/`.
- AI usage self-report for reviewer comparison with the recorded video.

## User Flow

On the first run, the app shows a first-admin setup screen. After creating the admin:

1. Log in as admin.
2. Create candidate users from the Admin screen.
3. Candidate logs in and starts a simulation.
4. Candidate starts screen recording, runs specs, refactors, fills submit notes, and saves.
5. Admin opens the Admin screen to download report, code, spec, and recording.

All auth is local to this deployment. Do not commit `data/` or `submissions/`.

## Local Node Mode

If you run the web app outside Docker, start the Ruby runner separately and set:

```bash
RUBY_RUNNER_URL=http://localhost:4567
```

Then run:

```bash
npm install
npm run dev
```
