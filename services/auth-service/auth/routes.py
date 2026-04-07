import logging
from datetime import datetime, timezone
from typing import Optional, List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select, update, delete, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from auth.database import get_db
from auth.models import User, UserTenant, RefreshToken, UserSignature
from auth.schemas import (
    LoginRequest, RegisterRequest, TokenResponse, UserInfo,
    RefreshRequest, ChangePasswordRequest, ResetPasswordRequest,
    UserListItem, UserListResponse, UserUpdateRequest,
    SignatureCreate, SignatureUpdate, SignatureInfo,
)
from auth.security import (
    hash_password, verify_password, create_access_token,
    create_refresh_token, decode_token, hash_token
)
from config import settings

router = APIRouter()
security = HTTPBearer()
logger = logging.getLogger("auth.routes")


# ── Helpers ──────────────────────────────────────────────────────

async def _get_user_tenant_ids(db: AsyncSession, user_id) -> List[str]:
    """Fetch all tenant_ids assigned to a user from user_tenants table."""
    result = await db.execute(
        select(UserTenant.tenant_id).where(UserTenant.user_id == user_id)
    )
    return [str(row[0]) for row in result.fetchall()]


async def _sync_user_tenants(db: AsyncSession, user_id, tenant_ids: List[UUID]):
    """Replace all tenant assignments for a user."""
    await db.execute(delete(UserTenant).where(UserTenant.user_id == user_id))
    for tid in tenant_ids:
        db.add(UserTenant(user_id=user_id, tenant_id=tid))


def _build_user_info(user: User, tenant_ids: List[str]) -> UserInfo:
    return UserInfo(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role.value,
        tenant_id=user.tenant_id,
        tenant_ids=[UUID(t) for t in tenant_ids],
        dashboards=user.dashboards or [],
        signature=user.signature,
    )


def _build_token_data(user: User, tenant_ids: List[str]) -> dict:
    return {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role.value,
        "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        "tenant_ids": tenant_ids,
        "dashboards": user.dashboards or [],
    }


# ── Auth Deps ────────────────────────────────────────────────────

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_role(*roles):
    async def check(current_user: User = Depends(get_current_user)):
        if current_user.role.value not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return check


# ── Login ────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == request.email, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    tenant_ids = await _get_user_tenant_ids(db, user.id)
    token_data = _build_token_data(user, tenant_ids)
    access_token = create_access_token(token_data)
    refresh_token, expires_at = create_refresh_token(token_data)

    # Store refresh token hash
    rt = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(refresh_token),
        expires_at=expires_at,
    )
    db.add(rt)

    # Update last login
    await db.execute(
        update(User).where(User.id == user.id).values(last_login=datetime.now(timezone.utc))
    )
    await db.commit()

    logger.info(f"User {user.email} logged in successfully")
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=_build_user_info(user, tenant_ids),
    )


# ── Refresh ──────────────────────────────────────────────────────

