// BIG5 to Unicode mapping table (partial - covers common CJK characters)
// We use TextDecoder with 'big5' encoding if available, otherwise fallback

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
}

interface Option {
  value: string;
  label: string;
}

// CORS headers
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

// Decode BIG5 bytes to UTF-8 string
function decodeBig5(buffer: ArrayBuffer): string {
  try {
    const decoder = new TextDecoder("big5");
    return decoder.decode(buffer);
  } catch {
    // Fallback: try utf-8 (may have garbled text but won't crash)
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(buffer);
  }
}

// Fetch a page from the source site and decode from BIG5
async function fetchSourcePage(
  path: string,
  cookie?: string
): Promise<string> {
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

  const response = await fetch(url, { headers });
  const buffer = await response.arrayBuffer();
  return decodeBig5(buffer);
}

// Parse term options from top.asp
function parseTerms(html: string): Option[] {
  const options: Option[] = [];
  const regex = /<option\s+value="([^"]*)"[^>]*>([^<]+)<\/option>/g;
  let match;

  // Find the term dropdown (ddlTerm)
  const ddlTermSection = html.match(
    /<select[^>]*id="ddlTerm"[^>]*>([\s\S]*?)<\/select>/
  );
  if (!ddlTermSection) return options;

  while ((match = regex.exec(ddlTermSection[1])) !== null) {
    if (match[1] && match[1] !== "") {
      options.push({ value: match[1], label: match[2].trim() });
    }
  }
  return options;
}

// Parse class options from top.asp (s1 dropdown)
function parseClasses(html: string): Option[] {
  const options: Option[] = [];
  const s1Section = html.match(
    /<select[^>]*id="s1"[^>]*>([\s\S]*?)<\/select>/
  );
  if (!s1Section) return options;

  const regex = /<option\s+value="([^"]*)"[^>]*>([^<]+)<\/option>/g;
  let match;
  while ((match = regex.exec(s1Section[1])) !== null) {
    if (match[1] && match[1] !== "aaa") {
      options.push({ value: match[1], label: match[2].trim() });
    }
  }
  return options;
}

// Parse teacher options from top.asp (s2 dropdown)
function parseTeachers(html: string): Option[] {
  const options: Option[] = [];
  const s2Section = html.match(
    /<select[^>]*id="s2"[^>]*>([\s\S]*?)<\/select>/
  );
  if (!s2Section) return options;

  const regex = /<option\s+value="([^"]*)"[^>]*>([^<]+)<\/option>/g;
  let match;
  while ((match = regex.exec(s2Section[1])) !== null) {
    if (match[1] && match[1] !== "aaa") {
      options.push({ value: match[1], label: match[2].trim() });
    }
  }
  return options;
}

// Parse room options from top.asp (s3 dropdown)
function parseRooms(html: string): Option[] {
  const options: Option[] = [];
  const s3Section = html.match(
    /<select[^>]*id="s3"[^>]*>([\s\S]*?)<\/select>/
  );
  if (!s3Section) return options;

  const regex = /<option\s+value="([^"]*)"[^>]*>([^<]+)<\/option>/g;
  let match;
  while ((match = regex.exec(s3Section[1])) !== null) {
    if (match[1] && match[1] !== "aaa") {
      options.push({ value: match[1], label: match[2].trim() });
    }
  }
  return options;
}

// Period schedule definitions
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

