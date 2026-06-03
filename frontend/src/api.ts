export function getCookie(name: string) {
  const cookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split("=")[1]) : "";
}

export function getCurrentPath() {
  return `${window.location.pathname}${window.location.search}`;
}

export function experienceRunPath(experienceId: string) {
  return `/experiences/${encodeURIComponent(experienceId)}/run`;
}

export function experienceEditPath(experienceId: string) {
  return `/experiences/${encodeURIComponent(experienceId)}/edit`;
}

export function routeExperience(pathname: string) {
  const match = pathname.match(/^\/experiences\/([^/]+)(?:\/(run|edit))?\/?$/);
  if (!match) return { experienceId: "", mode: "" };

  return {
    experienceId: decodeURIComponent(match[1]),
    mode: match[2] || "edit",
  };
}

export async function apiFetch<T>(url: string, options: RequestInit = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("X-Current-Path", getCurrentPath());

  if (method !== "GET" && method !== "HEAD") {
    headers.set("X-CSRFToken", getCookie("csrftoken"));
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers,
  });
  const data = (await response.json().catch(() => null)) as unknown;
  const responseObject =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};

  if (response.status === 401) {
    const loginUrl =
      typeof responseObject.loginUrl === "string"
        ? responseObject.loginUrl
        : "/accounts/login/";
    window.location.assign(loginUrl);
    throw new Error("Authentication required.");
  }

  if (!response.ok) {
    const detail =
      typeof responseObject.detail === "string" ? responseObject.detail : "";
    throw new Error(detail || "Request failed.");
  }

  return data as T;
}
