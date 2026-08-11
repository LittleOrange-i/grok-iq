from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.analyzer import Thresholds
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.integrations.grok2api.client import Grok2APIClient
from app.persistence.account_repository import AccountRepository
from app.persistence.auth_repository import AuthRepository
from app.persistence.chat_provider_repository import ChatProviderRepository
from app.persistence.database import Database
from app.persistence.probe_repository import ProbeRepository
from app.persistence.register_event_repository import RegisterEventRepository
from app.persistence.settings_repository import SettingsRepository
from app.services.account_service import AccountService
from app.services.auth_service import AuthService
from app.services.chat_service import ChatService
from app.services.probe_manager import ProbeManager
from app.services.register_integration import RegisterIntegrationService
from app.services.scheduler import SchedulerService
from app.services.settings_service import RuntimeSettingsService
from app.web.auth import AdminAuthenticationRequired
from app.web.router import build_router

settings = get_settings()
probe_log_path = configure_logging(settings.database_path)
thresholds = Thresholds(
    degradation_tps=settings.degradation_tps,
    strong_degradation_tps=settings.strong_degradation_tps,
    minimum_output_tokens=settings.minimum_output_tokens,
    buffer_first_token_share=settings.buffer_first_token_share,
    min_generation_ms=settings.min_generation_ms,
    consecutive_anomalies=settings.consecutive_anomalies,
    cross_egress_min=settings.cross_egress_min,
)

database = Database(settings.database_path)
account_repository = AccountRepository(database)
auth_repository = AuthRepository(database)
chat_provider_repository = ChatProviderRepository(database, settings)
probe_repository = ProbeRepository(database)
settings_repository = SettingsRepository(database, settings)
register_event_repository = RegisterEventRepository(database)
runtime_settings_service = RuntimeSettingsService(settings, settings_repository)
auth_service = AuthService(settings, auth_repository)
chat_service = ChatService(settings=settings, providers=chat_provider_repository)
grok_client = Grok2APIClient(settings)
probe_manager = ProbeManager(
    settings=settings,
    repository=probe_repository,
    accounts=account_repository,
    client=grok_client,
    thresholds=thresholds,
    log_path=probe_log_path,
)
account_service = AccountService(
    settings=settings,
    client=grok_client,
    accounts=account_repository,
    probes=probe_repository,
)
scheduler_service = SchedulerService(
    settings=settings,
    repository=probe_repository,
    probes=probe_manager,
    recovery_callback=account_service.recover_due_quarantines,
)
register_integration_service = RegisterIntegrationService(
    settings=settings,
    repository=register_event_repository,
    accounts=account_repository,
    account_service=account_service,
    probes=probe_manager,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.initialize()
    runtime_settings_service.load()
    chat_service.bootstrap()
    grok_client.reset_credentials()
    await probe_manager.reconfigure()
    await probe_manager.start()
    await register_integration_service.start()
    await scheduler_service.start()
    try:
        yield
    finally:
        await scheduler_service.stop()
        await register_integration_service.stop()
        await probe_manager.stop()
        database.dispose()


app = FastAPI(title=settings.app_name, version="0.3.0", lifespan=lifespan)


@app.exception_handler(AdminAuthenticationRequired)
async def admin_authentication_required(
    _: Request,
    exc: AdminAuthenticationRequired,
) -> JSONResponse:
    return JSONResponse(
        status_code=401,
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
        content={
            "detail": exc.message,
            "code": "setup_required" if exc.setup_required else "authentication_required",
            "setupRequired": exc.setup_required,
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(
    build_router(
        settings=settings,
        client=grok_client,
        account_repository=account_repository,
        probe_repository=probe_repository,
        account_service=account_service,
        probe_manager=probe_manager,
        scheduler=scheduler_service,
        runtime_settings_service=runtime_settings_service,
        auth_service=auth_service,
        chat_service=chat_service,
        register_integration=register_integration_service,
    )
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=settings.debug)
