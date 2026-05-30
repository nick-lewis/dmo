import uuid

from django.conf import settings
from django.db import models


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


class TutorSettings(models.Model):
    experience = models.OneToOneField(
        Experience,
        on_delete=models.CASCADE,
        related_name="tutor_settings",
    )
    assistant_name = models.CharField(max_length=100, default="dee-lou")
    avatar_path = models.CharField(max_length=220, default="test-images/dLU-right.png")
    realtime_model = models.CharField(max_length=100, default="gpt-realtime-mini")
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


class EventActionStep(models.Model):
    class ActionType(models.TextChoices):
        SCRIPT = "script", "Script"
        SET_CONTEXT = "set_context", "Set context"

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
