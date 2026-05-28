FROM node:22-alpine AS frontend-build

WORKDIR /app
COPY frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM python:3.13-slim AS app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./
COPY --from=frontend-build /app/static/frontend ./static/frontend

RUN python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["gunicorn", "dmo_5_2026.wsgi:application", "--bind", "0.0.0.0:8000"]
