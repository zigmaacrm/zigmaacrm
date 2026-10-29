from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, or_
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from app.core.database import get_db
from app.models.task import Task
from app.models.contact import Contact
from app.models.organization_user import User
from app.api.deps import get_optional_current_user

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
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(Task).order_by(Task.created_at.desc())
    if current_user and current_user.organization_id:
        query = query.where(
            or_(
                Task.organization_id == current_user.organization_id,
                Task.organization_id == None
            )
        )
        # Sales representatives receive only tasks assigned to them or created by them
        if current_user.role and current_user.role.lower() in ("sales_rep", "sales rep", "rep", "member"):
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
    current_user: Optional[User] = Depends(get_optional_current_user),
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
    if current_user and current_user.role and current_user.role.lower() in ("sales_rep", "sales rep", "rep", "member"):
        assigned_name = current_user.full_name
    else:
        assigned_name = payload.assigned_to or (current_user.full_name if current_user else "Mohamed Thoufiq")

    task = Task(
        organization_id=current_user.organization_id if current_user else None,
        title=payload.title,
        activity_type=payload.activity_type or "To-Do",
        due_date=payload.due_date,
        due_time=payload.due_time,
        priority=payload.priority or "Medium",
        status=payload.status or "PENDING",
        assigned_to=assigned_name,
        owner_id=current_user.id if current_user else None,
        owner_name=current_user.full_name if current_user else assigned_name,
        description=payload.description,
        contact_id=payload.contact_id,
        contact_name=c_name,
        contact_phone=c_phone,
        contact_company=c_company
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task

@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: str,
    payload: TaskUpdate,
    current_user: Optional[User] = Depends(get_optional_current_user),
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

    update_data = payload.dict(exclude_unset=True)
    # Sales reps cannot reassign tasks to other users
    if current_user and current_user.role and current_user.role.lower() in ("sales_rep", "sales rep", "rep", "member"):
        update_data.pop("assigned_to", None)

    for field, value in update_data.items():
        setattr(task, field, value)

    await db.commit()
    await db.refresh(task)
    return task

@router.patch("/{task_id}/toggle-status", response_model=TaskOut)
async def toggle_task_status(
    task_id: str,
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
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = "PENDING" if task.status == "COMPLETED" else "COMPLETED"
    await db.commit()
    await db.refresh(task)
    return task

@router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    current_user: Optional[User] = Depends(get_optional_current_user),
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

    await db.delete(task)
    await db.commit()
    return {"message": "Task deleted successfully", "id": task_id}
    return {"message": "Task deleted successfully", "id": task_id}
