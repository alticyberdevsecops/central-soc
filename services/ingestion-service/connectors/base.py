"""
Connector Base — Abstract interface every vendor connector must implement.
All connectors return a list of UnifiedIncident dicts.
"""
import abc
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


logger = logging.getLogger("ingestion.connectors")


@dataclass
class ConnectorCredentials:
    """Credential bag — filled from DB connector_configs.credentials JSONB."""
    raw: dict = field(default_factory=dict)

    def get(self, key: str, default: Any = None) -> Any:
        return self.raw.get(key, default)


@dataclass
class RawIncident:
    """Raw payload fetched directly from the vendor, ready to be grouped and queued."""
    tenant_id: str
    source_vendor: str
    vendor_incident_id: str
    raw_payload: dict = field(default_factory=dict)
    source_created_at: Optional[str] = None  # ISO 8601


@dataclass
class NormalizedIncident:
    """Intermediate object passed to the queue — then normalization service writes to DB."""
    tenant_id: str
    source_vendor: str
    vendor_incident_id: str
    title: str
    severity: str          # critical / high / medium / low / informational
    status: str            # new / triaging / in_progress / resolved / false_positive
    description: str = ""
    affected_hosts: list = field(default_factory=list)
    affected_users: list = field(default_factory=list)
    iocs: list = field(default_factory=list)
    mitre_tactics: list = field(default_factory=list)
    mitre_techniques: list = field(default_factory=list)
    tags: list = field(default_factory=list)
    vendor_url: Optional[str] = None
    raw_payload: dict = field(default_factory=dict)
    source_created_at: Optional[str] = None  # ISO 8601


class ConnectorBase(abc.ABC):
    """
    Every vendor connector must inherit from this class and implement fetch_incidents().

    The scheduler calls fetch_incidents() on a per-tenant, per-connector schedule.
    The connector returns a list of RawIncident objects which are
    then enqueued to Redis for the normalization-service to persist.
    """

    VENDOR: str = "generic"

    def __init__(self, tenant_id: str, credentials: ConnectorCredentials, config: dict = None):
        self.tenant_id = tenant_id
        self.credentials = credentials
        self.config = config or {}
        self.logger = logging.getLogger(f"connector.{self.VENDOR}.{tenant_id[:8]}")

    @abc.abstractmethod
    async def fetch_incidents(self, since: Optional[datetime] = None) -> list[RawIncident]:
        """
        Fetch new/updated incidents from vendor API.
        :param since: Only fetch incidents created/modified after this timestamp.
        :return: List of RawIncident objects.
        """
        ...

        ...
