from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, or_
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
import logging

from app.core.database import get_db
from app.models.task import Task
from app.models.contact import Contact
from app.models.organization_user import User, Organization
from app.api.deps import get_current_user, get_optional_current_user

logger = logging.getLogger("zigmaa.tasks")

router = APIRouter()

class TaskCreate(BaseModel):
    title: str
    activity_type: Optional[str] = "To-Do"
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    priority: Optional[str] = "Medium"
    status: Optional[str] = "PENDING"
    assigned_to: Optional[str] = "Mohamed Thoufiq"
    description: Optional[str] = None
    contact_id: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_company: Optional[str] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    activity_type: Optional[str] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    description: Optional[str] = None
    contact_id: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_company: Optional[str] = None

class TaskOut(BaseModel):
    id: str
    title: str
    activity_type: Optional[str] = "To-Do"
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    priority: Optional[str] = "Medium"
    status: Optional[str] = "PENDING"
    assigned_to: Optional[str] = "Mohamed Thoufiq"
    description: Optional[str] = None
    contact_id: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_company: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

@router.get("", response_model=List[TaskOut])
@router.get("/", response_model=List[TaskOut])
async def get_tasks(
    status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(Task).order_by(Task.created_at.desc())
    if current_user.organization_id:
        query = query.where(Task.organization_id == current_user.organization_id)

    # Supabase RLS / Query Isolation:
    # Admins, Owners, and Super Admins MUST receive ALL organization tasks across sessions.
    # Only non-admin sales reps have their query scoped to assigned tasks.
    role = (current_user.role or "").upper().replace(" ", "_")
    is_admin = role in ("ADMIN", "SUPER_ADMIN", "OWNER") or "ADMIN" in role
    if not is_admin and role in ("SALES_REP", "REP", "MEMBER"):
        query = query.where(
            or_(
                Task.assigned_to == current_user.full_name,
                Task.assigned_to.ilike(f"%{current_user.full_name}%"),
                Task.owner_id == current_user.id,
                Task.owner_name.ilike(f"%{current_user.full_name}%")
            )
        )
    if status and status != "ALL":
        query = query.where(Task.status.ilike(status))
    result = await db.execute(query)
    return result.scalars().all()

@router.post("", response_model=TaskOut, status_code=201)
@router.post("/", response_model=TaskOut, status_code=201)
async def create_task(
    payload: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # If contact_id is provided, auto-fill contact details if missing
    c_name = payload.contact_name
    c_phone = payload.contact_phone
    c_company = payload.contact_company

    if payload.contact_id and (not c_name or not c_phone or not c_company):
        res = await db.execute(select(Contact).where(Contact.id == payload.contact_id))
        contact = res.scalar_one_or_none()
        if contact:
            c_name = c_name or contact.full_name
            c_phone = c_phone or contact.phone
            c_company = c_company or contact.company_name

    # Role-based assignment protection:
    # Sales Reps can only assign tasks to themselves; Admins can assign to any rep
    if (current_user.role or "").upper() == "SALES_REP":
        assigned_name = current_user.full_name
    else:
        assigned_name = payload.assigned_to or current_user.full_name

    # Resolve organization_id to ensure task is strictly scoped to user's org
    org_id = current_user.organization_id
    if not org_id:
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        org_id = org.id if org else "default_org"

    task = Task(
        organization_id=org_id,
        title=payload.title,
        activity_type=payload.activity_type or "To-Do",
        due_date=payload.due_date,
        due_time=payload.due_time,
        priority=payload.priority or "Medium",
        status=payload.status or "PENDING",
        assigned_to=assigned_name,
        owner_id=current_user.id,
        owner_name=current_user.full_name,
        description=payload.description,
        contact_id=payload.contact_id,
        contact_name=c_name,
        contact_phone=c_phone,
        contact_company=c_company
    )
    db.add(task)
    try:
        await db.commit()
        await db.refresh(task)
        logger.info(f"Persisted task {task.id} for org {task.organization_id} to Supabase")
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to persist task to Supabase: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database persistence error: {str(e)}")
    return task

@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: str,
    payload: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        # Fallback check by int if needed
        try:
            int_id = int(task_id)
            result = await db.execute(select(Task).where(Task.id == int_id))
            task = result.scalar_one_or_none()
        except Exception:
            pass

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if current_user.organization_id and task.organization_id and task.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied: Cannot update a task from another organization.")
    if (current_user.role or "").upper() == "SALES_REP":
        if task.owner_id and task.owner_id != current_user.id and task.assigned_to != current_user.full_name:
            raise HTTPException(status_code=403, detail="Access denied: You can only update tasks assigned to you.")

    update_data = payload.dict(exclude_unset=True)
    # Sales reps cannot reassign tasks to other users
    if (current_user.role or "").upper() == "SALES_REP":
        update_data.pop("assigned_to", None)

    for field, value in update_data.items():
        setattr(task, field, value)

    try:
        await db.commit()
        await db.refresh(task)
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to update task: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database update error: {str(e)}")
    return task

@router.patch("/{task_id}/toggle-status", response_model=TaskOut)
async def toggle_task_status(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        try:
            int_id = int(task_id)
            result = await db.execute(select(Task).where(Task.id == int_id))
            task = result.scalar_one_or_none()
        except Exception:
            pass

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if current_user.organization_id and task.organization_id and task.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied: Task belongs to another organization.")
    if (current_user.role or "").upper() == "SALES_REP":
        if task.owner_id and task.owner_id != current_user.id and task.assigned_to != current_user.full_name:
            raise HTTPException(status_code=403, detail="Access denied: You can only update tasks assigned to you.")

    task.status = "PENDING" if task.status == "COMPLETED" else "COMPLETED"
    try:
        await db.commit()
        await db.refresh(task)
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to toggle task: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database update error: {str(e)}")
    return task

@router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        try:
            int_id = int(task_id)
            result = await db.execute(select(Task).where(Task.id == int_id))
            task = result.scalar_one_or_none()
        except Exception:
            pass

    if not task:
        return {"message": "Task already deleted or not found", "id": task_id}

    if current_user.organization_id and task.organization_id and task.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied: Cannot delete a task from another organization.")
    if (current_user.role or "").upper() == "SALES_REP":
        raise HTTPException(status_code=403, detail="Access denied: Sales representatives are not authorized to delete tasks.")

    try:
        await db.delete(task)
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to delete task: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database delete error: {str(e)}")
    return {"message": "Task deleted successfully", "id": task_id}
