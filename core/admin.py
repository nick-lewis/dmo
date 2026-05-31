from django.contrib import admin

from .models import (
    EventActionStep,
    EventChatTool,
    EventClassifier,
    EventClassifierGroup,
    EventConversationCheck,
    Experience,
    ExperienceEvent,
    ExperienceSnapshot,
    SessionMessage,
    TutoringSession,
    TutorSettings,
)


class TutorSettingsInline(admin.StackedInline):
    model = TutorSettings
    extra = 0
    fields = (
        "assistant_name",
        "avatar_path",
        "realtime_model",
        "classification_model",
        "voice",
        "system_prompt",
        "voice_instructions",
        "created_at",
        "updated_at",
    )
    readonly_fields = ("created_at", "updated_at")


class SessionMessageInline(admin.TabularInline):
    model = SessionMessage
    extra = 0
    fields = ("sequence", "role", "content", "created_at")
    readonly_fields = ("created_at",)
    ordering = ("sequence",)


class EventActionStepInline(admin.TabularInline):
    model = EventActionStep
    extra = 0
    fields = ("sort_order", "action_type", "label", "enabled", "condition", "config")
    ordering = ("sort_order", "created_at")


class EventChatToolInline(admin.TabularInline):
    model = EventChatTool
    extra = 0
    fields = (
        "sort_order",
        "name",
        "description",
        "triggers_event",
        "save_argument",
        "save_context_key",
        "enabled",
    )
    ordering = ("sort_order", "created_at")


class EventConversationCheckInline(admin.TabularInline):
    model = EventConversationCheck
    extra = 0
    fields = (
        "sort_order",
        "title",
        "instructions",
        "result_context_key",
        "triggers_event",
        "enabled",
    )
    ordering = ("sort_order", "created_at")


class EventClassifierGroupInline(admin.TabularInline):
    model = EventClassifierGroup
    extra = 0
    fields = (
        "sort_order",
        "title",
        "result_context_key",
        "triggers_event",
        "condition",
        "enabled",
    )
    ordering = ("sort_order", "created_at")


class EventClassifierInline(admin.TabularInline):
    model = EventClassifier
    extra = 0
    fields = ("sort_order", "name", "model", "enabled", "condition")
    ordering = ("sort_order", "created_at")


@admin.register(TutoringSession)
class TutoringSessionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "experience",
        "title",
        "status",
        "updated_at",
        "created_at",
    )
    list_filter = ("status", "created_at", "updated_at")
    search_fields = ("title", "experience__title", "user__email", "user__username")
    readonly_fields = ("id", "created_at", "updated_at")
    inlines = [SessionMessageInline]


@admin.register(SessionMessage)
class SessionMessageAdmin(admin.ModelAdmin):
    list_display = ("id", "session", "role", "sequence", "created_at")
    list_filter = ("role", "created_at")
    search_fields = ("content", "session__title", "session__user__email")
    readonly_fields = ("id", "created_at")


@admin.register(Experience)
class ExperienceAdmin(admin.ModelAdmin):
    list_display = ("title", "user", "slug", "updated_at", "created_at")
    search_fields = ("title", "description", "slug", "user__email", "user__username")
    readonly_fields = ("id", "created_at", "updated_at")
    inlines = [TutorSettingsInline]


@admin.register(ExperienceSnapshot)
class ExperienceSnapshotAdmin(admin.ModelAdmin):
    list_display = ("title", "experience", "user", "created_at")
    list_filter = ("created_at",)
    search_fields = ("title", "note", "experience__title", "user__email", "user__username")
    readonly_fields = ("id", "created_at")


@admin.register(TutorSettings)
class TutorSettingsAdmin(admin.ModelAdmin):
    list_display = (
        "experience",
        "assistant_name",
        "realtime_model",
        "classification_model",
        "voice",
    )
    search_fields = ("experience__title", "assistant_name")


@admin.register(ExperienceEvent)
class ExperienceEventAdmin(admin.ModelAdmin):
    list_display = ("title", "experience", "slug", "is_start", "sort_order")
    list_filter = ("is_start", "created_at", "updated_at")
    search_fields = ("title", "description", "slug", "experience__title")
    readonly_fields = ("id", "created_at", "updated_at")
    inlines = [
        EventActionStepInline,
        EventChatToolInline,
        EventConversationCheckInline,
        EventClassifierGroupInline,
    ]


@admin.register(EventActionStep)
class EventActionStepAdmin(admin.ModelAdmin):
    list_display = ("event", "action_type", "label", "enabled", "sort_order")
    list_filter = ("action_type", "enabled")
    search_fields = ("label", "event__title", "event__experience__title")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(EventChatTool)
class EventChatToolAdmin(admin.ModelAdmin):
    list_display = ("event", "name", "triggers_event", "enabled", "sort_order")
    list_filter = ("enabled",)
    search_fields = ("name", "description", "event__title", "event__experience__title")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(EventConversationCheck)
class EventConversationCheckAdmin(admin.ModelAdmin):
    list_display = (
        "event",
        "title",
        "result_context_key",
        "triggers_event",
        "enabled",
        "sort_order",
    )
    list_filter = ("enabled",)
    search_fields = ("title", "instructions", "event__title", "event__experience__title")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(EventClassifierGroup)
class EventClassifierGroupAdmin(admin.ModelAdmin):
    list_display = (
        "event",
        "title",
        "result_context_key",
        "triggers_event",
        "enabled",
        "sort_order",
    )
    list_filter = ("enabled",)
    search_fields = ("title", "instructions", "event__title", "event__experience__title")
    readonly_fields = ("id", "created_at", "updated_at")
    inlines = [EventClassifierInline]


@admin.register(EventClassifier)
class EventClassifierAdmin(admin.ModelAdmin):
    list_display = ("group", "name", "model", "enabled", "sort_order")
    list_filter = ("enabled",)
    search_fields = ("name", "prompt", "group__title", "group__event__title")
    readonly_fields = ("id", "created_at", "updated_at")
