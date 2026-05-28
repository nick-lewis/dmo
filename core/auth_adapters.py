from allauth.exceptions import ImmediateHttpResponse
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.conf import settings
from django.shortcuts import render


def normalize_email(email):
    return (email or "").strip().lower()


def normalize_domain(domain):
    return normalize_email(domain).removeprefix("@")


class DeepLearningAIAdapter(DefaultSocialAccountAdapter):
    """Allow Google sign-in only for configured email domains."""

    def pre_social_login(self, request, sociallogin):
        email = self._get_social_email(sociallogin)

        if not self._is_allowed_email(email):
            raise ImmediateHttpResponse(
                render(
                    request,
                    "account/access_denied.html",
                    {
                        "attempted_email": email or "unknown",
                        "allowed_domains": settings.ALLOWED_LOGIN_EMAIL_DOMAINS,
                    },
                    status=403,
                )
            )

    def _get_social_email(self, sociallogin):
        candidates = [
            getattr(sociallogin.user, "email", ""),
            sociallogin.account.extra_data.get("email", ""),
        ]
        candidates.extend(
            getattr(email_address, "email", "")
            for email_address in sociallogin.email_addresses
        )

        for candidate in candidates:
            email = normalize_email(candidate)
            if email:
                return email

        return ""

    def _is_allowed_email(self, email):
        if not email or "@" not in email:
            return False

        domain = normalize_domain(email.rsplit("@", 1)[1])
        allowed_domains = {
            normalize_domain(domain)
            for domain in settings.ALLOWED_LOGIN_EMAIL_DOMAINS
        }
        return domain in allowed_domains
