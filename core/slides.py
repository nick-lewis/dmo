import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

import requests
from django.conf import settings


SLIDE_CACHE_FOLDER = "gslide_temp"
SLIDE_EXPORT_WIDTH = 1920
SLIDE_REQUEST_TIMEOUT = 20
MAX_SLIDE_NUMBER = 500


class SlideResolutionError(ValueError):
    pass


class SlideFetchError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeckReference:
    presentation_id: str
    is_published: bool


@dataclass(frozen=True)
class ResolvedSlideImage:
    presentation_id: str
    page_id: str
    filename: str
    path: Path
    cache_hit: bool


def extract_presentation_reference(value):
    text = str(value or "").strip()
    if not text:
        raise SlideResolutionError("Deck URL is required.")

    published_match = re.search(
        r"docs\.google\.com/presentation/d/e/([A-Za-z0-9_-]+)",
        text,
    )
    if published_match:
        return DeckReference(published_match.group(1), True)

    standard_match = re.search(
        r"docs\.google\.com/presentation/d/([A-Za-z0-9_-]+)",
        text,
    )
    if standard_match:
        return DeckReference(standard_match.group(1), False)

    raw_id_match = re.fullmatch(r"[A-Za-z0-9_-]{20,}", text)
    if raw_id_match:
        return DeckReference(text, False)

    raise SlideResolutionError("Use a Google Slides sharing URL or presentation id.")


def get_standard_page_id(slide_number):
    return "p" if slide_number == 1 else f"p{slide_number - 1}"


def normalize_slide_ref(value):
    slide_ref = str(value or "1").strip() or "1"
    slide_ref = slide_ref.removeprefix("#")
    slide_ref = slide_ref.removeprefix("slide=")
    slide_ref = slide_ref.removeprefix("id.")

    if len(slide_ref) > 120:
        raise SlideResolutionError("Slide reference is too long.")

    if slide_ref.isdigit():
        slide_number = int(slide_ref)
        if slide_number < 1 or slide_number > MAX_SLIDE_NUMBER:
            raise SlideResolutionError(
                f"Slide number must be between 1 and {MAX_SLIDE_NUMBER}."
            )
        return slide_ref

    if not re.fullmatch(r"[A-Za-z0-9_.-]+", slide_ref):
        raise SlideResolutionError("Slide reference can only contain letters, numbers, dots, dashes, and underscores.")

    return slide_ref


def slide_cache_dir():
    path = Path(settings.MEDIA_ROOT) / SLIDE_CACHE_FOLDER
    path.mkdir(parents=True, exist_ok=True)
    return path


def slide_index_path(deck):
    suffix = "published" if deck.is_published else "standard"
    return slide_cache_dir() / (
        f"{safe_filename_part(deck.presentation_id)}_{suffix}_index.json"
    )


def read_cached_page_ids(deck):
    path = slide_index_path(deck)
    if not path.exists():
        return []

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

    page_ids = payload.get("pageIds") if isinstance(payload, dict) else None
    if not isinstance(page_ids, list):
        return []

    return [
        str(page_id)
        for page_id in page_ids
        if isinstance(page_id, str) and re.fullmatch(r"[A-Za-z0-9_.-]+", page_id)
    ]


