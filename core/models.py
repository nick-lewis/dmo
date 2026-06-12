import uuid

from django.conf import settings
from django.db import models


DEFAULT_CLASSIFICATION_MODEL = "gpt-5.4-mini"


class Experience(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="experiences",
    )
    title = models.CharField(max_length=160)
    slug = models.SlugField(max_length=180)
    description = models.TextField(blank=True, default="")
    # Per-experience overrides (icon/title) for registry-defined side panels:
    # [{panelId, title, iconPath}]
    side_panels = models.JSONField(blank=True, default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "slug"],
                name="unique_user_experience_slug",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "-updated_at"]),
        ]

    def __str__(self):
        return self.title


class ExperienceSnapshot(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    experience = models.ForeignKey(
        Experience,
        on_delete=models.CASCADE,
        related_name="snapshots",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="experience_snapshots",
    )
    title = models.CharField(max_length=160)
    note = models.TextField(blank=True, default="")
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["experience", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self):
        return self.title


class TutorSettings(models.Model):
    experience = models.OneToOneField(
        Experience,
        on_delete=models.CASCADE,
        related_name="tutor_settings",
    )
    assistant_name = models.CharField(max_length=100, default="dee-lou")
    avatar_path = models.CharField(max_length=220, default="test-images/dLU-right.png")
    choice_icon_background = models.CharField(max_length=40, default="#f8ded8")
    realtime_model = models.CharField(max_length=100, default="gpt-realtime-mini")
    classification_model = models.CharField(
        max_length=100,
        default=DEFAULT_CLASSIFICATION_MODEL,
    )
    voice = models.CharField(max_length=40, default="ash")
    system_prompt = models.TextField(blank=True, default="")
    voice_instructions = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Tutor settings"

    def __str__(self):
        return f"Tutor settings for {self.experience}"


class ExperienceEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    experience = models.ForeignKey(
        Experience,
        on_delete=models.CASCADE,
        related_name="events",
    )
    title = models.CharField(max_length=160, default="Start")
    slug = models.SlugField(max_length=180)
    description = models.TextField(blank=True, default="")
    on_entry_dsl_source = models.TextField(blank=True, default="")
    conversation_dsl_source = models.TextField(blank=True, default="")
    chat_instructions = models.TextField(blank=True, default="")
    conversation_choices = models.JSONField(blank=True, default=list)
    is_start = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["experience", "slug"],
                name="unique_experience_event_slug",
            ),
        ]
        indexes = [
            models.Index(
                fields=["experience", "sort_order"],
                name="core_experi_experie_997895_idx",
            ),
        ]

    def __str__(self):
        return f"{self.experience}: {self.title}"


