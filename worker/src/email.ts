// SMTP client using Cloudflare Workers connect() API
// Gmail SMTP: smtp.gmail.com:465 (implicit TLS)

import { connect } from "cloudflare:sockets";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

function getSmtpConfig(env: {
  SMTP_EMAIL: string;
  SMTP_PASSWORD: string;
}): SmtpConfig {
  return {
    host: "smtp.gmail.com",
    port: 587, // STARTTLS, not implicit TLS
    user: env.SMTP_EMAIL,
    pass: env.SMTP_PASSWORD,
  };
}

function b64(s: string): string {
  // Handle UTF-8 for btoa
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  timeoutMs = 10000
): Promise<string> {
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const readPromise = reader.read();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("SMTP read timeout")), deadline - Date.now())
    );

    try {
      const { value, done } = await Promise.race([readPromise, timeoutPromise]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SMTP multi-line responses: check if a line starts with "XYZ " (3-digit + space = last line)
      const lines = buffer.split("\r\n");
      for (const line of lines) {
        if (/^\d{3} /.test(line)) {
          return buffer.trim();
        }
      }
    } catch (e) {
      throw new Error(`SMTP read error: ${(e as Error).message}`);
    }
  }

  if (!buffer) throw new Error("SMTP: no response received");
  return buffer.trim();
}

export async function sendSmtp(
  config: SmtpConfig,
  from: string,
  to: string,
  subject: string,
  htmlBody: string
): Promise<{ success: boolean; log: string[] }> {
  const log: string[] = [];

  // Port 587 = STARTTLS (start as plaintext, upgrade after STARTTLS command)
  let socket = await connect(
    { hostname: config.host, port: config.port },
    { secureTransport: "starttls", allowHalfOpen: false }
  );

  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function smtpCmd(cmd: string, label?: string): Promise<string> {
    await writer.write(encoder.encode(cmd + "\r\n"));
    const resp = await readResponse(reader, decoder);
    log.push(`> ${label || cmd.substring(0, 40)}`);
    log.push(`< ${resp}`);
    return resp;
  }

  try {
    // Greeting
    const greeting = await readResponse(reader, decoder);
    log.push(`< GREETING: ${greeting}`);
    if (!greeting.startsWith("220")) throw new Error(`Bad greeting: ${greeting}`);

    // EHLO
    const ehlo = await smtpCmd("EHLO classtable", "EHLO");
    if (!ehlo.startsWith("250")) throw new Error(`EHLO failed: ${ehlo}`);

    // STARTTLS
    const starttlsResp = await smtpCmd("STARTTLS", "STARTTLS");
    if (!starttlsResp.startsWith("220")) throw new Error(`STARTTLS failed: ${starttlsResp}`);

    // Release all locks before TLS upgrade
    reader.releaseLock();
    writer.releaseLock();
    // Upgrade to TLS - returns a new socket
    socket = socket.startTls();
    // Wait for TLS handshake to complete
    await new Promise(r => setTimeout(r, 200));
    reader = socket.readable.getReader();
    writer = socket.writable.getWriter();

    // EHLO again after STARTTLS
    const ehlo2 = await smtpCmd("EHLO classtable", "EHLO (after TLS)");
    if (!ehlo2.startsWith("250")) throw new Error(`EHLO after TLS failed: ${ehlo2}`);

    // AUTH LOGIN
    const authInit = await smtpCmd("AUTH LOGIN", "AUTH LOGIN");
    if (!authInit.startsWith("334")) throw new Error(`AUTH LOGIN failed: ${authInit}`);

    const userResp = await smtpCmd(b64(config.user), "USERNAME");
    if (!userResp.startsWith("334")) throw new Error(`Username rejected: ${userResp}`);

    const passResp = await smtpCmd(b64(config.pass), "PASSWORD");
    if (!passResp.startsWith("235")) throw new Error(`Auth failed: ${passResp}`);

    // MAIL FROM
    const mailFrom = await smtpCmd(`MAIL FROM:<${from}>`, "MAIL FROM");
    if (!mailFrom.startsWith("250")) throw new Error(`MAIL FROM failed: ${mailFrom}`);

    // RCPT TO
    const rcptTo = await smtpCmd(`RCPT TO:<${to}>`, "RCPT TO");
    if (!rcptTo.startsWith("250")) throw new Error(`RCPT TO failed: ${rcptTo}`);

    // DATA
    const dataResp = await smtpCmd("DATA", "DATA");
    if (!dataResp.startsWith("354")) throw new Error(`DATA failed: ${dataResp}`);

    // Build email
    const boundary = "b_" + Date.now();
    const date = new Date().toUTCString();
    const encodedSubject = `=?UTF-8?B?${b64(unescape(encodeURIComponent(subject)))}?=`;

    const email = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
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

    await writer.write(encoder.encode(email + "\r\n"));
    const sendResp = await readResponse(reader, decoder);
    log.push(`< SEND: ${sendResp}`);

    // QUIT
    await smtpCmd("QUIT", "QUIT");

    return { success: true, log };
  } catch (e) {
    log.push(`ERROR: ${(e as Error).message}`);
    try { await writer.close(); } catch {}
    try { socket.close(); } catch {}
    return { success: false, log };
  } finally {
    try { await writer.close(); } catch {}
    try { socket.close(); } catch {}
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
  const result = await sendSmtp(
    config,
    config.user,
    to,
    hasData ? `今日課表 — ${label}` : "請設定您的課表訂閱",
    hasData ? buildTimetableHtml(label, courses) : buildReminderHtml()
  );
  if (!result.success) {
    throw new Error(`SMTP failed: ${result.log.join("; ")}`);
  }
}

export async function sendMagicLinkEmail(
  env: { SMTP_EMAIL: string; SMTP_PASSWORD: string },
  to: string,
  token: string
): Promise<void> {
  const config = getSmtpConfig(env);
  const link = `https://classtable-api.ctze.workers.dev/api/auth/verify-magic?token=${encodeURIComponent(token)}`;

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

  const result = await sendSmtp(config, config.user, to, "登入驗證連結", html);
  if (!result.success) {
    throw new Error(`SMTP failed: ${result.log.join("; ")}`);
  }
}

export async function sendTestEmail(
  env: { SMTP_EMAIL: string; SMTP_PASSWORD: string },
  to: string
): Promise<{ success: boolean; log: string[] }> {
  const config = getSmtpConfig(env);
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,sans-serif;background:#f7f6f3;padding:24px;margin:0">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)">
  <h2 style="color:#37352f;margin:0 0 12px">測試郵件</h2>
  <p style="color:#64748b;font-size:.85rem">這是一封測試郵件，表示 SMTP 設定正確。</p>
  <p style="color:#9b9a97;font-size:.75rem;margin-top:16px">發送時間：${new Date().toISOString()}</p>
</div>
</body></html>`;

  return sendSmtp(config, config.user, to, "課表查詢 — 測試郵件", html);
}
