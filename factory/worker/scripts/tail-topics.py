# wrangler tail --format json の出力（1 件が複数行の整形 JSON）を読み、お題のログだけを出す。
# 使い方は watch-topics.sh。本文・鍵は出さない（Worker 側のログ自体が理由コードと件数だけ）。
import sys, json
dec = json.JSONDecoder(); buf = ""; n_ev = n_hit = 0
def handle(ev):
    global n_ev, n_hit
    if not isinstance(ev, dict): return
    n_ev += 1
    req = ev.get("event") or {}
    r = (req.get("request") or {}) if isinstance(req, dict) else {}
    url = r.get("url", "") or (req.get("cron", "") if isinstance(req, dict) else "")
    logs = ev.get("logs") or []; exc = ev.get("exceptions") or []
    if logs or exc:
        print(f"[event] {ev.get('outcome')} {r.get('method','')} {str(url).split('?')[0][:100]} ver={(ev.get('scriptVersion') or {}).get('id','')[:8]}", flush=True)
    for x in exc: print(f"[exception] {str(x)[:300]}", flush=True)
    for lg in logs:
        for m in (lg.get("message") or []) if isinstance(lg, dict) else []:
            s = m if isinstance(m, str) else json.dumps(m, ensure_ascii=False)
            if any(k in s for k in ("topic_run", "topic_check", "call_error", "detail")):
                n_hit += 1; print(f"[hit] {s[:600]}", flush=True)
for line in sys.stdin:
    buf += line
    while True:
        s = buf.lstrip()
        if not s: buf = ""; break
        try: ev, end = dec.raw_decode(s)
        except ValueError: buf = s; break
        buf = s[end:]
        try: handle(ev)
        except Exception as e: print(f"[filter-error] {type(e).__name__}", flush=True)
print(f"=== events={n_ev} hits={n_hit} ===", flush=True)
