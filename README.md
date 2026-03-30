## 崇光中學課表查詢系統

使用崇光中學課表查詢網頁作為資料來源，來自欣河系統。

---

### API 使用說明

Base URL: `https://classtable-api.ctze.workers.dev`

#### 端點列表

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/terms` | 取得所有學期列表 |
| GET | `/api/classes?term=` | 取得該學期所有班級 |
| GET | `/api/teachers?term=` | 取得該學期所有教師 |
| GET | `/api/rooms?term=` | 取得該學期所有教室 |
| GET | `/api/weeks?term=` | 取得該學期所有周次 |
| GET | `/api/timetable` | 取得課表資料 |
| GET | `/api/health` | 健康檢查 |

#### 參數說明

`/api/timetable` 參數：
- `type` - 查詢類型：`class`（班級）、`teacher`（教師）、`room`（教室）
- `code` - 代碼，例如班級代碼 `101`
- `term` - 學期，例如 `114,2`（114學年第2學期）
- `week` - 周次（選填），例如 `8`（第8週）

#### 使用範例

```bash
# 取得學期列表
curl https://classtable-api.ctze.workers.dev/api/terms

# 取得 114 學年第 2 學期班級列表
curl https://classtable-api.ctze.workers.dev/api/classes?term=114,2

# 取得高一智班學期課表
curl https://classtable-api.ctze.workers.dev/api/timetable?type=class&code=101&term=114,2

# 取得高一智班第 8 週課表
curl https://classtable-api.ctze.workers.dev/api/timetable?type=class&code=101&term=114,2&week=8

# 以教師查詢課表
curl https://classtable-api.ctze.workers.dev/api/timetable?type=teacher&code=209&term=114,2
```

#### 回應格式

```json
{
  "title": "114學年第2學期　高一智 班級課表",
  "term": "114,2",
  "type": "class",
  "code": "101",
  "days": ["一", "二", "三", "四", "五", "六"],
  "periods": [
    { "name": "早自習", "time": "07:30-07:50", "section": "morning" },
    { "name": "第一節", "time": "08:00-08:45", "section": "morning" }
  ],
  "schedule": [
    {
      "period": 1,
      "day": 0,
      "courses": [
        { "name": "英語文", "teacher": "曾憶芳", "room": null, "weekType": null }
      ]
    }
  ]
}
```

#### CORS

所有端點皆支援跨域請求（CORS），可直接在前端 JavaScript 中使用。
