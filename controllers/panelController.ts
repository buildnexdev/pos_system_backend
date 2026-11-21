/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Panel CRUD for staff, roles, finance and reports
 * Edit Date: 2026-11-14
 */

import bcrypt from 'bcryptjs';
import db from '../config/db';
import { MODULES, STAFF_ACL_EXCLUDED_KEYS, VIEW_ONLY_MODULE_KEYS } from '../config/modules';
import {
  ASSIGNABLE_DEFAULT_ROLES,
  DEFAULT_ROLES,
  isAssignableStaffRoleLevel,
} from '../config/roles';
import {
  USER_ROLE_JOIN,
  SQL_PANEL_USER,
  SQL_ADMIN_USER,
  SQL_STAFF_USER,
  SQL_STAFF_LOGIN_ONLY,
  accessRoleFromRow,
} from '../config/userRole';
import { getRoleId } from '../utils/roleLookup';
import { ok, fail, slugify } from '../utils/helpers';
import {
  requireCompanyId,
  getBranchId,
  canManageAllCompanies,
  CompanyScopeError,
} from '../utils/companyScope';

async function ensureOrderBranchColumn() {
  try {
    const [cols]: any = await db.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblOrder' AND COLUMN_NAME = 'branchID'`
    );
    if (Number(cols[0]?.c) === 0) {
      await db.query(
        `ALTER TABLE tblOrder ADD COLUMN branchID INT NOT NULL DEFAULT 0 AFTER companyID`
      );
      await db.query(`ALTER TABLE tblOrder ADD KEY idx_order_branch (branchID)`).catch(() => null);
    }
  } catch (err: any) {
    console.warn('ensureOrderBranchColumn:', err.message);
  }
}

export const modules = async (req, res) => ok(res, { modules: MODULES });

async function addStaffHistory(userId, action, details, createdBy) {
  try {
    await db.query(
      `INSERT INTO tblStaffHistory (userID, action, details, createdByUserID)
       VALUES (:userId, :action, :details, :createdBy)`,
      { userId, action, details: details || null, createdBy: createdBy || null }
    );
  } catch (err) {
    // table may not exist yet on older DBs
    console.warn('tblStaffHistory insert skipped:', err.message);
  }
}

async function getStaffMapping(userId) {
  const [[rights]] = await db.query(
    'SELECT COUNT(*) AS c FROM tblUserRight WHERE userID = :id AND (can_view=1 OR can_create=1 OR can_edit=1 OR can_delete=1)',
    { id: userId }
  );
  const [[finance]] = await db.query(
    'SELECT COUNT(*) AS c FROM tblFinanceEntry WHERE createdByUserID = :id',
    { id: userId }
  );
  const rightsCount = Number(rights.c) || 0;
  const financeCount = Number(finance.c) || 0;
  return {
    isMapped: rightsCount > 0 || financeCount > 0,
    rightsCount,
    financeCount
  };
}

// -------- Staff --------
export const listStaff = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();
    const role = (req.query.role || '').trim();
    const status = (req.query.status || '').trim();

    // Staff page never lists company admin / super admin logins
    const where = [SQL_PANEL_USER, SQL_STAFF_LOGIN_ONLY, 'u.companyID = :companyID'];
    const params: any = { companyID };

    if (q) {
      where.push('(u.name LIKE :q OR u.email LIKE :q OR u.phone LIKE :q OR u.city LIKE :q OR u.state LIKE :q)');
      params.q = `%${q}%`;
    }
    if (role === 'staff') where.push(SQL_STAFF_USER);
    if (status === 'active') where.push('u.is_active = 1');
    if (status === 'inactive') where.push('u.is_active = 0');

    const whereSql = where.join(' AND ');
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM tblUser u ${USER_ROLE_JOIN} WHERE ${whereSql}`,
      params
    );

    const [staff] = await db.query(
      `SELECT u.userID AS id, u.name, u.email, u.phone, u.address, u.city, u.state, u.pincode,
              u.roleID, u.is_active, u.created_at, r.RoleCode, r.RoleName, r.Level,
              p.photo_url, p.employee_code
       FROM tblUser u
       ${USER_ROLE_JOIN}
       LEFT JOIN tblStaffProfile p ON p.userID = u.userID
       WHERE ${whereSql}
       ORDER BY u.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const withMeta = [];
    for (const row of staff) {
      const mapping = await getStaffMapping(row.id);
      withMeta.push({
        ...row,
        role: accessRoleFromRow(row),
        location: [row.city, row.state].filter(Boolean).join(', ') || '—',
        is_mapped: mapping.isMapped
      });
    }

    return ok(res, {
      staff: withMeta,
      pagination: {
        page,
        limit,
        total: Number(total) || 0,
        totalPages: Math.max(1, Math.ceil((Number(total) || 0) / limit))
      }
    });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load staff', 500);
  }
};

async function ensureUserWarehouseColumn() {
  try {
    const [cols]: any = await db.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblUser' AND COLUMN_NAME = 'warehouseID'`
    );
    if (Number(cols[0]?.c) === 0) {
      await db.query(
        `ALTER TABLE tblUser ADD COLUMN warehouseID INT NOT NULL DEFAULT 0 AFTER branchID`
      );
    }
  } catch (err: any) {
    console.warn('ensureUserWarehouseColumn:', err.message);
  }
}

export const getStaff = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await ensureUserWarehouseColumn();
    const [rows] = await db.query(
      `SELECT u.userID AS id, u.name, u.email, u.phone, u.address, u.city, u.state, u.pincode,
              u.roleID, u.branchID, u.warehouseID, u.is_active, u.created_at,
              r.RoleCode, r.RoleName, r.Level
       FROM tblUser u
       ${USER_ROLE_JOIN}
       WHERE u.userID = :id AND u.companyID = :companyID
         AND ${SQL_PANEL_USER} AND ${SQL_STAFF_LOGIN_ONLY}`,
      { id: req.params.id, companyID }
    );
    if (!rows.length) return fail(res, 'Staff not found', 404);
    rows[0].role = accessRoleFromRow(rows[0]);

    const [education] = await db.query(
      'SELECT * FROM tblStaffEducation WHERE userID = :id ORDER BY staffEducationID DESC',
      { id: req.params.id }
    ).catch((err) => {
      console.warn('tblStaffEducation load:', err.message);
      return [[]];
    });
    const [experience] = await db.query(
      'SELECT * FROM tblStaffExperience WHERE userID = :id ORDER BY staffExperienceID DESC',
      { id: req.params.id }
    ).catch((err) => {
      console.warn('tblStaffExperience load:', err.message);
      return [[]];
    });
    const [documents] = await db.query(
      'SELECT * FROM tblStaffDocument WHERE userID = :id ORDER BY staffDocumentID DESC',
      { id: req.params.id }
    ).catch((err) => {
      console.warn('tblStaffDocument load:', err.message);
      return [[]];
    });
    const [history] = await db.query(
      'SELECT * FROM tblStaffHistory WHERE userID = :id ORDER BY created_at DESC',
      { id: req.params.id }
    ).catch((err) => {
      console.warn('tblStaffHistory load:', err.message);
      return [[]];
    });
    const [profiles] = await db.query(
      'SELECT * FROM tblStaffProfile WHERE userID = :id LIMIT 1',
      { id: req.params.id }
    ).catch(() => [[]]);

    const mapping = await getStaffMapping(req.params.id);
    const profile = profiles?.[0] || null;
    const staff = {
      ...rows[0],
      is_mapped: mapping.isMapped,
      employee_code: profile?.employee_code || `EMP${String(rows[0].userID ?? rows[0].id).padStart(5, '0')}`,
      profile: profile || {},
    };
    return ok(res, {
      staff,
      profile: profile || {},
      education: education || [],
      experience: experience || [],
      documents: documents || [],
      history: history || [],
      mapping
    });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load staff detail', 500);
  }
};

