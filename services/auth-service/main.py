import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from auth.routes import router as auth_router
from auth.database import engine, Base

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("auth-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Auth service starting up...")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        logger.warning(f"Metadata creation failed (might already exist): {e}")

    # Migrate existing tenant_id assignments to user_tenants junction table
    try:
        from sqlalchemy import text
        from auth.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            # Insert into user_tenants for any user with tenant_id that doesn't already have a mapping
            await db.execute(text("""
                INSERT INTO user_tenants (id, user_id, tenant_id, created_at)
                SELECT gen_random_uuid(), u.id, u.tenant_id, NOW()
                FROM users u
                WHERE u.tenant_id IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM user_tenants ut
                    WHERE ut.user_id = u.id AND ut.tenant_id = u.tenant_id
                  )
            """))
            await db.commit()
            logger.info("Migrated existing tenant_id assignments to user_tenants table")
    except Exception as e:
        logger.warning(f"user_tenants migration note: {e}")

    # Add dashboards column to users table if it doesn't exist
    try:
        from sqlalchemy import text
        from auth.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            # PostgreSQL: update enum type
            try:
                # We try to add the value to the existing enum type
                await db.execute(text("COMMIT")) # Ensure not in transaction for ALTER TYPE
                await db.execute(text("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'dashboard_manager'"))
                await db.commit()
            except Exception as e:
                logger.warning(f"user_role enum update note: {e}")
            
            # Add column
            await db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS dashboards JSONB DEFAULT '[]'"))
            await db.commit()
            logger.info("Ensured dashboards column and role value exist in database")
    except Exception as e:
        logger.warning(f"Migration note: {e}")

    yield
    logger.info("Auth service shutting down.")


app = FastAPI(
    title="Central SOC — Auth Service",
    description="JWT Authentication & RBAC for multi-tenant SOC platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth", tags=["Authentication"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "auth-service"}
