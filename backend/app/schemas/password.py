import re

# Shared by every "set a new password" schema (vendor registration, staff
# account creation, staff password reset) -- centralised per CLAUDE.md so the
# rule is defined and tested once, not duplicated per schema. Does NOT apply
# to logging in with an existing password (an old password that predates this
# rule must keep working), only to creating or resetting one.
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 20


def check_password_strength(v: str) -> str:
    if not MIN_PASSWORD_LENGTH <= len(v) <= MAX_PASSWORD_LENGTH:
        raise ValueError(f"Password must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} characters")
    if not re.search(r"[0-9]", v):
        raise ValueError("Password must include at least one digit")
    if not re.search(r"[a-z]", v):
        raise ValueError("Password must include at least one lowercase letter")
    if not re.search(r"[A-Z]", v):
        raise ValueError("Password must include at least one uppercase letter")
    if not re.search(r"[^A-Za-z0-9]", v):
        raise ValueError("Password must include at least one special character")
    return v