export const saveStaff = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await ensureUserWarehouseColumn();
    const {
      name, email, phone, password, is_active,
      address, city, state, pincode,
      profile = null,
    } = req.body;
    const hasEducation = Object.prototype.hasOwnProperty.call(req.body, 'education');
    const hasExperience = Object.prototype.hasOwnProperty.call(req.body, 'experience');
    const hasDocuments = Object.prototype.hasOwnProperty.call(req.body, 'documents');
    const education = hasEducation ? req.body.education : undefined;
    const experience = hasExperience ? req.body.experience : undefined;
    const documents = hasDocuments ? req.body.documents : undefined;
    if (!name || !email) return fail(res, 'Name and email required');

    // Prefer company role from Office details; never assign Owner/Admin (L1–L2)
    let roleID = Number(req.body.roleID || req.body.role_id || 0) || 0;
    if (roleID) {
      const [okRole] = await db.query(
        `SELECT roleID, Level FROM tblRole
         WHERE roleID = :id AND companyID = :companyID AND IsActive = 1 LIMIT 1`,
        { id: roleID, companyID }
      );
      if (!okRole.length) return fail(res, 'Invalid role for this company', 400);
      if (!isAssignableStaffRoleLevel(okRole[0].Level)) {
        return fail(res, 'Super Admin and Admin roles cannot be assigned to staff', 400);
      }
    } else {
      roleID = await getRoleId('staff', companyID);
    }

    const branchID = Number(req.body.branchID ?? req.body.branch_id ?? 0) || 0;
    const warehouseID = Number(req.body.warehouseID ?? req.body.warehouse_id ?? 0) || 0;

    if (branchID) {
      const [okBranch] = await db.query(
        `SELECT branchID FROM tblBranch WHERE branchID = :id AND companyID = :companyID LIMIT 1`,
        { id: branchID, companyID }
      );
      if (!okBranch.length) return fail(res, 'Invalid branch for this company', 400);
    }
    if (warehouseID) {
      const [okWh] = await db.query(
        `SELECT warehouseID FROM tblWarehouse WHERE warehouseID = :id AND companyID = :companyID LIMIT 1`,
        { id: warehouseID, companyID }
      );
      if (!okWh.length) return fail(res, 'Invalid warehouse for this company', 400);
    }

    const active = is_active === false || is_active === 0 ? 0 : 1;

    let staffId = req.params.id ? Number(req.params.id) : null;
    const isUpdate = Boolean(staffId);

    if (staffId) {
      const [exists] = await db.query(
        `SELECT u.userID AS id FROM tblUser u ${USER_ROLE_JOIN}
         WHERE u.userID = :id AND u.companyID = :companyID
           AND ${SQL_PANEL_USER} AND ${SQL_STAFF_LOGIN_ONLY}`,
        { id: staffId, companyID }
      );
      if (!exists.length) return fail(res, 'Staff not found', 404);

      if (password) {
        if (String(password).length < 6) return fail(res, 'Password must be at least 6 characters', 400);
        const hash = await bcrypt.hash(password, 10);
        await db.query(
          `UPDATE tblUser SET name=:name, email=:email, phone=:phone, address=:address, city=:city, state=:state,
           pincode=:pincode, roleID=:roleID, isAdmin=0, isSuperAdmin=0, branchID=:branchID, warehouseID=:warehouseID,
           is_active=:is_active, password=:password, password_changed_at=NOW(), session_token=NULL
           WHERE userID=:id AND companyID=:companyID`,
          {
            name, email, phone, address, city, state, pincode, roleID, branchID, warehouseID,
            is_active: active, password: hash, id: staffId, companyID,
          }
        );
        await addStaffHistory(staffId, 'password_changed', 'Staff password updated', req.user.id);
      } else {
        await db.query(
          `UPDATE tblUser SET name=:name, email=:email, phone=:phone, address=:address, city=:city, state=:state,
           pincode=:pincode, roleID=:roleID, isAdmin=0, isSuperAdmin=0, branchID=:branchID, warehouseID=:warehouseID,
           is_active=:is_active
           WHERE userID=:id AND companyID=:companyID`,
          {
            name, email, phone, address, city, state, pincode, roleID, branchID, warehouseID,
            is_active: active, id: staffId, companyID,
          }
        );
      }
      await addStaffHistory(staffId, 'updated', 'Staff profile updated', req.user.id);
    } else {
      if (!password) return fail(res, 'Password required for new staff');
      if (String(password).length < 6) return fail(res, 'Password must be at least 6 characters', 400);
      const [dupEmail] = await db.query(
        `SELECT userID FROM tblUser WHERE LOWER(email) = LOWER(:email) LIMIT 1`,
        { email: String(email).trim() }
      );
      if (dupEmail.length) {
        return fail(res, 'Email already registered — use a different login email', 409);
      }
      const hash = await bcrypt.hash(password, 10);
      const [result] = await db.query(
        `INSERT INTO tblUser
         (name, email, password, password_changed_at, phone, address, city, state, pincode, roleID, companyID, isAdmin, isSuperAdmin, branchID, warehouseID, is_active)
         VALUES
         (:name, :email, :password, NOW(), :phone, :address, :city, :state, :pincode, :roleID, :companyID, 0, 0, :branchID, :warehouseID, :is_active)`,
        {
          name, email, password: hash, phone: phone || null,
          address: address || null, city: city || null, state: state || null, pincode: pincode || null,
          roleID, companyID, branchID, warehouseID, is_active: active,
        }
      );
      staffId = result.insertId;
      await addStaffHistory(staffId, 'created', 'Staff account created', req.user.id);
    }

    if (profile && typeof profile === 'object') {
      // Employee ID is auto-generated and never edited by client
      const [existingProfile] = await db.query(
        `SELECT employee_code FROM tblStaffProfile WHERE userID = :userID LIMIT 1`,
        { userID: staffId }
      );
      const employeeCode =
        existingProfile[0]?.employee_code || `EMP${String(staffId).padStart(5, '0')}`;
      await db.query(
        `INSERT INTO tblStaffProfile (
          userID, employee_code, initial_name, date_of_birth, gender, blood_group, marital_status,
          father_name, mother_name, aadhaar, pan, emergency_name, emergency_phone, photo_url,
          bank_name, account_holder, account_number, ifsc_code, bank_branch, bank_address,
          department, designation, join_date, employment_type, work_location, reporting_to,
          landmark, country
        ) VALUES (
          :userID, :employee_code, :initial_name, :date_of_birth, :gender, :blood_group, :marital_status,
          :father_name, :mother_name, :aadhaar, :pan, :emergency_name, :emergency_phone, :photo_url,
          :bank_name, :account_holder, :account_number, :ifsc_code, :bank_branch, :bank_address,
          :department, :designation, :join_date, :employment_type, :work_location, :reporting_to,
          :landmark, :country
        )
        ON DUPLICATE KEY UPDATE
          initial_name=VALUES(initial_name),
          date_of_birth=VALUES(date_of_birth),
          gender=VALUES(gender),
          blood_group=VALUES(blood_group),
          marital_status=VALUES(marital_status),
          father_name=VALUES(father_name),
          mother_name=VALUES(mother_name),
          aadhaar=VALUES(aadhaar),
          pan=VALUES(pan),
          emergency_name=VALUES(emergency_name),
          emergency_phone=VALUES(emergency_phone),
          photo_url=VALUES(photo_url),
          bank_name=VALUES(bank_name),
          account_holder=VALUES(account_holder),
          account_number=VALUES(account_number),
          ifsc_code=VALUES(ifsc_code),
          bank_branch=VALUES(bank_branch),
          bank_address=VALUES(bank_address),
          department=VALUES(department),
          designation=VALUES(designation),
          join_date=VALUES(join_date),
          employment_type=VALUES(employment_type),
          work_location=VALUES(work_location),
          reporting_to=VALUES(reporting_to),
          landmark=VALUES(landmark),
          country=VALUES(country)`,
        {
          userID: staffId,
          employee_code: employeeCode,
          initial_name: profile.initial_name || null,
          date_of_birth: profile.date_of_birth || null,
          gender: profile.gender || null,
          blood_group: profile.blood_group || null,
          marital_status: profile.marital_status || null,
          father_name: profile.father_name || null,
          mother_name: profile.mother_name || null,
          aadhaar: profile.aadhaar || null,
          pan: profile.pan || null,
          emergency_name: profile.emergency_name || null,
          emergency_phone: profile.emergency_phone || null,
          photo_url: profile.photo_url || null,
          bank_name: profile.bank_name || null,
          account_holder: profile.account_holder || null,
          account_number: profile.account_number || null,
          ifsc_code: profile.ifsc_code || null,
          bank_branch: profile.bank_branch || null,
          bank_address: profile.bank_address || null,
          department: profile.department || null,
          designation: profile.designation || null,
          join_date: profile.join_date || null,
          employment_type: profile.employment_type || null,
          work_location: profile.work_location || null,
          reporting_to: profile.reporting_to || null,
          landmark: profile.landmark || null,
          country: profile.country || 'India',
        }
      ).catch((err) => {
        console.warn('tblStaffProfile save skipped:', err.message);
      });
    } else if (!isUpdate) {
      await db.query(
        `INSERT IGNORE INTO tblStaffProfile (userID, employee_code) VALUES (:userID, :employee_code)`,
        { userID: staffId, employee_code: `EMP${String(staffId).padStart(5, '0')}` }
      ).catch(() => null);
    }

    // Replace education / experience / documents only when that section is sent
    if (hasEducation && Array.isArray(education)) {
      await db.query('DELETE FROM tblStaffEducation WHERE userID = :id', { id: staffId }).catch(() => null);
      for (const row of education) {
        if (!row.degree || !row.institution) continue;
        await db.query(
          `INSERT INTO tblStaffEducation (userID, degree, institution, year_from, year_to, grade)
           VALUES (:userId, :degree, :institution, :year_from, :year_to, :grade)`,
          {
            userId: staffId,
            degree: row.degree,
            institution: row.institution,
            year_from: row.year_from || null,
            year_to: row.year_to || null,
            grade: row.grade || null
          }
        );
      }
    }

    if (hasExperience && Array.isArray(experience)) {
      await db.query('DELETE FROM tblStaffExperience WHERE userID = :id', { id: staffId }).catch(() => null);
      for (const row of experience) {
        if (!row.company || !row.designation) continue;
        await db.query(
          `INSERT INTO tblStaffExperience (userID, company, designation, year_from, year_to, description)
           VALUES (:userId, :company, :designation, :year_from, :year_to, :description)`,
          {
            userId: staffId,
            company: row.company,
            designation: row.designation,
            year_from: row.year_from || null,
            year_to: row.year_to || null,
            description: row.description || null
          }
        );
      }
    }

    if (hasDocuments && Array.isArray(documents)) {
      await db.query('DELETE FROM tblStaffDocument WHERE userID = :id', { id: staffId }).catch(() => null);
      for (const row of documents) {
        if (!row.doc_type || !row.doc_name || !row.file_url) continue;
        await db.query(
          `INSERT INTO tblStaffDocument (userID, doc_type, doc_name, file_url)
           VALUES (:userId, :doc_type, :doc_name, :file_url)`,
          {
            userId: staffId,
            doc_type: row.doc_type,
            doc_name: row.doc_name,
            file_url: row.file_url
          }
        );
      }
    }

    return ok(res, { id: staffId }, isUpdate ? 'Staff updated' : 'Staff created', isUpdate ? 200 : 201);
  } catch (err: any) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    if (err?.code === 'ER_DUP_ENTRY' || String(err?.message || '').includes('Duplicate')) {
      return fail(res, 'Email already registered — use a different login email', 409);
    }
    return fail(res, err?.message || 'Could not save staff', 500);
  }
};

export const toggleStaffActive = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [rows] = await db.query(
      `SELECT u.userID AS id, u.is_active FROM tblUser u ${USER_ROLE_JOIN}
       WHERE u.userID = :id AND u.companyID = :companyID
         AND ${SQL_PANEL_USER} AND ${SQL_STAFF_LOGIN_ONLY}`,
      { id: req.params.id, companyID }
    );
    if (!rows.length) return fail(res, 'Staff not found', 404);
    if (Number(req.params.id) === req.user.id) return fail(res, 'Cannot deactivate yourself');

    const next = rows[0].is_active ? 0 : 1;
    await db.query('UPDATE tblUser SET is_active = :active WHERE userID = :id AND companyID = :companyID', {
      active: next,
      id: req.params.id,
      companyID,
    });
    await addStaffHistory(req.params.id, next ? 'activated' : 'deactivated', `Status set to ${next ? 'active' : 'inactive'}`, req.user.id);
    return ok(res, { is_active: next }, 'Status updated');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not update status', 500);
  }
};

export const deleteStaff = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    if (Number(req.params.id) === req.user.id) return fail(res, 'Cannot delete yourself');

    const [rows] = await db.query(
      `SELECT u.userID AS id, r.RoleCode, r.Level
       FROM tblUser u ${USER_ROLE_JOIN}
       WHERE u.userID = :id AND u.companyID = :companyID
         AND ${SQL_STAFF_USER} AND ${SQL_STAFF_LOGIN_ONLY}`,
      { id: req.params.id, companyID }
    );
    if (!rows.length) return fail(res, 'Staff not found', 404);

    const mapping = await getStaffMapping(req.params.id);
    if (mapping.isMapped) {
      return fail(
        res,
        'Cannot delete: staff is already mapped (access rights or finance records). Remove mapping first.',
        400,
        { mapping }
      );
    }

    await db.query(`DELETE FROM tblUser WHERE userID = :id AND companyID = :companyID`, {
      id: req.params.id,
      companyID,
    });
    return ok(res, {}, 'Staff deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete staff', 500);
  }
};

