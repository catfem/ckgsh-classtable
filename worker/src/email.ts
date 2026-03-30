// SMTP client using Cloudflare Workers connect() API
// Works with Gmail SMTP (smtp.gmail.com:465, SSL)

import { connect } from "cloudflare:sockets";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string; // app password
}

function getSmtpConfig(env: {
  SMTP_EMAIL: string;
  SMTP_PASSWORD: string;
}): SmtpConfig {
  return {
    host: "smtp.gmail.com",
    port: 465,
    user: env.SMTP_EMAIL,
    pass: env.SMTP_PASSWORD,
  };
}

// Base64 encode for SMTP AUTH
function b64(s: string): string {
  return btoa(s);
}

// Read lines from a TextStreamReader
async function readLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
): Promise<string> {
  let line = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    line += decoder.decode(value, { stream: true });
    // SMTP responses end with \r\n
    if (line.endsWith("\r\n")) break;
  }
  return line.trim();
}

async function sendSmtp(
  config: SmtpConfig,
  from: string,
  to: string,
  subject: string,
  htmlBody: string
): Promise<void> {
  const socket = await connect(
    { hostname: config.host, port: config.port },
    { secureTransport: "starttls", allowHalfOpen: false }
  );

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function send(cmd: string): Promise<string> {
    await writer.write(encoder.encode(cmd + "\r\n"));
    const resp = await readLine(reader, decoder);
    return resp;
  }

  try {
    // Read initial greeting
    await readLine(reader, decoder);

    // EHLO
    await send("EHLO classtable");

    // AUTH LOGIN
    await send("AUTH LOGIN");
    await send(b64(config.user));
    await send(b64(config.pass));

    // MAIL FROM / RCPT TO
    await send(`MAIL FROM:<${from}>`);
    await send(`RCPT TO:<${to}>`);

    // DATA
    await send("DATA");

    // Build email
    const boundary = "boundary_" + Date.now();
    const date = new Date().toUTCString();
    const mime = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      `Date: ${date}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64(htmlBody),
      ``,
      `--${boundary}--`,
      ``,
      `.`,
    ].join("\r\n");

    await writer.write(encoder.encode(mime + "\r\n"));
    await readLine(reader, decoder);

    // QUIT
    await send("QUIT");
  } finally {
    try {
      await writer.close();
    } catch {}
    try {
      socket.close();
    } catch {}
  }
}

function buildTimetableHtml(
  label: string,
  courses: { period: string; time: string; items: { name: string; teacher: string | null; room: string | null }[] }[]
): string {
  let rows = "";
  for (const p of courses) {
    const names = p.items
      .map((c) => {
        const parts = [c.name];
        if (c.teacher) parts.push(c.teacher);
        if (c.room) parts.push(c.room);
        return parts.join(" · ");
      })
      .join("<br>");
    rows += `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e9e9e7;font-weight:600;color:#37352f;white-space:nowrap">${p.period}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e9e9e7;color:#64748b;white-space:nowrap">${p.time}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e9e9e7">${names || '<span style="color:#9b9a97">—</span>'}</td>
    </tr>`;
  }

  const today = new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;background:#f7f6f3;padding:24px;margin:0">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
  <div style="padding:20px 24px;border-bottom:1px solid #e9e9e7">
    <h1 style="margin:0;font-size:1.1rem;color:#37352f">${label}</h1>
    <p style="margin:4px 0 0;font-size:.8rem;color:#9b9a97">${today} 課表</p>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:.82rem">
    <thead><tr>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e9e9e7;color:#9b9a97;font-weight:500;font-size:.75rem">節次</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e9e9e7;color:#9b9a97;font-weight:500;font-size:.75rem">時間</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e9e9e7;color:#9b9a97;font-weight:500;font-size:.75rem">課程</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="padding:16px 24px;border-top:1px solid #e9e9e7;text-align:center">
    <a href="https://classtable-api.ctze.workers.dev" style="font-size:.75rem;color:#2eaadc;text-decoration:none">課表查詢系統</a>
  </div>
</div>
</body></html>`;
}

function buildReminderHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;background:#f7f6f3;padding:24px;margin:0">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
  <div style="padding:20px 24px;border-bottom:1px solid #e9e9e7">
    <h1 style="margin:0;font-size:1.1rem;color:#37352f">尚未設定課表</h1>
    <p style="margin:8px 0 0;font-size:.85rem;color:#64748b">請前往設定頁面選擇您的班級，即可收到每日課表通知。</p>
  </div>
  <div style="padding:20px 24px;text-align:center">
    <a href="https://classtable-api.ctze.workers.dev/settings" style="display:inline-block;padding:10px 24px;background:#3730a3;color:#fff;border-radius:6px;text-decoration:none;font-size:.85rem;font-weight:500">前往設定</a>
  </div>
</div>
</body></html>`;
}

export async function sendDailyEmail(
  env: { SMTP_EMAIL: string; SMTP_PASSWORD: string },
  to: string,
  label: string,
  courses: { period: string; time: string; items: { name: string; teacher: string | null; room: string | null }[] }[]
): Promise<void> {
  const config = getSmtpConfig(env);
  const hasData = courses.some((c) => c.items.length > 0);

  await sendSmtp(
    config,
    config.user,
    to,
    hasData ? `今日課表 — ${label}` : "請設定您的課表訂閱",
    hasData ? buildTimetableHtml(label, courses) : buildReminderHtml()
  );
}

export async function sendMagicLinkEmail(
  env: { SMTP_EMAIL: string; SMTP_PASSWORD: string },
  to: string,
  token: string
): Promise<void> {
  const config = getSmtpConfig(env);
  const link = `https://classtable-api.ctze.workers.dev/api/auth/verify-magic?token=${token}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,sans-serif;background:#f7f6f3;padding:24px;margin:0">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)">
  <h2 style="color:#37352f;margin:0 0 12px">登入課表查詢</h2>
  <p style="color:#64748b;font-size:.85rem">點擊下方按鈕登入，連結 15 分鐘內有效。</p>
  <a href="${link}" style="display:inline-block;margin:16px 0;padding:12px 32px;background:#3730a3;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">登入</a>
  <p style="color:#9b9a97;font-size:.75rem;margin-top:16px">如果您沒有申請此登入，請忽略此郵件。</p>
</div>
</body></html>`;

  await sendSmtp(config, config.user, to, "登入驗證連結", html);
}
