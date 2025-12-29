# Project Roadmap

This file tracks pending work items for coordination across agents and sessions.

## Status Legend
- `[ ]` - Not started
- `[~]` - In progress
- `[x]` - Completed
- `[?]` - Blocked / Needs clarification

---

## Active Tasks

*No active tasks*

---

## Technical Debt / Future Architecture

### Full Async Backend Migration
**Priority:** Low (current sync approach works fine for home use)
**Rationale:** The backend was converted to fully synchronous to fix a broken async/sync mix where async endpoints made blocking SQLAlchemy calls. For high-concurrency production use, a proper async implementation would be beneficial.

**What needs to change:**

1. **Database Driver** - Switch from `psycopg2` to `asyncpg`
   ```bash
   # In pyproject.toml, replace:
   # psycopg2-binary → asyncpg
   ```

2. **Database Session** - Use async session maker in `src/database.py`:
   ```python
   from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

   # Change connection string from postgresql:// to postgresql+asyncpg://
   engine = create_async_engine(settings.database_url.replace("postgresql://", "postgresql+asyncpg://"))
   AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

   async def get_db():
       async with AsyncSessionLocal() as session:
           yield session
   ```

3. **Rewrite All Queries** - SQLAlchemy 2.0 async style:
   ```python
   # Before (sync ORM):
   user = db.query(User).filter(User.id == user_id).first()

   # After (async):
   result = await db.execute(select(User).where(User.id == user_id))
   user = result.scalar_one_or_none()
   ```

4. **API Endpoints** - Convert back to `async def`:
   ```python
   @router.get("/users/{id}")
   async def get_user(id: int, db: AsyncSession = Depends(get_db)):
       result = await db.execute(select(User).where(User.id == id))
       return result.scalar_one_or_none()
   ```

5. **LLMService** - Already has async httpx code (currently sync), revert to async

6. **Celery Tasks** - Keep sync but use `asyncio.run()` at task boundaries, OR consider using an async task queue like `arq`

7. **Dependencies** - Update `get_current_user` and service factories to be async

**Files to modify:**
- `src/database.py` - async engine and session
- `src/api/dependencies.py` - async get_db, async get_current_user
- `src/api/*.py` - all route handlers (7 files)
- `src/services/llm.py` - revert to async httpx
- `src/services/categorization.py` - async methods
- `src/services/pantry_service.py` - async methods
- `src/services/recipe_service.py` - async methods
- `src/tasks/*.py` - add asyncio.run() wrappers

**Estimated scope:** ~500-800 lines of changes across 15+ files


## Notes

- Agents should not mark tasks as complete - human review required
- Update this file when starting/finishing work to avoid conflicts
- Completed tasks are removed during commits to prevent unbounded file growth