// Parse timetable from down.asp HTML
function parseTimetable(html: string): TimetableResponse | null {
  // Extract title
  const titleMatch = html.match(
    /<span[^>]*class="view_title"[^>]*>([^<]+)<\/span>/
  );
  const title = titleMatch ? titleMatch[1].trim() : "課表";

  // Find the main table
  const tableMatch = html.match(
    /<table[^>]*class="classTable"[^>]*>([\s\S]*?)<\/table>/
  );
  if (!tableMatch) return null;

  const tableHtml = tableMatch[1];

  // Parse rows
  const rows: string[][] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  // Parse schedule from rows
  // The table structure:
  // Row 0: Title (colspan=9)
  // Row 1: Headers (空, 空, 空, 一, 二, 三, 四, 五, 六)
  // Row 2-6: Morning periods (早自習, 1-4節)
  // Row 7: Separator
  // Row 8-12: Afternoon periods (5-9節)

  const schedule: ScheduleCell[] = [];

  // We need to handle rowspan for the 上午/下午 labels
  // Each period row should have 6 day cells (Mon-Sat)
  // Some cells may be empty (&nbsp;)

  // Skip header rows (title + day headers) and separator
  // Process data rows (rows with tdColumn class cells)
  let periodIndex = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Skip title row, header row, and separator rows
    if (row.length <= 3 && !row.some((c) => c.includes("tdColumn"))) continue;
    if (row.some((c) => c.includes("separator"))) continue;
    if (row.some((c) => c.includes("tdHeader") && !c.includes("tdHeader2") && !c.includes("tdHeader3")) && row.length <= 3) continue;

    // Check if this is a data row (has tdColumn cells)
    const dataCells = row.filter((c) => c.includes("tdColumn"));
    if (dataCells.length === 0) continue;

    // This is a period row - extract courses for each day
    const dayCourses: CourseInfo[][] = DAYS.map(() => []);

    // Find day cells (not header cells)
    let dayIdx = 0;
    for (const cell of row) {
      if (!cell.includes("tdColumn")) continue;
      if (dayIdx >= 6) break;

      const courses = parseCellCourses(cell);
      dayCourses[dayIdx] = courses;
      dayIdx++;
    }

    // Add to schedule
    for (let d = 0; d < 6; d++) {
      schedule.push({
        period: periodIndex,
        day: d,
        courses: dayCourses[d],
      });
    }

    periodIndex++;
  }

  // Map periodIndex to actual period names
  // If we got fewer than 10 periods, try to map them
  const actualPeriods = PERIODS.slice(0, Math.max(periodIndex, PERIODS.length));

  return {
    title,
    term: "",
    type: "",
    code: "",
    days: DAYS,
    periods: actualPeriods,
    schedule,
  };
}

// Parse courses from a single table cell
function parseCellCourses(cellHtml: string): CourseInfo[] {
  const courses: CourseInfo[] = [];

  // Clean up the cell HTML
  // Each course block typically has:
  // <span class="focus"><a class="course">COURSE_NAME</a></span><br/>
  // <a>TEACHER_NAME</a><br/>
  // <a>ROOM_NAME</a><br/>
  // Optional: <span>(單週)</span> or <span>(雙週)</span>

  // Split by <br> or <br/> to get individual lines
  const lines = cellHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "");

  // Try to extract structured data using regex on original HTML
  const courseBlocks = cellHtml.split(/<br\s*\/?>/gi);

  let currentCourse: Partial<CourseInfo> | null = null;

  for (const block of courseBlocks) {
    const cleanBlock = block
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .trim();

    if (!cleanBlock) continue;

    // Check if this block has a course name (in red span)
    const courseMatch = block.match(
      /<a[^>]*class="course"[^>]*>([^<]+)<\/a>/
    );
    const weekTypeMatch = cleanBlock.match(/(單週|雙週)/);

    if (courseMatch) {
      // New course block
      if (currentCourse && currentCourse.name) {
        courses.push(currentCourse as CourseInfo);
      }
      currentCourse = {
        name: courseMatch[1].trim(),
        teacher: null,
        room: null,
        weekType: weekTypeMatch ? weekTypeMatch[1] : null,
      };
    } else if (currentCourse) {
      // This might be a teacher or room name
      const text = cleanBlock.replace(/(單週|雙週)/g, "").trim();
      if (!text) continue;

      if (!currentCourse.teacher) {
        currentCourse.teacher = text;
      } else if (!currentCourse.room) {
        currentCourse.room = text;
      }
    }

    if (weekTypeMatch && currentCourse) {
      currentCourse.weekType = weekTypeMatch[1];
    }
  }

  // Don't forget the last course
  if (currentCourse && currentCourse.name) {
    courses.push(currentCourse as CourseInfo);
  }

  // If no structured data found, try simple text extraction
  if (courses.length === 0 && lines.length > 0) {
    // Check if cell is not empty
    const fullText = lines.join(" ").replace(/(單週|雙週)/g, "").trim();
    if (fullText && fullText !== "") {
      courses.push({
        name: lines[0] || "",
        teacher: lines[1] || null,
        room: lines[2] || null,
        weekType: cellHtml.match(/單週/)
          ? "單週"
          : cellHtml.match(/雙週/)
          ? "雙週"
          : null,
      });
    }
  }

  return courses;
}

