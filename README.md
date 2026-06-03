# DMO 5 2026

Fresh full-stack prototype for the tutoring app. The old `pedagogy` project is reference material only; this project is free to use a cleaner architecture.

## Stack

- Django backend
- Postgres database
- React + TypeScript + Vite frontend
- Docker Compose for local app + database orchestration

## Local Setup With Docker

Copy the environment template:

```powershell
Copy-Item .env.example .env
```

Start the stack:

```powershell
docker compose up --build
```

Open:

- Frontend: http://localhost:5173
- Backend health check: http://localhost:8000/api/health/
- Django admin: http://localhost:8000/admin/

The Compose database uses a named volume called `postgres_data`, so normal container restarts do not erase data.

For Codex/dev-agent runs, use the repeatable helper:

```powershell
.\scripts\codex-up.ps1
```

Useful options:

```powershell
.\scripts\codex-up.ps1 -Build
.\scripts\codex-up.ps1 -Restart
.\scripts\codex-up.ps1 -CheckOnly
```

The helper starts the Docker stack when needed, waits for Django and Vite to
respond, and prints the local URLs plus the dev sign-in route.

Run the full stabilization check with:

```powershell
.\scripts\dmo-check.ps1
```

That command uses Docker for backend checks and tests so the backend talks to
the Compose `db` service instead of any separate host Postgres process.

More detail:

- [Architecture map](docs/architecture.md)
- [Verification and Postgres notes](docs/verification.md)

## Google Sign-In

DMO uses Django auth plus `django-allauth` for Google sign-in. By default, only
`@deeplearning.ai` addresses are allowed.

Set these values in `.env`:

```powershell
ALLOWED_LOGIN_EMAIL_DOMAINS=deeplearning.ai
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

For local development, add these redirect URIs to the Google OAuth client:

- `http://localhost:5173/accounts/google/login/callback/`
- `http://localhost:8000/accounts/google/login/callback/`

The Vite dev server proxies `/api` and `/accounts` to Django, so signing in from
`http://localhost:5173` works during frontend development.

## Realtime Chat

The tutoring panel uses OpenAI Realtime through a short-lived client secret
minted by Django. Set your API key in `.env`:

```powershell
OPENAI_API_KEY=your-openai-api-key
DLU_REALTIME_DEFAULT_MODEL=gpt-realtime-mini
DLU_REALTIME_DEFAULT_VOICE=ash
```

The temporary header controls let you switch between `gpt-realtime-mini`,
`gpt-realtime-1.5`, and `gpt-realtime-2`, plus the available Realtime voices.
Changing model, voice, or session starts a fresh browser Realtime connection.

## Local Setup Without Docker

Install backend dependencies into your virtual environment:

```powershell
pip install -r requirements.txt
```

Install frontend dependencies:

```powershell
Set-Location frontend
npm install
```

Run Postgres locally, then apply migrations:

```powershell
python manage.py migrate
```

Run Django and Vite in separate terminals:

```powershell
python manage.py runserver
```

```powershell
Set-Location frontend
npm run dev
```

## Database Portability

The schema lives in Django migrations. The data lives in Postgres.

For a company handoff, the clean deployment shape is:

- Build and run the app container.
- Provide environment variables such as `DATABASE_URL`, `SECRET_KEY`, `DEBUG`, and `ALLOWED_HOSTS`.
- Point the app at a company-managed Postgres database.
- Run `python manage.py migrate`.
- Restore prototype data if needed.

To export a local Postgres database:

```powershell
pg_dump --format=custom --file=dmo.dump $env:DATABASE_URL
```

To restore into another Postgres database:

```powershell
pg_restore --dbname=$env:DATABASE_URL dmo.dump
```

Use Django fixtures or explicit seed scripts later for required app starter content, such as default templates, rubric settings, or demo courses.
