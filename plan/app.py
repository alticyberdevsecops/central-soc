"""
XSIAM Live Security Dashboard
==============================
A Flask web app that connects to your Cortex XSIAM tenant
and shows a live, interactive security dashboard.

HOW TO RUN:
1. pip install flask requests python-dotenv
2. Edit config.py with your XSIAM credentials
3. python app.py
4. Open http://localhost:5000 in your browser
"""

from flask import Flask, jsonify, request, render_template_string, redirect, url_for
import requests, json, warnings
warnings.filterwarnings("ignore")
from datetime import datetime, timedelta
from config_manager import load_config, save_config, is_configured, delete_config
import xml.etree.ElementTree as ET
import urllib.request as _urllib_req
import ssl as _ssl
import time as _time
import re as _re

# SSL context that skips certificate verification (same policy as requests verify=False)
_SSL_CTX = _ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = _ssl.CERT_NONE

# ── Simple in-memory feed cache (TTL = 4 hours) ───────────────────────────────
_feed_cache: dict = {}
_CACHE_TTL = 4 * 3600

_feed_errors: dict = {}   # key → last error string, for /api/debug_feeds

def _get_cached(key, fetch_fn):
    """Return (data, is_stale).  Serves stale on fetch failure."""
    now = _time.time()
    if key in _feed_cache:
        data, ts = _feed_cache[key]
        if now - ts < _CACHE_TTL:
            return data, False
    try:
        data = fetch_fn()
        _feed_cache[key] = (data, now)
        _feed_errors.pop(key, None)
        return data, False
    except Exception as e:
        _feed_errors[key] = str(e)
        if key in _feed_cache:
            data, ts = _feed_cache[key]
            return data, True
        return [], True

_feed_errors: dict = {}   # key → last error string, for /api/debug_feeds

_RSS_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Cache-Control": "no-cache",
}

def _fetch_rss(url, max_items=10, bfsi_keywords=None):
    """Fetch an RSS/Atom feed using requests (handles redirects, cookies, SSL) and
    return list of {title, link, date, bfsi}."""
    resp = requests.get(url, headers=_RSS_HEADERS, timeout=15, verify=False,
                        allow_redirects=True)
    resp.raise_for_status()
    raw = resp.content

    # Strip BOM / leading whitespace that breaks ElementTree
    raw = raw.lstrip(b"\xef\xbb\xbf").lstrip()

    root = ET.fromstring(raw)
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    items = []

    # RSS 2.0
    for item in root.findall(".//item")[:max_items]:
        title = (item.findtext("title") or "").strip()
        link  = (item.findtext("link")  or "").strip()
        date  = (
            item.findtext("pubDate") or
            item.findtext("dc:date", "", {"dc": "http://purl.org/dc/elements/1.1/"}) or
            ""
        ).strip()
        bfsi = _is_bfsi(title + " " + (item.findtext("description") or ""), bfsi_keywords)
        items.append({"title": title, "link": link, "date": date[:25], "bfsi": bfsi})

    # Atom fallback
    if not items:
        for entry in root.findall("atom:entry", ns)[:max_items]:
            title = (entry.findtext("atom:title", "", ns) or "").strip()
            link_el = entry.find("atom:link", ns)
            link  = link_el.attrib.get("href", "") if link_el is not None else ""
            date  = (
                entry.findtext("atom:updated", "", ns) or
                entry.findtext("atom:published", "", ns) or ""
            )[:25]
            bfsi = _is_bfsi(title, bfsi_keywords)
            items.append({"title": title, "link": link, "date": date, "bfsi": bfsi})

    return items

_BFSI_KW = ["bank","financ","insurance","payment","nbfc","rbi","sebi","irdai","bfsi",
            "wallet","fintech","credit","debit","atm","swift","upi","neft","fraud",
            "phishing","ransomware","india","apac","breach","leak"]

def _is_bfsi(text, extra_kw=None):
    kw = _BFSI_KW + (extra_kw or [])
    t  = text.lower()
    return any(k in t for k in kw)

# ── 15-day window helper ──────────────────────────────────────────────────────
def fifteen_days_ago_ms():
    return int((datetime.utcnow() - timedelta(days=15)).timestamp() * 1000)

app = Flask(__name__)

# ── Dynamic credential loading ───────────────────────────────────────────────
def _get_creds():
    """Return (tenant_url, api_key, api_key_id) from the persisted config file."""
    cfg = load_config()
    return (
        cfg.get("XSIAM_TENANT_URL", ""),
        cfg.get("XSIAM_API_KEY", ""),
        str(cfg.get("XSIAM_API_KEY_ID", "")),
    )

# ─────────────────────────────────────────────
# XSIAM API AUTHENTICATION
# ─────────────────────────────────────────────
def get_auth_headers():
    """Generate XSIAM API authentication headers."""
    _, api_key, api_key_id = _get_creds()
    return {
        "x-xdr-auth-id": api_key_id,
        "Authorization": api_key,
        "Content-Type": "application/json"
    }

def _clean_tenant_url(raw: str) -> str:
    """Strip protocol prefix and trailing slashes so we can safely prepend https://."""
    url = raw.strip().rstrip("/")
    # Remove https:// or http:// if the user accidentally included it
    for prefix in ("https://", "http://"):
        if url.lower().startswith(prefix):
            url = url[len(prefix):]
            break
    return url

def xsiam_post(endpoint, payload):
    """Make an authenticated POST request to XSIAM API."""
    tenant_url, _, _ = _get_creds()
    url = f"https://{_clean_tenant_url(tenant_url)}/public_api/v1/{endpoint}"
    try:
        resp = requests.post(url, headers=get_auth_headers(), json={"request_data": payload}, timeout=30, verify=False)
        # Don't raise_for_status for XQL — return body so caller sees the real error message
        try:
            data = resp.json()
        except Exception:
            data = {"error": f"HTTP {resp.status_code}: {resp.text[:300]}"}
        if resp.status_code >= 400:
            # Attach status code so callers can distinguish
            data["_http_status"] = resp.status_code
        return data.get("reply", data)
    except Exception as e:
        return {"error": str(e)}

def five_days_ago_ms():
    return int((datetime.utcnow() - timedelta(days=5)).timestamp() * 1000)

# ─────────────────────────────────────────────
# API ROUTES
# ─────────────────────────────────────────────

@app.route("/api/incidents")
def get_incidents():
    """Get incidents from last 5 days."""
    limit = int(request.args.get("limit", 100))
    severity = request.args.get("severity")
    status = request.args.get("status")

    filters = [{"field": "creation_time", "operator": "gte", "value": fifteen_days_ago_ms()}]
    if severity:
        filters.append({"field": "severity", "operator": "eq", "value": severity})
    if status:
        filters.append({"field": "status", "operator": "eq", "value": status})

    payload = {
        "filters": filters,
        "search_from": 0,
        "search_to": min(limit, 100),
        "sort": {"field": "creation_time", "keyword": "desc"}
    }
    result = xsiam_post("incidents/get_incidents", payload)
    incidents = result.get("incidents", [])

    # Clean and format
    cleaned = []
    for i in incidents:
        cleaned.append({
            "id": i.get("incident_id"),
            "name": i.get("incident_name", "Unknown"),
            "severity": i.get("severity", "unknown"),
            "status": i.get("status", "unknown"),
            "created": i.get("creation_time"),
            "created_str": datetime.utcfromtimestamp(i.get("creation_time", 0) / 1000).strftime("%Y-%m-%d %H:%M") if i.get("creation_time") else "—",
            "assigned": i.get("assigned_user_pretty_name") or i.get("assigned_user") or "Unassigned",
            "hosts": i.get("hosts", []),
            "users": i.get("users", []),
            "alert_count": i.get("alert_count", 0),
            "description": i.get("description", ""),
            "alert_sources": list(set(i.get("alert_sources") or [])),
            "xdr_url": i.get("xdr_url", ""),
        })
    return jsonify({"incidents": cleaned, "total": result.get("total_count", len(cleaned))})


@app.route("/api/incidents/<incident_id>")
def get_incident_detail(incident_id):
    """Get full details for a specific incident."""
    payload = {"incident_id": incident_id, "alerts_limit": 50}
    result = xsiam_post("incidents/get_incident_extra_data", payload)
    incident = result.get("incident", {})
    alerts = result.get("alerts", {}).get("data", [])

    return jsonify({
        "incident": {
            "id": incident.get("incident_id"),
            "name": incident.get("incident_name", ""),
            "severity": incident.get("severity", ""),
            "status": incident.get("status", ""),
            "created": datetime.utcfromtimestamp(incident.get("creation_time", 0) / 1000).strftime("%Y-%m-%d %H:%M:%S") if incident.get("creation_time") else "—",
            "modified": datetime.utcfromtimestamp(incident.get("modification_time", 0) / 1000).strftime("%Y-%m-%d %H:%M:%S") if incident.get("modification_time") else "—",
            "assigned": incident.get("assigned_user_pretty_name") or "Unassigned",
            "hosts": incident.get("hosts", []),
            "users": incident.get("users", []),
            "description": incident.get("description", "No description available."),
            "xdr_url": incident.get("xdr_url", ""),
            "tags": incident.get("tags", []),
            "notes": incident.get("notes", ""),
        },
        "alerts": [
            {
                "id": a.get("alert_id"),
                "name": a.get("name", ""),
                "severity": a.get("severity", ""),
                "category": a.get("category", ""),
                "source": a.get("source", ""),
                "host": a.get("host_name", ""),
                "user": a.get("user_name", ""),
                "action": a.get("action_pretty") or a.get("action", ""),
                "mitre_tactic": a.get("mitre_tactic_id_and_name", ""),
                "mitre_technique": a.get("mitre_technique_id_and_name", ""),
                "description": a.get("description", ""),
                "detected": datetime.utcfromtimestamp(a.get("detection_timestamp", 0) / 1000).strftime("%Y-%m-%d %H:%M:%S") if a.get("detection_timestamp") else "—",
            }
            for a in alerts
        ]
    })


@app.route("/api/alerts")
def get_alerts():
    """Get recent alerts."""
    limit = int(request.args.get("limit", 100))
    severity = request.args.get("severity")

    filters = []
    if severity:
        filters.append({"field": "severity", "operator": "eq", "value": severity})

    payload = {
        "filters": filters,
        "search_from": 0,
        "search_to": min(limit, 100),
        "sort": {"field": "source_insert_ts", "keyword": "desc"}
    }
    result = xsiam_post("alerts/get_alerts_multi_events", payload)
    alerts = result.get("alerts", [])

    cleaned = []
    for a in alerts:
        cleaned.append({
            "id": a.get("alert_id"),
            "name": a.get("name", "Unknown"),
            "severity": a.get("severity", "unknown"),
            "category": a.get("category", ""),
            "source": a.get("source", ""),
            "host": a.get("host_name", ""),
            "user": a.get("user_name") or a.get("os_actor_effective_username", ""),
            "action": a.get("action_pretty") or a.get("action", ""),
            "mitre_tactic": a.get("mitre_tactic_id_and_name", ""),
            "mitre_technique": a.get("mitre_technique_id_and_name", ""),
            "description": a.get("description", ""),
            "detected": datetime.utcfromtimestamp(a.get("detection_timestamp", 0) / 1000).strftime("%Y-%m-%d %H:%M") if a.get("detection_timestamp") else "—",
            "case_id": a.get("case_id", ""),
        })
    return jsonify({"alerts": cleaned, "total": result.get("total_count", len(cleaned))})


@app.route("/api/alerts/<alert_id>")
def get_alert_detail(alert_id):
    """Get full details for a specific alert."""
    payload = {
        "filters": [{"field": "alert_id", "operator": "eq", "value": alert_id}],
        "search_from": 0,
        "search_to": 1
    }
    result = xsiam_post("alerts/get_alerts_multi_events", payload)
    alerts = result.get("alerts", [])
    if not alerts:
        return jsonify({"error": "Alert not found"}), 404

    a = alerts[0]
    return jsonify({
        "id": a.get("alert_id"),
        "name": a.get("name", ""),
        "severity": a.get("severity", ""),
        "category": a.get("category", ""),
        "source": a.get("source", ""),
        "host": a.get("host_name", ""),
        "host_ip": a.get("host_ip", ""),
        "user": a.get("user_name") or a.get("os_actor_effective_username", ""),
        "action": a.get("action_pretty") or a.get("action", ""),
        "description": a.get("description", "No description available."),
        "mitre_tactic": a.get("mitre_tactic_id_and_name", ""),
        "mitre_technique": a.get("mitre_technique_id_and_name", ""),
        "detected": datetime.utcfromtimestamp(a.get("detection_timestamp", 0) / 1000).strftime("%Y-%m-%d %H:%M:%S") if a.get("detection_timestamp") else "—",
        "process": a.get("actor_process_image_name", ""),
        "process_cmd": a.get("actor_process_command_line", ""),
        "remote_ip": a.get("action_remote_ip", ""),
        "local_ip": a.get("action_local_ip", ""),
        "file_name": a.get("action_file_name", ""),
        "file_sha256": a.get("action_file_sha256", ""),
        "case_id": a.get("case_id", ""),
        "tags": a.get("tags", []),
    })


@app.route("/api/stats")
def get_stats():
    """Get summary statistics for KPI cards."""
    incidents_result = xsiam_post("incidents/get_incidents", {
        "filters": [{"field": "creation_time", "operator": "gte", "value": five_days_ago_ms()}],
        "search_from": 0, "search_to": 100,
        "sort": {"field": "creation_time", "keyword": "desc"}
    })
    incidents = incidents_result.get("incidents", [])

    sev_count = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    status_count = {"new": 0, "resolved": 0, "other": 0}
    unassigned = 0
    daily = {}

    for i in incidents:
        s = i.get("severity", "").lower()
        if s in sev_count: sev_count[s] += 1
        st = i.get("status", "").lower()
        if "new" in st: status_count["new"] += 1
        elif "resolved" in st: status_count["resolved"] += 1
        else: status_count["other"] += 1
        if not i.get("assigned_user_pretty_name"): unassigned += 1
        ts = i.get("creation_time", 0)
        day = datetime.utcfromtimestamp(ts / 1000).strftime("%b %d") if ts else "Unknown"
        daily[day] = daily.get(day, 0) + 1

    return jsonify({
        "total_incidents": len(incidents),
        "severity": sev_count,
        "status": status_count,
        "unassigned": unassigned,
        "daily_trend": daily,
    })


@app.route("/api/search")
def search():
    """Search incidents by keyword — 30-day window."""
    query = request.args.get("q", "").strip()
    severity = request.args.get("severity", "")
    status = request.args.get("status", "")

    if not query and not severity and not status:
        return jsonify({"results": [], "message": "Enter a search term"})

    filters = [{"field": "creation_time", "operator": "gte", "value": thirty_days_ago_ms()}]
    if severity:
        filters.append({"field": "severity", "operator": "eq", "value": severity})
    if status:
        filters.append({"field": "status", "operator": "eq", "value": status})

    payload = {
        "filters": filters,
        "search_from": 0, "search_to": 100,
        "sort": {"field": "creation_time", "keyword": "desc"}
    }
    result = xsiam_post("incidents/get_incidents", payload)
    incidents = result.get("incidents", [])

    if query:
        ql = query.lower()
        incidents = [i for i in incidents if
                     ql in (i.get("incident_name") or "").lower() or
                     ql in (i.get("description") or "").lower() or
                     any(ql in str(h).lower() for h in i.get("hosts", [])) or
                     any(ql in str(u).lower() for u in i.get("users", []))]

    results = [{
        "id": i.get("incident_id"),
        "name": i.get("incident_name", ""),
        "severity": i.get("severity", ""),
        "status": i.get("status", ""),
        "created_str": datetime.utcfromtimestamp(i.get("creation_time", 0) / 1000).strftime("%Y-%m-%d %H:%M") if i.get("creation_time") else "—",
        "assigned": i.get("assigned_user_pretty_name") or "Unassigned",
        "hosts": i.get("hosts", []),
    } for i in incidents]

    return jsonify({"results": results, "count": len(results)})


# ─────────────────────────────────────────────
# MAIN PAGE
# ─────────────────────────────────────────────
@app.route("/")
def index():
    return render_template_string(DASHBOARD_HTML)


# ─────────────────────────────────────────────
# DASHBOARD HTML (embedded)
# ─────────────────────────────────────────────
DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>XSIAM Live Dashboard</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
:root {
  --bg:#0B1D3A; --surface:#122954; --surface2:#0F2547; --border:#1e3a6e;
  --teal:#0891B2; --teal2:#06B6D4; --text:#E2E8F0; --muted:#94A3B8;
  --red:#EF4444; --orange:#F97316; --yellow:#F59E0B; --green:#10B981; --purple:#8B5CF6;
}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;}

/* HEADER */
.header{background:#091529;border-bottom:2px solid var(--teal);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:200;box-shadow:0 2px 20px rgba(8,145,178,0.2);}
.header-left{display:flex;align-items:center;gap:12px;}
.logo{width:38px;height:38px;background:linear-gradient(135deg,var(--teal),#0e7490);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;}
.header h1{font-size:16px;font-weight:700;}
.header p{font-size:10px;color:var(--muted);margin-top:1px;}
.header-right{display:flex;align-items:center;gap:10px;}
.live-badge{display:flex;align-items:center;gap:6px;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.4);border-radius:20px;padding:4px 12px;font-size:11px;color:var(--green);font-weight:600;}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 1.8s infinite;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.refresh-btn{background:rgba(8,145,178,.15);border:1px solid rgba(8,145,178,.4);color:var(--teal2);border-radius:6px;padding:5px 12px;font-size:11px;cursor:pointer;transition:.15s;}
.refresh-btn:hover{background:rgba(8,145,178,.3);}
.last-updated{font-size:10px;color:var(--muted);}

/* TABS */
.tabs{display:flex;gap:2px;padding:0 24px;background:#091529;border-bottom:1px solid var(--border);}
.tab{padding:10px 18px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:.15s;}
.tab:hover{color:var(--teal2);}
.tab.active{color:var(--teal2);border-bottom-color:var(--teal2);}

/* MAIN */
.main{padding:18px 24px;}
.view{display:none;}
.view.active{display:block;}

/* SECTION LABEL */
.section-label{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;margin:18px 0 10px;display:flex;align-items:center;gap:8px;}
.section-label::after{content:'';flex:1;height:1px;background:var(--border);}

/* KPI GRID */
.kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:4px;}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;position:relative;overflow:hidden;cursor:default;}
.kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent,var(--teal));}
.kpi-icon{font-size:20px;margin-bottom:6px;}
.kpi-value{font-size:26px;font-weight:800;color:var(--accent,#fff);line-height:1;}
.kpi-label{font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:.8px;}
.kpi-sub{font-size:10px;color:var(--muted);margin-top:5px;}
.kpi-sub span{color:var(--accent,var(--teal));font-weight:600;}

/* GRID LAYOUTS */
.row-2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}
.row-31{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px;}

/* CARD */
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;}
.card-title{font-size:11px;font-weight:700;color:var(--teal2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px;}
.chart-wrap{position:relative;height:220px;}
.chart-wrap-sm{position:relative;height:180px;}

/* FILTERS BAR */
.filters-bar{display:flex;gap:10px;margin-bottom:14px;align-items:center;flex-wrap:wrap;}
.filter-select{background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;}
.filter-select:focus{outline:none;border-color:var(--teal);}
.filter-btn{background:rgba(8,145,178,.15);border:1px solid rgba(8,145,178,.35);color:var(--teal2);border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:600;transition:.15s;}
.filter-btn:hover{background:rgba(8,145,178,.3);}
.result-count{font-size:11px;color:var(--muted);margin-left:auto;}

/* TABLE */
table{width:100%;border-collapse:collapse;}
thead th{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;padding:6px 10px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap;}
tbody tr{border-bottom:1px solid rgba(30,58,110,.4);cursor:pointer;transition:.1s;}
tbody tr:last-child{border-bottom:none;}
tbody tr:hover{background:rgba(8,145,178,.08);}
tbody td{padding:8px 10px;font-size:11px;color:var(--text);}
.truncate{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.table-scroll{max-height:400px;overflow-y:auto;}
.table-scroll::-webkit-scrollbar{width:5px;}
.table-scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:10px;}

/* PILLS */
.pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase;}
.pill-critical{background:rgba(239,68,68,.18);color:var(--red);border:1px solid rgba(239,68,68,.35);}
.pill-high{background:rgba(249,115,22,.18);color:var(--orange);border:1px solid rgba(249,115,22,.35);}
.pill-medium{background:rgba(245,158,11,.18);color:var(--yellow);border:1px solid rgba(245,158,11,.35);}
.pill-low{background:rgba(16,185,129,.18);color:var(--green);border:1px solid rgba(16,185,129,.35);}
.pill-new{background:rgba(239,68,68,.13);color:#f87171;border:1px solid rgba(239,68,68,.3);}
.pill-resolved{background:rgba(16,185,129,.13);color:var(--green);border:1px solid rgba(16,185,129,.3);}
.pill-unknown{background:rgba(148,163,184,.13);color:var(--muted);border:1px solid rgba(148,163,184,.3);}

/* MODAL */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;align-items:center;justify-content:center;}
.modal-overlay.open{display:flex;}
.modal{background:var(--surface2);border:1px solid var(--border);border-radius:14px;width:90%;max-width:860px;max-height:88vh;overflow-y:auto;padding:0;}
.modal-header{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 22px 14px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface2);z-index:1;}
.modal-title{font-size:15px;font-weight:700;color:#fff;max-width:700px;line-height:1.4;}
.modal-close{background:rgba(148,163,184,.15);border:1px solid var(--border);color:var(--muted);border-radius:6px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;flex-shrink:0;transition:.15s;}
.modal-close:hover{background:rgba(239,68,68,.2);color:var(--red);}
.modal-body{padding:18px 22px;}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}
.detail-item{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:10px 12px;}
.detail-label{font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;}
.detail-value{font-size:12px;color:var(--text);word-break:break-all;}
.detail-full{grid-column:1/-1;}
.modal-section{font-size:10px;font-weight:700;color:var(--teal2);text-transform:uppercase;letter-spacing:.8px;margin:16px 0 8px;padding-top:12px;border-top:1px solid var(--border);}
.loading-spinner{text-align:center;padding:40px;color:var(--muted);}
.alert-row-mini{display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:6px;margin-bottom:6px;cursor:pointer;transition:.1s;}
.alert-row-mini:hover{background:rgba(8,145,178,.1);border-color:rgba(8,145,178,.3);}

