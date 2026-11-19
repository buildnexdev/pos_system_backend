/**
 * Author: Nandhakumar
 * Version: 0.0.2
 * Desc: Login with 24h token, single active session, 10-day password change policy
 * Edit Date: 2026-11-14
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/db';
import { ok, fail } from '../utils/helpers';
import { getUserRights } from '../middleware/auth';
import { USER_ROLE_JOIN, accessRoleFromRow } from '../config/userRole';
import { getRoleId } from '../utils/roleLookup';
import { sendMail } from '../utils/mail';

/** Platform inbox for company registration requests */
const PLATFORM_INBOX = process.env.MAIL_USER || 'buildnexdev@gmail.com';
const OTP_TTL_MINUTES = 10;

/** Login token lifetime — 24 hours only */
export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '24h') as jwt.SignOptions['expiresIn'];
/** Force password change after this many days */
export const PASSWORD_MAX_AGE_DAYS = Number(process.env.PASSWORD_MAX_AGE_DAYS || 10);

function userPk(user: { id?: number; userID?: number }) {
  return Number(user.userID ?? user.id);
}

function flagOn(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

function normalizeCompanyId(user: { companyID?: number | null; isSuperAdmin?: unknown }) {
  if (flagOn(user.isSuperAdmin)) return 0;
  const n = Number(user.companyID);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function newSessionId() {
  return crypto.randomBytes(24).toString('hex');
}

function mustChangePassword(passwordChangedAt: unknown): boolean {
  if (!passwordChangedAt) return true;
  const changed = new Date(passwordChangedAt as string | Date);
  if (Number.isNaN(changed.getTime())) return true;
  const ageMs = Date.now() - changed.getTime();
  return ageMs >= PASSWORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function passwordAgeDays(passwordChangedAt: unknown): number | null {
  if (!passwordChangedAt) return null;
  const changed = new Date(passwordChangedAt as string | Date);
  if (Number.isNaN(changed.getTime())) return null;
  return Math.floor((Date.now() - changed.getTime()) / (24 * 60 * 60 * 1000));
}

function signToken(user: {
  id?: number;
  userID?: number;
  name: string;
  email: string;
  role: string;
  companyID?: number | null;
  isAdmin?: unknown;
  isSuperAdmin?: unknown;
  branchID?: number | null;
  session_token?: string | null;
}) {
  const secret = process.env.JWT_SECRET || 'garments_shop_jwt_secret_change_me';
  const companyID = normalizeCompanyId(user);
  const isAdmin = flagOn(user.isAdmin) ? 1 : 0;
  const isSuperAdmin = flagOn(user.isSuperAdmin) ? 1 : 0;
  const branchID = Number(user.branchID) > 0 ? Number(user.branchID) : 0;
  return jwt.sign(
    {
      id: userPk(user),
      name: user.name,
      email: user.email,
      role: user.role,
      companyID,
      tenant_id: companyID || undefined,
      isAdmin,
      isSuperAdmin,
      branchID,
      sid: user.session_token || undefined,
    },
    secret,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function defaultCompanyId(): Promise<number> {
  const [rows] = await db.query('SELECT companyID FROM tblCompany ORDER BY companyID ASC LIMIT 1');
  if (!rows.length) throw new Error('No company configured');
  return Number(rows[0].companyID);
}

async function loadUserWithRole(whereSql: string, params: Record<string, unknown>) {
  const [rows] = await db.query(
    `SELECT u.*, r.RoleCode, r.RoleName, r.Level
     FROM tblUser u
     ${USER_ROLE_JOIN}
     WHERE ${whereSql}
     LIMIT 1`,
    params
  );
  if (!rows.length) return null;
  const row = rows[0];
  const isSuper = flagOn(row.isSuperAdmin);
  const isAdmin = flagOn(row.isAdmin) || isSuper;
  let role = accessRoleFromRow(row);
  if (isSuper || isAdmin) role = 'admin';
  return {
    ...row,
    role,
    isAdmin: isAdmin ? 1 : 0,
    isSuperAdmin: isSuper ? 1 : 0,
    branchID: Number(row.branchID) > 0 ? Number(row.branchID) : 0,
    companyID: isSuper ? 0 : row.companyID != null ? Number(row.companyID) : 0,
  };
}

async function loadCompanyProfile(companyID: number) {
  if (!(companyID > 0)) return null;
  const [rows] = await db.query(
    `SELECT companyID, name, logo_url, website
     FROM tblCompany WHERE companyID = :id LIMIT 1`,
    { id: companyID }
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    companyID: Number(row.companyID),
    name: row.name || null,
    logo_url: row.logo_url || null,
    website: row.website || null,
  };
}

async function publicUser(user) {
  const companyID = normalizeCompanyId(user);
  const company = await loadCompanyProfile(companyID);
  const forcePwd = mustChangePassword(user.password_changed_at);
  return {
    id: userPk(user),
    name: user.name,
    email: user.email,
    phone: user.phone,
    address: user.address,
    city: user.city,
    state: user.state,
    pincode: user.pincode,
    role: user.role,
    roleID: user.roleID || null,
    companyID,
    companyName: company?.name || null,
    companyLogo: company?.logo_url || null,
    companyWebsite: company?.website || null,
    isAdmin: flagOn(user.isAdmin) ? 1 : 0,
    isSuperAdmin: flagOn(user.isSuperAdmin) ? 1 : 0,
    branchID: Number(user.branchID) > 0 ? Number(user.branchID) : 0,
    is_active: user.is_active,
    mustChangePassword: forcePwd,
    passwordAgeDays: passwordAgeDays(user.password_changed_at),
    passwordMaxAgeDays: PASSWORD_MAX_AGE_DAYS,
  };
}

/** Start a new exclusive session — invalidates any other device */
async function startExclusiveSession(userId: number) {
  const sid = newSessionId();
  await db.query(
    `UPDATE tblUser SET session_token = :sid WHERE userID = :id`,
    { sid, id: userId }
  );
  return sid;
}

export const register = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return fail(res, 'Name, email and password are required');
    }

    const [existing] = await db.query('SELECT userID FROM tblUser WHERE email = :email', { email });
    if (existing.length) return fail(res, 'Email already registered');

    const customerRoleId = await getRoleId('customer');
    const companyID = await defaultCompanyId();
    const hash = await bcrypt.hash(password, 10);
    const sid = newSessionId();
    const [result] = await db.query(
      `INSERT INTO tblUser
       (name, email, password, session_token, password_changed_at, phone, roleID, companyID, isAdmin, isSuperAdmin, branchID)
       VALUES (:name, :email, :password, :sid, NOW(), :phone, :roleID, :companyID, 0, 0, 0)`,
      { name, email, password: hash, sid, phone: phone || null, roleID: customerRoleId, companyID }
    );

    const user = {
      userID: result.insertId,
      id: result.insertId,
      name,
      email,
      phone: phone || null,
      role: 'customer' as const,
      roleID: customerRoleId,
      companyID,
      isAdmin: 0,
      isSuperAdmin: 0,
      branchID: 0,
      is_active: 1,
      session_token: sid,
      password_changed_at: new Date(),
    };
    const token = signToken(user);
    return ok(
      res,
      { user: await publicUser(user), token, expiresIn: JWT_EXPIRES_IN },
      'Account created',
      201
    );
  } catch (err) {
    console.error(err);
    return fail(res, 'Registration failed', 500);
  }
};

function normalizePhone(raw: string) {
  return String(raw || '').replace(/\D/g, '');
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

async function findUserByLogin(identifier: string) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  if (looksLikeEmail(raw)) {
    return loadUserWithRole('u.email = :email', { email: raw.toLowerCase() });
  }
  const phone = normalizePhone(raw);
  if (phone.length < 10) return null;
  // Match last 10 digits so +91 / 0 prefixes still work.
  // Prefer exact normalized match, then panel admins, then newest account
  // (avoids picking a customer when another user shares the same last-10 digits).
  const last10 = phone.slice(-10);
  const phoneNormSql = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(u.phone,''),' ',''),'-',''),'+',''),'/',''),'(','')`;
  return loadUserWithRole(
    `RIGHT(${phoneNormSql}, 10) = :last10
     ORDER BY
       CASE
         WHEN ${phoneNormSql} = :last10 OR ${phoneNormSql} = CONCAT('0', :last10) THEN 0
         ELSE 1
       END,
       CASE WHEN COALESCE(u.isAdmin, 0) = 1 OR COALESCE(u.isSuperAdmin, 0) = 1 THEN 0 ELSE 1 END,
       CASE WHEN r.RoleCode = 'customer' OR r.Level >= 90 THEN 1 ELSE 0 END,
       u.userID DESC`,
    { last10 }
  );
}

export const login = async (req, res) => {
  try {
    const identifier = String(req.body.login || req.body.email || req.body.phone || '').trim();
    const { password } = req.body;
    if (!identifier || !password) {
      return fail(res, 'Email/phone and password are required', 400);
    }

    const user = await findUserByLogin(identifier);
    if (!user) return fail(res, 'Invalid email/phone or password', 401);
    if (user.is_active === 0) return fail(res, 'Account is inactive', 403);

    const isSuper = flagOn(user.isSuperAdmin);
    const isAdmin = flagOn(user.isAdmin);
    if (!isSuper && (isAdmin || user.role === 'staff') && !(Number(user.companyID) > 0)) {
      return fail(res, 'User is not linked to a company', 403);
    }

    const stored = String(user.password || '');
    const isBcrypt = /^\$2[aby]?\$/.test(stored);
    let match = false;
    if (isBcrypt) {
      match = await bcrypt.compare(password, stored);
    } else {
      // Legacy plain-text password (e.g. manual DB edit) — accept once, then upgrade to bcrypt
      match = stored === String(password);
      if (match) {
        const hash = await bcrypt.hash(String(password), 10);
        await db.query(
          `UPDATE tblUser SET password = :password, password_changed_at = NOW() WHERE userID = :id`,
          { password: hash, id: userPk(user) }
        );
        user.password = hash;
      }
    }
    if (!match) return fail(res, 'Invalid email/phone or password', 401);

    // New login replaces any previous device session
    const sid = await startExclusiveSession(userPk(user));
    user.session_token = sid;

    const token = signToken(user);
    const rights = await getUserRights({ ...user, id: userPk(user) });
    const profile = await publicUser(user);
    return ok(
      res,
      {
        user: profile,
        token,
        expiresIn: JWT_EXPIRES_IN,
        mustChangePassword: profile.mustChangePassword,
      },
      profile.mustChangePassword
        ? `Login successful — please change your password (required every ${PASSWORD_MAX_AGE_DAYS} days)`
        : 'Login successful'
    );
  } catch (err: any) {
    console.error('Login error:', err);
    return fail(res, err?.message || 'Login failed', 500);
  }
};

export const me = async (req, res) => {
  try {
    const user = await loadUserWithRole('u.userID = :id', { id: req.user.id });
    if (!user) return fail(res, 'User not found', 404);
    const rights = await getUserRights({ ...user, id: userPk(user) });
    const profile = await publicUser(user);
    return ok(res, { user: profile, rights, mustChangePassword: profile.mustChangePassword });
  } catch (err) {
    console.error(err);
    return fail(res, 'Failed to load profile', 500);
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, phone, address, city, state, pincode } = req.body;
    await db.query(
      `UPDATE tblUser SET name = :name, phone = :phone, address = :address,
       city = :city, state = :state, pincode = :pincode WHERE userID = :id`,
      { name, phone, address, city, state, pincode, id: req.user.id }
    );
    const user = await loadUserWithRole('u.userID = :id', { id: req.user.id });
    return ok(res, { user: await publicUser(user) }, 'Profile updated');
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not update profile', 500);
  }
};

export const changePassword = async (req, res) => {
  try {
    const oldPassword = req.body.old_password || req.body.currentPassword || req.body.oldPassword;
    const newPassword = req.body.new_password || req.body.newPassword;
    const confirm =
      req.body.new_password_confirmation || req.body.confirmPassword || req.body.new_password_confirm;

    if (!oldPassword || !newPassword) {
      return fail(res, 'Current and new password are required', 400);
    }
    if (String(newPassword).length < 6) {
      return fail(res, 'New password must be at least 6 characters', 400);
    }
    if (confirm != null && String(confirm) !== String(newPassword)) {
      return fail(res, 'New password confirmation does not match', 400);
    }
    if (String(oldPassword) === String(newPassword)) {
      return fail(res, 'New password must be different from the current password', 400);
    }

    const user = await loadUserWithRole('u.userID = :id', { id: req.user.id });
    if (!user) return fail(res, 'User not found', 404);

    const match = await bcrypt.compare(String(oldPassword), user.password);
    if (!match) return fail(res, 'Current password is incorrect', 400);

    const hash = await bcrypt.hash(String(newPassword), 10);
    // Keep this device logged in; invalidate any other device by rotating sid
    const sid = newSessionId();
    await db.query(
      `UPDATE tblUser
       SET password = :password, password_changed_at = NOW(), session_token = :sid
       WHERE userID = :id`,
      { password: hash, sid, id: req.user.id }
    );

    const refreshed = await loadUserWithRole('u.userID = :id', { id: req.user.id });
    refreshed.session_token = sid;
    const token = signToken(refreshed);
    const profile = await publicUser(refreshed);
    const rights = await getUserRights({ ...refreshed, id: userPk(refreshed) });

    return ok(
      res,
      { user: profile, token, rights, expiresIn: JWT_EXPIRES_IN, mustChangePassword: false },
      'Password changed successfully'
    );
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not change password', 500);
  }
};

export const logout = async (req, res) => {
  try {
    if (req.user?.id) {
      const sid = req.user.sid;
      // Only clear if this is still the active session
      if (sid) {
        await db.query(
          `UPDATE tblUser SET session_token = NULL
           WHERE userID = :id AND session_token = :sid`,
          { id: req.user.id, sid }
        );
      }
    }
    return ok(res, null, 'Logged out');
  } catch (err) {
    console.error(err);
    return fail(res, 'Logout failed', 500);
  }
};

/** Send 6-digit OTP to the account email (lookup by email or phone) */
export const forgotPassword = async (req, res) => {
  try {
    const identifier = String(req.body.login || req.body.email || req.body.phone || '').trim();
    if (!identifier) return fail(res, 'Email or phone is required', 400);

    const user = await findUserByLogin(identifier);
    // Always return success-shaped response to avoid account enumeration
    if (!user || !user.email) {
      return ok(res, { sent: true }, 'If an account exists, an OTP was sent to the registered email');
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await bcrypt.hash(otp, 8);
    const expires = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await db.query(
      `UPDATE tblAuthOtp SET used_at = NOW()
       WHERE email = :email AND purpose = 'reset' AND used_at IS NULL`,
      { email: user.email }
    );
    await db.query(
      `INSERT INTO tblAuthOtp (identifier, email, purpose, otp_hash, expires_at)
       VALUES (:identifier, :email, 'reset', :otp_hash, :expires_at)`,
      {
        identifier: identifier.slice(0, 150),
        email: user.email,
        otp_hash: otpHash,
        expires_at: expires,
      }
    );

    await sendMail({
      to: user.email,
      subject: 'BuildNex ShopOS — Password reset OTP',
      html: `
        <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
          <h2 style="margin:0 0 8px">Password reset</h2>
          <p style="color:#64748b">Use this one-time code to reset your password. It expires in ${OTP_TTL_MINUTES} minutes.</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:0.2em;margin:20px 0">${otp}</p>
          <p style="color:#94a3b8;font-size:12px">If you did not request this, ignore this email.</p>
        </div>
      `,
      text: `Your BuildNex ShopOS password reset OTP is ${otp}. Valid for ${OTP_TTL_MINUTES} minutes.`,
    });

    const masked = String(user.email).replace(/(.{2}).+(@.+)/, '$1***$2');
    return ok(res, { sent: true, emailMasked: masked }, `OTP sent to ${masked}`);
  } catch (err: any) {
    console.error(err);
    return fail(res, err?.message || 'Could not send OTP. Check mail configuration.', 500);
  }
};

/** Verify OTP and set a new password */
export const resetPasswordWithOtp = async (req, res) => {
  try {
    const identifier = String(req.body.login || req.body.email || req.body.phone || '').trim();
    const otp = String(req.body.otp || '').trim();
    const newPassword = String(req.body.new_password || req.body.newPassword || '');
    const confirm = req.body.new_password_confirmation ?? req.body.confirmPassword;

    if (!identifier || !otp) return fail(res, 'Login and OTP are required', 400);
    if (newPassword.length < 6) return fail(res, 'New password must be at least 6 characters', 400);
    if (confirm != null && String(confirm) !== newPassword) {
      return fail(res, 'Password confirmation does not match', 400);
    }

    const user = await findUserByLogin(identifier);
    if (!user || !user.email) return fail(res, 'Invalid account or OTP', 400);

    const [rows] = await db.query(
      `SELECT * FROM tblAuthOtp
       WHERE email = :email AND purpose = 'reset' AND used_at IS NULL
       ORDER BY authOtpID DESC LIMIT 1`,
      { email: user.email }
    );
    const row = rows[0];
    if (!row) return fail(res, 'OTP expired or not found. Request a new one.', 400);
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return fail(res, 'OTP expired. Request a new one.', 400);
    }
    const match = await bcrypt.compare(otp, row.otp_hash);
    if (!match) return fail(res, 'Invalid OTP', 400);

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query(
      `UPDATE tblUser
       SET password = :password, password_changed_at = NOW(), session_token = NULL
       WHERE userID = :id`,
      { password: hash, id: userPk(user) }
    );
    await db.query(`UPDATE tblAuthOtp SET used_at = NOW() WHERE authOtpID = :id`, {
      id: row.authOtpID,
    });

    return ok(res, { reset: true }, 'Password updated. Please login with your new password.');
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not reset password', 500);
  }
};

/** Public create-company request — emailed to platform inbox */
export const companyRegisterRequest = async (req, res) => {
  try {
    const company_name = String(req.body.company_name || req.body.companyName || '').trim();
    const contact_name = String(req.body.contact_name || req.body.contactName || req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const city = String(req.body.city || '').trim() || null;
    const message = String(req.body.message || '').trim() || null;

    if (!company_name) return fail(res, 'Company name is required', 400);
    if (!contact_name) return fail(res, 'Contact name is required', 400);
    if (!looksLikeEmail(email)) return fail(res, 'Valid email is required', 400);
    if (normalizePhone(phone).length < 10) return fail(res, 'Valid phone is required', 400);

    await db.query(
      `INSERT INTO tblCompanyRequest (company_name, contact_name, email, phone, city, message)
       VALUES (:company_name, :contact_name, :email, :phone, :city, :message)`,
      { company_name, contact_name, email, phone, city, message }
    );

    const inbox = PLATFORM_INBOX;
    try {
      await sendMail({
        to: inbox,
        subject: `New company registration — ${company_name}`,
        html: `
          <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
            <h2 style="margin:0 0 8px">New company registration request</h2>
            <p style="color:#64748b">Submitted from the BuildNex ShopOS login page.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
              <tr><td style="padding:6px 0;color:#64748b">Company</td><td style="padding:6px 0;font-weight:600">${company_name}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Contact</td><td style="padding:6px 0">${contact_name}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Email</td><td style="padding:6px 0">${email}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Phone</td><td style="padding:6px 0">${phone}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">City</td><td style="padding:6px 0">${city || '—'}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Message</td><td style="padding:6px 0">${message || '—'}</td></tr>
            </table>
          </div>
        `,
        text: `Company: ${company_name}\nContact: ${contact_name}\nEmail: ${email}\nPhone: ${phone}\nCity: ${city || ''}\nMessage: ${message || ''}`,
      });
    } catch (mailErr: any) {
      console.error('Company request mail failed:', mailErr?.message || mailErr);
      // Request is stored even if mail fails
    }

    return ok(
      res,
      { inbox },
      `Request submitted. Our team will contact you at ${email}. Platform mail: ${inbox}`
    );
  } catch (err) {
    console.error(err);
    return fail(res, 'Could not submit company request', 500);
  }
};