class SidePanelSetting(models.Model):
    """Per-user global defaults for a registered side panel (icon, title).

    Per-experience overrides in Experience.side_panels win over these;
    these win over the registry's built-in glyph/label.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="side_panel_settings",
    )
    panel_id = models.CharField(max_length=60)
    icon_path = models.CharField(max_length=220, blank=True, default="")
    title = models.CharField(max_length=80, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "panel_id"],
                name="unique_side_panel_setting_per_user",
            )
        ]

    def __str__(self):
        return f"{self.user}: {self.panel_id}"


class EventActionStep(models.Model):
    class ActionType(models.TextChoices):
        SCRIPT = "script", "Script"
        SET_CONTEXT = "set_context", "Set context"
        APPEND_CONTEXT_LIST = "append_context_list", "Append context list"
        GET_UI_STATE = "get_ui_state", "Get UI state"
        HIGHLIGHT_ON = "highlight_on", "Highlight on"
        HIGHLIGHT_OFF = "highlight_off", "Highlight off"
        INTERACTIVE = "interactive", "Interactive"
        INTERACTIVE_UPDATE = "interactive_update", "Update interactive"
        INTERACTIVE_CLEAR = "interactive_clear", "Clear interactive"
        PYTHON_NOTEBOOK = "python_notebook", "Python notebook"
        CHAT_AVAILABILITY = "chat_availability", "Chat availability"
        SET_UI_TRIGGER = "set_ui_trigger", "Set UI trigger"
        SIDE_PANEL = "side_panel", "Side panel"
        ROADMAP_COMPLETE = "roadmap_complete", "Roadmap complete"
        GOTO_EVENT = "goto_event", "Go to event"
        BUTTON_CHOICE = "button_choice", "Button choice"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        ExperienceEvent,
        on_delete=models.CASCADE,
        related_name="steps",
    )
    action_type = models.CharField(
        max_length=40,
        choices=ActionType.choices,
        default=ActionType.SCRIPT,
    )
    label = models.CharField(max_length=160, blank=True, default="")
    config = models.JSONField(default=dict, blank=True)
    condition = models.JSONField(default=dict, blank=True)
    enabled = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "created_at"]
        indexes = [
            models.Index(
                fields=["event", "sort_order"],
                name="core_eventa_event_i_f33e77_idx",
            ),
            models.Index(
                fields=["action_type"],
                name="core_eventa_action__9770a9_idx",
            ),
        ]

    def __str__(self):
        return f"{self.event}: {self.action_type}"


class EventChatTool(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        ExperienceEvent,
        on_delete=models.CASCADE,
        related_name="chat_tools",
    )
    name = models.CharField(max_length=64)
    description = models.TextField(blank=True, default="")
    parameters = models.JSONField(default=dict, blank=True)
    handler_actions = models.JSONField(default=list, blank=True)
    triggers_event = models.SlugField(max_length=180, blank=True, default="")
    save_argument = models.CharField(max_length=120, blank=True, default="")
    save_context_key = models.CharField(max_length=120, blank=True, default="")
    enabled = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["event", "name"],
                name="unique_event_chat_tool_name",
            ),
        ]
        indexes = [
            models.Index(
                fields=["event", "sort_order"],
                name="core_eventc_event_i_4c7224_idx",
            ),
        ]

    def __str__(self):
        return f"{self.event}: {self.name}"


class EventConversationCheck(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        ExperienceEvent,
        on_delete=models.CASCADE,
        related_name="conversation_checks",
    )
    title = models.CharField(max_length=160, blank=True, default="Check")
    instructions = models.TextField(blank=True, default="")
    result_context_key = models.CharField(max_length=120, blank=True, default="")
    handler_actions = models.JSONField(default=list, blank=True)
    triggers_event = models.SlugField(max_length=180, blank=True, default="")
    enabled = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "created_at"]
        indexes = [
            models.Index(
                fields=["event", "sort_order"],
                name="core_eventc_check_e_0cdcc0_idx",
            ),
        ]

    def __str__(self):
        return f"{self.event}: {self.title or 'Check'}"


class EventClassifierGroup(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        ExperienceEvent,
        on_delete=models.CASCADE,
        related_name="classifier_groups",
    )
    title = models.CharField(max_length=160, blank=True, default="Classifier group")
    instructions = models.TextField(blank=True, default="")
    result_context_key = models.CharField(
        max_length=120,
        blank=True,
        default="_classifier_results",
    )
    handler_actions = models.JSONField(default=list, blank=True)
    triggers_event = models.SlugField(max_length=180, blank=True, default="")
    condition = models.JSONField(default=dict, blank=True)
    enabled = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "created_at"]
        indexes = [
            models.Index(
                fields=["event", "sort_order"],
                name="core_eventcl_group_73c8_idx",
            ),
        ]

    def __str__(self):
        return f"{self.event}: {self.title or 'Classifier group'}"


class EventClassifier(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    group = models.ForeignKey(
        EventClassifierGroup,
        on_delete=models.CASCADE,
        related_name="classifiers",
    )
    name = models.CharField(max_length=64)
    prompt = models.TextField(blank=True, default="")
    schema = models.JSONField(default=dict, blank=True)
    model = models.CharField(max_length=100, blank=True, default="")
    condition = models.JSONField(default=dict, blank=True)
    enabled = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["group", "name"],
                name="unique_event_classifier_name",
            ),
        ]
        indexes = [
            models.Index(
                fields=["group", "sort_order"],
                name="core_eventcl_class_2576_idx",
            ),
        ]

    def __str__(self):
        return f"{self.group}: {self.name}"


class TutoringSession(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="tutoring_sessions",
    )
    experience = models.ForeignKey(
        Experience,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sessions",
    )
    title = models.CharField(max_length=160, blank=True, default="")
    runtime_context = models.JSONField(default=dict, blank=True)
    runtime_state = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]
        indexes = [
            models.Index(fields=["user", "-updated_at"]),
            models.Index(fields=["experience", "-updated_at"]),
        ]

    def __str__(self):
        label = self.title or "Tutoring session"
        return f"{label} ({self.user})"


class ExperienceEventCheckpoint(models.Model):
    class FingerprintMode(models.TextChoices):
        STRUCTURAL = "structural", "Structural"
        FULL = "full", "Full"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    experience = models.ForeignKey(
        Experience,
        on_delete=models.CASCADE,
        related_name="event_checkpoints",
    )
    event = models.ForeignKey(
        ExperienceEvent,
        on_delete=models.CASCADE,
        related_name="checkpoints",
    )
    source_session = models.ForeignKey(
        TutoringSession,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="event_checkpoints",
    )
    fingerprint_mode = models.CharField(
        max_length=20,
        choices=FingerprintMode.choices,
        default=FingerprintMode.STRUCTURAL,
    )
    fingerprint = models.CharField(max_length=64)
    payload = models.JSONField(default=dict, blank=True)
    summary = models.JSONField(default=dict, blank=True)
    run_count = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-last_used_at", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["event", "fingerprint_mode", "fingerprint"],
                name="unique_event_checkpoint_fingerprint",
            ),
        ]
        indexes = [
            models.Index(
                fields=["experience", "event", "-last_used_at"],
                name="core_eventc_experie_36db_idx",
            ),
            models.Index(
                fields=["event", "fingerprint_mode"],
                name="core_eventc_event_i_2f3d_idx",
            ),
        ]

    def __str__(self):
        return f"{self.event}: {self.fingerprint_mode} checkpoint"


class SessionMessage(models.Model):
    class Role(models.TextChoices):
        USER = "user", "User"
        ASSISTANT = "assistant", "Assistant"
        SYSTEM = "system", "System"
        ERROR = "error", "Error"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        TutoringSession,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    role = models.CharField(max_length=20, choices=Role.choices)
    content = models.TextField()
    sequence = models.PositiveIntegerField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sequence", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "sequence"],
                name="unique_session_message_sequence",
            ),
        ]
        indexes = [
            models.Index(fields=["session", "sequence"]),
        ]

    def __str__(self):
        return f"{self.role}: {self.content[:50]}"
