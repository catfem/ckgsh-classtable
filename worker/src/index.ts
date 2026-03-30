const SOURCE_BASE = "http://class.ckgsh.ntpc.edu.tw/classtable";

import { signToken, verifyToken, getTokenFromCookie, setCookieHeader, clearCookieHeader } from "./auth";
import type { JWTPayload } from "./auth";
import { createUser, getUserByEmail, verifyPassword, createMagicLink, verifyMagicLink, getUserById, getSubscriptions, addSubscription, deleteSubscription, toggleSubscription, getAllActiveSubscriptions } from "./db";
import { sendDailyEmail, sendMagicLinkEmail, sendTestEmail } from "./email";

interface Env {
  SOURCE_BASE_URL: string;
  DB: D1Database;
  JWT_SECRET: string;
  SMTP_EMAIL: string;
  SMTP_PASSWORD: string;
}

export interface CourseInfo {
  name: string;
  teacher: string | null;
  room: string | null;
  weekType: string | null;
}

export interface ScheduleCell {
  period: number;
  day: number;
  courses: CourseInfo[];
}

interface TimetableResponse {
  title: string;
  term: string;
  type: string;
  code: string;
  days: string[];
  periods: { name: string; time: string; section: string }[];
  schedule: ScheduleCell[];
  weekNo?: string;
}

interface Option {
  value: string;
  label: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function decodeBig5(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("big5").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

// Extract cookies from response headers
function extractCookies(response: Response): string {
  const cookies: string[] = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      cookies.push(value.split(";")[0]);
    }
  });
  return cookies.join("; ");
}

// Fetch a page, establishing session if needed
async function fetchPage(
  path: string,
  cookie?: string
): Promise<{ html: string; cookie: string }> {
  const url = `${SOURCE_BASE}/${path}`;
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    Referer: `${SOURCE_BASE}/top.asp`,
  };
  if (cookie) {
    headers["Cookie"] = cookie;
  }

  const response = await fetch(url, { headers, redirect: "follow" });
  const newCookie = extractCookies(response);
  const buffer = await response.arrayBuffer();
  const html = decodeBig5(buffer);
  return {
    html,
    cookie: newCookie || cookie || "",
  };
}

// Establish session by fetching top.asp
async function getSession(): Promise<string> {
  const { cookie } = await fetchPage("top.asp");
  return cookie;
}

// Parse options from a <select> dropdown by id
function parseSelectOptions(html: string, selectId: string, skipValue = "aaa"): Option[] {
  const options: Option[] = [];
  const section = html.match(
    new RegExp(`<select[^>]*id="${selectId}"[^>]*>([\\s\\S]*?)</select>`, "i")
  );
  if (!section) return options;

  const regex = /<option\s+value="([^"]*)"[^>]*>([^<]+)<\/option>/g;
  let match;
  while ((match = regex.exec(section[1])) !== null) {
    if (match[1] && match[1] !== skipValue) {
      options.push({ value: match[1], label: match[2].trim() });
    }
  }
  return options;
}

function parseTerms(html: string): Option[] {
  return parseSelectOptions(html, "ddlTerm", "");
}

function parseClasses(html: string): Option[] {
  return parseSelectOptions(html, "s1");
}

function parseTeachers(html: string): Option[] {
  return parseSelectOptions(html, "s2");
}

function parseRooms(html: string): Option[] {
  return parseSelectOptions(html, "s3");
}

function parseWeeks(html: string): Option[] {
  return parseSelectOptions(html, "s4", "aaa");
}

// Period definitions matching the source site
const PERIODS = [
  { name: "早自習", time: "07:30-07:50", section: "morning" },
  { name: "第一節", time: "08:00-08:45", section: "morning" },
  { name: "第二節", time: "09:00-09:45", section: "morning" },
  { name: "第三節", time: "10:00-10:45", section: "morning" },
  { name: "第四節", time: "11:00-11:45", section: "morning" },
  { name: "第五節", time: "13:00-13:45", section: "afternoon" },
  { name: "第六節", time: "14:00-14:45", section: "afternoon" },
  { name: "第七節", time: "15:00-15:45", section: "afternoon" },
  { name: "第八節", time: "15:55-16:40", section: "afternoon" },
  { name: "第九節", time: "16:45-17:30", section: "afternoon" },
];

const DAYS = ["一", "二", "三", "四", "五", "六"];

// Strip HTML tags and decode entities
function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

// Parse courses from a single tdColumn cell
function parseCellCourses(cellHtml: string): CourseInfo[] {
  const courses: CourseInfo[] = [];

  // Split by <br> blocks to separate course entries
  const blocks = cellHtml.split(/<br\s*\/?>/gi);

  let current: Partial<CourseInfo> | null = null;

  for (const block of blocks) {
    const courseMatch = block.match(
      /<a[^>]*class="course"[^>]*>([^<]+)<\/a>/
    );

    if (courseMatch) {
      // Save previous course
      if (current && current.name) {
        courses.push(current as CourseInfo);
      }
      current = {
        name: courseMatch[1].trim(),
        teacher: null,
        room: null,
        weekType: null,
      };
      // Check for week type in same block
      const weekMatch = block.match(/(單週|雙週)/);
      if (weekMatch) current.weekType = weekMatch[1];
    } else if (current) {
      // Non-course text lines are teacher or room
      const text = stripTags(block).replace(/(單週|雙週)/g, "").trim();
      if (!text) continue;

      if (!current.teacher) {
        current.teacher = text;
      } else if (!current.room) {
        current.room = text;
      }
    }
  }

  if (current && current.name) {
    courses.push(current as CourseInfo);
  }

  return courses;
}

