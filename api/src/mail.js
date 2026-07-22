const { ConfidentialClientApplication } = require('@azure/msal-node');
const { getPool } = require('./db');

let msalClient;
function getMsalClient() {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.GRAPH_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}`,
        clientSecret: process.env.GRAPH_CLIENT_SECRET,
      },
    });
  }
  return msalClient;
}

async function getGraphToken() {
  const result = await getMsalClient().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result.accessToken;
}

const MAIL_SENDER_NAME = process.env.MAIL_SENDER_NAME || 'Support Rami Levy Stock';

async function graphSendMail({ to, subject, html }) {
  const token = await getGraphToken();
  const sender = process.env.GRAPH_SENDER_MAILBOX;
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
        // Best-effort display-name override — Exchange only honors this when the mailbox
        // is actually named this way (or has explicit Send-As set up for it); if not, the
        // recipient just sees the mailbox's own registered name instead. Never a hard error
        // either way.
        from: { emailAddress: { name: MAIL_SENDER_NAME, address: sender } },
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
  }
}

// Global Admin's "ניהול כתובות מייל" screen (section 8 follow-up) takes priority; falls
// back to the original app-settings env vars per-field so nothing breaks before the
// migration/first save.
async function getEmailRouting() {
  const fallback = {
    itCompanyEmail: process.env.IT_COMPANY_EMAIL || '',
    printerCompanyEmail: process.env.PRINTER_SUPPORT_EMAIL || '',
    adminEmail: process.env.ADMIN_EMAIL || '',
  };
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM EmailSettings WHERE Id = 1');
    const row = result.recordset[0];
    if (!row) return fallback;
    return {
      itCompanyEmail: row.ItCompanyEmail || fallback.itCompanyEmail,
      printerCompanyEmail: row.PrinterCompanyEmail || fallback.printerCompanyEmail,
      adminEmail: row.AdminEmail || fallback.adminEmail,
    };
  } catch (err) {
    console.error('getEmailRouting failed, using env var fallback', err);
    return fallback;
  }
}

// ── HTML TEMPLATE (section 8 follow-up) — every email shares this shell: logo header in
// brand pink, white card body, quiet footer. Keeps every automated email visually
// consistent with the portal itself instead of a bare text dump. ──────────────────────
const LOGO_URL = 'https://rami-levy-stock.co.il/sing.png';
const BRAND_PINK = '#de3995';
const BRAND_PINK_DARK = '#b92376';
const BRAND_PINK_SOFT = '#fff0f8';
const TEXT_COLOR = '#171717';
const MUTED_COLOR = '#676b73';
const BORDER_COLOR = '#e1e3e7';
const BACKGROUND_COLOR = '#f6f6f8';

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatDateTimeHe(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Outlook's desktop client renders HTML mail through Word's engine, which ignores
// `white-space: pre-wrap` entirely — the only reliable cross-client way to preserve a
// user's line breaks in free-text fields (description, resolution, notes) is to turn
// each \n into a real <br> in the markup itself.
function nl2br(str) {
  return escapeHtml(str).replace(/\r\n|\r|\n/g, '<br>');
}

function fieldRow(label, value) {
  if (!value) return '';
  return `<tr>
    <td style="padding:6px 10px 6px 0;color:${MUTED_COLOR};font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;color:${TEXT_COLOR};font-size:14px;">${escapeHtml(value)}</td>
  </tr>`;
}

function fieldsTable(rows) {
  const html = rows.join('');
  if (!html) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 18px;">${html}</table>`;
}

function urgencyBadge(urgency) {
  if (!urgency) return '';
  return `<span style="display:inline-block;background:${BRAND_PINK_SOFT};color:${BRAND_PINK_DARK};font-weight:700;font-size:12px;padding:3px 10px;border-radius:12px;">${escapeHtml(urgency)}</span>`;
}

function wrapEmailHtml({ title, badgeHtml, bodyHtml }) {
  // Logo sits above the card, on the plain page background — not inside it — with the
  // card itself keeping a thin brand-pink top accent instead of a full colored header.
  const titleRow = badgeHtml
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:18px;"><tr>
        <td style="font-size:19px;color:${TEXT_COLOR};font-weight:700;">${title}</td>
        <td style="padding-inline-start:10px;">${badgeHtml}</td>
      </tr></table>`
    : `<h1 style="margin:0 0 18px;font-size:19px;color:${TEXT_COLOR};">${title}</h1>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:${BACKGROUND_COLOR};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BACKGROUND_COLOR};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td align="center" style="padding-bottom:16px;">
          <img src="${LOGO_URL}" alt="רמי לוי סטוק" style="height:40px;">
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;border-top:4px solid ${BRAND_PINK};overflow:hidden;box-shadow:0 4px 16px rgba(20,20,30,0.08);">
        <tr><td style="padding:28px;">
          ${titleRow}
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#fafafa;border-top:1px solid ${BORDER_COLOR};text-align:center;font-size:12px;color:${MUTED_COLOR};">
          נשלח אוטומטית ממערכת ה-IT של רמי לוי סטוק
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Ticket timeline (item 4) — a Node-side mirror of the portal's own describeLogEntry,
// so the closing email's history reads identically to what IT sees in the dashboard.
const TICKET_FIELD_LABELS_HE = {
  Category: 'קטגוריה', Subcategory: 'פירוט', Urgency: 'דחיפות', UserName: 'שם עובד', Description: 'תיאור',
  ComputerName: 'מחשב', IP: 'IP', Printer: 'מדפסת', AnyDeskId: 'AnyDesk', Status: 'סטטוס',
};