// -------- Roles (tblRole) --------
function roleCodePrefix(name) {
  const words = String(name || '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !['and', 'or', 'of', 'the', 'a', 'an'].includes(w.toLowerCase()));

  if (!words.length) return 'R';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join('').slice(0, 4);
}

function buildRoleCode(name, seq, level) {
  return `${roleCodePrefix(name)}-${Number(seq)}-L${Number(level)}`;
}

async function nextRoleSeq(companyID: number) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS active_count FROM tblRole
     WHERE IsActive = 1 AND companyID = :companyID`,
    { companyID }
  );
  return Number(rows[0].active_count || 0) + 1;
}

function mapTblRole(row) {
  return {
    id: row.roleID,
    companyID: Number(row.companyID || 0),
    name: row.RoleName,
    code: row.RoleCode,
    level: row.Level,
    description: row.Description,
    color: row.Color,
    is_default: !!row.IsDefault,
    is_active: !!row.IsActive,
    is_global: Number(row.companyID || 0) === 0,
  };
}

/** Seed level 1–7 templates for a company if none exist yet */
async function ensureCompanyRoles(companyID: number) {
  const [[{ c }]] = await db.query(
    `SELECT COUNT(*) AS c FROM tblRole WHERE companyID = :companyID AND IsActive = 1`,
    { companyID }
  );
  if (Number(c) > 0) return;

  for (const r of DEFAULT_ROLES) {
    const code = `${r.code}_c${companyID}`;
    await db.query(
      `INSERT INTO tblRole (companyID, RoleName, RoleCode, Level, Description, Color, IsDefault, IsActive)
       VALUES (:companyID, :name, :code, :level, :description, :color, 1, 1)`,
      {
        companyID,
        name: r.name,
        code,
        level: r.level,
        description: r.description,
        color: r.color,
      }
    );
  }
}

export const listRoles = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await ensureCompanyRoles(companyID);

    const [rows] = await db.query(
      `SELECT roleID, companyID, RoleName, RoleCode, Level, Description, Color, IsDefault, IsActive
       FROM tblRole
       WHERE IsActive = 1 AND companyID = :companyID
       ORDER BY Level ASC, roleID ASC`,
      { companyID }
    );
    // Hide Owner / Super Admin (L1) and Admin / Manager (L2) from Roles UI
    const roles = rows.map(mapTblRole).filter((r) => isAssignableStaffRoleLevel(r.level));
    const nextSeq = roles.length + 1;

    const levels = ASSIGNABLE_DEFAULT_ROLES.map((r) => ({
      level: r.level,
      label: `Level ${r.level}[${r.name}]`,
      name: r.name,
      description: r.description,
      color: r.color,
    }));

    return ok(res, { roles, levels, next_seq: nextSeq, total: roles.length, companyID });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load roles', 500);
  }
};

export const saveRole = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const id = req.params.id ? Number(req.params.id) : null;
    const name = String(req.body.name || '').trim();
    const level = Number(req.body.level);

    if (!name) return fail(res, 'Role name is required');
    if (!Number.isFinite(level) || level < 1 || level > 7) {
      return fail(res, 'Please select a valid level (1-7)');
    }
    if (!isAssignableStaffRoleLevel(level)) {
      return fail(res, 'Super Admin and Admin levels are reserved and cannot be created or edited here', 400);
    }

    const levelMeta = DEFAULT_ROLES.find((r) => r.level === level) || DEFAULT_ROLES[DEFAULT_ROLES.length - 1];
    const description = String(req.body.description || levelMeta.description || '').trim();
    const color = String(req.body.color || levelMeta.color || '#64748b').trim();

    if (id) {
      const [existing] = await db.query(
        'SELECT * FROM tblRole WHERE roleID = :id AND companyID = :companyID',
        { id, companyID }
      );
      if (!existing.length) return fail(res, 'Role not found for this company', 404);

      if (existing[0].IsDefault) {
        await db.query(
          `UPDATE tblRole
           SET RoleName = :name, Description = :description, Color = :color
           WHERE roleID = :id AND companyID = :companyID`,
          { name, description, color, id, companyID }
        );
      } else {
        const parts = String(existing[0].RoleCode || '').split('-');
        const seq = Number(parts[1]) || existing[0].roleID;
        const code = buildRoleCode(name, seq, level);

        const [dupCode] = await db.query(
          `SELECT roleID FROM tblRole
           WHERE RoleCode = :code AND companyID = :companyID AND roleID <> :id LIMIT 1`,
          { code, companyID, id }
        );
        if (dupCode.length) return fail(res, 'Role code already exists');

        await db.query(
          `UPDATE tblRole
           SET RoleName = :name, RoleCode = :code, Level = :level,
               Description = :description, Color = :color
           WHERE roleID = :id AND companyID = :companyID`,
          { name, code, level, description, color, id, companyID }
        );
      }
      return ok(res, { id }, 'Role updated');
    }

    const seq = await nextRoleSeq(companyID);
    let code = buildRoleCode(name, seq, level);

    let guard = 0;
    while (guard < 20) {
      const [dupCode] = await db.query(
        `SELECT roleID FROM tblRole WHERE RoleCode = :code AND companyID = :companyID LIMIT 1`,
        { code, companyID }
      );
      if (!dupCode.length) break;
      guard += 1;
      code = buildRoleCode(name, seq + guard, level);
    }

    const [result] = await db.query(
      `INSERT INTO tblRole (companyID, RoleName, RoleCode, Level, Description, Color, IsDefault, IsActive)
       VALUES (:companyID, :name, :code, :level, :description, :color, 0, 1)`,
      { companyID, name, code, level, description, color }
    );
    return ok(res, { id: result.insertId, code, companyID }, 'Role created', 201);
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save role', 500);
  }
};

export const deleteRole = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const id = Number(req.params.id);
    const [rows] = await db.query(
      'SELECT roleID, IsDefault, RoleName, companyID FROM tblRole WHERE roleID = :id AND companyID = :companyID',
      { id, companyID }
    );
    if (!rows.length) return fail(res, 'Role not found for this company', 404);
    if (rows[0].IsDefault) return fail(res, 'Default roles cannot be deleted', 400);

    // Block delete if staff in this company still use it
    const [[{ c }]] = await db.query(
      `SELECT COUNT(*) AS c FROM tblUser WHERE roleID = :id AND companyID = :companyID`,
      { id, companyID }
    );
    if (Number(c) > 0) {
      return fail(res, 'Role is assigned to staff — reassign them first', 400);
    }

    await db.query('DELETE FROM tblRole WHERE roleID = :id AND companyID = :companyID', {
      id,
      companyID,
    });
    return ok(res, {}, 'Role deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete role', 500);
  }
};

// Staff options for access control page
export const staffOptions = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [rows] = await db.query(
      `SELECT u.userID, u.name, u.email, u.roleID,
              r.RoleName AS assigned_role_name, r.RoleCode AS assigned_role_code, r.Level AS assigned_level,
              r.RoleCode, r.Level
       FROM tblUser u
       ${USER_ROLE_JOIN}
       WHERE ${SQL_PANEL_USER} AND ${SQL_STAFF_LOGIN_ONLY}
         AND u.companyID = :companyID AND u.is_active = 1
       ORDER BY u.name`,
      { companyID }
    );
    const staff = rows.map((row) => ({ ...row, role: accessRoleFromRow(row) }));
    return ok(res, { staff });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load staff options', 500);
  }
};

// -------- Assign User Right (map staff -> tblRole) --------
export const listUserRoleAssignments = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [staffRows] = await db.query(
      `SELECT u.userID, u.name, u.email, u.roleID, u.is_active,
              r.RoleName AS role_name, r.RoleCode AS role_code, r.Level AS role_level, r.Color AS role_color,
              r.RoleCode, r.Level
       FROM tblUser u
       ${USER_ROLE_JOIN}
       WHERE ${SQL_PANEL_USER} AND u.companyID = :companyID
       ORDER BY u.name`,
      { companyID }
    );
    const staff = staffRows.map((row) => ({ ...row, role: accessRoleFromRow(row) }));

    await ensureCompanyRoles(companyID);
    const [roles] = await db.query(
      `SELECT roleID AS id, RoleName AS name, RoleCode AS code, Level AS level, Color AS color, IsDefault AS is_default
       FROM tblRole
       WHERE IsActive = 1 AND companyID = :companyID AND Level >= 3 AND Level < 90
       ORDER BY Level ASC, roleID ASC`,
      { companyID }
    );

    return ok(res, { staff, roles });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load user role assignments', 500);
  }
};

export const assignUserRole = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const userId = Number(req.params.userId);
    const roleId = req.body.roleID === null || req.body.roleID === ''
      ? null
      : Number(req.body.roleID);

    const [tblUser] = await db.query(
      `SELECT u.userID AS id FROM tblUser u ${USER_ROLE_JOIN}
       WHERE u.userID = :id AND u.companyID = :companyID AND ${SQL_PANEL_USER}`,
      { id: userId, companyID }
    );
    if (!tblUser.length) return fail(res, 'User not found', 404);

    if (roleId != null) {
      const [roles] = await db.query(
        `SELECT roleID, Level FROM tblRole
         WHERE roleID = :id AND IsActive = 1 AND companyID = :companyID`,
        { id: roleId, companyID }
      );
      if (!roles.length) return fail(res, 'Role not found for this company', 404);
      if (!isAssignableStaffRoleLevel(roles[0].Level)) {
        return fail(res, 'Super Admin and Admin roles cannot be assigned to staff', 400);
      }
    }

    await db.query(`UPDATE tblUser SET roleID = :roleId WHERE userID = :id AND companyID = :companyID`, {
      roleId,
      id: userId,
      companyID,
    });

    return ok(res, { userID: userId, roleID: roleId }, 'User role assigned');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not assign user role', 500);
  }
};

// -------- Access Control --------
export const getRights = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const userId = Number(req.params.userId);
    const [userRows] = await db.query(
      `SELECT u.userID AS id, u.name, u.email, u.roleID, r.RoleCode, r.Level
       FROM tblUser u ${USER_ROLE_JOIN}
       WHERE u.userID = :id AND u.companyID = :companyID AND ${SQL_PANEL_USER}`,
      { id: userId, companyID }
    );
    if (!userRows.length) return fail(res, 'Staff not found', 404);
    const accessRole = accessRoleFromRow(userRows[0]);
    userRows[0].role = accessRole;

    const [rights] = await db.query(
      'SELECT module_key, can_view, can_create, can_edit, can_delete FROM tblUserRight WHERE userID = :userId',
      { userId }
    );

    // Super Admin pages are not assignable; Help & Support remains assignable
    const staffModules = MODULES.filter((m) => !STAFF_ACL_EXCLUDED_KEYS.has(m.key));
    const mapped = staffModules.map((m) => {
      const found = rights.find((r) => r.module_key === m.key);
      const viewOnly = VIEW_ONLY_MODULE_KEYS.has(m.key);
      const canView = found ? !!Number(found.can_view) : false;
      const canCreate = found ? !!Number(found.can_create) : false;
      const canEdit = found ? !!Number(found.can_edit) : false;
      const canDelete = found ? !!Number(found.can_delete) : false;
      return {
        module_key: m.key,
        label: m.label,
        view_only: viewOnly,
        can_view: canView,
        can_create: viewOnly ? false : canCreate,
        can_edit: viewOnly ? false : canEdit,
        can_delete: viewOnly ? false : canDelete,
      };
    });

    return ok(res, { user: userRows[0], rights: mapped, modules: staffModules });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load rights', 500);
  }
};

export const saveRights = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const companyID = requireCompanyId(req.user);
    const userId = Number(req.params.userId);
    const [owned] = await connection.query(
      `SELECT u.userID AS id FROM tblUser u ${USER_ROLE_JOIN}
       WHERE u.userID = :id AND u.companyID = :companyID
         AND ${SQL_PANEL_USER} AND ${SQL_STAFF_LOGIN_ONLY}`,
      { id: userId, companyID }
    );
    if (!owned.length) return fail(res, 'Staff not found', 404);
    const rights = (Array.isArray(req.body.rights) ? req.body.rights : []).filter(
      (r: any) => r?.module_key && !STAFF_ACL_EXCLUDED_KEYS.has(String(r.module_key))
    );
    await connection.beginTransaction();
    await connection.query('DELETE FROM tblUserRight WHERE userID = ?', [userId]);
    for (const r of rights) {
      const key = String(r.module_key);
      const viewOnly = VIEW_ONLY_MODULE_KEYS.has(key);
      const canView = r.can_view ? 1 : 0;
      const canCreate = viewOnly ? 0 : r.can_create ? 1 : 0;
      const canEdit = viewOnly ? 0 : r.can_edit ? 1 : 0;
      const canDelete = viewOnly ? 0 : r.can_delete ? 1 : 0;
      // Skip fully empty rows
      if (!canView && !canCreate && !canEdit && !canDelete) continue;
      await connection.query(
        `INSERT INTO tblUserRight (userID, module_key, can_view, can_create, can_edit, can_delete)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, key, canView || (canCreate || canEdit || canDelete ? 1 : 0), canCreate, canEdit, canDelete]
      );
    }
    await connection.commit();
    return ok(res, {}, 'Rights updated');
  } catch (err) {
    await connection.rollback();
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save rights', 500);
  } finally {
    connection.release();
  }
};

// -------- Suppliers --------
// -------- Company (+ linked admin via tblRole) --------
/** One row per company; admin = company admin only (isAdmin=1, not Super Admin) */
const COMPANY_SELECT = `
  SELECT c.companyID AS id, c.companyID, c.name, c.code, c.legal_name, c.email, c.phone, c.alternate_phone,
         c.website, c.address, c.city, c.state, c.pincode, c.country, c.gstin, c.pan, c.cin, c.logo_url, c.notes,
         c.bank_name, c.account_holder, c.account_number, c.ifsc_code, c.bank_branch, c.bank_address,
         c.is_active, c.created_at, c.updated_at,
         u.userID AS admin_user_id, u.name AS admin_username, u.email AS admin_email,
         u.phone AS admin_phone, u.roleID AS admin_role_id, r.RoleCode AS admin_role_code,
         r.RoleName AS admin_role_name, r.Level AS admin_role_level
  FROM tblCompany c
  LEFT JOIN tblUser u ON u.userID = (
    SELECT u2.userID
    FROM tblUser u2
    LEFT JOIN tblRole r2 ON r2.roleID = u2.roleID
    WHERE u2.companyID = c.companyID
      AND COALESCE(u2.isSuperAdmin, 0) = 0
      AND (
        COALESCE(u2.isAdmin, 0) = 1
        OR COALESCE(r2.Level, 99) <= 2
        OR LOWER(COALESCE(r2.RoleCode, '')) IN ('admin', 'owner', 'admin_manager')
      )
    ORDER BY COALESCE(u2.isAdmin, 0) DESC, COALESCE(r2.Level, 99) ASC, u2.userID ASC
    LIMIT 1
  )
  LEFT JOIN tblRole r ON r.roleID = u.roleID
`;

export const listCompanies = async (req, res) => {
  try {
    if (canManageAllCompanies(req.user)) {
      const [items] = await db.query(`${COMPANY_SELECT} ORDER BY c.name ASC`);
      return ok(res, { items });
    }
    const companyID = requireCompanyId(req.user);
    const [items] = await db.query(
      `${COMPANY_SELECT} WHERE c.companyID = :companyID ORDER BY c.name ASC`,
      { companyID }
    );
    return ok(res, { items });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load companies', 500);
  }
};

export const getCompany = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!canManageAllCompanies(req.user)) {
      const companyID = requireCompanyId(req.user);
      if (id !== companyID) return fail(res, 'Company not found', 404);
    }
    const [rows] = await db.query(`${COMPANY_SELECT} WHERE c.companyID = :id LIMIT 1`, {
      id,
    });
    if (!rows.length) return fail(res, 'Company not found', 404);
    const [documents] = await db.query(
      `SELECT companyDocumentID AS id, companyID, doc_type, doc_name, file_url, created_at
       FROM tblCompanyDocument WHERE companyID = :id ORDER BY companyDocumentID ASC`,
      { id }
    );
    return ok(res, { item: { ...rows[0], documents: documents || [] } });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load company', 500);
  }
};

