package media

import (
	"encoding/json"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"mediaworkbench/internal/config"
)

var historyMu sync.Mutex

type HistoryRecord struct {
	CompletedAt  time.Time `json:"completed_at"`
	Input        string    `json:"input"`
	Output       string    `json:"output"`
	InputSize    int64     `json:"input_size"`
	OutputSize   int64     `json:"output_size"`
	Resolution   string    `json:"resolution"`
	Codec        string    `json:"codec"`
	Quality      string    `json:"quality"`
	Rotation     string    `json:"rotation"`
	Engine       string    `json:"engine"`
	DurationSecs float64   `json:"duration_secs"`
	Result       string    `json:"result"`
}

func loadHistoryUnlocked() []HistoryRecord {
	path, err := config.HistoryPath()
	if err != nil {
		return nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var v []HistoryRecord
	if json.Unmarshal(b, &v) != nil {
		return nil
	}
	return v
}

func LoadHistory() []HistoryRecord {
	historyMu.Lock()
	defer historyMu.Unlock()
	return loadHistoryUnlocked()
}

func AppendHistory(r HistoryRecord) error {
	historyMu.Lock()
	defer historyMu.Unlock()
	items := loadHistoryUnlocked()
	items = append([]HistoryRecord{r}, items...)
	if len(items) > 500 {
		items = items[:500]
	}
	path, err := config.HistoryPath()
	if err != nil {
		return err
	}
	return config.SaveJSON(path, items)
}

func ClearHistory() error {
	historyMu.Lock()
	defer historyMu.Unlock()
	path, err := config.HistoryPath()
	if err != nil {
		return err
	}
	_ = os.Remove(path)
	htmlPath, _ := config.HistoryHTMLPath()
	if htmlPath != "" {
		_ = os.Remove(htmlPath)
	}
	return nil
}

func WriteHistoryHTML() (string, error) {
	historyMu.Lock()
	defer historyMu.Unlock()
	items := loadHistoryUnlocked()
	path, err := config.HistoryHTMLPath()
	if err != nil {
		return "", err
	}
	var totalIn, totalOut int64
	var success, failed int
	for _, r := range items {
		totalIn += r.InputSize
		totalOut += r.OutputSize
		if strings.Contains(r.Result, "完成") {
			success++
		} else {
			failed++
		}
	}
	ratio := "—"
	saved := "—"
	if totalIn > 0 {
		r := float64(totalOut) / float64(totalIn) * 100
		ratio = fmt.Sprintf("%.1f%%", r)
		saved = fmt.Sprintf("%.1f%%", 100-r)
	}
	var b strings.Builder
	b.WriteString(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mediova最近转换记录</title><style>
:root{color-scheme:light;font-family:"Microsoft YaHei",Arial,sans-serif}body{margin:18px;color:#17202a;background:#fff}h1{font-size:22px;margin:0 0 6px}.sub{color:#667085;margin:0 0 14px}.cards{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 16px}.card{border:1px solid #d8dee7;border-radius:8px;padding:10px 14px;min-width:150px;background:#f8fafc}.card b{display:block;font-size:19px;margin-top:3px}.tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.tools input,.tools select,.tools button{height:34px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:0 10px;font-size:14px}.tools input{min-width:320px}.tools button{cursor:pointer;background:#1677d2;color:#fff;border-color:#1677d2}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #d4d9df;padding:7px 8px;text-align:left;white-space:nowrap}th{background:#eef2f6;text-align:center;position:sticky;top:0;z-index:1}tr:nth-child(even){background:#fafafa}tr:hover{background:#eef7ff}.ok{color:#008c35}.fail{color:#c62828}.path{white-space:normal;min-width:250px;max-width:430px;word-break:break-all}.num{text-align:right}.hidden{display:none}#count{color:#475467}</style></head><body>`)
	fmt.Fprintf(&b, "<h1>Mediova最近转换记录</h1><p class=\"sub\">最多保留 500 条，最新记录在前。页面支持即时搜索、状态筛选、统计和导出当前筛选结果。</p><div class=\"cards\"><div class=\"card\">总记录<b>%d</b></div><div class=\"card\">成功 / 其他<b>%d / %d</b></div><div class=\"card\">累计输入<b>%s</b></div><div class=\"card\">累计输出<b>%s</b></div><div class=\"card\">输出 / 原始<b>%s</b></div><div class=\"card\">累计节省<b>%s</b></div></div>", len(items), success, failed, FormatBytes(totalIn), FormatBytes(totalOut), ratio, saved)
	b.WriteString(`<div class="tools"><input id="q" type="search" placeholder="搜索文件名、路径、编码、引擎或结果"><select id="status"><option value="">全部结果</option><option value="ok">仅完成</option><option value="fail">仅失败/跳过/停止</option></select><button id="csv">导出当前结果 CSV</button><span id="count"></span></div><table id="records"><thead><tr><th>完成时间</th><th>输入文件</th><th>输出文件</th><th>输入体积</th><th>输出体积</th><th>输出/原始</th><th>节省</th><th>规格</th><th>编码</th><th>质量</th><th>旋转</th><th>引擎</th><th>耗时</th><th>结果</th></tr></thead><tbody>`)
	for _, r := range items {
		ratio := "—"
		saving := "—"
		if r.InputSize > 0 {
			v := float64(r.OutputSize) / float64(r.InputSize) * 100
			ratio = fmt.Sprintf("%.1f%%", v)
			change := 100 - v
			if change >= 0 {
				saving = fmt.Sprintf("%.1f%%", change)
			} else {
				saving = fmt.Sprintf("增加 %.1f%%", -change)
			}
		}
		cls := "ok"
		if !strings.Contains(r.Result, "完成") {
			cls = "fail"
		}
		fmt.Fprintf(&b, "<tr data-status=\"%s\"><td>%s</td><td class=\"path\">%s</td><td class=\"path\">%s</td><td class=\"num\">%s</td><td class=\"num\">%s</td><td class=\"num\">%s</td><td class=\"num\">%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td class=\"%s\">%s</td></tr>",
			cls, r.CompletedAt.Format("2006-01-02 15:04:05"), html.EscapeString(r.Input), html.EscapeString(r.Output), FormatBytes(r.InputSize), FormatBytes(r.OutputSize), ratio, saving,
			html.EscapeString(r.Resolution), html.EscapeString(r.Codec), html.EscapeString(r.Quality), html.EscapeString(r.Rotation), html.EscapeString(r.Engine), formatDurationSeconds(r.DurationSecs), cls, html.EscapeString(r.Result))
	}
	b.WriteString(`</tbody></table><script>
const q=document.getElementById('q'),st=document.getElementById('status'),rows=[...document.querySelectorAll('#records tbody tr')],count=document.getElementById('count');
function apply(){const needle=q.value.trim().toLowerCase(),status=st.value;let n=0;for(const r of rows){const ok=(!needle||r.innerText.toLowerCase().includes(needle))&&(!status||r.dataset.status===status);r.classList.toggle('hidden',!ok);if(ok)n++}count.textContent='当前显示 '+n+' 条'}q.addEventListener('input',apply);st.addEventListener('change',apply);apply();
function csvCell(v){return '"'+v.replaceAll('"','""')+'"'}document.getElementById('csv').onclick=()=>{const visible=rows.filter(r=>!r.classList.contains('hidden'));const head=[...document.querySelectorAll('#records thead th')].map(x=>csvCell(x.innerText)).join(',');const lines=visible.map(r=>[...r.cells].map(x=>csvCell(x.innerText)).join(','));const blob=new Blob(['\ufeff'+[head,...lines].join('\r\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Mediova转换记录.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
</script></body></html>`)
	tmp, err := os.CreateTemp(filepath.Dir(path), ".history-*.html")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err = tmp.WriteString(b.String()); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err = tmp.Sync(); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err = tmp.Close(); err != nil {
		return "", err
	}
	_ = os.Remove(path)
	if err = os.Rename(tmpName, path); err != nil {
		return "", err
	}
	return path, nil
}

func formatDurationSeconds(v float64) string {
	if v < 0 {
		v = 0
	}
	d := time.Duration(v * float64(time.Second))
	if d < time.Minute {
		return fmt.Sprintf("%02d:%02d", int(d/time.Second)/60, int(d/time.Second)%60)
	}
	return fmt.Sprintf("%02d:%02d:%02d", int(d/time.Hour), int(d/time.Minute)%60, int(d/time.Second)%60)
}
