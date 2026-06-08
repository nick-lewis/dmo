from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.http import JsonResponse
from django.utils.text import slugify
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .experience_services import (
    create_experience_for_user,
    delete_experience_for_user,
    duplicate_experience_for_user,
    ensure_start_event,
    ensure_tutor_settings,
    get_current_experience,
    ordered_user_experiences,
    update_experience_from_data,
)
from .http_utils import auth_required_response, parse_json_body
from .models import Experience
from .serializers import experience_export_payload, serialize_experience
from .validation import experience_validation_summary

TUTOR_AVATAR_CONTENT_TYPES = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
TUTOR_AVATAR_MAX_BYTES = 5 * 1024 * 1024
SCRIPT_IMAGE_DIR = "script-images"
SCRIPT_IMAGE_MAX_BYTES = 8 * 1024 * 1024


def public_script_image_options():
    public_root = settings.BASE_DIR / "frontend" / "public"
    image_dirs = [
        ("test-images", public_root / "test-images", "Built-in"),
        (
            SCRIPT_IMAGE_DIR,
            Path(settings.MEDIA_ROOT) / SCRIPT_IMAGE_DIR,
            "Uploaded",
        ),
    ]
    options = []
    seen_paths = set()
    for path_prefix, directory, source in image_dirs:
        if not directory.exists():
            continue
        for image_path in sorted(directory.iterdir(), key=lambda item: item.name.lower()):
            if not image_path.is_file():
                continue
            if image_path.suffix.lower() not in {".gif", ".jpg", ".jpeg", ".png", ".webp"}:
                continue
            asset_path = f"{path_prefix}/{image_path.name}".replace("\\", "/")
            if path_prefix == SCRIPT_IMAGE_DIR:
                asset_path = f"{settings.MEDIA_URL.strip('/')}/{asset_path}".replace(
                    "\\",
                    "/",
                )
            if asset_path in seen_paths:
                continue
            seen_paths.add(asset_path)
            options.append(
                {
                    "label": image_path.stem.replace("-", " ").replace("_", " "),
                    "path": asset_path,
                    "removable": source == "Uploaded",
                    "source": source,
                }
            )
    return options


def uploaded_script_image_name_from_path(image_path):
    image_path = str(image_path or "").strip().replace("\\", "/")
    media_prefix = f"{settings.MEDIA_URL.strip('/')}/"
    script_image_prefix = f"{media_prefix}{SCRIPT_IMAGE_DIR}/"
    if not image_path.startswith(script_image_prefix):
        return ""

    relative_name = image_path.removeprefix(media_prefix)
    path = Path(relative_name)
    if (
        path.is_absolute()
        or len(path.parts) != 2
        or path.parts[0] != SCRIPT_IMAGE_DIR
        or path.name != path.parts[1]
        or path.suffix.lower() not in {".gif", ".jpg", ".jpeg", ".png", ".webp"}
    ):
        return ""
    return relative_name


@require_http_methods(["GET", "POST"])
def experiences(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    if request.method == "GET":
        current_experience = get_current_experience(request.user)
        user_experiences = ordered_user_experiences(request.user)
        return JsonResponse(
            {
                "currentExperienceId": str(current_experience.id),
                "experiences": [
                    serialize_experience(experience)
                    for experience in user_experiences
                ],
            }
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    experience, error = create_experience_for_user(request.user, data)
    if error:
        return JsonResponse({"detail": error}, status=400)
    return JsonResponse({"experience": serialize_experience(experience)}, status=201)


@require_http_methods(["DELETE", "PATCH", "POST"])
def update_experience(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    if request.method == "DELETE":
        current_experience, user_experiences = delete_experience_for_user(
            experience,
            request.user,
        )
        return JsonResponse(
            {
                "currentExperienceId": str(current_experience.id),
                "experiences": [
                    serialize_experience(experience)
                    for experience in user_experiences
                ],
            }
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    experience, error = update_experience_from_data(experience, data)
    if error:
        return JsonResponse({"detail": error}, status=400)
    return JsonResponse({"experience": serialize_experience(experience)})


@require_POST
def upload_tutor_avatar(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    uploaded_file = request.FILES.get("image")
    if not uploaded_file:
        return JsonResponse({"detail": "Choose an image to upload."}, status=400)

    content_type = str(uploaded_file.content_type or "").lower()
    extension = TUTOR_AVATAR_CONTENT_TYPES.get(content_type)
    if not extension:
        return JsonResponse(
            {"detail": "Use a PNG, JPG, WebP, or GIF image."},
            status=400,
        )

    if uploaded_file.size > TUTOR_AVATAR_MAX_BYTES:
        return JsonResponse(
            {"detail": "Use an image smaller than 5 MB."},
            status=400,
        )

    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    saved_name = storage.save(
        f"tutor-avatars/{uuid4().hex}{extension}",
        uploaded_file,
    )
    media_url = settings.MEDIA_URL.strip("/")
    avatar_path = f"{media_url}/{saved_name}".replace("\\", "/")
    return JsonResponse({"avatarPath": avatar_path})


@require_http_methods(["DELETE", "GET", "POST"])
def script_images(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    if request.method == "GET":
        return JsonResponse({"images": public_script_image_options()})

    if request.method == "DELETE":
        data = parse_json_body(request)
        if data is None:
            data = {}
        image_path = str(data.get("imagePath") or request.GET.get("imagePath") or "")
        image_name = uploaded_script_image_name_from_path(image_path)
        if not image_name:
            return JsonResponse(
                {"detail": "Only uploaded script images can be deleted."},
                status=400,
            )

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        if storage.exists(image_name):
            storage.delete(image_name)
        return JsonResponse(
            {
                "deletedImagePath": image_path,
                "images": public_script_image_options(),
            },
        )

    uploaded_file = request.FILES.get("image")
    if not uploaded_file:
        return JsonResponse({"detail": "Choose an image to upload."}, status=400)

    content_type = str(uploaded_file.content_type or "").lower()
    extension = TUTOR_AVATAR_CONTENT_TYPES.get(content_type)
    if not extension:
        return JsonResponse(
            {"detail": "Use a PNG, JPG, WebP, or GIF image."},
            status=400,
        )

    if uploaded_file.size > SCRIPT_IMAGE_MAX_BYTES:
        return JsonResponse(
            {"detail": "Use an image smaller than 8 MB."},
            status=400,
        )

    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    saved_name = storage.save(
        f"{SCRIPT_IMAGE_DIR}/{uuid4().hex}{extension}",
        uploaded_file,
    )
    media_url = settings.MEDIA_URL.strip("/")
    image_path = f"{media_url}/{saved_name}".replace("\\", "/")
    return JsonResponse(
        {
            "image": {
                "label": Path(saved_name).stem,
                "path": image_path,
                "removable": True,
                "source": "Uploaded",
            },
            "imagePath": image_path,
            "images": public_script_image_options(),
        },
        status=201,
    )


@require_GET
def experience_validation(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    ensure_tutor_settings(experience)
    ensure_start_event(experience)
    return JsonResponse({"validation": experience_validation_summary(experience)})


@require_POST
def duplicate_experience(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    source = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not source:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    duplicate = duplicate_experience_for_user(source, request.user)
    return JsonResponse({"experience": serialize_experience(duplicate)}, status=201)


@require_GET
def export_experience(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    payload = experience_export_payload(experience)
    filename = f"{slugify(experience.title) or 'experience'}.dlu-experience.json"
    response = JsonResponse(payload, json_dumps_params={"indent": 2})
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