export const saveCompany = async (req, res) => {
  try {
    const ownCompanyID = canManageAllCompanies(req.user) ? null : requireCompanyId(req.user);
    const data = {
      name: String(req.body.name || '').trim(),
      code: req.body.code || null,
      legal_name: req.body.legal_name || null,
      email: req.body.email || null,
      phone: req.body.phone || null,
      alternate_phone: req.body.alternate_phone || null,
      website: req.body.website || null,
      address: req.body.address || null,
      city: req.body.city || null,
      state: req.body.state || null,
      pincode: req.body.pincode || null,
      country: req.body.country || 'India',
      gstin: req.body.gstin || null,
      pan: req.body.pan || null,
      cin: req.body.cin || null,
      logo_url: req.body.logo_url || null,
      bank_name: req.body.bank_name || null,
      account_holder: req.body.account_holder || null,
      account_number: req.body.account_number || null,
      ifsc_code: req.body.ifsc_code || null,
      bank_branch: req.body.bank_branch || null,
      bank_address: req.body.bank_address || null,
      notes: req.body.notes || null,
      is_active: req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
    };
    if (!data.name) return fail(res, 'Company name is required', 400);

    const adminUsername = String(req.body.admin_username || '').trim();
    const adminEmail = String(req.body.admin_email || '').trim().toLowerCase();
    const adminPhone = String(req.body.admin_phone || '').trim() || null;
    const adminPassword = String(req.body.admin_password || '');
    const isUpdate = Boolean(req.params.id);

    if (!adminUsername) return fail(res, 'Admin username is required', 400);
    if (!adminEmail) return fail(res, 'Admin email is required', 400);
    if (!isUpdate && !adminPassword) return fail(res, 'Admin password is required', 400);

    // Prefer admin contact on company if company contact empty
    if (!data.email) data.email = adminEmail;
    if (!data.phone) data.phone = adminPhone;

    let companyId = isUpdate ? Number(req.params.id) : null;
    if (isUpdate && !canManageAllCompanies(req.user) && companyId !== ownCompanyID) {
      return fail(res, 'Company not found', 404);
    }
    if (!isUpdate && !canManageAllCompanies(req.user)) {
      return fail(res, 'Only Super Admin can create companies', 403);
    }

    if (isUpdate) {
      await db.query(
        `UPDATE tblCompany SET
         name=:name, code=:code, legal_name=:legal_name, email=:email, phone=:phone,
         alternate_phone=:alternate_phone, website=:website, address=:address, city=:city,
         state=:state, pincode=:pincode, country=:country, gstin=:gstin, pan=:pan, cin=:cin,
         logo_url=:logo_url, bank_name=:bank_name, account_holder=:account_holder,
         account_number=:account_number, ifsc_code=:ifsc_code, bank_branch=:bank_branch,
         bank_address=:bank_address, notes=:notes, is_active=:is_active
         WHERE companyID=:id`,
        { ...data, id: companyId }
      );
    } else {
      const [result] = await db.query(
        `INSERT INTO tblCompany
         (name, code, legal_name, email, phone, alternate_phone, website, address, city, state,
          pincode, country, gstin, pan, cin, logo_url, bank_name, account_holder, account_number,
          ifsc_code, bank_branch, bank_address, notes, is_active)
         VALUES
         (:name, :code, :legal_name, :email, :phone, :alternate_phone, :website, :address, :city, :state,
          :pincode, :country, :gstin, :pan, :cin, :logo_url, :bank_name, :account_holder, :account_number,
          :ifsc_code, :bank_branch, :bank_address, :notes, :is_active)`,
        data
      );
      companyId = result.insertId;
    }

    // Replace company documents when array provided
    if (Array.isArray(req.body.documents)) {
      await db.query('DELETE FROM tblCompanyDocument WHERE companyID = :id', { id: companyId });
      for (const row of req.body.documents) {
        const docType = String(row?.doc_type || '').trim();
        const docName = String(row?.doc_name || '').trim();
        const fileUrl = String(row?.file_url || '').trim();
        if (!docType && !docName && !fileUrl) continue;
        await db.query(
          `INSERT INTO tblCompanyDocument (companyID, doc_type, doc_name, file_url)
           VALUES (:companyID, :doc_type, :doc_name, :file_url)`,
          {
            companyID: companyId,
            doc_type: docType || null,
            doc_name: docName || null,
            file_url: fileUrl || null,
          }
        );
      }
    }

    await ensureCompanyRoles(companyId);
    const adminRoleId = await getRoleId('admin', companyId);

    const [existingAdmin] = await db.query(
      `SELECT u.userID AS id
       FROM tblUser u
       ${USER_ROLE_JOIN}
       WHERE (u.companyID = :companyId AND ${SQL_ADMIN_USER})
          OR (u.email = :email AND ${SQL_ADMIN_USER})
       ORDER BY CASE WHEN u.companyID = :companyId THEN 0 ELSE 1 END
       LIMIT 1`,
      { companyId, email: adminEmail }
    );

    const excludeId = existingAdmin[0]?.id || 0;
    const [emailClash] = await db.query(
      `SELECT userID AS id FROM tblUser WHERE email = :email AND userID <> :excludeId LIMIT 1`,
      { email: adminEmail, excludeId }
    );
    if (emailClash.length) return fail(res, 'Admin email already exists', 400);

    if (existingAdmin.length) {
      if (adminPassword) {
        const hash = await bcrypt.hash(adminPassword, 10);
        await db.query(
          `UPDATE tblUser SET name=:name, email=:email, phone=:phone, password=:password,
           password_changed_at=NOW(), session_token=NULL,
           roleID=:roleID, companyID=:companyId, isAdmin=1, isSuperAdmin=0, branchID=0, is_active=:is_active
           WHERE userID=:id`,
          {
            name: adminUsername,
            email: adminEmail,
            phone: adminPhone,
            password: hash,
            roleID: adminRoleId,
            companyId,
            is_active: data.is_active,
            id: existingAdmin[0].id,
          }
        );
      } else {
        await db.query(
          `UPDATE tblUser SET name=:name, email=:email, phone=:phone,
           roleID=:roleID, companyID=:companyId, isAdmin=1, isSuperAdmin=0, branchID=0, is_active=:is_active
           WHERE userID=:id`,
          {
            name: adminUsername,
            email: adminEmail,
            phone: adminPhone,
            roleID: adminRoleId,
            companyId,
            is_active: data.is_active,
            id: existingAdmin[0].id,
          }
        );
      }
    } else {
      if (!adminPassword) return fail(res, 'Admin password is required for new admin', 400);
      const hash = await bcrypt.hash(adminPassword, 10);
      await db.query(
        `INSERT INTO tblUser (name, email, password, phone, roleID, companyID, isAdmin, isSuperAdmin, branchID, is_active)
         VALUES (:name, :email, :password, :phone, :roleID, :companyId, 1, 0, 0, :is_active)`,
        {
          name: adminUsername,
          email: adminEmail,
          password: hash,
          phone: adminPhone,
          roleID: adminRoleId,
          companyId,
          is_active: data.is_active,
        }
      );
    }

    return ok(
      res,
      { id: companyId },
      isUpdate ? 'Company & admin updated' : 'Company & admin created',
      isUpdate ? 200 : 201
    );
  } catch (err: any) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    if (err?.code === 'ER_DUP_ENTRY') {
      return fail(res, 'Company code or admin email already exists', 400);
    }
    return fail(res, 'Could not save company', 500);
  }
};

export const deleteCompany = async (req, res) => {
  try {
    if (!canManageAllCompanies(req.user)) {
      return fail(res, 'Only Super Admin can delete companies', 403);
    }
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    throw err;
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const companyId = req.params.id;
    // Remove company-linked admin accounts (via tblRole)
    await connection.query(
      `DELETE u FROM tblUser u
       LEFT JOIN tblRole r ON r.roleID = u.roleID
       WHERE u.companyID = :companyId
         AND (r.Level <= 2 OR LOWER(r.RoleCode) IN ('admin','owner','admin_manager'))`,
      { companyId }
    );
    await connection.query('DELETE FROM tblCompanyDocument WHERE companyID = :id', { id: companyId }).catch(() => null);
    await connection.query('DELETE FROM tblCompany WHERE companyID = :id', { id: companyId });
    await connection.commit();
    return ok(res, {}, 'Company deleted');
  } catch (err) {
    await connection.rollback();
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete company', 500);
  } finally {
    connection.release();
  }
};

export const listSuppliers = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [items] = await db.query(
      'SELECT * FROM tblSupplier WHERE companyID = :companyID ORDER BY name',
      { companyID }
    );
    return ok(res, { items });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load tblSupplier', 500);
  }
};

async function nextSupplierCode(companyID: number) {
  const [[{ c }]] = await db.query(
    `SELECT COUNT(*) AS c FROM tblSupplier WHERE companyID = :companyID`,
    { companyID }
  );
  let seq = Number(c || 0) + 1;
  for (let i = 0; i < 30; i += 1) {
    const code = `SUP-${String(seq).padStart(3, '0')}`;
    const [dup] = await db.query(
      `SELECT supplierID FROM tblSupplier
       WHERE companyID = :companyID AND code = :code LIMIT 1`,
      { companyID, code }
    );
    if (!dup.length) return code;
    seq += 1;
  }
  return `SUP-${Date.now().toString().slice(-6)}`;
}

export const saveSupplier = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const id = req.params.id ? Number(req.params.id) : null;
    const data = {
      name: req.body.name,
      companyID,
      phone: req.body.phone || null,
      alternate_phone: req.body.alternate_phone || null,
      email: req.body.email || null,
      address: req.body.address || null,
      city: req.body.city || null,
      state: req.body.state || null,
      pincode: req.body.pincode || null,
      country: req.body.country || 'India',
      gstin: req.body.gstin || null,
      pan: req.body.pan || null,
      company_type: req.body.company_type || null,
      payment_terms: req.body.payment_terms || null,
      credit_days: Number(req.body.credit_days) || 0,
      credit_limit: Number(req.body.credit_limit) || 0,
      bank_name: req.body.bank_name || null,
      bank_account_name: req.body.bank_account_name || null,
      bank_account_no: req.body.bank_account_no || null,
      bank_ifsc: req.body.bank_ifsc || null,
      bank_branch: req.body.bank_branch || null,
      bank_address: req.body.bank_address || null,
      website: req.body.website || null,
      contact_person: req.body.contact_person || null,
      notes: req.body.notes || null,
      is_active: req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
    };
    if (!data.name) return fail(res, 'Supplier name is required', 400);

    if (id) {
      // Keep existing supplier code — never overwrite from client
      await db.query(
        `UPDATE tblSupplier SET
         name=:name, phone=:phone, alternate_phone=:alternate_phone, email=:email,
         address=:address, city=:city, state=:state, pincode=:pincode, country=:country,
         gstin=:gstin, pan=:pan, company_type=:company_type, payment_terms=:payment_terms,
         credit_days=:credit_days, credit_limit=:credit_limit, bank_name=:bank_name,
         bank_account_name=:bank_account_name, bank_account_no=:bank_account_no, bank_ifsc=:bank_ifsc,
         bank_branch=:bank_branch, bank_address=:bank_address,
         website=:website, contact_person=:contact_person, notes=:notes, is_active=:is_active
         WHERE supplierID=:id AND companyID=:companyID`,
        { ...data, id }
      );
      const [[row]] = await db.query(
        `SELECT code FROM tblSupplier WHERE supplierID = :id AND companyID = :companyID LIMIT 1`,
        { id, companyID }
      );
      return ok(res, { id, code: row?.code || null }, 'Supplier updated');
    }

    const code = await nextSupplierCode(companyID);
    const [result] = await db.query(
      `INSERT INTO tblSupplier
       (name, code, phone, alternate_phone, email, address, city, state, pincode, country,
        gstin, pan, company_type, payment_terms, credit_days, credit_limit, bank_name,
        bank_account_name, bank_account_no, bank_ifsc, bank_branch, bank_address,
        website, contact_person, notes, is_active, companyID)
       VALUES
       (:name, :code, :phone, :alternate_phone, :email, :address, :city, :state, :pincode, :country,
        :gstin, :pan, :company_type, :payment_terms, :credit_days, :credit_limit, :bank_name,
        :bank_account_name, :bank_account_no, :bank_ifsc, :bank_branch, :bank_address,
        :website, :contact_person, :notes, :is_active, :companyID)`,
      { ...data, code }
    );
    return ok(res, { id: result.insertId, code }, 'Supplier created', 201);
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save supplier', 500);
  }
};

export const deleteSupplier = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await db.query('DELETE FROM tblSupplier WHERE supplierID = :id AND companyID = :companyID', {
      id: req.params.id,
      companyID,
    });
    return ok(res, {}, 'Supplier deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete supplier', 500);
  }
};

// -------- Product Types --------
export const listProductTypes = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [items] = await db.query(
      'SELECT * FROM tblProductType WHERE companyID = :companyID ORDER BY name',
      { companyID }
    );
    return ok(res, { items });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load product types', 500);
  }
};

export const saveProductType = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const name = String(req.body.name || '').trim();
    if (!name) return fail(res, 'Product type name is required', 400);
    const slug = slugify(req.body.slug || name);
    const description = req.body.description || '';
    const is_active = req.body.is_active === false || req.body.is_active === 0 ? 0 : 1;
    if (req.params.id) {
      await db.query(
        'UPDATE tblProductType SET name=:name, slug=:slug, description=:description, is_active=:is_active WHERE productTypeID=:id AND companyID=:companyID',
        { name, slug, description, is_active, id: req.params.id, companyID }
      );
      return ok(res, { id: Number(req.params.id), name }, 'Product type updated');
    }
    const [result] = await db.query(
      'INSERT INTO tblProductType (name, slug, description, is_active, companyID) VALUES (:name, :slug, :description, :is_active, :companyID)',
      { name, slug, description, is_active, companyID }
    );
    return ok(res, { id: result.insertId, name }, 'Product type created', 201);
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save product type', 500);
  }
};

export const deleteProductType = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await db.query(
      'DELETE FROM tblProductType WHERE productTypeID = :id AND companyID = :companyID',
      { id: req.params.id, companyID }
    );
    return ok(res, {}, 'Product type deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete product type', 500);
  }
};

// -------- Payment Gateways --------
export const listGateways = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [items] = await db.query(
      'SELECT * FROM tblPaymentGateway WHERE companyID = :companyID ORDER BY paymentGatewayID DESC',
      { companyID }
    );
    return ok(res, { items });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load gateways', 500);
  }
};

export const saveGateway = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const data = {
      name: req.body.name,
      provider: req.body.provider,
      api_key: req.body.api_key || null,
      secret_key: req.body.secret_key || null,
      webhook_url: req.body.webhook_url || null,
      is_active: req.body.is_active ? 1 : 0,
      mode: req.body.mode === 'live' ? 'live' : 'test',
      companyID,
    };
    if (req.params.id) {
      await db.query(
        `UPDATE tblPaymentGateway SET name=:name, provider=:provider, api_key=:api_key, secret_key=:secret_key,
         webhook_url=:webhook_url, is_active=:is_active, mode=:mode
         WHERE paymentGatewayID=:id AND companyID=:companyID`,
        { ...data, id: req.params.id }
      );
    } else {
      await db.query(
        `INSERT INTO tblPaymentGateway (name, provider, api_key, secret_key, webhook_url, is_active, mode, companyID)
         VALUES (:name, :provider, :api_key, :secret_key, :webhook_url, :is_active, :mode, :companyID)`,
        data
      );
    }
    return ok(res, {}, 'Payment gateway saved');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save gateway', 500);
  }
};

export const deleteGateway = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await db.query(
      'DELETE FROM tblPaymentGateway WHERE paymentGatewayID = :id AND companyID = :companyID',
      { id: req.params.id, companyID }
    );
    return ok(res, {}, 'Gateway deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete gateway', 500);
  }
};