@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(request: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(request.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    token_hash = hash_token(request.refresh_token)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked == False,
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    stored_rt = result.scalar_one_or_none()
    if not stored_rt:
        raise HTTPException(status_code=401, detail="Refresh token revoked or expired")

    # Revoke old token (rotation)
    await db.execute(
        update(RefreshToken).where(RefreshToken.id == stored_rt.id).values(revoked=True)
    )

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    tenant_ids = await _get_user_tenant_ids(db, user.id)
    token_data = _build_token_data(user, tenant_ids)
    access_token = create_access_token(token_data)
    new_refresh_token, expires_at = create_refresh_token(token_data)

    rt = RefreshToken(user_id=user.id, token_hash=hash_token(new_refresh_token), expires_at=expires_at)
    db.add(rt)
    await db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=_build_user_info(user, tenant_ids),
    )


# ── Register ─────────────────────────────────────────────────────

@router.post("/register", response_model=UserInfo, dependencies=[Depends(require_role("super_admin", "customer_admin"))])
async def register(request: RegisterRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    # customer_admin can only create analysts in their own tenant
    if current_user.role.value == "customer_admin":
        if request.role not in ("analyst",):
            raise HTTPException(status_code=403, detail="customer_admin can only create analysts")
        # For customer_admin, force their own tenant
        own_tenant_ids = await _get_user_tenant_ids(db, current_user.id)
        if not own_tenant_ids and current_user.tenant_id:
            own_tenant_ids = [str(current_user.tenant_id)]
        # customer_admin can only assign their own tenant(s)
        if request.tenant_ids:
            for tid in request.tenant_ids:
                if str(tid) not in own_tenant_ids:
                    raise HTTPException(status_code=403, detail="Cannot assign users to tenants you don't manage")
        elif request.tenant_id:
            if str(request.tenant_id) not in own_tenant_ids:
                raise HTTPException(status_code=403, detail="Cannot create users for other tenants")

    existing = await db.execute(select(User).where(User.email == request.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    # Determine tenant assignment
    # Priority: tenant_ids (multi-select) > tenant_id (legacy single)
    assigned_tenant_ids = []
    primary_tenant_id = None

    if request.tenant_ids and len(request.tenant_ids) > 0:
        assigned_tenant_ids = request.tenant_ids
        primary_tenant_id = request.tenant_ids[0]  # first as primary for backward compat
    elif request.tenant_id:
        assigned_tenant_ids = [request.tenant_id]
        primary_tenant_id = request.tenant_id

    user = User(
        email=request.email,
        full_name=request.full_name,
        hashed_password=hash_password(request.password),
        role=request.role,
        tenant_id=primary_tenant_id,
        dashboards=request.dashboards or [],
        signature=request.signature,
    )
    db.add(user)
    await db.flush()  # get user.id

    # Insert into user_tenants junction table
    for tid in assigned_tenant_ids:
        db.add(UserTenant(user_id=user.id, tenant_id=tid))

    await db.commit()
    await db.refresh(user)

    final_tids = [str(t) for t in assigned_tenant_ids]
    logger.info(f"User {user.email} created by {current_user.email} with tenants={final_tids}")
    return _build_user_info(user, final_tids)


# ── Me ───────────────────────────────────────────────────────────

@router.get("/me", response_model=UserInfo)
async def me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tenant_ids = await _get_user_tenant_ids(db, current_user.id)
    return _build_user_info(current_user, tenant_ids)


@router.patch("/me", response_model=UserInfo)
async def update_me(
    request: UserUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Allow any user to update their own profile fields."""
    update_data = {}
    if request.full_name is not None:
        update_data["full_name"] = request.full_name
    if request.signature is not None:
        update_data["signature"] = request.signature
    
    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc)
        await db.execute(update(User).where(User.id == current_user.id).values(**update_data))
        await db.commit()
        await db.refresh(current_user)
    
    tenant_ids = await _get_user_tenant_ids(db, current_user.id)
    return _build_user_info(current_user, tenant_ids)


# ── Change Password ──────────────────────────────────────────────

@router.post("/change-password")
async def change_password(request: ChangePasswordRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not verify_password(request.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect current password")

    current_user.hashed_password = hash_password(request.new_password)
    await db.commit()
    logger.info(f"User {current_user.email} changed password successfully")
    return {"message": "Password updated successfully"}


# ── Validate (for API Gateway) ──────────────────────────────────

@router.post("/validate")
async def validate_token(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Internal endpoint for API Gateway to validate tokens."""
    tenant_ids = await _get_user_tenant_ids(db, current_user.id)
    return {
        "valid": True,
        "user_id": str(current_user.id),
        "email": current_user.email,
        "role": current_user.role.value,
        "tenant_id": str(current_user.tenant_id) if current_user.tenant_id else None,
        "tenant_ids": tenant_ids,
    }


# ── User Management Endpoints ──────────────────────────────────

@router.get("/users", response_model=UserListResponse)
async def list_users(
    role: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List users. Super admin sees all; customer_admin sees only their tenant."""
    if current_user.role.value not in ("super_admin", "customer_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    query = select(User)

    # Tenant scoping: customer_admin can only see their own tenant's users
    if current_user.role.value == "customer_admin":
        admin_tids = await _get_user_tenant_ids(db, current_user.id)
        if not admin_tids and current_user.tenant_id:
            admin_tids = [str(current_user.tenant_id)]
        if admin_tids:
            # Get user_ids that have ANY of the admin's tenants
            ut_sub = select(UserTenant.user_id).where(
                UserTenant.tenant_id.in_([UUID(t) for t in admin_tids])
            )
            # Also include users with legacy tenant_id
            query = query.where(
                or_(
                    User.id.in_(ut_sub),
                    User.tenant_id.in_([UUID(t) for t in admin_tids]),
                )
            )

    if role:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    if search:
        query = query.where(
            or_(
                User.email.ilike(f"%{search}%"),
                User.full_name.ilike(f"%{search}%"),
            )
        )

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # Get users ordered by created_at desc
    query = query.order_by(User.created_at.desc())
    result = await db.execute(query)
    users = result.scalars().all()

    # Batch-fetch all tenant assignments for these users
    user_ids = [u.id for u in users]
    ut_result = await db.execute(
        select(UserTenant.user_id, UserTenant.tenant_id).where(UserTenant.user_id.in_(user_ids))
    ) if user_ids else None

    user_tenant_map: dict[str, list[str]] = {}
    if ut_result:
        for row in ut_result.fetchall():
            uid = str(row[0])
            tid = str(row[1])
            user_tenant_map.setdefault(uid, []).append(tid)

    return UserListResponse(
        users=[
            UserListItem(
                id=u.id,
                email=u.email,
                full_name=u.full_name,
                role=u.role.value,
                tenant_id=u.tenant_id,
                tenant_ids=[UUID(t) for t in user_tenant_map.get(str(u.id), [])],
                dashboards=u.dashboards or [],
                is_active=u.is_active,
                last_login=u.last_login,
                created_at=u.created_at,
            )
            for u in users
        ],
        total=total,
    )


@router.patch("/users/{user_id}", response_model=UserListItem)
async def update_user(
    user_id: UUID,
    request: UserUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update user details including role and tenant assignments."""
    if current_user.role.value not in ("super_admin", "customer_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # customer_admin can only manage users in their own tenant
    if current_user.role.value == "customer_admin":
        admin_tids = await _get_user_tenant_ids(db, current_user.id)
        if not admin_tids and current_user.tenant_id:
            admin_tids = [str(current_user.tenant_id)]
        user_tids = await _get_user_tenant_ids(db, user.id)
        if not user_tids and user.tenant_id:
            user_tids = [str(user.tenant_id)]
        # Check that admin manages at least one of the user's tenants
        if not any(t in admin_tids for t in user_tids):
            raise HTTPException(status_code=403, detail="Cannot manage users from other tenants")
        # customer_admin cannot change roles beyond analyst
        if request.role and request.role not in ("analyst",):
            raise HTTPException(status_code=403, detail="customer_admin can only assign analyst role")
        # customer_admin cannot assign tenants they don't manage
        if request.tenant_ids is not None:
            for tid in request.tenant_ids:
                if str(tid) not in admin_tids:
                    raise HTTPException(status_code=403, detail="Cannot assign tenants you don't manage")

    # Prevent self-deactivation
    if request.is_active is False and str(user.id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    update_data = {}
    if request.is_active is None:
        pass # Already handled above or not needed
    
    if request.full_name is not None:
        update_data["full_name"] = request.full_name
    if request.role is not None:
        update_data["role"] = request.role
    if request.is_active is not None:
        update_data["is_active"] = request.is_active
    if request.dashboards is not None:
        update_data["dashboards"] = request.dashboards
    if request.signature is not None:
        update_data["signature"] = request.signature

    # Update tenant assignments if provided
    if request.tenant_ids is not None:
        await _sync_user_tenants(db, user_id, request.tenant_ids)
        # Update primary tenant_id for backward compat
        update_data["tenant_id"] = request.tenant_ids[0] if request.tenant_ids else None

    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc)
        await db.execute(update(User).where(User.id == user_id).values(**update_data))

    await db.commit()
    await db.refresh(user)

    tenant_ids = await _get_user_tenant_ids(db, user.id)
    logger.info(f"User {user.email} updated by {current_user.email}: fields={list(update_data.keys())}, tenants={tenant_ids}")
    return UserListItem(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role.value,
        tenant_id=user.tenant_id,
        tenant_ids=[UUID(t) for t in tenant_ids],
        dashboards=user.dashboards or [],
        signature=user.signature,
        is_active=user.is_active,
        last_login=user.last_login,
        created_at=user.created_at,
    )


@router.patch("/users/{user_id}/toggle-status")
async def toggle_user_status(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle user active/inactive."""
    if current_user.role.value not in ("super_admin", "customer_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if current_user.role.value == "customer_admin":
        admin_tids = await _get_user_tenant_ids(db, current_user.id)
        if not admin_tids and current_user.tenant_id:
            admin_tids = [str(current_user.tenant_id)]
        user_tids = await _get_user_tenant_ids(db, user.id)
        if not user_tids and user.tenant_id:
            user_tids = [str(user.tenant_id)]
        if not any(t in admin_tids for t in user_tids):
            raise HTTPException(status_code=403, detail="Cannot manage users from other tenants")

    if str(user.id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    new_status = not user.is_active
    await db.execute(
        update(User).where(User.id == user_id).values(is_active=new_status, updated_at=datetime.now(timezone.utc))
    )
    await db.commit()

    action = "activated" if new_status else "deactivated"
    logger.info(f"User {user.email} {action} by {current_user.email}")
    return {"message": f"User {action} successfully", "is_active": new_status}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a user. Super admin only."""
    if current_user.role.value != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can delete users")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if str(user.id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    await db.delete(user)
    await db.commit()
    logger.info(f"User {user.email} deleted by {current_user.email}")
    return {"message": "User deleted successfully"}


@router.patch("/users/{user_id}/reset-password")
async def reset_password(
    user_id: UUID,
    request: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("super_admin")),
):
    """Administrative password reset (Super User only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.hashed_password = hash_password(request.password)
    user.updated_at = datetime.now(timezone.utc)
    await db.commit()

    logger.info(f"Password for user {user.email} reset by superadmin {current_user.email}")
    return {"message": "Password reset successfully"}


# ── Signature Management ───────────────────────────────────────

@router.get("/signatures", response_model=List[SignatureInfo])
async def list_signatures(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(UserSignature).where(UserSignature.user_id == current_user.id).order_by(UserSignature.created_at.asc()))
    return result.scalars().all()


@router.post("/signatures", response_model=SignatureInfo)
async def create_signature(request: SignatureCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    # If this is marked as default, unset others of same type
    if request.is_default_new:
        await db.execute(update(UserSignature).where(UserSignature.user_id == current_user.id).values(is_default_new=False))
    if request.is_default_reply:
        await db.execute(update(UserSignature).where(UserSignature.user_id == current_user.id).values(is_default_reply=False))
    
    sig = UserSignature(
        user_id=current_user.id,
        name=request.name,
        content=request.content,
        is_default_new=request.is_default_new,
        is_default_reply=request.is_default_reply
    )
    db.add(sig)
    await db.commit()
    await db.refresh(sig)
    return sig


@router.patch("/signatures/{sig_id}", response_model=SignatureInfo)
async def update_signature(sig_id: UUID, request: SignatureUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(UserSignature).where(UserSignature.id == sig_id, UserSignature.user_id == current_user.id))
    sig = result.scalar_one_or_none()
    if not sig:
        raise HTTPException(status_code=404, detail="Signature not found")
    
    if request.is_default_new:
        await db.execute(update(UserSignature).where(UserSignature.user_id == current_user.id).values(is_default_new=False))
    if request.is_default_reply:
        await db.execute(update(UserSignature).where(UserSignature.user_id == current_user.id).values(is_default_reply=False))
        
    update_data = request.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(sig, k, v)
        
    await db.commit()
    await db.refresh(sig)
    return sig


@router.delete("/signatures/{sig_id}")
async def delete_signature(sig_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(UserSignature).where(UserSignature.id == sig_id, UserSignature.user_id == current_user.id))
    sig = result.scalar_one_or_none()
    if not sig:
        raise HTTPException(status_code=404, detail="Signature not found")
        
    await db.delete(sig)
    await db.commit()
    return {"message": "Signature deleted successfully"}
