from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse


def health(request):
    return JsonResponse({"status": "ok", "service": "dmo"})


def frontend_index(request):
    index_path = Path(settings.BASE_DIR) / "static" / "frontend" / "index.html"
    if not index_path.exists():
        raise Http404(
            "Frontend build not found. Run the Vite dev server or build the frontend."
        )
    return FileResponse(index_path.open("rb"), content_type="text/html")
