def require_reason(v: str | None, min_length: int = 10, max_length: int = 500) -> str:
    """Shared "reason for X" field validation. Real bug, found 2026-10-24:
    every reason/note field across the app (vendor reject/suspend/blacklist,
    vendor document reject, mapping reject/suspend, override rejection) had
    its own ad hoc check -- most only rejected a totally empty string, none
    rejected whitespace-only or checked a minimum length, and messages
    differed field to field. One validator, reused everywhere a reason is
    required, so the rule and its wording can't drift apart again. Mirrors
    the frontend's identical check in components/ReasonDialog.tsx -- the
    messages below are exactly what that dialog shows inline, so a request
    that somehow reaches the API without going through it (or a stale
    frontend) still gets the same explanation, not a generic 422.
    """
    trimmed = (v or "").strip()
    if not trimmed:
        raise ValueError("Reason is required")
    if len(trimmed) < min_length:
        raise ValueError("Enter at least 10 characters")
    if len(trimmed) > max_length:
        raise ValueError(f"Keep it under {max_length} characters")
    return trimmed
