/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Help center and support ticket handlers
 * Edit Date: 2026-11-14
 */

import path from 'path';
import fs from 'fs';
import db from '../config/db';
import { ok, fail, slugify  } from '../utils/helpers';
import { getCompanyId } from '../utils/companyScope';
import { storeUpload, makeFilename } from '../utils/s3Storage';

const DEFAULT_TENANT_ID = Number(process.env.SUPPORT_TENANT_ID || 1);
const STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

function tenantId(req) {
  // Prefer JWT companyID; never trust body.companyID
  return getCompanyId(req.user) || Number(req.user?.tenant_id) || DEFAULT_TENANT_ID;
}

function flagOn(v: unknown) {
  return v === true || v === 1 || v === '1';
}

/** Platform Super Admin (companyID 0) — can manage all tenant tickets */
function isPlatformSuperAdmin(user) {
  return flagOn(user?.isSuperAdmin) && flagOn(user?.isAdmin);
}

/** Company Admin / legacy admin — manage within their company */
function isSuperAdmin(user) {
  if (isPlatformSuperAdmin(user)) return true;
  const flag = flagOn(user?.isAdmin);
  return flag || user?.role === 'admin';
}

function senderRole(user) {
  if (user?.role === 'admin') return 'admin';
  if (user?.role === 'staff') return 'support';
  return 'customer';
}

