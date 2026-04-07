import asyncio
import re
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import sys

DATABASE_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"

LIGHT_THEME_BLOCK = """
        [data-theme="light"] {
            --bg-dark: #ffffff;
            --bg-card: #f6f8fa;
            --border-color: #d0d7de;
            --text-main: #1f2328;
            --text-muted: #57606a;
            --accent-gold: rgb(185, 126, 6);
            --accent-red: #d1242f;
            --accent-green: #1a7f37;
            --header-bg: #f6f8fa;
        }
        """

THEME_SCRIPT = """
    <script>
        window.addEventListener('message', function(event) {
            if (event.data && event.data.type === 'theme-change') {
                document.documentElement.setAttribute('data-theme', event.data.theme);
            }
        });
    </script>
</body>
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
                
                # Update hardcoded hex to CSS variables
                verdict_html = verdict_html.replace('background-color: #1a1b1a;', 'background-color: var(--header-bg);')
                
                # Add light mode CSS block if not present
                if '[data-theme="light"]' not in verdict_html and 'body {' in verdict_html:
                    verdict_html = verdict_html.replace('body {', LIGHT_THEME_BLOCK + '\n        body {')
                
                # Add postMessage script if not present
                if "type === 'theme-change'" not in verdict_html and '</body>' in verdict_html:
                    verdict_html = verdict_html.replace('</body>', THEME_SCRIPT)
                    
                await conn.execute(text("UPDATE incidents SET ai_verdict = :v WHERE id = :id"), {"v": verdict_html, "id": inc.id})
                print(f"Patched report themes for incident {inc.id} in schema {schema}")
                
if __name__ == "__main__":
    asyncio.run(fix_html())
