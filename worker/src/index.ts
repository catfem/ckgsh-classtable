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

// Parse timetable from down.asp HTML
// The HTML table uses rowspan for 上午/下午 labels, so we need a grid-based approach
function parseTimetable(html: string): TimetableResponse | null {
  // Extract title
  const titleMatch = html.match(
    /<span[^>]*class="view_title"[^>]*>([^<]+)<\/span>/
  );
  const title = titleMatch ? titleMatch[1].trim() : "課表";

  // Find the main table
  const tableMatch = html.match(
    /<table[^>]*class="classTable"[^>]*>([\s\S]*?)<\/table>/i
  );
  if (!tableMatch) return null;

  const tableHtml = tableMatch[1];

  // Build a 2D grid by parsing all rows and handling colspan/rowspan
  const grid: string[][] = [];
  const rowSpans: number[][] = []; // track which cells are occupied by rowspan

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let rowIndex = 0;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    if (!grid[rowIndex]) {
      grid[rowIndex] = [];
      rowSpans[rowIndex] = [];
    }

    // Find the next available column (accounting for rowspan from previous rows)
    let col = 0;
    while (rowSpans[rowIndex] && rowSpans[rowIndex][col]) {
      col++;
    }

    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      // Get colspan and rowspan from the td tag
      const tdTag = cellMatch[0].match(/<td([^>]*)>/i);
      const colspan = tdTag
        ? parseInt(tdTag[1].match(/colspan="(\d+)"/i)?.[1] || "1", 10)
        : 1;
      const rowspan = tdTag
        ? parseInt(tdTag[1].match(/rowspan="(\d+)"/i)?.[1] || "1", 10)
        : 1;

      const cellContent = cellMatch[1];

      // Place cell in grid, spanning as needed
      for (let c = 0; c < colspan; c++) {
        // Find next available column
        while (rowSpans[rowIndex] && rowSpans[rowIndex][col]) {
          col++;
        }

        if (!grid[rowIndex]) grid[rowIndex] = [];
        grid[rowIndex][col] = c === 0 ? cellContent : "";

        // Mark rows below as occupied by this rowspan
        for (let r = 1; r < rowspan; r++) {
          const targetRow = rowIndex + r;
          if (!rowSpans[targetRow]) rowSpans[targetRow] = [];
          rowSpans[targetRow][col] = 1;
        }

        col++;
      }
    }

    rowIndex++;
  }

  // Now extract the schedule from the grid
  // Row 0: title (colspan=9)
  // Row 1: headers (空, 空, 空, 一, 二, 三, 四, 五, 六) = 9 cols
  // Rows 2+: data rows with section header (rowspan=5 for 上午, rowspan=5 for 下午)
  //   Each data row has: timeHeader, periodName, then 6 day cells
  //   So data rows have columns: [上午/下午] (from rowspan), time, period, mon, tue, wed, thu, fri, sat

  const schedule: ScheduleCell[] = [];
  let periodIndex = 0;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;

    // Find tdColumn cells in this row
    const dayCells: { col: number; html: string }[] = [];
    let hasDataCells = false;

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell && cell.includes("tdColumn")) {
        dayCells.push({ col: c, html: cell });
        hasDataCells = true;
      }
    }

    if (!hasDataCells) continue;

    // This is a period row - extract courses for each day
    // dayCells should have 6 entries (Mon-Sat)
    for (let d = 0; d < dayCells.length && d < 6; d++) {
      const courses = parseCellCourses(dayCells[d].html);
      schedule.push({
        period: periodIndex,
        day: d,
        courses,
      });
    }

    // Fill in any missing days
    for (let d = dayCells.length; d < 6; d++) {
      schedule.push({
        period: periodIndex,
        day: d,
        courses: [],
      });
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
  <title>課表查詢系統</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--pri:#4f46e5;--pri-l:#818cf8;--pri-d:#3730a3;--bg:#f8fafc;--sf:#fff;--bd:#e2e8f0;--tx:#1e293b;--tm:#64748b;--am:#dbeafe;--pm:#fef3c7;--r:12px}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif;background:var(--bg);color:var(--tx);min-height:100vh}
    header{background:linear-gradient(135deg,var(--pri),var(--pri-d));color:#fff;padding:20px 24px;box-shadow:0 4px 20px rgba(79,70,229,.3)}
    header h1{font-size:1.5rem;font-weight:700}
    header p{font-size:.85rem;opacity:.8;margin-top:4px}
    .bar{background:var(--sf);border-bottom:1px solid var(--bd);padding:16px 24px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
    .cg{display:flex;flex-direction:column;gap:4px}
    .cg label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--tm)}
    select{appearance:none;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px 32px 8px 12px;font-size:.9rem;color:var(--tx);cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;min-width:130px;transition:border-color .15s}
    select:focus{outline:none;border-color:var(--pri-l);box-shadow:0 0 0 3px rgba(79,70,229,.1)}
    select:disabled{opacity:.5;cursor:not-allowed}
    .tabs{display:flex;gap:4px;background:var(--bg);border-radius:8px;padding:3px}
    .tab{padding:6px 14px;border-radius:6px;border:none;background:0 0;font-size:.85rem;font-weight:500;color:var(--tm);cursor:pointer;transition:all .15s}
    .tab.active{background:var(--pri);color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)}
    .tab:hover:not(.active){color:var(--tx);background:var(--bd)}
    .main{padding:24px;max-width:1200px;margin:0 auto}
    .empty{text-align:center;padding:80px 24px;color:var(--tm)}
    .empty .ic{font-size:3rem;margin-bottom:16px}
    .empty h2{font-size:1.2rem;color:var(--tx);margin-bottom:8px}
    .tt{font-size:1.1rem;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .badge{font-size:.75rem;background:var(--pri);color:#fff;padding:2px 10px;border-radius:20px;font-weight:500}
    .wrap{overflow-x:auto;border-radius:var(--r);box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04)}
    table.t{width:100%;border-collapse:collapse;background:var(--sf);min-width:700px}
    table.t th{background:var(--pri);color:#fff;padding:12px 8px;font-size:.85rem;font-weight:600}
    table.t td{border:1px solid var(--bd);padding:8px;vertical-align:top;font-size:.82rem;height:72px}
    table.t tr:hover>td{background:#f1f5f9}
    .pc{background:var(--bg);font-weight:600;text-align:center;vertical-align:middle;font-size:.78rem;color:var(--tm);width:88px}
    .pc .pn{display:block;color:var(--tx);font-size:.82rem}
    .pc .pt{display:block;font-size:.7rem;color:var(--tm);margin-top:2px}
    .am .pc{background:var(--am)}
    .pm .pc{background:var(--pm)}
    .cc{background:#fff;border-left:3px solid var(--pri);border-radius:6px;padding:6px 8px;margin-bottom:4px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    .cc:last-child{margin-bottom:0}
    .cn{font-weight:600;color:var(--pri-d);font-size:.82rem;line-height:1.3}
    .cm{font-size:.72rem;color:var(--tm);margin-top:2px}
    .cm span{margin-right:8px}
    .wt{display:inline-block;font-size:.65rem;padding:1px 6px;border-radius:10px;font-weight:500}
    .wt.o{background:#fce7f3;color:#be185d}
    .wt.e{background:#d1fae5;color:#065f46}
    .ld{display:flex;justify-content:center;align-items:center;padding:60px}
    .sp{width:36px;height:36px;border:3px solid var(--bd);border-top-color:var(--pri);border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .err{background:#fef2f2;color:#dc2626;padding:16px 20px;border-radius:var(--r);border:1px solid #fecaca;font-size:.9rem}
    .view-tabs{display:flex;gap:4px;background:var(--bg);border-radius:8px;padding:3px}
    .vt{padding:6px 14px;border-radius:6px;border:none;background:0 0;font-size:.85rem;font-weight:500;color:var(--tm);cursor:pointer;transition:all .15s}
    .vt.active{background:#059669;color:#fff;box-shadow:0 2px 8px rgba(5,150,105,.3)}
    .vt:hover:not(.vt.active){color:var(--tx);background:var(--bd)}
    @media(max-width:640px){.bar{padding:12px 16px}.main{padding:16px}select{min-width:100px;font-size:.85rem}}
  </style>
</head>
<body>
<header><h1>課表查詢系統</h1><p>崇光國民中學 課表查詢</p></header>
<div class="bar">
  <div class="cg"><label>學期</label><select id="termSel" disabled><option>載入中...</option></select></div>
  <div class="cg"><label>視圖</label><div class="view-tabs"><button class="vt active" data-view="term">學期課表</button><button class="vt" data-view="week">每周課表</button></div></div>
  <div class="cg" id="weekGrp" style="display:none"><label>周次</label><select id="weekSel" disabled><option>請先選擇學期</option></select></div>
  <div class="cg"><label>查詢</label><div class="tabs"><button class="tab active" data-type="class">班級</button><button class="tab" data-type="teacher">教師</button><button class="tab" data-type="room">教室</button></div></div>
  <div class="cg"><label id="sLbl">選擇班級</label><select id="itemSel" disabled><option>請先選擇學期</option></select></div>
</div>
<div class="main" id="main"><div class="empty"><div class="ic">&#128218;</div><h2>選擇查詢條件</h2><p>請先選擇學期，再選擇班級、教師或教室</p></div></div>
<script>
(function(){
var BASE=location.origin,curType='class',curView='term';
var tL={class:'班級',teacher:'教師',room:'教室'},tE={class:'classes',teacher:'teachers',room:'rooms'};
var $t=document.getElementById('termSel'),$w=document.getElementById('weekSel'),$i=document.getElementById('itemSel');
var $sl=document.getElementById('sLbl'),$m=document.getElementById('main'),$wg=document.getElementById('weekGrp');

document.querySelectorAll('.tab').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});
  b.classList.add('active');curType=b.dataset.type;$sl.textContent='選擇'+tL[curType];loadItems();
}});
document.querySelectorAll('.vt').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('.vt').forEach(function(x){x.classList.remove('active')});
  b.classList.add('active');curView=b.dataset.view;
  $wg.style.display=curView==='week'?'':'none';
  if(curView==='week')loadWeeks();
}});
$t.onchange=function(){loadItems();if(curView==='week')loadWeeks()};
$i.onchange=loadTT;

function fetchJSON(u){return fetch(u).then(function(r){return r.json()})}

function loadTerms(){
  fetchJSON(BASE+'/api/terms').then(function(d){
    $t.innerHTML='';
    (d.terms||[]).forEach(function(o){
      var e=document.createElement('option');e.value=o.value;e.textContent=o.label;$t.appendChild(e);
    });
    $t.disabled=false;loadItems();
  }).catch(function(){$t.innerHTML='<option>載入失敗</option>'});
}

function loadItems(){
  var term=$t.value;if(!term)return;
  $i.disabled=true;$i.innerHTML='<option>載入中...</option>';
  var ep=tE[curType];
  fetchJSON(BASE+'/api/'+ep+'?term='+encodeURIComponent(term)).then(function(d){
    var items=d[ep]||[];$i.innerHTML='<option>請選擇'+tL[curType]+'</option>';
    items.forEach(function(o){var e=document.createElement('option');e.value=o.value;e.textContent=o.label;$i.appendChild(e)});
    $i.disabled=false;
  }).catch(function(){$i.innerHTML='<option>載入失敗</option>'});
}

function loadWeeks(){
  var term=$t.value;if(!term)return;
  $w.disabled=true;$w.innerHTML='<option>載入中...</option>';
  fetchJSON(BASE+'/api/weeks?term='+encodeURIComponent(term)).then(function(d){
    var items=d.weeks||[];$w.innerHTML='<option>請選擇周次</option>';
    items.forEach(function(o){var e=document.createElement('option');e.value=o.value;e.textContent=o.label;$w.appendChild(e)});
    $w.disabled=false;
  }).catch(function(){$w.innerHTML='<option>載入失敗</option>'});
}

function loadTT(){
  var code=$i.value,term=$t.value;
  if(!code||!term)return;
  if(curView==='week'&&!$w.value){return}
  $m.innerHTML='<div class="ld"><div class="sp"></div></div>';
  var u=BASE+'/api/timetable?type='+curType+'&code='+encodeURIComponent(code)+'&term='+encodeURIComponent(term);
  if(curView==='week')u+='&week='+encodeURIComponent($w.value);
  fetchJSON(u).then(function(d){
    if(d.error){$m.innerHTML='<div class="err">'+d.error+'</div>';return}
    render(d);
  }).catch(function(e){$m.innerHTML='<div class="err">載入失敗：'+e.message+'</div>'});
}

function render(data){
  var pp=data.periods||[],ss=data.schedule||[],dd=data.days||['一','二','三','四','五','六'],map={};
  ss.forEach(function(c){map[c.period+'_'+c.day]=c.courses||[]});
  var lbl=$i.options[$i.selectedIndex]?( $i.options[$i.selectedIndex].text):data.code;
  var h='<div class="tt">'+esc(lbl)+' 課表';
  if(data.term)h+=' <span class="badge">'+esc(data.term)+'</span>';
  if(data.weekNo)h+=' <span class="badge" style="background:#059669">第'+esc(data.weekNo)+'周</span>';
  h+='</div><div class="wrap"><table class="t"><thead><tr><th>節次</th>';
  dd.forEach(function(d){h+='<th>星期'+d+'</th>'});
  h+='</tr></thead><tbody>';
  pp.forEach(function(p,pi){
    var sc=p.section==='morning'?'am':'pm';
    h+='<tr class="'+sc+'"><td class="pc"><span class="pn">'+esc(p.name)+'</span><span class="pt">'+esc(p.time)+'</span></td>';
    for(var d=0;d<6;d++){
      var k=pi+'_'+d,cs=map[k]||[];
      h+='<td>';
      cs.forEach(function(c){
        h+='<div class="cc"><div class="cn">'+esc(c.name)+'</div><div class="cm">';
        if(c.teacher)h+='<span>'+esc(c.teacher)+'</span>';
        if(c.room)h+='<span>'+esc(c.room)+'</span>';
        if(c.weekType){var cl=c.weekType.indexOf('單')>=0?'o':'e';h+='<span class="wt '+cl+'">'+esc(c.weekType)+'</span>'}
        h+='</div></div>';
      });
      h+='</td>';
    }
    h+='</tr>';
  });
  h+='</tbody></table></div>';
  $m.innerHTML=h;
}

function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
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