// Split HTML by a tag pattern, returning inner content of each match
function splitByTag(html: string, openTag: RegExp, closeTag: string): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(openTag.source, "gi");
  while ((match = re.exec(html)) !== null) {
    const start = re.lastIndex;
    const end = html.indexOf(closeTag, start);
    if (end === -1) break;
    results.push(html.substring(start, end));
  }
  return results;
}

// Parse timetable from down.asp HTML
function parseTimetable(html: string): TimetableResponse | null {
  const titleMatch = html.match(
    /<span[^>]*class="view_title"[^>]*>([^<]+)<\/span>/
  );
  const title = titleMatch ? titleMatch[1].trim() : "課表";

  const tableMatch = html.match(
    /<table[^>]*class="classTable"[^>]*>([\s\S]*?)<\/table>/i
  );
  if (!tableMatch) return null;

  const tableHtml = tableMatch[1];

  // Split into rows
  const rows = splitByTag(tableHtml, /<tr[^>]*>/, "</tr>");

  const schedule: ScheduleCell[] = [];
  let periodIndex = 0;

  for (const rowHtml of rows) {
    // Find all td cells in this row
    const cells: { attrs: string; html: string }[] = [];
    const cellRe = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      cells.push({ attrs: cm[1], html: cm[2] });
    }

    // Data rows have exactly 6 tdColumn cells
    const tdCols = cells.filter((c) => c.attrs.includes("tdColumn"));
    if (tdCols.length !== 6) continue;

    for (let d = 0; d < 6; d++) {
      const courses = parseCellCourses(tdCols[d].html);
      schedule.push({ period: periodIndex, day: d, courses });
    }
    periodIndex++;
  }

  return {
    title,
    term: "",
    type: "",
    code: "",
    days: DAYS,
    periods: PERIODS.slice(0, Math.max(periodIndex, PERIODS.length)),
    schedule,
  };
}

