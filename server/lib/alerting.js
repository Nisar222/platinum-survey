/**
 * Alerting — sends email notifications for crashes, errors, and SSL expiry
 * Recipients: nisar@ayndigital.com, opex@pib.ae
 */

import nodemailer from 'nodemailer';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ALERT_RECIPIENTS = ['nisar@ayndigital.com', 'opex@pib.ae'];
const APP_NAME = 'Platinum Survey';

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendAlert(subject, body) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('⚠️  Alerting: SMTP not configured, skipping email alert');
    return;
  }

  try {
    const transporter = createTransport();
    await transporter.sendMail({
      from: `"${APP_NAME} Alerts" <${process.env.SMTP_USER}>`,
      to: ALERT_RECIPIENTS.join(', '),
      subject: `[${APP_NAME}] ${subject}`,
      text: body,
      html: `<pre style="font-family:monospace;font-size:13px">${body}</pre>`
    });
    console.log(`📧 Alert sent: ${subject}`);
  } catch (err) {
    console.error('❌ Failed to send alert email:', err.message);
  }
}

// Alert on PM2 crash / uncaught exception
export function sendCrashAlert(error) {
  const body = [
    `Time: ${new Date().toISOString()}`,
    `Server: ${process.env.APP_URL || 'platinum-survey.ayndigital.com'}`,
    ``,
    `Error: ${error?.message || error}`,
    ``,
    `Stack:`,
    error?.stack || 'No stack trace available'
  ].join('\n');

  return sendAlert('🔴 App Crash / Unhandled Error', body);
}

// Alert on repeated VAPI errors
export function sendVAPIErrorAlert(errorCount, lastError) {
  const body = [
    `Time: ${new Date().toISOString()}`,
    `Server: ${process.env.APP_URL || 'platinum-survey.ayndigital.com'}`,
    ``,
    `VAPI errors in last hour: ${errorCount}`,
    `Last error: ${lastError}`
  ].join('\n');

  return sendAlert(`⚠️ VAPI Errors Detected (${errorCount})`, body);
}

// SSL cert expiry check
export async function checkSSLExpiry() {
  const certPath = process.env.SSL_CERT_PATH ||
    '/etc/letsencrypt/live/platinum-survey.ayndigital.com/fullchain.pem';

  if (!existsSync(certPath)) {
    console.warn('⚠️  SSL cert not found at', certPath);
    return;
  }

  try {
    const { execSync } = await import('child_process');
    const output = execSync(
      `openssl x509 -enddate -noout -in "${certPath}"`,
      { encoding: 'utf8' }
    ).trim();

    // output: "notAfter=Apr 19 12:00:00 2026 GMT"
    const dateStr = output.replace('notAfter=', '');
    const expiryDate = new Date(dateStr);
    const daysLeft = Math.floor((expiryDate - new Date()) / (1000 * 60 * 60 * 24));

    console.log(`🔒 SSL cert expires in ${daysLeft} days (${expiryDate.toDateString()})`);

    if (daysLeft <= 14) {
      const body = [
        `Time: ${new Date().toISOString()}`,
        ``,
        `SSL certificate for platinum-survey.ayndigital.com expires in ${daysLeft} days.`,
        `Expiry date: ${expiryDate.toDateString()}`,
        ``,
        `Action required: Run 'sudo certbot renew' on the VPS.`
      ].join('\n');

      await sendAlert(`🔒 SSL Certificate Expiring in ${daysLeft} Days`, body);
    }
  } catch (err) {
    console.error('❌ SSL expiry check failed:', err.message);
  }
}

// Alert when a call is flagged for escalation
export function sendEscalationAlert(callData) {
  const body = [
    `Time: ${new Date().toISOString()}`,
    ``,
    `A call has been flagged for escalation to a supervisor or specialist.`,
    ``,
    `Customer Name:  ${callData.customerName || '—'}`,
    `Phone Number:   ${callData.phoneNumber || '—'}`,
    `Campaign:       ${callData.campaignName || '—'}`,
    `Rating:         ${callData.rating || '—'}`,
    `Sentiment:      ${callData.customerSentiment || '—'}`,
    `Disposition:    ${callData.callDisposition || '—'}`,
    `Call Summary:   ${callData.callSummary || '—'}`,
    ``,
    `Please follow up with this customer as soon as possible.`
  ].join('\n');

  return sendAlert('🔴 Escalation Required — Customer Follow-Up Needed', body);
}

export default { sendCrashAlert, sendVAPIErrorAlert, checkSSLExpiry, sendEscalationAlert };
