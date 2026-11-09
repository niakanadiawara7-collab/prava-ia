// Envoi des e-mails (devis, factures, relances, mot de passe oublié) par SMTP.
// Marche avec n'importe quel fournisseur : Brevo, OVH, Gmail, Mailjet, Scaleway TEM…
import nodemailer from "nodemailer";

let transport = null;
export const mailEnabled = () => Boolean(process.env.SMTP_HOST);

function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// Transforme le texte en HTML simple et rend les liens cliquables
const toHtml = (text) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px">${esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</div>`;

export async function sendEmail({ to, subject, text, fromName, replyTo, attachments }) {
  if (!mailEnabled()) return { simulated: true };
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const addr = /<(.+)>/.exec(from)?.[1] || from;
  await getTransport().sendMail({
    from: fromName ? `"${String(fromName).replace(/"/g, "")}" <${addr}>` : from,
    to, subject, text, html: toHtml(text), replyTo: replyTo || undefined, attachments,
  });
  return { ok: true };
}