function describeLogEntry(entry) {
  if (entry.Action === 'field_updated') {
    return `${TICKET_FIELD_LABELS_HE[entry.FieldName] || entry.FieldName} שונה: "${entry.OldValue || ''}" ← "${entry.NewValue || ''}"`;
  }
  if (entry.Action === 'status_changed') return `סטטוס שונה: ${entry.OldValue} ← ${entry.NewValue}`;
  return entry.Message || entry.Action;
}

function timelineHtml(logRows) {
  // 'internal_note' is IT-only documentation — never shown to the ticket's own requester,
  // same rule tickets.get() already applies for the portal's own timeline view.
  const visible = logRows.filter((r) => r.Action !== 'internal_note');
  if (!visible.length) return `<p style="color:${MUTED_COLOR};font-size:13px;">אין רשומות.</p>`;
  const items = visible.map((entry) => `
    <div style="padding:10px 0;border-bottom:1px solid ${BORDER_COLOR};">
      <div style="font-size:11px;color:${MUTED_COLOR};">${formatDateTimeHe(entry.Timestamp)} · ${escapeHtml(entry.ActorName || entry.ActorEmail)}</div>
      <div style="font-size:13px;color:${TEXT_COLOR};margin-top:2px;">${escapeHtml(describeLogEntry(entry))}</div>
    </div>`).join('');
  return `<div style="margin-bottom:6px;">${items}</div>`;
}

// v2.1, section 8: a ticket opened "for: a printer" routes to the printer company's
// email instead of the usual IT company/admin pair — the global admin is CC'd either way.
async function sendTicketEmails(ticket, opts = {}) {
  const routing = await getEmailRouting();
  const staffRecipients = (opts.isPrinterTicket
    ? [routing.printerCompanyEmail, routing.adminEmail]
    : [routing.itCompanyEmail, routing.adminEmail]
  ).filter(Boolean);

  const detailRows = fieldsTable([
    fieldRow('קריאה', ticket.TicketNumber),
    fieldRow('שם', ticket.UserName),
    fieldRow('טלפון', ticket.Phone),
    fieldRow('סניף', ticket.Branch),
    fieldRow('מחשב', ticket.ComputerName),
    fieldRow('מדפסת', ticket.Printer),
    fieldRow('AnyDesk', ticket.AnyDeskId),
    fieldRow('קטגוריה', [ticket.Category, ticket.Subcategory].filter(Boolean).join(' / ')),
    fieldRow('תאריך פתיחה', formatDateTimeHe(ticket.Timestamp)),
  ]);
  const staffBodyHtml = `
    ${detailRows}
    <div style="margin-bottom:6px;color:${MUTED_COLOR};font-size:13px;">תיאור:</div>
    <div style="font-size:14px;color:${TEXT_COLOR};background:${BACKGROUND_COLOR};border-radius:10px;padding:12px 14px;">${nl2br(ticket.Description)}</div>`;

  if (staffRecipients.length) {
    // Item 5: urgency goes in the staff-facing subject only, never the employee's own.
    const subject = `קריאת שירות חדשה ${ticket.TicketNumber} - ${ticket.Category} - דחיפות: ${ticket.Urgency}`;
    await graphSendMail({
      to: staffRecipients,
      subject,
      html: wrapEmailHtml({ title: `קריאת שירות חדשה ${ticket.TicketNumber}`, badgeHtml: urgencyBadge(ticket.Urgency), bodyHtml: staffBodyHtml }),
    });
  }

  if (ticket.UserEmail) {
    // Item 6: no AnyDesk mention for the employee, a reassuring line instead, and the
    // opening time shown plainly in the styled card.
    const employeeRows = fieldsTable([
      fieldRow('קריאה', ticket.TicketNumber),
      fieldRow('קטגוריה', [ticket.Category, ticket.Subcategory].filter(Boolean).join(' / ')),
      fieldRow('דחיפות', ticket.Urgency),
      fieldRow('תאריך פתיחה', formatDateTimeHe(ticket.Timestamp)),
    ]);
    const employeeBodyHtml = `
      <p style="font-size:14px;color:${TEXT_COLOR};margin:0 0 16px;">שלום ${escapeHtml(ticket.UserName)},<br>הקריאה שלך התקבלה בהצלחה ובקרוב יהיה לך מענה מצוות ה-IT.</p>
      ${employeeRows}
      <div style="margin-bottom:6px;color:${MUTED_COLOR};font-size:13px;">תיאור שהוזן:</div>
      <div style="font-size:14px;color:${TEXT_COLOR};background:${BACKGROUND_COLOR};border-radius:10px;padding:12px 14px;">${nl2br(ticket.Description)}</div>`;
    await graphSendMail({
      to: [ticket.UserEmail],
      subject: `הקריאה שלך נפתחה - ${ticket.TicketNumber}`,
      html: wrapEmailHtml({ title: 'הקריאה שלך נפתחה בהצלחה', bodyHtml: employeeBodyHtml }),
    });
  }
}

