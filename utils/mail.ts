/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: SMTP mail helper (Gmail / custom) using tblMailConfig + .env fallback
 * Edit Date: 2026-11-14
 */

import nodemailer from 'nodemailer';
import db from '../config/db';

export type MailConfigRow = {
  mailConfigID?: number;
  from_name: string;
  from_email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number | boolean;
  smtp_user: string;
  smtp_pass?: string | null;
  is_active?: number | boolean;
};

export async function getMailConfig(): Promise<MailConfigRow | null> {
  try {
    const [rows] = await db.query(
      `SELECT * FROM tblMailConfig WHERE is_active = 1 ORDER BY mailConfigID ASC LIMIT 1`
    );
    if (rows.length) return rows[0] as MailConfigRow;
  } catch {
    // table may not exist yet
  }

  const user = process.env.MAIL_USER || 'buildnexdev@gmail.com';
  if (!user) return null;
  return {
    from_name: process.env.MAIL_FROM_NAME || 'BuildNex ShopOS',
    from_email: process.env.MAIL_FROM || user,
    smtp_host: process.env.MAIL_HOST || 'smtp.gmail.com',
    smtp_port: Number(process.env.MAIL_PORT || 587),
    smtp_secure: process.env.MAIL_SECURE === '1' || process.env.MAIL_SECURE === 'true',
    smtp_user: user,
    smtp_pass: process.env.MAIL_PASS || null,
    is_active: 1,
  };
}

export function publicMailConfig(cfg: MailConfigRow | null) {
  if (!cfg) return null;
  return {
    mailConfigID: cfg.mailConfigID || null,
    from_name: cfg.from_name,
    from_email: cfg.from_email,
    smtp_host: cfg.smtp_host,
    smtp_port: cfg.smtp_port,
    smtp_secure: !!cfg.smtp_secure,
    smtp_user: cfg.smtp_user,
    has_password: Boolean(cfg.smtp_pass || process.env.MAIL_PASS),
    is_active: cfg.is_active === undefined ? 1 : cfg.is_active ? 1 : 0,
  };
}

async function createTransport(cfg: MailConfigRow) {
  const pass = cfg.smtp_pass || process.env.MAIL_PASS || '';
  if (!cfg.smtp_user || !pass) {
    throw new Error('Mail not configured — set SMTP user and app password');
  }
  return nodemailer.createTransport({
    host: cfg.smtp_host || 'smtp.gmail.com',
    port: Number(cfg.smtp_port || 587),
    secure: !!cfg.smtp_secure,
    auth: {
      user: cfg.smtp_user,
      pass,
    },
  });
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  const cfg = await getMailConfig();
  if (!cfg) throw new Error('Mail config missing');
  const transport = await createTransport(cfg);
  const from = `"${cfg.from_name || 'BuildNex ShopOS'}" <${cfg.from_email || cfg.smtp_user}>`;
  return transport.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text || undefined,
  });
}

export async function sendPaymentNotification(payment: {
  companyName?: string;
  invoice_no?: string | null;
  amount: number | string;
  currency?: string;
  payment_status?: string;
  payment_method?: string | null;
  reference_no?: string | null;
  paid_at?: string | null;
  to: string;
}) {
  const amount = Number(payment.amount || 0).toFixed(2);
  const subject = `Payment ${payment.payment_status || 'update'} — ${payment.invoice_no || 'BuildNex ShopOS'}`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 8px">Payment notification</h2>
      <p style="color:#64748b;margin:0 0 16px">BuildNex ShopOS platform billing</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#64748b">Company</td><td style="padding:8px 0;font-weight:600">${payment.companyName || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Invoice</td><td style="padding:8px 0">${payment.invoice_no || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Amount</td><td style="padding:8px 0;font-weight:600">${payment.currency || 'INR'} ${amount}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Status</td><td style="padding:8px 0">${payment.payment_status || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Method</td><td style="padding:8px 0">${payment.payment_method || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Reference</td><td style="padding:8px 0">${payment.reference_no || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Paid at</td><td style="padding:8px 0">${payment.paid_at || '—'}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Sent from buildnexdev@gmail.com</p>
    </div>
  `;
  return sendMail({ to: payment.to, subject, html });
}
