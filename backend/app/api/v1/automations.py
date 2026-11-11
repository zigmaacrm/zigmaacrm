from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List, Optional, Any, Dict
from pydantic import BaseModel
from datetime import datetime

from app.core.database import get_db
from app.models.workflow import Workflow, WorkflowLog
from app.models.organization_user import Organization, User
from app.api.deps import get_current_user

router = APIRouter()

class WorkflowCreate(BaseModel):
    name: str
    module: str = "CONTACT"  # CONTACT, DEAL
    trigger_event: str  # CONTACT_CREATED, STAGE_CHANGED, TASK_OVERDUE
    conditions: Optional[Dict[str, Any]] = {}
    actions: Optional[List[Dict[str, Any]]] = []
    is_active: Optional[bool] = True

class WorkflowOut(BaseModel):
    id: str
    organization_id: str
    name: str
    module: str
    trigger_event: str
    conditions: Optional[Dict[str, Any]] = {}
    actions: Optional[List[Dict[str, Any]]] = []
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_executed: Optional[str] = None
    execution_count: Optional[int] = 0

    class Config:
        from_attributes = True

class WorkflowLogOut(BaseModel):
    id: str
    workflow_id: str
    workflow_name: Optional[str] = None
    entity_id: Optional[str] = None
    action_type: str
    status: str
    error_message: Optional[str] = None
    executed_at: datetime

    class Config:
        from_attributes = True

@router.get("/automations", response_model=List[WorkflowOut])
async def get_workflows(
    module: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = select(Workflow).order_by(Workflow.created_at.desc())
    if current_user.organization_id:
        query = query.where(Workflow.organization_id == current_user.organization_id)
    if module:
        query = query.where(Workflow.module == module.upper())
    result = await db.execute(query)
    workflows = result.scalars().all()

    out_list = []
    for wf in workflows:
        # Check last log
        log_res = await db.execute(
            select(WorkflowLog)
            .where(WorkflowLog.workflow_id == wf.id)
            .order_by(WorkflowLog.executed_at.desc())
        )
        last_log = log_res.scalars().first()

        # Count total runs
        count_res = await db.execute(
            select(WorkflowLog).where(WorkflowLog.workflow_id == wf.id)
        )
        total_runs = len(count_res.scalars().all())

        out_list.append({
            "id": wf.id,
            "organization_id": wf.organization_id,
            "name": wf.name,
            "module": wf.module,
            "trigger_event": wf.trigger_event,
            "conditions": wf.conditions or {},
            "actions": wf.actions or [],
            "is_active": wf.is_active,
            "created_at": wf.created_at,
            "updated_at": wf.updated_at,
            "last_executed": last_log.executed_at.isoformat() if last_log else None,
            "execution_count": total_runs
        })
    return out_list

@router.post("/automations", response_model=WorkflowOut)
async def create_workflow(
    wf_in: WorkflowCreate,
    org_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if (current_user.role or "").upper() == "SALES_REP":
        raise HTTPException(status_code=403, detail="Access denied: Only administrators can configure automations.")

    target_org_id = current_user.organization_id or org_id
    if not target_org_id:
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        target_org_id = org.id if org else "default_org"

    wf = Workflow(
        organization_id=target_org_id,
        name=wf_in.name,
        module=wf_in.module.upper(),
        trigger_event=wf_in.trigger_event,
        conditions=wf_in.conditions or {},
        actions=wf_in.actions or [],
        is_active=wf_in.is_active if wf_in.is_active is not None else True
    )
    db.add(wf)
    await db.commit()
    await db.refresh(wf)

    # Automatically add initial simulation log
    log = WorkflowLog(
        workflow_id=wf.id,
        action_type=wf.actions[0].get("action", "INITIALIZE") if wf.actions else "INITIALIZE",
        status="SUCCESS",
        error_message=None
    )
    db.add(log)
    await db.commit()

    return {
        "id": wf.id,
        "organization_id": wf.organization_id,
        "name": wf.name,
        "module": wf.module,
        "trigger_event": wf.trigger_event,
        "conditions": wf.conditions or {},
        "actions": wf.actions or [],
        "is_active": wf.is_active,
        "created_at": wf.created_at,
        "updated_at": wf.updated_at,
        "last_executed": log.executed_at.isoformat(),
        "execution_count": 1
    }

@router.patch("/automations/{workflow_id}/toggle")
async def toggle_workflow(
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if (current_user.role or "").upper() == "SALES_REP":
        raise HTTPException(status_code=403, detail="Access denied: Only administrators can configure automations.")

    res = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    wf = res.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if current_user.organization_id and wf.organization_id and wf.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied: Workflow belongs to another organization.")

    wf.is_active = not wf.is_active
    await db.commit()
    await db.refresh(wf)
    return {"id": wf.id, "is_active": wf.is_active, "name": wf.name}

@router.delete("/automations/{workflow_id}")
async def delete_workflow(
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if (current_user.role or "").upper() == "SALES_REP":
        raise HTTPException(status_code=403, detail="Access denied: Only administrators can delete automations.")

    res = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    wf = res.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if current_user.organization_id and wf.organization_id and wf.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied: Workflow belongs to another organization.")

    # Delete logs
    await db.execute(
        WorkflowLog.__table__.delete().where(WorkflowLog.workflow_id == workflow_id)
    )
    await db.delete(wf)
    await db.commit()
    return {"message": "Workflow and associated history logs deleted successfully"}

@router.get("/automations/history", response_model=List[WorkflowLogOut])
async def get_automation_history(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = (
        select(WorkflowLog, Workflow.name.label("workflow_name"))
        .outerjoin(Workflow, WorkflowLog.workflow_id == Workflow.id)
        .order_by(desc(WorkflowLog.executed_at))
        .limit(limit)
    )
    if current_user.organization_id:
        query = query.where(Workflow.organization_id == current_user.organization_id)
    res = await db.execute(query)
    rows = res.all()
    history = []
    for log, wf_name in rows:
        history.append({
            "id": log.id,
            "workflow_id": log.workflow_id,
            "workflow_name": wf_name or "Deleted Workflow",
            "entity_id": log.entity_id,
            "action_type": log.action_type,
            "status": log.status,
            "error_message": log.error_message,
            "executed_at": log.executed_at
        })
    return history
