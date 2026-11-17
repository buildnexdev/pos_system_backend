/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Super Admin payment history CRUD + mail config
 * Edit Date: 2026-11-14
 */

import db from '../config/db';
import { ok, fail } from '../utils/helpers';
import { isSuperAdmin } from '../utils/companyScope';
import {
  getMailConfig,
  publicMailConfig,
  sendMail,
  sendPaymentNotification,
} from '../utils/mail';

function requireSuper(req, res) {
  if (!isSuperAdmin(req.user)) {
    fail(res, 'Only Super Admin can manage payments', 403);
    return false;
  }
  return true;
}

const SELECT = `
  SELECT p.paymentHistoryID AS id, p.paymentHistoryID, p.companyID, p.invoice_no, p.amount, p.currency,
         p.payment_method, p.payment_status, p.paid_at, p.reference_no, p.notes, p.notify_email,
         p.created_at, p.updated_at,
         c.name AS company_name, c.code AS company_code, c.email AS company_email
  FROM tblPaymentHistory p
  LEFT JOIN tblCompany c ON c.companyID = p.companyID
`;

export const listPayments = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const q = String(req.query.q || '').trim();
    const params: any = {};
    let where = '';
    if (q) {
      where = `WHERE c.name LIKE :q OR c.code LIKE :q OR p.invoice_no LIKE :q OR p.reference_no LIKE :q OR p.notify_email LIKE :q`;
      params.q = `%${q}%`;
    }
    const [items] = await db.query(
      `${SELECT} ${where} ORDER BY p.paid_at DESC, p.paymentHistoryID DESC`,
      params
    );
    return ok(res, { items });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load payments', 500);
  }
};

export const getPayment = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const [rows] = await db.query(`${SELECT} WHERE p.paymentHistoryID = :id LIMIT 1`, {
      id: Number(req.params.id),
    });
    if (!rows.length) return fail(res, 'Payment not found', 404);
    return ok(res, { item: rows[0] });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load payment', 500);
  }
};

export const savePayment = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const isUpdate = Boolean(req.params.id);
    const companyID = Number(req.body.companyID || req.body.company_id);
    if (!companyID) return fail(res, 'Company is required', 400);

    const [companies] = await db.query(
      'SELECT companyID, name, email FROM tblCompany WHERE companyID = :id LIMIT 1',
      { id: companyID }
    );
    if (!companies.length) return fail(res, 'Company not found', 404);

    const data = {
      companyID,
      invoice_no: req.body.invoice_no || null,
      amount: Number(req.body.amount || 0),
      currency: req.body.currency || 'INR',
      payment_method: req.body.payment_method || null,
      payment_status: req.body.payment_status || 'pending',
      paid_at: req.body.paid_at || null,
      reference_no: req.body.reference_no || null,
      notes: req.body.notes || null,
      notify_email: req.body.notify_email || companies[0].email || null,
    };

    if (!(data.amount >= 0)) return fail(res, 'Amount is required', 400);

    let id = isUpdate ? Number(req.params.id) : null;
    if (isUpdate) {
      await db.query(
        `UPDATE tblPaymentHistory SET
         companyID=:companyID, invoice_no=:invoice_no, amount=:amount, currency=:currency,
         payment_method=:payment_method, payment_status=:payment_status, paid_at=:paid_at,
         reference_no=:reference_no, notes=:notes, notify_email=:notify_email
         WHERE paymentHistoryID=:id`,
        { ...data, id }
      );
    } else {
      const [result] = await db.query(
        `INSERT INTO tblPaymentHistory
         (companyID, invoice_no, amount, currency, payment_method, payment_status, paid_at, reference_no, notes, notify_email)
         VALUES
         (:companyID, :invoice_no, :amount, :currency, :payment_method, :payment_status, :paid_at, :reference_no, :notes, :notify_email)`,
        data
      );
      id = result.insertId;
    }

    let mailSent = false;
    let mailError: string | null = null;
    const shouldNotify = req.body.send_mail === true || req.body.send_mail === 1 || req.body.send_mail === '1';
    if (shouldNotify && data.notify_email) {
      try {
        await sendPaymentNotification({
          to: data.notify_email,
          companyName: companies[0].name,
          invoice_no: data.invoice_no,
          amount: data.amount,
          currency: data.currency,
          payment_status: data.payment_status,
          payment_method: data.payment_method,
          reference_no: data.reference_no,
          paid_at: data.paid_at,
        });
        mailSent = true;
      } catch (e: any) {
        mailError = e.message || 'Mail failed';
        console.warn('Payment mail failed:', mailError);
      }
    }

    return ok(
      res,
      { id, mailSent, mailError },
      isUpdate ? 'Payment updated' : 'Payment created',
      isUpdate ? 200 : 201
    );
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not save payment', 500);
  }
};

