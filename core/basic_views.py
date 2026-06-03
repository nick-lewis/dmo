from pathlib import Path
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .http_utils import DEFAULT_APP_PATH, auth_required_response
from .main_panel_apps import MAIN_PANEL_APP_REGISTRY
from .serializers import serialize_user


def health(request):
    return JsonResponse({"status": "ok", "service": "dmo"})


@ensure_csrf_cookie
@require_GET
def current_user(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    return JsonResponse({"user": serialize_user(request.user)})


@require_GET
def main_panel_apps(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    return JsonResponse({"apps": MAIN_PANEL_APP_REGISTRY})


@require_POST
def logout_user(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    logout(request)
    return JsonResponse({"ok": True})


@require_POST
def dev_login(request):
    if not settings.DEBUG or not settings.DLU_DEV_AUTH_BYPASS:
        raise Http404("Local sign-in is not enabled.")

    email = str(settings.DLU_DEV_LOGIN_EMAIL or "").strip().lower()
    if not email or "@" not in email:
        email = "nicky@deeplearning.ai"

    username = email.split("@", 1)[0] or "dev-user"
    User = get_user_model()
    user = User.objects.filter(email__iexact=email).order_by("id").first()
    if not user:
        user, _ = User.objects.get_or_create(
            username=username,
            defaults={
                "email": email,
                "first_name": "Nicky",
                "last_name": "",
            },
        )
    update_fields = []
    if user.email != email:
        user.email = email
        update_fields.append("email")
    if not user.first_name:
        user.first_name = "Nicky"
        update_fields.append("first_name")
    if update_fields:
        user.save(update_fields=update_fields)

    login(request, user, backend="django.contrib.auth.backends.ModelBackend")

    next_path = str(request.POST.get("next") or settings.LOGIN_REDIRECT_URL)
    if not next_path.startswith("/") or next_path.startswith("//"):
        next_path = settings.LOGIN_REDIRECT_URL
    return redirect(next_path)


def frontend_index(request):
    if request.path == "/":
        return redirect(DEFAULT_APP_PATH)

    if not request.user.is_authenticated:
        return redirect(f"{settings.LOGIN_URL}?{urlencode({'next': request.path})}")

    index_path = Path(settings.BASE_DIR) / "static" / "frontend" / "index.html"
    if not index_path.exists():
        raise Http404(
            "Frontend build not found. Run the Vite dev server or build the frontend."
        )
    return FileResponse(index_path.open("rb"), content_type="text/html")
