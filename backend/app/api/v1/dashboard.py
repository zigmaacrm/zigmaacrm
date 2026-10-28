from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, or_
from typing import Optional, Dict, Any, List
from datetime import datetime, date, timedelta

from app.core.database import get_db
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.task import Task
from app.models.organization_user import User
from app.api.deps import get_current_user
from app.models.lead_pipeline import Pipeline, PipelineStage

router = APIRouter()

@router.get("/metrics")
async def get_dashboard_metrics(
    range_type: str = Query("Last 30 Days"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)
    today_date_str = now.strftime("%Y-%m-%d")

    # Determine filter threshold based on range_type
    filter_start = None
    if range_type == "Today":
        filter_start = today_start
    elif range_type == "Yesterday":
        filter_start = today_start - timedelta(days=1)
    elif range_type == "Last 7 Days":
        filter_start = now - timedelta(days=7)
    elif range_type == "Last 30 Days":
        filter_start = now - timedelta(days=30)
    elif range_type == "This Month":
        filter_start = datetime(now.year, now.month, 1)

    is_rep = (current_user.role == "SALES_REP")

    contact_rep_filter = or_(
        Contact.owner_id == current_user.id,
        Contact.assigned_user_id == current_user.id,
        Contact.owner_name.ilike(f"%{current_user.full_name}%"),
        Contact.assigned_user_name.ilike(f"%{current_user.full_name}%")
    ) if is_rep else None

    # 1. Total Leads
    target_org = current_user.organization_id or "default_org"

    # 1. Total Leads
    contact_query = select(Contact).where(
        or_(
            Contact.organization_id == target_org,
            Contact.organization_id.is_(None),
            Contact.organization_id == "default_org"
        )
    )
    if is_rep:
        contact_query = contact_query.where(contact_rep_filter)
    if filter_start and range_type != "All Time":
        contact_query = contact_query.where(
            or_(
                Contact.created_at >= filter_start,
                Contact.created_at.is_(None)
            )
        )
    
    contacts_res = await db.execute(contact_query)
    contacts = contacts_res.scalars().all()
    total_leads = len(contacts)

    # All-time contacts count for baseline
    all_contacts_query = select(func.count(Contact.id)).where(
        or_(
            Contact.organization_id == target_org,
            Contact.organization_id.is_(None),
            Contact.organization_id == "default_org"
        )
    )
    if is_rep:
        all_contacts_query = all_contacts_query.where(contact_rep_filter)
    all_contacts_res = await db.execute(all_contacts_query)
    all_time_leads = all_contacts_res.scalar() or 0

    # Leads created today
    today_leads_query = select(func.count(Contact.id)).where(
        Contact.created_at >= today_start,
        or_(
            Contact.organization_id == target_org,
            Contact.organization_id.is_(None),
            Contact.organization_id == "default_org"
        )
    )
    if is_rep:
        today_leads_query = today_leads_query.where(contact_rep_filter)
    today_leads_res = await db.execute(today_leads_query)
    today_leads = today_leads_res.scalar() or 0

    # 2. Deals and Pipeline calculations
    deals_query = select(Deal).where(
        or_(
            Deal.organization_id == target_org,
            Deal.organization_id.is_(None),
            Deal.organization_id == "default_org"
        )
    )
    if is_rep:
        deal_rep_filter = or_(
            Deal.owner_id == current_user.id,
            Deal.assigned_user_id == current_user.id,
            Deal.owner_name.ilike(f"%{current_user.full_name}%"),
            Deal.owner_id.is_(None),
            Deal.assigned_user_id.is_(None)
        )
        deals_query = deals_query.where(deal_rep_filter)
    if filter_start and range_type != "All Time":
        deals_query = deals_query.where(
            or_(
                Deal.created_at >= filter_start,
                Deal.updated_at >= filter_start,
                Deal.created_at.is_(None)
            )
        )
    deals_res = await db.execute(deals_query)
    deals = deals_res.scalars().all()

    pipeline_value = 0.0
    active_deals_count = 0
    won_revenue = 0.0
    won_deals_count = 0
    total_closed_deals = 0

    # Fetch all pipeline stages for title matching
    stages_res = await db.execute(select(PipelineStage))
    stages_list = stages_res.scalars().all()
    stage_id_to_title = {s.id: s.title for s in stages_list}

    canonical_stage_names = ["New Deal", "Discovery", "Proposal Sent", "Negotiation", "Won", "Lost"]
    stage_colors = {
        "New Deal": "#64748b",
        "Discovery": "#3b82f6",
        "Proposal Sent": "#6366f1",
        "Negotiation": "#f59e0b",
        "Won": "#10b981",
        "Lost": "#f43f5e"
    }

    def normalize_stage_title(raw: str) -> str:
        s = (raw or "").strip()
        sl = s.lower()
        if "new" in sl or "lead in" in sl or sl == "new deal":
            return "New Deal"
        if "discover" in sl or "contact made" in sl or "contact" in sl:
            return "Discovery"
        if "propos" in sl or "quote" in sl:
            return "Proposal Sent"
        if "negotiat" in sl:
            return "Negotiation"
        if "won" in sl or "closed won" in sl or "customer" in sl:
            return "Won"
        if "lost" in sl or "closed lost" in sl:
            return "Lost"
        return s or "New Deal"

    stage_aggregation: Dict[str, Dict[str, Any]] = {}

    for d in deals:
        val = float(d.deal_value or (d.custom_data and (d.custom_data.get("value") or d.custom_data.get("deal_value"))) or 0.0)
        raw_st = stage_id_to_title.get(d.stage_id) or (d.custom_data and d.custom_data.get("stage")) or d.stage_id or "New Deal"
        st_title = normalize_stage_title(raw_st)

        is_won = d.status == "WON" or st_title == "Won"
        is_lost = d.status == "LOST" or st_title == "Lost"

        if is_won:
            won_revenue += val
            won_deals_count += 1
            total_closed_deals += 1
        elif is_lost:
            total_closed_deals += 1
        else:
            pipeline_value += val
            active_deals_count += 1

        if st_title not in stage_aggregation:
            order = canonical_stage_names.index(st_title) if st_title in canonical_stage_names else 99
            stage_aggregation[st_title] = {
                "title": st_title,
                "order": order,
                "color": stage_colors.get(st_title, "#3b82f6"),
                "count": 0,
                "value": 0.0
            }
        stage_aggregation[st_title]["count"] += 1
        stage_aggregation[st_title]["value"] += val

    # Conversion Rate %
    conversion_rate = 0.0
    if len(deals) > 0:
        conversion_rate = round((won_deals_count / len(deals)) * 100, 1)

    # 3. Tasks / Pending Follow-ups (status == PENDING and due_date <= today)
    tasks_query = select(Task).where(Task.status.ilike("PENDING"))
    if current_user.organization_id:
        tasks_query = tasks_query.where(Task.organization_id == current_user.organization_id)
    if is_rep:
        task_rep_filter = or_(
            Task.owner_id == current_user.id,
            Task.owner_name.ilike(f"%{current_user.full_name}%"),
            Task.assigned_to.ilike(f"%{current_user.full_name}%")
        )
        tasks_query = tasks_query.where(task_rep_filter)
    all_pending_tasks_res = await db.execute(tasks_query)
    all_pending_tasks = all_pending_tasks_res.scalars().all()
    
    pending_followups = 0
    today_due_tasks: List[Dict[str, Any]] = []

    for t in all_pending_tasks:
        d_date = t.due_date or ""
        # Overdue or today
        if not d_date or d_date <= today_date_str:
            pending_followups += 1
        
        # Today's due tasks list
        if d_date == today_date_str or (not d_date and len(today_due_tasks) < 5):
            today_due_tasks.append({
                "id": t.id,
                "title": t.title,
                "activity_type": t.activity_type or "To-Do",
                "due_date": t.due_date,
                "due_time": t.due_time,
                "priority": t.priority or "Medium",
                "status": t.status,
                "contact_name": t.contact_name,
                "contact_id": t.contact_id
            })

    # If fewer than 5 today tasks, include top overdue/pending tasks
    if len(today_due_tasks) < 5:
        for t in all_pending_tasks:
            if not any(item["id"] == t.id for item in today_due_tasks):
                today_due_tasks.append({
                    "id": t.id,
                    "title": t.title,
                    "activity_type": t.activity_type or "To-Do",
                    "due_date": t.due_date,
                    "due_time": t.due_time,
                    "priority": t.priority or "Medium",
                    "status": t.status,
                    "contact_name": t.contact_name,
                    "contact_id": t.contact_id
                })
            if len(today_due_tasks) >= 5:
                break

    # 4. Source Breakdown from contacts (clean, deduplicated & canonicalized)
    source_counts: Dict[str, int] = {}
    for c in contacts:
        raw_src = (c.source or "Manual").strip()
        s_norm = raw_src.upper().replace("-", "_").replace(" ", "_")
        if "META" in s_norm or "FACEBOOK" in s_norm or "INSTAGRAM" in s_norm:
            canon = "Meta Ads"
        elif "GOOGLE" in s_norm:
            canon = "Google Ads"
        elif "WHATSAPP" in s_norm:
            canon = "WhatsApp"
        elif "WEB" in s_norm or "FORM" in s_norm:
            canon = "Website Form"
        elif "CSV" in s_norm or "EXCEL" in s_norm or "IMPORT" in s_norm:
            canon = "Excel / CSV Import"
        elif "REFERRAL" in s_norm:
            canon = "Referral"
        elif "COLD" in s_norm or "OUTREACH" in s_norm:
            canon = "Cold Outreach"
        elif "LINKEDIN" in s_norm:
            canon = "LinkedIn Ads"
        elif "YOUTUBE" in s_norm:
            canon = "YouTube"
        else:
            canon = "Manual"
        source_counts[canon] = source_counts.get(canon, 0) + 1

    source_breakdown = []
    for src, cnt in sorted(source_counts.items(), key=lambda x: x[1], reverse=True):
        if cnt > 0:
            pct = round((cnt / total_leads * 100), 1) if total_leads > 0 else 0.0
            source_breakdown.append({
                "source": src,
                "count": cnt,
                "percentage": pct
            })

    # 5. Recent Leads (top 5 latest contacts)
    recent_leads_query = select(Contact)
    if current_user.organization_id:
        recent_leads_query = recent_leads_query.where(Contact.organization_id == current_user.organization_id)
    if is_rep:
        recent_leads_query = recent_leads_query.where(contact_rep_filter)
    recent_leads_res = await db.execute(
        recent_leads_query.order_by(Contact.created_at.desc()).limit(6)
    )
    recent_contacts = recent_leads_res.scalars().all()
    recent_leads = [
        {
            "id": c.id,
            "full_name": c.full_name,
            "email": c.email,
            "phone": c.phone,
            "company_name": c.company_name or "Private Client",
            "source": c.source or "MANUAL",
            "lifecycle_stage": c.lifecycle_stage or "NEW",
            "created_at": c.created_at.isoformat() if c.created_at else None
        }
        for c in recent_contacts
    ]

    # Convert stage_aggregation to sorted list, showing only active stages with deals
    stage_breakdown = sorted(
        [s for s in stage_aggregation.values() if s["count"] > 0],
        key=lambda x: x["order"]
    )

    return {
        "range_type": range_type,
        "total_leads": total_leads,
        "all_time_leads": all_time_leads,
        "today_leads": today_leads,
        "pipeline_value": round(pipeline_value, 2),
        "active_deals_count": active_deals_count,
        "won_revenue": round(won_revenue, 2),
        "won_deals_count": won_deals_count,
        "conversion_rate": conversion_rate,
        "pending_followups": pending_followups,
        "source_breakdown": source_breakdown,
        "stage_breakdown": stage_breakdown,
        "recent_leads": recent_leads,
        "today_due_tasks": today_due_tasks
    }
