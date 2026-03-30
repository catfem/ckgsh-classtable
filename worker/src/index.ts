const SOURCE_BASE = "http://class.ckgsh.ntpc.edu.tw/classtable";

interface Env {
  SOURCE_BASE_URL: string;
}

interface CourseInfo {
  name: string;
  teacher: string | null;
  room: string | null;
  weekType: string | null;
}

interface ScheduleCell {
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

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
const HTML = /*html*/ `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>課表查詢</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#fff;--tx:#37352f;--tm:#9b9a97;--bd:#e9e9e7;--br:#f7f6f3;--ho:#f1f1ef;--ac:#2eaadc;--am:#fff8e1;--pm:#f3e8fd;--r:4px}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","Helvetica Neue",sans-serif;background:var(--bg);color:var(--tx);line-height:1.5;-webkit-font-smoothing:antialiased}
    
    .page{max-width:960px;margin:0 auto;padding:48px 24px 120px}
    
    .title{font-size:2rem;font-weight:700;letter-spacing:-.03em;margin-bottom:4px}
    .subtitle{color:var(--tm);font-size:.875rem;margin-bottom:36px}
    
    /* Filter row */
    .filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px;align-items:center}
    
    .pill{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;border:none;background:var(--br);color:var(--tx);font-size:.8rem;cursor:pointer;transition:background .12s;font-family:inherit}
    .pill:hover{background:var(--ho)}
    .pill.on{background:var(--tx);color:#fff}
    
    .sel{appearance:none;border:none;background:var(--br);border-radius:var(--r);padding:5px 26px 5px 10px;font-size:.8rem;color:var(--tx);cursor:pointer;font-family:inherit;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%239b9a97' d='M5 7L0 2h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;transition:background .12s;max-width:200px}
    .sel:hover{background:var(--ho)}
    .sel:focus{outline:2px solid var(--ac);outline-offset:-2px}
    .sel:disabled{opacity:.4}
    .sel option{font-size:.8rem}
    
    .sep{width:1px;height:20px;background:var(--bd);margin:0 4px}
    
    /* Table */
    .table-wrap{overflow-x:auto;margin-top:20px}
    
    .tt{width:100%;border-collapse:collapse;font-size:.8rem;table-layout:fixed}
    .tt th{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--bd);padding:8px 6px;text-align:center;font-weight:500;color:var(--tm);font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;z-index:1}
    .tt th:first-child{width:64px}
    
    .tt td{border-bottom:1px solid var(--br);padding:6px 8px;vertical-align:top;height:72px;transition:background .08s;overflow:hidden}
    .tt tr:hover td{background:var(--br)}
    
    .per{text-align:center;white-space:nowrap;color:var(--tm);font-size:.75rem;padding:8px 2px}
    .per b{display:block;color:var(--tx);font-weight:600;font-size:.78rem}
    .per i{display:block;font-style:normal;font-size:.68rem;color:var(--tm);margin-top:1px}
    
    .morning td:first-child{background:transparent}
    .afternoon td:first-child{background:transparent}
    
    /* Course card */
    .card{padding:4px 0;border-bottom:1px solid transparent}
    .card:last-child{border-bottom:none}
    .card+.card{margin-top:4px}
    .cn{font-weight:600;font-size:.78rem;line-height:1.3}
    .cm{font-size:.68rem;color:var(--tm);margin-top:1px}
    .tag{display:inline;font-size:.65rem;padding:1px 5px;border-radius:3px;font-weight:500;margin-left:4px}
    .tag.o{background:#fff3e0;color:#e65100}
    .tag.e{background:#e8f5e9;color:#2e7d32}
    
    /* States */
    .empty{text-align:center;padding:100px 20px;color:var(--tm)}
    .empty h2{font-size:1.1rem;font-weight:500;color:var(--tx);margin-bottom:6px}
    .empty p{font-size:.85rem}
    .ld{display:flex;justify-content:center;padding:80px}
    .sp{width:24px;height:24px;border:2px solid var(--bd);border-top-color:var(--tx);border-radius:50%;animation:spin .6s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .err{color:#eb5757;font-size:.85rem;padding:12px 0}
    
    /* Header line */
    .head{display:flex;align-items:baseline;gap:12px;margin-bottom:28px;flex-wrap:wrap}
    .head h2{font-size:1.15rem;font-weight:600;letter-spacing:-.02em}
    .head .meta{font-size:.75rem;color:var(--tm)}
    
    @media(max-width:640px){
      .page{padding:24px 16px 80px}
      .title{font-size:1.5rem}
      .filters{gap:6px}
      .sel{font-size:.75rem;max-width:140px}
      .tt{font-size:.75rem}
      .tt th,.tt td{padding:4px 8px}
    }
  </style>
</head>
<body>
<div class="page">
  <h1 class="title">課表查詢</h1>
  <p class="subtitle">崇光國民中學</p>
  
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
  b.classList.add('on');CT=b.dataset.type;loadItems();
}});
document.querySelectorAll('[data-view]').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('[data-view]').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');CV=b.dataset.view;
  wS.style.display=CV==='week'?'':'none';
  if(CV==='week')loadWeeks();
}});
tS.onchange=function(){loadItems();if(CV==='week')loadWeeks()};
iS.onchange=loadTT;
wS.onchange=loadTT;

function J(u){return fetch(u).then(function(r){return r.json()})}

function loadTerms(){
  J(B+'/api/terms').then(function(d){
    tS.innerHTML='';(d.terms||[]).forEach(function(o){
      var e=document.createElement('option');e.value=o.value;e.textContent=o.label;tS.appendChild(e);
    });tS.disabled=false;loadItems();
  }).catch(function(){tS.innerHTML='<option>失敗</option>'});
}

function loadItems(){
  var t=tS.value;if(!t)return;
  iS.disabled=true;iS.innerHTML='<option>載入中...</option>';
  J(B+'/api/'+TE[CT]+'?term='+encodeURIComponent(t)).then(function(d){
    var it=d[TE[CT]]||[];iS.innerHTML='<option>選擇'+TL[CT]+'</option>';
    it.forEach(function(o){var e=document.createElement('option');e.value=o.value;e.textContent=o.label;iS.appendChild(e)});
    iS.disabled=false;
  }).catch(function(){iS.innerHTML='<option>失敗</option>'});
}

function loadWeeks(){
  var t=tS.value;if(!t)return;
  wS.disabled=true;wS.innerHTML='<option>載入中...</option>';
  J(B+'/api/weeks?term='+encodeURIComponent(t)).then(function(d){
    var it=d.weeks||[];wS.innerHTML='<option>選擇周次</option>';
    it.forEach(function(o){var e=document.createElement('option');e.value=o.value;e.textContent=o.label;wS.appendChild(e)});
    wS.disabled=false;
    autoWeek(it);
  }).catch(function(){wS.innerHTML='<option>失敗</option>'});
}

function autoWeek(weeks){
  var now=new Date();var today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  for(var i=0;i<weeks.length;i++){
    var m=weeks[i].label.match(/(\\d+)\\.(\\d+)\\.(\\d+)[～〜~](\\d+)\\.(\\d+)\\.(\\d+)/);
    if(!m)continue;
    var s=new Date(parseInt(m[1],10)+1911,parseInt(m[2],10)-1,parseInt(m[3],10));
    var e=new Date(parseInt(m[4],10)+1911,parseInt(m[5],10)-1,parseInt(m[6],10));
    if(today>=s&&today<=e){wS.value=weeks[i].value;return}
  }
}

function loadTT(){
  var c=iS.value,t=tS.value;if(!c||!t)return;
  if(CV==='week'&&!wS.value)return;
  mn.innerHTML='<div class="ld"><div class="sp"></div></div>';
  var u=B+'/api/timetable?type='+CT+'&code='+encodeURIComponent(c)+'&term='+encodeURIComponent(t);
  if(CV==='week')u+='&week='+encodeURIComponent(wS.value);
  J(u).then(function(d){
    if(d.error){mn.innerHTML='<div class="err">'+E(d.error)+'</div>';return}
    render(d);
  }).catch(function(e){mn.innerHTML='<div class="err">'+E(e.message)+'</div>'});
}

function render(d){
  var pp=d.periods||[],ss=d.schedule||[],dd=d.days||['一','二','三','四','五','六'],m={};
  ss.forEach(function(c){m[c.period+'_'+c.day]=c.courses||[]});
  var lb=iS.options[iS.selectedIndex]?iS.options[iS.selectedIndex].text:d.code;
  var h='<div class="head"><h2>'+E(lb)+'</h2>';
  if(d.term||d.weekNo){
    h+='<span class="meta">';
    if(d.term)h+=E(d.term);
    if(d.weekNo)h+=' · 第'+E(d.weekNo)+'週';
    h+='</span>';
  }
  h+='</div><div class="table-wrap"><table class="tt"><thead><tr><th></th>';
  dd.forEach(function(x){h+='<th>週'+x+'</th>'});
  h+='</tr></thead><tbody>';
  pp.forEach(function(p,pi){
    var sc=p.section==='morning'?'morning':'afternoon';
    h+='<tr class="'+sc+'"><td class="per"><b>'+E(p.name)+'</b><i>'+E(p.time)+'</i></td>';
    for(var di=0;di<6;di++){
      var k=pi+'_'+di,cs=m[k]||[];
      h+='<td>';
      cs.forEach(function(c,i){
        if(i>0)h+='<div style="height:4px"></div>';
        h+='<div class="card"><div class="cn">'+E(c.name);
        if(c.weekType){var cl=c.weekType.indexOf('單')>=0?'o':'e';h+='<span class="tag '+cl+'">'+E(c.weekType)+'</span>'}
        h+='</div>';
        var parts=[];
        if(c.teacher)parts.push(c.teacher);
        if(c.room)parts.push(c.room);
        if(parts.length)h+='<div class="cm">'+E(parts.join(' · '))+'</div>';
        h+='</div>';
      });
      h+='</td>';
    }
    h+='</tr>';
  });
  h+='</tbody></table></div>';
  mn.innerHTML=h;
}

function E(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
loadTerms();
})();
<` + `/script>
</body>
</html>`;

// ──── Main request handler ────
export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Serve frontend
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
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

        // Establish session first
        const cookie = await getSession();

        let downPath: string;
        if (week) {
          // Weekly timetable
          downPath =
            `down.asp?sqlstr=${encodeURIComponent(code)}` +
            `&type=${encodeURIComponent(type)}` +
            `&class=week&weekno=${encodeURIComponent(week)}` +
            `&selArrange=L&selWindow=Left` +
            `&yt=${encodeURIComponent(term)}`;
        } else {
          // Term timetable
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
};
