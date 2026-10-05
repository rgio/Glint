/** Sends sign-in emails. Production needs a real provider; development logs instead. */
export interface EmailSender {
  sendSignIn(to: string, message: { link: string; code: string; expiresInMinutes: number }): Promise<void>;
}

/** Development: writes the email to the log so you can click the link or type the code. */
export class LogEmailSender implements EmailSender {
  constructor(private log: (message: string) => void) {}

  async sendSignIn(to: string, { link, code, expiresInMinutes }: { link: string; code: string; expiresInMinutes: number }) {
    this.log(`Sign-in email for ${to} (expires in ${expiresInMinutes} min): code ${code}, link ${link}`);
  }
}