async function nextTicketNo(tenant) {
  const prefix = `BNX${String(tenant).padStart(2, '0')}`;
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS c FROM support_tickets WHERE tenant_id = :tenant`,
    { tenant }
  );
  const seq = String((Number(row.c) || 0) + 1).padStart(5, '0');
  return `${prefix}-${seq}`;
}

async function addHistory(ticketId, tenant, actorId, action, fromValue, toValue, note) {
  await db.query(
    `INSERT INTO support_ticket_history
      (ticket_id, tenant_id, actor_id, action, from_value, to_value, note)
     VALUES (:ticketId, :tenant, :actorId, :action, :fromValue, :toValue, :note)`,
    {
      ticketId,
      tenant,
      actorId: actorId || null,
      action,
      fromValue: fromValue || null,
      toValue: toValue || null,
      note: note || null,
    }
  );
}

async function getTicketRow(id) {
  const [rows] = await db.query(
    `SELECT t.*,
            cu.name AS created_by_name, cu.email AS created_by_email,
            au.name AS assigned_to_name, au.email AS assigned_to_email
     FROM support_tickets t
     LEFT JOIN tblUser cu ON cu.userID = t.createdByUserID
     LEFT JOIN tblUser au ON au.userID = t.assigned_to
     WHERE t.id = :id
     LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

function canViewTicket(user, ticket) {
  if (!ticket) return false;
  if (isSuperAdmin(user)) return true;
  if (Number(ticket.createdByUserID) === Number(user.id)) return true;
  if (Number(ticket.assigned_to) === Number(user.id)) return true;
  return false;
}

function canManageAll(user) {
  return isSuperAdmin(user);
}

function attachmentUrl(storedName: string) {
  if (!storedName) return '';
  if (/^https?:\/\//i.test(storedName)) return storedName;
  return `/api/uploads/support/${storedName}`;
}

async function saveAttachments(files, ticketId, messageId, tenant, userId) {
  if (!files || !files.length) return [];
  const saved = [];
  for (const file of files) {
    const filename = makeFilename('support', file.originalname);
    const stored = await storeUpload(file, 'support', filename);
    // Persist absolute S3 URL when used so downloads/previews work without local disk
    const storedName = stored.storage === 's3' ? stored.url : stored.filename;
    const [result] = await db.query(
      `INSERT INTO support_ticket_attachments
        (ticket_id, message_id, tenant_id, original_name, stored_name, mime_type, file_size, uploaded_by)
       VALUES (:ticketId, :messageId, :tenant, :originalName, :storedName, :mimeType, :fileSize, :uploadedBy)`,
      {
        ticketId,
        messageId: messageId || null,
        tenant,
        originalName: file.originalname || stored.filename,
        storedName,
        mimeType: file.mimetype,
        fileSize: file.size || 0,
        uploadedBy: userId,
      }
    );
    saved.push({
      id: result.insertId,
      ticket_id: ticketId,
      message_id: messageId || null,
      original_name: file.originalname || stored.filename,
      stored_name: storedName,
      mime_type: file.mimetype,
      file_size: file.size || 0,
      url: attachmentUrl(storedName),
    });
  }
  return saved;
}

// -------- Settings --------
export const getSettings = async (req, res) => {
  try {
    const tenant = tenantId(req);
    const [rows] = await db.query(
      `SELECT * FROM support_settings WHERE tenant_id = :tenant LIMIT 1`,
      { tenant }
    );
    if (rows.length) return ok(res, { settings: rows[0] });
    return ok(res, {
      settings: {
        tenant_id: tenant,
        shop_name: 'BuildNex ShopOS',
        support_email: 'support@buildnexshopos.com',
        support_phone: '',
        whatsapp_number: '',
        business_hours: 'Mon–Sat, 9:00 AM – 7:00 PM IST',
        response_time_info: 'We typically reply within 24 business hours.',
      },
    });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load support settings', 500);
  }
};

export const saveSettings = async (req, res) => {
  try {
    if (!canManageAll(req.user)) return fail(res, 'Super Admin access required', 403);
    const tenant = tenantId(req);
    const {
      shop_name,
      support_email,
      support_phone,
      whatsapp_number,
      business_hours,
      response_time_info,
    } = req.body || {};

    const [existing] = await db.query(
      `SELECT id FROM support_settings WHERE tenant_id = :tenant LIMIT 1`,
      { tenant }
    );

    if (existing.length) {
      await db.query(
        `UPDATE support_settings SET
          shop_name = :shop_name,
          support_email = :support_email,
          support_phone = :support_phone,
          whatsapp_number = :whatsapp_number,
          business_hours = :business_hours,
          response_time_info = :response_time_info,
          updated_by = :updated_by
         WHERE tenant_id = :tenant`,
        {
          tenant,
          shop_name: shop_name || 'BuildNex ShopOS',
          support_email: support_email || null,
          support_phone: support_phone || null,
          whatsapp_number: whatsapp_number || null,
          business_hours: business_hours || null,
          response_time_info: response_time_info || null,
          updated_by: req.user.id,
        }
      );
    } else {
      await db.query(
        `INSERT INTO support_settings
          (tenant_id, shop_name, support_email, support_phone, whatsapp_number, business_hours, response_time_info, updated_by)
         VALUES
          (:tenant, :shop_name, :support_email, :support_phone, :whatsapp_number, :business_hours, :response_time_info, :updated_by)`,
        {
          tenant,
          shop_name: shop_name || 'BuildNex ShopOS',
          support_email: support_email || null,
          support_phone: support_phone || null,
          whatsapp_number: whatsapp_number || null,
          business_hours: business_hours || null,
          response_time_info: response_time_info || null,
          updated_by: req.user.id,
        }
      );
    }

    return exports.getSettings(req, res);
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to save support settings', 500);
  }
};

// -------- Help Center --------
export const listCategories = async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM help_articles a WHERE a.categoryID = c.id AND a.is_published = 1) AS article_count
       FROM support_categories c
       WHERE c.is_active = 1
       ORDER BY c.sort_order ASC, c.name ASC`
    );
    return ok(res, { tblCategory: rows });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load categories', 500);
  }
};

export const listArticles = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const params: any = {};
    const where = ['a.is_published = 1'];

    if (q) {
      where.push('(a.title LIKE :q OR a.summary LIKE :q OR a.body LIKE :q OR a.tags LIKE :q)');
      params.q = `%${q}%`;
    }
    if (category) {
      where.push('(c.slug = :category OR c.id = :categoryId)');
      params.category = category;
      params.categoryId = Number(category) || 0;
    }

    const [articles] = await db.query(
      `SELECT a.id, a.title, a.slug, a.summary, a.tags, a.module_key, a.updated_at,
              c.name AS category_name, c.slug AS category_slug
       FROM help_articles a
       LEFT JOIN support_categories c ON c.categoryID = a.categoryID
       WHERE ${where.join(' AND ')}
       ORDER BY a.sort_order ASC, a.title ASC
       LIMIT 100`,
      params
    );
    return ok(res, { articles });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load articles', 500);
  }
};

export const getArticle = async (req, res) => {
  try {
    const key = req.params.slugOrId;
    const [rows] = await db.query(
      `SELECT a.*, c.name AS category_name, c.slug AS category_slug
       FROM help_articles a
       LEFT JOIN support_categories c ON c.categoryID = a.categoryID
       WHERE a.is_published = 1 AND (a.slug = :key OR a.id = :id)
       LIMIT 1`,
      { key, id: Number(key) || 0 }
    );
    if (!rows.length) return fail(res, 'Article not found', 404);
    return ok(res, { article: rows[0] });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load article', 500);
  }
};

// -------- Tickets --------
export const listTickets = async (req, res) => {
  try {
    const tenant = tenantId(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const priority = String(req.query.priority || '').trim();
    const scope = String(req.query.scope || 'mine'); // mine | all | assigned

    const where = [];
    const params: any = { tenant };

    if (canManageAll(req.user) && scope === 'all') {
      // Super Admin: all tenants optional; currently filter current + any
      // keep open for multi-tenant later; for now show all tickets
    } else if (scope === 'assigned') {
      where.push('t.assigned_to = :userId');
      params.userId = req.user.id;
    } else if (!canManageAll(req.user) || scope === 'mine') {
      where.push('(t.createdByUserID = :userId OR t.assigned_to = :userId)');
      params.userId = req.user.id;
      where.push('t.tenant_id = :tenant');
    }

    if (canManageAll(req.user) && scope === 'all' && req.query.shop) {
      where.push('t.shop_name LIKE :shop');
      params.shop = `%${String(req.query.shop).trim()}%`;
    }

    if (q) {
      where.push('(t.ticket_no LIKE :q OR t.subject LIKE :q OR t.category LIKE :q OR t.shop_name LIKE :q)');
      params.q = `%${q}%`;
    }
    if (status && STATUSES.includes(status)) {
      where.push('t.status = :status');
      params.status = status;
    }
    if (priority && PRIORITIES.includes(priority)) {
      where.push('t.priority = :priority');
      params.priority = priority;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM support_tickets t ${whereSql}`,
      params
    );

    const [tickets] = await db.query(
      `SELECT t.id, t.ticket_no, t.subject, t.category, t.related_module, t.priority, t.status,
              t.shop_name, t.created_at, t.updated_at, t.assigned_to, t.createdByUserID,
              cu.name AS created_by_name, au.name AS assigned_to_name,
              TIMESTAMPDIFF(MINUTE, t.created_at, COALESCE(t.first_response_at, NOW())) AS response_mins
       FROM support_tickets t
       LEFT JOIN tblUser cu ON cu.userID = t.createdByUserID
       LEFT JOIN tblUser au ON au.userID = t.assigned_to
       ${whereSql}
       ORDER BY
         FIELD(t.status, 'open','in_progress','waiting_customer','resolved','closed'),
         FIELD(t.priority, 'critical','high','medium','low'),
         t.updated_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return ok(res, { tickets, total, page, limit });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load tickets', 500);
  }
};

export const createTicket = async (req, res) => {
  try {
    let tenant = tenantId(req);
    const subject = String(req.body.subject || '').trim();
    const category = String(req.body.category || '').trim() || 'General';
    const related_module = String(req.body.related_module || '').trim() || null;
    const priority = String(req.body.priority || 'medium').toLowerCase();
    const description = String(req.body.description || '').trim();
    const bodyCompanyId = Number(req.body.companyID || req.body.company_id || 0);
    let shop_name = String(req.body.shop_name || '').trim() || null;

    if (!subject) return fail(res, 'Subject is required');
    if (!description) return fail(res, 'Description is required');
    if (!PRIORITIES.includes(priority)) return fail(res, 'Invalid priority');

    // Super Admin can create on behalf of a company
    if (isPlatformSuperAdmin(req.user) && bodyCompanyId > 0) {
      tenant = bodyCompanyId;
      const [cos] = await db.query(
        'SELECT name FROM tblCompany WHERE companyID = :id LIMIT 1',
        { id: bodyCompanyId }
      );
      if (!cos.length) return fail(res, 'Company not found', 404);
      if (!shop_name) shop_name = cos[0].name;
    }

    if (!shop_name) {
      const [[settings]] = await db.query(
        `SELECT shop_name FROM support_settings WHERE tenant_id = :tenant LIMIT 1`,
        { tenant }
      );
      shop_name = settings?.shop_name || 'BuildNex ShopOS';
    }

    const ticket_no = await nextTicketNo(tenant);
    const [result] = await db.query(
      `INSERT INTO support_tickets
        (tenant_id, ticket_no, subject, category, related_module, priority, status, description,
         createdByUserID, shop_name, last_customer_reply_at)
       VALUES
        (:tenant, :ticket_no, :subject, :category, :related_module, :priority, 'open', :description,
         :createdByUserID, :shop_name, NOW())`,
      {
        tenant,
        ticket_no,
        subject,
        category,
        related_module,
        priority,
        description,
        createdByUserID: req.user.id,
        shop_name,
      }
    );

    const ticketId = result.insertId;
    const [msgResult] = await db.query(
      `INSERT INTO support_ticket_messages
        (ticket_id, tenant_id, sender_id, sender_role, message, is_internal)
       VALUES (:ticketId, :tenant, :senderId, 'customer', :message, 0)`,
      { ticketId, tenant, senderId: req.user.id, message: description }
    );

    const files = req.files || [];
    await saveAttachments(files, ticketId, msgResult.insertId, tenant, req.user.id);
    await addHistory(ticketId, tenant, req.user.id, 'created', null, 'open', subject);

    const ticket = await getTicketRow(ticketId);
    return ok(res, { ticket }, 'Support ticket created', 201);
  } catch (err) {
    console.error(err);
    return fail(res, err.message || 'Failed to create ticket', 500);
  }
};

export const getTicket = async (req, res) => {
  try {
    const ticket = await getTicketRow(req.params.id);
    if (!ticket) return fail(res, 'Ticket not found', 404);
    if (!canViewTicket(req.user, ticket)) return fail(res, 'Access denied', 403);

    const showInternal = canManageAll(req.user) || Number(ticket.assigned_to) === Number(req.user.id);

    const [messages] = await db.query(
      `SELECT m.*, u.name AS sender_name, u.email AS sender_email
       FROM support_ticket_messages m
       LEFT JOIN tblUser u ON u.userID = m.sender_id
       WHERE m.ticket_id = :id
         ${showInternal ? '' : 'AND m.is_internal = 0'}
       ORDER BY m.created_at ASC`,
      { id: ticket.id }
    );

    const [attachments] = await db.query(
      `SELECT id, ticket_id, message_id, original_name, stored_name, mime_type, file_size, uploaded_by, created_at
       FROM support_ticket_attachments
       WHERE ticket_id = :id
       ORDER BY created_at ASC`,
      { id: ticket.id }
    );

    const mappedAtt = attachments.map((a) => ({
      ...a,
      url: attachmentUrl(a.stored_name),
    }));

    const [history] = await db.query(
      `SELECT h.*, u.name AS actor_name
       FROM support_ticket_history h
       LEFT JOIN tblUser u ON u.userID = h.actor_id
       WHERE h.ticket_id = :id
       ORDER BY h.created_at ASC`,
      { id: ticket.id }
    );

    return ok(res, {
      ticket,
      messages: messages.map((m) => ({
        ...m,
        attachments: mappedAtt.filter((a) => Number(a.message_id) === Number(m.id)),
      })),
      attachments: mappedAtt,
      history: showInternal ? history : history.filter((h) => h.action !== 'internal_note'),
    });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load ticket', 500);
  }
};

export const replyTicket = async (req, res) => {
  try {
    const ticket = await getTicketRow(req.params.id);
    if (!ticket) return fail(res, 'Ticket not found', 404);
    if (!canViewTicket(req.user, ticket)) return fail(res, 'Access denied', 403);

    const message = String(req.body.message || '').trim();
    const isInternal = String(req.body.is_internal || '') === '1' || req.body.is_internal === true;
    if (!message) return fail(res, 'Message is required');

    if (isInternal && !(canManageAll(req.user) || Number(ticket.assigned_to) === Number(req.user.id))) {
      return fail(res, 'Only support staff can add internal notes', 403);
    }

    if (['closed'].includes(ticket.status) && !canManageAll(req.user)) {
      return fail(res, 'Ticket is closed. Ask support to reopen it.');
    }

    const role = senderRole(req.user);
    const [msgResult] = await db.query(
      `INSERT INTO support_ticket_messages
        (ticket_id, tenant_id, sender_id, sender_role, message, is_internal)
       VALUES (:ticketId, :tenant, :senderId, :role, :message, :isInternal)`,
      {
        ticketId: ticket.id,
        tenant: ticket.tenant_id,
        senderId: req.user.id,
        role,
        message,
        isInternal: isInternal ? 1 : 0,
      }
    );

    const files = req.files || [];
    await saveAttachments(files, ticket.id, msgResult.insertId, ticket.tenant_id, req.user.id);

    const updates = [];
    const params: any = { id: ticket.id };

    if (!isInternal) {
      if (role === 'customer') {
        updates.push('last_customer_reply_at = NOW()');
        if (ticket.status === 'waiting_customer' || ticket.status === 'resolved') {
          updates.push(`status = 'in_progress'`);
          await addHistory(ticket.id, ticket.tenant_id, req.user.id, 'status', ticket.status, 'in_progress', 'Customer replied');
        }
      } else {
        updates.push('last_staff_reply_at = NOW()');
        if (!ticket.first_response_at) updates.push('first_response_at = NOW()');
        if (ticket.status === 'open') {
          updates.push(`status = 'waiting_customer'`);
          await addHistory(ticket.id, ticket.tenant_id, req.user.id, 'status', 'open', 'waiting_customer', 'Support replied');
        }
      }
    }

    if (updates.length) {
      await db.query(`UPDATE support_tickets SET ${updates.join(', ')} WHERE id = :id`, params);
    }

    await addHistory(
      ticket.id,
      ticket.tenant_id,
      req.user.id,
      isInternal ? 'internal_note' : 'reply',
      null,
      null,
      message.slice(0, 180)
    );

    return exports.getTicket(req, res);
  } catch (err) {
    console.error(err);
    return fail(res, err.message || 'Failed to reply', 500);
  }
};

export const updateTicket = async (req, res) => {
  try {
    const ticket = await getTicketRow(req.params.id);
    if (!ticket) return fail(res, 'Ticket not found', 404);

    const isOwner = Number(ticket.createdByUserID) === Number(req.user.id);
    const isAssignee = Number(ticket.assigned_to) === Number(req.user.id);
    const admin = canManageAll(req.user);

    if (!admin && !isOwner && !isAssignee) return fail(res, 'Access denied', 403);

    const { status, priority, assigned_to, reopen, subject, category, description, shop_name } = req.body || {};
    const sets = [];
    const params: any = { id: ticket.id };

    if (admin && subject != null && String(subject).trim()) {
      sets.push('subject = :subject');
      params.subject = String(subject).trim();
    }
    if (admin && category != null && String(category).trim()) {
      sets.push('category = :category');
      params.category = String(category).trim();
    }
    if (admin && description != null && String(description).trim()) {
      sets.push('description = :description');
      params.description = String(description).trim();
    }
    if (admin && shop_name != null) {
      sets.push('shop_name = :shop_name');
      params.shop_name = String(shop_name).trim() || null;
    }

    if (reopen === true || reopen === '1') {
      if (!(admin || (isOwner && ticket.status === 'resolved'))) {
        return fail(res, 'Ticket cannot be reopened', 403);
      }
      sets.push(`status = 'open'`);
      sets.push('resolved_at = NULL');
      sets.push('closed_at = NULL');
      await addHistory(ticket.id, ticket.tenant_id, req.user.id, 'status', ticket.status, 'open', 'Reopened');
    }

    if (status && STATUSES.includes(status)) {
      if (!admin && !isAssignee) return fail(res, 'Only support can change status', 403);
      sets.push('status = :status');
      params.status = status;
      if (status === 'resolved') sets.push('resolved_at = NOW()');
      if (status === 'closed') sets.push('closed_at = NOW()');
      if (status !== ticket.status) {
        await addHistory(ticket.id, ticket.tenant_id, req.user.id, 'status', ticket.status, status, null);
      }
    }

    if (priority && PRIORITIES.includes(priority)) {
      if (!admin && !isAssignee) return fail(res, 'Only support can change priority', 403);
      sets.push('priority = :priority');
      params.priority = priority;
      if (priority !== ticket.priority) {
        await addHistory(ticket.id, ticket.tenant_id, req.user.id, 'priority', ticket.priority, priority, null);
      }
    }

    if (assigned_to !== undefined) {
      if (!admin) return fail(res, 'Only Super Admin can assign staff', 403);
      const assignee = assigned_to === null || assigned_to === '' ? null : Number(assigned_to);
      sets.push('assigned_to = :assigned_to');
      params.assigned_to = assignee;
      await addHistory(
        ticket.id,
        ticket.tenant_id,
        req.user.id,
        'assign',
        ticket.assigned_to ? String(ticket.assigned_to) : null,
        assignee ? String(assignee) : null,
        null
      );
      if (assignee && ticket.status === 'open') {
        sets.push(`status = 'in_progress'`);
      }
    }

    if (!sets.length) return fail(res, 'No changes provided');

    await db.query(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = :id`, params);
    const updated = await getTicketRow(ticket.id);
    return ok(res, { ticket: updated }, 'Ticket updated');
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to update ticket', 500);
  }
};