const HTML = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>課表查詢系統</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--primary:#4f46e5;--primary-light:#818cf8;--primary-dark:#3730a3;--bg:#f8fafc;--surface:#fff;--border:#e2e8f0;--text:#1e293b;--text-muted:#64748b;--morning:#dbeafe;--afternoon:#fef3c7;--radius:12px}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
    header{background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;padding:20px 24px;box-shadow:0 4px 20px rgba(79,70,229,.3)}
    header h1{font-size:1.5rem;font-weight:700;letter-spacing:-.02em}
    header p{font-size:.85rem;opacity:.8;margin-top:4px}
    .controls{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
    .control-group{display:flex;flex-direction:column;gap:4px}
    .control-group label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)}
    select{appearance:none;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 32px 8px 12px;font-size:.9rem;color:var(--text);cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;min-width:140px;transition:border-color .15s}
    select:focus{outline:none;border-color:var(--primary-light);box-shadow:0 0 0 3px rgba(79,70,229,.1)}
    select:disabled{opacity:.5;cursor:not-allowed}
    .type-tabs{display:flex;gap:4px;background:var(--bg);border-radius:8px;padding:3px}
    .type-tab{padding:6px 16px;border-radius:6px;border:none;background:0 0;font-size:.85rem;font-weight:500;color:var(--text-muted);cursor:pointer;transition:all .15s}
    .type-tab.active{background:var(--primary);color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)}
    .type-tab:hover:not(.active){color:var(--text);background:var(--border)}
    .main{padding:24px;max-width:1200px;margin:0 auto}
    .empty-state{text-align:center;padding:80px 24px;color:var(--text-muted)}
    .empty-state .icon{font-size:3rem;margin-bottom:16px}
    .empty-state h2{font-size:1.2rem;color:var(--text);margin-bottom:8px}
    .timetable-title{font-size:1.1rem;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .timetable-title .badge{font-size:.75rem;background:var(--primary);color:#fff;padding:2px 10px;border-radius:20px;font-weight:500}
    .timetable-wrapper{overflow-x:auto;border-radius:var(--radius);box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04)}
    table.timetable{width:100%;border-collapse:collapse;background:var(--surface);min-width:700px}
    table.timetable th{background:var(--primary);color:#fff;padding:12px 8px;font-size:.85rem;font-weight:600;position:sticky;top:0}
    table.timetable th:first-child{width:90px;border-radius:var(--radius) 0 0 0}
    table.timetable th:last-child{border-radius:0 var(--radius) 0 0}
    table.timetable td{border:1px solid var(--border);padding:8px;vertical-align:top;font-size:.82rem;min-height:60px;height:70px;transition:background .1s}
    table.timetable tr:hover td{background:#f1f5f9}
    .period-cell{background:var(--bg);font-weight:600;text-align:center;vertical-align:middle;font-size:.78rem;color:var(--text-muted);width:90px}
    .period-cell .period-name{display:block;color:var(--text);font-size:.82rem}
    .period-cell .period-time{display:block;font-size:.7rem;color:var(--text-muted);margin-top:2px}
    .morning-row .period-cell{background:var(--morning)}
    .afternoon-row .period-cell{background:var(--afternoon)}
    .course-card{background:#fff;border-left:3px solid var(--primary);border-radius:6px;padding:6px 8px;margin-bottom:4px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    .course-card:last-child{margin-bottom:0}
    .course-name{font-weight:600;color:var(--primary-dark);font-size:.82rem;line-height:1.3}
    .course-meta{font-size:.72rem;color:var(--text-muted);margin-top:2px}
    .course-meta span{margin-right:8px}
    .week-type{display:inline-block;font-size:.65rem;padding:1px 6px;border-radius:10px;font-weight:500}
    .week-type.odd{background:#fce7f3;color:#be185d}
    .week-type.even{background:#d1fae5;color:#065f46}
    .loading{display:flex;justify-content:center;align-items:center;padding:60px}
    .spinner{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .error-msg{background:#fef2f2;color:#dc2626;padding:16px 20px;border-radius:var(--radius);border:1px solid #fecaca;font-size:.9rem}
    @media(max-width:640px){.controls{padding:12px 16px}.main{padding:16px}select{min-width:120px;font-size:.85rem}}
  </style>
</head>
<body>
<header><h1>課表查詢系統</h1><p>課綱國民中學 課表查詢</p></header>
<div class="controls">
  <div class="control-group"><label>學期</label><select id="termSelect" disabled><option value="">載入中...</option></select></div>
  <div class="control-group"><label>查詢方式</label><div class="type-tabs"><button class="type-tab active" data-type="class">班級</button><button class="type-tab" data-type="teacher">教師</button><button class="type-tab" data-type="room">教室</button></div></div>
  <div class="control-group"><label id="selectLabel">選擇班級</label><select id="itemSelect" disabled><option value="">請先選擇學期</option></select></div>
</div>
<div class="main" id="content"><div class="empty-state"><div class="icon">&#128218;</div><h2>選擇查詢條件</h2><p>請先選擇學期，再選擇班級、教師或教室</p></div></div>
<script>
const API_BASE=location.origin;let currentType='class';
const typeLabels={class:'班級',teacher:'教師',room:'教室'},typeEndpoints={class:'classes',teacher:'teachers',room:'rooms'};
const termSelect=document.getElementById('termSelect'),itemSelect=document.getElementById('itemSelect'),selectLabel=document.getElementById('selectLabel'),content=document.getElementById('content');
document.querySelectorAll('.type-tab').forEach(b=>{b.addEventListener('click',()=>{document.querySelectorAll('.type-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');currentType=b.dataset.type;selectLabel.textContent='選擇'+typeLabels[currentType];loadItems()})});
termSelect.addEventListener('change',loadItems);itemSelect.addEventListener('change',loadTimetable);
async function loadTerms(){try{const r=await fetch(API_BASE+'/api/terms'),d=await r.json();termSelect.innerHTML='';if(d.terms&&d.terms.length){d.terms.forEach(t=>{const o=document.createElement('option');o.value=t.value;o.textContent=t.label;termSelect.appendChild(o)});termSelect.disabled=false;loadItems()}else termSelect.innerHTML='<option value="">無可用學期</option>'}catch(e){termSelect.innerHTML='<option value="">載入失敗</option>'}}
async function loadItems(){const t=termSelect.value;if(!t)return;itemSelect.disabled=true;itemSelect.innerHTML='<option value="">載入中...</option>';try{const ep=typeEndpoints[currentType],r=await fetch(API_BASE+'/api/'+ep+'?term='+encodeURIComponent(t)),d=await r.json(),items=d[ep]||[];itemSelect.innerHTML='<option value="">請選擇'+typeLabels[currentType]+'</option>';items.forEach(i=>{const o=document.createElement('option');o.value=i.value;o.textContent=i.label;itemSelect.appendChild(o)});itemSelect.disabled=false}catch(e){itemSelect.innerHTML='<option value="">載入失敗</option>'}}
async function loadTimetable(){const code=itemSelect.value,term=termSelect.value;if(!code||!term)return;content.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const r=await fetch(API_BASE+'/api/timetable?type='+currentType+'&code='+encodeURIComponent(code)+'&term='+encodeURIComponent(term)),d=await r.json();if(d.error){content.innerHTML='<div class="error-msg">'+d.error+'</div>';return}renderTimetable(d)}catch(e){content.innerHTML='<div class="error-msg">載入失敗：'+e.message+'</div>'}}
function renderTimetable(data){const periods=data.periods||[],schedule=data.schedule||[],days=data.days||['一','二','三','四','五','六'],map={};schedule.forEach(c=>{map[c.period+'_'+c.day]=c.courses||[]});const itemLabel=itemSelect.options[itemSelect.selectedIndex]?.text||data.code;let h='<div class="timetable-title">'+itemLabel+' 課表 <span class="badge">'+(data.term||')+'</span></div><div class="timetable-wrapper"><table class="timetable"><thead><tr><th>節次</th>'+days.map(d=>'<th>星期'+d+'</th>').join('')+'</tr></thead><tbody>';periods.forEach((p,pi)=>{const sc=p.section==='morning'?'morning-row':'afternoon-row';h+='<tr class="'+sc+'"><td class="period-cell"><span class="period-name">'+p.name+'</span><span class="period-time">'+p.time+'</span></td>';for(let d=0;d<days.length;d++){const k=pi+'_'+d,courses=map[k]||[];h+='<td>';courses.forEach(c=>{h+='<div class="course-card"><div class="course-name">'+esc(c.name)+'</div><div class="course-meta">';if(c.teacher)h+='<span>'+esc(c.teacher)+'</span>';if(c.room)h+='<span>'+esc(c.room)+'</span>';if(c.weekType){const cls=c.weekType.includes('單')?'odd':'even';h+='<span class="week-type '+cls+'">'+esc(c.weekType)+'</span>'}h+='</div></div>'});h+='</td>'}h+='</tr>'});h+='</tbody></table></div>';content.innerHTML=h}
function esc(s){return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
loadTerms();
<\/script>
</body>
</html>`;

// Main request handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // Route: GET / - serve frontend
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Route: GET /api/terms
    if (url.pathname === "/api/terms" && request.method === "GET") {
      try {
        const html = await fetchSourcePage("top.asp");
        const terms = parseTerms(html);
        return jsonResponse({ terms });
      } catch (e) {
        return errorResponse(`Failed to fetch terms: ${(e as Error).message}`);
      }
    }

    // Route: GET /api/classes?term=114,2
    if (url.pathname === "/api/classes" && request.method === "GET") {
      try {
        const term = url.searchParams.get("term") || "";
        const html = await fetchSourcePage("top.asp");
        const classes = parseClasses(html);
        return jsonResponse({ classes, term });
      } catch (e) {
        return errorResponse(
          `Failed to fetch classes: ${(e as Error).message}`
        );
      }
    }

    // Route: GET /api/teachers?term=114,2
    if (url.pathname === "/api/teachers" && request.method === "GET") {
      try {
        const html = await fetchSourcePage("top.asp");
        const teachers = parseTeachers(html);
        return jsonResponse({ teachers });
      } catch (e) {
        return errorResponse(
          `Failed to fetch teachers: ${(e as Error).message}`
        );
      }
    }

    // Route: GET /api/rooms?term=114,2
    if (url.pathname === "/api/rooms" && request.method === "GET") {
      try {
        const html = await fetchSourcePage("top.asp");
        const rooms = parseRooms(html);
        return jsonResponse({ rooms });
      } catch (e) {
        return errorResponse(`Failed to fetch rooms: ${(e as Error).message}`);
      }
    }

    // Route: GET /api/timetable?type=class&code=101&term=114,2
    if (url.pathname === "/api/timetable" && request.method === "GET") {
      try {
        const type = url.searchParams.get("type") || "class";
        const code = url.searchParams.get("code") || "";
        const term = url.searchParams.get("term") || "114,2";

        if (!code) {
          return errorResponse("Missing 'code' parameter", 400);
        }

        const downPath = `down.asp?sqlstr=${encodeURIComponent(
          code
        )}&type=${encodeURIComponent(
          type
        )}&selArrange=L&selWindow=Left&yt=${encodeURIComponent(term)}`;

        const html = await fetchSourcePage(downPath);
        const timetable = parseTimetable(html);

        if (!timetable) {
          return errorResponse("Failed to parse timetable from source", 502);
        }

        timetable.term = term;
        timetable.type = type;
        timetable.code = code;

        return jsonResponse(timetable);
      } catch (e) {
        return errorResponse(
          `Failed to fetch timetable: ${(e as Error).message}`
        );
      }
    }

    // Route: GET /api/health
    if (url.pathname === "/api/health") {
      return jsonResponse({ status: "ok", timestamp: new Date().toISOString() });
    }

    // 404
    return errorResponse("Not found", 404);
  },
};
