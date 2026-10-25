import { Resend } from "resend";

export async function sendEmailNotification(
  notification,
  client = null,
) {
  const { RESEND_API_KEY, EMAIL_FROM } = process.env;

  if (!RESEND_API_KEY || !EMAIL_FROM) {
    throw new Error("Email provider is not configured");
  }

  const resend = client ?? new Resend(RESEND_API_KEY);

  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: notification.recipient,
    subject: "NotifyFlow notification",
    text: notification.message,
  });

  if (error) {
    throw new Error(`Resend delivery failed: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error("Resend did not confirm email acceptance");
  }

  return data;
}