// ──── Inline HTML frontend ────
function HTML_PAGE(page: string, user: { sub: string; email: string } | null): string {
  const CSS = `
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#fff;--tx:#37352f;--tm:#9b9a97;--bd:#e9e9e7;--br:#f7f6f3;--ho:#f1f1ef;--ac:#2eaadc;--pri:#3730a3;--r:4px}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","Helvetica Neue",sans-serif;background:var(--bg);color:var(--tx);line-height:1.5;-webkit-font-smoothing:antialiased}
    .page{max-width:960px;margin:0 auto;padding:48px 24px 120px}
    .title{font-size:2rem;font-weight:700;letter-spacing:-.03em;margin-bottom:4px}
    .subtitle{color:var(--tm);font-size:.875rem;margin-bottom:36px}
    .topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:36px;flex-wrap:wrap;gap:12px}
    .topbar .left .title{margin-bottom:0}
    .topbar .right{display:flex;gap:8px;align-items:center}
    .filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px;align-items:center}
    .pill{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;border:none;background:var(--br);color:var(--tx);font-size:.8rem;cursor:pointer;transition:background .12s;font-family:inherit}
    .pill:hover{background:var(--ho)}.pill.on{background:var(--tx);color:#fff}
    .sel{appearance:none;border:none;background:var(--br);border-radius:var(--r);padding:5px 26px 5px 10px;font-size:.8rem;color:var(--tx);cursor:pointer;font-family:inherit;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%239b9a97' d='M5 7L0 2h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;transition:background .12s;max-width:200px}
    .sel:hover{background:var(--ho)}.sel:focus{outline:2px solid var(--ac);outline-offset:-2px}.sel:disabled{opacity:.4}
    .sep{width:1px;height:20px;background:var(--bd);margin:0 4px}
    .table-wrap{overflow-x:auto;margin-top:20px}
    .tt{width:100%;border-collapse:collapse;font-size:.8rem;table-layout:fixed}
    .tt th{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--bd);padding:8px 6px;text-align:center;font-weight:500;color:var(--tm);font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;z-index:1}
    .tt th:first-child{width:64px}
    .tt td{border-bottom:1px solid var(--br);padding:6px 8px;vertical-align:top;height:72px;transition:background .08s;overflow:hidden}
    .tt tr:hover td{background:var(--br)}
    .per{text-align:center;white-space:nowrap;color:var(--tm);font-size:.75rem;padding:8px 2px}
    .per b{display:block;color:var(--tx);font-weight:600;font-size:.78rem}
    .per i{display:block;font-style:normal;font-size:.68rem;color:var(--tm);margin-top:1px}
    .card{padding:4px 0}.card+.card{margin-top:4px}
    .cn{font-weight:600;font-size:.78rem;line-height:1.3}
    .cm{font-size:.68rem;color:var(--tm);margin-top:1px}
    .tag{display:inline;font-size:.65rem;padding:1px 5px;border-radius:3px;font-weight:500;margin-left:4px}
    .tag.o{background:#fff3e0;color:#e65100}.tag.e{background:#e8f5e9;color:#2e7d32}
    .empty{text-align:center;padding:100px 20px;color:var(--tm)}
    .empty h2{font-size:1.1rem;font-weight:500;color:var(--tx);margin-bottom:6px}
    .ld{display:flex;justify-content:center;padding:80px}
    .sp{width:24px;height:24px;border:2px solid var(--bd);border-top-color:var(--tx);border-radius:50%;animation:spin .6s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .err{color:#eb5757;font-size:.85rem;padding:12px 0}
    .head{display:flex;align-items:baseline;gap:12px;margin-bottom:28px;flex-wrap:wrap}
    .head h2{font-size:1.15rem;font-weight:600;letter-spacing:-.02em}
    .head .meta{font-size:.75rem;color:var(--tm)}
    .link{color:var(--ac);text-decoration:none;font-size:.82rem}.link:hover{text-decoration:underline}
    .btn{display:inline-block;padding:8px 20px;border-radius:6px;border:none;font-size:.85rem;font-weight:500;cursor:pointer;font-family:inherit;transition:opacity .12s}
    .btn:hover{opacity:.85}.btn.pri{background:var(--pri);color:#fff}.btn.ghost{background:var(--br);color:var(--tx)}
    .form{max-width:400px;margin:0 auto}
    .form h2{font-size:1.3rem;font-weight:700;margin-bottom:24px;text-align:center}
    .form label{display:block;font-size:.75rem;font-weight:600;color:var(--tm);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
    .form input{width:100%;padding:10px 12px;border:1px solid var(--bd);border-radius:var(--r);font-size:.9rem;font-family:inherit;margin-bottom:16px;transition:border-color .12s}
    .form input:focus{outline:none;border-color:var(--ac)}
    .form .btn{width:100%;margin-bottom:12px;text-align:center}
    .form .or{text-align:center;color:var(--tm);font-size:.8rem;margin:12px 0}
    .form .msg{text-align:center;font-size:.85rem;margin-top:12px}
    .form .msg.ok{color:#16a34a}.form .msg.bad{color:#eb5757}
    .form .switch{text-align:center;margin-top:20px;font-size:.82rem;color:var(--tm)}
    .sub-list{margin-top:24px}
    .sub-item{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--br);gap:12px}
    .sub-item .info{flex:1}
    .sub-item .info b{font-size:.85rem;display:block}.sub-item .info span{font-size:.75rem;color:var(--tm)}
    .sub-item .actions{display:flex;gap:6px}
    .sub-add{margin-top:24px;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
    .sub-add .sel{max-width:180px}
    .hint{font-size:.75rem;color:var(--tm);margin-top:24px;text-align:center}
    .nav-link{color:var(--tx);text-decoration:none;font-size:.82rem;padding:6px 12px;border-radius:6px;background:var(--br)}
    .nav-link:hover{background:var(--ho)}
    @media(max-width:640px){.page{padding:24px 16px 80px}.title{font-size:1.5rem}.filters{gap:6px}.sel{font-size:.75rem;max-width:140px}.tt{font-size:.75rem}.tt th,.tt td{padding:4px 8px}}`;

  const NAV = user
    ? `<div class="topbar"><div class="left"><h1 class="title">課表查詢</h1><p class="subtitle">崇光國民中學</p></div><div class="right"><a href="/settings" class="nav-link">設定</a><button class="nav-link" id="logoutBtn" style="cursor:pointer;border:none;font-family:inherit">登出</button></div></div>`
    : `<div class="topbar"><div class="left"><h1 class="title">課表查詢</h1><p class="subtitle">崇光國民中學</p></div><div class="right"><a href="/login" class="nav-link">登入</a></div></div>`;

  const FOOTER_SCRIPT = `var lb=document.getElementById('logoutBtn');if(lb)lb.onclick=function(){fetch('/api/auth/logout',{method:'POST'}).then(function(){location.href='/'})}`;
  const FOOTER = `<` + `script>` + FOOTER_SCRIPT + `<` + `/script>`;

  if (page === "login") {
    return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>登入 — 課表查詢</title><style>${CSS}</style></head><body><div class="page"><div class="form"><h2>登入</h2><label>電子郵件</label><input type="email" id="email" placeholder="you@example.com"><label>密碼（選填）</label><input type="password" id="password" placeholder="若已設定密碼"><button class="btn pri" id="loginBtn">登入</button><div class="or">或</div><button class="btn ghost" id="magicBtn">寄送登入連結</button><div class="msg" id="msg"></div><div class="switch">沒有帳號？<a href="/register" class="link">註冊</a></div></div></div><script>(function(){var $e=document.getElementById('email'),$p=document.getElementById('password'),$m=document.getElementById('msg'),B=location.origin;$m.className='msg';function show(t,c){$m.textContent=t;$m.className='msg '+c}document.getElementById('loginBtn').onclick=function(){var e=$e.value;if(!e)return show('請輸入電子郵件','bad');fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:$p.value})}).then(function(r){return r.json().then(function(d){if(r.ok){location.href='/settings'}else show(d.error,'bad')})}).catch(function(){show('連線失敗','bad')})};document.getElementById('magicBtn').onclick=function(){var e=$e.value;if(!e)return show('請輸入電子郵件','bad');fetch(B+'/api/auth/magic-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e})}).then(function(r){return r.json()}).then(function(d){show(d.message||'已寄出','ok')}).catch(function(){show('寄送失敗','bad')})}})()</` + `script></body></html>`;
  }

  if (page === "register") {
    return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>註冊 — 課表查詢</title><style>${CSS}</style></head><body><div class="page"><div class="form"><h2>註冊</h2><label>電子郵件</label><input type="email" id="email" placeholder="you@example.com"><label>密碼（選填）</label><input type="password" id="password" placeholder="留空則使用登入連結"><button class="btn pri" id="regBtn">註冊</button><div class="msg" id="msg"></div><div class="switch">已有帳號？<a href="/login" class="link">登入</a></div></div></div><script>(function(){var $e=document.getElementById('email'),$p=document.getElementById('password'),$m=document.getElementById('msg'),B=location.origin;function show(t,c){$m.textContent=t;$m.className='msg '+c}document.getElementById('regBtn').onclick=function(){var e=$e.value;if(!e)return show('請輸入電子郵件','bad');fetch(B+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:$p.value||undefined})}).then(function(r){return r.json().then(function(d){if(r.ok){location.href='/settings'}else show(d.error,'bad')})}).catch(function(){show('註冊失敗','bad')})}})()</` + `script></body></html>`;
  }

  if (page === "settings") {
    return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>設定 — 課表查詢</title><style>${CSS}</style></head><body><div class="page">${NAV}<h2 style="font-size:1.15rem;font-weight:600;margin-bottom:20px">每日課表訂閱</h2><p style="color:var(--tm);font-size:.85rem;margin-bottom:20px">設定後每天 05:30 自動寄送當日課表至 ${user ? user.email : ""}</p><div class="sub-add"><div><label>學期</label><select class="sel" id="aTerm" disabled><option>載入中</option></select></div><div><label>類型</label><select class="sel" id="aType"><option value="class">班級</option><option value="teacher">教師</option><option value="room">教室</option></select></div><div><label>項目</label><select class="sel" id="aItem" disabled><option>請先選學期</option></select></div><div><button class="btn pri" id="addBtn">新增</button></div></div><div class="sub-list" id="subList"></div><div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--bd)"><h2 style="font-size:1.15rem;font-weight:600;margin-bottom:12px">SMTP 測試</h2><p style="color:var(--tm);font-size:.85rem;margin-bottom:12px">寄送測試郵件確認 SMTP 設定是否正常</p><button class="btn ghost" id="testBtn">寄送測試郵件</button><div id="testMsg" style="margin-top:12px;font-size:.85rem"></div></div>${FOOTER}</div><script>(function(){var B=location.origin,tS=document.getElementById('aTerm'),iS=document.getElementById('aItem'),tY=document.getElementById('aType'),sL=document.getElementById('subList'),tM=document.getElementById('testMsg');function J(u){return fetch(u).then(function(r){return r.json()})}function E(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):''}
// Load terms
J(B+'/api/terms').then(function(d){tS.innerHTML='';(d.terms||[]).forEach(function(o){var e=document.createElement('option');e.value=o.value;e.textContent=o.label;tS.appendChild(e)});tS.disabled=false;loadItems()});
tS.onchange=loadItems;tY.onchange=loadItems;
function loadItems(){var t=tS.value;if(!t)return;iS.disabled=true;iS.innerHTML='<option>載入中</option>';var ep={class:'classes',teacher:'teachers',room:'rooms'}[tY.value],lb={class:'班級',teacher:'教師',room:'教室'}[tY.value];J(B+'/api/'+ep+'?term='+encodeURIComponent(t)).then(function(d){var it=d[ep]||[];iS.innerHTML='<option>選擇'+lb+'</option>';it.forEach(function(o){var e=document.createElement('option');e.value=o.value;e.textContent=o.label;iS.appendChild(e)});iS.disabled=false}).catch(function(){iS.innerHTML='<option>失敗</option>'})}
// Load subscriptions
function loadSubs(){J(B+'/api/subscriptions').then(function(d){var subs=d.subscriptions||[];sL.innerHTML='';if(!subs.length){sL.innerHTML='<p style="color:var(--tm);font-size:.85rem;padding:20px 0">尚未新增訂閱</p>';return}subs.forEach(function(s){var div=document.createElement('div');div.className='sub-item';div.innerHTML='<div class="info"><b>'+E(s.label)+'</b><span>'+E(s.term)+'</span></div><div class="actions"><button class="pill '+(s.enabled?'on':'')+'" data-toggle="'+s.id+'">'+(s.enabled?'啟用':'停用')+'</button><button class="pill" data-del="'+s.id+'" style="color:#eb5757">刪除</button></div>';sL.appendChild(div)})})}
loadSubs();
// Add subscription
document.getElementById('addBtn').onclick=function(){var t=tS.value,c=iS.value,l=iS.options[iS.selectedIndex]?iS.options[iS.selectedIndex].text:'',ty=tY.value;if(!c)return;fetch(B+'/api/subscriptions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:ty,code:c,label:l,term:t})}).then(function(){loadSubs()})};
// Toggle/delete
sL.addEventListener('click',function(e){var t=e.target;if(t.dataset.toggle){var id=parseInt(t.dataset.toggle);var isOn=t.classList.contains('on');fetch(B+'/api/subscriptions/'+id+'/toggle',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:isOn?0:1})}).then(function(){loadSubs()})}if(t.dataset.del){fetch(B+'/api/subscriptions/'+t.dataset.del,{method:'DELETE'}).then(function(){loadSubs()})}}});
// Test email
document.getElementById('testBtn').onclick=function(){tM.textContent='寄送中...';tM.style.color='var(--tm)';fetch(B+'/api/test-email',{method:'POST'}).then(function(r){return r.json()}).then(function(d){if(d.success){tM.style.color='#16a34a';tM.textContent='寄送成功！請檢查收件匣。'}else{tM.style.color='#eb5757';tM.textContent='寄送失敗：'+(d.log||[]).slice(-3).join('; ')}}).catch(function(){tM.style.color='#eb5757';tM.textContent='連線失敗'})}})()</` + `script></body></html>`;
  }

  // Default: index (timetable viewer)
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>課表查詢</title><style>${CSS}</style></head><body>
<div class="page">${NAV}
  <div class="filters">
    <select class="sel" id="termSel" disabled><option>載入中...</option></select>
    <div class="sep"></div>
    <button class="pill on" data-view="term">學期</button>
    <button class="pill" data-view="week">每周</button>
    <select class="sel" id="weekSel" disabled style="display:none"><option>選擇周次</option></select>
    <div class="sep"></div>
    <button class="pill on" data-type="class">班級</button>
    <button class="pill" data-type="teacher">教師</button>
    <button class="pill" data-type="room">教室</button>
    <select class="sel" id="itemSel" disabled><option>選擇查詢</option></select>
  </div>
  <div id="main"><div class="empty"><h2>選擇條件開始查詢</h2><p>選取學期與班級、教師或教室</p></div></div>