// -------- Billing --------
export const listBillings = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const q = String(req.query.q || '').trim();
    const dateFrom = String(req.query.date_from || req.query.from || '').trim();
    const dateTo = String(req.query.date_to || req.query.to || '').trim();
    const params: any = { companyID };
    let where = 'b.companyID = :companyID';
    if (q) {
      where +=
        ' AND (b.invoice_no LIKE :q OR b.customer_name LIKE :q OR b.customer_email LIKE :q OR CAST(b.billingID AS CHAR) = :qExact OR CAST(b.orderID AS CHAR) = :qExact OR o.order_number LIKE :q)';
      params.q = `%${q}%`;
      params.qExact = q;
    }
    if (dateFrom) {
      where += ' AND DATE(b.created_at) >= :dateFrom';
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      where += ' AND DATE(b.created_at) <= :dateTo';
      params.dateTo = dateTo;
    }
    // Alias billingID AS id so hydrateId does not pick orderID instead
    const [items] = await db.query(
      `SELECT b.billingID AS id, b.billingID, b.invoice_no, b.orderID, b.customer_name, b.customer_email,
              b.amount, b.tax, b.total, b.status, b.due_date, b.notes, b.created_at, b.companyID,
              o.order_number, o.status AS order_status, o.payment_status, o.payment_method, o.order_source
       FROM tblBilling b
       LEFT JOIN tblOrder o ON o.orderID = b.orderID AND o.companyID = b.companyID
       WHERE ${where}
       ORDER BY b.created_at DESC`,
      params
    );
    return ok(res, { items });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load tblBilling', 500);
  }
};

export const getBilling = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const raw = String(req.params.id || '').trim();
    const id = Number(raw);
    const [[bill]] = await db.query(
      `SELECT billingID AS id, billingID, invoice_no, orderID, customer_name, customer_email,
              amount, tax, total, status, due_date, notes, created_at, companyID
       FROM tblBilling
       WHERE companyID = :companyID
         AND (billingID = :id OR invoice_no = :raw OR orderID = :id)
       ORDER BY CASE WHEN billingID = :id THEN 0 WHEN invoice_no = :raw THEN 1 ELSE 2 END
       LIMIT 1`,
      { id: Number.isFinite(id) ? id : 0, raw, companyID }
    );
    if (!bill) return fail(res, 'Invoice not found', 404);

    let order: any = null;
    let items: any[] = [];
    let payments: any[] = [];
    const orderId = bill.orderID || bill.order_id;

    if (orderId) {
      const [[ord]] = await db.query(
        `SELECT * FROM tblOrder WHERE orderID = :id AND companyID = :companyID LIMIT 1`,
        { id: orderId, companyID }
      );
      order = ord || null;
      const [itemRows] = await db.query(
        `SELECT * FROM tblOrderItem WHERE orderID = :id ORDER BY orderItemID ASC`,
        { id: orderId }
      );
      items = itemRows || [];
      const [payRows] = await db.query(
        `SELECT * FROM tblPosPayment WHERE orderID = :id ORDER BY posPaymentID ASC`,
        { id: orderId }
      );
      payments = payRows || [];
    }

    return ok(res, {
      invoice: bill,
      order,
      items,
      payments,
      totals: {
        subtotal: Number(order?.subtotal || bill.amount || 0),
        discount: Number(order?.discount || 0),
        coupon_discount: Number(order?.coupon_discount || 0),
        tax_amount: Number(order?.tax_amount || bill.tax || 0),
        additional_charges: Number(order?.shipping_fee || 0),
        round_off: Number(order?.round_off || 0),
        total: Number(order?.total || bill.total || 0),
        amount_received: Number(order?.amount_received || bill.total || 0),
        change_amount: Number(order?.change_amount || 0),
      },
    });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load invoice', 500);
  }
};

export const saveBilling = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const amount = Number(req.body.amount) || 0;
    const tax = Number(req.body.tax) || 0;
    const data = {
      invoice_no: req.body.invoice_no || `INV${Date.now().toString().slice(-8)}`,
      orderID: req.body.orderID || null,
      customer_name: req.body.customer_name,
      customer_email: req.body.customer_email || null,
      amount,
      tax,
      total: amount + tax,
      status: req.body.status || 'draft',
      due_date: req.body.due_date || null,
      notes: req.body.notes || null,
      companyID,
    };
    if (req.params.id) {
      await db.query(
        `UPDATE tblBilling SET invoice_no=:invoice_no, orderID=:orderID, customer_name=:customer_name,
         customer_email=:customer_email, amount=:amount, tax=:tax, total=:total, status=:status,
         due_date=:due_date, notes=:notes WHERE billingID=:id AND companyID=:companyID`,
        { ...data, id: req.params.id }
      );
    } else {
      await db.query(
        `INSERT INTO tblBilling (invoice_no, orderID, customer_name, customer_email, amount, tax, total, status, due_date, notes, companyID)
         VALUES (:invoice_no, :orderID, :customer_name, :customer_email, :amount, :tax, :total, :status, :due_date, :notes, :companyID)`,
        data
      );
    }
    return ok(res, {}, 'Billing saved');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save billing', 500);
  }
};

export const deleteBilling = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await db.query('DELETE FROM tblBilling WHERE billingID = :id AND companyID = :companyID', {
      id: req.params.id,
      companyID,
    });
    return ok(res, {}, 'Billing deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete billing', 500);
  }
};

// -------- Dropshipping --------
export const listDropships = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const [items] = await db.query(
      'SELECT * FROM tblDropshipOrder WHERE companyID = :companyID ORDER BY created_at DESC',
      { companyID }
    );
    return ok(res, { items });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load dropship tblOrder', 500);
  }
};

export const saveDropship = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const data = {
      reference_no: req.body.reference_no || `DS${Date.now().toString().slice(-8)}`,
      supplier_name: req.body.supplier_name,
      product_name: req.body.product_name,
      quantity: Number(req.body.quantity) || 1,
      cost_price: Number(req.body.cost_price) || 0,
      sell_price: Number(req.body.sell_price) || 0,
      customer_name: req.body.customer_name,
      shipping_address: req.body.shipping_address,
      status: req.body.status || 'pending',
      tracking_no: req.body.tracking_no || null,
      companyID,
    };
    if (req.params.id) {
      await db.query(
        `UPDATE tblDropshipOrder SET reference_no=:reference_no, supplier_name=:supplier_name, product_name=:product_name,
         quantity=:quantity, cost_price=:cost_price, sell_price=:sell_price, customer_name=:customer_name,
         shipping_address=:shipping_address, status=:status, tracking_no=:tracking_no
         WHERE dropshipOrderID=:id AND companyID=:companyID`,
        { ...data, id: req.params.id }
      );
    } else {
      await db.query(
        `INSERT INTO tblDropshipOrder
         (reference_no, supplier_name, product_name, quantity, cost_price, sell_price, customer_name, shipping_address, status, tracking_no, companyID)
         VALUES
         (:reference_no, :supplier_name, :product_name, :quantity, :cost_price, :sell_price, :customer_name, :shipping_address, :status, :tracking_no, :companyID)`,
        data
      );
    }
    return ok(res, {}, 'Dropship order saved');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save dropship order', 500);
  }
};

export const deleteDropship = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await db.query(
      'DELETE FROM tblDropshipOrder WHERE dropshipOrderID = :id AND companyID = :companyID',
      { id: req.params.id, companyID }
    );
    return ok(res, {}, 'Dropship order deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete dropship order', 500);
  }
};

