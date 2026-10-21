import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)


def send_email(to: str, subject: str, body: str) -> bool:
    """The one place anything in this app actually sends an email -- an
    adapter (spec §13.1's Email/SMS gateway integration boundary), not a
    hardcoded provider. `settings.email_backend` picks the implementation:

    - "console" (default): logs the email instead of sending it. This is
      what local dev and CI run with -- no SMTP credentials needed, and
      nothing ever mails a real vendor by accident just because the app was
      started. Matches notifier.py's own "logged rather than pretended"
      rule for the in-app notification this usually accompanies.
    - "smtp": sends for real, over plain SMTP (stdlib smtplib -- no
      additional dependency) against whatever mailbox/relay the hospital
      already has. Deliberately not a third-party transactional-email API
      (SendGrid/SES/etc.) -- this app has nowhere near the volume to justify
      a new paid dependency and vendor account (CLAUDE.md: no unnecessary
      dependencies).

    Returns whether the email was actually sent (or logged, for "console"),
    not whether the caller's underlying action should be considered to have
    failed -- callers should treat a False here as "the notification didn't
    go out," never as a reason to roll back the thing that triggered it."""

    if settings.email_backend == "smtp":
        return _send_smtp(to, subject, body)

    logger.info("[email:console] to=%s subject=%r\n%s", to, subject, body)
    return True


def _send_smtp(to: str, subject: str, body: str) -> bool:
    if not settings.smtp_host:
        logger.error("email_backend=smtp but smtp_host is not set -- email to %s not sent", to)
        return False

    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(msg)
        return True
    except Exception:
        # Never let a flaky mail server break the business operation that
        # triggered this (a vendor decision, an award, ...) -- the caller
        # already wrote its own record of what happened; email is best-effort
        # on top of that, not the thing of record.
        logger.exception("Could not send email to %s", to)
        return False
