import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import sys

DATABASE_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"

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
                if '<table class="mitre-table">' in verdict_html:
                    # Upgrade the old template structure to the new responsive one!
                    new_struct = '''<div class="table-responsive">
                        <table class="detail-table">'''
                    verdict_html = verdict_html.replace('<table class="mitre-table">', new_struct)
                    
                    # Need to close the new div. The end of the mitre block is '</table>\n                </td>\n            </tr>'
                    # We will replace '</table>\n                </td>' with '</table></div></td>'
                    # Let's be safer with regex or just simple replace
                    import re
                    # Replace </table> followed by spaces and </td> with </table></div></td>
                    verdict_html = re.sub(r'</table>\s*</td>', '</table></div></td>', verdict_html)
                    
                    await conn.execute(text("UPDATE incidents SET ai_verdict = :v WHERE id = :id"), {"v": verdict_html, "id": inc.id})
                    print(f"Fixed mitre table for incident {inc.id} in schema {schema}")
                
if __name__ == "__main__":
    asyncio.run(fix_html())
