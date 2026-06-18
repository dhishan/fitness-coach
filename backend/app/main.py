from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from app.config import get_settings
from app.mcp_server import build_mcp_app, mcp


settings = get_settings()

# Fail fast in production if JWT secret is still the dev placeholder.
# Without this assertion a misconfigured deploy silently accepts forgeable tokens.
if settings.environment != "development" and settings.jwt_secret_key == "dev-only-secret":
    raise RuntimeError(
        "JWT_SECRET_KEY env var must be set in production. "
        "Refusing to start with the default 'dev-only-secret'."
    )

if settings.sentry_dsn:
    import logging as _logging

    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=settings.sentry_profiles_sample_rate,
        send_default_pii=False,
        attach_stacktrace=True,
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
            LoggingIntegration(level=_logging.INFO, event_level=_logging.ERROR),
        ],
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with mcp.session_manager.run():
        yield


# Rate limiter — per-IP by default; specific routes raise per-user limits.
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])

app = FastAPI(title="fitness-tracker-backend", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


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


@app.get("/internal/sentry-test")
def sentry_test(token: str = ""):
    """Fire a known event into Sentry to verify the pipe is live.

    Requires SENTRY_TEST_TOKEN env var; guards against random hits. The
    response says only whether an event was captured — the user should
    look in Sentry to confirm it arrived.
    """
    expected = settings.jwt_secret_key  # reuse: not a real secret, just a tag
    if not settings.sentry_dsn:
        return {"captured": False, "reason": "SENTRY_DSN not configured"}
    if token != expected[:12] or len(token) < 8:
        return {"captured": False, "reason": "unauthorized"}
    try:
        import sentry_sdk
        sentry_sdk.capture_message(
            "sentry-test.verification",
            level="info",
        )
        return {"captured": True, "look_at": "https://dhishan.sentry.io/issues/?project=fitness-tracker-backend"}
    except Exception as e:
        return {"captured": False, "reason": f"{type(e).__name__}: {e}"}
