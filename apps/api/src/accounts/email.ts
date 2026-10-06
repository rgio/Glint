export type SignInMessage = { link: string; code: string; expiresInMinutes: number };

/** Sends sign-in emails. Production needs a real provider; development logs instead. */
export interface EmailSender {
  sendSignIn(to: string, message: SignInMessage): Promise<void>;
}

/** The provider didn't accept the email. The request answers 503 so the app can offer a retry. */
export class EmailDeliveryError extends Error {}

/** Development: writes the email to the log so you can click the link or type the code. */
export class LogEmailSender implements EmailSender {
  constructor(private log: (message: string) => void) {}

  async sendSignIn(to: string, { link, code, expiresInMinutes }: SignInMessage) {
    this.log(`Sign-in email for ${to} (expires in ${expiresInMinutes} min): code ${code}, link ${link}`);
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The sign-in email's subject and bodies. The code leads the subject so it shows in notifications. */
export function renderSignInEmail({ link, code, expiresInMinutes }: SignInMessage) {
  const subject = `${code} is your sign-in code`;
  const text = [
    `Your sign-in code is ${code}.`,
    '',
    `Or open this link on the device you're signing in on:`,
    link,
    '',
    `The code and link work once and expire in ${expiresInMinutes} minutes.`,
    "If you didn't ask to sign in, you can ignore this email.",
  ].join('\n');
  const html = `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; color: #111; line-height: 1.5">
<p>Your sign-in code is</p>
<p style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 8px 0">${escapeHtml(code)}</p>
<p>Or <a href="${escapeHtml(link)}">sign in with this link</a> on the device you're signing in on.</p>
<p style="color: #666; font-size: 14px">The code and link work once and expire in ${expiresInMinutes} minutes.
If you didn't ask to sign in, you can ignore this email.</p>
</body></html>`;
  return { subject, text, html };
}

type HttpSenderOptions = { apiKey: string; from: string; fetch?: typeof fetch };

/** Shared by the HTTP providers: one POST per email, and any non-2xx is a delivery failure. */
abstract class HttpEmailSender implements EmailSender {
  protected readonly fetch: typeof fetch;

  constructor(protected readonly options: HttpSenderOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  protected abstract request(to: string, email: ReturnType<typeof renderSignInEmail>): { url: string; init: RequestInit };

  async sendSignIn(to: string, message: SignInMessage) {
    const { url, init } = this.request(to, renderSignInEmail(message));
    let res: Response;
    try {
      res = await this.fetch(url, { ...init, method: 'POST', signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      throw new EmailDeliveryError(`Email provider unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new EmailDeliveryError(`Email provider answered ${res.status}: ${detail}`);
    }
  }
}

/** https://resend.com/docs/api-reference/emails/send-email */
export class ResendEmailSender extends HttpEmailSender {
  protected request(to: string, { subject, text, html }: ReturnType<typeof renderSignInEmail>) {
    return {
      url: 'https://api.resend.com/emails',
      init: {
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.options.from, to: [to], subject, text, html }),
      },
    };
  }
}

/** https://postmarkapp.com/developer/api/email-api */
export class PostmarkEmailSender extends HttpEmailSender {
  protected request(to: string, { subject, text, html }: ReturnType<typeof renderSignInEmail>) {
    return {
      url: 'https://api.postmarkapp.com/email',
      init: {
        headers: {
          'x-postmark-server-token': this.options.apiKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          From: this.options.from,
          To: to,
          Subject: subject,
          TextBody: text,
          HtmlBody: html,
          MessageStream: 'outbound',
        }),
      },
    };
  }
}
