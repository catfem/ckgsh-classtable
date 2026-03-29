var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-gzMn28/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/bundle-gzMn28/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/index.ts
var SOURCE_BASE = "http://class.ckgsh.ntpc.edu.tw/classtable";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}
__name(jsonResponse, "jsonResponse");
function errorResponse(message, status = 500) {
  return jsonResponse({ error: message }, status);
}
__name(errorResponse, "errorResponse");
function decodeBig5(buffer) {
  try {
    const decoder = new TextDecoder("big5");
    return decoder.decode(buffer);
  } catch {
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(buffer);
  }
}
__name(decodeBig5, "decodeBig5");
async function fetchSourcePage(path, cookie) {
  const url = `${SOURCE_BASE}/${path}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    Referer: `${SOURCE_BASE}/top.asp`
  };
  if (cookie) {
    headers["Cookie"] = cookie;
  }
  const response = await fetch(url, { headers });
  const buffer = await response.arrayBuffer();
  return decodeBig5(buffer);
}
__name(fetchSourcePage, "fetchSourcePage");
function parseTerms(html) {
  const options = [];
  const regex = /<option\s+value="([^"]*)"[^>]*>([^<]+)<\/option>/g;
  let match;
  const ddlTermSection = html.match(
    /<select[^>]*id="ddlTerm"[^>]*>([\s\S]*?)<\/select>/
  );
  if (!ddlTermSection)
    return options;
  while ((match = regex.exec(ddlTermSection[1])) !== null) {
    if (match[1] && match[1] !== "") {
      options.push({ value: match[1], label: match[2].trim() });
    }
  }
  return options;
}
__name(parseTerms, "parseTerms");
function parseClasses(html) {
  const options = [];
  const s1Section = html.match(
    /<select[^>]*id="s1"[^>]*>([\s\S]*?)<\/select>/
  );
  if (!s1Section)
    return options;
  const regex = /<option\s+value="([^"]*)"[^>]*>([^<]+)<\/option>/g;
  let match;
  while ((match = regex.exec(s1Section[1])) !== null) {
    if (match[1] && match[1] !== "aaa") {
      options.push({ value: match[1], label: match[2].trim() });
    }
  }
  return options;
}
__name(parseClasses, "parseClasses");
function parseTeachers(html) {
  const options = [];
  const s2Section = html.match(
    /<select[^>]*id="s2"[^>]*>([\s\S]*?)<\/select>/
  );
  if (!s2Section)
    return options;
  const regex = /<option\s+value="([^"]*)"[^>]*>([^<]+)<\/option>/g;
  let match;
  while ((match = regex.exec(s2Section[1])) !== null) {
    if (match[1] && match[1] !== "aaa") {
      options.push({ value: match[1], label: match[2].trim() });
    }
  }
  return options;
}
__name(parseTeachers, "parseTeachers");
function parseRooms(html) {
  const options = [];
  const s3Section = html.match(
    /<select[^>]*id="s3"[^>]*>([\s\S]*?)<\/select>/
  );
  if (!s3Section)
    return options;
  const regex = /<option\s+value="([^"]*)"[^>]*>([^<]+)<\/option>/g;
  let match;
  while ((match = regex.exec(s3Section[1])) !== null) {
    if (match[1] && match[1] !== "aaa") {
      options.push({ value: match[1], label: match[2].trim() });
    }
  }
  return options;
}
__name(parseRooms, "parseRooms");
var PERIODS = [
  { name: "\u65E9\u81EA\u7FD2", time: "07:30-07:50", section: "morning" },
  { name: "\u7B2C\u4E00\u7BC0", time: "08:00-08:45", section: "morning" },
  { name: "\u7B2C\u4E8C\u7BC0", time: "09:00-09:45", section: "morning" },
  { name: "\u7B2C\u4E09\u7BC0", time: "10:00-10:45", section: "morning" },
  { name: "\u7B2C\u56DB\u7BC0", time: "11:00-11:45", section: "morning" },
  { name: "\u7B2C\u4E94\u7BC0", time: "13:00-13:45", section: "afternoon" },
  { name: "\u7B2C\u516D\u7BC0", time: "14:00-14:45", section: "afternoon" },
  { name: "\u7B2C\u4E03\u7BC0", time: "15:00-15:45", section: "afternoon" },
  { name: "\u7B2C\u516B\u7BC0", time: "15:55-16:40", section: "afternoon" },
  { name: "\u7B2C\u4E5D\u7BC0", time: "16:45-17:30", section: "afternoon" }
];
var DAYS = ["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"];
function parseTimetable(html) {
  const titleMatch = html.match(
    /<span[^>]*class="view_title"[^>]*>([^<]+)<\/span>/
  );
  const title = titleMatch ? titleMatch[1].trim() : "\u8AB2\u8868";
  const tableMatch = html.match(
    /<table[^>]*class="classTable"[^>]*>([\s\S]*?)<\/table>/
  );
  if (!tableMatch)
    return null;
  const tableHtml = tableMatch[1];
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  const schedule = [];
  let periodIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.length <= 3 && !row.some((c) => c.includes("tdColumn")))
      continue;
    if (row.some((c) => c.includes("separator")))
      continue;
    if (row.some((c) => c.includes("tdHeader") && !c.includes("tdHeader2") && !c.includes("tdHeader3")) && row.length <= 3)
      continue;
    const dataCells = row.filter((c) => c.includes("tdColumn"));
    if (dataCells.length === 0)
      continue;
    const dayCourses = DAYS.map(() => []);
    let dayIdx = 0;
    for (const cell of row) {
      if (!cell.includes("tdColumn"))
        continue;
      if (dayIdx >= 6)
        break;
      const courses = parseCellCourses(cell);
      dayCourses[dayIdx] = courses;
      dayIdx++;
    }
    for (let d = 0; d < 6; d++) {
      schedule.push({
        period: periodIndex,
        day: d,
        courses: dayCourses[d]
      });
    }
    periodIndex++;
  }
  const actualPeriods = PERIODS.slice(0, Math.max(periodIndex, PERIODS.length));
  return {
    title,
    term: "",
    type: "",
    code: "",
    days: DAYS,
    periods: actualPeriods,
    schedule
  };
}
__name(parseTimetable, "parseTimetable");
function parseCellCourses(cellHtml) {
  const courses = [];
  const lines = cellHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").split("\n").map((l) => l.trim()).filter((l) => l && l !== "");
  const courseBlocks = cellHtml.split(/<br\s*\/?>/gi);
  let currentCourse = null;
  for (const block of courseBlocks) {
    const cleanBlock = block.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim();
    if (!cleanBlock)
      continue;
    const courseMatch = block.match(
      /<a[^>]*class="course"[^>]*>([^<]+)<\/a>/
    );
    const weekTypeMatch = cleanBlock.match(/(單週|雙週)/);
    if (courseMatch) {
      if (currentCourse && currentCourse.name) {
        courses.push(currentCourse);
      }
      currentCourse = {
        name: courseMatch[1].trim(),
        teacher: null,
        room: null,
        weekType: weekTypeMatch ? weekTypeMatch[1] : null
      };
    } else if (currentCourse) {
      const text = cleanBlock.replace(/(單週|雙週)/g, "").trim();
      if (!text)
        continue;
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
  if (currentCourse && currentCourse.name) {
    courses.push(currentCourse);
  }
  if (courses.length === 0 && lines.length > 0) {
    const fullText = lines.join(" ").replace(/(單週|雙週)/g, "").trim();
    if (fullText && fullText !== "") {
      courses.push({
        name: lines[0] || "",
        teacher: lines[1] || null,
        room: lines[2] || null,
        weekType: cellHtml.match(/單週/) ? "\u55AE\u9031" : cellHtml.match(/雙週/) ? "\u96D9\u9031" : null
      });
    }
  }
  return courses;
}
__name(parseCellCourses, "parseCellCourses");
var HTML = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\u8AB2\u8868\u67E5\u8A62\u7CFB\u7D71</title>
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
<header><h1>\u8AB2\u8868\u67E5\u8A62\u7CFB\u7D71</h1><p>\u8AB2\u7DB1\u570B\u6C11\u4E2D\u5B78 \u8AB2\u8868\u67E5\u8A62</p></header>
<div class="controls">
  <div class="control-group"><label>\u5B78\u671F</label><select id="termSelect" disabled><option value="">\u8F09\u5165\u4E2D...</option></select></div>
  <div class="control-group"><label>\u67E5\u8A62\u65B9\u5F0F</label><div class="type-tabs"><button class="type-tab active" data-type="class">\u73ED\u7D1A</button><button class="type-tab" data-type="teacher">\u6559\u5E2B</button><button class="type-tab" data-type="room">\u6559\u5BA4</button></div></div>
  <div class="control-group"><label id="selectLabel">\u9078\u64C7\u73ED\u7D1A</label><select id="itemSelect" disabled><option value="">\u8ACB\u5148\u9078\u64C7\u5B78\u671F</option></select></div>
</div>
<div class="main" id="content"><div class="empty-state"><div class="icon">&#128218;</div><h2>\u9078\u64C7\u67E5\u8A62\u689D\u4EF6</h2><p>\u8ACB\u5148\u9078\u64C7\u5B78\u671F\uFF0C\u518D\u9078\u64C7\u73ED\u7D1A\u3001\u6559\u5E2B\u6216\u6559\u5BA4</p></div></div>
<script>
const API_BASE=location.origin;let currentType='class';
const typeLabels={class:'\u73ED\u7D1A',teacher:'\u6559\u5E2B',room:'\u6559\u5BA4'},typeEndpoints={class:'classes',teacher:'teachers',room:'rooms'};
const termSelect=document.getElementById('termSelect'),itemSelect=document.getElementById('itemSelect'),selectLabel=document.getElementById('selectLabel'),content=document.getElementById('content');
document.querySelectorAll('.type-tab').forEach(b=>{b.addEventListener('click',()=>{document.querySelectorAll('.type-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');currentType=b.dataset.type;selectLabel.textContent='\u9078\u64C7'+typeLabels[currentType];loadItems()})});
termSelect.addEventListener('change',loadItems);itemSelect.addEventListener('change',loadTimetable);
async function loadTerms(){try{const r=await fetch(API_BASE+'/api/terms'),d=await r.json();termSelect.innerHTML='';if(d.terms&&d.terms.length){d.terms.forEach(t=>{const o=document.createElement('option');o.value=t.value;o.textContent=t.label;termSelect.appendChild(o)});termSelect.disabled=false;loadItems()}else termSelect.innerHTML='<option value="">\u7121\u53EF\u7528\u5B78\u671F</option>'}catch(e){termSelect.innerHTML='<option value="">\u8F09\u5165\u5931\u6557</option>'}}
async function loadItems(){const t=termSelect.value;if(!t)return;itemSelect.disabled=true;itemSelect.innerHTML='<option value="">\u8F09\u5165\u4E2D...</option>';try{const ep=typeEndpoints[currentType],r=await fetch(API_BASE+'/api/'+ep+'?term='+encodeURIComponent(t)),d=await r.json(),items=d[ep]||[];itemSelect.innerHTML='<option value="">\u8ACB\u9078\u64C7'+typeLabels[currentType]+'</option>';items.forEach(i=>{const o=document.createElement('option');o.value=i.value;o.textContent=i.label;itemSelect.appendChild(o)});itemSelect.disabled=false}catch(e){itemSelect.innerHTML='<option value="">\u8F09\u5165\u5931\u6557</option>'}}
async function loadTimetable(){const code=itemSelect.value,term=termSelect.value;if(!code||!term)return;content.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const r=await fetch(API_BASE+'/api/timetable?type='+currentType+'&code='+encodeURIComponent(code)+'&term='+encodeURIComponent(term)),d=await r.json();if(d.error){content.innerHTML='<div class="error-msg">'+d.error+'</div>';return}renderTimetable(d)}catch(e){content.innerHTML='<div class="error-msg">\u8F09\u5165\u5931\u6557\uFF1A'+e.message+'</div>'}}
function renderTimetable(data){const periods=data.periods||[],schedule=data.schedule||[],days=data.days||['\u4E00','\u4E8C','\u4E09','\u56DB','\u4E94','\u516D'],map={};schedule.forEach(c=>{map[c.period+'_'+c.day]=c.courses||[]});const itemLabel=itemSelect.options[itemSelect.selectedIndex]?.text||data.code;let h='<div class="timetable-title">'+itemLabel+' \u8AB2\u8868 <span class="badge">'+(data.term||')+'</span></div><div class="timetable-wrapper"><table class="timetable"><thead><tr><th>\u7BC0\u6B21</th>'+days.map(d=>'<th>\u661F\u671F'+d+'</th>').join('')+'</tr></thead><tbody>';periods.forEach((p,pi)=>{const sc=p.section==='morning'?'morning-row':'afternoon-row';h+='<tr class="'+sc+'"><td class="period-cell"><span class="period-name">'+p.name+'</span><span class="period-time">'+p.time+'</span></td>';for(let d=0;d<days.length;d++){const k=pi+'_'+d,courses=map[k]||[];h+='<td>';courses.forEach(c=>{h+='<div class="course-card"><div class="course-name">'+esc(c.name)+'</div><div class="course-meta">';if(c.teacher)h+='<span>'+esc(c.teacher)+'</span>';if(c.room)h+='<span>'+esc(c.room)+'</span>';if(c.weekType){const cls=c.weekType.includes('\u55AE')?'odd':'even';h+='<span class="week-type '+cls+'">'+esc(c.weekType)+'</span>'}h+='</div></div>'});h+='</td>'}h+='</tr>'});h+='</tbody></table></div>';content.innerHTML=h}
function esc(s){return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
loadTerms();
<\/script>
</body>
</html>`;
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    if (url.pathname === "/api/terms" && request.method === "GET") {
      try {
        const html = await fetchSourcePage("top.asp");
        const terms = parseTerms(html);
        return jsonResponse({ terms });
      } catch (e) {
        return errorResponse(`Failed to fetch terms: ${e.message}`);
      }
    }
    if (url.pathname === "/api/classes" && request.method === "GET") {
      try {
        const term = url.searchParams.get("term") || "";
        const html = await fetchSourcePage("top.asp");
        const classes = parseClasses(html);
        return jsonResponse({ classes, term });
      } catch (e) {
        return errorResponse(
          `Failed to fetch classes: ${e.message}`
        );
      }
    }
    if (url.pathname === "/api/teachers" && request.method === "GET") {
      try {
        const html = await fetchSourcePage("top.asp");
        const teachers = parseTeachers(html);
        return jsonResponse({ teachers });
      } catch (e) {
        return errorResponse(
          `Failed to fetch teachers: ${e.message}`
        );
      }
    }
    if (url.pathname === "/api/rooms" && request.method === "GET") {
      try {
        const html = await fetchSourcePage("top.asp");
        const rooms = parseRooms(html);
        return jsonResponse({ rooms });
      } catch (e) {
        return errorResponse(`Failed to fetch rooms: ${e.message}`);
      }
    }
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
          `Failed to fetch timetable: ${e.message}`
        );
      }
    }
    if (url.pathname === "/api/health") {
      return jsonResponse({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    }
    return errorResponse("Not found", 404);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-gzMn28/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-gzMn28/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