export const deleteTicket = async (req, res) => {
  try {
    if (!canManageAll(req.user)) return fail(res, 'Only Super Admin can delete tickets', 403);
    const ticket = await getTicketRow(req.params.id);
    if (!ticket) return fail(res, 'Ticket not found', 404);

    await db.query('DELETE FROM support_ticket_attachments WHERE ticket_id = :id', { id: ticket.id });
    await db.query('DELETE FROM support_ticket_messages WHERE ticket_id = :id', { id: ticket.id });
    await db.query('DELETE FROM support_ticket_history WHERE ticket_id = :id', { id: ticket.id });
    await db.query('DELETE FROM support_tickets WHERE id = :id', { id: ticket.id });
    return ok(res, {}, 'Ticket deleted');
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to delete ticket', 500);
  }
};

export const staffOptions = async (req, res) => {
  try {
    if (!canManageAll(req.user)) return fail(res, 'Super Admin access required', 403);
    const [staff] = await db.query(
      `SELECT u.userID AS id, u.name, u.email, r.RoleCode AS role, r.Level
       FROM tblUser u
       LEFT JOIN tblRole r ON r.roleID = u.roleID
       WHERE u.is_active = 1
         AND r.RoleCode <> 'customer'
         AND r.Level IS NOT NULL
         AND r.Level < 90
       ORDER BY u.name ASC`
    );
    return ok(res, { staff });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load staff', 500);
  }
};

