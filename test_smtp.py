import smtplib
import ssl
from app.config import settings

print("SMTP host:", settings.smtp_host)
print("SMTP port:", settings.smtp_port)
print("Username:", settings.smtp_username)
print("Password loaded:", bool(settings.smtp_password))

try:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
        s.set_debuglevel(1)
        s.ehlo()
        s.starttls(context=ssl.create_default_context())
        s.ehlo()
        print("TLS established")
        s.login(settings.smtp_username, settings.smtp_password)
        print("Authentication successful")
except Exception as e:
    print("FAILED:", type(e).__name__, str(e))