export const deletePayment = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    await db.query('DELETE FROM tblPaymentHistory WHERE paymentHistoryID = :id', {
      id: Number(req.params.id),
    });
    return ok(res, {}, 'Payment deleted');
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not delete payment', 500);
  }
};

export const getMailSettings = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const cfg = await getMailConfig();
    return ok(res, { item: publicMailConfig(cfg) });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load mail config', 500);
  }
};

export const saveMailSettings = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const from_email = String(req.body.from_email || req.body.smtp_user || 'buildnexdev@gmail.com').trim();
    const smtp_user = String(req.body.smtp_user || from_email).trim();
    const data = {
      from_name: String(req.body.from_name || 'BuildNex ShopOS').trim(),
      from_email,
      smtp_host: String(req.body.smtp_host || 'smtp.gmail.com').trim(),
      smtp_port: Number(req.body.smtp_port || 587),
      smtp_secure: req.body.smtp_secure === true || req.body.smtp_secure === 1 || req.body.smtp_secure === '1' ? 1 : 0,
      smtp_user,
      is_active: req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
    };
    if (!data.from_email || !data.smtp_user) return fail(res, 'Mail user / from email required', 400);

    const [existing] = await db.query('SELECT mailConfigID, smtp_pass FROM tblMailConfig ORDER BY mailConfigID ASC LIMIT 1');
    const newPass = req.body.smtp_pass != null && String(req.body.smtp_pass).trim() !== ''
      ? String(req.body.smtp_pass).trim()
      : null;

    if (existing.length) {
      if (newPass) {
        await db.query(
          `UPDATE tblMailConfig SET from_name=:from_name, from_email=:from_email, smtp_host=:smtp_host,
           smtp_port=:smtp_port, smtp_secure=:smtp_secure, smtp_user=:smtp_user, smtp_pass=:smtp_pass, is_active=:is_active
           WHERE mailConfigID=:id`,
          { ...data, smtp_pass: newPass, id: existing[0].mailConfigID }
        );
      } else {
        await db.query(
          `UPDATE tblMailConfig SET from_name=:from_name, from_email=:from_email, smtp_host=:smtp_host,
           smtp_port=:smtp_port, smtp_secure=:smtp_secure, smtp_user=:smtp_user, is_active=:is_active
           WHERE mailConfigID=:id`,
          { ...data, id: existing[0].mailConfigID }
        );
      }
    } else {
      await db.query(
        `INSERT INTO tblMailConfig
         (from_name, from_email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, is_active)
         VALUES (:from_name, :from_email, :smtp_host, :smtp_port, :smtp_secure, :smtp_user, :smtp_pass, :is_active)`,
        { ...data, smtp_pass: newPass }
      );
    }

    const cfg = await getMailConfig();
    return ok(res, { item: publicMailConfig(cfg) }, 'Mail config saved');
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not save mail config', 500);
  }
};

export const testMailSettings = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const to = String(req.body.to || req.body.email || '').trim() || 'buildnexdev@gmail.com';
    await sendMail({
      to,
      subject: 'BuildNex ShopOS — mail test',
      html: `<p>Mail config works.</p><p>Sent to <b>${to}</b> from platform mail settings.</p>`,
    });
    return ok(res, { to }, 'Test mail sent');
  } catch (err: any) {
    console.error(err);
    return fail(res, err.message || 'Test mail failed', 500);
  }
};