// -------- Finance --------
export const listFinance = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const type = String(req.query.type || '').trim().toLowerCase();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const q = String(req.query.q || '').trim();
    const entryType = String(req.query.entry_type || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim();

    const params: any = { companyID };
    let where = 'companyID = :companyID';
    if (dateFrom) {
      where += ' AND entry_date >= :dateFrom';
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      where += ' AND entry_date <= :dateTo';
      params.dateTo = dateTo;
    }
    if (entryType === 'income' || entryType === 'expense') {
      where += ' AND type = :entryType';
      params.entryType = entryType;
    }
    if (category) {
      where += ' AND category LIKE :category';
      params.category = `%${category}%`;
    }
    if (q) {
      where += ' AND (category LIKE :q OR reference_no LIKE :q OR description LIKE :q)';
      params.q = `%${q}%`;
    }

    // Page-specific presets
    if (type === 'bank') {
      where += ` AND (category LIKE '%bank%' OR description LIKE '%bank%' OR reference_no LIKE '%BANK%')`;
    } else if (type === 'cash') {
      where += ` AND (category LIKE '%cash%' OR description LIKE '%cash%' OR reference_no LIKE '%CASH%')`;
    } else if (type === 'expense' || type === 'spent') {
      where += ` AND type = 'expense'`;
    } else if (type === 'daybook') {
      where += ' AND entry_date = CURDATE()';
    }

    const [items] = await db.query(
      `SELECT * FROM tblFinanceEntry WHERE ${where} ORDER BY entry_date DESC, financeEntryID DESC LIMIT 500`,
      params
    );
    const [[summary]] = await db.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense,
        COUNT(*) AS entries
      FROM tblFinanceEntry
      WHERE ${where}
    `,
      params
    );

    return ok(res, {
      type: type || 'accounts',
      items,
      summary: {
        income: Number(summary.income),
        expense: Number(summary.expense),
        balance: Number(summary.income) - Number(summary.expense),
        entries: Number(summary.entries),
      },
    });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load finance', 500);
  }
};

export const saveFinance = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const data = {
      entry_date: req.body.entry_date || new Date().toISOString().slice(0, 10),
      type: req.body.type === 'expense' ? 'expense' : 'income',
      category: req.body.category,
      amount: Number(req.body.amount) || 0,
      reference_no: req.body.reference_no || null,
      description: req.body.description || null,
      createdByUserID: req.user.id,
      companyID,
    };
    if (req.params.id) {
      await db.query(
        `UPDATE tblFinanceEntry SET entry_date=:entry_date, type=:type, category=:category,
         amount=:amount, reference_no=:reference_no, description=:description
         WHERE financeEntryID=:id AND companyID=:companyID`,
        { ...data, id: req.params.id }
      );
    } else {
      await db.query(
        `INSERT INTO tblFinanceEntry (entry_date, type, category, amount, reference_no, description, createdByUserID, companyID)
         VALUES (:entry_date, :type, :category, :amount, :reference_no, :description, :createdByUserID, :companyID)`,
        data
      );
    }
    return ok(res, {}, 'Finance entry saved');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not save finance entry', 500);
  }
};

export const deleteFinance = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    await db.query(
      'DELETE FROM tblFinanceEntry WHERE financeEntryID = :id AND companyID = :companyID',
      { id: req.params.id, companyID }
    );
    return ok(res, {}, 'Finance entry deleted');
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Could not delete finance entry', 500);
  }
};

// -------- Reports --------
export const reports = async (req, res) => {
  try {
    const companyID = requireCompanyId(req.user);
    const type = String(req.query.type || 'users').toLowerCase();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const source = String(req.query.source || '').trim();
    const paymentStatus = String(req.query.payment_status || '').trim();
    const warehouse = String(req.query.warehouse || '').trim();
    const active = String(req.query.active || '').trim();
    const city = String(req.query.city || '').trim();

    const dateClause = (alias = '') => {
      const col = alias ? `${alias}.created_at` : 'created_at';
      const parts = [];
      const params: any = {};
      if (dateFrom) {
        parts.push(`DATE(${col}) >= :dateFrom`);
        params.dateFrom = dateFrom;
      }
      if (dateTo) {
        parts.push(`DATE(${col}) <= :dateTo`);
        params.dateTo = dateTo;
      }
      return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
    };

    let rows = [];
    let summary = {};
    let chart = [];
    let columns = [];

    // User Report = staff details (panel users excluding company/super admins)
    if (type === 'users' || type === 'staff' || type === 'tbluser') {
      const d = dateClause('u');
      const params: any = { ...d.params, companyID };
      let where = `${SQL_PANEL_USER} AND ${SQL_STAFF_LOGIN_ONLY} AND u.companyID = :companyID${d.sql}`;
      if (q) {
        where += ` AND (
          u.name LIKE :q OR u.phone LIKE :q OR u.email LIKE :q OR u.city LIKE :q
          OR r.RoleName LIKE :q OR sp.employee_code LIKE :q OR sp.department LIKE :q OR sp.designation LIKE :q
        )`;
        params.q = `%${q}%`;
      }
      if (city) {
        where += ` AND u.city LIKE :city`;
        params.city = `%${city}%`;
      }
      if (active === '1' || active === '0') {
        where += ` AND u.is_active = :active`;
        params.active = Number(active);
      } else if (status === 'active') {
        where += ` AND u.is_active = 1`;
      } else if (status === 'inactive') {
        where += ` AND u.is_active = 0`;
      }

      const [list] = await db.query(
        `
        SELECT
          u.userID AS id,
          u.name,
          u.email,
          u.phone,
          u.city,
          u.state,
          u.is_active,
          u.created_at,
          r.RoleName AS role_name,
          r.RoleCode AS role_code,
          sp.employee_code,
          sp.department,
          sp.designation,
          sp.join_date,
          sp.employment_type,
          b.name AS branch_name,
          w.name AS warehouse_name
        FROM tblUser u
        ${USER_ROLE_JOIN}
        LEFT JOIN tblStaffProfile sp ON sp.userID = u.userID
        LEFT JOIN tblBranch b ON b.branchID = u.branchID
        LEFT JOIN tblWarehouse w ON w.warehouseID = u.warehouseID
        WHERE ${where}
        ORDER BY u.created_at DESC
        LIMIT 500
      `,
        params
      ).catch(async () => {
        // Older DBs may miss some joins — fallback without profile/branch/warehouse names
        const [fallback] = await db.query(
          `
          SELECT
            u.userID AS id, u.name, u.email, u.phone, u.city, u.state, u.is_active, u.created_at,
            r.RoleName AS role_name, r.RoleCode AS role_code,
            NULL AS employee_code, NULL AS department, NULL AS designation,
            NULL AS join_date, NULL AS employment_type,
            NULL AS branch_name, NULL AS warehouse_name
          FROM tblUser u
          ${USER_ROLE_JOIN}
          WHERE ${SQL_PANEL_USER} AND ${SQL_STAFF_LOGIN_ONLY} AND u.companyID = :companyID
          ORDER BY u.created_at DESC
          LIMIT 500
        `,
          { companyID }
        );
        return [fallback];
      });

      rows = list;
      columns = [
        { key: 'employee_code', label: 'Emp ID' },
        { key: 'name', label: 'Staff Name' },
        { key: 'role_name', label: 'Role' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'department', label: 'Department' },
        { key: 'designation', label: 'Designation' },
        { key: 'branch_name', label: 'Branch' },
        { key: 'warehouse_name', label: 'Warehouse' },
        { key: 'city', label: 'City' },
        { key: 'is_active', label: 'Active' },
        { key: 'join_date', label: 'Join Date' },
        { key: 'created_at', label: 'Created' },
      ];
      const activeCount = rows.filter((r) => Number(r.is_active)).length;
      summary = {
        staff: rows.length,
        active: activeCount,
        inactive: rows.length - activeCount,
        roles: new Set(rows.map((r) => r.role_name).filter(Boolean)).size,
      };
      const byRole: Record<string, number> = {};
      rows.forEach((r) => {
        const k = r.role_name || 'Unassigned';
        byRole[k] = (byRole[k] || 0) + 1;
      });
      chart = Object.entries(byRole).map(([name, value]) => ({ name, value }));
    } else if (type === 'sales' || type === 'day') {
      await ensureOrderBranchColumn();
      const d = dateClause('o');
      const params: any = { ...d.params, companyID };
      const paymentMethod = String(req.query.payment_method || '').trim();
      const cashierId = Number(req.query.cashier_id || req.query.cashier || 0) || 0;
      const cashierName = !cashierId ? String(req.query.cashier_name || req.query.cashier || '').trim() : '';
      const customerQ = String(req.query.customer || '').trim();
      // Exclude cancelled from sales report base set (completed sales totals)
      let where = `o.status <> 'cancelled' AND o.companyID = :companyID`;
      if (type === 'day' && !dateFrom && !dateTo) {
        where += ` AND DATE(o.created_at) = CURDATE()`;
      }
      if (status) {
        where += ` AND o.status = :status`;
        params.status = status;
      }
      if (source) {
        where += ` AND o.order_source = :source`;
        params.source = source;
      }
      if (paymentStatus) {
        where += ` AND o.payment_status = :paymentStatus`;
        params.paymentStatus = paymentStatus;
      }
      if (paymentMethod) {
        where += ` AND o.payment_method = :paymentMethod`;
        params.paymentMethod = paymentMethod;
      }
      if (q) {
        where += ` AND (
          o.order_number LIKE :q OR o.shipping_name LIKE :q OR o.shipping_phone LIKE :q
          OR o.shipping_city LIKE :q OR b.name LIKE :q OR b.code LIKE :q
          OR EXISTS (
            SELECT 1 FROM tblBilling inv
            WHERE inv.orderID = o.orderID AND inv.invoice_no LIKE :q
          )
        )`;
        params.q = `%${q}%`;
      }
      if (customerQ) {
        where += ` AND (o.shipping_name LIKE :customerQ OR o.shipping_phone LIKE :customerQ)`;
        params.customerQ = `%${customerQ}%`;
      }
      if (cashierId) {
        where += ` AND (
          EXISTS (
            SELECT 1 FROM tblPosPayment pp
            WHERE pp.orderID = o.orderID AND pp.receivedByUserID = :cashierId
          )
          OR EXISTS (
            SELECT 1 FROM tblOrderStatusHistory h
            WHERE h.orderID = o.orderID AND h.createdByUserID = :cashierId
          )
        )`;
        params.cashierId = cashierId;
      } else if (cashierName) {
        where += ` AND (
          EXISTS (
            SELECT 1 FROM tblPosPayment pp
            JOIN tblUser cu ON cu.userID = pp.receivedByUserID
            WHERE pp.orderID = o.orderID AND cu.name LIKE :cashierName
          )
          OR EXISTS (
            SELECT 1 FROM tblOrderStatusHistory h
            JOIN tblUser cu ON cu.userID = h.createdByUserID
            WHERE h.orderID = o.orderID AND cu.name LIKE :cashierName
          )
        )`;
        params.cashierName = `%${cashierName}%`;
      }
      const userBranch = getBranchId(req.user);
      const branchParam = Number(req.query.branch_id || req.query.branchID || 0) || 0;
      const branchName = String(req.query.branch || '').trim();
      if (userBranch) {
        where += ` AND o.branchID = :branchID`;
        params.branchID = userBranch;
      } else if (branchParam) {
        where += ` AND o.branchID = :branchID`;
        params.branchID = branchParam;
      } else if (branchName) {
        where += ` AND (b.name LIKE :branchName OR b.code LIKE :branchName)`;
        params.branchName = `%${branchName}%`;
      }
      where += d.sql;

      const [list] = await db.query(
        `
        SELECT
          o.orderID AS id,
          o.order_number,
          o.order_source,
          o.status,
          o.fulfillment_status,
          o.payment_method,
          o.payment_status,
          o.subtotal,
          o.discount,
          o.coupon_discount,
          (COALESCE(o.discount, 0) + COALESCE(o.coupon_discount, 0)) AS total_discount,
          o.tax_amount,
          o.shipping_fee,
          o.round_off,
          o.total,
          o.amount_received,
          o.change_amount,
          o.refund_amount,
          o.refund_status,
          o.refund_completed,
          o.shipping_name,
          o.shipping_phone,
          o.shipping_city,
          o.shipping_state,
          o.companyID,
          o.branchID,
          b.name AS branch_name,
          b.code AS branch_code,
          (
            SELECT inv.invoice_no FROM tblBilling inv
            WHERE inv.orderID = o.orderID
            ORDER BY inv.billingID DESC LIMIT 1
          ) AS invoice_no,
          COALESCE(
            (
              SELECT pp.receivedByUserID FROM tblPosPayment pp
              WHERE pp.orderID = o.orderID AND pp.receivedByUserID IS NOT NULL
              ORDER BY pp.posPaymentID ASC LIMIT 1
            ),
            (
              SELECT h.createdByUserID FROM tblOrderStatusHistory h
              WHERE h.orderID = o.orderID AND h.createdByUserID IS NOT NULL
              ORDER BY h.orderStatusHistoryID ASC LIMIT 1
            )
          ) AS cashier_id,
          COALESCE(
            (
              SELECT cu.name FROM tblPosPayment pp
              JOIN tblUser cu ON cu.userID = pp.receivedByUserID
              WHERE pp.orderID = o.orderID AND pp.receivedByUserID IS NOT NULL
              ORDER BY pp.posPaymentID ASC LIMIT 1
            ),
            (
              SELECT hu.name FROM tblOrderStatusHistory h
              JOIN tblUser hu ON hu.userID = h.createdByUserID
              WHERE h.orderID = o.orderID AND h.createdByUserID IS NOT NULL
              ORDER BY h.orderStatusHistoryID ASC LIMIT 1
            )
          ) AS cashier_name,
          (
            SELECT COUNT(*) FROM tblOrderItem oi WHERE oi.orderID = o.orderID
          ) AS item_count,
          (
            SELECT COALESCE(SUM(oi.quantity), 0) FROM tblOrderItem oi WHERE oi.orderID = o.orderID
          ) AS item_qty,
          o.created_at
        FROM tblOrder o
        LEFT JOIN tblBranch b ON b.branchID = o.branchID AND b.companyID = o.companyID
        WHERE ${where}
        ORDER BY o.created_at DESC
        LIMIT 1000
      `,
        params
      ).catch(async (err) => {
        console.warn('sales report enriched query failed, falling back:', err.message);
        const [fallback] = await db.query(
          `
          SELECT
            o.orderID AS id, o.order_number, o.order_source, o.status, o.fulfillment_status,
            o.payment_method, o.payment_status, o.subtotal, o.discount, o.coupon_discount,
            (COALESCE(o.discount, 0) + COALESCE(o.coupon_discount, 0)) AS total_discount,
            o.tax_amount, o.shipping_fee, o.round_off, o.total, o.amount_received, o.change_amount,
            o.refund_amount, o.refund_status, o.refund_completed,
            o.shipping_name, o.shipping_phone, o.shipping_city, o.shipping_state,
            o.companyID, o.branchID, b.name AS branch_name, b.code AS branch_code,
            NULL AS invoice_no, NULL AS cashier_id, NULL AS cashier_name,
            (SELECT COUNT(*) FROM tblOrderItem oi WHERE oi.orderID = o.orderID) AS item_count,
            (SELECT COALESCE(SUM(oi.quantity), 0) FROM tblOrderItem oi WHERE oi.orderID = o.orderID) AS item_qty,
            o.created_at
          FROM tblOrder o
          LEFT JOIN tblBranch b ON b.branchID = o.branchID AND b.companyID = o.companyID
          WHERE ${where}
          ORDER BY o.created_at DESC
          LIMIT 1000
        `,
          params
        );
        return [fallback];
      });
      rows = list;
      columns = [
        { key: 'invoice_no', label: 'Invoice Number' },
        { key: 'order_number', label: 'Order ID' },
        { key: 'created_at', label: 'Date & Time' },
        { key: 'shipping_name', label: 'Customer Name' },
        { key: 'shipping_phone', label: 'Customer Phone' },
        { key: 'cashier_name', label: 'Cashier / Staff' },
        { key: 'branch_name', label: 'Branch' },
        { key: 'item_qty', label: 'Total Items' },
        { key: 'subtotal', label: 'Subtotal' },
        { key: 'total_discount', label: 'Discount' },
        { key: 'tax_amount', label: 'GST / Tax' },
        { key: 'total', label: 'Grand Total' },
        { key: 'payment_method', label: 'Payment Method' },
        { key: 'payment_status', label: 'Payment Status' },
        { key: 'status', label: 'Order Status' },
        { key: 'fulfillment_status', label: 'Fulfillment' },
        { key: 'order_source', label: 'Source' },
        { key: 'refund_amount', label: 'Refund' },
      ];

      const RETURN_STATUSES = new Set([
        'returned',
        'refunded',
        'refund_pending',
        'return_requested',
      ]);
      const isRefundedRow = (r: any) =>
        RETURN_STATUSES.has(String(r.status || '').toLowerCase()) ||
        Number(r.refund_completed) === 1 ||
        String(r.refund_status || '').toLowerCase() === 'completed' ||
        Number(r.refund_amount || 0) > 0;

      // Gross / discount from all non-cancelled filtered rows (no double-count of refunds here)
      const grossSales = rows.reduce((s, r) => s + Number(r.subtotal || 0), 0);
      const totalDiscounts = rows.reduce(
        (s, r) => s + Number(r.discount || 0) + Number(r.coupon_discount || 0),
        0
      );
      // Refund amount only from refunded/returned rows — use stored refund_amount, else grand total once
      const refundAmount = rows.reduce((s, r) => {
        if (!isRefundedRow(r)) return s;
        const stored = Number(r.refund_amount || 0);
        return s + (stored > 0 ? stored : Number(r.total || 0));
      }, 0);
      // Net revenue excludes returned/refunded sales; refunds tracked separately
      const netRows = rows.filter((r) => !RETURN_STATUSES.has(String(r.status || '').toLowerCase()));
      const netRevenue = netRows.reduce((s, r) => s + Number(r.total || 0), 0);
      const avgOrderValue = netRows.length ? netRevenue / netRows.length : 0;

      summary = {
        orders: rows.length,
        gross_sales: grossSales,
        net_revenue: netRevenue,
        avg_order_value: avgOrderValue,
        total_discounts: totalDiscounts,
        refund_amount: refundAmount,
        // legacy aliases for older UI keys
        revenue: netRevenue,
        avg_ticket: avgOrderValue,
        paid: rows.filter((r) => String(r.payment_status).toLowerCase() === 'paid').length,
      };

      // Trend: daily if range ≤ 45 days or day report; else monthly
      const spanDays = (() => {
        if (type === 'day') return 1;
        if (dateFrom && dateTo) {
          const a = new Date(dateFrom);
          const b = new Date(dateTo);
          return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
        }
        return rows.length ? 30 : 30;
      })();
      const useDaily = type === 'day' || spanDays <= 45;
      const trendMap: Record<string, number> = {};
      netRows.forEach((r) => {
        const dt = new Date(r.created_at);
        if (Number.isNaN(dt.getTime())) return;
        const key = useDaily
          ? dt.toISOString().slice(0, 10)
          : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        trendMap[key] = (trendMap[key] || 0) + Number(r.total || 0);
      });
      const salesTrend = Object.entries(trendMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => ({ name, value }));

      const payMap: Record<string, number> = {};
      netRows.forEach((r) => {
        const k = String(r.payment_method || 'unknown').toUpperCase();
        payMap[k] = (payMap[k] || 0) + Number(r.total || 0);
      });
      const paymentBreakdown = Object.entries(payMap)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value }));

      // Top products under same filter scope
      let topProducts: any[] = [];
      try {
        const [prodRows] = await db.query(
          `
          SELECT oi.product_name AS name,
                 SUM(oi.quantity) AS qty,
                 SUM(oi.quantity * oi.price) AS amount
          FROM tblOrderItem oi
          JOIN tblOrder o ON o.orderID = oi.orderID
          LEFT JOIN tblBranch b ON b.branchID = o.branchID AND b.companyID = o.companyID
          WHERE ${where}
            AND o.status NOT IN ('returned','refunded','refund_pending','return_requested')
          GROUP BY oi.product_name
          ORDER BY qty DESC
          LIMIT 10
        `,
          params
        );
        topProducts = (prodRows || []).map((r: any) => ({
          name: r.name,
          value: Number(r.qty || 0),
          amount: Number(r.amount || 0),
        }));
      } catch (err: any) {
        console.warn('sales top products:', err.message);
      }

      chart = salesTrend;
      (summary as any)._charts = {
        sales_trend: salesTrend,
        sales_trend_grain: useDaily ? 'daily' : 'monthly',
        payment_methods: paymentBreakdown,
        top_products: topProducts,
      };

      // Filter option lists (scoped to company / branch)
      try {
        const foParams: any = { companyID };
        let branchScope = '';
        if (userBranch) {
          branchScope = ' AND branchID = :foBranch';
          foParams.foBranch = userBranch;
        }
        const [branchOpts] = await db.query(
          `SELECT branchID AS id, name, code FROM tblBranch
           WHERE companyID = :companyID AND is_active = 1
           ORDER BY name ASC LIMIT 200`,
          { companyID }
        ).catch(() => [[]]);
        const [cashierOpts] = await db.query(
          `
          SELECT u.userID AS id, u.name FROM (
            SELECT DISTINCT pp.receivedByUserID AS uid
            FROM tblPosPayment pp
            JOIN tblOrder o ON o.orderID = pp.orderID
            WHERE o.companyID = :companyID AND pp.receivedByUserID IS NOT NULL ${branchScope.replace('branchID', 'o.branchID')}
            UNION
            SELECT DISTINCT h.createdByUserID AS uid
            FROM tblOrderStatusHistory h
            JOIN tblOrder o ON o.orderID = h.orderID
            WHERE o.companyID = :companyID AND h.createdByUserID IS NOT NULL ${branchScope.replace('branchID', 'o.branchID')}
          ) x
          JOIN tblUser u ON u.userID = x.uid
          ORDER BY u.name ASC
          LIMIT 200
        `,
          foParams
        ).catch(() => [[]]);
        (summary as any)._filter_options = {
          branches: branchOpts || [],
          cashiers: cashierOpts || [],
          payment_methods: ['cash', 'upi', 'card', 'credit', 'online', 'cod', 'split'],
          payment_statuses: ['pending', 'paid', 'failed', 'refund_pending', 'refunded'],
          order_sources: ['pos', 'online', 'admin'],
        };
      } catch {
        (summary as any)._filter_options = {
          branches: [],
          cashiers: [],
          payment_methods: ['cash', 'upi', 'card', 'credit', 'online', 'cod', 'split'],
          payment_statuses: ['pending', 'paid', 'failed', 'refund_pending', 'refunded'],
          order_sources: ['pos', 'online', 'admin'],
        };
      }
    } else if (type === 'product') {
      const d = dateClause('o');
      const params: any = { ...d.params, companyID };
      let joinDate = '';
      if (dateFrom || dateTo) {
        joinDate = ` AND ${[
          dateFrom ? 'DATE(o.created_at) >= :dateFrom' : null,
          dateTo ? 'DATE(o.created_at) <= :dateTo' : null,
        ]
          .filter(Boolean)
          .join(' AND ')}`;
      }
      if (q) params.q = `%${q}%`;
      const userBranch = getBranchId(req.user);
      let branchJoin = '';
      if (userBranch) {
        await ensureOrderBranchColumn();
        branchJoin = ' AND o.branchID = :branchID';
        params.branchID = userBranch;
      }
      const [list] = await db.query(
        `
        SELECT oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.quantity * oi.price) AS amount
        FROM tblOrderItem oi
        JOIN tblOrder o ON o.orderID = oi.orderID
          AND o.status <> 'cancelled'
          AND o.companyID = :companyID
          ${branchJoin}
          ${joinDate}
        WHERE 1=1 ${q ? 'AND oi.product_name LIKE :q' : ''}
        GROUP BY oi.product_name
        ORDER BY qty DESC
        LIMIT 200
      `,
        params
      );
      rows = list;
      columns = [
        { key: 'product_name', label: 'Product' },
        { key: 'qty', label: 'Qty sold' },
        { key: 'amount', label: 'Amount' },
      ];
      const qty = rows.reduce((s, r) => s + Number(r.qty || 0), 0);
      const amount = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
      summary = { tblProduct: rows.length, qty, amount, top_qty: Number(rows[0]?.qty || 0) };
      chart = rows.slice(0, 8).map((r) => ({ name: r.product_name, value: Number(r.qty || 0) }));
    } else if (type === 'stock') {
      const params: any = { companyID };
      let where = 'p.companyID = :companyID';
      if (q) {
        where += ` AND (p.name LIKE :q OR pv.stock_code LIKE :q OR pv.barcode LIKE :q)`;
        params.q = `%${q}%`;
      }
      if (status) {
        where += ` AND i.status = :status`;
        params.status = status;
      }
      if (warehouse) {
        where += ` AND w.name LIKE :warehouse`;
        params.warehouse = `%${warehouse}%`;
      }
      const userBranch = getBranchId(req.user);
      if (userBranch) {
        where += ` AND w.branchID = :branchID`;
        params.branchID = userBranch;
      }
      const [list] = await db.query(
        `
        SELECT p.name AS product_name, pv.size, pv.color, pv.stock_code, pv.barcode,
               i.available_qty, i.reserved_qty, i.min_stock, i.status, w.name AS warehouse_name
        FROM tblInventory i
        JOIN tblProduct p ON p.productID = i.productID
        JOIN tblProductVariant pv ON pv.productVariantID = i.productVariantID
        LEFT JOIN tblWarehouse w ON w.warehouseID = i.warehouseID
        WHERE ${where}
        ORDER BY i.available_qty ASC, p.name ASC
        LIMIT 500
      `,
        params
      ).catch(() => [[]]);
      rows = list;
      columns = [
        { key: 'product_name', label: 'Product' },
        { key: 'color', label: 'Colour' },
        { key: 'size', label: 'Size' },
        { key: 'stock_code', label: 'SKU' },
        { key: 'available_qty', label: 'Available' },
        { key: 'reserved_qty', label: 'Reserved' },
        { key: 'warehouse_name', label: 'Warehouse' },
        { key: 'status', label: 'Status' },
      ];
      const available = rows.reduce((s, r) => s + Number(r.available_qty || 0), 0);
      const low = rows.filter((r) => Number(r.available_qty) <= Number(r.min_stock || 10)).length;
      const out = rows.filter((r) => Number(r.available_qty) <= 0).length;
      summary = { skus: rows.length, available, low_stock: low, out_of_stock: out };
      const byStatus = {};
      rows.forEach((r) => {
        const k = r.status || 'unknown';
        byStatus[k] = (byStatus[k] || 0) + 1;
      });
      chart = Object.entries(byStatus).map(([name, value]) => ({ name, value }));
    } else if (type === 'warehouse') {
      const params: any = { companyID };
      let where = 'w.companyID = :companyID AND w.is_active = 1';
      if (q) {
        where += ` AND (w.name LIKE :q OR w.code LIKE :q)`;
        params.q = `%${q}%`;
      }
      const userBranch = getBranchId(req.user);
      if (userBranch) {
        where += ` AND w.branchID = :branchID`;
        params.branchID = userBranch;
      }
      const [list] = await db.query(
        `
        SELECT w.warehouseID, w.name, w.code,
          COUNT(i.inventoryID) AS sku_count,
          COALESCE(SUM(i.available_qty), 0) AS available_qty,
          COALESCE(SUM(i.reserved_qty), 0) AS reserved_qty
        FROM tblWarehouse w
        LEFT JOIN tblInventory i ON i.warehouseID = w.warehouseID
        WHERE ${where}
        GROUP BY w.warehouseID
        ORDER BY w.is_default DESC, w.name ASC
      `,
        params
      ).catch(() => [[]]);
      rows = list;
      columns = [
        { key: 'name', label: 'Warehouse' },
        { key: 'code', label: 'Code' },
        { key: 'sku_count', label: 'SKUs' },
        { key: 'available_qty', label: 'Available' },
        { key: 'reserved_qty', label: 'Reserved' },
      ];
      summary = {
        tblWarehouse: rows.length,
        skus: rows.reduce((s, r) => s + Number(r.sku_count || 0), 0),
        available: rows.reduce((s, r) => s + Number(r.available_qty || 0), 0),
        reserved: rows.reduce((s, r) => s + Number(r.reserved_qty || 0), 0),
      };
      chart = rows.map((r) => ({ name: r.name, value: Number(r.available_qty || 0) }));
    } else if (type === 'branch') {
      const params: any = { companyID };
      let where = 'companyID = :companyID';
      if (q) {
        where += ` AND (name LIKE :q OR code LIKE :q OR city LIKE :q)`;
        params.q = `%${q}%`;
      }
      if (city) {
        where += ` AND city LIKE :city`;
        params.city = `%${city}%`;
      }
      if (active === '1' || active === '0') {
        where += ` AND is_active = :active`;
        params.active = Number(active);
      }
      const userBranch = getBranchId(req.user);
      if (userBranch) {
        where += ` AND branchID = :branchID`;
        params.branchID = userBranch;
      }
      const [list] = await db.query(
        `
        SELECT branchID AS id, name, code, city, phone, is_active, created_at
        FROM tblBranch
        WHERE ${where}
        ORDER BY name ASC
      `,
        params
      ).catch(() => [[]]);
      rows = list;
      columns = [
        { key: 'name', label: 'Branch' },
        { key: 'code', label: 'Code' },
        { key: 'city', label: 'City' },
        { key: 'phone', label: 'Phone' },
        { key: 'is_active', label: 'Active' },
        { key: 'created_at', label: 'Created' },
      ];
      summary = {
        tblBranch: rows.length,
        active: rows.filter((r) => Number(r.is_active)).length,
        inactive: rows.filter((r) => !Number(r.is_active)).length,
        cities: new Set(rows.map((r) => r.city).filter(Boolean)).size,
      };
      const byCity = {};
      rows.forEach((r) => {
        const k = r.city || 'N/A';
        byCity[k] = (byCity[k] || 0) + 1;
      });
      chart = Object.entries(byCity).map(([name, value]) => ({ name, value }));
    } else if (type === 'billing' || type === 'invoice' || type === 'bill') {
      const d = dateClause();
      const params: any = { ...d.params, companyID };
      let where = 'companyID = :companyID' + d.sql;
      if (status) {
        where += ` AND status = :status`;
        params.status = status;
      }
      if (q) {
        where += ` AND (invoice_no LIKE :q OR customer_name LIKE :q)`;
        params.q = `%${q}%`;
      }
      const [list] = await db.query(
        `
        SELECT invoice_no, customer_name, amount, tax, total, status, created_at, orderID
        FROM tblBilling
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT 500
      `,
        params
      ).catch(() => [[]]);
      rows = list;
      columns = [
        { key: 'invoice_no', label: 'Invoice' },
        { key: 'customer_name', label: 'Customer' },
        { key: 'amount', label: 'Amount' },
        { key: 'tax', label: 'Tax' },
        { key: 'total', label: 'Total' },
        { key: 'status', label: 'Status' },
        { key: 'created_at', label: 'Date' },
      ];
      const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      const tax = rows.reduce((s, r) => s + Number(r.tax || 0), 0);
      summary = {
        invoices: rows.length,
        total,
        tax,
        paid: rows.filter((r) => r.status === 'paid').length,
      };
      const byStatus = {};
      rows.forEach((r) => {
        const k = r.status || 'unknown';
        byStatus[k] = (byStatus[k] || 0) + Number(r.total || 0);
      });
      chart = Object.entries(byStatus).map(([name, value]) => ({ name, value }));
    } else if (type === 'refund') {
      await ensureOrderBranchColumn();
      const d = dateClause('o');
      const params: any = { ...d.params, companyID };
      let where = `o.companyID = :companyID AND (
        o.status IN ('returned','refunded','refund_pending','return_requested')
        OR o.refund_completed = 1
        OR o.refund_status = 'completed'
        OR COALESCE(o.refund_amount, 0) > 0
      )${d.sql}`;
      if (q) {
        where += ` AND (
          o.order_number LIKE :q OR o.shipping_name LIKE :q OR o.shipping_phone LIKE :q
          OR EXISTS (SELECT 1 FROM tblBilling inv WHERE inv.orderID = o.orderID AND inv.invoice_no LIKE :q)
        )`;
        params.q = `%${q}%`;
      }
      const userBranch = getBranchId(req.user);
      if (userBranch) {
        where += ` AND o.branchID = :branchID`;
        params.branchID = userBranch;
      }
      const [list] = await db.query(
        `
        SELECT
          o.orderID AS id, o.order_number, o.status, o.payment_status, o.fulfillment_status,
          o.total, o.refund_amount, o.refund_status, o.refund_method, o.shipping_name, o.shipping_phone,
          o.created_at, b.name AS branch_name,
          (SELECT inv.invoice_no FROM tblBilling inv WHERE inv.orderID = o.orderID ORDER BY inv.billingID DESC LIMIT 1) AS invoice_no
        FROM tblOrder o
        LEFT JOIN tblBranch b ON b.branchID = o.branchID AND b.companyID = o.companyID
        WHERE ${where}
        ORDER BY o.created_at DESC
        LIMIT 1000
      `,
        params
      ).catch(() => [[]]);
      rows = list;
      columns = [
        { key: 'invoice_no', label: 'Invoice' },
        { key: 'order_number', label: 'Order ID' },
        { key: 'shipping_name', label: 'Customer' },
        { key: 'branch_name', label: 'Branch' },
        { key: 'status', label: 'Order Status' },
        { key: 'payment_status', label: 'Payment Status' },
        { key: 'total', label: 'Order Total' },
        { key: 'refund_amount', label: 'Refund Amount' },
        { key: 'refund_status', label: 'Refund Status' },
        { key: 'created_at', label: 'Date' },
      ];
      const refundTotal = rows.reduce((s, r) => s + Number(r.refund_amount || r.total || 0), 0);
      summary = {
        orders: rows.length,
        refund_amount: refundTotal,
        net_revenue: 0,
        gross_sales: rows.reduce((s, r) => s + Number(r.total || 0), 0),
      };
      chart = rows.slice(0, 12).map((r) => ({
        name: r.order_number || String(r.id),
        value: Number(r.refund_amount || r.total || 0),
      }));
    } else if (type === 'month') {
      await ensureOrderBranchColumn();
      const d = dateClause('o');
      const params: any = { ...d.params, companyID };
      let where = `o.status <> 'cancelled' AND o.companyID = :companyID${d.sql}`;
      const userBranch = getBranchId(req.user);
      if (userBranch) {
        where += ` AND o.branchID = :branchID`;
        params.branchID = userBranch;
      }
      const [list] = await db.query(
        `
        SELECT
          DATE_FORMAT(o.created_at, '%Y-%m') AS period,
          COUNT(*) AS orders,
          SUM(o.subtotal) AS gross_sales,
          SUM(CASE
            WHEN o.status IN ('returned','refunded','refund_pending','return_requested') THEN 0
            ELSE o.total
          END) AS net_revenue,
          SUM(COALESCE(o.discount,0) + COALESCE(o.coupon_discount,0)) AS total_discounts,
          SUM(CASE
            WHEN o.status IN ('returned','refunded','refund_pending','return_requested')
              OR o.refund_completed = 1 OR COALESCE(o.refund_amount,0) > 0
            THEN COALESCE(NULLIF(o.refund_amount, 0), o.total)
            ELSE 0
          END) AS refund_amount
        FROM tblOrder o
        WHERE ${where}
        GROUP BY DATE_FORMAT(o.created_at, '%Y-%m')
        ORDER BY period DESC
        LIMIT 36
      `,
        params
      ).catch(() => [[]]);
      rows = list;
      columns = [
        { key: 'period', label: 'Month' },
        { key: 'orders', label: 'Orders' },
        { key: 'gross_sales', label: 'Gross Sales' },
        { key: 'net_revenue', label: 'Net Revenue' },
        { key: 'total_discounts', label: 'Discounts' },
        { key: 'refund_amount', label: 'Refunds' },
      ];
      summary = {
        orders: rows.reduce((s, r) => s + Number(r.orders || 0), 0),
        gross_sales: rows.reduce((s, r) => s + Number(r.gross_sales || 0), 0),
        net_revenue: rows.reduce((s, r) => s + Number(r.net_revenue || 0), 0),
        refund_amount: rows.reduce((s, r) => s + Number(r.refund_amount || 0), 0),
      };
      chart = [...rows].reverse().map((r) => ({ name: r.period, value: Number(r.net_revenue || 0) }));
      (summary as any)._charts = {
        sales_trend: chart,
        sales_trend_grain: 'monthly',
        payment_methods: [],
        top_products: [],
      };
    } else if (type === 'upi') {
      await ensureOrderBranchColumn();
      const d = dateClause('o');
      const params: any = { ...d.params, companyID };
      let where = `o.companyID = :companyID AND (
        LOWER(pp.method) = 'upi' OR LOWER(o.payment_method) = 'upi'
      )${d.sql}`;
      if (q) {
        where += ` AND (o.order_number LIKE :q OR pp.reference_no LIKE :q OR o.shipping_name LIKE :q)`;
        params.q = `%${q}%`;
      }
      const userBranch = getBranchId(req.user);
      if (userBranch) {
        where += ` AND o.branchID = :branchID`;
        params.branchID = userBranch;
      }
      const [list] = await db.query(
        `
        SELECT
          pp.posPaymentID AS id,
          o.order_number,
          o.shipping_name,
          o.shipping_phone,
          pp.amount,
          pp.reference_no,
          pp.status,
          pp.paid_at,
          pp.created_at,
          b.name AS branch_name,
          u.name AS cashier_name,
          (SELECT inv.invoice_no FROM tblBilling inv WHERE inv.orderID = o.orderID ORDER BY inv.billingID DESC LIMIT 1) AS invoice_no
        FROM tblPosPayment pp
        JOIN tblOrder o ON o.orderID = pp.orderID
        LEFT JOIN tblBranch b ON b.branchID = o.branchID AND b.companyID = o.companyID
        LEFT JOIN tblUser u ON u.userID = pp.receivedByUserID
        WHERE ${where}
        ORDER BY COALESCE(pp.paid_at, pp.created_at) DESC
        LIMIT 1000
      `,
        params
      ).catch(async () => {
        const [fallback] = await db.query(
          `
          SELECT
            o.orderID AS id, o.order_number, o.shipping_name, o.shipping_phone,
            o.total AS amount, NULL AS reference_no, o.payment_status AS status,
            o.created_at AS paid_at, o.created_at, b.name AS branch_name,
            NULL AS cashier_name, NULL AS invoice_no
          FROM tblOrder o
          LEFT JOIN tblBranch b ON b.branchID = o.branchID AND b.companyID = o.companyID
          WHERE o.companyID = :companyID AND LOWER(o.payment_method) = 'upi' AND o.status <> 'cancelled'
          ORDER BY o.created_at DESC LIMIT 1000
        `,
          { companyID }
        ).catch(() => [[]]);
        return [fallback];
      });
      rows = list;
      columns = [
        { key: 'invoice_no', label: 'Invoice' },
        { key: 'order_number', label: 'Order ID' },
        { key: 'shipping_name', label: 'Customer' },
        { key: 'amount', label: 'Amount' },
        { key: 'reference_no', label: 'UPI Ref' },
        { key: 'status', label: 'Status' },
        { key: 'cashier_name', label: 'Cashier' },
        { key: 'branch_name', label: 'Branch' },
        { key: 'paid_at', label: 'Paid At' },
      ];
      const amount = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
      summary = { orders: rows.length, net_revenue: amount, gross_sales: amount, paid: rows.filter((r) => String(r.status).toLowerCase() === 'paid').length };
      chart = Object.entries(
        rows.reduce((acc: Record<string, number>, r) => {
          const k = String(r.status || 'unknown');
          acc[k] = (acc[k] || 0) + Number(r.amount || 0);
          return acc;
        }, {})
      ).map(([name, value]) => ({ name, value }));
    } else if (type === 'barcode') {
      const params: any = { companyID };
      let where = 'p.companyID = :companyID';
      if (q) {
        where += ` AND (p.name LIKE :q OR pv.stock_code LIKE :q OR pv.barcode LIKE :q OR pv.sku LIKE :q)`;
        params.q = `%${q}%`;
      }
      const [list] = await db.query(
        `
        SELECT
          p.name AS product_name,
          COALESCE(pv.stock_code, pv.sku, p.sku) AS sku,
          pv.barcode,
          pv.size,
          pv.color,
          COALESCE(i.available_qty, pv.stock, 0) AS available_qty,
          w.name AS warehouse
        FROM tblProductVariant pv
        JOIN tblProduct p ON p.productID = pv.productID
        LEFT JOIN tblInventory i ON i.productVariantID = pv.productVariantID
        LEFT JOIN tblWarehouse w ON w.warehouseID = i.warehouseID
        WHERE ${where}
          AND pv.barcode IS NOT NULL AND TRIM(pv.barcode) <> ''
        ORDER BY p.name ASC, pv.barcode ASC
        LIMIT 1000
      `,
        params
      ).catch(async () => {
        const [fallback] = await db.query(
          `
          SELECT p.name AS product_name, p.sku, p.barcode, NULL AS size, NULL AS color,
                 p.stock AS available_qty, p.warehouse AS warehouse
          FROM tblProduct p
          WHERE p.companyID = :companyID AND p.barcode IS NOT NULL AND TRIM(p.barcode) <> ''
          ORDER BY p.name ASC LIMIT 1000
        `,
          { companyID }
        ).catch(() => [[]]);
        return [fallback];
      });
      rows = list;
      columns = [
        { key: 'product_name', label: 'Product' },
        { key: 'sku', label: 'SKU' },
        { key: 'barcode', label: 'Barcode' },
        { key: 'size', label: 'Size' },
        { key: 'color', label: 'Colour' },
        { key: 'available_qty', label: 'Qty' },
        { key: 'warehouse', label: 'Warehouse' },
      ];
      summary = {
        products: new Set(rows.map((r) => r.product_name).filter(Boolean)).size,
        skus: rows.length,
        available: rows.reduce((s, r) => s + Number(r.available_qty || 0), 0),
      };
      chart = rows.slice(0, 10).map((r) => ({ name: r.barcode || r.sku, value: Number(r.available_qty || 0) }));
    } else if (type === 'auditing' || type === 'auditlog') {
      await ensureOrderBranchColumn();
      const d = dateClause('h');
      const params: any = { ...d.params, companyID };
      let where = 'o.companyID = :companyID' + d.sql.replace(/created_at/g, 'h.created_at');
      if (status) {
        where += ` AND h.to_status = :status`;
        params.status = status;
      }
      if (q) {
        where += ` AND (o.order_number LIKE :q OR h.note LIKE :q OR u.name LIKE :q)`;
        params.q = `%${q}%`;
      }
      const userBranch = getBranchId(req.user);
      if (userBranch) {
        where += ` AND o.branchID = :branchID`;
        params.branchID = userBranch;
      }
      const [list] = await db.query(
        `
        SELECT h.orderStatusHistoryID AS id, h.orderID, o.order_number, h.from_status, h.to_status,
               h.payment_status, h.fulfillment_status, h.note, h.created_at,
               u.name AS created_by_name
        FROM tblOrderStatusHistory h
        LEFT JOIN tblOrder o ON o.orderID = h.orderID
        LEFT JOIN tblUser u ON u.userID = h.createdByUserID
        WHERE ${where}
        ORDER BY h.created_at DESC
        LIMIT 500
      `,
        params
      ).catch(async () => {
        const [fallback] = await db.query(
          `
          SELECT h.id, h.orderID, o.order_number, h.from_status, h.to_status,
                 h.payment_status, h.fulfillment_status, h.note, h.created_at,
                 u.name AS created_by_name
          FROM tblOrderStatusHistory h
          LEFT JOIN tblOrder o ON o.orderID = h.orderID
          LEFT JOIN tblUser u ON u.userID = h.createdByUserID
          WHERE o.companyID = :companyID
          ORDER BY h.created_at DESC
          LIMIT 500
        `,
          { companyID }
        ).catch(() => [[]]);
        return [fallback];
      });
      rows = list;
      columns = [
        { key: 'order_number', label: 'Order' },
        { key: 'from_status', label: 'From' },
        { key: 'to_status', label: 'To' },
        { key: 'payment_status', label: 'Payment' },
        { key: 'note', label: 'Note' },
        { key: 'created_by_name', label: 'By' },
        { key: 'created_at', label: 'When' },
      ];
      const byTo = {};
      rows.forEach((r) => {
        const k = r.to_status || 'unknown';
        byTo[k] = (byTo[k] || 0) + 1;
      });
      summary = {
        events: rows.length,
        tblOrder: new Set(rows.map((r) => r.orderID).filter(Boolean)).size,
        transitions: Object.keys(byTo).length,
        latest: rows[0]?.created_at || null,
      };
      chart = Object.entries(byTo).map(([name, value]) => ({ name, value }));
    } else {
      return fail(res, 'Unknown report type', 400);
    }

    const charts = (summary as any)?._charts || null;
    const filter_options = (summary as any)?._filter_options || null;
    if (summary && typeof summary === 'object') {
      delete (summary as any)._charts;
      delete (summary as any)._filter_options;
    }

    return ok(res, {
      type,
      filters: {
        date_from: dateFrom,
        date_to: dateTo,
        q,
        status,
        source,
        payment_status: paymentStatus,
        payment_method: String(req.query.payment_method || '').trim(),
        cashier: String(req.query.cashier_id || req.query.cashier || '').trim(),
        customer: String(req.query.customer || '').trim(),
        warehouse,
        active,
        city,
        branch: String(req.query.branch || req.query.branch_id || '').trim(),
      },
      columns,
      rows,
      summary,
      chart,
      charts,
      filter_options,
    });
  } catch (err) {
    if (err instanceof CompanyScopeError) return fail(res, err.message, err.status);
    console.error(err);
    return fail(res, 'Failed to load reports', 500);
  }
};
