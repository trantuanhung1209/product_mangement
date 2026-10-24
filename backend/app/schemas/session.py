from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.user import UserRole


class SessionResponse(BaseModel):
    session_id: str
    created_at: datetime
    last_active_at: datetime
    expires_at: datetime
    user_agent: str
    is_current: bool


class RevokeSessionsResponse(BaseModel):
    revoked_count: int


class AdminUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    role: UserRole
    is_active: bool


class AdminUserListResponse(BaseModel):
    items: list[AdminUserResponse]
    total: int
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total_pages: int = Field(ge=0)


class AdminUserSessionsResponse(BaseModel):
    user: AdminUserResponse
    active_session_count: int
    sessions: list[SessionResponse]
