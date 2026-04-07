import asyncio
import re
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import sys

DATABASE_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"

CSS_TO_INJECT = """
        /* Responsive Wrappers Injected via DB Patch */
        .table-responsive {
            width: 100%;
            max-height: 250px;
            overflow: auto;
            border-bottom: 1px solid #30363d;
            -webkit-overflow-scrolling: touch;
        }
        .detail-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            background-color: rgba(0, 0, 0, 0.2);
        }
        .detail-table th {
            background-color: #1a1b1a; /* solid color so scrolling rows don't show behind */
            color: #d29922;
            text-align: left;
            padding: 8px 15px;
            font-size: 10px;
            text-transform: uppercase;
            border-bottom: 2px solid #d29922;
            position: sticky;
            top: 0;
            z-index: 10;
        }
        .detail-table td {
            padding: 8px 15px;
            border-bottom: 1px solid #30363d;
        }
    </style>
"""

async def fix_html():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        res = await conn.execute(text("SELECT id, schema_name FROM public.tenants"))
        tenants = res.fetchall()
        for tenant in tenants:
            schema = tenant.schema_name
            await conn.execute(text(f"SET LOCAL search_path TO {schema}, public"))
            res_inc = await conn.execute(text("SELECT id, ai_verdict FROM incidents WHERE ai_verdict IS NOT NULL"))
            incidents = res_inc.fetchall()
            for inc in incidents:
                verdict_html = inc.ai_verdict
                if '.table-responsive' not in verdict_html and '</style>' in verdict_html:
                    # Inject the missing CSS!
                    verdict_html = verdict_html.replace('</style>', CSS_TO_INJECT)
                    await conn.execute(text("UPDATE incidents SET ai_verdict = :v WHERE id = :id"), {"v": verdict_html, "id": inc.id})
                    print(f"Injected CSS for incident {inc.id} in schema {schema}")
                
if __name__ == "__main__":
    asyncio.run(fix_html())
