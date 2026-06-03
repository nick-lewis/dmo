from django.http import FileResponse, Http404, JsonResponse
from django.views.decorators.http import require_GET, require_POST

from . import slides
from .http_utils import auth_required_response, parse_json_body
from .models import Experience
from .script_audio_services import recache_experience_slide_images


@require_POST
def recache_experience_slides(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    payload = recache_experience_slide_images(experience)
    return JsonResponse(
        {
            **payload,
            "errorCount": len(payload["errors"]),
            "recachedCount": len(payload["recached"]),
            "skippedCount": len(payload["skipped"]),
        },
        status=207 if payload["errors"] else 200,
    )

@require_POST
def resolve_google_slide(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    deck_url = str(data.get("deckUrl", "")).strip()
    slide_ref = str(data.get("slideRef", "1")).strip() or "1"
    force_refresh = bool(data.get("forceRefresh", False))

    if len(deck_url) > 2048:
        return JsonResponse({"detail": "Deck URL is too long."}, status=400)

    try:
        resolved = slides.resolve_slide_image(deck_url, slide_ref, force_refresh)
    except slides.SlideResolutionError as error:
        return JsonResponse({"detail": str(error)}, status=400)
    except slides.SlideFetchError as error:
        return JsonResponse({"detail": str(error)}, status=502)

    return JsonResponse(
        {
            "cached": resolved.cache_hit,
            "imageUrl": f"/api/slides/images/{resolved.filename}/",
            "pageId": resolved.page_id,
            "presentationId": resolved.presentation_id,
            "slideRef": slide_ref,
        }
    )


@require_GET
def serve_google_slide_image(request, filename):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    try:
        path = slides.get_slide_image_path(filename)
    except slides.SlideResolutionError:
        raise Http404("Slide image not found.")

    if not path.exists():
        raise Http404("Slide image not found.")

    return FileResponse(path.open("rb"), content_type="image/png")