def write_cached_page_ids(deck, page_ids):
    if not page_ids:
        return

    path = slide_index_path(deck)
    try:
        path.write_text(
            json.dumps(
                {
                    "isPublished": deck.is_published,
                    "pageIds": page_ids,
                    "presentationId": deck.presentation_id,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    except OSError:
        pass


def get_slide_image_path(filename):
    if filename != Path(filename).name or not filename.endswith(".png"):
        raise SlideResolutionError("Slide image filename is invalid.")

    return slide_cache_dir() / filename


def safe_filename_part(value):
    return re.sub(r"[^A-Za-z0-9_-]+", "_", value)[:80].strip("_") or "slide"


def slide_filename(presentation_id, page_id, width=SLIDE_EXPORT_WIDTH):
    digest = hashlib.sha1(
        f"{presentation_id}:{page_id}:{width}".encode("utf-8")
    ).hexdigest()[:12]
    return (
        f"{safe_filename_part(presentation_id)}_"
        f"{safe_filename_part(page_id)}_{digest}.png"
    )


def google_headers():
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
        )
    }


def deck_path(deck):
    return f"/presentation/d/e/{deck.presentation_id}" if deck.is_published else f"/presentation/d/{deck.presentation_id}"


def discover_page_ids(deck):
    embed_url = f"https://docs.google.com{deck_path(deck)}/embed"

    try:
        response = requests.get(
            embed_url,
            headers=google_headers(),
            timeout=SLIDE_REQUEST_TIMEOUT,
        )
        response.raise_for_status()
    except requests.RequestException:
        return []

    patterns = [
        r'\["(i\d+)",\s*\d+\s*,\s*"',
        # Modern Google Slides embed pages expose slide records in a docData
        # payload. The actual page id is the first value in each slide record;
        # nested object ids can look similar but do not appear in this position.
        r'(?:\[\s*\[|,\s*\[)\s*"(g[A-Za-z0-9_]+_\d+_\d+)",\s*\d+\s*,',
        r'"slideId"\s*:\s*"([^"]+)"',
        r'data-slide-id=["\']([^"\']+)["\']',
        r'slide=id\.([A-Za-z0-9_.-]+)',
        r"pageid=([A-Za-z0-9_.-]+)",
        r'"id"\s*:\s*"([pgi][A-Za-z0-9_.-]*)"',
    ]

    for pattern in patterns:
        page_ids = []
        seen = set()
        for match in re.finditer(pattern, response.text):
            page_id = match.group(1).removeprefix("id.")
            if page_id in seen:
                continue
            seen.add(page_id)
            page_ids.append(page_id)

        if page_ids:
            write_cached_page_ids(deck, page_ids)
            return page_ids

    return []


def candidate_page_ids(deck, slide_ref):
    normalized_ref = normalize_slide_ref(slide_ref)
    if not normalized_ref.isdigit():
        return [normalized_ref]

    slide_number = int(normalized_ref)
    candidates = []
    discovered_ids = read_cached_page_ids(deck)
    if len(discovered_ids) < slide_number:
        discovered_ids = discover_page_ids(deck)
    if len(discovered_ids) >= slide_number:
        candidates.append(discovered_ids[slide_number - 1])
    elif discovered_ids:
        raise SlideResolutionError(
            f"Slide {slide_number} was not found in that deck. "
            f"DMO discovered {len(discovered_ids)} slide"
            f"{'' if len(discovered_ids) == 1 else 's'}; use the Google "
            "slide page id from the URL if this slide exists."
        )

    standard_page_id = get_standard_page_id(slide_number)
    if standard_page_id not in candidates:
        candidates.append(standard_page_id)

    return candidates


def export_urls(deck, page_id, width=SLIDE_EXPORT_WIDTH):
    params = f"id={deck.presentation_id}&pageid={page_id}&sz=w{width}"
    urls = [f"https://docs.google.com{deck_path(deck)}/export/png?{params}"]
    if deck.is_published:
        urls.append(
            f"https://docs.google.com/presentation/d/{deck.presentation_id}/export/png?{params}"
        )
    return urls


def fetch_slide_image(deck, page_id, width=SLIDE_EXPORT_WIDTH):
    last_error = "Google Slides did not return an image for that slide."

    for url in export_urls(deck, page_id, width):
        try:
            response = requests.get(
                url,
                headers=google_headers(),
                timeout=SLIDE_REQUEST_TIMEOUT,
            )
        except requests.RequestException as error:
            last_error = str(error)
            continue

        content_type = response.headers.get("content-type", "")
        if response.ok and "image" in content_type.lower() and response.content:
            return response.content

        if response.status_code in {401, 403, 404}:
            last_error = (
                "Google could not export this slide. The deck may need public "
                "link access, or the slide reference may not exist."
            )
        elif response.status_code >= 400:
            last_error = f"Google returned {response.status_code} while exporting the slide."

    raise SlideFetchError(last_error)


def resolve_slide_image(deck_url, slide_ref="1", force_refresh=False):
    deck = extract_presentation_reference(deck_url)
    last_error = None

    for page_id in candidate_page_ids(deck, slide_ref):
        filename = slide_filename(deck.presentation_id, page_id)
        path = slide_cache_dir() / filename

        if path.exists() and not force_refresh:
            return ResolvedSlideImage(
                presentation_id=deck.presentation_id,
                page_id=page_id,
                filename=filename,
                path=path,
                cache_hit=True,
            )

        try:
            image_bytes = fetch_slide_image(deck, page_id)
        except SlideFetchError as error:
            last_error = error
            continue

        path.write_bytes(image_bytes)
        return ResolvedSlideImage(
            presentation_id=deck.presentation_id,
            page_id=page_id,
            filename=filename,
            path=path,
            cache_hit=False,
        )

    if last_error:
        raise last_error

    raise SlideFetchError("Could not resolve that slide.")