export const downloadAttachment = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.*, t.createdByUserID, t.assigned_to, t.tenant_id
       FROM support_ticket_attachments a
       JOIN support_tickets t ON t.id = a.ticket_id
       WHERE a.id = :id
       LIMIT 1`,
      { id: req.params.id }
    );
    if (!rows.length) return fail(res, 'Attachment not found', 404);
    const att = rows[0];
    if (!canViewTicket(req.user, att)) return fail(res, 'Access denied', 403);

    if (/^https?:\/\//i.test(String(att.stored_name || ''))) {
      return res.redirect(att.stored_name);
    }
    const filePath = path.join(__dirname, '..', 'uploads', 'support', att.stored_name);
    if (!fs.existsSync(filePath)) return fail(res, 'File missing', 404);
    res.setHeader('Content-Type', att.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${att.original_name.replace(/"/g, '')}"`);
    return res.sendFile(filePath);
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to download attachment', 500);
  }
};

export const meta = async (_req, res) => {
  return ok(res, {
    statuses: STATUSES,
    priorities: PRIORITIES,
    modules: [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'catalog', label: 'Products' },
      { key: 'product', label: 'Stock / Inventory' },
      { key: 'billing', label: 'POS Billing' },
      { key: 'order', label: 'Orders' },
      { key: 'finance', label: 'Finance' },
      { key: 'report', label: 'Reports' },
      { key: 'access_control', label: 'Account & Access' },
      { key: 'other', label: 'Other' },
    ],
  });
};

// keep slugify import used for future article CMS
void slugify;
