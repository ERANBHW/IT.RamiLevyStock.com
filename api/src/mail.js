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

async function sendTicketEmails(ticket) {
  const itEmail = process.env.IT_COMPANY_EMAIL;
  const adminEmail = process.env.ADMIN_EMAIL;
  const subject = `קריאת שירות חדשה ${ticket.TicketNumber} - ${ticket.Category}`;
  const body = [
    `קריאה: ${ticket.TicketNumber}`,
    `שם: ${ticket.UserName}`,
    `טלפון: ${ticket.Phone}`,
    `סניף: ${ticket.Branch}`,
    `מחשב: ${ticket.ComputerName} | IP: ${ticket.IP}`,
    `מדפסת: ${ticket.Printer} | AnyDesk: ${ticket.AnyDeskId}`,
    `קטגוריה: ${ticket.Category}`,
    `דחיפות: ${ticket.Urgency}`,
    '',
    'תיאור:',
    ticket.Description,
    '',
    `נשלח מטעם ${MAIL_SENDER_NAME}`,
  ].join('\n');

  const staffRecipients = [itEmail, adminEmail].filter(Boolean);
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

module.exports = { sendTicketEmails };
