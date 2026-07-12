"""
FastAPI application entry point for Quality & Bugs Dashboard.
Serves REST API endpoints for bug aggregation, charts, and exports.
"""

from fastapi import FastAPI, Query, HTTPException, Depends, status
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import csv
import io
import json
from pydantic import BaseModel, Field

# Models
class BugFilter(BaseModel):
    project_id: Optional[int] = Field(None, ge=1, description="Project ID filter")
    team: Optional[str] = Field(None, description="Team filter")
    component: Optional[str] = Field(None, description="Component filter")
    assignee: Optional[str] = Field(None, description="Assignee filter")
    severity_threshold: Optional[str] = Field(None, description="Minimum severity to include")
    time_window_days: int = Field(30, ge=1, le=365, description="Time window in days")

class BugCountSummary(BaseModel):
    total_open: int = Field(..., description="Total open bugs")
    newly_opened: int = Field(..., description="Bugs opened in time window")
    resolved: int = Field(..., description="Bugs resolved in time window")
    net_change: int = Field(..., description="Net change (newly opened - resolved)")
    severity_breakdown: Dict[str, int] = Field(..., description="Open bugs by severity")

# Configuration
app = FastAPI(
    title="Quality & Bugs Dashboard API",
    version="1.0.0",
    description="REST API for bug counts, severity distribution, and trends"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mock data cache
MOCK_BACKLOG = [
    {
        "id": "BUG-1001",
        "title": "Memory leak in auth service",
        "severity": "Critical",
        "status": "Open",
        "assignee": "alice",
        "created_at": "2025-04-01T10:00:00Z",
        "duration_days": 14,
        "project_id": 1,
        "team": "auth",
        "component": "auth-service"
    },
    {
        "id": "BUG-1002",
        "title": "Login form validation issue",
        "severity": "High",
        "status": "Open",
        "assignee": "bob",
        "created_at": "2025-04-03T11:30:00Z",
        "duration_days": 12,
        "project_id": 1,
        "team": "auth",
        "component": "ui"
    },
    {
        "id": "BUG-1003",
        "title": "Missing error messages on API",
        "severity": "High",
        "status": "Open",
        "assignee": "carol",
        "created_at": "2025-04-02T09:00:00Z",
        "duration_days": 13,
        "project_id": 2,
        "team": "payments",
        "component": "api"
    },
    {
        "id": "BUG-1004",
        "title": "Currency formatting broken in EU",
        "severity": "Medium",
        "status": "New",
        "assignee": "bob",
        "created_at": "2025-04-05T13:00:00Z",
        "duration_days": 10,
        "project_id": 2,
        "team": "payments",
        "component": "ui"
    },
    {
        "id": "BUG-1005",
        "title": "API documentation outdated",
        "severity": "Low",
        "status": "New",
        "assignee": "alice",
        "created_at": "2025-04-06T14:00:00Z",
        "duration_days": 9,
        "project_id": 1,
        "team": "docs",
        "component": "docs"
    },
    {
        "id": "BUG-1006",
        "title": "Null pointer crash on reload",
        "severity": "Critical",
        "status": "Open",
        "assignee": "dave",
        "created_at": "2025-03-20T08:00:00Z",
        "duration_days": 17,
        "project_id": 3,
        "team": "core",
        "component": "core"
    },
    {
        "id": "BUG-1007",
        "title": "Slow page load on mobile",
        "severity": "Medium",
        "status": "Open",
        "assignee": "carol",
        "created_at": "2025-03-25T10:00:00Z",
        "duration_days": 12,
        "project_id": 3,
        "team": "performance",
        "component": "frontend"
    },
    {
        "id": "BUG-1008",
        "title": "Export button unresponsive",
        "severity": "Low",
        "status": "New",
        "assignee": "bob",
        "created_at": "2025-04-06T15:00:00Z",
        "duration_days": 8,
        "project_id": 2,
        "team": "ui",
        "component": "ui"
    },
]

severity_order = ["Critical", "High", "Medium", "Low"]
severity_colors = {
    "Critical": "#EF4444",
    "High": "#F59E0B",
    "Medium": "#10B981",
    "Low": "#6B7280"
}

def apply_filters(bugs: List[Dict[str, Any]], project_id: Optional[int] = None,
                  team: Optional[str] = None, component: Optional[str] = None,
                  assignee: Optional[str] = None, severity_threshold: Optional[str] = None) -> List[Dict[str, Any]]:
    filtered = bugs
    if project_id:
        filtered = [b for b in filtered if b.get("project_id") == project_id]
    if team:
        filtered = [b for b in filtered if b.get("team") == team]
    if component:
        filtered = [b for b in filtered if b.get("component") == component]
    if assignee:
        filtered = [b for b in filtered if b.get("assignee") == assignee]
    if severity_threshold:
        try:
            idx = severity_order.index(severity_threshold)
            filtered = [b for b in filtered if severity_order.index(b.get("severity", "Low")) >= idx]
        except ValueError:
            pass
    return filtered

def filter_by_time_window(bugs: List[Dict[str, Any]], days: int) -> List[Dict[str, Any]]:
    cutoff = datetime.now() - timedelta(days=days)
    return [b for b in bugs if datetime.fromisoformat(b["created_at"].replace("Z", "+00:00")) >= cutoff]

@app.get("/")
async def root():
    return {
        "message": "Quality & Bugs Dashboard API",
        "version": "1.0.0",
        "endpoints": {
            "count_summary": "/api/v1/bugs/count-summary",
            "trend_data": "/api/v1/bugs/trend-data",
            "severity_breakdown": "/api/v1/bugs/severity-breakdown",
            "all_bugs": "/api/v1/bugs/list",
            "sync_jira": "/api/v1/sync/jira",
            "sync_github": "/api/v1/sync/github",
            "export_csv": "/api/v1/export/csv",
            "export_pdf": "/api/v1/export/pdf",
            "health": "/api/v1/health",
        }
    }

@app.get("/api/v1/bugs/count-summary", response_model=BugCountSummary, status_code=status.HTTP_200_OK)
async def get_bug_count_summary(
    project_id: Optional[int] = Query(None, ge=1),
    team: Optional[str] = Query(None),
    component: Optional[str] = Query(None),
    assignee: Optional[str] = Query(None),
    severity_threshold: Optional[str] = Query(None),
    time_window_days: int = Query(30, ge=1, le=365)
):
    """
    Returns bug count summary, delta, and severity breakdown.
    """
    try:
        filtered_bugs = apply_filters(MOCK_BACKLOG, project_id, team, component, assignee, severity_threshold)
        bugs_in_window = filter_by_time_window(filtered_bugs, time_window_days)

        open_bugs = [b for b in bugs_in_window if b.get("status") in ["Open", "New"]]
        total_open = len(open_bugs)
        newly_opened = sum(1 for b in open_bugs if b.get("status") == "New")
        resolved = [b for b in bugs_in_window if b.get("status") == "Resolved"]

        net_change = len(newly_opened) - len(resolved)

        severity_breakdown = {}
        for severity in severity_order:
            count = sum(1 for b in open_bugs if b.get("severity") == severity)
            severity_breakdown[severity] = count

        return BugCountSummary(
            total_open=total_open,
            newly_opened=len(newly_opened),
            resolved=len(resolved),
            net_change=net_change,
            severity_breakdown=severity_breakdown
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/bugs/trend-data")
async def get_trend_data(
    project_id: Optional[int] = Query(None, ge=1),
    team: Optional[str] = Query(None),
    component: Optional[str] = Query(None),
    assignee: Optional[str] = Query(None),
    severity_threshold: Optional[str] = Query(None),
    time_window_days: int = Query(30, ge=1, le=365)
):
    """
    Returns time-series trend data for open bugs, newly opened, and resolved.
    """
    try:
        filtered_bugs = apply_filters(MOCK_BACKLOG, project_id, team, component, assignee, severity_threshold)
        trends = {
            "total_open": [],
            "newly_opened": [],
            "resolved": [],
            "labels": []
        }

        for i in range(time_window_days):
            current_date = datetime.now() - timedelta(days=(time_window_days - 1 - i))
            date_str = current_date.strftime("%Y-%m-%d")
            trends["labels"].append(date_str)
            cutoff = current_date - timedelta(days=1)
            start_cutoff = current_date - timedelta(days=2)

            daily_bugs = [b for b in filtered_bugs
                          if datetime.fromisoformat(b["created_at"].replace("Z", "+00:00")) > start_cutoff
                          and datetime.fromisoformat(b["created_at"].replace("Z", "+00:00")) <= cutoff]

            total_open_count = sum(1 for b in daily_bugs if b.get("status") in ["Open", "New"])
            newly = sum(1 for b in daily_bugs if b.get("status") == "New")
            resolved_count = sum(1 for b in daily_bugs if b.get("status") == "Resolved")

            trends["total_open"].append(total_open_count)
            trends["newly_opened"].append(newly)
            trends["resolved"].append(resolved_count)

        return trends
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/bugs/severity-breakdown")
async def get_severity_breakdown(
    project_id: Optional[int] = Query(None, ge=1),
    team: Optional[str] = Query(None),
    component: Optional[str] = Query(None),
    assignee: Optional[str] = Query(None),
    include_expired: bool = Query(False)
):
    """
    Returns severity breakdown for current open bugs.
    """
    try:
        # Filter to open status only
        all_open = [b for b in MOCK_BACKLOG if b.get("status") in ["Open", "New"]]
        filtered_bugs = apply_filters(all_open, project_id, team, component, assignee)
        breakdown = {severity: 0 for severity in severity_order}
        for severity in severity_order:
            count = sum(1 for b in filtered_bugs if b.get("severity") == severity)
            breakdown[severity] = count

        return {
            "breakdown": breakdown,
            "colors": severity_colors,
            "total": len(filtered_bugs)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/bugs/list")
async def get_bugs_list(
    project_id: Optional[int] = Query(None, ge=1),
    team: Optional[str] = Query(None),
    component: Optional[str] = Query(None),
    assignee: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    time_window_days: int = Query(30, ge=1, le=365),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100)
):
    """
    List all filtered bugs with pagination.
    """
    try:
        filtered_bugs = apply_filters(MOCK_BACKLOG, project_id, team, component, assignee, severity if severity else None)

        if status:
            filtered_bugs = [b for b in filtered_bugs if b.get("status") == status]

        # Time window filter on list results
        bugs_in_window = filter_by_time_window(filtered_bugs, time_window_days)
        total = len(bugs_in_window)

        start_idx = (page - 1) * page_size
        paginated_bugs = bugs_in_window[start_idx:start_idx + page_size]

        return {
            "bugs": paginated_bugs,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/sync/jira")
async def sync_jira(
    project_id: Optional[int] = Query(None, ge=1),
    force_sync: bool = Query(False)
):
    """
    Manually trigger Jira data sync.
    Returns sync status.
    """
    try:
        sync_time = datetime.now().isoformat()
        overall_status = "connected" if MOCK_BACKLOG else "error"

        return {
            "source": "Jira",
            "project_id": project_id,
            "force_sync": force_sync,
            "last_synced": sync_time,
            "status": overall_status,
            "synced_count": len(MOCK_BACKLOG),
            "message": f"Synced {len(MOCK_BACKLOG)} bugs from Jira"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/sync/github")
async def sync_github(
    repo_full_name: Optional[str] = Query(None),
    force_sync: bool = Query(False)
):
    """
    Manually trigger GitHub Issues sync.
    Returns sync status.
    """
    try:
        sync_time = datetime.now().isoformat()
        overall_status = "connected" if MOCK_BACKLOG else "error"

        return {
            "source": "GitHub",
            "repo_full_name": repo_full_name,
            "force_sync": force_sync,
            "last_synced": sync_time,
            "status": overall_status,
            "synced_count": len(MOCK_BACKLOG),
            "message": f"Synced {len(MOCK_BACKLOG)} issues from GitHub"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/export/csv")
async def export_csv(
    project_id: Optional[int] = Query(None, ge=1),
    team: Optional[str] = Query(None),
    component: Optional[str] = Query(None),
    assignee: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    time_window_days: int = Query(30, ge=1, le=365)
):
    """
    Export filtered bugs to CSV.
    Columns: Bug ID, Title, Severity, Status, Assignee, Created Date, Resolved Date
    """
    try:
        filtered_bugs = apply_filters(MOCK_BACKLOG, project_id, team, component, assignee, severity)
        bugs_in_window = filter_by_time_window(filtered_bugs, time_window_days)
        bugs_in_window = [b for b in bugs_in_window if b.get("status") != "Resolved"]

        headers = ["Bug ID", "Title", "Severity", "Status", "Assignee", "Created Date", "Resolved Date"]
        rows = []
        for bug in bugs_in_window:
            created_date = bug.get("created_at") or ""
            resolved_date = bug.get("resolved_date") or ""
            row = [
                bug.get("id", ""),
                bug.get("title", ""),
                bug.get("severity", ""),
                bug.get("status", ""),
                bug.get("assignee", ""),
                created_date,
                resolved_date
            ]
            rows.append(row)

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        writer.writerows(rows)

        filename = "quality-bugs-export.csv"
        output.seek(0)

        return StreamingResponse(
            output,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/export/pdf")
async def export_pdf(
    project_id: Optional[int] = Query(None, ge=1),
    team: Optional[str] = Query(None),
    component: Optional[str] = Query(None),
    assignee: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    time_window_days: int = Query(30, ge=1, le=365)
):
    """
    Export filtered bugs summary to PDF.
    Includes summary counts, severity chart, and trend chart.
    Note: PDF generation requires full chart rendering and reportlab support; currently returns JSON export.
    """
    try:
        summary_response = await get_bug_count_summary(
            project_id=project_id,
            team=team,
            component=component,
            assignee=assignee,
            severity_threshold=severity,
            time_window_days=time_window_days
        )
        summary = summary_response.dict()

        trend_response = await get_trend_data(
            project_id=project_id,
            team=team,
            component=component,
            assignee=assignee,
            severity_threshold=severity,
            time_window_days=time_window_days
        )
        trend = trend_response
        trend_data = {
            "labels": trend["labels"],
            "total_open": trend["total_open"],
            "newly_opened": trend["newly_opened"],
            "resolved": trend["resolved"]
        }

        breakdown_response = await get_severity_breakdown(
            project_id=project_id,
            team=team,
            component=component,
            assignee=assignee,
            include_expired=False
        )
        breakdown = breakdown_response
        severity_breakdown = breakdown["breakdown"]
        severity_colors = breakdown["colors"]

        report_data = {
            "generated_at": datetime.now().isoformat(),
            "filters": {
                "project_id": project_id,
                "team": team,
                "component": component,
                "assignee": assignee,
                "severity": severity,
                "time_window_days": time_window_days
            },
            "summary": summary,
            "trend": trend_data,
            "breakdown": {
                "severity_breakdown": severity_breakdown,
                "severity_colors": severity_colors
            }
        }

        json_report = json.dumps(report_data, indent=2)
        output = io.BytesIO(json_report.encode("utf-8"))

        filename = "quality-bugs-report.json"
        output.seek(0)

        return StreamingResponse(
            output,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/health")
async def health_check():
    """
    Health check endpoint.
    """
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)