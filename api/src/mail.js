const { ConfidentialClientApplication } = require('@azure/msal-node');

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

async function graphSendMail({ to, subject, body }) {
  const token = await getGraphToken();
  const sender = process.env.GRAPH_SENDER_MAILBOX;
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Text', content: body },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
  }
}

const MAIL_SENDER_NAME = process.env.MAIL_SENDER_NAME || 'IT-Rami-Levy-Stock';

// v2.1, section 8: a ticket opened "for: a printer" routes to PRINTER_SUPPORT_EMAIL
// instead of the usual IT_COMPANY_EMAIL/ADMIN_EMAIL pair.
async function sendTicketEmails(ticket, opts = {}) {
  const printerEmail = process.env.PRINTER_SUPPORT_EMAIL;
  const staffRecipients = opts.isPrinterTicket
    ? [printerEmail].filter(Boolean)
    : [process.env.IT_COMPANY_EMAIL, process.env.ADMIN_EMAIL].filter(Boolean);

  const subject = `קריאת שירות חדשה ${ticket.TicketNumber} - ${ticket.Category}`;
  const body = [
    `קריאה: ${ticket.TicketNumber}`,
    `שם: ${ticket.UserName}`,
    `טלפון: ${ticket.Phone}`,
    `סניף: ${ticket.Branch}`,
    `מחשב: ${ticket.ComputerName}`,
    `מדפסת: ${ticket.Printer} | AnyDesk: ${ticket.AnyDeskId}`,
    `קטגוריה: ${ticket.Category}`,
    `דחיפות: ${ticket.Urgency}`,
    '',
    'תיאור:',
    ticket.Description,
    '',
    `נשלח מטעם ${MAIL_SENDER_NAME}`,
  ].join('\n');

  if (staffRecipients.length) {
    await graphSendMail({ to: staffRecipients, subject, body });
  }

  if (ticket.UserEmail) {
    await graphSendMail({
      to: [ticket.UserEmail],
      subject: `הקריאה שלך נפתחה - ${ticket.TicketNumber}`,
      body: `שלום ${ticket.UserName},\n\nהקריאה שלך נפתחה בהצלחה.\n\n${body}`,
    });
  }
}

async function sendUserRequestEmail(request) {
  const itEmail = process.env.IT_COMPANY_EMAIL;
  const adminEmail = process.env.ADMIN_EMAIL;
  const staffRecipients = [itEmail, adminEmail].filter(Boolean);
  if (!staffRecipients.length) return;

  const subject = `בקשת הקמת משתמש חדש ${request.RequestNumber}`;
  const body = [
    `בקשה: ${request.RequestNumber}`,
    `הוגשה ע"י: ${request.RequesterName} (${request.RequesterEmail})`,
    `שם: ${request.FirstNameHe} ${request.LastNameHe} / ${request.FirstNameEn} ${request.LastNameEn}`,
    `תפקיד: ${request.Role}`,
    `מייל מוצע: ${request.SuggestedEmail}`,
    '',
    'פרטים מלאים, סקריפט ההקמה וסיסמה זמנית נמצאים בתור "בקשות הקמת משתמש" בפורטל.',
    '',
    `נשלח מטעם ${MAIL_SENDER_NAME}`,
  ].join('\n');

  await graphSendMail({ to: staffRecipients, subject, body });
}

// Sent when IT marks a request "הוקם" — goes to whoever originally submitted the request,
// with the new login so they can hand it to the employee. Requested explicitly by the
// product owner; note this does put a temporary password in an email body (mitigated by
// ForceChangePasswordNextSignIn=true in the setup script, but still worth knowing).
async function sendUserRequestCompletedEmail(request) {
  if (!request.RequesterEmail) return;
  const subject = `המשתמש שביקשת מוכן - ${request.RequestNumber}`;
  const body = [
    `שלום ${request.RequesterName || ''},`,
    '',
    `המשתמש שביקשת (${request.FirstNameHe} ${request.LastNameHe}) הוקם במערכות החברה.`,
    '',
    `כתובת מייל: ${request.SuggestedEmail}`,
    `סיסמה זמנית: ${request.TempPassword}`,
    '',
    'יש להעביר את הפרטים לעובד/ת. בכניסה הראשונה תתבקש/י לבחור סיסמה חדשה.',
    '',
    `נשלח מטעם ${MAIL_SENDER_NAME}`,
  ].join('\n');

  await graphSendMail({ to: [request.RequesterEmail], subject, body });
}

module.exports = { sendTicketEmails, sendUserRequestEmail, sendUserRequestCompletedEmail };
