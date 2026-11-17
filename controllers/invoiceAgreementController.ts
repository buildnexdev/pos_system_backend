/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Super Admin Invoice & Agreement CRUD
 * Edit Date: 2026-11-14
 */

import db from '../config/db';
import { ok, fail } from '../utils/helpers';
import { isSuperAdmin } from '../utils/companyScope';

function requireSuper(req, res) {
  if (!isSuperAdmin(req.user)) {
    fail(res, 'Only Super Admin can manage invoices & agreements', 403);
    return false;
  }
  return true;
}

const SELECT = `
  SELECT i.invoiceAgreementID AS id, i.invoiceAgreementID, i.companyID, i.doc_type, i.title,
         i.invoice_no, i.amount, i.currency, i.status, i.issue_date, i.due_date, i.file_url, i.notes,
         i.created_at, i.updated_at,
         c.name AS company_name, c.code AS company_code, c.email AS company_email
  FROM tblInvoiceAgreement i
  LEFT JOIN tblCompany c ON c.companyID = i.companyID
`;

export const listItems = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const q = String(req.query.q || '').trim();
    const docType = String(req.query.doc_type || '').trim();
    const params: any = {};
    const where: string[] = [];
    if (q) {
      where.push(
        `(c.name LIKE :q OR c.code LIKE :q OR i.title LIKE :q OR i.invoice_no LIKE :q OR i.status LIKE :q)`
      );
      params.q = `%${q}%`;
    }
    if (docType === 'invoice' || docType === 'agreement') {
      where.push('i.doc_type = :doc_type');
      params.doc_type = docType;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [items] = await db.query(
      `${SELECT} ${whereSql} ORDER BY i.issue_date DESC, i.invoiceAgreementID DESC`,
      params
    );
    return ok(res, { items });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load invoices & agreements', 500);
  }
};

export const getItem = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const [rows] = await db.query(`${SELECT} WHERE i.invoiceAgreementID = :id LIMIT 1`, {
      id: Number(req.params.id),
    });
    if (!rows.length) return fail(res, 'Record not found', 404);
    return ok(res, { item: rows[0] });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load record', 500);
  }
};

export const saveItem = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const isUpdate = Boolean(req.params.id);
    const companyID = Number(req.body.companyID || req.body.company_id);
    if (!companyID) return fail(res, 'Company is required', 400);

    const [companies] = await db.query(
      'SELECT companyID FROM tblCompany WHERE companyID = :id LIMIT 1',
      { id: companyID }
    );
    if (!companies.length) return fail(res, 'Company not found', 404);

    const title = String(req.body.title || '').trim();
    if (!title) return fail(res, 'Title is required', 400);

    const doc_type = String(req.body.doc_type || 'invoice').toLowerCase() === 'agreement' ? 'agreement' : 'invoice';
    const data = {
      companyID,
      doc_type,
      title,
      invoice_no: req.body.invoice_no || null,
      amount: req.body.amount === '' || req.body.amount == null ? null : Number(req.body.amount),
      currency: req.body.currency || 'INR',
      status: req.body.status || 'draft',
      issue_date: req.body.issue_date || null,
      due_date: req.body.due_date || null,
      file_url: req.body.file_url || null,
      notes: req.body.notes || null,
    };

    let id = isUpdate ? Number(req.params.id) : null;
    if (isUpdate) {
      await db.query(
        `UPDATE tblInvoiceAgreement SET
         companyID=:companyID, doc_type=:doc_type, title=:title, invoice_no=:invoice_no,
         amount=:amount, currency=:currency, status=:status, issue_date=:issue_date,
         due_date=:due_date, file_url=:file_url, notes=:notes
         WHERE invoiceAgreementID=:id`,
        { ...data, id }
      );
    } else {
      const [result] = await db.query(
        `INSERT INTO tblInvoiceAgreement
         (companyID, doc_type, title, invoice_no, amount, currency, status, issue_date, due_date, file_url, notes)
         VALUES
         (:companyID, :doc_type, :title, :invoice_no, :amount, :currency, :status, :issue_date, :due_date, :file_url, :notes)`,
        data
      );
      id = result.insertId;
    }

    return ok(res, { id }, isUpdate ? 'Updated' : 'Created', isUpdate ? 200 : 201);
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not save record', 500);
  }
};

export const deleteItem = async (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    await db.query('DELETE FROM tblInvoiceAgreement WHERE invoiceAgreementID = :id', {
      id: Number(req.params.id),
    });
    return ok(res, {}, 'Deleted');
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not delete record', 500);
  }
};
