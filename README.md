# RefactorSim Ruby

Internal simulation tool for Ruby/Rails interview rehearsal. Candidates refactor legacy Ruby code, edit visible RSpec examples, run real specs through Docker, and submit a reviewer-ready report.

## Run with Docker

Prerequisites:

- Docker
- Docker Compose

Start the app:

```bash
docker compose up --build
```

Open:

```text
http://localhost:3010
```

## What V1 Includes

- 3 fixed Ruby refactoring challenges.
- Editable implementation and visible RSpec tabs.
- Hidden RSpec checks executed in the Ruby runner container.
- Local submission artifacts under `submissions/`.
- AI usage self-report for reviewer comparison with the recorded video.

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