/* QUERY VIEW */
.query-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:14px;}
.query-input-row{display:flex;gap:10px;margin-bottom:12px;}
.query-input{flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px 14px;font-size:13px;transition:.15s;}
.query-input:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 2px rgba(8,145,178,.15);}
.query-submit{background:linear-gradient(135deg,var(--teal),#0e7490);border:none;color:#fff;border-radius:8px;padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;transition:.15s;}
.query-submit:hover{opacity:.85;}
.query-filters{display:flex;gap:8px;flex-wrap:wrap;}
.query-hint{font-size:11px;color:var(--muted);margin-top:8px;}
.query-hint span{color:var(--teal2);cursor:pointer;}
.query-hint span:hover{text-decoration:underline;}
.query-results{margin-top:4px;}
.no-results{text-align:center;padding:40px;color:var(--muted);font-size:13px;}
.result-item{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:.15s;display:flex;align-items:center;gap:14px;}
.result-item:hover{border-color:rgba(8,145,178,.5);background:rgba(8,145,178,.07);}
.result-id{font-size:11px;font-weight:700;color:var(--teal2);flex-shrink:0;width:60px;}
.result-name{flex:1;font-size:12px;font-weight:600;color:#fff;}
.result-meta{font-size:10px;color:var(--muted);margin-top:2px;}
.result-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}

/* LOADING */
.loading{text-align:center;padding:60px 20px;color:var(--muted);}
.loading::after{content:' ●●●';animation:dots 1.2s infinite;}
@keyframes dots{0%,100%{opacity:1}50%{opacity:.2}}
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="header-left">
    <div class="logo">🛡️</div>
    <div>
      <h1>XSIAM Live Security Dashboard</h1>
      <p id="tenantLabel">Cortex XSIAM · Last 5 Days</p>
    </div>
  </div>
  <div class="header-right">
    <span class="last-updated" id="lastUpdated">Loading…</span>
    <a href="/ciso" style="color:#a0aec0;text-decoration:none;font-size:.78rem;padding:5px 12px;border-radius:6px;border:1px solid #2d3748;background:#1a1f2e">🛡 CISO</a>
    <a href="/executive" style="color:#a0aec0;text-decoration:none;font-size:.78rem;padding:5px 12px;border-radius:6px;border:1px solid #2d3748;background:#1a1f2e">📊 Executive</a>
    <button class="refresh-btn" onclick="refreshAll()">↺ Refresh</button>
    <div class="live-badge"><div class="live-dot"></div>Live</div>
  </div>
</div>

<!-- TABS -->
<div class="tabs">
  <div class="tab active" onclick="switchTab('overview')">📊 Overview</div>
  <div class="tab" onclick="switchTab('incidents')">🚨 Incidents</div>
  <div class="tab" onclick="switchTab('alerts')">🔔 Alerts</div>
  <div class="tab" onclick="switchTab('query')">🔍 Query</div>
</div>

<div class="main">

<!-- ════ OVERVIEW TAB ════ -->
<div class="view active" id="view-overview">
  <div class="section-label">Executive KPIs</div>
  <div class="kpi-grid" id="kpiGrid"><div class="loading">Fetching live data</div></div>

  <div class="section-label" style="margin-top:16px;">Incident Trends</div>
  <div class="row-31">
    <div class="card">
      <div class="card-title">📈 Daily Incident Volume</div>
      <div class="chart-wrap"><canvas id="trendChart"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title">🎯 Severity Split</div>
      <div class="chart-wrap"><canvas id="sevChart"></canvas></div>
    </div>
  </div>

  <div class="row-2">
    <div class="card">
      <div class="card-title">📄 Latest 10 Incidents <span style="color:var(--muted);font-weight:400;font-size:10px;margin-left:4px;">— click any row to drill down</span></div>
      <div class="table-scroll" id="overviewIncidentTable"><div class="loading">Loading</div></div>
    </div>
    <div class="card">
      <div class="card-title">🔔 Latest 10 Alerts <span style="color:var(--muted);font-weight:400;font-size:10px;margin-left:4px;">— click any row to drill down</span></div>
      <div class="table-scroll" id="overviewAlertTable"><div class="loading">Loading</div></div>
    </div>
  </div>
</div>

<!-- ════ INCIDENTS TAB ════ -->
<div class="view" id="view-incidents">
  <div class="filters-bar">
    <select class="filter-select" id="incSevFilter">
      <option value="">All Severities</option>
      <option value="critical">Critical</option>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
    </select>
    <select class="filter-select" id="incStatusFilter">
      <option value="">All Statuses</option>
      <option value="new">New</option>
      <option value="resolved_auto_resolve">Auto-Resolved</option>
    </select>
    <button class="filter-btn" onclick="loadIncidents()">Apply</button>
    <span class="result-count" id="incidentCount"></span>
  </div>
  <div class="card">
    <div class="card-title">🚨 Incidents — Last 5 Days <span style="color:var(--muted);font-weight:400;font-size:10px;margin-left:4px;">— click any row to drill down</span></div>
    <div class="table-scroll" id="incidentTable"><div class="loading">Loading</div></div>
  </div>
</div>

<!-- ════ ALERTS TAB ════ -->
<div class="view" id="view-alerts">
  <div class="filters-bar">
    <select class="filter-select" id="alertSevFilter">
      <option value="">All Severities</option>
      <option value="critical">Critical</option>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
    </select>
    <button class="filter-btn" onclick="loadAlerts()">Apply</button>
    <span class="result-count" id="alertCount"></span>
  </div>
  <div class="card">
    <div class="card-title">🔔 Alerts — Last 5 Days <span style="color:var(--muted);font-weight:400;font-size:10px;margin-left:4px;">— click any row to drill down</span></div>
    <div class="table-scroll" id="alertTable"><div class="loading">Loading</div></div>
  </div>
</div>

<!-- ════ QUERY TAB ════ -->
<div class="view" id="view-query">
  <div class="query-box">
    <div class="query-input-row">
      <input class="query-input" id="queryInput" type="text" placeholder='Search incidents — e.g. "Behavioral Threat" or a hostname like "ALTLAPPUN089"' onkeydown="if(event.key==='Enter') runSearch()"/>
      <button class="query-submit" onclick="runSearch()">🔍 Search</button>
    </div>
    <div class="query-filters">
      <select class="filter-select" id="qSevFilter">
        <option value="">Any Severity</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <select class="filter-select" id="qStatusFilter">
        <option value="">Any Status</option>
        <option value="new">New</option>
        <option value="resolved_auto_resolve">Resolved</option>
      </select>
    </div>
    <div class="query-hint">
      Try: <span onclick="quickSearch('Behavioral Threat')">Behavioral Threat</span> ·
           <span onclick="quickSearch('CVE')">CVE vulnerabilities</span> ·
           <span onclick="quickSearch('Application Control')">Application Control</span> ·
           <span onclick="quickSearch('critical','','critical')">All Critical</span>
    </div>
  </div>
  <div class="query-results" id="queryResults"></div>
</div>

</div><!-- /main -->

<!-- ════ INCIDENT DETAIL MODAL ════ -->
<div class="modal-overlay" id="incidentModal" onclick="closeModal('incidentModal', event)">
  <div class="modal">
    <div class="modal-header">
      <div>
        <div id="modalIncidentTitle" class="modal-title"></div>
        <div id="modalIncidentMeta" style="font-size:11px;color:var(--muted);margin-top:4px;"></div>
      </div>
      <div class="modal-close" onclick="document.getElementById('incidentModal').classList.remove('open')">✕</div>
    </div>
    <div class="modal-body" id="incidentModalBody"><div class="loading-spinner">Loading incident details…</div></div>
  </div>
</div>

<!-- ════ ALERT DETAIL MODAL ════ -->
<div class="modal-overlay" id="alertModal" onclick="closeModal('alertModal', event)">
  <div class="modal">
    <div class="modal-header">
      <div>
        <div id="modalAlertTitle" class="modal-title"></div>
        <div id="modalAlertMeta" style="font-size:11px;color:var(--muted);margin-top:4px;"></div>
      </div>
      <div class="modal-close" onclick="document.getElementById('alertModal').classList.remove('open')">✕</div>
    </div>
    <div class="modal-body" id="alertModalBody"><div class="loading-spinner">Loading alert details…</div></div>
  </div>
</div>

<script>
// ── UTILS ──
const SEV_COLORS = { critical:'#EF4444', high:'#F97316', medium:'#F59E0B', low:'#10B981', unknown:'#94A3B8' };

function pillHtml(val, type='sev') {
  if (!val) return '<span class="pill pill-unknown">—</span>';
  const v = val.toLowerCase().replace('resolved_auto_resolve','resolved').replace('under_investigation','active');
  return `<span class="pill pill-${v}">${v}</span>`;
}

function truncate(str, n=50) {
  if (!str) return '—';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function closeModal(id, e) {
  if (e.target.classList.contains('modal-overlay')) document.getElementById(id).classList.remove('open');
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  event.currentTarget.classList.add('active');
  document.getElementById('view-' + tab).classList.add('active');
  if (tab === 'incidents') loadIncidents();
  if (tab === 'alerts') loadAlerts();
}

function setLastUpdated() {
  document.getElementById('lastUpdated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

// ── KPIs ──
let trendChart, sevChart;

async function loadStats() {
  const r = await fetch('/api/stats');
  const d = await r.json();

  const sev = d.severity;
  const st = d.status;
  const unassigned_pct = d.total_incidents ? Math.round(d.unassigned / d.total_incidents * 100) : 0;
  const res_pct = d.total_incidents ? Math.round(st.resolved / d.total_incidents * 100) : 0;

  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi" style="--accent:var(--red)">
      <div class="kpi-icon">🚨</div>
      <div class="kpi-value">${d.total_incidents}</div>
      <div class="kpi-label">Total Incidents</div>
      <div class="kpi-sub"><span>${st.new}</span> open · <span>${st.resolved}</span> resolved</div>
    </div>
    <div class="kpi" style="--accent:#EF4444">
      <div class="kpi-icon">🔴</div>
      <div class="kpi-value">${sev.critical}</div>
      <div class="kpi-label">Critical</div>
      <div class="kpi-sub"><span>${sev.high}</span> high · <span>${sev.medium}</span> medium</div>
    </div>
    <div class="kpi" style="--accent:var(--yellow)">
      <div class="kpi-icon">⚠️</div>
      <div class="kpi-value">${d.unassigned}</div>
      <div class="kpi-label">Unassigned</div>
      <div class="kpi-sub"><span>${unassigned_pct}%</span> lack ownership</div>
    </div>
    <div class="kpi" style="--accent:var(--green)">
      <div class="kpi-icon">✅</div>
      <div class="kpi-value">${res_pct}%</div>
      <div class="kpi-label">Resolution Rate</div>
      <div class="kpi-sub"><span>${st.resolved}</span> of ${d.total_incidents} resolved</div>
    </div>
    <div class="kpi" style="--accent:var(--purple)">
      <div class="kpi-icon">📅</div>
      <div class="kpi-value">5</div>
      <div class="kpi-label">Day Window</div>
      <div class="kpi-sub">Live from <span>XSIAM</span></div>
    </div>
  `;

  // Trend chart
  const days = Object.keys(d.daily_trend).sort();
  const vals = days.map(k => d.daily_trend[k]);
  const colors = vals.map(v => v >= 30 ? 'rgba(239,68,68,.75)' : v >= 12 ? 'rgba(249,115,22,.75)' : 'rgba(8,145,178,.65)');

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'bar',
    data: { labels: days, datasets: [{
      label: 'Incidents', data: vals, backgroundColor: colors,
      borderColor: colors.map(c => c.replace('.75','1').replace('.65','1')),
      borderWidth: 1.5, borderRadius: 5
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color:'#94A3B8', font:{size:11} }, grid: { color:'rgba(255,255,255,.05)' } },
        y: { ticks: { color:'#94A3B8', font:{size:11} }, grid: { color:'rgba(255,255,255,.05)' }, beginAtZero: true }
      }
    }
  });

  // Severity donut
  if (sevChart) sevChart.destroy();
  sevChart = new Chart(document.getElementById('sevChart'), {
    type: 'doughnut',
    data: {
      labels: ['Critical', 'High', 'Medium', 'Low'],
      datasets: [{ data: [sev.critical, sev.high, sev.medium, sev.low],
        backgroundColor: ['rgba(239,68,68,.85)','rgba(249,115,22,.85)','rgba(245,158,11,.85)','rgba(16,185,129,.85)'],
        borderColor: ['#EF4444','#F97316','#F59E0B','#10B981'], borderWidth: 2, hoverOffset: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { position:'bottom', labels: { color:'#94A3B8', font:{size:11}, padding:10 } } }
    }
  });
}

// ── INCIDENT TABLE (shared) ──
function renderIncidentTable(incidents, containerId, limit=null) {
  const rows = limit ? incidents.slice(0, limit) : incidents;
  if (!rows.length) {
    document.getElementById(containerId).innerHTML = '<div class="no-results">No incidents found.</div>';
    return;
  }
  const html = `<table>
    <thead><tr>
      <th>ID</th><th>Severity</th><th>Status</th><th>Incident</th><th>Host</th><th>Created</th><th>Assigned</th>
    </tr></thead>
    <tbody>
    ${rows.map(i => `
      <tr onclick="openIncidentModal('${i.id}')">
        <td style="font-weight:700;color:var(--teal2);">#${i.id}</td>
        <td>${pillHtml(i.severity)}</td>
        <td>${pillHtml(i.status, 'status')}</td>
        <td class="truncate">${truncate(i.name, 45)}</td>
        <td style="font-size:10px;color:var(--muted);">${i.hosts && i.hosts.length ? String(i.hosts[0]).split(':')[0].toUpperCase() : '—'}</td>
        <td style="white-space:nowrap;">${i.created_str}</td>
        <td style="font-size:10px;">${truncate(i.assigned, 20)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
  document.getElementById(containerId).innerHTML = html;
}

async function loadOverviewIncidents() {
  const r = await fetch('/api/incidents?limit=50');
  const d = await r.json();
  renderIncidentTable(d.incidents, 'overviewIncidentTable', 10);
}

async function loadIncidents() {
  document.getElementById('incidentTable').innerHTML = '<div class="loading">Loading</div>';
  const sev = document.getElementById('incSevFilter').value;
  const st = document.getElementById('incStatusFilter').value;
  const url = `/api/incidents?limit=200${sev ? '&severity='+sev : ''}${st ? '&status='+st : ''}`;
  const r = await fetch(url);
  const d = await r.json();
  document.getElementById('incidentCount').textContent = d.incidents.length + ' incidents';
  renderIncidentTable(d.incidents, 'incidentTable');
}

// ── ALERT TABLE (shared) ──
function renderAlertTable(alerts, containerId, limit=null) {
  const rows = limit ? alerts.slice(0, limit) : alerts;
  if (!rows.length) {
    document.getElementById(containerId).innerHTML = '<div class="no-results">No alerts found.</div>';
    return;
  }
  const html = `<table>
    <thead><tr>
      <th>Severity</th><th>Alert Name</th><th>Category</th><th>Host</th><th>Source</th><th>Detected</th>
    </tr></thead>
    <tbody>
    ${rows.map(a => `
      <tr onclick="openAlertModal('${a.id}')">
        <td>${pillHtml(a.severity)}</td>
        <td class="truncate">${truncate(a.name, 45)}</td>
        <td style="font-size:10px;color:var(--muted);">${a.category || '—'}</td>
        <td style="font-size:10px;">${a.host || '—'}</td>
        <td style="font-size:10px;color:var(--muted);">${a.source || '—'}</td>
        <td style="white-space:nowrap;">${a.detected}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
  document.getElementById(containerId).innerHTML = html;
}

async function loadOverviewAlerts() {
  const r = await fetch('/api/alerts?limit=50');
  const d = await r.json();
  renderAlertTable(d.alerts, 'overviewAlertTable', 10);
}

async function loadAlerts() {
  document.getElementById('alertTable').innerHTML = '<div class="loading">Loading</div>';
  const sev = document.getElementById('alertSevFilter').value;
  const url = `/api/alerts?limit=200${sev ? '&severity='+sev : ''}`;
  const r = await fetch(url);
  const d = await r.json();
  document.getElementById('alertCount').textContent = d.alerts.length + ' alerts';
  renderAlertTable(d.alerts, 'alertTable');
}

// ── INCIDENT MODAL ──
async function openIncidentModal(id) {
  document.getElementById('incidentModal').classList.add('open');
  document.getElementById('modalIncidentTitle').textContent = 'Loading…';
  document.getElementById('modalIncidentMeta').textContent = '';
  document.getElementById('incidentModalBody').innerHTML = '<div class="loading-spinner">Loading incident details…</div>';

  const r = await fetch('/api/incidents/' + id);
  const d = await r.json();
  const inc = d.incident;
  const alerts = d.alerts || [];

  document.getElementById('modalIncidentTitle').textContent = inc.name || ('Incident #' + id);
  document.getElementById('modalIncidentMeta').innerHTML =
    `#${inc.id} &nbsp;·&nbsp; ${pillHtml(inc.severity)} &nbsp;·&nbsp; ${pillHtml(inc.status, 'status')}`;

  const hostsStr = inc.hosts && inc.hosts.length
    ? inc.hosts.map(h => String(h).split(':')[0].toUpperCase()).join(', ')
    : '—';
  const usersStr = inc.users && inc.users.length
    ? inc.users.filter(u => u && !u.toLowerCase().includes('system')).join(', ') || inc.users.join(', ')
    : '—';

  document.getElementById('incidentModalBody').innerHTML = `
    <div class="detail-grid">
      <div class="detail-item">
        <div class="detail-label">Created</div>
        <div class="detail-value">${inc.created}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Last Modified</div>
        <div class="detail-value">${inc.modified}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Assigned To</div>
        <div class="detail-value">${inc.assigned}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Alert Count</div>
        <div class="detail-value">${alerts.length} alert${alerts.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Affected Hosts</div>
        <div class="detail-value">${hostsStr}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Affected Users</div>
        <div class="detail-value">${usersStr || '—'}</div>
      </div>
      ${inc.description ? `
      <div class="detail-item detail-full">
        <div class="detail-label">Description</div>
        <div class="detail-value" style="line-height:1.6;">${inc.description}</div>
      </div>` : ''}
    </div>

    ${alerts.length ? `
    <div class="modal-section">Linked Alerts (${alerts.length}) — click to inspect</div>
    ${alerts.map(a => `
      <div class="alert-row-mini" onclick="document.getElementById('incidentModal').classList.remove('open'); setTimeout(()=>openAlertModal('${a.id}'),200)">
        <div>${pillHtml(a.severity)}</div>
        <div style="flex:1;font-size:11px;font-weight:600;">${truncate(a.name, 55)}</div>
        <div style="font-size:10px;color:var(--muted);">${a.detected}</div>
        <div style="font-size:10px;color:var(--muted);">${a.host || ''}</div>
      </div>`).join('')}` : '<div style="color:var(--muted);font-size:12px;margin-top:12px;">No linked alerts found.</div>'}
  `;
}

// ── ALERT MODAL ──
async function openAlertModal(id) {
  document.getElementById('alertModal').classList.add('open');
  document.getElementById('modalAlertTitle').textContent = 'Loading…';
  document.getElementById('modalAlertMeta').textContent = '';
  document.getElementById('alertModalBody').innerHTML = '<div class="loading-spinner">Loading alert details…</div>';

  const r = await fetch('/api/alerts/' + id);
  if (!r.ok) {
    document.getElementById('alertModalBody').innerHTML = '<div class="no-results">Could not load alert details.</div>';
    return;
  }
  const a = await r.json();

  document.getElementById('modalAlertTitle').textContent = a.name || ('Alert #' + id);
  document.getElementById('modalAlertMeta').innerHTML =
    `#${a.id} &nbsp;·&nbsp; ${pillHtml(a.severity)} &nbsp;·&nbsp; <span style="color:var(--muted)">${a.source || ''}</span>`;

  const fields = [
    ['Category', a.category], ['Source', a.source], ['Action', a.action],
    ['Detected', a.detected], ['Host', a.host], ['Host IP', a.host_ip],
    ['User', a.user], ['Process', a.process],
    ['MITRE Tactic', a.mitre_tactic], ['MITRE Technique', a.mitre_technique],
    ['Remote IP', a.remote_ip], ['Local IP', a.local_ip],
    ['File Name', a.file_name], ['File SHA256', a.file_sha256],
    ['Linked Case', a.case_id ? '#'+a.case_id : null],
  ].filter(([, v]) => v);

  document.getElementById('alertModalBody').innerHTML = `
    <div class="detail-grid">
      ${fields.map(([label, val]) => `
        <div class="detail-item">
          <div class="detail-label">${label}</div>
          <div class="detail-value">${val}</div>
        </div>`).join('')}
      ${a.process_cmd ? `
        <div class="detail-item detail-full">
          <div class="detail-label">Process Command Line</div>
          <div class="detail-value" style="font-family:monospace;font-size:11px;background:rgba(0,0,0,.2);padding:8px;border-radius:4px;line-height:1.5;">${a.process_cmd}</div>
        </div>` : ''}
      ${a.description ? `
        <div class="detail-item detail-full">
          <div class="detail-label">Description</div>
          <div class="detail-value" style="line-height:1.6;">${a.description}</div>
        </div>` : ''}
    </div>
  `;
}

// ── QUERY / SEARCH ──
async function runSearch() {
  const q = document.getElementById('queryInput').value.trim();
  const sev = document.getElementById('qSevFilter').value;
  const st = document.getElementById('qStatusFilter').value;

  document.getElementById('queryResults').innerHTML = '<div class="loading">Searching</div>';

  const url = `/api/search?q=${encodeURIComponent(q)}&severity=${sev}&status=${st}`;
  const r = await fetch(url);
  const d = await r.json();

  if (!d.results || !d.results.length) {
    document.getElementById('queryResults').innerHTML =
      `<div class="no-results">No results found${q ? ' for "<strong>${q}</strong>"' : ''}.</div>`;
    return;
  }

  const html = `
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">${d.count} result${d.count !== 1 ? 's' : ''} found</div>
    ${d.results.map(i => `
      <div class="result-item" onclick="openIncidentModal('${i.id}')">
        <div class="result-id">#${i.id}</div>
        <div>
          <div class="result-name">${truncate(i.name, 60)}</div>
          <div class="result-meta">
            ${i.created_str} &nbsp;·&nbsp; ${i.assigned}
            ${i.hosts && i.hosts.length ? ' &nbsp;·&nbsp; ' + String(i.hosts[0]).split(':')[0].toUpperCase() : ''}
          </div>
        </div>
        <div class="result-right">
          ${pillHtml(i.severity)}
          ${pillHtml(i.status, 'status')}
        </div>
      </div>`).join('')}
  `;
  document.getElementById('queryResults').innerHTML = html;
}

function quickSearch(q, sev='', status='') {
  document.getElementById('queryInput').value = q;
  document.getElementById('qSevFilter').value = sev;
  document.getElementById('qStatusFilter').value = status;
  switchTab('query');
  document.querySelectorAll('.tab').forEach((t,i) => {
    t.classList.toggle('active', i===3);
  });
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-query').classList.add('active');
  runSearch();
}

// ── REFRESH ALL ──
async function refreshAll() {
  setLastUpdated();
  await Promise.all([loadStats(), loadOverviewIncidents(), loadOverviewAlerts()]);
}

// ── INIT ──
refreshAll();
</script>
</body>
</html>
"""

# ─────────────────────────────────────────────
# CISO & EXECUTIVE DASHBOARD HELPERS
# ─────────────────────────────────────────────
def thirty_days_ago_ms():
    return int((datetime.utcnow() - timedelta(days=30)).timestamp() * 1000)

def calculate_mttr(incidents):
    """Mean time to resolve (hours) for resolved incidents."""
    times = []
    for i in incidents:
        if i.get("status","").lower().startswith("resolved"):
            c = i.get("creation_time") or 0
            m = i.get("modification_time") or 0
            if c and m and m > c:
                times.append((m - c) / 3_600_000)
    return round(sum(times)/len(times), 1) if times else None

def calculate_mttd(incidents):
    """Mean time to detect (hours)."""
    times = []
    for i in incidents:
        d = i.get("detection_time") or 0
        c = i.get("creation_time") or 0
        if d and c and c > d:
            times.append((c - d) / 3_600_000)
    return round(sum(times)/len(times), 1) if times else None

def calculate_sla(incidents):
    """SLA compliance % based on severity thresholds."""
    thresholds = {"critical": 4, "high": 8, "medium": 24, "low": 72}
    total, passed = 0, 0
    for i in incidents:
        sev = (i.get("severity") or "").lower()
        limit = thresholds.get(sev)
        if not limit:
            continue
        total += 1
        c = i.get("creation_time") or 0
        m = i.get("modification_time") or 0
        age_h = (m - c) / 3_600_000 if (m and c and m > c) else \
                (datetime.utcnow().timestamp()*1000 - c) / 3_600_000 if c else 0
        if age_h <= limit:
            passed += 1
    return round(passed / total * 100) if total else None

# ─────────────────────────────────────────────
# NEW API ENDPOINTS
# ─────────────────────────────────────────────
@app.route("/api/soc_performance")
def api_soc_performance():
    thirty = thirty_days_ago_ms()
    result = xsiam_post("incidents/get_incidents", {
        "filters": [{"field": "creation_time", "operator": "gte", "value": thirty}],
        "search_from": 0, "search_to": 100, "sort": {"field": "creation_time", "keyword": "desc"}
    })
    incidents = result.get("incidents", [])
    resolved = [i for i in incidents if (i.get("status","")).lower().startswith("resolved")]
    active   = [i for i in incidents if not (i.get("status","")).lower().startswith("resolved")]
    sevs = {"critical":0,"high":0,"medium":0,"low":0,"unknown":0}
    for i in incidents:
        s = (i.get("severity") or "unknown").lower()
        sevs[s] = sevs.get(s, 0) + 1
    # daily trend (last 14 days)
    daily = {}
    for i in incidents:
        ts = i.get("creation_time") or 0
        if ts:
            day = datetime.utcfromtimestamp(ts/1000).strftime("%m/%d")
            daily[day] = daily.get(day,0) + 1
    # sort by date
    from collections import OrderedDict
    trend_labels, trend_values = [], []
    for k in sorted(daily.keys()):
        trend_labels.append(k)
        trend_values.append(daily[k])
    # assigned vs unassigned
    unassigned = sum(1 for i in incidents if not i.get("assigned_user_mail"))
    assigned   = len(incidents) - unassigned
    # analyst workload
    workload = {}
    for i in incidents:
        u = i.get("assigned_user_mail") or "Unassigned"
        workload[u] = workload.get(u,0) + 1
    top_analysts = sorted(workload.items(), key=lambda x: -x[1])[:8]
    return jsonify({
        "total_incidents": len(incidents),
        "resolved": len(resolved),
        "active": len(active),
        "resolution_rate": round(len(resolved)/len(incidents)*100) if incidents else 0,
        "mttd": calculate_mttd(incidents),
        "mttr": calculate_mttr(incidents),
        "sla_compliance": calculate_sla(incidents),
        "severity_breakdown": sevs,
        "trend_labels": trend_labels,
        "trend_values": trend_values,
        "assigned": assigned,
        "unassigned": unassigned,
        "analyst_workload": [{"name": a[0].split("@")[0] if "@" in a[0] else a[0], "count": a[1]} for a in top_analysts],
    })

@app.route("/api/incident_sources")
def api_incident_sources():
    thirty = thirty_days_ago_ms()
    result = xsiam_post("incidents/get_incidents", {
        "filters": [{"field": "creation_time", "operator": "gte", "value": thirty}],
        "search_from": 0, "search_to": 100, "sort": {"field": "creation_time", "keyword": "desc"}
    })
    incidents = result.get("incidents", [])
    sources = {}
    hosts = {}
    for i in incidents:
        for s in (i.get("alert_sources") or []):
            sources[s] = sources.get(s,0) + 1
        for h in (i.get("hosts") or []):
            hn = str(h).split(":")[0].upper()
            hosts[hn] = hosts.get(hn,0) + 1
    top_sources = sorted(sources.items(), key=lambda x: -x[1])[:10]
    top_hosts   = sorted(hosts.items(),   key=lambda x: -x[1])[:10]
    # MITRE tactics
    tactics = {}
    for i in incidents:
        for m in (i.get("mitre_tactics_ids_and_names") or []):
            name = m.split(" - ")[-1] if " - " in m else m
            tactics[name] = tactics.get(name,0) + 1
    top_tactics = sorted(tactics.items(), key=lambda x: -x[1])[:10]
    return jsonify({
        "sources": [{"name": s[0], "count": s[1]} for s in top_sources],
        "hosts":   [{"name": h[0], "count": h[1]} for h in top_hosts],
        "tactics": [{"name": t[0], "count": t[1]} for t in top_tactics],
    })

@app.route("/api/critical_alerts")
def api_critical_alerts():
    result = xsiam_post("alerts/get_alerts_multi_events", {
        "filters": [{"field": "severity", "operator": "in", "value": ["critical","high"]}],
        "search_from": 0, "search_to": 50,
        "sort": {"field": "source_insert_ts", "keyword": "desc"}
    })
    alerts = result.get("alerts", [])
    thresholds = {"critical": 4*3600000, "high": 8*3600000}
    out = []
    for a in alerts:
        sev = (a.get("severity") or "").lower()
        ts  = a.get("source_insert_ts") or a.get("detection_timestamp") or 0
        age_ms = int(datetime.utcnow().timestamp()*1000) - ts if ts else 0
        breach = age_ms > thresholds.get(sev, 999999999)
        out.append({
            "id":          a.get("alert_id") or a.get("id"),
            "name":        a.get("name") or a.get("alert_name","Unknown"),
            "severity":    sev,
            "source":      a.get("source") or a.get("alert_source",""),
            "host":        a.get("host_name") or "",
            "age_h":       round(age_ms/3_600_000, 1),
            "sla_breach":  breach,
            "ts":          datetime.utcfromtimestamp(ts/1000).strftime("%Y-%m-%d %H:%M") if ts else "",
        })
    return jsonify({"alerts": out, "total": len(out)})

@app.route("/api/executive_summary")
def api_executive_summary():
    thirty = thirty_days_ago_ms()
    result = xsiam_post("incidents/get_incidents", {
        "filters": [{"field": "creation_time", "operator": "gte", "value": thirty}],
        "search_from": 0, "search_to": 100, "sort": {"field": "creation_time", "keyword": "desc"}
    })
    incidents = result.get("incidents", [])
    resolved  = [i for i in incidents if (i.get("status","")).lower().startswith("resolved")]
    active    = [i for i in incidents if not (i.get("status","")).lower().startswith("resolved")]
    critical  = [i for i in active if (i.get("severity","")).lower()=="critical"]
    resolution_rate = round(len(resolved)/len(incidents)*100) if incidents else 0
    sla       = calculate_sla(incidents) or 0
    mttr      = calculate_mttr(incidents) or 0
    unassigned_pct = round(sum(1 for i in incidents if not i.get("assigned_user_mail"))/len(incidents)*100) if incidents else 0
    # posture score (weighted composite)
    res_score   = resolution_rate * 0.40
    sla_score   = sla * 0.30
    mttr_bench  = max(0, (1 - min(mttr/24, 1))) * 100 * 0.20
    assign_score= (100 - unassigned_pct) * 0.10
    posture     = round(res_score + sla_score + mttr_bench + assign_score)
    # trend (last 14 days)
    daily = {}
    for i in incidents:
        ts = i.get("creation_time") or 0
        if ts:
            day = datetime.utcfromtimestamp(ts/1000).strftime("%m/%d")
            daily[day] = daily.get(day,0) + 1
    trend_labels = sorted(daily.keys())
    trend_values = [daily[k] for k in trend_labels]
    # risk areas from sources
    sources = {}
    for i in incidents:
        for s in (i.get("alert_sources") or []):
            sources[s] = sources.get(s,0) + 1
    top_risks = sorted(sources.items(), key=lambda x: -x[1])[:5]
    # RAG status
    def rag(val, g, a):
        if val is None: return "grey"
        return "green" if val >= g else ("amber" if val >= a else "red")
    metrics = [
        {"name": "Resolution Rate",    "value": f"{resolution_rate}%",  "rag": rag(resolution_rate,80,60),    "target": "≥80%"},
        {"name": "SLA Compliance",     "value": f"{sla}%",              "rag": rag(sla,90,70),                "target": "≥90%"},
        {"name": "MTTR",               "value": f"{mttr}h" if mttr else "N/A", "rag": rag(100-(mttr/24*100) if mttr else None,70,40), "target": "≤8h"},
        {"name": "Unassigned",         "value": f"{unassigned_pct}%",   "rag": rag(100-unassigned_pct,90,70), "target": "≤10%"},
        {"name": "Active Incidents",   "value": str(len(active)),       "rag": rag(100-min(len(active),100),80,50), "target": "<20"},
        {"name": "Critical Open",      "value": str(len(critical)),     "rag": "red" if len(critical)>0 else "green", "target": "0"},
    ]
    # auto recommendations
    recs = []
    if len(critical) > 0:
        recs.append(f"⚠️  {len(critical)} critical incident(s) require immediate attention.")
    if unassigned_pct > 10:
        recs.append(f"📋  {unassigned_pct}% of incidents are unassigned — review analyst capacity.")
    if sla < 80:
        recs.append(f"⏱️  SLA compliance at {sla}% — review triage process and escalation paths.")
    if mttr and mttr > 24:
        recs.append(f"🔧  MTTR of {mttr}h exceeds 24h benchmark — investigate remediation bottlenecks.")
    if not recs:
        recs.append("✅  Security posture is within acceptable parameters. Maintain current practices.")
    return jsonify({
        "posture_score":    posture,
        "active_threats":   len(active),
        "critical_open":    len(critical),
        "mttr":             mttr,
        "total_30d":        len(incidents),
        "resolution_rate":  resolution_rate,
        "sla_compliance":   sla,
        "unassigned_pct":   unassigned_pct,
        "trend_labels":     trend_labels,
        "trend_values":     trend_values,
        "top_risks":        [{"name": r[0], "count": r[1]} for r in top_risks],
        "metrics":          metrics,
        "recommendations":  recs,
    })

# ─────────────────────────────────────────────
# CISO DASHBOARD — NEW API ENDPOINTS
# ─────────────────────────────────────────────

@app.route("/api/ciso_posture")
def api_ciso_posture():
    """6-component security posture score (15-day window).
    Each component is individually guarded — partial failures return defaults."""
    import traceback as _tb
    fifteen = fifteen_days_ago_ms()
    _errors = []

    def rag(v, g=80, a=60): return "green" if v>=g else ("amber" if v>=a else "red")

    # ── Incidents (shared across components 1, 4, 5) ─────────────────────
    incidents, resolved, active, critical = [], [], [], []
    try:
        result = xsiam_post("incidents/get_incidents", {
            "filters": [{"field":"creation_time","operator":"gte","value": fifteen}],
            "search_from": 0, "search_to": 100,
            "sort": {"field":"creation_time","keyword":"desc"}
        })
        incidents = result.get("incidents", [])
        resolved  = [i for i in incidents if (i.get("status","")).lower().startswith("resolved")]
        active    = [i for i in incidents if not (i.get("status","")).lower().startswith("resolved")]
        critical  = [i for i in active if (i.get("severity","")).lower()=="critical"]
    except Exception as e:
        _errors.append(f"incidents: {e}")

    # ── Component 1: Incident Response (25%) ─────────────────────────────
    c1 = 50  # default
    try:
        res_rate = round(len(resolved)/len(incidents)*100) if incidents else 0
        sla      = calculate_sla(incidents) or 50
        c1       = round((res_rate * 0.5) + (sla * 0.5))
    except Exception as e:
        _errors.append(f"c1: {e}")

    # ── Component 2: Vulnerability Exposure (20%) — fast alerts API only ─
    # NOTE: intentionally skips the slow XQL va_cves call; CVE count from alerts API
    crit_cve, high_cve = 0, 0
    try:
        import re as _cve_re3
        _CVE3 = _cve_re3.compile(r'CVE-\d{4}-\d+', _cve_re3.IGNORECASE)
        ar = xsiam_post("alerts/get_alerts_multi_events", {
            "filters": [{"field":"creation_time","operator":"gte","value": fifteen}],
            "search_from": 0, "search_to": 100,
            "sort": {"field":"source_insert_ts","keyword":"desc"}
        })
        cve_set = set()
        for a in ar.get("alerts", []):
            nm = a.get("name") or a.get("alert_name") or ""
            sev_a = (a.get("severity") or "").upper()
            for cid in _CVE3.findall(nm):
                cve_set.add((cid.upper(), sev_a))
        crit_cve = sum(1 for _, s in cve_set if s == "CRITICAL")
        high_cve = sum(1 for _, s in cve_set if s == "HIGH")
    except Exception as e:
        _errors.append(f"c2_vuln: {e}")
    c2 = max(0, 100 - crit_cve*8 - high_cve*3)

    # ── Component 3: Detection Coverage (15%) — endpoints ────────────────
    c3, total_ep, connected = 50, 0, 0
    try:
        ep_result = xsiam_post("endpoints/get_endpoints", {
            "filters":[],"search_from":0,"search_to":100})
        endpoints = ep_result.get("endpoints", [])
        total_ep  = len(endpoints)
        connected = sum(1 for e in endpoints if (e.get("endpoint_status") or "").lower()=="connected")
        c3        = round(connected/total_ep*100) if total_ep else 50
    except Exception as e:
        _errors.append(f"c3: {e}")

    # ── Component 4: Response Speed (15%) ────────────────────────────────
    c4 = 80  # default (no data = assume reasonable)
    try:
        mttr = calculate_mttr(incidents) or 0
        mttd = calculate_mttd(incidents) or 0
        mttd_score = max(0, 100 - int(mttd/24*100)) if mttd else 80
        mttr_score = max(0, 100 - int(min(mttr,48)/8*50)) if mttr else 80
        c4 = round((mttd_score + mttr_score) / 2)
    except Exception as e:
        _errors.append(f"c4: {e}")

    # ── Component 5: Exposure Right Now (10%) ────────────────────────────
    sla_breaches = 0
    try:
        sla_breaches = sum(1 for i in active if _is_sla_breached(i))
    except Exception as e:
        _errors.append(f"c5_sla: {e}")
    c5 = max(0, 100 - len(critical)*20 - sla_breaches*10)

    # ── Component 6: User Risk (15%) ─────────────────────────────────────
    user_risk_avg = 0
    try:
        user_risk_avg = _get_user_risk_avg()
    except Exception as e:
        _errors.append(f"c6: {e}")
    c6 = max(0, 100 - user_risk_avg)

    # ── Unassigned count (uses assigned_user field from raw XSIAM incidents) ─
    unassigned = 0
    try:
        unassigned = sum(1 for i in active
                         if not i.get("assigned_user") and not i.get("assigned_user_mail"))
    except Exception as e:
        _errors.append(f"unassigned: {e}")

    posture = round(c1*0.25 + c2*0.20 + c3*0.15 + c4*0.15 + c5*0.10 + c6*0.15)
    last_updated = datetime.utcnow().strftime("%H:%M UTC")

    resp = {
        "posture_score":   posture,
        "rag":             rag(posture),
        "active_critical": len(critical),
        "sla_breaches":    sla_breaches,
        "unassigned":      unassigned,
        "open_critical_cve": crit_cve + high_cve,
        "total_active":    len(active),
        "endpoint_count":  total_ep,
        "connected_ep":    connected,
        "components": [
            {"name":"Incident Response",    "score":c1, "weight":"25%", "rag": rag(c1)},
            {"name":"Vulnerability Exposure","score":c2, "weight":"20%", "rag": rag(c2)},
            {"name":"Detection Coverage",   "score":c3, "weight":"15%", "rag": rag(c3)},
            {"name":"Response Speed",       "score":c4, "weight":"15%", "rag": rag(c4)},
            {"name":"Current Exposure",     "score":c5, "weight":"10%", "rag": rag(c5)},
            {"name":"User Risk",            "score":c6, "weight":"15%", "rag": rag(c6)},
        ],
        "last_updated": last_updated,
    }
    if _errors:
        resp["_warnings"] = _errors  # surfaced in browser console only
    return jsonify(resp)


def _is_sla_breached(incident):
    thresholds = {"critical":4,"high":8,"medium":24,"low":72}
    sev   = (incident.get("severity") or "").lower()
    limit = thresholds.get(sev)
    if not limit: return False
    c = incident.get("creation_time") or 0
    if not c: return False
    age_h = (datetime.utcnow().timestamp()*1000 - c) / 3_600_000
    return age_h > limit and not (incident.get("status","")).lower().startswith("resolved")


def _get_vuln_summary():
    """Fetch open critical/high CVEs — tries va_cves first, falls back to alert API CVE scan."""
    import re as _cve_re2
    _CVE_PAT = _cve_re2.compile(r'CVE-\d{4}-\d+', _cve_re2.IGNORECASE)
    try:
        # First try va_cves (Vulnerability Assessment licence required)
        xql = (
            "dataset = va_cves "
            "| filter severity in (\"CRITICAL\",\"HIGH\") "
            "| fields cve_id, severity, cvss_score, affected_hosts_count "
            "| limit 500"
        )
        rows, _ = _run_xql_sync(xql, timeframe="90d", limit=500)
        if rows:
            crit = sum(1 for r in rows if (r.get("severity") or "").upper()=="CRITICAL")
            high = sum(1 for r in rows if (r.get("severity") or "").upper()=="HIGH")
            return {"critical_count": crit, "high_count": high, "kev_matches": 0}
    except Exception:
        pass
    # Fallback: extract CVE IDs from alert names (last 90 days)
    try:
        result = xsiam_post("alerts/get_alerts_multi_events", {
            "filters": [{"field": "severity", "operator": "in",
                         "value": ["critical","high","medium","low"]}],
            "search_from": 0, "search_to": 200,
            "sort": {"field": "source_insert_ts", "keyword": "desc"}
        })
        cve_ids = set()
        for a in result.get("alerts", []):
            name = a.get("name") or a.get("alert_name") or ""
            for cid in _CVE_PAT.findall(name):
                cve_ids.add(cid.upper())
        return {"critical_count": len(cve_ids), "high_count": 0, "kev_matches": 0}
    except Exception:
        return {"critical_count": 0, "high_count": 0, "kev_matches": 0}


def _get_user_risk_avg():
    """Return average risk score of top-5 riskiest users (0-100)."""
    try:
        r = _build_user_risk_scores()
        scores = sorted([u["score"] for u in r], reverse=True)[:5]
        return round(sum(scores)/len(scores)) if scores else 0
    except Exception:
        return 0


@app.route("/api/ciso_vulnerabilities")
def api_ciso_vulnerabilities():
    """Open critical/high CVEs — try va_cves first, fall back to CVE IDs extracted from alerts."""
    import re as _cve_re
    CVE_PATTERN = _cve_re.compile(r'CVE-\d{4}-\d+', _cve_re.IGNORECASE)
    SEV_ORDER = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}

    # Step 1 — try va_cves (Vulnerability Assessment licence required)
    # NOTE: In va_cves, the human-readable CVE ID (e.g. "CVE-2024-21253") is in the
    # `name` field — `cve_id` is an internal hash.  severity_score is the CVSS score.
    # No severity filter — many tenants only have LOW/MEDIUM CVEs.
    xql_cves = (
        "dataset = va_cves "
        "| fields cve_id, name, severity, severity_score, affected_hosts_count, "
        "affected_hosts, description "
        "| sort desc severity_score "
        "| limit 500"
    )
    # Step 1 wrapped in try/except — va_cves may not exist (no VA licence)
    cve_map = {}
    try:
        rows, _ = _run_xql_sync(xql_cves, timeframe="90d", limit=500)
        for row in rows:
            # Prefer `name` field (actual CVE-YYYY-NNNNN string) over `cve_id` hash
            raw_name = (row.get("name") or "").strip()
            raw_hash = (row.get("cve_id") or "").strip().upper()
            if CVE_PATTERN.match(raw_name):
                cid = raw_name.upper()
            elif raw_hash and raw_hash != "NONE":
                cid = raw_hash  # fallback: use hash as display key
            else:
                continue
            sev  = (row.get("severity") or "LOW").upper()
            # severity_score is the CVSS base score in va_cves
            cvss = row.get("severity_score") or row.get("cvss_score") or 0
            try: cvss = float(cvss)
            except: cvss = 0.0
            # affected_hosts is a list; affected_hosts_count is the total
            hosts_list = row.get("affected_hosts") or []
            if not isinstance(hosts_list, list): hosts_list = []
            host_count = row.get("affected_hosts_count") or len(hosts_list)
            try: host_count = int(host_count)
            except: host_count = len(hosts_list)
            cve_map[cid] = {
                "cve_id": cid, "severity": sev, "cvss": cvss,
                "device_count": host_count,
                "devices": set(hosts_list[:20]),
                "description": (row.get("description") or "")[:200],
                "first_seen": row.get("publication_date"),
            }
    except Exception:
        pass  # va_cves dataset not available — will use alert fallback below

    # Step 2 — if va_cves empty, scan alerts API
    # First pass: extract explicit CVE-YYYY-NNNNN IDs from alert names.
    # Step 2 fallback — alerts API scan (always runs, not just when cve_map empty)
    # Scans for CVE IDs, IPS/exploit keywords, AND alert category field
    # (XSIAM alerts have category='Initial Access','Execution', etc. — we capture
    #  alerts whose category indicates vulnerability exploitation even with no CVE ID)
    _VULN_KW = ["exploit","overflow","injection","traversal","ips block","ips detection",
                "intrusion","signature","cve-","vulnerability","command injection",
                "sql injection","xss","rce","code execution","buffer overflow",
                "heartbleed","log4j","log4shell","springshell","proxylogon",
                "eternalblue","wannacry","fortigate ips","nids","attack.",
                "web attack","application attack","malicious url","zero-day"]
    # Categories that indicate exploitation/vulnerability (from alert category field)
    _VULN_CATS = {"initial access","exploit","vulnerability","malware",
                  "execution","network","intrusion"}
    try:
        result = xsiam_post("alerts/get_alerts_multi_events", {
            "filters": [{"field": "severity", "operator": "in",
                         "value": ["critical","high","medium","low"]}],
            "search_from": 0, "search_to": 500,
            "sort": {"field": "source_insert_ts", "keyword": "desc"}
        })
        for a in result.get("alerts", []):
            name = (a.get("name") or a.get("alert_name") or "")
            ts   = a.get("source_insert_ts") or a.get("detection_timestamp") or 0
            host = a.get("host_name") or a.get("hostname") or ""
            sev  = (a.get("severity") or "HIGH").upper()
            src  = a.get("source") or a.get("alert_source") or ""
            desc = (a.get("description") or "")
            cat  = (a.get("category") or "").lower()
            full_text = (name + " " + desc).lower()

            # Priority 1: explicit CVE-YYYY-NNNNN in name or description
            found = False
            for raw_cid in CVE_PATTERN.findall(name + " " + desc):
                found = True
                cid = raw_cid.upper()
                if cid not in cve_map:
                    cve_map[cid] = {
                        "cve_id": cid, "severity": sev, "cvss": 0.0,
                        "device_count": 0, "devices": set(),
                        "description": (desc or name)[:200],
                        "first_seen": ts, "source": src,
                    }
                else:
                    if SEV_ORDER.get(sev, 0) > SEV_ORDER.get(cve_map[cid]["severity"], 0):
                        cve_map[cid]["severity"] = sev
                    if ts and (not cve_map[cid].get("first_seen") or ts < cve_map[cid]["first_seen"]):
                        cve_map[cid]["first_seen"] = ts
                if host: cve_map[cid]["devices"].add(host)

            # Priority 2: vulnerability/IPS keyword match OR vuln category
            if not found and (any(kw in full_text for kw in _VULN_KW) or cat in _VULN_CATS):
                pseudo_id = "ALERT-" + _re.sub(r'[^A-Z0-9]', '-',
                                               name.upper()[:40]).strip('-')
                if pseudo_id not in cve_map:
                    cve_map[pseudo_id] = {
                        "cve_id": pseudo_id, "severity": sev, "cvss": 0.0,
                        "device_count": 0, "devices": set(),
                        "description": (name + (" — " + desc[:120] if desc else ""))[:200],
                        "first_seen": ts, "source": src,
                    }
                else:
                    if SEV_ORDER.get(sev, 0) > SEV_ORDER.get(cve_map[pseudo_id]["severity"], 0):
                        cve_map[pseudo_id]["severity"] = sev
                    if ts and (not cve_map[pseudo_id].get("first_seen") or ts < cve_map[pseudo_id]["first_seen"]):
                        cve_map[pseudo_id]["first_seen"] = ts
                if host: cve_map[pseudo_id]["devices"].add(host)
    except Exception:
        pass

    # Step 3 — CISA KEV cross-match
    kev_ids = _get_kev_cve_ids()

    # Step 4 — serialise, sort by (KEV, severity, CVSS) desc
    out = []
    for cid, v in cve_map.items():
        devs = sorted(v["devices"]) if isinstance(v["devices"], set) else (v["devices"] or [])
        out.append({
            "cve_id":       cid,
            "severity":     v["severity"],
            "cvss":         v["cvss"],
            "device_count": len(devs) if devs else v.get("device_count", 0),
            "devices":      devs[:10],
            "kev":          cid in kev_ids,
            "description":  v.get("description", ""),
            "nvd_link":     f"https://nvd.nist.gov/vuln/detail/{cid}" if cid.startswith("CVE-") else "",
            "first_seen":   v.get("first_seen"),
            "source":       v.get("source", ""),
        })
    out.sort(key=lambda x: (x["kev"], SEV_ORDER.get(x["severity"], 0), x["cvss"]), reverse=True)
    out = out[:100]

    # Step 5 — recent KEV additions for the threat intel strip
    kev_recent = _get_recent_kev(days=15)

    return jsonify({"cves": out, "total": len(out), "kev_recent": kev_recent})


def _run_xql_sync(query, timeframe="15d", limit=200):
    """Run an XQL query synchronously (poll until done). Returns (rows, error_str)."""
    try:
        import time as _t
        # Build timeframe as absolute epoch ms range — avoids relativeTime string enum issues
        try:
            days = int(str(timeframe).replace("d","").replace("h",""))
            if "h" in str(timeframe):
                seconds = days * 3600
            else:
                seconds = days * 86400
        except Exception:
            seconds = 15 * 86400
        now_ms  = int(_time.time() * 1000)
        from_ms = now_ms - (seconds * 1000)
        start_r = xsiam_post("xql/start_xql_query", {
            "query": query,
            "timeframe": {"from": from_ms, "to": now_ms}
        })
        # Note: xsiam_post already unwraps the top-level "reply" key, so
        # start_r IS the reply value directly.
        # Some XSIAM tenants return the job_id as a bare string (not wrapped in a dict).
        if isinstance(start_r, str):
            if len(start_r) > 5:
                job_id = start_r  # bare string is the job_id
            else:
                return [], f"XSIAM error: {start_r}"
        elif not isinstance(start_r, dict):
            return [], f"XSIAM error: {str(start_r)[:300]}"
        else:
            # job_id may be at top level or nested under a remaining "reply" key
            inner = start_r.get("reply") if isinstance(start_r.get("reply"), dict) else start_r
            job_id = inner.get("job_id") or start_r.get("job_id")
            if not job_id:
                return [], f"No job_id returned. Response: {str(start_r)[:300]}"

        for attempt in range(30):
            _t.sleep(2)
            res = xsiam_post("xql/get_query_results", {
                "query_id": job_id,
                "format": "json",
                "num_of_results": limit
            })
            # xsiam_post unwraps "reply", so res IS the reply dict
            if not isinstance(res, dict):
                continue
            # Handle both unwrapped (res = reply contents) and wrapped (res has "reply" key)
            reply = res.get("reply") if isinstance(res.get("reply"), dict) else res
            status = reply.get("status", "")
            if status == "SUCCESS":
                data = (reply.get("results") or {}).get("data") or []
                return data, None
            if status == "PARTIAL_SUCCESS":
                data = (reply.get("results") or {}).get("data") or []
                return data, None
            if status in ("FAILED", "FAIL", "ERROR", "CANCELLED", "CANCELED", "TIMEOUT", "INVALID"):
                return [], f"Query {status}: {reply.get('error_message', reply.get('err_msg', str(reply)[:200]))}"
            # Unknown non-empty terminal status — surface it rather than silently looping
            if status and status not in ("PENDING", "RUNNING", "EXECUTING"):
                return [], f"Unexpected query status: {status} — {str(reply)[:200]}"
        return [], "Query timed out after 60 seconds"
    except Exception as exc:
        return [], str(exc)


_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"

def _get_kev_cve_ids():
    """Return set of CVE IDs from CISA KEV catalogue."""
    def fetch():
        r = requests.get(_KEV_URL, headers=_RSS_HEADERS, timeout=15, verify=False)
        r.raise_for_status()
        return {v["cveID"].upper() for v in r.json().get("vulnerabilities", [])}
    result, _ = _get_cached("kev_ids", fetch)
    return result or set()


def _get_recent_kev(days=15):
    """Return KEV entries added in last N days."""
    try:
        def fetch():
            r = requests.get(_KEV_URL, headers=_RSS_HEADERS, timeout=15, verify=False)
            r.raise_for_status()
            return r.json().get("vulnerabilities", [])
        vulns, stale = _get_cached("kev_full", fetch)
        if not vulns: return []
        cutoff = datetime.utcnow() - timedelta(days=days)
        recent = []
        for v in vulns:
            try:
                added = datetime.strptime(v.get("dateAdded",""), "%Y-%m-%d")
                if added >= cutoff:
                    recent.append({
                        "cve_id":      v.get("cveID",""),
                        "product":     v.get("product",""),
                        "vendor":      v.get("vendorProject",""),
                        "description": v.get("shortDescription","")[:100],
                        "date_added":  v.get("dateAdded",""),
                        "due_date":    v.get("dueDate",""),
                    })
            except Exception:
                pass
        return sorted(recent, key=lambda x: x["date_added"], reverse=True)[:10]
    except Exception:
        return []


@app.route("/api/attack_surface")
def api_attack_surface():
    """Attack Surface — Xpanse observations + endpoint inventory.

    Tries multiple data sources in priority order:
    1. xpanse/get_attack_surface_rules  — ASM rule violations (observations)
    2. xpanse/get_assets_internet_exposure — internet-facing assets
    3. XQL: xpanse_asset dataset
    4. XQL: asm_enriched_internet_facing_assets dataset
    5. Alerts API filtered to ASM/Xpanse source
    Then always adds endpoint agent inventory as a second panel.
    """
    _debug = []

    # ── 1. Xpanse attack surface rule violations (observations) ──────────────
    observations = []
    obs_by_category = {}
    try:
        obs_r = xsiam_post("xpanse/get_attack_surface_rules", {
            "filters": [],
            "search_from": 0,
            "search_to": 100,
            "sort": {"field": "created_at", "keyword": "desc"}
        })
        raw_obs = obs_r.get("attack_surface_rules", []) or obs_r.get("rules", []) or []
        for o in raw_obs:
            cat  = (o.get("category") or o.get("rule_category") or "Exposure").strip()
            name = (o.get("rule_name") or o.get("name") or o.get("attack_surface_rule_id") or "Unknown")
            sev  = (o.get("severity") or o.get("priority") or "medium").lower()
            cnt  = o.get("assets_count") or o.get("affected_assets_count") or 0
            observations.append({"name": name, "category": cat, "severity": sev, "assets_count": cnt})
            obs_by_category[cat] = obs_by_category.get(cat, 0) + (cnt if cnt else 1)
        _debug.append(f"xpanse/get_attack_surface_rules: {len(observations)} rules")
    except Exception as e:
        _debug.append(f"xpanse/get_attack_surface_rules failed: {e}")

    # ── 2. Xpanse internet-facing assets ─────────────────────────────────────
    xpanse_assets = []
    try:
        assets_r = xsiam_post("xpanse/get_assets_internet_exposure", {
            "filters": [],
            "search_from": 0,
            "search_to": 50,
            "sort": {"field": "asm_id", "keyword": "desc"}
        })
        raw_assets = (assets_r.get("assets_internet_exposure") or
                      assets_r.get("internet_exposure_assets") or
                      assets_r.get("assets") or [])
        for a in raw_assets:
            xpanse_assets.append({
                "name":    a.get("asset_name") or a.get("name") or "Unknown",
                "type":    a.get("asset_type") or a.get("type") or "—",
                "ips":     (a.get("ipv4_addresses") or a.get("ip_addresses") or [])[:3],
                "domains": (a.get("domain_names") or [])[:2],
                "last_seen": a.get("last_observed") or a.get("last_seen") or 0,
                "providers": (a.get("externally_detected_providers") or [])[:2],
                "services":  a.get("service_type") or a.get("services") or "",
            })
        _debug.append(f"xpanse/get_assets_internet_exposure: {len(xpanse_assets)} assets")
    except Exception as e:
        _debug.append(f"xpanse/get_assets_internet_exposure failed: {e}")

    # ── 3. XQL fallbacks if API gave nothing ──────────────────────────────────
    if not xpanse_assets:
        for xql_dataset in [
            ("dataset = xpanse_asset "
             "| fields asset_name, asset_type, ipv4_addresses, domain_names, "
             "         externally_detected_providers, last_observed "
             "| sort desc last_observed | limit 50"),
            ("dataset = asm_enriched_internet_facing_assets "
             "| fields asset_name, asset_type, externally_detected_providers, "
             "         asm_system_tags, service_type, last_observed "
             "| sort desc last_observed | limit 50"),
        ]:
            try:
                rows, _ = _run_xql_sync(xql_dataset, timeframe="90d", limit=50)
                if rows:
                    for r in rows:
                        xpanse_assets.append({
                            "name":    r.get("asset_name") or "Unknown",
                            "type":    r.get("asset_type") or "—",
                            "ips":     r.get("ipv4_addresses") or [],
                            "domains": r.get("domain_names") or [],
                            "last_seen": r.get("last_observed") or 0,
                            "providers": r.get("externally_detected_providers") or [],
                            "services":  r.get("service_type") or "",
                        })
                    _debug.append(f"XQL {xql_dataset[:40]}: {len(rows)} rows")
                    break
            except Exception as e:
                _debug.append(f"XQL fallback failed: {e}")

    # ── 4. Alert-based fallback — Xpanse/ASM source alerts ───────────────────
    asm_alerts = []
    if not xpanse_assets and not observations:
        try:
            ar = xsiam_post("alerts/get_alerts_multi_events", {
                "filters": [{"field": "severity", "operator": "in",
                             "value": ["critical","high","medium","low"]}],
                "search_from": 0, "search_to": 100,
                "sort": {"field": "source_insert_ts", "keyword": "desc"}
            })
            for a in ar.get("alerts", []):
                src = (a.get("source") or a.get("alert_source") or "").lower()
                domain = (a.get("alert_domain") or "").lower()
                if any(k in src or k in domain for k in ["asm","xpanse","xps","attack surface","internet exposure"]):
                    asm_alerts.append({
                        "name": a.get("name") or a.get("alert_name") or "ASM Alert",
                        "severity": (a.get("severity") or "medium").lower(),
                        "source": src,
                        "ts": a.get("source_insert_ts") or 0,
                        "host": a.get("host_name") or a.get("hostname") or "",
                    })
            if asm_alerts:
                _debug.append(f"ASM alerts via alerts API: {len(asm_alerts)}")
        except Exception as e:
            _debug.append(f"Alert ASM fallback failed: {e}")

    # ── 5. Always fetch endpoint inventory ────────────────────────────────────
    ep_total, ep_connected, ep_disconnected, ep_lost = 0, 0, 0, 0
    os_dist = {}
    try:
        ep_r = xsiam_post("endpoints/get_endpoints", {"filters":[],"search_from":0,"search_to":100})
        eps  = ep_r.get("endpoints", [])
        ep_total = len(eps)
        for e in eps:
            os_  = (e.get("os_type") or "Unknown").title()
            st   = (e.get("endpoint_status") or "Unknown").title()
            os_dist[os_] = os_dist.get(os_, 0) + 1
            if "connect" in st.lower():   ep_connected    += 1
            elif "disconnect" in st.lower(): ep_disconnected += 1
            elif "lost" in st.lower():      ep_lost         += 1
    except Exception as e:
        _debug.append(f"endpoints/get_endpoints failed: {e}")

    has_xpanse = bool(xpanse_assets or observations or asm_alerts)
    coverage_pct = round(ep_connected / ep_total * 100) if ep_total else 0

    return jsonify({
        "available":         True,
        "has_xpanse":        has_xpanse,
        # Xpanse observations (rule violations)
        "observations":      observations[:30],
        "obs_by_category":   [{"cat": k, "count": v}
                               for k, v in sorted(obs_by_category.items(), key=lambda x:-x[1])],
        "total_observations": sum(obs_by_category.values()),
        # Internet-facing assets
        "xpanse_assets":     xpanse_assets[:20],
        "total_assets":      len(xpanse_assets),
        # Alert-based ASM findings
        "asm_alerts":        asm_alerts[:10],
        # Endpoint agent inventory
        "total":             ep_total,
        "connected":         ep_connected,
        "disconnected":      ep_disconnected,
        "lost":              ep_lost,
        "coverage_pct":      coverage_pct,
        "os_distribution":   [{"os": k, "count": v}
                               for k, v in sorted(os_dist.items(), key=lambda x:-x[1])],
        "_debug":            _debug,
    })


@app.route("/api/risky_users")
def api_risky_users():
    """User risk scores from UEBA/DLP/AD/Proxy/Leaked-Credential signals."""
    scores = _build_user_risk_scores()
    scores.sort(key=lambda x: -x["score"])
    return jsonify({"users": scores[:10], "total": len(scores)})


# ── User risk cache (TTL 5 min) — shared between risky-users endpoint and posture ──
_user_risk_cache = {"data": None, "ts": 0}
_USER_RISK_TTL = 300  # seconds

def _build_user_risk_scores():
    global _user_risk_cache
    now = _time.time()
    if _user_risk_cache["data"] is not None and (now - _user_risk_cache["ts"]) < _USER_RISK_TTL:
        return _user_risk_cache["data"]

    fifteen = fifteen_days_ago_ms()
    user_map = {}

    def _add(user, delta, driver, severity="high", alert_name="", ts=0, host="", ip=""):
        if not user or user.lower() in ("","unknown","n/a","system","nt authority\\system"):
            return
        u = user.lower().strip()
        if u not in user_map:
            user_map[u] = {"user": user, "score": 0, "drivers": [], "leaked": False,
                           "last_alerts": [], "last_seen": 0}
        user_map[u]["score"] = min(100, user_map[u]["score"] + delta)
        if driver not in user_map[u]["drivers"]:
            user_map[u]["drivers"].append(driver)
        if alert_name:
            user_map[u]["last_alerts"].append({
                "name": alert_name[:80], "severity": severity, "ts": ts,
                "host": host, "ip": ip
            })
        if ts and ts > user_map[u].get("last_seen", 0):
            user_map[u]["last_seen"] = ts

    # ── 1. Pull high/critical alerts with user context ─────────────────────
    try:
        alert_r = xsiam_post("alerts/get_alerts_multi_events", {
            "filters": [{"field":"severity","operator":"in","value":["critical","high"]}],
            "search_from": 0, "search_to": 100,
            "sort": {"field":"source_insert_ts","keyword":"desc"}
        })
        for a in alert_r.get("alerts", []):
            user = a.get("actor_effective_username") or a.get("user_name") or ""
            if not user: continue
            sev  = (a.get("severity") or "").lower()
            name_raw = (a.get("name") or a.get("alert_name") or "")
            name = name_raw.lower()
            src  = (a.get("source") or a.get("alert_source") or "").lower()
            pts  = 25 if sev == "critical" else 15
            ts_a = a.get("source_insert_ts") or a.get("detection_timestamp") or 0
            host_a = a.get("host_name") or a.get("hostname") or ""
            ip_a   = a.get("action_remote_ip") or a.get("local_insert_ts") or ""

            # Leaked / compromised credential — highest weight
            if any(k in name for k in ["leak","credential","compromise","breach","pwned","dump","kerberoast","pass-the"]):
                _add(user, 50, "Leaked/Compromised Credential", sev, name_raw, ts_a, host_a, ip_a)
                user_map[user.lower().strip()]["leaked"] = True
            # DLP
            elif "dlp" in src or "data loss" in name or "exfiltrat" in name:
                _add(user, pts+5, "DLP Violation", sev, name_raw, ts_a, host_a, ip_a)
            # AD / privilege escalation
            elif any(k in name for k in ["privilege","escalat","admin","lateral","golden ticket","silver ticket","dcsync"]):
                _add(user, pts+10, "Privilege Escalation / AD Anomaly", sev, name_raw, ts_a, host_a, ip_a)
            # Proxy / web anomaly
            elif any(k in src for k in ["proxy","web","url","zscaler","squid","bluecoat"]):
                _add(user, 15 if sev=="critical" else 10, "Proxy/Web Anomaly", sev, name_raw, ts_a, host_a, ip_a)
            # UEBA
            elif any(k in src for k in ["ueba","identity","behaviour","behavior"]):
                _add(user, pts, "UEBA Anomaly", sev, name_raw, ts_a, host_a, ip_a)
            else:
                _add(user, 10, "Security Alert", sev, name_raw, ts_a, host_a, ip_a)
    except Exception:
        pass

    # ── 2. XQL: High-volume uploaders as risk proxy ────────────────────────
    # Note: xdr_data contains Fortigate firewall logs — no severity/alert_name/UEBA fields.
    # Use large outbound uploads (>50 MB) as a risk signal. Store size details for drill-down.
    try:
        xql = ("dataset = xdr_data "
               "| filter action_total_upload > 52428800 "
               "| fields actor_effective_username, agent_hostname, action_total_upload, action_remote_ip, _time "
               "| sort desc action_total_upload "
               "| limit 200")
        rows, _ = _run_xql_sync(xql, timeframe="15d", limit=200)
        for row in rows:
            user    = row.get("actor_effective_username") or ""
            upload  = row.get("action_total_upload") or 0
            host    = row.get("agent_hostname") or ""
            rip     = row.get("action_remote_ip") or ""
            ts_r    = row.get("_time") or 0
            pts     = 40 if upload > 1073741824 else 20   # 40 pts for >1 GB, else 20
            upload_mb = round(upload / 1048576, 1)
            driver_label = f"Large Upload ({upload_mb} MB → {rip or 'external'})"
            _add(user, pts, driver_label, "medium",
                 f"Data upload {upload_mb} MB to {rip or 'external host'}",
                 ts_r, host, rip)
    except Exception:
        pass

    # ── 3. Assign risk tiers ───────────────────────────────────────────────
    result = []
    for u, data in user_map.items():
        s = data["score"]
        tier = ("Critical" if s >= 75 else "High" if s >= 50
                else "Elevated" if s >= 25 else "Watch")
        # Use CSS variable names so JS can apply theming — but we still need a
        # hex fallback for the mini bar in the table (inline style attr).
        tier_color = {"Critical":"#e53e3e","High":"#e07d1c",
                      "Elevated":"#d4a017","Watch":"#48bb78"}[tier]
        result.append({
            "user":        data["user"],
            "score":       s,
            "tier":        tier,
            "tier_color":  tier_color,
            "drivers":     data["drivers"][:3],
            "leaked":      data["leaked"],
            "last_seen":   data.get("last_seen", 0),
            "last_alerts": sorted(data.get("last_alerts", []), key=lambda x: -(x.get("ts") or 0))[:5],
        })
    # Store in cache
    _user_risk_cache["data"] = result
    _user_risk_cache["ts"]   = _time.time()
    return result


@app.route("/api/threat_intel")
def api_threat_intel():
    """Fetch CERT-In (via Google News + NVD), Unit 42, CISA KEV feeds."""

    # ── CERT-In advisories via Google News RSS ────────────────────────────
    # CERT-In's website is 100% JavaScript-rendered — not scrapeable.
    # Google News RSS is free, no key needed, and Indian tech media (ET,
    # NDTV, Hindu BL, Inc42) report CERT-In advisories within hours.
    # We run TWO searches: one for official CERT-In alerts, one BFSI-specific.
    def _fetch_certin_news():
        import urllib.parse as _up
        queries = [
            'CERT-In advisory vulnerability',
            'CERT-In alert India BFSI bank',
        ]
        seen, items = set(), []
        for q in queries:
            encoded = _up.quote(q)
            # Google News RSS — India edition
            url = (f"https://news.google.com/rss/search"
                   f"?q={encoded}&hl=en-IN&gl=IN&ceid=IN:en")
            try:
                rss_items = _fetch_rss(url, max_items=15)
                for item in rss_items:
                    title = item.get("title","")
                    link  = item.get("link","")
                    if link in seen:
                        continue
                    seen.add(link)
                    # Only keep articles that actually mention CERT-In
                    if _re.search(r'cert.?in|cert-in|certIn', title, _re.IGNORECASE):
                        items.append({**item, "bfsi": _is_bfsi(title)})
            except Exception:
                continue
        items.sort(key=lambda x: not x.get("bfsi"))
        return items[:15]

    # ── NVD CRITICAL/HIGH CVEs — enriched with affected products ────────
    def _extract_affected_products(cve):
        """Parse CPE data to extract a human-readable list of affected systems."""
        seen, products = set(), []
        for cfg in cve.get("configurations", []):
            for node in cfg.get("nodes", []):
                for cpe_match in node.get("cpeMatch", []):
                    if not cpe_match.get("vulnerable", True):
                        continue
                    criteria = cpe_match.get("criteria", "")
                    parts = criteria.split(":")
                    if len(parts) < 6:
                        continue
                    cpe_type = parts[2]   # a=app, o=os, h=hardware
                    vendor   = parts[3].replace("_", " ").title()
                    product  = parts[4].replace("_", " ").title()
                    ver      = parts[5] if parts[5] not in ("*", "-", "") else ""
                    # Version range from versionStartIncluding / versionEndExcluding
                    ver_start = cpe_match.get("versionStartIncluding","")
                    ver_end   = cpe_match.get("versionEndExcluding","")
                    if ver_start and ver_end:
                        ver_label = f"v{ver_start}–{ver_end}"
                    elif ver_start:
                        ver_label = f"≥ v{ver_start}"
                    elif ver_end:
                        ver_label = f"< v{ver_end}"
                    elif ver:
                        ver_label = f"v{ver}"
                    else:
                        ver_label = ""
                    type_prefix = {"o": "OS: ", "h": "HW: "}.get(cpe_type, "")
                    label = f"{type_prefix}{vendor} {product}" + (f" {ver_label}" if ver_label else "")
                    if label not in seen:
                        seen.add(label)
                        products.append({"label": label, "type": cpe_type})
                    if len(products) >= 6:
                        return products
        return products

    def _get_cvss(cve):
        """Return (score, vector) from best available CVSS metric."""
        for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
            metrics = cve.get("metrics", {}).get(key, [])
            if metrics:
                d = metrics[0].get("cvssData", {})
                score = d.get("baseScore")
                vector = d.get("attackVector") or d.get("accessVector","")
                return score, vector
        return None, ""

    def _fetch_nvd():
        cutoff  = (datetime.utcnow() - timedelta(days=15)).strftime("%Y-%m-%dT00:00:00.000")
        now_str = datetime.utcnow().strftime("%Y-%m-%dT23:59:59.999")
        items   = []
        for severity in ("CRITICAL", "HIGH"):
            if len(items) >= 15:
                break
            url = (f"https://services.nvd.nist.gov/rest/json/cves/2.0"
                   f"?pubStartDate={cutoff}&pubEndDate={now_str}"
                   f"&cvssV3Severity={severity}&resultsPerPage=20")
            try:
                r = requests.get(url, headers=_RSS_HEADERS, timeout=20, verify=False)
                if r.status_code != 200:
                    continue
                for vuln in r.json().get("vulnerabilities", []):
                    cve       = vuln.get("cve", {})
                    cve_id    = cve.get("id", "")
                    descs     = cve.get("descriptions", [])
                    desc      = next((d["value"] for d in descs if d.get("lang") == "en"), "")
                    link      = f"https://nvd.nist.gov/vuln/detail/{cve_id}"
                    published = (cve.get("published") or "")[:10]
                    score, vector = _get_cvss(cve)
                    affected  = _extract_affected_products(cve)
                    # CWE
                    weaknesses = cve.get("weaknesses", [])
                    cwe = ""
                    if weaknesses:
                        cwe_descs = weaknesses[0].get("description", [])
                        cwe = next((d["value"] for d in cwe_descs if d.get("lang") == "en"), "")
                    items.append({
                        "cve_id":    cve_id,
                        "title":     f"{cve_id} — {desc[:100]}" if desc else cve_id,
                        "desc":      desc[:300],
                        "link":      link,
                        "date":      published,
                        "bfsi":      _is_bfsi(desc),
                        "severity":  severity,
                        "cvss":      score,
                        "vector":    vector,
                        "cwe":       cwe,
                        "affected":  affected,
                        "source":    f"NVD/CERT-In ({severity})",
                        "source_color": "#e53e3e" if severity == "CRITICAL" else "#e07d1c",
                    })
                    if len(items) >= 20:
                        break
            except Exception:
                continue
        items.sort(key=lambda x: (not x.get("bfsi"), -(x.get("cvss") or 0)))
        return items[:15]

    certin_news,  certin_news_stale  = _get_cached("certin_news",  _fetch_certin_news)
    certin_nvd,   certin_nvd_stale   = _get_cached("certin_nvd",   _fetch_nvd)
    certin_stale = certin_news_stale or certin_nvd_stale

    # ── Unit 42 ────────────────────────────────────────────────────────────
    unit42, unit42_stale = _get_cached("unit42",
        lambda: _fetch_rss("https://unit42.paloaltonetworks.com/feed/", 20))

    # ── CISA KEV (recent additions) ───────────────────────────────────────
    kev_recent = _get_recent_kev(days=15)

    # ── Build unified feed ─────────────────────────────────────────────────
    feed = []

    # Tier 1a: CERT-In news (Google News — actual CERT-In advisory coverage)
    for item in (certin_news or []):
        feed.append({**item, "source": "CERT-In (News)", "tier": 1,
                     "source_color": "#c0392b", "bfsi": item.get("bfsi", False)})

    # Tier 1b: NVD CRITICAL/HIGH CVEs (primary source CERT-In uses)
    for item in (certin_nvd or []):
        sev   = item.get("severity", "")
        label = f"NVD/CERT-In ({sev})" if sev else "NVD/CERT-In"
        feed.append({**item, "source": label, "tier": 1,
                     "source_color": "#e53e3e", "bfsi": item.get("bfsi", False)})

    # Tier 2: Unit 42 BFSI-tagged
    for item in (unit42 or []):
        if item.get("bfsi"):
            feed.append({**item, "source": "Unit 42 (BFSI)", "tier": 2,
                         "source_color": "#d4a017"})

    # Tier 2b: CISA KEV recent additions
    for k in kev_recent:
        feed.append({
            "title":        f"{k['cve_id']} — {k['vendor']} {k['product']}",
            "link":         f"https://nvd.nist.gov/vuln/detail/{k['cve_id']}",
            "date":         k["date_added"],
            "source":       "CISA KEV",
            "tier":         2,
            "source_color": "#e07d1c",
            "bfsi":         False,
        })

    # Tier 3: Unit 42 non-BFSI (max 5)
    for item in [i for i in (unit42 or []) if not i.get("bfsi")][:5]:
        feed.append({**item, "source": "Unit 42", "tier": 3,
                     "source_color": "#718096"})

    # Sort: tier asc, BFSI first within tier, then date desc
    feed.sort(key=lambda x: (x["tier"], not x.get("bfsi"), -(x.get("date","") or "").__len__()))

    return jsonify({
        "feed":          feed[:35],
        "certin_stale":  certin_stale,
        "unit42_stale":  unit42_stale,
        "last_updated":  datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    })


@app.route("/api/debug_feeds")
def api_debug_feeds():
    """Show connectivity + body preview for diagnosing empty threat intel."""
    test_urls = {
        "certin_rss":   "https://www.cert-in.org.in/RSS/advisoriesrss.xml",
        "certin_page1": "https://www.cert-in.org.in/s2cMainServlet?pageid=PUBVLNOTES01",
        "certin_page2": "https://www.cert-in.org.in/s2cMainServlet?pageid=PUBVLNOTES02",
        "unit42":       "https://unit42.paloaltonetworks.com/feed/",
        "cisa_kev":     "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    }
    results = {}
    for key, url in test_urls.items():
        try:
            r = requests.get(url, headers=_RSS_HEADERS, timeout=12,
                             verify=False, allow_redirects=True)
            body = r.text[:1500].replace("\r", "").replace("\n", " ")
            results[key] = {
                "ok": r.status_code == 200,
                "http_status": r.status_code,
                "bytes": len(r.content),
                "content_type": r.headers.get("content-type", "?"),
                "final_url": r.url,
                "body_preview": body,
                "cached_error": _feed_errors.get(key),
            }
        except Exception as e:
            results[key] = {"ok": False, "error": str(e), "cached_error": _feed_errors.get(key)}
    return jsonify({"feed_status": results, "cached_errors": _feed_errors})


@app.route("/api/debug_xql")
def api_debug_xql():
    """Show raw XSIAM response for a minimal XQL query — polls results to expose status values."""
    import time as _t
    try:
        now_ms  = int(_time.time() * 1000)
        from_ms = now_ms - (15 * 86400 * 1000)
        query = "dataset = xdr_data | fields _time | limit 1"
        base = f"https://{_clean_tenant_url(_get_creds()[0])}/public_api/v1"

        # ── Step 1: start query (raw) ──────────────────────────────────────
        r1 = requests.post(f"{base}/xql/start_xql_query",
                           headers=get_auth_headers(),
                           json={"request_data": {"query": query,
                                 "timeframe": {"from": from_ms, "to": now_ms}}},
                           timeout=30, verify=False)
        raw_start = r1.json()
        # Extract job_id from raw response
        reply_val = raw_start.get("reply")
        if isinstance(reply_val, str):
            job_id = reply_val
        elif isinstance(reply_val, dict):
            job_id = reply_val.get("job_id")
        else:
            job_id = None

        if not job_id:
            return jsonify({"error": "No job_id", "raw_start": raw_start})

        # ── Step 2: poll results (raw) — 3 attempts ───────────────────────
        poll_results = []
        for i in range(3):
            _t.sleep(3)
            r2 = requests.post(f"{base}/xql/get_query_results",
                               headers=get_auth_headers(),
                               json={"request_data": {"query_id": job_id,
                                     "format": "json", "num_of_results": 1}},
                               timeout=30, verify=False)
            raw_poll = r2.json()
            poll_results.append({"attempt": i+1, "raw": raw_poll})
            # Stop early if we have a terminal status
            reply_poll = raw_poll.get("reply", {})
            if isinstance(reply_poll, dict):
                st = reply_poll.get("status","")
                if st and st not in ("PENDING","RUNNING","EXECUTING"):
                    break

        return jsonify({
            "job_id":       job_id,
            "raw_start":    raw_start,
            "poll_results": poll_results,
        })
    except Exception as ex:
        return jsonify({"error": str(ex)})


@app.route("/api/debug_certin")
def api_debug_certin():
    """Test alternative CERT-In data sources and direct advisory page probing."""
    results = {}
    year = datetime.utcnow().year

    # ── 1. Vulners RSS — aggregates CERT-In advisories ────────────────────
    vulners_urls = {
        "vulners_certinvn": "https://vulners.com/rss.xml?query=type:certinvn",
        "vulners_certin":   "https://vulners.com/rss.xml?query=affectedSoftware.name:cert-in",
    }
    for key, url in vulners_urls.items():
        try:
            r = requests.get(url, headers=_RSS_HEADERS, timeout=12, verify=False)
            body = r.text[:2000]
            ids = _re.findall(r'CI[A-Z]{2,4}-\d{4}-\d+', r.text)
            results[key] = {"status": r.status_code, "bytes": len(r.content),
                            "content_type": r.headers.get("content-type","?"),
                            "ids_found": list(dict.fromkeys(ids))[:10],
                            "preview": body}
        except Exception as e:
            results[key] = {"error": str(e)}

    # ── 2. Direct CERT-In advisory detail pages (sequential ID probing) ──
    # CERT-In IDs: CIVN-YYYY-NNNN — try probing IDs 0001..0060 for current year
    # Check if detail pages are server-rendered (not JS-rendered like list page)
    test_ids = [f"CIVN-{year}-{str(i).zfill(4)}" for i in [1, 5, 10, 20, 30]]
    for tid in test_ids:
        url = (f"https://www.cert-in.org.in/s2cMainServlet"
               f"?pageid=PUBVLNOTES01&type=1&typeid={tid}")
        try:
            r = requests.get(url, headers=_RSS_HEADERS, timeout=10, verify=False)
            body = r.text
            has_content = "not available" not in body.lower() and len(body) > 3000
            results[f"detail_{tid}"] = {
                "status": r.status_code,
                "bytes": len(body),
                "has_real_content": has_content,
                "preview": body[1500:2500] if has_content else body[:500],
            }
        except Exception as e:
            results[f"detail_{tid}"] = {"error": str(e)}

    # ── 3. CERT-In via SecurityAffairs RSS (covers Indian CERT alerts) ────
    try:
        r = requests.get("https://securityaffairs.com/feed", headers=_RSS_HEADERS,
                         timeout=12, verify=False)
        certin_items = _re.findall(r'<title>[^<]*(?:cert.in|cert-in|india)[^<]*</title>',
                                   r.text, _re.IGNORECASE)[:5]
        results["securityaffairs"] = {
            "status": r.status_code, "bytes": len(r.content),
            "certin_titles": certin_items,
        }
    except Exception as e:
        results["securityaffairs"] = {"error": str(e)}

    return jsonify(results)

@app.route("/api/mitre_tactics_ciso")
def api_mitre_tactics_ciso():
    """MITRE tactics — 15-day window, all severities.

    Priority:
    1. mitre_tactics_ids_and_names on incidents (populated by XSIAM when available)
    2. alert category field — XSIAM already maps this to MITRE tactic names
       e.g. category='Execution' maps directly to the MITRE Execution tactic
    3. mitre_tactic_id_and_name on alerts (some alert types populate this)
    4. bioc_category_enum_key on alerts (BIOC/behavioural alerts)
    5. Keyword fallback on name+description+source
    """
    fifteen = fifteen_days_ago_ms()
    tactics = {}

    # ── Pass 1: incidents mitre_tactics_ids_and_names ─────────────────────────
    try:
        result = xsiam_post("incidents/get_incidents", {
            "filters": [{"field":"creation_time","operator":"gte","value":fifteen}],
            "search_from": 0, "search_to": 100,
            "sort": {"field":"creation_time","keyword":"desc"}
        })
        for i in result.get("incidents", []):
            for m in (i.get("mitre_tactics_ids_and_names") or []):
                name = m.split(" - ")[-1] if " - " in m else m
                if name: tactics[name] = tactics.get(name, 0) + 1
    except Exception:
        result = {}

    # ── Pass 2+3+4+5: alerts — category field is primary, then MITRE fields ──
    # The XSIAM 'category' field on alerts is already mapped to MITRE tactic names.
    # e.g. {"category": "Execution"} → Execution tactic, no keyword scan needed.
    # BIOC/behavioral alerts use bioc_category_enum_key (UPPERCASE tactic name).
    MITRE_TACTIC_NAMES = {
        "execution","persistence","privilege escalation","defense evasion",
        "credential access","discovery","lateral movement","collection",
        "command and control","exfiltration","impact","initial access",
        "reconnaissance","resource development",
    }
    # Map common category variants → canonical MITRE tactic name
    CATEGORY_MAP = {
        "execution":            "Execution",
        "persistence":          "Persistence",
        "privilege escalation": "Privilege Escalation",
        "defense evasion":      "Defense Evasion",
        "credential access":    "Credential Access",
        "discovery":            "Discovery",
        "lateral movement":     "Lateral Movement",
        "collection":           "Collection",
        "command and control":  "Command and Control",
        "c2":                   "Command and Control",
        "exfiltration":         "Exfiltration",
        "impact":               "Impact",
        "initial access":       "Initial Access",
        "reconnaissance":       "Reconnaissance",
        "resource development": "Resource Development",
        # Skyhigh / DLP mapped to closest MITRE
        "data loss prevention": "Exfiltration",
        "dlp":                  "Exfiltration",
        "cloud":                "Exfiltration",
        "network":              "Command and Control",
        "malware":              "Execution",
        "exploit":              "Initial Access",
        "vulnerability":        "Initial Access",
    }

    try:
        alert_r = xsiam_post("alerts/get_alerts_multi_events", {
            "filters": [{"field":"severity","operator":"in","value":["critical","high","medium","low"]}],
            "search_from": 0, "search_to": 500,
            "sort": {"field":"source_insert_ts","keyword":"desc"}
        })
        for a in alert_r.get("alerts", []):
            added = set()

            # Method A: category field (most reliable in real XSIAM data)
            cat = (a.get("category") or "").strip()
            mapped = CATEGORY_MAP.get(cat.lower())
            if mapped and mapped not in added:
                tactics[mapped] = tactics.get(mapped, 0) + 1
                added.add(mapped)

            # Method B: mitre_tactic_id_and_name on alert (e.g. "TA0002 - Execution")
            for field in ["mitre_tactic_id_and_name","mitre_technique_id_and_name"]:
                for m in (a.get(field) or []):
                    name = m.split(" - ")[-1] if " - " in m else m
                    if name and name not in added:
                        tactics[name] = tactics.get(name, 0) + 1
                        added.add(name)

            # Method C: bioc_category_enum_key (UPPERCASE MITRE tactic from BIOC rules)
            bioc = (a.get("bioc_category_enum_key") or "").strip().title()
            if bioc:
                b_mapped = CATEGORY_MAP.get(bioc.lower(), bioc if bioc.lower() in MITRE_TACTIC_NAMES else None)
                if b_mapped and b_mapped not in added:
                    tactics[b_mapped] = tactics.get(b_mapped, 0) + 1
                    added.add(b_mapped)

            # Method D: keyword fallback on name + description (only if nothing matched yet)
            if not added:
                KWORDS = {
                    "Initial Access":      ["phish","exploit","cve-","brute force","unauthorized","ips block","attack.","intrusion"],
                    "Execution":           ["execute","powershell","cmd.exe","script","rundll32","regsvr32","wscript","mshta","base64"],
                    "Persistence":         ["persist","scheduled task","autorun","startup","backdoor","service install"],
                    "Privilege Escalation":["privilege","escalat","uac","token","runas","impersonat"],
                    "Defense Evasion":     ["evasion","obfuscat","encoded","masquerad","log clear","disable av"],
                    "Credential Access":   ["credential","mimikatz","lsass","ntlm","kerberoast","password","leaked"],
                    "Discovery":           ["scan","enum","nmap","discovery","reconnaissance","port scan"],
                    "Lateral Movement":    ["lateral","psexec","rdp","wmi","smb","pass-the"],
                    "Collection":          ["dlp","data loss","shadow it","cloud app","policy violation","keylog","clipboard"],
                    "Command and Control": ["c2","beacon","botnet","malicious url","dns tunnel","rat"],
                    "Exfiltration":        ["exfil","upload","large upload","skyhigh","casb","cloud upload","transfer"],
                    "Impact":              ["ransomware","encrypt","wipe","ddos","denial of service","ransom"],
                }
                text = ((a.get("name") or a.get("alert_name") or "") + " " +
                        (a.get("description") or "") + " " +
                        (a.get("source") or a.get("alert_source") or "")).lower()
                for tactic, kws in KWORDS.items():
                    if any(k in text for k in kws) and tactic not in added:
                        tactics[tactic] = tactics.get(tactic, 0) + 1
                        added.add(tactic)
    except Exception:
        pass

    # ── Incident-based fallback (for SIEM tenants with no XDR alert data) ────
    # When alerts/get_alerts_multi_events returns 0 results the tactics dict will
    # be empty.  In that case, derive MITRE tactics from incident names and sources.
    if not tactics:
        INC_KWORDS = {
            "Initial Access":       ["phish","exploit","cve-","brute force","unauthorized access",
                                     "ips block","attack.","intrusion","login fail","blocked"],
            "Execution":            ["execute","powershell","cmd.exe","script","rundll32","wscript",
                                     "mshta","base64","macro","malware execut"],
            "Persistence":          ["persist","scheduled task","autorun","startup","backdoor",
                                     "service install","new account"],
            "Privilege Escalation": ["privilege","escalat","uac","token","runas","impersonat",
                                     "admin access"],
            "Defense Evasion":      ["evasion","obfuscat","encoded","masquerad","log clear",
                                     "disable av","bypass","anomal"],
            "Credential Access":    ["credential","mimikatz","lsass","ntlm","kerberoast","password",
                                     "leaked","geolocation","stale","abnormal","impossible travel",
                                     "unusual login","varonis","ueba"],
            "Discovery":            ["scan","enum","nmap","discovery","reconnaissance","port scan",
                                     "enumerat","asset discov"],
            "Lateral Movement":     ["lateral","psexec","rdp","wmi","smb","pass-the","remote"],
            "Collection":           ["dlp","data loss","shadow it","cloud app","policy violation",
                                     "keylog","clipboard","symantec dlp","download","email attach"],
            "Command and Control":  ["c2","beacon","botnet","malicious url","dns tunnel","rat",
                                     "command and control","c&c"],
            "Exfiltration":         ["exfil","upload","large upload","skyhigh","casb","cloud upload",
                                     "transfer","data transfer","sensitive data","leak"],
            "Impact":               ["ransomware","encrypt","wipe","ddos","denial of service","ransom"],
        }
        # Source-to-tactic hints (when source name maps clearly to a MITRE tactic)
        SRC_HINTS = {
            "skyhigh":    ["Exfiltration", "Collection"],
            "casb":       ["Exfiltration", "Collection"],
            "varonis":    ["Credential Access", "Discovery"],
            "symantec dlp": ["Collection", "Exfiltration"],
            "dlp":        ["Collection", "Exfiltration"],
            "fortinet":   ["Initial Access", "Command and Control"],
            "fortigate":  ["Initial Access", "Command and Control"],
            "crowdstrike":["Execution", "Defense Evasion"],
            "defender":   ["Execution", "Defense Evasion"],
        }
        try:
            inc_r = xsiam_post("incidents/get_incidents", {
                "filters": [{"field":"creation_time","operator":"gte",
                             "value": fifteen_days_ago_ms()}],
                "search_from": 0, "search_to": 500,
                "sort": {"field":"creation_time","keyword":"desc"}
            })
            for inc in (inc_r.get("incidents") or []):
                inc_added = set()
                # Priority 1: mitre_tactics_ids_and_names if populated
                for mt in (inc.get("mitre_tactics_ids_and_names") or []):
                    name_part = mt.split(" - ")[-1] if " - " in mt else mt
                    if name_part and name_part not in inc_added:
                        tactics[name_part] = tactics.get(name_part, 0) + 1
                        inc_added.add(name_part)

                if inc_added:
                    continue  # prefer explicit MITRE data

                text = ((inc.get("description") or "") + " " +
                        (inc.get("incident_name") or "") + " " +
                        " ".join(inc.get("alert_sources") or [])).lower()

                # Priority 2: source hints
                for src_kw, tac_list in SRC_HINTS.items():
                    if src_kw in text:
                        for t in tac_list:
                            if t not in inc_added:
                                tactics[t] = tactics.get(t, 0) + 1
                                inc_added.add(t)

                # Priority 3: keyword scan on name + description
                for tactic, kws in INC_KWORDS.items():
                    if tactic not in inc_added and any(k in text for k in kws):
                        tactics[tactic] = tactics.get(tactic, 0) + 1
                        inc_added.add(tactic)
        except Exception:
            pass

    top = sorted(tactics.items(), key=lambda x:-x[1])[:10]
    return jsonify({"tactics": [{"name":t[0],"count":t[1]} for t in top]})


# ── Query Builder — 25 fixed templates ───────────────────────────────────────
QUERY_TEMPLATES = [
    # ── Quick connectivity test ───────────────────────────────────────────
    # Uses only guaranteed base fields present in every xdr_data schema
    {"id":"xql_test","category":"Diagnostics","name":"XQL Connection Test",
     "description":"Confirm XQL API connectivity — shows data sources and network flow fields present in xdr_data",
     "vars":[],
     "xql":"dataset = xdr_data | fields _time, event_type, event_sub_type, _vendor, _product, action_local_ip, action_remote_ip, action_country, action_network_protocol | sort desc _time | limit 10"},

    # ── Incidents connectivity test ───────────────────────────────────────
    {"id":"inc_test","category":"Diagnostics","name":"Incidents Connection Test",
     "description":"Confirm incidents dataset is accessible and show field schema",
     "vars":[],
     "xql":"dataset = incidents | fields incident_id, description, severity, status, assigned_user, creation_time | sort desc creation_time | limit 5"},

    # ── Incident Investigation ────────────────────────────────────────────
    # Schema confirmed from live data: severity=UPPERCASE, status=UPPERCASE,
    # name field is null → use description, assigned_user holds the email directly
    {"id":"inc_by_sev","category":"Incidents","name":"Incidents by Severity",
     "description":"All incidents matching a severity level",
     "vars":[{"key":"SEVERITY","label":"Severity","type":"select",
               "options":["CRITICAL","HIGH","MEDIUM","LOW"],"default":"HIGH"},
              {"key":"DAYS","label":"Last N Days","type":"number","default":"15"}],
     "xql":"dataset = incidents | filter severity = \"{SEVERITY}\" | fields incident_id, description, severity, status, creation_time, assigned_user | sort desc creation_time | limit 50"},

    {"id":"inc_by_host","category":"Incidents","name":"Events on Specific Host",
     "description":"All EDR events on a hostname — process launches, network connections, auth events",
     "vars":[{"key":"HOSTNAME","label":"Hostname","type":"text","placeholder":"e.g. WIN-DC01"}],
     "xql":"dataset = xdr_data | filter agent_hostname ~= \"{HOSTNAME}\" | filter _time >= now() - 15d | fields _time, event_type, event_sub_type, actor_effective_username, actor_process_image_name, action_remote_ip, action_total_upload | sort desc _time | limit 50"},

    {"id":"inc_sla_breach","category":"Incidents","name":"SLA Breached Incidents",
     "description":"Open incidents sorted oldest-first — longest open, highest SLA breach risk",
     "vars":[{"key":"DAYS","label":"Look Back Days","type":"number","default":"15"}],
     "xql":"dataset = incidents | filter status in (\"NEW\",\"UNDER_INVESTIGATION\") | fields incident_id, description, severity, status, creation_time, assigned_user | sort asc creation_time | limit 50"},

    {"id":"inc_unassigned","category":"Incidents","name":"Unassigned Critical/High Incidents",
     "description":"Open critical/high incidents with no analyst assigned",
     "vars":[],
     "xql":"dataset = incidents | filter severity in (\"CRITICAL\",\"HIGH\") | filter status in (\"NEW\",\"UNDER_INVESTIGATION\") | filter assigned_user = null | fields incident_id, description, severity, status, creation_time | sort desc creation_time | limit 50"},

    {"id":"inc_by_analyst","category":"Incidents","name":"Incidents Assigned to Analyst",
     "description":"All active incidents assigned to a specific analyst email",
     "vars":[{"key":"EMAIL","label":"Analyst Email","type":"text","placeholder":"analyst@company.com"}],
     "xql":"dataset = incidents | filter assigned_user = \"{EMAIL}\" | filter status in (\"NEW\",\"UNDER_INVESTIGATION\") | fields incident_id, description, severity, status, creation_time, assigned_user | sort desc creation_time | limit 50"},

    # ── Vulnerability ─────────────────────────────────────────────────────
    # Note: Vulnerability data lives in the va_cves and va_endpoints datasets,
    # NOT in xdr_data. These datasets require the Vulnerability Assessment licence.
    {"id":"vuln_critical","category":"Vulnerabilities","name":"Open Critical/High CVEs",
     "description":"Critical and high severity CVEs from the Vulnerability Assessment dataset",
     "vars":[],
     "xql":"dataset = va_cves | filter severity in (\"CRITICAL\",\"HIGH\") | fields cve_id, severity, cvss_score, affected_hosts_count, description | sort desc cvss_score | limit 100"},

    {"id":"vuln_by_host","category":"Vulnerabilities","name":"Vulnerabilities on Host",
     "description":"All open vulnerabilities on a specific endpoint",
     "vars":[{"key":"HOSTNAME","label":"Hostname","type":"text","placeholder":"e.g. WIN-DC01"}],
     "xql":"dataset = va_endpoints | filter endpoint_name ~= \"{HOSTNAME}\" | fields cve_id, severity, cvss_score, endpoint_name, status | sort desc cvss_score | limit 50"},

    {"id":"vuln_by_cve","category":"Vulnerabilities","name":"Find Specific CVE",
     "description":"Which hosts are affected by a specific CVE ID",
     "vars":[{"key":"CVE","label":"CVE ID","type":"text","placeholder":"e.g. CVE-2024-12345"}],
     "xql":"dataset = va_endpoints | filter cve_id = \"{CVE}\" | fields endpoint_name, severity, cvss_score, status | sort desc cvss_score | limit 50"},

    {"id":"vuln_most_affected","category":"Vulnerabilities","name":"Most Vulnerable Assets",
     "description":"Assets with the highest count of open critical/high CVEs",
     "vars":[],
     "xql":"dataset = va_endpoints | filter severity in (\"CRITICAL\",\"HIGH\") | fields endpoint_name, cve_id | comp count(cve_id) as vuln_count by endpoint_name | sort desc vuln_count | limit 20"},

    # ── User & Identity / UEBA ────────────────────────────────────────────
    # Schema note: xdr_data contains raw EDR events — no alert_name, severity, or alert_category.
    # Use process image names, command lines, event types, and network fields instead.
    {"id":"user_risk","category":"User & Identity","name":"User Activity Profile",
     "description":"All EDR events for a specific user — network connections, process launches",
     "vars":[{"key":"USER","label":"Username or Email","type":"text","placeholder":"user@company.com"}],
     "xql":"dataset = xdr_data | filter actor_effective_username ~= \"{USER}\" | filter _time >= now() - 15d | fields _time, event_type, event_sub_type, agent_hostname, actor_process_image_name, action_remote_ip, action_country, action_total_upload | sort desc _time | limit 50"},

    {"id":"user_dlp","category":"User & Identity","name":"Large Data Uploads by User",
     "description":"Potential data exfiltration — outbound transfers over 10 MB by a specific user",
     "vars":[{"key":"USER","label":"Username or Email","type":"text","placeholder":"user@company.com"}],
     "xql":"dataset = xdr_data | filter actor_effective_username ~= \"{USER}\" | filter action_total_upload > 10485760 | filter _time >= now() - 15d | fields _time, agent_hostname, actor_process_image_name, action_remote_ip, action_country, action_total_upload | sort desc action_total_upload | limit 50"},

    {"id":"user_failed_auth","category":"User & Identity","name":"Failed Authentication Attempts",
     "description":"Windows failed logon events (IDs 4625/4771/4776) for a specific user",
     "vars":[{"key":"USER","label":"Username or Email","type":"text","placeholder":"user@company.com"}],
     "xql":"dataset = xdr_data | filter actor_effective_username ~= \"{USER}\" | filter action_evtlog_event_id in (4625, 4771, 4776) | filter _time >= now() - 15d | fields _time, agent_hostname, actor_effective_username, action_evtlog_event_id, action_remote_ip | sort desc _time | limit 50"},

    {"id":"leaked_creds","category":"User & Identity","name":"Credential Theft Tool Activity",
     "description":"Process executions matching known credential theft tools (mimikatz, procdump, etc.)",
     "vars":[{"key":"DAYS","label":"Last N Days","type":"number","default":"15"}],
     "xql":"dataset = xdr_data | filter actor_process_image_name ~= \"(?i)mimikatz|procdump|secretsdump|hashdump|wce|pwdump|gsecdump\" or actor_process_command_line ~= \"(?i)lsass|sekurlsa|kerberoast|pass.the.hash\" | filter _time >= now() - {DAYS}d | fields _time, actor_effective_username, agent_hostname, actor_process_image_name, actor_process_command_line, action_remote_ip | sort desc _time | limit 50"},

    {"id":"privileged_access","category":"User & Identity","name":"Privileged Account Activity",
     "description":"Admin tool executions and reconnaissance commands (net.exe, nltest, dsquery, etc.)",
     "vars":[{"key":"DAYS","label":"Last N Days","type":"number","default":"15"}],
     "xql":"dataset = xdr_data | filter actor_process_image_name ~= \"(?i)net\\.exe|nltest|whoami|dsquery|adfind|bloodhound|sharphound|rubeus\" or actor_process_command_line ~= \"(?i)dcsync|golden.ticket|silver.ticket|pass.the\" | filter _time >= now() - {DAYS}d | fields _time, actor_effective_username, agent_hostname, actor_process_image_name, actor_process_command_line | sort desc _time | limit 50"},

    {"id":"top_risky_users","category":"User & Identity","name":"Most Active Users (Event Count)",
     "description":"Top users by total EDR event count — high activity can indicate compromise or policy violations",
     "vars":[],
     "xql":"dataset = xdr_data | filter _time >= now() - 15d | fields actor_effective_username, event_type | comp count() as event_count by actor_effective_username | sort desc event_count | limit 20"},

    # ── Application & Network ─────────────────────────────────────────────
    {"id":"ip_investigation","category":"Network & Application","name":"Investigate IP Address",
     "description":"All EDR events with connections to/from a specific IP address",
     "vars":[{"key":"IP","label":"IP Address","type":"text","placeholder":"e.g. 192.168.1.100"}],
     "xql":"dataset = xdr_data | filter action_remote_ip = \"{IP}\" or action_local_ip = \"{IP}\" | filter _time >= now() - 15d | fields _time, actor_effective_username, agent_hostname, event_type, event_sub_type, actor_process_image_name, action_remote_ip, action_local_ip | sort desc _time | limit 50"},

    {"id":"app_access","category":"Network & Application","name":"Application Process Activity",
     "description":"All events launched by or related to a specific application process name",
     "vars":[{"key":"APP","label":"Process/App Name","type":"text","placeholder":"e.g. chrome.exe, dropbox"}],
     "xql":"dataset = xdr_data | filter actor_process_image_name ~= \"(?i){APP}\" | filter _time >= now() - 15d | fields _time, actor_effective_username, agent_hostname, actor_process_image_name, action_remote_ip, action_country, action_total_upload | sort desc _time | limit 50"},

    {"id":"large_transfers","category":"Network & Application","name":"Large Data Transfers",
     "description":"Endpoints with unusually large outbound data volumes (>100 MB)",
     "vars":[{"key":"DAYS","label":"Last N Days","type":"number","default":"15"}],
     "xql":"dataset = xdr_data | filter _time >= now() - {DAYS}d | filter action_total_upload > 104857600 | fields _time, actor_effective_username, agent_hostname, action_remote_ip, action_country, action_total_upload | sort desc action_total_upload | limit 50"},

    # Note: dns_query_name exists in xdr_data but is only populated for DNS events.
    # event_type is a string value (e.g. "NETWORK"), not an ENUM reference in filter syntax.
    {"id":"dns_suspicious","category":"Network & Application","name":"DNS Query Activity",
     "description":"All DNS lookups captured by the EDR agent — filter by hostname for investigation",
     "vars":[{"key":"DAYS","label":"Last N Days","type":"number","default":"7"}],
     "xql":"dataset = xdr_data | filter event_type = \"NETWORK\" and dns_query_name != null | filter _time >= now() - {DAYS}d | fields _time, agent_hostname, dns_query_name, action_remote_ip, action_remote_port, actor_effective_username | sort desc _time | limit 50"},

    # ── Endpoint & Asset ──────────────────────────────────────────────────
    {"id":"host_investigation","category":"Endpoints","name":"Full Host Investigation",
     "description":"All EDR events on a specific endpoint — network, process, auth activity",
     "vars":[{"key":"HOSTNAME","label":"Hostname","type":"text","placeholder":"e.g. WIN-DC01"},
              {"key":"DAYS","label":"Last N Days","type":"number","default":"15"}],
     "xql":"dataset = xdr_data | filter agent_hostname ~= \"{HOSTNAME}\" | filter _time >= now() - {DAYS}d | fields _time, actor_effective_username, event_type, event_sub_type, actor_process_image_name, actor_process_command_line, action_remote_ip, action_total_upload | sort desc _time | limit 50"},

    {"id":"silent_endpoints","category":"Endpoints","name":"Silent / Inactive Endpoints",
     "description":"Endpoints with no telemetry in the last N days",
     "vars":[{"key":"DAYS","label":"Inactive for Days","type":"number","default":"3"}],
     "xql":"dataset = endpoints | filter last_seen < now() - {DAYS}d | fields endpoint_id, endpoint_name, endpoint_status, os_type, last_seen | sort asc last_seen | limit 50"},

    {"id":"high_risk_endpoints","category":"Endpoints","name":"Most Active Endpoints (Event Count)",
     "description":"Endpoints generating the highest EDR event volume — high count may indicate active threat or noisy process",
     "vars":[],
     "xql":"dataset = xdr_data | filter _time >= now() - 15d | fields agent_hostname, event_type | comp count() as event_count by agent_hostname | sort desc event_count | limit 20"},

    # ── Threat Hunting ────────────────────────────────────────────────────
    # Note: mitre_technique_id_and_name does NOT exist in raw xdr_data events.
    # MITRE technique hunting uses process image names / command-line patterns instead.
    {"id":"mitre_technique","category":"Threat Hunting","name":"MITRE Technique — Process Hunt",
     "description":"Hunt for processes and command lines matching a MITRE technique keyword or tool name (e.g. T1059, powershell, mshta)",
     "vars":[{"key":"TECHNIQUE","label":"Technique / Tool name","type":"text","placeholder":"e.g. T1059 or powershell"}],
     "xql":"dataset = xdr_data | filter actor_process_image_name ~= \"(?i){TECHNIQUE}\" or actor_process_command_line ~= \"(?i){TECHNIQUE}\" | filter _time >= now() - 15d | fields _time, actor_effective_username, agent_hostname, actor_process_image_name, actor_process_command_line, action_remote_ip | sort desc _time | limit 50"},

    {"id":"lateral_movement","category":"Threat Hunting","name":"Lateral Movement Indicators",
     "description":"Process executions matching common lateral movement tools (psexec, wmic, winrm, sc.exe, schtasks)",
     "vars":[],
     "xql":"dataset = xdr_data | filter actor_process_image_name ~= \"(?i)psexec|wmic\\.exe|winrm|sc\\.exe|schtasks\\.exe|at\\.exe|mstsc\" or actor_process_command_line ~= \"(?i)invoke-command|enter-pssession|move.laterally|pass.the|new-pssession\" | filter _time >= now() - 15d | fields _time, actor_effective_username, agent_hostname, actor_process_image_name, actor_process_command_line, action_remote_ip | sort desc _time | limit 50"},

    {"id":"cred_access","category":"Threat Hunting","name":"Credential Access Patterns",
     "description":"Process names and command lines matching credential harvesting tools",
     "vars":[],
     "xql":"dataset = xdr_data | filter actor_process_image_name ~= \"(?i)mimikatz|procdump|lsass|secretsdump|hashdump|kerberoast|rubeus|wce\\.exe\" or actor_process_command_line ~= \"(?i)sekurlsa|logonpasswords|hashdump|dcsync|kerberoast|lsadump\" | filter _time >= now() - 15d | fields _time, actor_effective_username, agent_hostname, actor_process_image_name, actor_process_command_line | sort desc _time | limit 50"},
]

@app.route("/api/query_templates")
def api_query_templates():
    return jsonify({"templates": QUERY_TEMPLATES})


@app.route("/api/debug_schema/<dataset>")
def api_debug_schema(dataset):
    """
    Diagnostic: run 'dataset = <name> | limit 3' with no filters so you can
    see the actual field names and values that XSIAM returns.
    Valid values: incidents, va_cves, va_endpoints, endpoints, xdr_data, issues
    Browse to: /api/debug_schema/incidents
    """
    allowed = {"incidents","va_cves","va_endpoints","endpoints","xdr_data","issues",
               "host_inventory","cases","playbook_runs"}
    if dataset not in allowed:
        return jsonify({"error": f"Dataset '{dataset}' not in allow-list: {sorted(allowed)}"}), 400
    rows, err = _run_xql_sync(f"dataset = {dataset} | limit 3", timeframe="90d", limit=3)
    if err:
        return jsonify({"dataset": dataset, "error": err}), 500
    return jsonify({"dataset": dataset, "row_count": len(rows), "sample": rows})

@app.route("/api/debug_ciso")
def api_debug_ciso():
    """Diagnose why CVE / MITRE / Attack Surface widgets are empty.
    Browse to /api/debug_ciso — returns raw samples from every data source."""
    out = {}

    # 1. Alerts — sample 5 raw alerts, show key fields
    # Also try with NO filters to see if the issue is filter-related
    try:
        ar = xsiam_post("alerts/get_alerts_multi_events", {
            "filters": [{"field":"severity","operator":"in","value":["critical","high","medium","low"]}],
            "search_from": 0, "search_to": 5,
            "sort": {"field":"source_insert_ts","keyword":"desc"}
        })
        alerts = ar.get("alerts",[])
        out["alerts_sample"] = [
            {k: a.get(k) for k in ["alert_id","name","alert_name","category","severity",
                                    "source","alert_source","alert_domain","description",
                                    "mitre_technique_id_and_name","mitre_tactic_id_and_name",
                                    "host_name","actor_effective_username","detection_timestamp"]}
            for a in alerts
        ]
        out["alerts_total"] = ar.get("total_count", len(alerts))
        # Store raw response keys for diagnosis
        out["alerts_raw_keys"] = list(ar.keys()) if isinstance(ar, dict) else str(type(ar))
        # Unique categories across sample
        out["alert_categories"] = list({a.get("category","") for a in alerts if a.get("category")})
        out["alert_sources"]    = list({a.get("source","") or a.get("alert_source","") for a in alerts})
    except Exception as e:
        out["alerts_error"] = str(e)
    # 1b. Try alerts with NO filter to see total count
    try:
        ar2 = xsiam_post("alerts/get_alerts_multi_events", {
            "filters": [], "search_from": 0, "search_to": 3,
            "sort": {"field":"source_insert_ts","keyword":"desc"}
        })
        out["alerts_nofilter_total"] = ar2.get("total_count", len(ar2.get("alerts",[])))
        out["alerts_nofilter_keys"]  = list(ar2.keys()) if isinstance(ar2, dict) else str(type(ar2))
    except Exception as e:
        out["alerts_nofilter_error"] = str(e)

    # 2. Xpanse attack surface rules
    try:
        r = xsiam_post("xpanse/get_attack_surface_rules", {"filters":[],"search_from":0,"search_to":5})
        out["xpanse_rules_raw"] = r
    except Exception as e:
        out["xpanse_rules_error"] = str(e)

    # 3. Xpanse assets internet exposure
    try:
        r = xsiam_post("xpanse/get_assets_internet_exposure", {"filters":[],"search_from":0,"search_to":3})
        out["xpanse_assets_raw"] = r
    except Exception as e:
        out["xpanse_assets_error"] = str(e)

    # 4. XQL xpanse_asset dataset
    try:
        rows, err = _run_xql_sync("dataset = xpanse_asset | limit 3", timeframe="90d", limit=3)
        out["xql_xpanse_asset"] = {"rows": rows, "error": err}
    except Exception as e:
        out["xql_xpanse_asset_error"] = str(e)

    # 5. va_cves XQL (corrected: use name field for CVE ID, severity_score for CVSS)
    try:
        rows, err = _run_xql_sync(
            "dataset = va_cves | fields cve_id, name, severity, severity_score, "
            "affected_hosts_count, affected_hosts | sort desc severity_score | limit 3",
            timeframe="90d", limit=3)
        out["xql_va_cves"] = {"rows": rows, "error": err}
    except Exception as e:
        out["xql_va_cves_error"] = str(e)

    # 6. Incidents — check mitre_tactics_ids_and_names field presence
    try:
        ir = xsiam_post("incidents/get_incidents", {
            "filters":[{"field":"creation_time","operator":"gte","value":fifteen_days_ago_ms()}],
            "search_from":0,"search_to":5,
            "sort":{"field":"creation_time","keyword":"desc"}
        })
        incs = ir.get("incidents",[])
        out["incidents_mitre_sample"] = [
            {k: i.get(k) for k in ["incident_id","incident_name","severity",
                                    "mitre_tactics_ids_and_names","alert_sources","description"]}
            for i in incs
        ]
    except Exception as e:
        out["incidents_error"] = str(e)

    return jsonify(out)


@app.route("/api/debug_posture")
def api_debug_posture():
    """Quick diagnostic — calls /api/ciso_posture and returns full response + any warnings."""
    import requests as _req2
    try:
        r = _req2.get("http://127.0.0.1:5000/api/ciso_posture", timeout=120, verify=False)
        data = r.json()
        data["_http_status"] = r.status_code
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e), "hint": "Check Flask logs for traceback"}), 500

@app.route("/api/run_query", methods=["POST"])
def api_run_query():
    """Execute a filled-in XQL template query."""
    data     = request.get_json() or {}
    template_id = data.get("template_id","")
    variables   = data.get("variables", {})

    tmpl = next((t for t in QUERY_TEMPLATES if t["id"] == template_id), None)
    if not tmpl:
        return jsonify({"error": "Unknown template ID"}), 400

    # Fill variables into XQL
    xql = tmpl["xql"]
    for k, v in variables.items():
        v_safe = str(v).replace('"',"'").replace(";","").replace("--","")
        xql = xql.replace("{" + k + "}", v_safe)

    # Check for unfilled variables
    if _re.search(r"\{[A-Z_]+\}", xql):
        return jsonify({"error": "Please fill in all required fields."}), 400

    # ── Strip inline time filters — the API timeframe parameter handles the window ──
    # XSIAM XQL does not support `now() - Nd` arithmetic; use the timeframe param instead
    xql = _re.sub(r'\s*\|\s*filter\s+_time\s*>=?\s*now\s*\(\)\s*-\s*\S+', '', xql)
    xql = _re.sub(r'\s*\|\s*filter\s+creation_time\s*>=?\s*now\s*\(\)\s*-\s*\S+', '', xql)
    xql = _re.sub(r'\s*\|\s*filter\s+last_seen\s*[<>]=?\s*now\s*\(\)\s*-\s*\S+', '', xql)
    xql = _re.sub(r'\|\s*\|', '|', xql).strip().rstrip('|').strip()

    # Use DAYS variable as the API timeframe (default 15 days)
    try:
        days = max(1, min(90, int(variables.get("DAYS", 15) or 15)))
    except Exception:
        days = 15
    timeframe = f"{days}d"

    rows, err = _run_xql_sync(xql, timeframe=timeframe, limit=200)
    if err:
        return jsonify({"error": err, "xql": xql})
    cols = list(rows[0].keys()) if rows else []
    return jsonify({"columns": cols, "rows": rows, "count": len(rows), "xql": xql})


# ─────────────────────────────────────────────
# CISO DASHBOARD
# ─────────────────────────────────────────────
CISO_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CISO Dashboard — XSIAM</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
/* ── Theme variables ── */
:root{
  --bg:#0d1117; --bg2:#161b27; --bg3:#1a1f2e; --bg4:#1a2535;
  --border:#2d3748; --border2:#2d3f6e;
  --text:#e2e8f0; --text2:#a0aec0; --muted:#718096; --muted2:#4a5568;
  --accent:#006B8F; --accent-hover:#0081a7; --accent-light:#00b4d8;
  --red:#e53e3e; --amber:#ed8936; --gold:#d4a017; --green:#48bb78;
  --dm-bg:#161b27; --dm-border:#006B8F;
}
body.light{
  /* Warm off-white palette — easier on eyes than pure white */
  --bg:#f2f0eb; --bg2:#faf9f6; --bg3:#ece9e3; --bg4:#e3dfd8;
  --border:#ccc9c2; --border2:#b5b0a8;
  --text:#1a1a1a; --text2:#2c2c2c; --muted:#555048; --muted2:#7a7267;
  --accent:#006B8F; --accent-hover:#0081a7; --accent-light:#0077a0;
  --red:#b91c1c; --amber:#b45309; --gold:#92400e; --green:#166534;
  --dm-bg:#faf9f6; --dm-border:#006B8F;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-size:14px;transition:background .25s,color .25s}
/* ── Top bar ── */
.topbar{background:var(--bg2);border-bottom:2px solid var(--accent);padding:12px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.topbar-left{display:flex;align-items:center;gap:16px}
.topbar h1{font-size:1.05rem;font-weight:700;color:var(--text);letter-spacing:.3px}
.topbar h1 span{color:var(--accent-light)}
.nav-links{display:flex;gap:8px}
.nav-links a{color:var(--text2);text-decoration:none;font-size:.78rem;padding:5px 13px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);transition:all .2s}
.nav-links a:hover,.nav-links a.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.topbar-right{display:flex;align-items:center;gap:12px;font-size:.78rem;color:var(--muted)}
.refresh-btn{background:var(--accent);color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:.78rem;font-weight:600;transition:background .2s}
.refresh-btn:hover{background:var(--accent-hover)}
.refresh-btn:disabled{background:var(--border);cursor:not-allowed}
.theme-toggle{background:var(--bg3);color:var(--text2);border:1px solid var(--border);padding:5px 12px;border-radius:6px;cursor:pointer;font-size:.78rem;transition:all .2s}
.theme-toggle:hover{border-color:var(--accent);color:var(--accent)}
/* ── Layout ── */
.page{padding:20px 24px;max-width:1600px;margin:0 auto}
.row{display:grid;gap:16px;margin-bottom:16px}
.row-5{grid-template-columns:repeat(5,1fr)}
.row-2{grid-template-columns:1fr 1fr}
.row-3{grid-template-columns:1fr 1fr 1fr}
.row-2-1{grid-template-columns:2fr 1fr}
.row-1-2{grid-template-columns:1fr 2fr}
/* ── Cards ── */
.card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:16px;position:relative;overflow:hidden}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.card-title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}
.card-badge{font-size:.65rem;padding:2px 8px;border-radius:20px;font-weight:600}
/* ── Posture score card ── */
.posture-card{background:linear-gradient(135deg,var(--bg2) 0%,var(--bg4) 100%);border:1px solid var(--accent);grid-column:span 1}
.posture-score{font-size:3.2rem;font-weight:800;line-height:1;margin:4px 0}
.posture-label{font-size:.7rem;color:var(--muted);margin-top:4px}
.posture-components{margin-top:10px}
.comp-row{display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:.72rem}
.comp-bar-wrap{flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden}
.comp-bar{height:100%;border-radius:3px;transition:width .6s ease}
.comp-name{width:140px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.comp-score{width:28px;text-align:right;font-weight:700}
/* ── KPI tiles ── */
.kpi-val{font-size:2rem;font-weight:800;line-height:1;margin:6px 0 2px}
.kpi-label{font-size:.68rem;color:var(--muted)}
.kpi-sub{font-size:.7rem;margin-top:4px}
/* ── RAG colours ── */
.rag-green{color:var(--green)} .rag-amber{color:var(--amber)} .rag-red{color:var(--red)} .rag-grey{color:var(--muted)}
.bg-green{background:var(--green)!important} .bg-amber{background:var(--amber)!important} .bg-red{background:var(--red)!important} .bg-grey{background:var(--muted)!important}
.border-green{border-left:3px solid var(--green)!important}
.border-amber{border-left:3px solid var(--amber)!important}
.border-red{border-left:3px solid var(--red)!important}
/* ── Tables ── */
.tbl{width:100%;border-collapse:collapse;font-size:.73rem}
.tbl th{padding:7px 8px;text-align:left;color:var(--muted);font-weight:600;border-bottom:1px solid var(--border);white-space:nowrap;font-size:.68rem;text-transform:uppercase;letter-spacing:.5px}
.tbl td{padding:7px 8px;border-bottom:1px solid var(--bg3);vertical-align:middle}
.tbl tr:hover td{background:var(--bg4)}
.tbl-wrap{max-height:300px;overflow-y:auto}
.tbl-wrap::-webkit-scrollbar{width:4px} .tbl-wrap::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
/* ── Badges ── */
.badge{display:inline-block;padding:2px 7px;border-radius:12px;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
.badge-critical{background:#e53e3e22;color:var(--red);border:1px solid #e53e3e44}
.badge-high{background:#e07d1c22;color:#e07d1c;border:1px solid #e07d1c44}
.badge-medium{background:#d4a01722;color:var(--gold);border:1px solid #d4a01744}
.badge-kev{background:var(--red);color:#fff;font-size:.6rem;padding:1px 5px;border-radius:3px;margin-left:4px}
.badge-leaked{background:#9b2d2d;color:#fca5a5;border:1px solid #e53e3e;font-size:.6rem}
/* ── Risk tier ── */
.risk-tier{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.65rem;font-weight:700}
/* ── Threat intel feed ── */
.feed-item{padding:9px 0;border-bottom:1px solid var(--bg4);display:flex;align-items:flex-start;gap:10px}
.feed-item:last-child{border-bottom:none}
.feed-source{font-size:.62rem;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;margin-top:2px}
.feed-title{font-size:.73rem;color:var(--text);text-decoration:none;display:block;margin-bottom:2px;line-height:1.35}
.feed-title:hover{color:var(--accent-light)}
.feed-date{font-size:.65rem;color:var(--muted2)}
.feed-wrap{max-height:320px;overflow-y:auto}
/* ── MITRE tactics ── */
.tactic-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:.73rem}
.tactic-name{flex:1;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tactic-bar-wrap{width:90px;height:7px;background:var(--border);border-radius:4px;overflow:hidden}
.tactic-bar{height:100%;background:var(--accent);border-radius:4px}
.tactic-count{width:24px;text-align:right;color:var(--muted);font-size:.68rem}
/* ── Attack surface ── */
.os-pill{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:20px;font-size:.72rem;margin:3px}
/* ── User risk widget ── */
.user-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg4);font-size:.73rem}
.user-row:last-child{border-bottom:none}
.user-score-bar-wrap{width:60px;height:6px;background:var(--border);border-radius:3px;overflow:hidden}
.user-score-bar{height:100%;border-radius:3px}
.driver-tag{font-size:.62rem;padding:1px 6px;border-radius:10px;background:var(--bg3);color:var(--text2);border:1px solid var(--border);margin-right:3px;white-space:nowrap}
/* ── Query builder ── */
.qb-section{margin-top:4px}
.qb-controls{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px}
.qb-select{background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:7px;font-size:.78rem;flex:1;min-width:220px}
.qb-select:focus{outline:none;border-color:var(--accent)}
.qb-vars{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.qb-var-group{display:flex;flex-direction:column;gap:3px}
.qb-var-label{font-size:.68rem;color:var(--muted);font-weight:600}
.qb-input{background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:.78rem;width:180px}
.qb-input:focus{outline:none;border-color:var(--accent)}
.qb-select-var{background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:.78rem}
.qb-run-btn{background:var(--accent);color:#fff;border:none;padding:8px 20px;border-radius:7px;cursor:pointer;font-size:.78rem;font-weight:700;white-space:nowrap}
.qb-run-btn:hover{background:var(--accent-hover)}
.qb-run-btn:disabled{background:var(--border);cursor:not-allowed}
.qb-xql-wrap{background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:10px 14px;font-family:'SF Mono',Monaco,monospace;font-size:.72rem;color:#68d391;margin-bottom:10px;white-space:pre-wrap;word-break:break-all;max-height:80px;overflow-y:auto;display:none}
.qb-results-info{font-size:.73rem;color:var(--muted);margin-bottom:8px}
.qb-table-wrap{max-height:340px;overflow:auto}
.qb-layout{display:grid;grid-template-columns:260px 1fr;gap:0;min-height:320px}
.qb-sidebar{border-right:1px solid var(--border);padding:0;overflow-y:auto;max-height:460px}
.qb-sidebar::-webkit-scrollbar{width:3px} .qb-sidebar::-webkit-scrollbar-thumb{background:var(--border)}
.qb-tmpl-item{padding:8px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-size:.73rem;transition:background .15s;line-height:1.3}
.qb-tmpl-item:hover{background:var(--bg4)}
.qb-tmpl-item.active{background:var(--accent);color:#fff}
.qb-tmpl-item.active .qb-tmpl-cat{color:rgba(255,255,255,.7)}
.qb-tmpl-name{font-weight:600;color:var(--text)}
.qb-tmpl-item.active .qb-tmpl-name{color:#fff}
.qb-tmpl-cat{font-size:.6rem;color:var(--muted2);text-transform:uppercase;letter-spacing:.4px;margin-top:1px}
.qb-cat-header{padding:5px 14px 3px;font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--accent);background:var(--bg3);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:1}
.qb-main{padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.qb-desc{font-size:.72rem;color:var(--muted);font-style:italic;padding:6px 0;border-bottom:1px solid var(--border)}
.category-label{font-size:.65rem;font-weight:700;color:var(--muted2);padding:4px 0 2px;pointer-events:none}
/* ── Clickable KPI tiles ── */
.kpi-clickable{cursor:pointer;transition:transform .12s,box-shadow .12s}
.kpi-clickable:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,107,143,.25);border-color:var(--accent)}
/* ── Drill-down modal ── */
.dm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;display:none;align-items:center;justify-content:center;padding:20px}
.dm-overlay.open{display:flex}
.dm-panel{background:var(--dm-bg);border:1px solid var(--dm-border);border-radius:12px;padding:24px 28px;width:520px;max-width:100%;max-height:80vh;overflow-y:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.dm-panel::-webkit-scrollbar{width:4px} .dm-panel::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
.dm-close{position:absolute;top:14px;right:16px;background:none;border:none;color:var(--muted);font-size:1.1rem;cursor:pointer;line-height:1}
.dm-close:hover{color:var(--text)}
.dm-title{font-size:.88rem;font-weight:700;color:var(--text);margin-bottom:16px;padding-right:24px;line-height:1.4}
.dm-row{display:flex;gap:10px;margin-bottom:9px;font-size:.75rem;align-items:flex-start}
.dm-label{color:var(--muted);min-width:110px;font-weight:600;padding-top:1px;flex-shrink:0}
.dm-val{color:var(--text);flex:1;word-break:break-word}
.dm-section{border-top:1px solid var(--border);margin-top:14px;padding-top:14px}
.dm-chip{display:inline-block;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:.65rem;color:var(--text2);margin:2px}
.dm-age{font-size:1.4rem;font-weight:800;color:#e07d1c;margin:4px 0}
.dm-breach{color:var(--red);font-weight:700;font-size:.72rem}
/* ── Loading states ── */
.loading{text-align:center;padding:30px;color:var(--muted2);font-size:.8rem}
.spinner{display:inline-block;width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;margin-right:6px;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
.error-msg{color:var(--red);font-size:.73rem;padding:8px;background:#e53e3e11;border-radius:6px;border:1px solid #e53e3e33}
.unavailable{text-align:center;padding:24px;color:var(--muted2);font-size:.78rem}
/* ── Scrollbar ── */
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
/* ── Section dividers ── */
.section-label{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted2);margin:4px 0 12px;padding-bottom:4px;border-bottom:1px solid var(--bg4)}
.stale-badge{font-size:.6rem;color:var(--amber);background:#ed893611;border:1px solid #ed893633;padding:1px 6px;border-radius:10px;margin-left:6px}

/* ── Light theme overrides ── */
body.light .tbl td { border-bottom-color:var(--border); }
body.light .tbl tr:hover td { background:var(--bg4); }
body.light .tbl th { color:var(--muted); border-bottom-color:var(--border); }
body.light .qb-xql-wrap { background:var(--bg3); color:#166534; }
body.light .posture-card { background:linear-gradient(135deg,var(--bg2) 0%,var(--bg4) 100%); }
body.light .dm-overlay { background:rgba(0,0,0,.45); }
body.light .dm-panel { color:var(--text); }
body.light .badge-kev { background:var(--red); }
body.light .user-row { border-bottom-color:var(--border); }
/* Fix inline-colored text inside modals for light mode — highest specificity */
body.light .dm-panel * { border-color:var(--border) !important; }
body.light .dm-panel .dm-row-light-fix { color:var(--text) !important; }
/* Severity badges stay colored in both themes */
body.light .badge-critical { background:#fef2f2; color:var(--red); border-color:#fca5a5; }
body.light .badge-high     { background:#fff7ed; color:var(--amber); border-color:#fed7aa; }
body.light .badge-medium   { background:#fefce8; color:var(--gold); border-color:#fde68a; }
/* Table row hover */
body.light #incidents-tbody tr:hover td,
body.light #cve-tbody tr:hover td { background:var(--bg4); }
/* QB results table */
body.light #qb-results-body tr:hover td { background:var(--bg4); }
body.light .qb-group-header-row { background:var(--bg3) !important; color:var(--accent) !important; }
</style>
</head>
<body>
<!-- Top bar -->
<div class="topbar">
  <div class="topbar-left">
    <h1><span>🛡</span>CISO Dashboard</h1>
    <nav class="nav-links">
      <a href="/">📊 SOC</a>
      <a href="/ciso" class="active">🛡 CISO</a>
      <a href="/executive">📈 Executive</a>
    </nav>
  </div>
  <div class="topbar-right">
    <span id="last-refresh">Loading…</span>
    <button class="theme-toggle" id="theme-toggle" onclick="toggleTheme()" title="Switch light/dark theme">☀ Light</button>
    <button class="refresh-btn" id="refresh-btn" onclick="loadAll()">↺ Refresh</button>
  </div>
</div>

<div class="page">

  <!-- ROW 1: Posture score + 5 KPI tiles -->
  <div class="row row-5" id="row-posture">
    <div class="card posture-card kpi-clickable" id="card-posture" onclick="showKpiDrilldown('posture')" title="Click to see component breakdown">
      <div class="card-header"><span class="card-title">Security Posture</span><span id="posture-rag-badge" class="badge"></span></div>
      <div class="posture-score" id="posture-score">—</div>
      <div class="posture-label">/ 100 &nbsp;<span style="font-size:.58rem;color:var(--muted2)">click for detail</span></div>
      <div class="posture-components" id="posture-components"></div>
    </div>
    <div class="card kpi-clickable" id="kpi-critical" onclick="showKpiDrilldown('critical')" title="Click to see critical incidents">
      <div class="card-header"><span class="card-title">Active Critical</span><span style="font-size:.6rem;color:#4a5568">click to drill</span></div>
      <div class="kpi-val rag-red" id="kpi-critical-val">—</div>
      <div class="kpi-label">Open critical incidents</div>
      <div class="kpi-sub" id="kpi-active-total"></div>
    </div>
    <div class="card kpi-clickable" id="kpi-sla" onclick="showKpiDrilldown('sla')" title="Click to see SLA-breached incidents">
      <div class="card-header"><span class="card-title">SLA Breaches</span><span style="font-size:.6rem;color:#4a5568">click to drill</span></div>
      <div class="kpi-val" id="kpi-sla-val">—</div>
      <div class="kpi-label">Open incidents past SLA</div>
    </div>
    <div class="card kpi-clickable" id="kpi-vuln" onclick="showKpiDrilldown('vuln')" title="Click to see critical CVEs">
      <div class="card-header"><span class="card-title">Critical CVEs</span><span style="font-size:.6rem;color:#4a5568">click to drill</span></div>
      <div class="kpi-val rag-red" id="kpi-vuln-val">—</div>
      <div class="kpi-label">Open critical vulnerabilities</div>
    </div>
    <div class="card kpi-clickable" id="kpi-unassigned" onclick="showKpiDrilldown('unassigned')" title="Click to see unassigned incidents">
      <div class="card-header"><span class="card-title">Unassigned</span><span style="font-size:.6rem;color:#4a5568">click to drill</span></div>
      <div class="kpi-val rag-amber" id="kpi-unassigned-val">—</div>
      <div class="kpi-label">Open incidents unassigned</div>
    </div>
  </div>

  <!-- ROW 2: MTTD/MTTR trend + Attack Surface -->
  <div class="row row-2">
    <div class="card">
      <div class="card-header"><span class="card-title">MTTD / MTTR — 15 Day Trend</span><span class="card-badge" style="background:#006B8F22;color:#00b4d8">Last 15 Days</span></div>
      <canvas id="chart-response" height="130"></canvas>
      <div id="mttd-mttr-vals" style="display:flex;gap:24px;margin-top:10px;font-size:.73rem"></div>
    </div>
    <div class="card" id="card-asm">
      <div class="card-header"><span class="card-title">Attack Surface</span><span id="asm-coverage-badge" class="card-badge"></span></div>
      <div id="asm-content"><div class="loading"><span class="spinner"></span>Loading…</div></div>
    </div>
  </div>

  <!-- ROW 3: CVE table + Active incidents -->
  <div class="row row-2">
    <div class="card">
      <div class="card-header">
        <span class="card-title">Open Critical / High CVEs <span id="cve-total" style="color:#718096;font-size:.7rem"></span></span>
        <span class="card-badge" style="background:#e53e3e22;color:#e53e3e" id="kev-badge"></span>
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>CVE ID</th><th>Sev</th><th>CVSS</th><th>Devices</th><th>First Seen</th></tr></thead>
          <tbody id="cve-tbody"><tr><td colspan="5" class="loading"><span class="spinner"></span>Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Active Critical / High Incidents</span><span class="card-badge" style="background:#006B8F22;color:#00b4d8">15 Days</span></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Incident</th><th>Sev</th><th>Age</th><th>SLA</th><th>Analyst</th></tr></thead>
          <tbody id="incidents-tbody"><tr><td colspan="5" class="loading"><span class="spinner"></span>Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ROW 4: Risky users + MITRE tactics -->
  <div class="row row-2">
    <div class="card">
      <div class="card-header"><span class="card-title">Risky Users</span><span id="risky-users-count" class="card-badge" style="background:#e53e3e22;color:#e53e3e"></span></div>
      <div id="risky-users-content"><div class="loading"><span class="spinner"></span>Loading…</div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">MITRE Tactics — Critical &amp; High</span><span class="card-badge" style="background:#9b2d2d22;color:#fc8181">15 Days</span></div>
      <div id="mitre-content"><div class="loading"><span class="spinner"></span>Loading…</div></div>
    </div>
  </div>

  <!-- ROW 5: Threat intel — two side-by-side widgets -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">

    <!-- Left: CERT-In widget -->
    <div class="card" style="min-height:340px">
      <div class="card-header">
        <span class="card-title">🇮🇳 CERT-In Advisory Feed</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span id="feed-stale" class="stale-badge" style="display:none">⚠ Stale</span>
          <span id="feed-updated" style="font-size:.65rem;color:#4a5568"></span>
        </div>
      </div>
      <div class="feed-wrap" id="certin-feed-content">
        <div class="loading"><span class="spinner"></span>Loading CERT-In…</div>
      </div>
    </div>

    <!-- Right: Global Intel widget -->
    <div class="card" style="min-height:340px">
      <div class="card-header">
        <span class="card-title">🌐 Global Threat Intel</span>
        <span class="card-badge" style="background:#d4a01722;color:#d4a017">Unit 42 · CISA KEV</span>
      </div>
      <div class="feed-wrap" id="global-feed-content">
        <div class="loading"><span class="spinner"></span>Loading global intel…</div>
      </div>
    </div>

  </div>

  <!-- ROW 6: Query Console — 2-column widget layout -->
  <div class="card" style="margin-bottom:16px;padding:0;overflow:hidden">
    <div class="card-header" style="padding:12px 16px;border-bottom:1px solid var(--border);margin-bottom:0">
      <span class="card-title">⚡ XSIAM Query Console</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span id="qb-results-info" class="qb-results-info" style="margin:0"></span>
        <span class="card-badge" style="background:var(--accent);color:#fff;opacity:.85">XQL Live</span>
      </div>
    </div>
    <div class="qb-layout">
      <!-- LEFT: Template browser -->
      <div class="qb-sidebar" id="qb-sidebar">
        <div style="padding:8px 14px 6px;font-size:.68rem;color:var(--muted);border-bottom:1px solid var(--border)">
          <input id="qb-search" placeholder="🔍 Filter templates…" oninput="filterTemplates(this.value)"
            style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:5px;font-size:.72rem;outline:none">
        </div>
        <div id="qb-tmpl-list"></div>
      </div>
      <!-- RIGHT: Query detail + results -->
      <div class="qb-main">
        <div id="qb-desc" class="qb-desc" style="display:none"></div>
        <div class="qb-vars" id="qb-vars"></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="qb-run-btn" id="qb-run-btn" onclick="runQuery()" disabled style="min-width:120px">▶ Run Query</button>
          <div id="qb-xql-preview" class="qb-xql-wrap" style="flex:1;min-width:200px;max-height:60px;display:none"></div>
        </div>
        <div class="qb-table-wrap">
          <table class="tbl" id="qb-results-table" style="display:none">
            <thead id="qb-results-head"></thead>
            <tbody id="qb-results-body"></tbody>
          </table>
          <div id="qb-empty-state" style="text-align:center;padding:40px;color:var(--muted2);font-size:.82rem">
            ← Select a query template from the left panel
          </div>
        </div>
      </div>
    </div>
  </div>

</div><!-- /page -->

<!-- ── Drill-down modal ── -->
<div class="dm-overlay" id="dm-overlay" onclick="if(event.target===this)closeDM()">
  <div class="dm-panel">
    <button class="dm-close" onclick="closeDM()">✕</button>
    <div class="dm-title" id="dm-title"></div>
    <div id="dm-body"></div>
  </div>
</div>

<script>
const RAG_COLOR = {green:'#48bb78', amber:'#ed8936', red:'#e53e3e', grey:'#718096'};
const SEV_CLASS = {critical:'badge-critical', high:'badge-high', medium:'badge-medium', low:'', CRITICAL:'badge-critical', HIGH:'badge-high'};
let TEMPLATES = [];

function setLoading(id, msg='Loading…'){
  const el = document.getElementById(id);
  if(el) el.innerHTML = `<div class="loading"><span class="spinner"></span>${msg}</div>`;
}
function setError(id, msg){
  const el = document.getElementById(id);
  if(el) el.innerHTML = `<div class="error-msg">⚠ ${msg}</div>`;
}
function sev(s){ return `<span class="badge ${SEV_CLASS[s]||''}">${s||'—'}</span>`; }
function ago(ms){
  if(!ms || ms < 1000000000) return '—';   // 0, null, or suspiciously small (epoch seconds)
  // Handle epoch seconds (10 digits) vs epoch ms (13 digits)
  if(ms < 9999999999) ms = ms * 1000;       // convert seconds → ms
  const diff = Date.now() - ms;
  if(diff < 0) return 'just now';           // future (clock skew)
  const h = Math.floor(diff / 3600000);
  if(h < 1) return Math.floor(diff/60000)+'m';
  if(h < 24) return h+'h';
  const d = Math.floor(h/24);
  return d+'d '+(h%24)+'h';
}
function ragClass(r){ return 'rag-'+(r||'grey'); }

/* ── Light / dark theme toggle ─────────────────────────────────────── */
// Apply saved theme immediately (script is at bottom, DOM already exists)
try{
  if(localStorage.getItem('ciso-theme') === 'light'){
    document.body.classList.add('light');
    const btn = document.getElementById('theme-toggle');
    if(btn) btn.textContent = '🌙 Dark';
  }
}catch(e){}

function toggleTheme(){
  const isLight = document.body.classList.toggle('light');
  try{ localStorage.setItem('ciso-theme', isLight ? 'light' : 'dark'); }catch(e){}
  const btn = document.getElementById('theme-toggle');
  if(btn) btn.textContent = isLight ? '🌙 Dark' : '☀ Light';
  // Force chart re-render for correct colours (if charts are shown)
  if(chartResponse){ chartResponse.update(); }
}

/* ── Drill-down modal ──────────────────────────────────────────────── */
function openDM(title, bodyHtml){
  document.getElementById('dm-title').innerHTML = title;
  document.getElementById('dm-body').innerHTML  = bodyHtml;
  document.getElementById('dm-overlay').classList.add('open');
}
function closeDM(){
  document.getElementById('dm-overlay').classList.remove('open');
}
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeDM(); });
function compBarColor(score){
  if(score>=80) return 'var(--green)';
  if(score>=60) return 'var(--amber)';
  return 'var(--red)';
}

/* ── Posture ───────────────────────────────────────────────────────── */
async function loadPosture(){
  try{
    const d = await fetch('/api/ciso_posture').then(r=>r.json());
    // Score
    const scoreEl = document.getElementById('posture-score');
    scoreEl.textContent = d.posture_score;
    scoreEl.className = 'posture-score '+ragClass(d.rag);
    // RAG badge
    const badge = document.getElementById('posture-rag-badge');
    badge.textContent = (d.rag||'').toUpperCase();
    const ragFb = RAG_COLOR[d.rag] || getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#718096';
    badge.style.background = ragFb+'22';
    badge.style.color = ragFb;
    badge.style.border = '1px solid '+ragFb+'44';
    // KPIs
    document.getElementById('kpi-critical-val').textContent = d.active_critical??'—';
    document.getElementById('kpi-sla-val').textContent = d.sla_breaches??'—';
    document.getElementById('kpi-sla-val').className = 'kpi-val '+(d.sla_breaches>0?'rag-red':'rag-green');
    document.getElementById('kpi-vuln-val').textContent = d.open_critical_cve??'—';
    document.getElementById('kpi-unassigned-val').textContent = d.unassigned??'—';
    document.getElementById('kpi-unassigned-val').className = 'kpi-val '+(d.unassigned>5?'rag-amber':'rag-green');
    document.getElementById('kpi-active-total').textContent = d.total_active+' total active';
    // Component bars
    const comp = document.getElementById('posture-components');
    comp.innerHTML = (d.components||[]).map(c=>`
      <div class="comp-row">
        <span class="comp-name" title="${c.name}">${c.name}</span>
        <div class="comp-bar-wrap"><div class="comp-bar" style="width:${c.score}%;background:${compBarColor(c.score)}"></div></div>
        <span class="comp-score" style="color:${compBarColor(c.score)}">${c.score}</span>
      </div>`).join('');
    document.getElementById('last-refresh').textContent = 'Last refresh: '+d.last_updated;
    // SLA card colour
    const slaCard = document.getElementById('kpi-sla');
    slaCard.className = 'card kpi-clickable '+(d.sla_breaches>0?'border-red':d.sla_breaches===0?'border-green':'');
    if(d._warnings && d._warnings.length) console.warn('Posture API partial errors:', d._warnings);
    _postureData = d;  // cache for KPI drill-down
  }catch(e){
    console.error('posture',e);
    // Show error in every KPI tile so the user knows something failed
    ['kpi-critical-val','kpi-sla-val','kpi-vuln-val','kpi-unassigned-val'].forEach(id=>{
      const el=document.getElementById(id);
      if(el&&el.textContent==='—') el.innerHTML='<span style="font-size:.7rem;color:var(--red)" title="'+e+'">API err</span>';
    });
    document.getElementById('posture-score').innerHTML='<span style="font-size:1rem;color:var(--red)">Error</span>';
    document.getElementById('last-refresh').textContent='Posture API error — check credentials';
  }
}

/* ── KPI tile drill-down ───────────────────────────────────────────── */
// Caches the last-loaded posture data and incidents for drill-down modals
let _postureData = null;
let _incidentData = null;
let _cveData = null;

async function showKpiDrilldown(type){
  if(!_postureData && type!=='posture'){ await loadPosture(); }
  if(type==='posture'){
    if(!_postureData) await loadPosture();
    if(!_postureData){ openDM('Security Posture','<div class="unavailable">Posture data not yet loaded.</div>'); return; }
    const d = _postureData;
    const compHtml = (d.components||[]).map(c=>`
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:.78rem">
        <span style="flex:1;color:var(--text2);font-weight:600">${c.name}</span>
        <div style="width:90px;height:7px;background:var(--border);border-radius:4px;overflow:hidden">
          <div style="width:${c.score}%;height:100%;background:${compBarColor(c.score)};border-radius:4px"></div>
        </div>
        <span style="width:32px;text-align:right;font-weight:700;color:${compBarColor(c.score)}">${c.score}</span>
        <span style="font-size:.6rem;color:var(--muted2)">${c.weight}</span>
      </div>`).join('');
    openDM('Security Posture Breakdown',
      `<div class="dm-age" style="color:${compBarColor(d.posture_score)}">${d.posture_score} / 100</div>
       <div style="font-size:.68rem;color:var(--muted);margin-bottom:14px">Composite score — ${d.last_updated||''}</div>
       <div class="dm-row"><span class="dm-label">Active Critical</span><span class="dm-val" style="color:var(--red);font-weight:700">${d.active_critical??'—'}</span></div>
       <div class="dm-row"><span class="dm-label">SLA Breaches</span><span class="dm-val" style="color:${(d.sla_breaches||0)>0?'var(--red)':'var(--green)'};font-weight:700">${d.sla_breaches??'—'}</span></div>
       <div class="dm-row"><span class="dm-label">Open CVEs</span><span class="dm-val" style="color:var(--amber);font-weight:700">${d.open_critical_cve??'—'}</span></div>
       <div class="dm-row"><span class="dm-label">Unassigned</span><span class="dm-val" style="color:${(d.unassigned||0)>0?'var(--amber)':'var(--green)'};font-weight:700">${d.unassigned??'—'}</span></div>
       <div class="dm-section"><div style="font-size:.68rem;color:var(--muted);font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Component Scores</div>${compHtml}</div>`
    );
    return;
  }
  const incidentRow = (i, extra='')=>{
    const breached = _checkSLA(i);
    const ageH = i.created ? ((Date.now()-i.created)/3600000).toFixed(1) : null;
    const ageColor = !ageH ? 'var(--muted)' : breached ? 'var(--red)' : ageH>24 ? 'var(--amber)' : 'var(--green)';
    return `<div style="padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer"
         onclick='closeDM();setTimeout(()=>showIncidentDetail(${JSON.stringify(i).replace(/'/g,"&#39;")}),120)'>
       <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
         <span style="font-weight:600;color:var(--text);font-size:.76rem;flex:1">${i.id||''} — ${(i.name||i.description||'Unnamed').substring(0,55)}</span>
         ${sev(i.severity)}
       </div>
       <div style="display:flex;gap:12px;margin-top:4px;font-size:.67rem;color:var(--muted)">
         <span style="color:${ageColor};font-weight:600">⏱ ${ageH ? ageH+'h open' : '—'}</span>
         ${breached?'<span class="dm-breach">⚠ SLA BREACH</span>':'<span style="color:var(--green)">✓ SLA OK</span>'}
         <span>${i.assigned&&i.assigned!=='Unassigned'?'👤 '+i.assigned.split('@')[0]:'<span style="color:var(--red)">⚠ Unassigned</span>'}</span>
       </div>${extra}</div>`;
  };
  if(type==='critical'){
    if(!_incidentData) await _loadIncidentCache();
    const items = (_incidentData||[])
      .filter(i=>['critical'].includes((i.severity||'').toLowerCase()))
      .sort((a,b)=>(b.created||0)-(a.created||0));  // newest first; swap to age: (a.created-b.created)
    // Sort by age — oldest (most at risk) first
    items.sort((a,b)=>(a.created||Date.now())-(b.created||Date.now()));
    if(!items.length){ openDM('Active Critical Incidents','<div class="unavailable">✓ No critical incidents open.</div>'); return; }
    openDM(`Active Critical — ${items.length} open (oldest first)`, items.map(i=>incidentRow(i)).join(''));
  } else if(type==='sla'){
    if(!_incidentData) await _loadIncidentCache();
    const items = (_incidentData||[]).filter(i=>_checkSLA(i));
    items.sort((a,b)=>(a.created||Date.now())-(b.created||Date.now()));
    if(!items.length){ openDM('SLA Breaches','<div class="unavailable" style="color:var(--green)">✓ No SLA breaches.</div>'); return; }
    openDM(`SLA Breached — ${items.length} incident${items.length>1?'s':''} (oldest first)`, items.map(i=>incidentRow(i)).join(''));
  } else if(type==='vuln'){
    if(!_cveData) await _loadCveCache();
    const items = (_cveData||[]).filter(c=>c.severity==='CRITICAL');
    items.sort((a,b)=>(a.first_seen||Date.now())-(b.first_seen||Date.now()));
    if(!items.length){ openDM('Critical CVEs','<div class="unavailable" style="color:var(--green)">✓ No critical CVEs detected.</div>'); return; }
    openDM(`Critical CVEs — ${items.length} unique (oldest first)`,
      items.map(c=>`
        <div style="padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer"
             onclick='closeDM();setTimeout(()=>showCVEDetail(${JSON.stringify(c).replace(/'/g,"&#39;")}),120)'>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span style="font-weight:700;color:var(--accent-light);font-size:.76rem">${c.cve_id}</span>
            ${c.kev?'<span class="badge-kev">KEV</span>':''}${sev(c.severity)}
          </div>
          <div style="font-size:.67rem;color:var(--muted);margin-top:3px;display:flex;gap:10px">
            <span style="color:${c.first_seen?'var(--amber)':'var(--muted)'};font-weight:600">⏱ ${c.first_seen?ago(c.first_seen)+' ago':'Age unknown'}</span>
            <span>${c.device_count||0} host${(c.device_count||0)!==1?'s':''}</span>
            <span>CVSS ${c.cvss||'—'}</span>
          </div>
        </div>`).join('')
    );
  } else if(type==='unassigned'){
    if(!_incidentData) await _loadIncidentCache();
    const items = (_incidentData||[]).filter(i=>!i.assigned||i.assigned==='Unassigned');
    items.sort((a,b)=>(a.created||Date.now())-(b.created||Date.now()));
    if(!items.length){ openDM('Unassigned Incidents','<div class="unavailable" style="color:var(--green)">✓ All incidents assigned.</div>'); return; }
    openDM(`Unassigned — ${items.length} (oldest first)`, items.map(i=>incidentRow(i,
      `<div style="font-size:.66rem;color:var(--red);margin-top:3px;font-weight:600">⚠ No analyst assigned — escalation needed</div>`
    )).join(''));
  }
}

async function _loadIncidentCache(){
  try{
    const r = await fetch('/api/incidents').then(r=>r.json());
    _incidentData = (r.incidents||[]).filter(i=>!['resolved_auto_resolve','resolved','closed'].includes((i.status||'').toLowerCase()));
  }catch(e){ _incidentData=[]; }
}
async function _loadCveCache(){
  try{
    const r = await fetch('/api/ciso_vulnerabilities').then(r=>r.json());
    _cveData = r.cves||[];
  }catch(e){ _cveData=[]; }
}

/* ── Response trend ────────────────────────────────────────────────── */
let chartResponse = null;
async function loadResponseTrend(){
  try{
    const d = await fetch('/api/soc_performance').then(r=>r.json());
    const ctx = document.getElementById('chart-response').getContext('2d');
    if(chartResponse) chartResponse.destroy();
    chartResponse = new Chart(ctx,{
      type:'line',
      data:{
        labels: d.trend_labels||[],
        datasets:[{
          label:'Incidents/day',
          data: d.trend_values||[],
          borderColor:'#006B8F',fill:true,
          backgroundColor:'rgba(0,107,143,0.12)',
          tension:.4,pointRadius:3,pointBackgroundColor:'#006B8F'
        }]
      },
      options:{
        responsive:true,maintainAspectRatio:true,
        plugins:{legend:{display:false}},
        scales:{
          x:{grid:{color:getComputedStyle(document.body).getPropertyValue('--border').trim()||'#1e2535'},ticks:{color:getComputedStyle(document.body).getPropertyValue('--muted').trim()||'#718096',font:{size:10}}},
          y:{grid:{color:getComputedStyle(document.body).getPropertyValue('--border').trim()||'#1e2535'},ticks:{color:getComputedStyle(document.body).getPropertyValue('--muted').trim()||'#718096',font:{size:10}},beginAtZero:true}
        }
      }
    });
    // MTTD/MTTR summary
    const mv = document.getElementById('mttd-mttr-vals');
    mv.innerHTML = `
      <div><span style="color:var(--muted)">MTTD</span>&nbsp;<strong style="color:var(--accent)">${d.mttd!=null?d.mttd+'h':'N/A'}</strong></div>
      <div><span style="color:var(--muted)">MTTR</span>&nbsp;<strong style="color:var(--green)">${d.mttr!=null?d.mttr+'h':'N/A'}</strong></div>
      <div><span style="color:var(--muted)">SLA</span>&nbsp;<strong style="color:${d.sla_compliance<80?'var(--red)':'var(--green)'}">${d.sla_compliance!=null?d.sla_compliance+'%':'N/A'}</strong></div>
      <div><span style="color:var(--muted)">Resolution</span>&nbsp;<strong style="color:var(--text)">${d.resolution_rate!=null?d.resolution_rate+'%':'N/A'}</strong></div>`;
  }catch(e){ console.error('trend',e); }
}

/* ── Attack surface ────────────────────────────────────────────────── */
function _sevChip(s){
  const m={critical:'var(--red)',high:'var(--amber)',medium:'var(--gold)',low:'var(--green)'};
  const c=m[(s||'').toLowerCase()]||'var(--muted)';
  return `<span style="background:${c}22;color:${c};border:1px solid ${c}44;border-radius:3px;padding:1px 5px;font-size:.6rem;font-weight:700;text-transform:uppercase">${s||'—'}</span>`;
}
async function loadASM(){
  const el = document.getElementById('asm-content');
  try{
    const d = await fetch('/api/attack_surface').then(r=>r.json());
    if(d._debug) console.log('ASM debug:', d._debug);
    if(!d.available){
      el.innerHTML=`<div class="unavailable">🔒 ${d.reason||'ASM module not available.'}<br><small style="color:var(--muted);margin-top:4px;display:block">Ensure Xpanse/ASM is enabled in your XSIAM tenant.</small></div>`;
      return;
    }

    let html = '';

    // ── Xpanse-unavailable notice ─────────────────────────────────────────
    if(!d.has_xpanse){
      html += `<div style="background:var(--amber)11;border:1px solid var(--amber)33;border-radius:6px;padding:6px 10px;margin-bottom:10px;font-size:.7rem;color:var(--text2)">
        ⚠ Xpanse/ASM internet-exposure data is not available for this tenant.
        <span style="color:var(--muted)">Enable the Xpanse licence to see attack surface observations. Showing endpoint posture below.</span>
      </div>`;
    }

    // ── Section 1: Xpanse observations (rule violations) ──
    if(d.observations && d.observations.length){
      const critObs = d.observations.filter(o=>['critical','high'].includes((o.severity||'').toLowerCase()));
      html += `<div style="margin-bottom:10px">
        <div style="font-size:.68rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">
          🌐 Attack Surface Observations (${d.total_observations||d.observations.length} findings)
        </div>`;
      // Category summary pills
      if(d.obs_by_category && d.obs_by_category.length){
        html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">` +
          d.obs_by_category.slice(0,6).map(c=>
            `<span style="background:var(--bg4);border:1px solid var(--border);border-radius:10px;padding:2px 8px;font-size:.65rem;color:var(--text2)">
              ${c.cat} <strong style="color:var(--amber)">${c.count}</strong>
            </span>`
          ).join('') + `</div>`;
      }
      // Top observations list
      html += `<div style="max-height:120px;overflow-y:auto">` +
        d.observations.slice(0,10).map(o=>`
          <div style="padding:5px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:.72rem">
            ${_sevChip(o.severity)}
            <span style="flex:1;color:var(--text)">${o.name}</span>
            ${o.assets_count?`<span style="color:var(--muted);font-size:.65rem">${o.assets_count} asset${o.assets_count!==1?'s':''}</span>`:''}
          </div>`).join('') +
        `</div></div>`;
    } else if(d.asm_alerts && d.asm_alerts.length){
      // Alert-based fallback
      html += `<div style="margin-bottom:10px">
        <div style="font-size:.68rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">
          🌐 Attack Surface Alerts (${d.asm_alerts.length})
        </div>
        <div style="max-height:120px;overflow-y:auto">` +
        d.asm_alerts.map(a=>`
          <div style="padding:5px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:.72rem">
            ${_sevChip(a.severity)}
            <span style="flex:1;color:var(--text)">${a.name}</span>
            ${a.host?`<span class="dm-chip" style="font-size:.62rem">🖥 ${a.host}</span>`:''}
          </div>`).join('') +
        `</div></div>`;
    }

    // ── Section 2: Internet-facing assets ─────────────────────────────────
    if(d.xpanse_assets && d.xpanse_assets.length){
      html += `<div style="margin-bottom:10px">
        <div style="font-size:.68rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">
          📡 Internet-Facing Assets (${d.total_assets})
        </div>
        <div style="max-height:100px;overflow-y:auto">` +
        d.xpanse_assets.slice(0,8).map(a=>`
          <div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:.7rem">
            <span style="color:var(--text);font-weight:600">${a.name}</span>
            <span style="color:var(--muted);margin-left:6px">${a.type}</span>
            ${(a.ips||[]).length?`<span style="color:var(--text2);margin-left:6px;font-family:monospace">${a.ips[0]}</span>`:''}
            ${a.services?`<span style="color:var(--muted);margin-left:4px">· ${a.services}</span>`:''}
          </div>`).join('') +
        `</div></div>`;
    }

    // ── Section 3: Endpoint agent inventory ───────────────────────────────
    const covColor = d.coverage_pct>=90?'var(--green)':d.coverage_pct>=70?'var(--amber)':'var(--red)';
    if(d.total){
      document.getElementById('asm-coverage-badge').textContent = d.coverage_pct+'% agent coverage';
      document.getElementById('asm-coverage-badge').style.cssText = `background:${covColor}22;color:${covColor};border:1px solid ${covColor}44`;
      const epSep = (d.has_xpanse && html)?'border-top:1px solid var(--border);padding-top:8px;margin-top:4px':'';
      html += `<div style="${epSep}">
        <div style="font-size:.68rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">🖥 XDR Agent Inventory</div>
        <div style="display:flex;gap:16px;font-size:.73rem;margin-bottom:6px">
          <div><div style="font-size:1.3rem;font-weight:800;color:var(--accent)">${d.total}</div><div style="color:var(--muted)">Total</div></div>
          <div><div style="font-size:1.3rem;font-weight:800;color:var(--green)">${d.connected}</div><div style="color:var(--muted)">Connected</div></div>
          <div><div style="font-size:1.3rem;font-weight:800;color:var(--amber)">${d.disconnected}</div><div style="color:var(--muted)">Disconnected</div></div>
          <div><div style="font-size:1.3rem;font-weight:800;color:var(--red)">${d.lost}</div><div style="color:var(--muted)">Lost</div></div>
        </div>
        <div>${(d.os_distribution||[]).map(o=>`<span class="os-pill">${o.os} <strong>${o.count}</strong></span>`).join('')}</div>
      </div>`;
    }

    if(!d.total && !d.has_xpanse){
      html = `<div class="unavailable">No endpoint or Xpanse data available.<br>
        <small style="color:var(--muted)">Open browser console (F12) for debug details.</small></div>`;
    } else if(!html){
      html = `<div class="unavailable">No attack surface data found.<br>
        <small style="color:var(--muted)">Check browser console (F12) for debug info. Ensure Xpanse module is active.</small></div>`;
    }
    el.innerHTML = html;
  }catch(e){ el.innerHTML=`<div class="unavailable">Could not load attack surface data: ${e.message}</div>`; }
}

/* ── CVE table ─────────────────────────────────────────────────────── */
async function loadCVEs(){
  const tb = document.getElementById('cve-tbody');
  try{
    const d = await fetch('/api/ciso_vulnerabilities').then(r=>r.json());
    document.getElementById('cve-total').textContent = '('+d.total+' unique)';
    const kevCount = (d.cves||[]).filter(c=>c.kev).length;
    if(kevCount){
      document.getElementById('kev-badge').textContent = kevCount+' on CISA KEV';
      document.getElementById('kev-badge').style.cssText='background:var(--red)22;color:var(--red);border:1px solid var(--red)44';
    }
    // Update KPI — show critical count if any, else total count
    const critCount = (d.cves||[]).filter(c=>c.severity==='CRITICAL').length;
    const highCount = (d.cves||[]).filter(c=>c.severity==='HIGH').length;
    const kpiVal    = critCount || highCount || (d.total||0);
    document.getElementById('kpi-vuln-val').textContent = kpiVal;
    if(!d.cves || !d.cves.length){
      tb.innerHTML=`<tr><td colspan="5" style="text-align:center;color:var(--green);padding:16px">✓ No open CVEs found in the last 90 days</td></tr>`;
      return;
    }
    _cveData = d.cves; // cache for KPI drill-down
    tb.innerHTML = d.cves.map(c=>`<tr style="cursor:pointer" onclick='showCVEDetail(${JSON.stringify(c).replace(/'/g,"&#39;")})'>
      <td><span style="color:var(--accent);font-weight:600">${c.cve_id}</span>${c.kev?'<span class="badge-kev">KEV</span>':''}</td>
      <td>${sev(c.severity)}</td>
      <td><span style="color:${c.cvss>=9?'var(--red)':c.cvss>=7?'var(--amber)':'var(--green)'}">${c.cvss||'—'}</span></td>
      <td title="${(c.devices||[]).join(', ')}">${c.device_count||0} ${(c.device_count||0)===1?'host':'hosts'}</td>
      <td style="color:var(--muted)">${c.first_seen?ago(c.first_seen)+' ago':'—'}</td>
    </tr>`).join('');
  }catch(e){ tb.innerHTML=`<tr><td colspan="5" class="error-msg">Failed to load CVEs</td></tr>`; }
}
function showCVEDetail(c){
  const sevColor = c.severity==='CRITICAL'?'var(--red)':c.severity==='HIGH'?'var(--amber)':'var(--gold)';
  const cvssColor = !c.cvss?'var(--muted)':c.cvss>=9?'var(--red)':c.cvss>=7?'var(--amber)':'var(--green)';
  const devHtml = (c.devices||[]).length
    ? (c.devices||[]).map(d=>`<span class="dm-chip">🖥 ${d}</span>`).join('')
    : '<span style="color:var(--muted)">No host detail available</span>';
  openDM(
    `${sev(c.severity)}&nbsp; ${c.cve_id} ${c.kev?'<span class="badge-kev">KEV</span>':''}`,
    `${c.first_seen?`<div class="dm-age" style="color:var(--amber)">${ago(c.first_seen)} ago</div>
       <div style="font-size:.68rem;color:var(--muted);margin-bottom:12px">First detected in your environment</div>`:''}
     <div class="dm-row"><span class="dm-label">Severity</span><span class="dm-val" style="color:${sevColor};font-weight:700">${c.severity||'—'}</span></div>
     <div class="dm-row"><span class="dm-label">CVSS Score</span><span class="dm-val" style="color:${cvssColor};font-weight:700">${c.cvss||'N/A'}</span></div>
     <div class="dm-row"><span class="dm-label">Affected Hosts</span><span class="dm-val" style="color:var(--text2)">${c.device_count||0} host${(c.device_count||0)!==1?'s':''}</span></div>
     ${c.source?`<div class="dm-row"><span class="dm-label">Source</span><span class="dm-val" style="color:var(--text2)">${c.source}</span></div>`:''}
     <div class="dm-section">
       <div style="font-size:.67rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Affected Devices</div>
       <div>${devHtml}</div>
     </div>
     <div class="dm-section">
       <div class="dm-row"><span class="dm-label">Description</span><span class="dm-val" style="color:var(--text2);white-space:pre-wrap;font-size:.72rem">${c.description||'—'}</span></div>
     </div>
     <div class="dm-section">
       ${c.nvd_link?`<a href="${c.nvd_link}" target="_blank" style="color:var(--accent);font-size:.75rem;font-weight:600">🔗 Full details on NVD →</a>`:`<span style="font-size:.72rem;color:var(--muted)">ℹ Vulnerability indicator — no formal CVE ID assigned in XSIAM<br>(Enable VA licence to get CVE mapping)</span>`}
     </div>`
  );
}

/* ── Incidents table ───────────────────────────────────────────────── */
async function loadIncidents(){
  const tb = document.getElementById('incidents-tbody');
  try{
    const inc = await fetch('/api/incidents').then(r=>r.json());
    // API returns .incidents[] with fields: id, name, severity, status, created (epoch ms),
    // assigned, hosts[], users[], alert_count, description
    _incidentData = (inc.incidents||[]).filter(i=>!['resolved_auto_resolve','resolved','closed'].includes((i.status||'').toLowerCase())); // cache for KPI drill-down
    const items = (inc.incidents||[])
      .filter(i=>['critical','high'].includes((i.severity||'').toLowerCase()))
      .slice(0,30);
    if(!items.length){
      tb.innerHTML=`<tr><td colspan="5" style="text-align:center;color:var(--green);padding:16px">✓ No active critical/high incidents in last 15 days</td></tr>`;
      return;
    }
    tb.innerHTML = items.map(i=>{
      const breached = _checkSLA(i);
      const ageStr = ago(i.created);
      const analyst = i.assigned && i.assigned !== 'Unassigned'
        ? (i.assigned.includes('@') ? i.assigned.split('@')[0] : i.assigned)
        : '<span style="color:var(--red)">Unassigned</span>';
      return `<tr style="cursor:pointer" onclick='showIncidentDetail(${JSON.stringify(i).replace(/'/g,"&#39;")})'>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${i.name||i.description||''}">${i.id||''}&nbsp;${i.name||i.description||'Unknown'}</td>
        <td>${sev(i.severity)}</td>
        <td style="color:${breached?'var(--red)':'var(--muted)'}">${ageStr}</td>
        <td>${breached?'<span style="color:var(--red);font-weight:700">⚠ BREACH</span>':'<span style="color:var(--green)">OK</span>'}</td>
        <td>${analyst}</td>
      </tr>`;
    }).join('');
  }catch(e){ tb.innerHTML=`<tr><td colspan="5" class="error-msg">Failed to load incidents</td></tr>`; }
}

function _checkSLA(incident){
  const thresholds = {critical:4,high:8,medium:24,low:72};
  const s = (incident.severity||'').toLowerCase();
  const limit = thresholds[s];
  if(!limit) return false;
  const ts = incident.created || incident.creation_time || 0;
  const age_h = (Date.now() - ts) / 3600000;
  return age_h > limit && !(incident.status||'').toLowerCase().startsWith('resolved');
}

function showIncidentDetail(i){
  const ts = i.created || i.creation_time || 0;
  const breached = _checkSLA(i);
  const ageH = ts ? ((Date.now()-ts)/3600000).toFixed(1) : null;
  const ageColor = !ageH ? 'var(--muted)' : breached ? 'var(--red)' : Number(ageH)>24 ? 'var(--amber)' : 'var(--green)';
  const hosts  = (i.hosts||[]);
  const users  = (i.users||[]);
  const analyst = i.assigned && i.assigned !== 'Unassigned' ? i.assigned : null;
  const sources = (i.alert_sources||[]);
  const isCasb  = sources.some(s=>/skyhigh|casb|dlp|cloud/i.test(s));
  const isFirewall = sources.some(s=>/fortinet|fortigate|firewall|palo|checkpoint/i.test(s));

  const hostsHtml = hosts.length
    ? hosts.map(h=>`<span class="dm-chip">🖥 ${h}</span>`).join('')
    : isCasb
      ? '<span style="color:var(--muted);font-style:italic">Cloud-sourced — no endpoint</span>'
      : '<span style="color:var(--muted)">None reported</span>';

  const usersHtml = users.length
    ? users.map(u=>`<span class="dm-chip">👤 ${u}</span>`).join('')
    : isCasb
      ? '<span style="color:var(--muted);font-style:italic">Check CASB console for user identity</span>'
      : '<span style="color:var(--muted)">None reported</span>';

  const sourcesHtml = sources.length
    ? sources.map(s=>`<span class="dm-chip">📡 ${s}</span>`).join('')
    : '<span style="color:var(--muted)">—</span>';

  // CASB/cloud context note
  const casbNote = isCasb
    ? `<div style="margin-top:10px;padding:8px 10px;background:var(--bg4);border-radius:6px;border-left:3px solid var(--amber);font-size:.72rem;color:var(--text2)">
        <strong style="color:var(--amber)">☁ Cloud / CASB Alert</strong><br>
        This incident originates from <strong>${sources.join(', ')}</strong>.
        Endpoint/user fields may be unpopulated — view full details in the XSIAM console or Skyhigh dashboard.
        ${i.xdr_url?`<br><a href="${i.xdr_url}" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:600">🔗 Open in XSIAM →</a>`:''}
      </div>` : '';

  const firewallNote = isFirewall && !isCasb
    ? `<div style="margin-top:10px;padding:8px 10px;background:var(--bg4);border-radius:6px;border-left:3px solid var(--accent);font-size:.72rem;color:var(--text2)">
        <strong style="color:var(--accent)">🔥 Firewall Alert</strong> — from <strong>${sources.join(', ')}</strong>.
        ${i.xdr_url?`<a href="${i.xdr_url}" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:600;margin-left:8px">🔗 Open in XSIAM →</a>`:''}
      </div>` : '';

  openDM(
    `${sev(i.severity)}&nbsp; ${i.id||''} — ${(i.name||i.description||'Unnamed Incident').substring(0,50)}`,
    `<div class="dm-age" style="color:${ageColor}">${ageH ? ageH+'h open' : '—'}</div>
     <div style="font-size:.68rem;color:var(--muted);margin-bottom:14px">Since ${i.created_str||'unknown'} &nbsp; ${breached?'<span class="dm-breach">⚠ SLA BREACHED</span>':'<span style="color:var(--green);font-weight:600">✓ Within SLA</span>'}</div>
     <div class="dm-row"><span class="dm-label">Severity</span><span class="dm-val">${sev(i.severity)}</span></div>
     <div class="dm-row"><span class="dm-label">Status</span><span class="dm-val" style="color:var(--text2)">${i.status||'—'}</span></div>
     <div class="dm-row"><span class="dm-label">Analyst</span><span class="dm-val">${analyst||'<span style="color:var(--red);font-weight:700">⚠ Unassigned</span>'}</span></div>
     <div class="dm-row"><span class="dm-label">Alerts</span><span class="dm-val" style="color:var(--text2)">${i.alert_count||0} linked alerts</span></div>
     <div class="dm-row"><span class="dm-label">Sources</span><span class="dm-val">${sourcesHtml}</span></div>
     <div class="dm-section">
       <div style="font-size:.67rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Affected Assets</div>
       <div class="dm-row"><span class="dm-label">Hosts</span><span class="dm-val">${hostsHtml}</span></div>
       <div class="dm-row"><span class="dm-label">Users</span><span class="dm-val">${usersHtml}</span></div>
     </div>
     ${i.description?`<div class="dm-section"><div class="dm-row"><span class="dm-label">Description</span><span class="dm-val" style="color:var(--text2);white-space:pre-wrap;font-size:.72rem">${i.description}</span></div></div>`:''}
     ${casbNote}${firewallNote}`
  );
}

/* ── Risky users ───────────────────────────────────────────────────── */
async function loadRiskyUsers(){
  const el = document.getElementById('risky-users-content');
  const cnt = document.getElementById('risky-users-count');
  try{
    const d = await fetch('/api/risky_users').then(r=>r.json());
    if(!d.users || !d.users.length){
      el.innerHTML=`<div class="unavailable">No user risk signals detected in last 15 days.<br><small style="color:var(--muted)">Ensure DLP, UEBA, or Identity modules are active.</small></div>`;
      return;
    }
    cnt.textContent = d.total+' flagged';
    // Sort by score desc (highest risk first), then by last_seen desc (most recent first for ties)
    const sorted = [...(d.users||[])].sort((a,b)=> b.score-a.score || (b.last_seen||0)-(a.last_seen||0));
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 70px 80px 70px;gap:0;font-size:.63rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:4px 6px;border-bottom:1px solid var(--border)">
        <span>User</span><span style="text-align:center">Tier</span><span style="text-align:center">Last Active</span><span style="text-align:right">Score</span>
      </div>` +
    sorted.map(u=>`
      <div style="display:grid;grid-template-columns:1fr 70px 80px 70px;gap:0;align-items:center;padding:7px 6px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s"
           onmouseover="this.style.background='var(--bg4)'" onmouseout="this.style.background=''"
           onclick='showUserDetail(${JSON.stringify(u).replace(/'/g,"&#39;")})'>
        <div style="min-width:0">
          <div style="font-weight:600;color:var(--text);font-size:.74rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${u.user}">${u.leaked?'⚠ ':''} ${u.user}</div>
          <div style="font-size:.62rem;color:var(--muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(u.drivers||[]).slice(0,1).map(d=>d.length>38?d.substring(0,38)+'…':d).join('')}</div>
        </div>
        <div style="text-align:center">
          <span style="background:${u.tier_color}22;color:${u.tier_color};border:1px solid ${u.tier_color}44;border-radius:10px;padding:2px 6px;font-size:.62rem;font-weight:700;white-space:nowrap">${u.tier}</span>
        </div>
        <div style="text-align:center;font-size:.67rem;color:${u.last_seen?'var(--text2)':'var(--muted)'}">
          ${u.last_seen ? ago(u.last_seen)+' ago' : '—'}
        </div>
        <div style="text-align:right">
          <div style="display:flex;align-items:center;gap:3px;justify-content:flex-end">
            <div style="width:40px;height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${u.score}%;height:100%;background:${u.tier_color};border-radius:3px"></div></div>
            <span style="font-size:.72rem;font-weight:700;color:${u.tier_color}">${u.score}</span>
          </div>
        </div>
      </div>`).join('');
  }catch(e){ el.innerHTML=`<div class="error-msg">Failed to load user risk data</div>`; }
}

function showUserDetail(u){
  const lastSeenStr = u.last_seen ? ago(u.last_seen)+' ago' : 'Unknown';
  const tierColor = u.tier_color||'var(--muted)';
  const alertsHtml = (u.last_alerts||[]).length
    ? (u.last_alerts||[]).map(a=>`
        <div style="padding:7px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <span style="color:var(--text);font-size:.74rem;flex:1">${a.name||'Security Alert'}</span>
            ${sev(a.severity)}
          </div>
          <div style="display:flex;gap:10px;margin-top:3px;font-size:.67rem;color:var(--muted)">
            ${a.ts?`<span style="color:var(--amber);font-weight:600">⏱ ${ago(a.ts)} ago</span>`:''}
            ${a.host?`<span>🖥 ${a.host}</span>`:''}
            ${a.ip?`<span>🌐 ${a.ip}</span>`:''}
          </div>
        </div>`).join('')
    : `<div style="color:var(--muted);font-size:.72rem;padding:8px 0">No alert details available in this environment.</div>`;
  openDM(
    `${u.leaked?'<span class="badge badge-leaked" style="margin-right:6px">⚠ LEAKED</span>':''}👤 ${u.user}`,
    `<div class="dm-age" style="color:${tierColor}">${u.tier} Risk — ${u.score}/100</div>
     <div style="font-size:.68rem;color:var(--muted);margin-bottom:14px">Last activity: ${lastSeenStr}</div>
     <div class="dm-row"><span class="dm-label">Risk Tier</span>
       <span class="dm-val"><span style="background:${tierColor}22;color:${tierColor};border:1px solid ${tierColor}44;border-radius:4px;padding:2px 10px;font-size:.72rem;font-weight:700">${u.tier}</span></span></div>
     <div class="dm-row"><span class="dm-label">Risk Drivers</span>
       <span class="dm-val">${(u.drivers||['Unknown']).map(d=>`<span class="dm-chip">${d}</span>`).join('')}</span></div>
     ${u.leaked?`<div class="dm-row"><span class="dm-label">Credentials</span><span class="dm-val" style="color:var(--red);font-weight:700">⚠ LEAKED / COMPROMISED — Immediate reset required</span></div>`:''}
     <div class="dm-section">
       <div style="font-size:.67rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Recent Security Activity</div>
       ${alertsHtml}
     </div>`
  );
}

/* ── MITRE tactics ─────────────────────────────────────────────────── */
async function loadMitre(){
  const el = document.getElementById('mitre-content');
  try{
    const d = await fetch('/api/mitre_tactics_ciso').then(r=>r.json());
    if(!d.tactics || !d.tactics.length){
      el.innerHTML=`<div class="unavailable">No MITRE tactics detected in high/critical incidents (15 days).</div>`;
      return;
    }
    const max = Math.max(...d.tactics.map(t=>t.count));
    el.innerHTML = d.tactics.map(t=>`
      <div class="tactic-row">
        <span class="tactic-name" title="${t.name}">${t.name}</span>
        <div class="tactic-bar-wrap"><div class="tactic-bar" style="width:${Math.round(t.count/max*100)}%"></div></div>
        <span class="tactic-count">${t.count}</span>
      </div>`).join('');
  }catch(e){ el.innerHTML=`<div class="error-msg">Failed to load MITRE data</div>`; }
}

/* ── Threat intel feed ─────────────────────────────────────────────── */

// CERT-In panel: action-oriented cards showing affected systems
function renderCertinCards(items){
  if(!items || !items.length)
    return `<div class="unavailable">No CERT-In advisories in the last 15 days.</div>`;

  return items.map(f => {
    const isNvd   = f.cve_id || f.cvss;
    const sevColor = (f.severity||'').toUpperCase() === 'CRITICAL' ? 'var(--red)' : 'var(--amber)';
    const bfsiTag  = f.bfsi
      ? `<span style="font-size:.58rem;background:var(--amber)22;color:var(--amber);border:1px solid var(--amber)44;border-radius:3px;padding:1px 5px">BFSI</span>`
      : '';

    // Affected systems block
    let affectedHtml = '';
    if(isNvd && f.affected && f.affected.length){
      const chips = f.affected.map(a => {
        const icon = a.label.startsWith('OS:') ? '🖥' : a.label.startsWith('HW:') ? '🔧' : '📦';
        const clean = a.label.replace(/^(OS|HW):\s*/,'');
        return `<span style="display:inline-block;background:var(--bg4);border:1px solid var(--border);
                border-radius:4px;padding:2px 7px;font-size:.65rem;color:var(--text2);margin:2px">${icon} ${clean}</span>`;
      }).join('');
      affectedHtml = `<div style="margin-top:6px">
        <span style="font-size:.62rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Affected Systems</span>
        <div style="margin-top:3px">${chips}</div>
      </div>`;
    } else if(!isNvd){
      affectedHtml = `<div style="margin-top:5px;font-size:.65rem;color:var(--muted)">📰 News coverage of CERT-In advisory</div>`;
    }

    // CVSS score pill
    const cvssPill = f.cvss
      ? `<span style="font-size:.65rem;font-weight:700;background:${sevColor}22;color:${sevColor};
               border:1px solid ${sevColor}44;border-radius:4px;padding:1px 6px;margin-left:6px">CVSS ${f.cvss}</span>`
      : '';

    // CWE tag
    const cweTag = f.cwe && f.cwe.startsWith('CWE-')
      ? `<span style="font-size:.6rem;color:var(--muted);margin-left:6px">${f.cwe}</span>` : '';

    // Attack vector icon
    const vectorIcon = {'NETWORK':'🌐','ADJACENT_NETWORK':'📡','LOCAL':'💻','PHYSICAL':'🖐'}[f.vector||''] || '';

    const titleText = isNvd
      ? `<span style="color:var(--accent);font-weight:700;font-size:.8rem">${f.cve_id||''}</span>
         <span style="color:var(--text2);font-size:.72rem;margin-left:6px">${(f.desc||'').substring(0,90)}${(f.desc||'').length>90?'…':''}</span>`
      : `<span style="color:var(--text);font-size:.75rem">${f.title||'No title'}</span>`;

    return `<div style="background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${sevColor};
                         border-radius:6px;padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px">
        <span style="font-size:.62rem;font-weight:700;background:${sevColor}22;color:${sevColor};
                     border:1px solid ${sevColor}55;border-radius:3px;padding:1px 6px;text-transform:uppercase">${f.severity||'INFO'}</span>
        ${cvssPill}${cweTag}
        <span style="font-size:.6rem;color:var(--muted2);margin-left:auto">${f.date||''} ${vectorIcon}</span>
        ${bfsiTag}
      </div>
      <div>${titleText}</div>
      ${affectedHtml}
      <div style="margin-top:7px">
        <a href="${f.link||'#'}" target="_blank"
           style="font-size:.65rem;color:var(--accent);text-decoration:none;border:1px solid var(--accent)44;
                  border-radius:4px;padding:2px 8px;background:var(--accent)11">
           🔗 View Advisory
        </a>
      </div>
    </div>`;
  }).join('');
}

// Global intel panel: compact feed list
function renderGlobalFeed(items, emptyMsg){
  if(!items || !items.length) return `<div class="unavailable">${emptyMsg}</div>`;
  const SOURCE_COLORS = {
    'Unit 42 (BFSI)': '#d4a017',
    'CISA KEV':       '#e07d1c',
    'Unit 42':        '#718096',
  };
  return items.map(f=>{
    const sc   = SOURCE_COLORS[f.source] || '#718096';
    const bfsi = f.bfsi
      ? `<span style="font-size:.58rem;background:#d4a01722;color:#d4a017;border:1px solid #d4a01744;
                border-radius:3px;padding:1px 5px;margin-left:4px">BFSI</span>` : '';
    return `<div class="feed-item">
      <span class="feed-source" style="background:${sc}22;color:${sc};border:1px solid ${sc}44;white-space:nowrap">${f.source}</span>
      <div style="flex:1;min-width:0">
        <a href="${f.link||'#'}" target="_blank" class="feed-title">${f.title||'No title'}</a>${bfsi}
        <span class="feed-date">${f.date||''}</span>
      </div>
    </div>`;
  }).join('');
}

async function loadThreatIntel(){
  const certEl   = document.getElementById('certin-feed-content');
  const globalEl = document.getElementById('global-feed-content');
  try{
    const d = await fetch('/api/threat_intel').then(r=>r.json());
    document.getElementById('feed-updated').textContent = 'Updated: '+(d.last_updated||'');
    if(d.certin_stale || d.unit42_stale)
      document.getElementById('feed-stale').style.display='inline';

    const feed = d.feed || [];

    // CERT-In widget: CERT-In news + NVD items
    const certinItems = feed.filter(f =>
      f.source && (f.source.includes('CERT-In') || f.source.includes('NVD')));

    // Global widget: Unit 42 + CISA KEV
    const globalItems = feed.filter(f =>
      f.source && (f.source.includes('Unit 42') || f.source.includes('CISA')));

    certEl.innerHTML   = renderCertinCards(certinItems);
    globalEl.innerHTML = renderGlobalFeed(globalItems, 'No global threat intel available.');

  }catch(e){
    certEl.innerHTML   = `<div class="error-msg">Failed to load CERT-In feed: ${e.message}</div>`;
    globalEl.innerHTML = `<div class="error-msg">Failed to load global feed: ${e.message}</div>`;
  }
}

/* ── Query builder ─────────────────────────────────────────────────── */
async function loadQueryTemplates(){
  try{
    const d = await fetch('/api/query_templates').then(r=>r.json());
    TEMPLATES = d.templates||[];
    renderTemplateSidebar(TEMPLATES);
  }catch(e){ document.getElementById('qb-tmpl-list').innerHTML='<div class="error-msg">Failed to load templates</div>'; }
}

function renderTemplateSidebar(templates){
  const list = document.getElementById('qb-tmpl-list');
  if(!list) return;
  // Group by category
  const cats = {};
  templates.forEach(t=>{ (cats[t.category]=cats[t.category]||[]).push(t); });
  let html = '';
  Object.entries(cats).forEach(([cat, items])=>{
    html += `<div class="qb-cat-header">${cat}</div>`;
    items.forEach(t=>{
      html += `<div class="qb-tmpl-item" id="tmpl_${t.id}" onclick="selectTemplate('${t.id}')">
        <div class="qb-tmpl-name">${t.name}</div>
        <div class="qb-tmpl-cat">${t.description?t.description.substring(0,50)+'…':cat}</div>
      </div>`;
    });
  });
  list.innerHTML = html;
}

function filterTemplates(q){
  const q2 = q.toLowerCase();
  TEMPLATES.forEach(t=>{
    const el = document.getElementById('tmpl_'+t.id);
    if(!el) return;
    const match = !q2 || t.name.toLowerCase().includes(q2) || (t.category||'').toLowerCase().includes(q2) || (t.description||'').toLowerCase().includes(q2);
    el.style.display = match ? '' : 'none';
  });
  // Show/hide category headers
  document.querySelectorAll('.qb-cat-header').forEach(h=>{
    const next = h.nextElementSibling;
    // Check if any siblings in this cat are visible
    let visible = false;
    let sib = h.nextElementSibling;
    while(sib && !sib.classList.contains('qb-cat-header')){
      if(sib.style.display !== 'none') visible = true;
      sib = sib.nextElementSibling;
    }
    h.style.display = visible ? '' : 'none';
  });
}

function selectTemplate(tid){
  // Deactivate all
  document.querySelectorAll('.qb-tmpl-item').forEach(el=>el.classList.remove('active'));
  const el = document.getElementById('tmpl_'+tid);
  if(el) el.classList.add('active');
  // Find template
  const tmpl = TEMPLATES.find(t=>t.id===tid);
  if(!tmpl) return;
  // Show description
  const desc = document.getElementById('qb-desc');
  if(desc){ desc.textContent = tmpl.description||''; desc.style.display=tmpl.description?'':'none'; }
  // Build var inputs
  const varsEl = document.getElementById('qb-vars');
  varsEl.innerHTML = (tmpl.vars||[]).map(v=>
    v.type==='select'
      ? `<div class="qb-var-group"><label class="qb-var-label">${v.label}</label>
          <select class="qb-select-var" id="qbvar_${v.key}">
            ${(v.options||[]).map(o=>`<option value="${o}"${o===v.default?' selected':''}>${o}</option>`).join('')}
          </select></div>`
      : `<div class="qb-var-group"><label class="qb-var-label">${v.label}</label>
          <input class="qb-input" id="qbvar_${v.key}" type="${v.type==='number'?'number':'text'}"
            value="${v.default||''}" placeholder="${v.placeholder||v.label}"></div>`
  ).join('');
  // XQL preview hidden — keep element in DOM but don't show it
  const prev = document.getElementById('qb-xql-preview');
  if(prev){ prev.textContent=tmpl.xql||''; prev.style.display='none'; }
  // Enable run
  document.getElementById('qb-run-btn').disabled=false;
  // Hide empty state
  const es = document.getElementById('qb-empty-state');
  if(es) es.style.display='none';
  // Store selected id for runQuery
  document.getElementById('qb-run-btn').dataset.tid = tid;
}

function onTemplateChange(){ /* legacy — sidebar now handles selection */ }

let _lastQueryData = null;  // store last result for re-grouping

async function runQuery(){
  const tid = document.getElementById('qb-run-btn').dataset.tid || '';
  if(!tid) return;
  const tmpl = TEMPLATES.find(t=>t.id===tid);
  if(!tmpl) return;
  const variables = {};
  (tmpl.vars||[]).forEach(v=>{
    const el = document.getElementById('qbvar_'+v.key);
    if(el) variables[v.key] = el.value.trim();
  });
  const runBtn = document.getElementById('qb-run-btn');
  const infoEl = document.getElementById('qb-results-info');
  runBtn.disabled=true; runBtn.textContent='Running…';
  infoEl.textContent='Executing query…';
  try{
    const r = await fetch('/api/run_query',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({template_id:tid, variables})
    }).then(r=>r.json());
    if(r.error){ infoEl.innerHTML=`<span style="color:var(--red)">⚠ ${r.error}</span>`; return; }
    // XQL hidden by design — store internally for debugging but don't render
    if(document.getElementById('qb-xql-preview'))
      document.getElementById('qb-xql-preview').textContent = r.xql||'';
    const tbl  = document.getElementById('qb-results-table');
    const head = document.getElementById('qb-results-head');
    const body = document.getElementById('qb-results-body');
    if(!r.rows || !r.rows.length){
      infoEl.textContent='Query returned no results.';
      tbl.style.display='none'; _lastQueryData=null; return;
    }
    _lastQueryData = r;
    // Build group-by options from columns that are useful to group on
    const GROUP_PRIORITY = ['actor_effective_username','agent_hostname','action_remote_ip',
      'endpoint_name','assigned_user','cve_id','action_country'];
    const groupCols = (r.columns||[]).filter(c=>GROUP_PRIORITY.includes(c));
    // Default to actor_effective_username if present, else first groupable col, else flat
    const defaultGroup = groupCols.includes('actor_effective_username')
      ? 'actor_effective_username'
      : (groupCols[0] || '');
    const groupOpts = groupCols.map(c=>`<option value="${c}"${c===defaultGroup?' selected':''}>${c}</option>`).join('');
    infoEl.innerHTML = `<span>${r.count||0} rows returned</span>`
      + (groupOpts ? `<span style="margin-left:16px;font-size:.7rem;color:var(--muted)">Group by:&nbsp;
          <select id="qb-group-sel" onchange="regroupResults(this.value)"
            style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:2px 6px;border-radius:4px;font-size:.7rem">
            <option value="">— Flat list —</option>${groupOpts}
          </select></span>` : '');
    head.innerHTML='<tr>'+(r.columns||[]).map(c=>`<th>${c}</th>`).join('')+'</tr>';
    if(defaultGroup) regroupResults(defaultGroup); else renderFlatRows(r);
    tbl.style.display='table';
  }catch(e){ infoEl.innerHTML=`<span style="color:var(--red)">⚠ Query failed: ${e.message}</span>`; }
  finally{ runBtn.disabled=false; runBtn.textContent='▶ Run Query'; }
}

function renderFlatRows(r){
  const body = document.getElementById('qb-results-body');
  body.innerHTML = r.rows.map(row=>'<tr>'+(r.columns||[]).map(c=>{
    const v = row[c]??'—';
    const ts = (c==='_time'||c==='creation_time'||c==='first_seen') && typeof v==='number' && v>1e12
      ? `<span title="${v}">${new Date(v).toLocaleString()}</span>` : `<span title="${v}">${v}</span>`;
    return `<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ts}</td>`;
  }).join('')+'</tr>').join('');
}

function regroupResults(groupBy){
  if(!_lastQueryData) return;
  const r = _lastQueryData;
  const body = document.getElementById('qb-results-body');
  if(!groupBy){ renderFlatRows(r); return; }
  const groups = {};
  r.rows.forEach(row=>{
    const key = row[groupBy] || '(unknown)';
    (groups[key]=groups[key]||[]).push(row);
  });
  let html=''; let gi=0;
  Object.entries(groups).sort((a,b)=>b[1].length-a[1].length).forEach(([key,rows])=>{
    const gid='g'+gi++;
    html+=`<tr class="qb-group-header-row" style="cursor:pointer" onclick="toggleGrp('${gid}',this)">
      <td colspan="${r.columns.length}" style="font-weight:600;color:var(--accent);padding:8px 14px">
        <span id="arr_${gid}">▶</span>&nbsp;${key}
        <span style="color:var(--muted);font-weight:400;margin-left:8px">${rows.length} event${rows.length>1?'s':''}</span>
      </td></tr>`;
    rows.forEach(row=>{
      html+=`<tr class="grp_${gid}" style="display:none">`
        +(r.columns||[]).map(c=>{
          const v=row[c]??'—';
          return `<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:22px" title="${v}">${v}</td>`;
        }).join('')+'</tr>';
    });
  });
  body.innerHTML=html;
}

function toggleGrp(gid, headerRow){
  const rows = document.querySelectorAll('.grp_'+gid);
  const arr  = document.getElementById('arr_'+gid);
  const open = rows.length && rows[0].style.display!=='none';
  rows.forEach(r=>r.style.display=open?'none':'');
  if(arr) arr.textContent=open?'▶':'▼';
}

/* ── Init ──────────────────────────────────────────────────────────── */
async function loadAll(){
  const btn = document.getElementById('refresh-btn');
  btn.disabled=true; btn.textContent='Loading…';
  await Promise.all([
    loadPosture(),
    loadResponseTrend(),
    loadASM(),
    loadCVEs(),
    loadIncidents(),
    loadRiskyUsers(),
    loadMitre(),
    loadThreatIntel(),
    loadQueryTemplates(),
  ]);
  btn.disabled=false; btn.textContent='↺ Refresh';
}
loadAll();
</script>
</body>
</html>"""

@app.route("/ciso")
def ciso_dashboard():
    return render_template_string(CISO_HTML)

# ─────────────────────────────────────────────
# EXECUTIVE DASHBOARD
# ─────────────────────────────────────────────
EXEC_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Executive Dashboard — XSIAM</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh}
.topbar{background:#1a1f2e;border-bottom:1px solid #2d3748;padding:14px 28px;display:flex;align-items:center;justify-content:space-between}
.topbar h1{font-size:1.15rem;font-weight:700;color:#fff;letter-spacing:.3px}
.topbar h1 span{color:#f6ad55;margin-right:6px}
.nav-links{display:flex;gap:10px}
.nav-links a{color:#a0aec0;text-decoration:none;font-size:.8rem;padding:6px 14px;border-radius:6px;border:1px solid #2d3748;transition:all .2s}
.nav-links a:hover,.nav-links a.active{background:#2d3748;color:#fff}
.container{max-width:1300px;margin:0 auto;padding:28px 20px}
/* Posture score hero */
.posture-hero{background:linear-gradient(135deg,#1a1f2e 0%,#2d3748 100%);border:1px solid #4a5568;border-radius:16px;padding:32px 40px;margin-bottom:28px;display:flex;align-items:center;gap:48px}
.score-ring{width:140px;height:140px;flex-shrink:0;position:relative}
.score-ring canvas{position:absolute;top:0;left:0}
.score-label{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
.score-label .num{font-size:2.4rem;font-weight:800;color:#fff;line-height:1}
.score-label .txt{font-size:.65rem;color:#718096;text-transform:uppercase;letter-spacing:.8px}
.posture-text h2{font-size:1.5rem;font-weight:700;color:#fff;margin-bottom:8px}
.posture-text p{color:#a0aec0;font-size:.9rem;line-height:1.6;max-width:560px}
.hero-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:28px}
.hero-card{background:#1a1f2e;border:1px solid #2d3748;border-radius:12px;padding:20px;text-align:center;position:relative;overflow:hidden}
.hero-card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:3px;background:var(--c,#4299e1)}
.hero-card .hval{font-size:2.2rem;font-weight:800;color:#fff;margin-bottom:4px}
.hero-card .hlbl{font-size:.72rem;color:#718096;text-transform:uppercase;letter-spacing:.7px}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
@media(max-width:860px){.grid-2{grid-template-columns:1fr}.posture-hero{flex-direction:column;text-align:center}}
.card{background:#1a1f2e;border:1px solid #2d3748;border-radius:12px;padding:22px}
.card-title{font-size:.75rem;font-weight:600;color:#a0aec0;text-transform:uppercase;letter-spacing:.8px;margin-bottom:16px}
.chart-wrap{position:relative;height:200px}
.metrics-table{width:100%;border-collapse:collapse;font-size:.85rem}
.metrics-table th{color:#718096;font-size:.7rem;text-transform:uppercase;letter-spacing:.7px;padding:8px 12px;border-bottom:1px solid #2d3748;text-align:left}
.metrics-table td{padding:11px 12px;border-bottom:1px solid #1e2535}
.metrics-table tr:last-child td{border-bottom:none}
.rag{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px}
.rag-green{background:#48bb78}
.rag-amber{background:#f6ad55}
.rag-red{background:#fc8181}
.rag-grey{background:#4a5568}
.target{color:#4a5568;font-size:.75rem}
.rec-list{list-style:none;padding:0}
.rec-list li{padding:11px 14px;border-left:3px solid #4a5568;background:#161b27;margin-bottom:8px;border-radius:0 8px 8px 0;font-size:.85rem;color:#cbd5e0;line-height:1.5}
.risk-bar{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:.82rem}
.risk-label{width:160px;color:#a0aec0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.78rem}
.risk-bg{flex:1;background:#2d3748;border-radius:4px;height:10px}
.risk-fill{height:100%;border-radius:4px;background:#ed8936}
.risk-count{width:30px;text-align:right;color:#718096;font-size:.75rem}
#spinner{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,17,23,.7);display:flex;align-items:center;justify-content:center;z-index:999;font-size:1.1rem;color:#a0aec0}
</style>
</head>
<body>
<div id="spinner">Loading executive summary…</div>
<div class="topbar">
  <h1><span>📊</span>Executive Dashboard <span style="font-size:.75rem;color:#718096;margin-left:6px">30-day view</span></h1>
  <div class="nav-links">
    <a href="/">SOC Overview</a>
    <a href="/ciso">CISO</a>
    <a href="/executive" class="active">Executive</a>
  </div>
</div>
<div class="container">
  <!-- Posture Score Hero -->
  <div class="posture-hero">
    <div class="score-ring">
      <canvas id="postureRing" width="140" height="140"></canvas>
      <div class="score-label"><div class="num" id="postureNum">—</div><div class="txt">Posture</div></div>
    </div>
    <div class="posture-text">
      <h2 id="postureHeadline">Calculating…</h2>
      <p id="postureDesc">Analysing incident data from the last 30 days…</p>
    </div>
  </div>
  <!-- Hero metrics -->
  <div class="hero-row">
    <div class="hero-card" style="--c:#fc8181"><div class="hval" id="hActive">—</div><div class="hlbl">Active Threats</div></div>
    <div class="hero-card" style="--c:#f6ad55"><div class="hval" id="hCritical">—</div><div class="hlbl">Critical Open</div></div>
    <div class="hero-card" style="--c:#4299e1"><div class="hval" id="hMttr">—</div><div class="hlbl">Avg MTTR (hrs)</div></div>
    <div class="hero-card" style="--c:#48bb78"><div class="hval" id="hRes">—</div><div class="hlbl">Resolution Rate</div></div>
    <div class="hero-card" style="--c:#805ad5"><div class="hval" id="hSla">—</div><div class="hlbl">SLA Compliance</div></div>
    <div class="hero-card" style="--c:#ed8936"><div class="hval" id="hTotal">—</div><div class="hlbl">Incidents (30d)</div></div>
  </div>
  <!-- Charts row -->
  <div class="grid-2">
    <div class="card"><div class="card-title">30-Day Incident Trend</div><div class="chart-wrap"><canvas id="trendChart"></canvas></div></div>
    <div class="card"><div class="card-title">Top Business Risk Areas</div><div id="riskBars" style="padding-top:8px">Loading…</div></div>
  </div>
  <!-- Metrics table + Recommendations -->
  <div class="grid-2">
    <div class="card">
      <div class="card-title">Key Metrics — RAG Status</div>
      <table class="metrics-table"><thead><tr><th>Metric</th><th>Current</th><th>Target</th><th>Status</th></tr></thead>
      <tbody id="metricsBody"></tbody></table>
    </div>
    <div class="card">
      <div class="card-title">Recommendations</div>
      <ul class="rec-list" id="recList"><li>Loading…</li></ul>
    </div>
  </div>
</div>
<script>
let postureChart, trendChart2;
function scoreColor(s) {
  if(s>=80) return '#48bb78';
  if(s>=60) return '#f6ad55';
  return '#fc8181';
}
function scoreLabel(s) {
  if(s>=80) return ['Strong Posture','Security controls are operating effectively within acceptable risk tolerance.'];
  if(s>=60) return ['Moderate Risk','Some areas require attention. Review SLA compliance and open critical incidents.'];
  return ['Elevated Risk','Immediate leadership attention required. Multiple security indicators are below threshold.'];
}
async function loadExec() {
  const r = await fetch('/api/executive_summary');
  const d = await r.json();
  const score = d.posture_score||0;
  document.getElementById('postureNum').textContent = score;
  const [hl, desc] = scoreLabel(score);
  document.getElementById('postureHeadline').textContent = hl;
  document.getElementById('postureDesc').textContent = desc;
  // posture ring chart
  if(postureChart) postureChart.destroy();
  postureChart = new Chart(document.getElementById('postureRing'), {
    type:'doughnut',
    data:{datasets:[{data:[score,100-score],backgroundColor:[scoreColor(score),'#2d3748'],borderWidth:0,circumference:270,rotation:225}]},
    options:{cutout:'78%',plugins:{legend:{display:false},tooltip:{enabled:false}}}
  });
  // hero metrics
  document.getElementById('hActive').textContent   = d.active_threats||0;
  document.getElementById('hCritical').textContent = d.critical_open||0;
  document.getElementById('hMttr').textContent     = d.mttr!=null?d.mttr+'h':'N/A';
  document.getElementById('hRes').textContent      = (d.resolution_rate||0)+'%';
  document.getElementById('hSla').textContent      = (d.sla_compliance||0)+'%';
  document.getElementById('hTotal').textContent    = d.total_30d||0;
  // trend chart
  if(trendChart2) trendChart2.destroy();
  trendChart2 = new Chart(document.getElementById('trendChart'), {
    type:'line',
    data:{labels:d.trend_labels||[],datasets:[{
      label:'Incidents',data:d.trend_values||[],borderColor:'#4299e1',backgroundColor:'#4299e122',
      fill:true,tension:.3,pointRadius:3,pointBackgroundColor:'#4299e1'
    }]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:'#718096',font:{size:10}}},y:{ticks:{color:'#718096'},grid:{color:'#2d3748'}}}}
  });
  // risk bars
  const risks = d.top_risks||[];
  const maxR = risks[0]?.count||1;
  document.getElementById('riskBars').innerHTML = risks.length ? risks.map(r=>`
    <div class="risk-bar">
      <div class="risk-label" title="${r.name}">${r.name||'Unknown'}</div>
      <div class="risk-bg"><div class="risk-fill" style="width:${Math.round(r.count/maxR*100)}%"></div></div>
      <div class="risk-count">${r.count}</div>
    </div>`).join('') : '<div style="color:#718096;font-size:.82rem">No source data available</div>';
  // metrics table
  document.getElementById('metricsBody').innerHTML = (d.metrics||[]).map(m=>`<tr>
    <td>${m.name}</td>
    <td style="font-weight:700;color:#fff">${m.value}</td>
    <td class="target">${m.target}</td>
    <td><span class="rag rag-${m.rag}"></span>${m.rag.charAt(0).toUpperCase()+m.rag.slice(1)}</td>
  </tr>`).join('');
  // recommendations
  document.getElementById('recList').innerHTML = (d.recommendations||['No recommendations available.']).map(r=>`<li>${r}</li>`).join('');
  document.getElementById('spinner').style.display='none';
}
loadExec();
</script>
</body>
</html>"""

@app.route("/executive")
def executive_dashboard():
    return render_template_string(EXEC_HTML)

# ─────────────────────────────────────────────
# FIRST-RUN SETUP PAGE
# ─────────────────────────────────────────────

SETUP_EXEMPT = {"/setup", "/api/save_config", "/api/test_connection_setup",
                "/api/current_port", "/api/debug_feeds", "/api/debug_certin",
                "/api/debug_xql", "/favicon.ico", "/static"}

@app.before_request
def require_setup():
    """Redirect to /setup if credentials have not been configured yet."""
    path = request.path
    if any(path.startswith(p) for p in SETUP_EXEMPT):
        return None
    if not is_configured():
        return redirect("/setup")

SETUP_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XSIAM Dashboard — Admin Setup</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e2e8f0;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px}
.wrap{width:100%;max-width:580px}
/* Header */
.header{text-align:center;margin-bottom:28px}
.header .shield{font-size:2.8rem;margin-bottom:8px}
.header h1{font-size:1.4rem;font-weight:800;color:#fff;letter-spacing:.2px}
.header p{font-size:.82rem;color:#718096;margin-top:4px}
/* Step pill */
.step-pill{display:inline-block;background:#006B8F22;color:#00b4d8;border:1px solid #006B8F44;border-radius:20px;padding:3px 12px;font-size:.7rem;font-weight:700;letter-spacing:.6px;text-transform:uppercase;margin-bottom:20px}
/* Cards */
.card{background:#161b27;border:1px solid #2d3748;border-radius:12px;padding:28px 32px;margin-bottom:16px}
.card-title{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#006B8F;margin-bottom:16px;display:flex;align-items:center;gap:8px}
.card-title .num{background:#006B8F;color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:800;flex-shrink:0}
/* Instructions */
.instructions{background:#0d1117;border:1px solid #1e2535;border-radius:8px;padding:14px 16px;margin-bottom:18px;font-size:.78rem;color:#a0aec0;line-height:1.7}
.instructions ol{padding-left:18px}
.instructions li{margin-bottom:4px}
.instructions code{background:#1e2535;color:#00b4d8;padding:1px 6px;border-radius:4px;font-size:.75rem}
/* Form */
label{display:block;font-size:.73rem;font-weight:700;color:#a0aec0;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;margin-top:14px}
label:first-of-type{margin-top:0}
.field-wrap{position:relative}
input[type=text],input[type=password],input[type=number]{width:100%;background:#0d1117;border:1px solid #2d3748;border-radius:8px;padding:11px 14px;color:#e2e8f0;font-size:.88rem;transition:.15s;font-family:inherit}
input:focus{outline:none;border-color:#006B8F;box-shadow:0 0 0 3px rgba(0,107,143,.15)}
input::placeholder{color:#4a5568}
.hint{font-size:.7rem;color:#4a5568;margin-top:5px;margin-bottom:2px;line-height:1.5}
.hint a{color:#718096;text-decoration:underline}
/* Eye toggle */
.eye-btn{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#4a5568;font-size:1rem;padding:4px}
.eye-btn:hover{color:#a0aec0}
/* Port row */
.port-row{display:flex;align-items:flex-start;gap:12px}
.port-row input{width:120px;flex-shrink:0}
.port-row .port-hint{font-size:.72rem;color:#4a5568;line-height:1.5;padding-top:12px}
/* Buttons */
.btn{width:100%;padding:13px;border-radius:9px;border:none;font-size:.9rem;font-weight:700;cursor:pointer;transition:.15s;font-family:inherit;margin-top:10px}
.btn-test{background:#1e2a3b;color:#63b3ed;border:1px solid #1e3a5f}
.btn-test:hover{background:#1e3a5f}
.btn-save{background:linear-gradient(135deg,#006B8F,#0095b8);color:#fff}
.btn-save:hover{opacity:.9}
.btn-save:disabled{opacity:.4;cursor:not-allowed}
/* Status */
.status{border-radius:8px;padding:12px 16px;font-size:.82rem;margin-top:14px;display:none;line-height:1.5}
.status.ok{background:#1a3328;color:#68d391;border:1px solid #276749;display:block}
.status.err{background:#2d1515;color:#fc8181;border:1px solid #742a2a;display:block}
.status.info{background:#14243b;color:#63b3ed;border:1px solid #1e3a5f;display:block}
/* Admin note */
.admin-note{background:#1a1500;border:1px solid #3d3000;border-radius:8px;padding:14px 16px;font-size:.75rem;color:#d4a017;line-height:1.6;margin-bottom:16px}
.admin-note strong{color:#fbbf24}
/* Divider */
.divider{height:1px;background:#1e2535;margin:20px 0}
/* Already configured */
.already-link{text-align:center;font-size:.75rem;color:#4a5568;margin-top:8px}
.already-link a{color:#718096;text-decoration:underline;cursor:pointer}
</style>
</head>
<body>
<div class="wrap">

  <div class="header">
    <div class="shield">🛡️</div>
    <h1>XSIAM Live Dashboard</h1>
    <p>AltISec Security Services — Administrator Setup</p>
  </div>

  <div class="admin-note">
    <strong>👤 Admin Setup — One Time Only</strong><br>
    This page is for the IT administrator configuring the dashboard.
    Once you save credentials here and rebuild the app, <strong>your users will 
    never see this page</strong> — they just launch the app and go straight to the dashboard.
  </div>

  <!-- Step 1: Get API Key -->
  <div class="card">
    <div class="card-title"><span class="num">1</span> Get Your XSIAM API Key</div>
    <div class="instructions">
      <ol>
        <li>Open your XSIAM console in a browser</li>
        <li>Click the <code>☰</code> menu (top-left) → <strong>Settings</strong></li>
        <li>Go to <strong>Configurations → API Keys</strong></li>
        <li>Click <strong>+ New Key</strong></li>
        <li>Name it <code>Dashboard</code> &nbsp;|&nbsp; Role: <strong>Viewer</strong> (read-only)</li>
        <li>Click <strong>Generate</strong></li>
        <li>⚠️ <strong>Copy both the Key and the Key ID immediately</strong> — the Key is shown only once</li>
        <li>Your Tenant URL is in your browser address bar, e.g.:<br>
            <code>api-yourcompany.xdr.in.paloaltonetworks.com</code></li>
      </ol>
    </div>
  </div>

  <!-- Step 2: Enter credentials -->
  <div class="card">
    <div class="card-title"><span class="num">2</span> Enter Credentials</div>

    <div id="statusMsg" class="status"></div>

    <label>XSIAM Tenant URL</label>
    <input id="url" type="text"
           placeholder="api-yourcompany.xdr.in.paloaltonetworks.com"
           autocomplete="off" spellcheck="false">
    <div class="hint">The hostname from your browser address bar — without <code>https://</code></div>

    <label>API Key ID</label>
    <input id="keyid" type="text" placeholder="e.g.  24" autocomplete="off">
    <div class="hint">The short number shown next to your key in the XSIAM console</div>

    <label>API Key</label>
    <div class="field-wrap">
      <input id="key" type="password"
             placeholder="Paste the full API key string here"
             autocomplete="off">
      <button class="eye-btn" onclick="toggleKey(this)" tabindex="-1">👁</button>
    </div>
    <div class="hint">The long alphanumeric string generated in Step 1</div>

    <div class="divider"></div>

    <label>Dashboard Port</label>
    <div class="port-row">
      <input id="port" type="number" min="1024" max="65535" value="5001">
      <div class="port-hint">
        The local port the dashboard runs on (default <code>5001</code>).<br>
        Change only if another application is already using that port.
      </div>
    </div>

    <button class="btn btn-test" onclick="testConn()">🔍 Test Connection to XSIAM</button>
    <button class="btn btn-save" id="saveBtn" onclick="saveConfig()" disabled>
      ✅ Save & Open Dashboard
    </button>

    <div class="divider"></div>
    <div class="already-link">
      Already configured? <a onclick="window.location='/'">Go to dashboard →</a>
    </div>
  </div>

  <!-- Step 3: Build note -->
  <div class="card">
    <div class="card-title"><span class="num">3</span> Distribute to Users</div>
    <div class="instructions">
      After saving above, rebuild the app installer so credentials are bundled in:
      <ol style="margin-top:8px">
        <li><strong>Mac:</strong> Double-click <code>BUILD_MAC.command</code> in the app folder</li>
        <li><strong>Windows:</strong> Double-click <code>build_windows.bat</code></li>
        <li>Share the resulting <code>.dmg</code> or <code>.exe</code> installer with your team</li>
        <li>Users just install and launch — no setup, no credentials needed</li>
      </ol>
    </div>
  </div>

</div><!-- /wrap -->

<script>
function toggleKey(btn) {
  const inp = document.getElementById('key');
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

function showStatus(msg, type) {
  const el = document.getElementById('statusMsg');
  el.className = 'status ' + type;
  el.innerHTML = msg;
}

async function testConn() {
  const url   = document.getElementById('url').value.trim();
  const keyid = document.getElementById('keyid').value.trim();
  const key   = document.getElementById('key').value.trim();
  if (!url || !keyid || !key) {
    showStatus('⚠️ Please fill in all three credential fields before testing.', 'err');
    return;
  }
  showStatus('<span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:14px;height:14px;border:2px solid #1e3a5f;border-top-color:#63b3ed;border-radius:50%;animation:spin .7s linear infinite"></span> Testing connection to your XSIAM tenant…</span>', 'info');
  document.getElementById('saveBtn').disabled = true;
  try {
    const r = await fetch('/api/test_connection_setup', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ tenant_url: url, api_key_id: keyid, api_key: key })
    });
    const d = await r.json();
    if (d.ok) {
      showStatus('✅ Connection successful! ' + (d.detail || '') + '<br><small style="color:#48bb78;opacity:.8">You can now save the configuration.</small>', 'ok');
      document.getElementById('saveBtn').disabled = false;
    } else {
      showStatus('❌ Connection failed: ' + (d.error || 'Unknown error') +
        '<br><small style="opacity:.7">Check that the Tenant URL, Key ID and API Key are correct.</small>', 'err');
    }
  } catch(e) {
    showStatus('❌ Request error: ' + e.message, 'err');
  }
}

async function saveConfig() {
  const url   = document.getElementById('url').value.trim();
  const keyid = document.getElementById('keyid').value.trim();
  const key   = document.getElementById('key').value.trim();
  const port  = parseInt(document.getElementById('port').value) || 5001;
  if (port < 1024 || port > 65535) {
    showStatus('⚠️ Port must be between 1024 and 65535.', 'err'); return;
  }
  showStatus('Saving…', 'info');
  const r = await fetch('/api/save_config', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ tenant_url: url, api_key_id: keyid, api_key: key, port })
  });
  const d = await r.json();
  if (d.ok) {
    showStatus('✅ Configuration saved! Opening dashboard…', 'ok');
    setTimeout(() => window.location = '/', 1400);
  } else {
    showStatus('❌ Failed to save: ' + (d.error || ''), 'err');
  }
}

// Pre-fill port from current config
fetch('/api/current_port').then(r=>r.json()).then(d=>{ if(d.port) document.getElementById('port').value=d.port; }).catch(()=>{});

// Enter on key field triggers test
document.getElementById('key').addEventListener('keydown', e => { if (e.key === 'Enter') testConn(); });

// Spinner animation
const style = document.createElement('style');
style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
document.head.appendChild(style);
</script>
</body>
</html>"""
@app.route("/setup")
def setup_page():
    return render_template_string(SETUP_HTML)

@app.route("/api/test_connection_setup", methods=["POST"])
def test_connection_setup():
    """Test XSIAM credentials without saving them."""
    data = request.get_json() or {}
    tenant_url = _clean_tenant_url(data.get("tenant_url", ""))
    api_key    = data.get("api_key", "").strip()
    api_key_id = str(data.get("api_key_id", "")).strip()

    if not tenant_url or not api_key or not api_key_id:
        return jsonify({"ok": False, "error": "All fields are required"})

    headers = {
        "x-xdr-auth-id": api_key_id,
        "Authorization": api_key,
        "Content-Type": "application/json"
    }
    url = f"https://{tenant_url}/public_api/v1/incidents/get_incidents"
    try:
        resp = requests.post(
            url, headers=headers,
            json={"request_data": {"search_from": 0, "search_to": 1}},
            timeout=15, verify=False
        )
        if resp.status_code == 200:
            total = resp.json().get("reply", {}).get("total_count", "?")
            return jsonify({"ok": True, "detail": f"Tenant reachable — {total} total incidents found."})
        else:
            return jsonify({"ok": False, "error": f"HTTP {resp.status_code} — check your API key and key ID"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})

@app.route("/api/current_port")
def api_current_port():
    """Return the currently configured port (for pre-filling setup form)."""
    from config_manager import get_port
    return jsonify({"port": get_port()})

@app.route("/api/save_config", methods=["POST"])
def api_save_config():
    """Save credentials + port to the persistent config file."""
    data = request.get_json() or {}
    try:
        save_config(
            tenant_url = _clean_tenant_url(data.get("tenant_url", "")),
            api_key    = data.get("api_key", ""),
            api_key_id = data.get("api_key_id", ""),
            port       = data.get("port", 5001),
        )
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})

@app.route("/api/reset_config", methods=["POST"])
def api_reset_config():
    """Remove saved config (returns to setup page)."""
    delete_config()
    return jsonify({"ok": True})

# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "="*55)
    print("  XSIAM Live Dashboard starting...")
    print("  Open your browser and go to: http://localhost:5001")
    print("="*55 + "\n")
    app.run(debug=True, host="0.0.0.0", port=5001)
