from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.cache import get_redis
from app.core.rate_limit import limit_user_mutation
from app.core.security import list_user_sessions, require_admin, require_admin_with_csrf, revoke_user_session
from app.db.database import get_db
from app.models import User
from app.schemas.session import AdminUserListResponse, AdminUserSessionsResponse, AdminUserResponse, RevokeSessionsResponse, SessionResponse


router = APIRouter(prefix="/admin", tags=["admin sessions"])


def _sessions(user_id: int, sessions: list[dict[str, object]]) -> list[SessionResponse]:
    return [SessionResponse(session_id=item["session_id"], created_at=item["created_at"], last_active_at=item["last_active_at"], expires_at=item["expires_at"], user_agent=item["user_agent"], is_current=False) for item in sessions]


@router.get("/users", response_model=AdminUserListResponse)
def list_users(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), search: str | None = Query(None),
    db: Session = Depends(get_db), _: User = Depends(require_admin),
) -> AdminUserListResponse:
    statement = select(User)
    if search := search.strip() if search else None:
        statement = statement.where(User.email.ilike(f"%{search}%"))
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    users = list(db.scalars(statement.order_by(User.id.desc()).offset((page - 1) * page_size).limit(page_size)))
    return AdminUserListResponse(items=[AdminUserResponse.model_validate(user) for user in users], total=total, page=page, page_size=page_size, total_pages=(total + page_size - 1) // page_size)


@router.get("/users/{user_id}/sessions", response_model=AdminUserSessionsResponse)
def user_sessions(user_id: int, db: Session = Depends(get_db), redis=Depends(get_redis), _: User = Depends(require_admin)) -> AdminUserSessionsResponse:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    sessions = _sessions(user_id, list_user_sessions(redis, user_id))
    return AdminUserSessionsResponse(user=AdminUserResponse.model_validate(user), active_session_count=len(sessions), sessions=sessions)


@router.delete("/users/{user_id}/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    user_id: int, session_id: str, redis=Depends(get_redis), _: User = Depends(require_admin_with_csrf),
    __: None = Depends(limit_user_mutation),
) -> Response:
    if not revoke_user_session(redis, user_id, session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/users/{user_id}/sessions", response_model=RevokeSessionsResponse)
def revoke_all_sessions(
    user_id: int, redis=Depends(get_redis), _: User = Depends(require_admin_with_csrf),
    __: None = Depends(limit_user_mutation),
) -> RevokeSessionsResponse:
    count = 0
    for session in list_user_sessions(redis, user_id):
        count += int(revoke_user_session(redis, user_id, str(session["session_id"])))
    return RevokeSessionsResponse(revoked_count=count)
