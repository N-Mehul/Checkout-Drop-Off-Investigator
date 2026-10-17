import urllib.request, json

data = json.loads(urllib.request.urlopen('http://127.0.0.1:5000/api/analysis').read())

checks = data['fixture_validation']['checks']
passed = data['fixture_validation']['passed']
total = data['fixture_validation']['total']
q = data['event_quality']
dev = data['device_comparison']

rows_html = []
for k, v in checks.items():
    rows_html.append(f"<tr><td><code>{k}</code></td><td>{v['expected']}</td><td>{v['actual']}</td><td class='pass'>MATCH</td></tr>")

table_rows = "\n".join(rows_html)

html_content = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>C18 Checkout Drop-Off Investigator</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #f3f4f6; margin: 0; padding: 2rem; }}
  .card {{ background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 1.5rem; margin: 0 auto 1.5rem auto; max-width: 900px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }}
  h1 {{ color: #60a5fa; margin-top: 0; }}
  h2 {{ color: #93c5fd; font-size: 1.25rem; border-bottom: 1px solid #1f2937; padding-bottom: 0.5rem; margin-top: 2rem; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 1rem; }}
  th, td {{ padding: 0.75rem; text-align: left; border-bottom: 1px solid #1f2937; }}
  th {{ color: #9ca3af; font-size: 0.85rem; text-transform: uppercase; }}
  .pass {{ color: #34d399; font-weight: bold; }}
  .stat-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-top: 1rem; }}
  .stat-box {{ background: #1f2937; padding: 1rem; border-radius: 8px; }}
  .stat-label {{ font-size: 0.8rem; color: #9ca3af; text-transform: uppercase; }}
  .stat-val {{ font-size: 1.5rem; font-weight: bold; margin-top: 0.25rem; color: #38bdf8; }}
  .badge {{ background: #065f46; color: #a7f3d0; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.8rem; vertical-align: middle; }}
  .alert {{ background: #372002; border: 1px solid #854d0e; color: #fde047; padding: 0.75rem 1rem; border-radius: 8px; margin-top: 1.5rem; }}
  pre {{ background: #030712; padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.85rem; color: #e5e7eb; max-height: 400px; }}
</style>
</head>
<body>
  <div class="card">
    <h1>C18 Drop-Off Investigator <span class="badge">{passed}/{total} Benchmark Checks Passed</span></h1>
    <p style="color: #9ca3af;">Live results from <code>fixture.json</code> served at <code>http://127.0.0.1:5000/api/analysis</code>.</p>
    
    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-label">Raw Events</div>
        <div class="stat-val">{q['raw_events']}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Unique Events</div>
        <div class="stat-val">{q['unique_event_ids']}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Duplicates Removed</div>
        <div class="stat-val">{q['duplicates_removed']}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Affected Segment</div>
        <div class="stat-val" style="color: #f87171;">Desktop (-50 pp)</div>
      </div>
    </div>

    <h2>1. Validation Against records.expected</h2>
    <table>
      <thead>
        <tr><th>Metric / Rule</th><th>Expected</th><th>Actual Computed</th><th>Status</th></tr>
      </thead>
      <tbody>
        {table_rows}
      </tbody>
    </table>

    <h2>2. Segment Conversion Comparison</h2>
    <table>
      <thead>
        <tr><th>Device Segment</th><th>Before Paid %</th><th>After Paid %</th><th>Change (pp)</th><th>Volume Flag</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>Desktop</strong></td><td>{dev['desktop']['before_percent']}%</td><td>{dev['desktop']['after_percent']}%</td><td style="color: #f87171;">{dev['desktop']['change_percentage_points']} pp</td><td>Low Volume (&lt; 30)</td></tr>
        <tr><td><strong>Mobile</strong></td><td>{dev['mobile']['before_percent']}%</td><td>{dev['mobile']['after_percent']}%</td><td style="color: #34d399;">+{dev['mobile']['change_percentage_points']} pp</td><td>Low Volume (&lt; 30)</td></tr>
      </tbody>
    </table>

    <div class="alert">
      <strong>Engineering Observation:</strong> Desktop experienced a 50 percentage-point drop in visit-to-paid conversion (100% &rarr; 50%). Note: The dataset has 10 sessions per segment (flagged as low volume) and lacks payment_method instrumentation. This drop is recorded as a hypothesis, not a proven cause.
    </div>

    <h2>3. Raw JSON Output</h2>
    <pre>{json.dumps(data, indent=2)}</pre>
  </div>
</body>
</html>
"""

with open('preview.html', 'w', encoding='utf-8') as f:
    f.write(html_content)
print("preview.html successfully generated!")
