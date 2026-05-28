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
