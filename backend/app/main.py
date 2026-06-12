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

app.include_router(auth_router)
app.include_router(exercises_router)


@app.get("/health")
def health():
    return {"status": "ok"}
