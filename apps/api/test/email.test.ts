import { describe, expect, it } from 'vitest';

import { EmailDeliveryError, PostmarkEmailSender, renderSignInEmail, ResendEmailSender } from '../src/accounts/email';

const message = { link: 'https://listen.example.com/sign-in?token=abc&x=<1>', code: '123456', expiresInMinutes: 15 };

function fakeFetch(status = 200, body = '{}') {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('sign-in email', () => {
  it('leads with the code and escapes the link in HTML', () => {
    const { subject, text, html } = renderSignInEmail(message);
    expect(subject).toBe('123456 is your sign-in code');
    expect(text).toContain(message.link);
    expect(text).toContain('expire in 15 minutes');
    expect(html).toContain('href="https://listen.example.com/sign-in?token=abc&amp;x=&lt;1&gt;"');
  });

  it('sends through Resend', async () => {
    const { fetch, calls } = fakeFetch();
    await new ResendEmailSender({ apiKey: 're_key', from: 'Podcasts <a@example.com>', fetch }).sendSignIn('me@example.com', message);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      from: 'Podcasts <a@example.com>',
      to: ['me@example.com'],
      subject: '123456 is your sign-in code',
    });
  });

  it('sends through Postmark', async () => {
    const { fetch, calls } = fakeFetch();
    await new PostmarkEmailSender({ apiKey: 'pm_key', from: 'a@example.com', fetch }).sendSignIn('me@example.com', message);
    expect(calls[0]!.url).toBe('https://api.postmarkapp.com/email');
    expect((calls[0]!.init.headers as Record<string, string>)['x-postmark-server-token']).toBe('pm_key');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ From: 'a@example.com', To: 'me@example.com', MessageStream: 'outbound' });
  });

  it('turns a refusal or a network failure into a delivery error', async () => {
    const refused = fakeFetch(422, '{"message":"domain not verified"}');
    await expect(
      new ResendEmailSender({ apiKey: 'k', from: 'a@example.com', fetch: refused.fetch }).sendSignIn('me@example.com', message),
    ).rejects.toThrow(new EmailDeliveryError('Email provider answered 422: {"message":"domain not verified"}'));

    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      new PostmarkEmailSender({ apiKey: 'k', from: 'a@example.com', fetch: offline }).sendSignIn('me@example.com', message),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});
