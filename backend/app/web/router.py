from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.config import Settings
from app.integrations.grok2api.client import Grok2APIClient
from app.persistence.account_repository import AccountRepository
from app.persistence.probe_repository import ProbeRepository
from app.services.account_service import AccountService
from app.services.auth_service import AuthService
from app.services.chat_service import ChatService
from app.services.egress_service import EgressService
from app.services.probe_manager import ProbeManager
from app.services.register_integration import RegisterIntegrationService
from app.services.scheduler import SchedulerService
from app.services.settings_service import RuntimeSettingsService
from app.services.wechat_notification import WeChatAccountNotificationService

from .auth import build_admin_auth_dependency
from .routes.accounts import build_accounts_router
from .routes.auth import build_auth_router
from .routes.chat import build_chat_router
from .routes.egress import build_egress_router
from .routes.health import build_health_router
from .routes.integrations import build_integrations_router
from .routes.probes import build_probes_router
from .routes.settings import build_settings_router


def build_router(
    *,
    settings: Settings,
    client: Grok2APIClient,
    account_repository: AccountRepository,
    probe_repository: ProbeRepository,
    account_service: AccountService,
    egress_service: EgressService,
    probe_manager: ProbeManager,
    scheduler: SchedulerService,
    runtime_settings_service: RuntimeSettingsService,
    auth_service: AuthService,
    chat_service: ChatService,
    register_integration: RegisterIntegrationService,
    wechat_notifications: WeChatAccountNotificationService,
) -> APIRouter:
    router = APIRouter(prefix="/api")
    require_admin = build_admin_auth_dependency(auth_service)
    protected = APIRouter(dependencies=[Depends(require_admin)])

    router.include_router(build_auth_router(auth_service, require_admin))
    router.include_router(
        build_health_router(
            settings=settings,
            client=client,
            probes=probe_repository,
            scheduler=scheduler,
            auth=auth_service,
        )
    )
    router.include_router(
        build_integrations_router(settings, register_integration)
    )

    protected.include_router(build_accounts_router(account_service))
    protected.include_router(build_egress_router(client, egress_service))
    protected.include_router(
        build_probes_router(
            settings=settings,
            accounts=account_repository,
            repository=probe_repository,
            manager=probe_manager,
            scheduler=scheduler,
        )
    )
    protected.include_router(
        build_settings_router(
            settings=settings,
            client=client,
            accounts=account_repository,
            runtime_settings=runtime_settings_service,
            probes=probe_manager,
            scheduler=scheduler,
            wechat=wechat_notifications,
        )
    )
    protected.include_router(build_chat_router(chat_service))

    router.include_router(protected)
    return router
