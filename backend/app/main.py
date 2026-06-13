from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.mcp_server import build_mcp_app, mcp


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="fitness-tracker-backend", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from app.auth.router import router as auth_router
from app.routers.exercises import router as exercises_router
from app.routers.workouts import router as workouts_router
from app.routers.dashboard import router as dashboard_router
from app.routers.chat import router as chat_router
from app.routers.templates import router as templates_router
from app.routers.usage import router as usage_router
from app.routers.uploads import router as uploads_router
from app.routers.nutrition import router as nutrition_router
from app.routers.body import router as body_router
from app.routers.cardio import router as cardio_router
from app.routers.healthkit import router as healthkit_router

app.include_router(auth_router)
app.include_router(exercises_router)
app.include_router(workouts_router)
app.include_router(dashboard_router)
app.include_router(chat_router)
app.include_router(templates_router)
app.include_router(usage_router)
app.include_router(uploads_router)
app.include_router(nutrition_router)
app.include_router(body_router)
app.include_router(cardio_router)
app.include_router(healthkit_router)

app.mount("/mcp", build_mcp_app())


@app.get("/health")
def health():
    return {"status": "ok"}
