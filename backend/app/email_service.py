import logging
import smtplib
import ssl
from html import escape
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)


def welcome_email_configured() -> bool:
    """Return whether enough SMTP configuration exists to attempt delivery."""
    return bool(settings.SMTP_HOST.strip() and settings.SMTP_FROM_EMAIL.strip())


def send_form_welcome_email(recipient: str, recipient_name: str, form_name: str) -> None:
    """Send a branded completion confirmation with a plain-text fallback."""
    if not welcome_email_configured():
        return

    greeting = recipient_name.strip() or 'there'
    body = (
        f"Hello {greeting},\n\n"
        f"Welcome, and thank you for completing {form_name}. "
        "Your form responses have been received successfully.\n\n"
        "You can contact the organization that sent you this form if you need help.\n\n"
        "Thank you,\nMahi Forms"
    )
    try:
        send_email(recipient, f"Welcome - {form_name} completed", body)
    except Exception:
        # Email delivery must not roll back a form that has already been completed.
        logger.exception("Could not deliver the form completion email.")


def send_email(recipient: str, subject: str, body: str) -> None:
    """Send a branded HTML email and plain-text alternative over configured SMTP."""
    if not welcome_email_configured():
        raise RuntimeError("Email delivery is not configured.")

    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = settings.SMTP_FROM_EMAIL.strip()
    message['To'] = recipient
    message.set_content(body)
    message.add_alternative(_render_html_email(subject, body), subtype='html')

    security_mode = settings.SMTP_SECURITY
    if security_mode == 'ssl':
        with smtplib.SMTP_SSL(
            settings.SMTP_HOST.strip(),
            settings.SMTP_PORT,
            timeout=15,
            context=ssl.create_default_context(),
        ) as server:
            _deliver(server, message)
    elif security_mode == 'starttls':
        with smtplib.SMTP(settings.SMTP_HOST.strip(), settings.SMTP_PORT, timeout=15) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            _deliver(server, message)
    else:
        raise ValueError("SMTP_SECURITY must be 'starttls' or 'ssl'.")


def _deliver(server: smtplib.SMTP, message: EmailMessage) -> None:
    if settings.SMTP_USERNAME:
        server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
    server.send_message(message)


def _render_html_email(subject: str, body: str) -> str:
    """Render a self-contained, email-client-friendly Mahi message."""
    safe_subject = escape(subject)
    paragraphs = []
    for block in body.strip().split('\n\n'):
        safe_block = escape(block.strip()).replace('\n', '<br>')
        if safe_block:
            paragraphs.append(
                '<p style="margin:0 0 16px;color:#d6cce2;font-size:15px;'
                'line-height:1.7;">' + safe_block + '</p>'
            )
    message_content = ''.join(paragraphs)

    # Table layout and inline styles are intentional for Gmail/Outlook support.
    return f'''<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>{safe_subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0c0812;color:#f8f5fc;"
        bgcolor="#0c0812">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      {safe_subject} — Mahi Voice Forms
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
           border="0" style="background-color:#0c0812;" bgcolor="#0c0812">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0"
                 border="0" style="width:100%;max-width:600px;">
            <tr>
              <td style="padding:0 0 18px 4px;font-family:Arial,Helvetica,sans-serif;">
                <span style="display:inline-block;padding:8px 12px;border:1px solid #563276;
                  border-radius:12px;background-color:#21152e;color:#e4b8ff;font-size:14px;
                  font-weight:bold;letter-spacing:1.5px;">MAHI</span>
                <span style="padding-left:10px;color:#a99ab9;font-size:12px;">VOICE FORMS</span>
              </td>
            </tr>
            <tr>
              <td style="padding:1px;border-radius:22px;background-color:#563276;"
                  bgcolor="#563276">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                       border="0" style="border-radius:21px;background-color:#19121f;"
                       bgcolor="#19121f">
                  <tr>
                    <td style="padding:32px 30px 18px;font-family:Arial,Helvetica,sans-serif;">
                      <div style="margin-bottom:12px;color:#c77dff;font-size:11px;
                        font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">
                        Mahi Voice Forms
                      </div>
                      <h1 style="margin:0;color:#fbf8ff;font-size:25px;line-height:1.25;">
                        {safe_subject}
                      </h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 30px 20px;font-family:Arial,Helvetica,sans-serif;">
                      <div style="height:1px;background-color:#382941;font-size:1px;line-height:1px;">&nbsp;</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 30px 20px;font-family:Arial,Helvetica,sans-serif;">
                      {message_content}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 12px 0;font-family:Arial,Helvetica,sans-serif;
                color:#8e809e;font-size:12px;line-height:1.6;">
                Sent by Mahi Voice Forms. Please contact your administrator if you need assistance.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>'''