// Item 4: sent to the ticket's own requester when IT closes it — resolution text plus
// the ticket's full history, same shape as the portal's own timeline (minus internal-only
// notes). `log` is the TicketLog rows already fetched after the close write completed.
async function sendTicketClosedEmail(ticket, log) {
  if (!ticket.UserEmail) return;
  const resolutionNote = [...log].reverse().find((r) => r.Action === 'note');
  const bodyHtml = `
    <p style="font-size:14px;color:${TEXT_COLOR};margin:0 0 16px;">שלום ${escapeHtml(ticket.UserName)},<br>הקריאה שלך נסגרה. פרטי הפתרון וההיסטוריה המלאה למטה.</p>
    ${resolutionNote ? `
      <div style="margin-bottom:6px;color:${MUTED_COLOR};font-size:13px;">פתרון:</div>
      <div style="font-size:14px;color:${TEXT_COLOR};background:${BACKGROUND_COLOR};border-radius:10px;padding:12px 14px;margin-bottom:18px;">${nl2br(resolutionNote.Message)}</div>
    ` : ''}
    <div style="margin-bottom:6px;color:${MUTED_COLOR};font-size:13px;">היסטוריית הקריאה:</div>
    ${timelineHtml(log)}`;

  await graphSendMail({
    to: [ticket.UserEmail],
    subject: `הקריאה שלך נסגרה - ${ticket.TicketNumber}`,
    html: wrapEmailHtml({ title: `הקריאה ${ticket.TicketNumber} נסגרה`, bodyHtml }),
  });
}

async function sendUserRequestEmail(request) {
  const routing = await getEmailRouting();
  const staffRecipients = [routing.itCompanyEmail, routing.adminEmail].filter(Boolean);
  if (!staffRecipients.length) return;

  const bodyRows = fieldsTable([
    fieldRow('בקשה', request.RequestNumber),
    fieldRow('הוגשה ע"י', `${request.RequesterName} (${request.RequesterEmail})`),
    fieldRow('שם', `${request.FirstNameHe} ${request.LastNameHe} / ${request.FirstNameEn} ${request.LastNameEn}`),
    fieldRow('תפקיד', request.Role),
    fieldRow('מייל מוצע', request.SuggestedEmail),
  ]);
  const bodyHtml = `${bodyRows}<p style="font-size:13px;color:${MUTED_COLOR};">פרטים מלאים, סקריפט ההקמה וסיסמה זמנית נמצאים בתור "בקשות הקמת משתמש" בפורטל.</p>`;

  await graphSendMail({
    to: staffRecipients,
    subject: `בקשת הקמת משתמש חדש ${request.RequestNumber}`,
    html: wrapEmailHtml({ title: `בקשת הקמת משתמש ${request.RequestNumber}`, bodyHtml }),
  });
}

// Sent when IT marks a request "הוקם" — goes to whoever originally submitted the request,
// with the new login so they can hand it to the employee. Requested explicitly by the
// product owner; note this does put a temporary password in an email body (mitigated by
// ForceChangePasswordNextSignIn=true in the setup script, but still worth knowing).
async function sendUserRequestCompletedEmail(request) {
  if (!request.RequesterEmail) return;
  const bodyRows = fieldsTable([
    fieldRow('כתובת מייל', request.SuggestedEmail),
    fieldRow('סיסמה זמנית', request.TempPassword),
  ]);
  const bodyHtml = `
    <p style="font-size:14px;color:${TEXT_COLOR};margin:0 0 16px;">שלום ${escapeHtml(request.RequesterName || '')},<br>המשתמש שביקשת (${escapeHtml(request.FirstNameHe)} ${escapeHtml(request.LastNameHe)}) הוקם במערכות החברה.</p>
    ${bodyRows}
    <p style="font-size:13px;color:${MUTED_COLOR};">יש להעביר את הפרטים לעובד/ת. בכניסה הראשונה תתבקש/י לבחור סיסמה חדשה.</p>`;

  await graphSendMail({
    to: [request.RequesterEmail],
    subject: `המשתמש שביקשת מוכן - ${request.RequestNumber}`,
    html: wrapEmailHtml({ title: 'המשתמש שביקשת מוכן', bodyHtml }),
  });
}

module.exports = { sendTicketEmails, sendTicketClosedEmail, sendUserRequestEmail, sendUserRequestCompletedEmail };
