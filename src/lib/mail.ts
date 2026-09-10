/**
 * Outbound email.
 *
 * One `send()` behind a driver switch, so changing provider is a change here
 * and nowhere else. Without RESEND_API_KEY the driver is 'log': messages are
 * printed to the server log rather than sent, which keeps development and
 * preview deploys from mailing real people and lets the reset flow be tested
 * before any provider exists.
 */

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** True when nothing actually left the building. */
  logged?: boolean;
}

function driver(): 'resend' | 'log' {
  return process.env.RESEND_API_KEY ? 'resend' : 'log';
}

function fromAddress(): string {
  // Resend rejects an unverified domain, so the default is their sandbox
  // sender, which works immediately but only delivers to your own address.
  return process.env.MAIL_FROM ?? 'Art Fresh <onboarding@resend.dev>';
}

export async function send(mail: Mail): Promise<SendResult> {
  if (driver() === 'log') {
    console.info(
      `[mail:log] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`,
    );
    return { ok: true, logged: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      // Logged, not thrown: a failed email must never lose the user's work.
      console.error(`[mail] send failed (${res.status}): ${detail}`);
      return { ok: false, error: `${res.status}` };
    }

    const body = (await res.json()) as { id?: string };
    return { ok: true, id: body.id };
  } catch (e) {
    console.error('[mail] send threw', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

// --- templates --------------------------------------------------------------

const BRAND = process.env.NEXT_PUBLIC_APP_NAME ?? 'Art Fresh';

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  );
}

/**
 * Wraps content in a plain, table-free layout. Deliberately simple: heavy
 * HTML is what trips spam filters, and transactional mail needs to arrive.
 */
function layout(heading: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:32px">
    <p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#d40d0d">${BRAND}</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600">${heading}</h1>
    <div style="font-size:14px;line-height:1.6;color:#334155">${body}</div>
    ${
      cta
        ? `<p style="margin:28px 0 0">
             <a href="${cta.url}" style="display:inline-block;background:#d40d0d;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:500">${cta.label}</a>
           </p>
           <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;word-break:break-all">
             If the button doesn't work, paste this into your browser:<br>${cta.url}
           </p>`
        : ''
    }
    <hr style="margin:28px 0 0;border:0;border-top:1px solid #e2e8f0">
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">
      This message was sent by ${BRAND}. If you weren't expecting it, you can ignore it.
    </p>
  </div>
</body></html>`;
}

export function passwordResetMail(to: string, token: string, name?: string): Mail {
  const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const greeting = name ? `Hello ${name},` : 'Hello,';

  return {
    to,
    subject: `Reset your ${BRAND} password`,
    html: layout(
      'Reset your password',
      `<p>${greeting}</p>
       <p>We received a request to reset the password for this account. The link below is valid for one hour and can only be used once.</p>
       <p>If you didn't ask for this, no action is needed — your password stays as it is.</p>`,
      { label: 'Choose a new password', url },
    ),
    text: `${greeting}

We received a request to reset the password for this account.

Open this link to choose a new one (valid for one hour, single use):
${url}

If you didn't ask for this, no action is needed — your password stays as it is.

— ${BRAND}`,
  };
}

export function verifyEmailMail(to: string, token: string, name?: string): Mail {
  const url = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const greeting = name ? `Hello ${name},` : 'Hello,';

  return {
    to,
    subject: `Confirm your email for ${BRAND}`,
    html: layout(
      'Confirm your email address',
      `<p>${greeting}</p>
       <p>Please confirm this address so we can reach you about your trade account application. The link is valid for three days.</p>`,
      { label: 'Confirm my email', url },
    ),
    text: `${greeting}

Please confirm this address so we can reach you about your trade account application.

${url}

The link is valid for three days.

— ${BRAND}`,
  };
}

/** Sent when staff approve an application. */
export function applicationApprovedMail(to: string, customerCode: string, name?: string): Mail {
  const url = `${appUrl()}/portal`;
  const greeting = name ? `Hello ${name},` : 'Hello,';

  return {
    to,
    subject: `Your ${BRAND} trade account is approved`,
    html: layout(
      'Your account is open',
      `<p>${greeting}</p>
       <p>Your trade account application has been approved. Your customer code is <strong>${customerCode}</strong>.</p>
       <p>You can now sign in to place orders at your contracted prices and track every delivery.</p>`,
      { label: 'Go to the portal', url },
    ),
    text: `${greeting}

Your trade account application has been approved.
Your customer code is ${customerCode}.

Sign in to place orders and track deliveries:
${url}

— ${BRAND}`,
  };
}

/** Sent when staff need more information before deciding. */
export function infoRequestedMail(to: string, message: string, applicationId: string): Mail {
  const url = `${appUrl()}/apply/${applicationId}`;

  return {
    to,
    subject: `More information needed for your ${BRAND} application`,
    html: layout(
      'We need a little more information',
      `<p>Our team has reviewed your application and needs the following before we can proceed:</p>
       <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:3px solid #d40d0d">${message}</blockquote>`,
      { label: 'Update my application', url },
    ),
    text: `Our team has reviewed your application and needs the following before we can proceed:

${message}

Update your application here:
${url}

— ${BRAND}`,
  };
}
