from django.contrib import admin

from .models import SessionMessage, TutoringSession


class SessionMessageInline(admin.TabularInline):
    model = SessionMessage
    extra = 0
    fields = ("sequence", "role", "content", "created_at")
    readonly_fields = ("created_at",)
    ordering = ("sequence",)


@admin.register(TutoringSession)
class TutoringSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "title", "status", "updated_at", "created_at")
    list_filter = ("status", "created_at", "updated_at")
    search_fields = ("title", "user__email", "user__username")
    readonly_fields = ("id", "created_at", "updated_at")
    inlines = [SessionMessageInline]


@admin.register(SessionMessage)
class SessionMessageAdmin(admin.ModelAdmin):
    list_display = ("id", "session", "role", "sequence", "created_at")
    list_filter = ("role", "created_at")
    search_fields = ("content", "session__title", "session__user__email")
    readonly_fields = ("id", "created_at")
