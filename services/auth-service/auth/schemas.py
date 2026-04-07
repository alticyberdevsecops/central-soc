from typing import Optional, List
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: str = "analyst"
    tenant_id: Optional[UUID] = None
    tenant_ids: Optional[List[UUID]] = None  # multi-select tenants
    dashboards: Optional[List[str]] = None  # enabled dashboard tabs
    signature: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserInfo"


class UserInfo(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str
    tenant_id: Optional[UUID]
    tenant_ids: List[UUID] = []
    dashboards: List[str] = []
    signature: Optional[str] = None

    class Config:
        from_attributes = True


class UserListItem(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str
    tenant_id: Optional[UUID]
    tenant_ids: List[UUID] = []
    dashboards: List[str] = []
    signature: Optional[str] = None
    is_active: bool
    last_login: Optional[datetime]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    users: List[UserListItem]
    total: int


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    tenant_ids: Optional[List[UUID]] = None  # update tenant assignments
    dashboards: Optional[List[str]] = None  # update dashboard permissions
    signature: Optional[str] = None


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ResetPasswordRequest(BaseModel):
    password: str


class SignatureCreate(BaseModel):
    name: str
    content: str
    is_default_new: Optional[bool] = False
    is_default_reply: Optional[bool] = False


class SignatureUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    is_default_new: Optional[bool] = None
    is_default_reply: Optional[bool] = None


class SignatureInfo(BaseModel):
    id: UUID
    name: str
    content: str
    is_default_new: bool
    is_default_reply: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


TokenResponse.model_rebuild()
