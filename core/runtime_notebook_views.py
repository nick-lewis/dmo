from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from .http_utils import auth_required_response, parse_json_body, session_payload
from .models import TutoringSession
from .notebook import (
    NOTEBOOK_CONTEXT_KEY,
    format_notebook_cell,
    notebook_context_snapshot,
    normalize_notebook,
    run_python_notebook,
)


@require_POST
def update_session_notebook(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    action = str(data.get("action", "save") or "save").strip()
    if action not in {"save", "run", "format"}:
        return JsonResponse({"detail": "Notebook action is not supported."}, status=400)

    try:
        notebook = normalize_notebook(data.get("notebook"))
    except ValueError as error:
        return JsonResponse({"detail": str(error)}, status=400)

    formatter = ""
    try:
        if action == "run":
            notebook = run_python_notebook(
                notebook,
                target_cell_id=data.get("cellId", ""),
                run_all=bool(data.get("runAll", False)),
            )
        elif action == "format":
            notebook, formatter = format_notebook_cell(
                notebook,
                str(data.get("cellId", "") or ""),
            )
        else:
            notebook["updatedAt"] = str(round(timezone.now().timestamp() * 1000))
    except ValueError as error:
        return JsonResponse({"detail": str(error)}, status=400)

    with transaction.atomic():
        session = (
            TutoringSession.objects.select_for_update()
            .filter(
                id=session_id,
                user=request.user,
                status=TutoringSession.Status.ACTIVE,
            )
            .first()
        )
        if not session:
            return JsonResponse({"detail": "Session not found."}, status=404)

        state = dict(session.runtime_state or {})
        ui_runtime = dict(state.get("uiRuntime") or {})
        left_panels = dict(ui_runtime.get("leftPanels") or {})
        left_panels["pythonNotebook"] = notebook
        ui_runtime["leftPanels"] = left_panels
        state["uiRuntime"] = ui_runtime

        runtime_context = dict(session.runtime_context or {})
        runtime_context[NOTEBOOK_CONTEXT_KEY] = notebook_context_snapshot(notebook)

        actions = [
            {
                "cellId": str(data.get("cellId", "") or ""),
                "formatter": formatter,
                "runAll": bool(data.get("runAll", False)),
                "source": "left_panel",
                "status": "ready",
                "type": "python_notebook",
            }
        ]
        session.runtime_state = state
        session.runtime_context = runtime_context
        session.save(update_fields=["runtime_context", "runtime_state", "updated_at"])

    return JsonResponse(
        {
            **session_payload(session),
            "actions": actions,
            "notebook": notebook,
        }
    )
