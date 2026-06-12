from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings

app = FastAPI(title="fitness-tracker-backend")

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
from app.routers.usage import router as usage_router

app.include_router(auth_router)
app.include_router(exercises_router)
app.include_router(workouts_router)
app.include_router(dashboard_router)
app.include_router(chat_router)
app.include_router(usage_router)


@app.get("/health")
def health():
    return {"status": "ok"}
