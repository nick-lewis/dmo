# DMO Verification

Use Docker as the blessed verification path. The backend container talks to the Compose `db` service with `DATABASE_URL=postgres://dmo:dmo@db:5432/dmo`, which avoids host `localhost:5432` credential drift.

Run the full check:

```powershell
.\scripts\dmo-check.ps1
```

The script runs:

- Docker Compose startup, unless `-NoStart` is passed.
- `git diff --check`.
- Frontend TypeScript and Vite production build inside the frontend container.
- Django `check` inside the backend container.
- Django migration drift check inside the backend container.
- Python compile smoke inside the backend container.
- Full Django test suite inside the backend container.

Useful shorter runs:

```powershell
.\scripts\dmo-check.ps1 -NoStart
.\scripts\dmo-check.ps1 -SkipFrontend
.\scripts\dmo-check.ps1 -SkipBackendTests
```

For frontend refactors that touch the new editor, also run the focused
[New Editor Browser Smoke](./next-editor-browser-smoke.md). It covers hard
refresh state restore for `event`, `script`, and `tab`, plus the Fine Tuning
panel render path that TypeScript and pure tests cannot exercise alone. After
capturing the browser smoke JSON, validate it with:

```powershell
cd frontend
node .\scripts\validate-next-editor-browser-smoke.mjs --file C:\tmp\next-editor-smoke.json
```

## Postgres Notes

Docker Postgres is the source of truth for local verification. Check it with:

```powershell
docker compose ps
docker compose exec -T db pg_isready -U dmo -d dmo
docker compose exec -T backend python manage.py check
```

If host `.venv` tests fail with password authentication for `localhost:5432`, that does not mean the Docker database is down. It usually means another host Postgres service or a persisted local database password does not match `.env`. Either run tests through Docker or reset the host Postgres credentials/port to match `.env`.

The expected no-schema-change check is:

```powershell
docker compose exec -T backend python manage.py makemigrations --check --dry-run
```
