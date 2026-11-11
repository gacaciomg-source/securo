import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_async_session
from app.core.workspace_context import (
    WorkspaceContext,
    current_workspace,
    current_writable_workspace,
)
from app.schemas.goal import GoalCreate, GoalRead, GoalSummary, GoalUpdate
from app.services import goal_service

router = APIRouter(prefix="/api/goals", tags=["goals"])


@router.get("", response_model=list[GoalRead])
async def list_goals(
    status: Optional[str] = Query(None),
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    return await goal_service.get_goals(session, ctx.workspace.id, ctx.user_id, status)


@router.get("/summary", response_model=list[GoalSummary])
async def goal_summary(
    limit: int = Query(3, ge=1, le=10),
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    return await goal_service.get_goal_summary(session, ctx.workspace.id, ctx.user_id, limit)


@router.post("", response_model=GoalRead, status_code=status.HTTP_201_CREATED)
async def create_goal(
    data: GoalCreate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    try:
        return await goal_service.create_goal(session, ctx.workspace.id, ctx.user_id, data)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/{goal_id}", response_model=GoalRead)
async def get_goal(
    goal_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    goal = await goal_service.get_goal(session, goal_id, ctx.workspace.id, ctx.user_id)
    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return goal


@router.patch("/{goal_id}", response_model=GoalRead)
async def update_goal(
    goal_id: uuid.UUID,
    data: GoalUpdate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    try:
        goal = await goal_service.update_goal(session, goal_id, ctx.workspace.id, ctx.user_id, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return goal


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal(
    goal_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    deleted = await goal_service.delete_goal(session, goal_id, ctx.workspace.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")


@router.post("/{goal_id}/image", response_model=GoalRead)
async def upload_goal_image(
    goal_id: uuid.UUID,
    file: UploadFile,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    """Set the goal's cover photo, replacing any previous one."""
    data = await file.read()
    try:
        goal = await goal_service.set_goal_image(
            session, goal_id, ctx.workspace.id, ctx.user_id,
            file.content_type or "application/octet-stream", data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return goal


@router.get("/{goal_id}/image")
async def get_goal_image(
    goal_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    found = await goal_service.get_goal_image(session, goal_id, ctx.workspace.id)
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal image not found")
    data, content_type = found
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=86400"})


@router.delete("/{goal_id}/image", response_model=GoalRead)
async def delete_goal_image(
    goal_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    goal = await goal_service.delete_goal_image(session, goal_id, ctx.workspace.id, ctx.user_id)
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return goal
