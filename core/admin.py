from django.contrib import admin

from .models import Experience, SessionMessage, TutoringSession, TutorSettings


class TutorSettingsInline(admin.StackedInline):
    model = TutorSettings
    extra = 0
    fields = (
        "assistant_name",
        "avatar_path",
        "realtime_model",
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


@admin.register(TutorSettings)
class TutorSettingsAdmin(admin.ModelAdmin):
    list_display = ("experience", "assistant_name", "realtime_model", "voice")
    search_fields = ("experience__title", "assistant_name")