</div>
<script>
(function(){
var B=location.origin,CT='class',CV='term';
var TL={class:'班級',teacher:'教師',room:'教室'},TE={class:'classes',teacher:'teachers',room:'rooms'};
var tS=document.getElementById('termSel'),wS=document.getElementById('weekSel'),iS=document.getElementById('itemSel');
var mn=document.getElementById('main');
document.querySelectorAll('[data-type]').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('[data-type]').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');CT=b.dataset.type;loadItems();}});
document.querySelectorAll('[data-view]').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('[data-view]').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');CV=b.dataset.view;
  wS.style.display=CV==='week'?'':'none';
  if(CV==='week')loadWeeks();}});
tS.onchange=function(){loadItems();if(CV==='week')loadWeeks()};
iS.onchange=loadTT;wS.onchange=loadTT;
function J(u){return fetch(u).then(function(r){return r.json()})}
function loadTerms(){J(B+'/api/terms').then(function(d){tS.innerHTML='';(d.terms||[]).forEach(function(o){var e=document.createElement('option');e.value=o.value;e.textContent=o.label;tS.appendChild(e)});tS.disabled=false;loadItems()}).catch(function(){tS.innerHTML='<option>失敗</option>'})}
function loadItems(){var t=tS.value;if(!t)return;iS.disabled=true;iS.innerHTML='<option>載入中...</option>';J(B+'/api/'+TE[CT]+'?term='+encodeURIComponent(t)).then(function(d){var it=d[TE[CT]]||[];iS.innerHTML='<option>選擇'+TL[CT]+'</option>';it.forEach(function(o){var e=document.createElement('option');e.value=o.value;e.textContent=o.label;iS.appendChild(e)});iS.disabled=false}).catch(function(){iS.innerHTML='<option>失敗</option>'})}
function loadWeeks(){var t=tS.value;if(!t)return;wS.disabled=true;wS.innerHTML='<option>載入中...</option>';J(B+'/api/weeks?term='+encodeURIComponent(t)).then(function(d){var it=d.weeks||[];wS.innerHTML='<option>選擇周次</option>';it.forEach(function(o){var e=document.createElement('option');e.value=o.value;e.textContent=o.label;wS.appendChild(e)});wS.disabled=false;autoWeek(it)}).catch(function(){wS.innerHTML='<option>失敗</option>'})}
function autoWeek(weeks){var now=new Date();var today=new Date(now.getFullYear(),now.getMonth(),now.getDate());for(var i=0;i<weeks.length;i++){var m=weeks[i].label.match(/(\\d+)\\.(\\d+)\\.(\\d+)[～〜~](\\d+)\\.(\\d+)\\.(\\d+)/);if(!m)continue;var s=new Date(parseInt(m[1],10)+1911,parseInt(m[2],10)-1,parseInt(m[3],10));var e=new Date(parseInt(m[4],10)+1911,parseInt(m[5],10)-1,parseInt(m[6],10));if(today>=s&&today<=e){wS.value=weeks[i].value;return}}}
function loadTT(){var c=iS.value,t=tS.value;if(!c||!t)return;if(CV==='week'&&!wS.value)return;mn.innerHTML='<div class="ld"><div class="sp"></div></div>';var u=B+'/api/timetable?type='+CT+'&code='+encodeURIComponent(c)+'&term='+encodeURIComponent(t);if(CV==='week')u+='&week='+encodeURIComponent(wS.value);J(u).then(function(d){if(d.error){mn.innerHTML='<div class="err">'+E(d.error)+'</div>';return}render(d)}).catch(function(e){mn.innerHTML='<div class="err">'+E(e.message)+'</div>'})}
function render(d){var pp=d.periods||[],ss=d.schedule||[],dd=d.days||['一','二','三','四','五','六'],m={};ss.forEach(function(c){m[c.period+'_'+c.day]=c.courses||[]});var lb=iS.options[iS.selectedIndex]?iS.options[iS.selectedIndex].text:d.code;var h='<div class="head"><h2>'+E(lb)+'</h2>';if(d.term||d.weekNo){h+='<span class="meta">';if(d.term)h+=E(d.term);if(d.weekNo)h+=' · 第'+E(d.weekNo)+'週';h+='</span>'}h+='</div><div class="table-wrap"><table class="tt"><thead><tr><th></th>';dd.forEach(function(x){h+='<th>週'+x+'</th>'});h+='</tr></thead><tbody>';pp.forEach(function(p,pi){var sc=p.section==='morning'?'morning':'afternoon';h+='<tr class="'+sc+'"><td class="per"><b>'+E(p.name)+'</b><i>'+E(p.time)+'</i></td>';for(var di=0;di<6;di++){var k=pi+'_'+di,cs=m[k]||[];h+='<td>';cs.forEach(function(c,i){if(i>0)h+='<div style="height:4px"></div>';h+='<div class="card"><div class="cn">'+E(c.name);if(c.weekType){var cl=c.weekType.indexOf('單')>=0?'o':'e';h+='<span class="tag '+cl+'">'+E(c.weekType)+'</span>'}h+='</div>';var parts=[];if(c.teacher)parts.push(c.teacher);if(c.room)parts.push(c.room);if(parts.length)h+='<div class="cm">'+E(parts.join(' · '))+'</div>';h+='</div>'});h+='</td>'}h+='</tr>'});h+='</tbody></table></div>';mn.innerHTML=h}
function E(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
loadTerms();
})();
if(document.getElementById('logoutBtn'))document.getElementById('logoutBtn').onclick=function(){fetch('/api/auth/logout',{method:'POST'}).then(function(){location.href='/'})};
</` + `script>
</body></html>`;
}

// ──── Auth helper ──
async function getAuthUser(request: Request, env: Env): Promise<JWTPayload | null> {
  const token = getTokenFromCookie(request);
  if (!token) return null;
  return verifyToken(token, env.JWT_SECRET);
}

function jsonWithCookie(data: unknown, cookie: string, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Set-Cookie": cookie,
    },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

// ──── Main request handler ────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Auth routes ──

    // POST /api/auth/register
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      try {
        const body = await request.json() as { email: string; password?: string };
        if (!body.email) return errorResponse("Email required", 400);
        const existing = await getUserByEmail(env.DB, body.email);
        if (existing) return errorResponse("Email already registered", 409);
        const user = await createUser(env.DB, body.email, body.password);
        const token = await signToken({ sub: user.id, email: user.email }, env.JWT_SECRET);
        return jsonWithCookie({ id: user.id, email: user.email }, setCookieHeader(token));
      } catch (e) {
        return errorResponse(`Register failed: ${(e as Error).message}`);
      }
    }

    // POST /api/auth/login
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      try {
        const body = await request.json() as { email: string; password?: string };
        if (!body.email) return errorResponse("Email required", 400);
        const user = await getUserByEmail(env.DB, body.email);
        if (!user) return errorResponse("Account not found", 404);
        if (!user.password_hash) return errorResponse("This account uses magic link login. Use 'Send login link' instead.", 400);
        if (!body.password) return errorResponse("Password required", 400);
        const ok = await verifyPassword(user.password_hash, body.password);
        if (!ok) return errorResponse("Wrong password", 401);
        const token = await signToken({ sub: user.id, email: user.email }, env.JWT_SECRET);
        return jsonWithCookie({ id: user.id, email: user.email }, setCookieHeader(token));
      } catch (e) {
        return errorResponse(`Login failed: ${(e as Error).message}`);
      }
    }

    // POST /api/auth/magic-link
    if (url.pathname === "/api/auth/magic-link" && request.method === "POST") {
      try {
        const body = await request.json() as { email: string };
        if (!body.email) return errorResponse("Email required", 400);
        // Create user if not exists
        let user = await getUserByEmail(env.DB, body.email);
        if (!user) {
          user = await createUser(env.DB, body.email);
        }
        const magicToken = await createMagicLink(env.DB, body.email);
        await sendMagicLinkEmail(env, body.email, magicToken);
        return jsonResponse({ message: "Login link sent to your email" });
      } catch (e) {
        return errorResponse(`Magic link failed: ${(e as Error).message}`);
      }
    }

    // POST /api/test-email (auth required)
    if (url.pathname === "/api/test-email" && request.method === "POST") {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return errorResponse("Unauthorized", 401);
      try {
        const result = await sendTestEmail(env, authUser.email);
        return jsonResponse(result);
      } catch (e) {
        return jsonResponse({ success: false, log: [(e as Error).message] });
      }
    }

    // GET /api/auth/verify-magic?token=xxx
    if (url.pathname === "/api/auth/verify-magic" && request.method === "GET") {
      const token = url.searchParams.get("token");
      if (!token) return errorResponse("Token required", 400);
      const email = await verifyMagicLink(env.DB, token);
      if (!email) return errorResponse("Invalid or expired link", 400);
      const user = await getUserByEmail(env.DB, email);
      if (!user) return errorResponse("User not found", 404);
      const jwt = await signToken({ sub: user.id, email: user.email }, env.JWT_SECRET);
      // Redirect to settings page with cookie set
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/settings",
          "Set-Cookie": setCookieHeader(jwt),
        },
      });
    }

    // POST /api/auth/logout
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return jsonWithCookie({ ok: true }, clearCookieHeader());
    }

    // GET /api/auth/me
    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const user = await getAuthUser(request, env);
      if (!user) return jsonResponse({ user: null });
      return jsonResponse({ user: { id: user.sub, email: user.email } });
    }

    // ── Subscription routes (auth required) ──

    // GET /api/subscriptions
    if (url.pathname === "/api/subscriptions" && request.method === "GET") {
      const user = await getAuthUser(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      const subs = await getSubscriptions(env.DB, user.sub);
      return jsonResponse({ subscriptions: subs });
    }

    // POST /api/subscriptions
    if (url.pathname === "/api/subscriptions" && request.method === "POST") {
      const user = await getAuthUser(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      try {
        const body = await request.json() as { type: string; code: string; label: string; term: string };
        if (!body.type || !body.code || !body.label || !body.term) {
          return errorResponse("Missing required fields", 400);
        }
        await addSubscription(env.DB, user.sub, body.type, body.code, body.label, body.term);
        return jsonResponse({ ok: true }, 201);
      } catch (e) {
        return errorResponse(`Failed: ${(e as Error).message}`);
      }
    }

    // DELETE /api/subscriptions/:id
    if (url.pathname.startsWith("/api/subscriptions/") && request.method === "DELETE") {
      const user = await getAuthUser(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      const id = parseInt(url.pathname.split("/").pop() || "0", 10);
      if (!id) return errorResponse("Invalid id", 400);
      await deleteSubscription(env.DB, id, user.sub);
      return jsonResponse({ ok: true });
    }

    // PATCH /api/subscriptions/:id/toggle
    if (url.pathname.match(/^\/api\/subscriptions\/\d+\/toggle$/) && request.method === "PATCH") {
      const user = await getAuthUser(request, env);
      if (!user) return errorResponse("Unauthorized", 401);
      const id = parseInt(url.pathname.split("/")[3], 10);
      const body = await request.json() as { enabled: number };
      await toggleSubscription(env.DB, id, user.sub, body.enabled);
      return jsonResponse({ ok: true });
    }

    // ── Public API routes (existing) ──

    // Serve frontend
    if (url.pathname === "/" && request.method === "GET") {
      const user = await getAuthUser(request, env);
      return new Response(HTML_PAGE("index", user), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // GET /login
    if (url.pathname === "/login" && request.method === "GET") {
      const user = await getAuthUser(request, env);
      if (user) return new Response(null, { status: 302, headers: { Location: "/settings" } });
      return new Response(HTML_PAGE("login", null), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // GET /register
    if (url.pathname === "/register" && request.method === "GET") {
      const user = await getAuthUser(request, env);
      if (user) return new Response(null, { status: 302, headers: { Location: "/settings" } });
      return new Response(HTML_PAGE("register", null), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // GET /settings
    if (url.pathname === "/settings" && request.method === "GET") {
      const user = await getAuthUser(request, env);
      if (!user) return new Response(null, { status: 302, headers: { Location: "/login" } });
      return new Response(HTML_PAGE("settings", user), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // GET /api - API docs
    if (url.pathname === "/api" && request.method === "GET") {
      return jsonResponse({
        name: "classtable-api",
        version: "2.0.0",
        source: "http://class.ckgsh.ntpc.edu.tw/classtable",
        endpoints: [
          { method: "GET", path: "/api/terms", desc: "List all terms", params: [] },
          { method: "GET", path: "/api/classes", desc: "List classes for a term", params: ["term (e.g. 114,2)"] },
          { method: "GET", path: "/api/teachers", desc: "List teachers for a term", params: ["term"] },
          { method: "GET", path: "/api/rooms", desc: "List rooms for a term", params: ["term"] },
          { method: "GET", path: "/api/weeks", desc: "List weeks for a term", params: ["term"] },
          { method: "GET", path: "/api/timetable", desc: "Get timetable data", params: ["type (class|teacher|room)", "code", "term", "week (optional)"] },
          { method: "GET", path: "/api/health", desc: "Health check", params: [] },
          { method: "POST", path: "/api/auth/register", desc: "Register", params: ["email", "password (optional)"] },
          { method: "POST", path: "/api/auth/login", desc: "Login with password", params: ["email", "password"] },
          { method: "POST", path: "/api/auth/magic-link", desc: "Send magic link login", params: ["email"] },
          { method: "GET", path: "/api/auth/me", desc: "Current user", params: [] },
          { method: "POST", path: "/api/auth/logout", desc: "Logout", params: [] },
          { method: "GET", path: "/api/subscriptions", desc: "List subscriptions (auth)", params: [] },
          { method: "POST", path: "/api/subscriptions", desc: "Add subscription (auth)", params: ["type", "code", "label", "term"] },
          { method: "DELETE", path: "/api/subscriptions/:id", desc: "Delete subscription (auth)", params: [] },
        ],
      });
    }

    // GET /api/terms
    if (url.pathname === "/api/terms") {
      try {
        const cookie = await getSession();
        const { html } = await fetchPage("top.asp", cookie);
        return jsonResponse({ terms: parseTerms(html) });
      } catch (e) {
        return errorResponse(`Failed to fetch terms: ${(e as Error).message}`);
      }
    }

    // GET /api/classes
    if (url.pathname === "/api/classes") {
      try {
        const cookie = await getSession();
        const { html } = await fetchPage("top.asp", cookie);
        return jsonResponse({ classes: parseClasses(html) });
      } catch (e) {
        return errorResponse(`Failed: ${(e as Error).message}`);
      }
    }

    // GET /api/teachers
    if (url.pathname === "/api/teachers") {
      try {
        const cookie = await getSession();
        const { html } = await fetchPage("top.asp", cookie);
        return jsonResponse({ teachers: parseTeachers(html) });
      } catch (e) {
        return errorResponse(`Failed: ${(e as Error).message}`);
      }
    }

    // GET /api/rooms
    if (url.pathname === "/api/rooms") {
      try {
        const cookie = await getSession();
        const { html } = await fetchPage("top.asp", cookie);
        return jsonResponse({ rooms: parseRooms(html) });
      } catch (e) {
        return errorResponse(`Failed: ${(e as Error).message}`);
      }
    }

    // GET /api/weeks?term=114,2
    if (url.pathname === "/api/weeks") {
      try {
        const cookie = await getSession();
        const { html } = await fetchPage("top.asp", cookie);
        return jsonResponse({ weeks: parseWeeks(html) });
      } catch (e) {
        return errorResponse(`Failed: ${(e as Error).message}`);
      }
    }

    // GET /api/timetable?type=class&code=101&term=114,2[&week=8]
    if (url.pathname === "/api/timetable") {
      try {
        const type = url.searchParams.get("type") || "class";
        const code = url.searchParams.get("code") || "";
        const term = url.searchParams.get("term") || "114,2";
        const week = url.searchParams.get("week") || "";

        if (!code) return errorResponse("Missing 'code' parameter", 400);

        const cookie = await getSession();

        let downPath: string;
        if (week) {
          downPath =
            `down.asp?sqlstr=${encodeURIComponent(code)}` +
            `&type=${encodeURIComponent(type)}` +
            `&class=week&weekno=${encodeURIComponent(week)}` +
            `&selArrange=L&selWindow=Left` +
            `&yt=${encodeURIComponent(term)}`;
        } else {
          downPath =
            `down.asp?sqlstr=${encodeURIComponent(code)}` +
            `&type=${encodeURIComponent(type)}` +
            `&selArrange=L&selWindow=Left` +
            `&yt=${encodeURIComponent(term)}`;
        }

        const { html } = await fetchPage(downPath, cookie);
        const timetable = parseTimetable(html);

        if (!timetable) {
          return errorResponse("Failed to parse timetable from source", 502);
        }

        timetable.term = term;
        timetable.type = type;
        timetable.code = code;
        if (week) timetable.weekNo = week;

        return jsonResponse(timetable);
      } catch (e) {
        return errorResponse(
          `Failed to fetch timetable: ${(e as Error).message}`
        );
      }
    }

    // Health check
    if (url.pathname === "/api/health") {
      return jsonResponse({ status: "ok", time: new Date().toISOString() });
    }

    return errorResponse("Not found", 404);
  },

  // ── Cron handler: daily email ──
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const subs = await getAllActiveSubscriptions(env.DB);
    const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon...
    const dayIndex = dayOfWeek === 0 ? -1 : dayOfWeek - 1; // Mon=0..Sat=5

    // Get today's day label
    const DAY_LABELS = ["一", "二", "三", "四", "五", "六"];
    if (dayIndex < 0 || dayIndex > 5) return; // No school on Sunday

    // Group subscriptions by (type, code, term) to avoid duplicate fetches
    const fetchMap = new Map<string, { subs: typeof subs; label: string }>();
    for (const sub of subs) {
      const key = `${sub.type}:${sub.code}:${sub.term}`;
      if (!fetchMap.has(key)) {
        fetchMap.set(key, { subs: [], label: sub.label });
      }
      fetchMap.get(key)!.subs.push(sub);
    }

    for (const [key, group] of fetchMap) {
      try {
        const [type, code, term] = key.split(":");
        const cookie = await getSession();
        const downPath =
          `down.asp?sqlstr=${encodeURIComponent(code)}` +
          `&type=${encodeURIComponent(type)}` +
          `&selArrange=L&selWindow=Left` +
          `&yt=${encodeURIComponent(term)}`;
        const { html } = await fetchPage(downPath, cookie);
        const timetable = parseTimetable(html);
        if (!timetable) continue;

        // Extract today's courses
        const todayCourses: { period: string; time: string; items: CourseInfo[] }[] = [];
        for (let p = 0; p < timetable.periods.length; p++) {
          const cell = timetable.schedule.find(
            (s) => s.period === p && s.day === dayIndex
          );
          todayCourses.push({
            period: timetable.periods[p].name,
            time: timetable.periods[p].time,
            items: cell ? cell.courses : [],
          });
        }

        // Send to each subscribed user
        for (const sub of group.subs) {
          try {
            await sendDailyEmail(env, sub.email, group.label, todayCourses);
          } catch (e) {
            console.error(`Email failed for ${sub.email}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        console.error(`Fetch failed for ${key}: ${(e as Error).message}`);
      }
    }
  },
};
