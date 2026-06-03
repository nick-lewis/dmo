from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .experience_services import (
    create_experience_snapshot_for_user,
    delete_experience_snapshot_for_user,
    get_experience_snapshot_for_user,
    list_experience_snapshots_for_user,
    restore_experience_snapshot_for_user,
    snapshot_export_filename,
    snapshot_export_payload,
)
from .http_utils import auth_required_response, parse_json_body
from .models import Experience
from .serializers import (
    experience_export_payload,
    serialize_experience,
    serialize_experience_snapshot,
)


@require_http_methods(["GET", "POST"])
def experience_snapshots(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    if request.method == "GET":
        snapshots = list_experience_snapshots_for_user(experience, request.user)
        return JsonResponse(
            {
                "snapshots": [
                    serialize_experience_snapshot(snapshot)
                    for snapshot in snapshots
                ]
            }
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    snapshot = create_experience_snapshot_for_user(
        experience,
        request.user,
        data,
        payload=experience_export_payload(experience),
    )
    return JsonResponse(
        {"snapshot": serialize_experience_snapshot(snapshot)},
        status=201,
    )


@require_GET
def export_experience_snapshot(request, experience_id, snapshot_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    snapshot = get_experience_snapshot_for_user(
        experience_id,
        snapshot_id,
        request.user,
    )
    if not snapshot:
        return JsonResponse({"detail": "Snapshot not found."}, status=404)

    payload = snapshot_export_payload(snapshot)
    filename = snapshot_export_filename(snapshot)
    response = JsonResponse(payload, json_dumps_params={"indent": 2})
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@require_http_methods(["DELETE"])
def delete_experience_snapshot(request, experience_id, snapshot_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    snapshot = get_experience_snapshot_for_user(
        experience_id,
        snapshot_id,
        request.user,
    )
    if not snapshot:
        return JsonResponse({"detail": "Snapshot not found."}, status=404)

    snapshots = delete_experience_snapshot_for_user(snapshot)
    return JsonResponse(
        {
            "snapshots": [
                serialize_experience_snapshot(snapshot)
                for snapshot in snapshots
            ]
        }
    )


@require_POST
def restore_experience_snapshot(request, experience_id, snapshot_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    snapshot = get_experience_snapshot_for_user(
        experience_id,
        snapshot_id,
        request.user,
    )
    if not snapshot:
        return JsonResponse({"detail": "Snapshot not found."}, status=404)

    restored, error = restore_experience_snapshot_for_user(snapshot, request.user)
    if error:
        return JsonResponse({"detail": error}, status=400)

    return JsonResponse(
        {
            "experience": serialize_experience(restored),
            "snapshot": serialize_experience_snapshot(snapshot),
        },
        status=201,
    )
