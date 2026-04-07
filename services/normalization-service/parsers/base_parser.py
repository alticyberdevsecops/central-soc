import abc

class BaseParser(abc.ABC):
    """
    Base class for all vendor-specific normalized parsers.
    Parsers are responsible for translating the RawIncident payload into a standardized dictionary
    that perfectly matches the 'incidents' PostgreSQL schema.
    """
    VENDOR = "generic"

    @abc.abstractmethod
    def parse(self, raw_incident: dict) -> dict:
        """
        Parse the raw_incident payload into a normalized incident dictionary.
        """
        ...

    def _normalize_severity(self, vendor_severity: str) -> str:
        """Map vendor-specific severity strings to our normalized enum."""
        mapping = {
            "critical": "critical", "crit": "critical",
            "high": "high", "h": "high",
            "medium": "medium", "med": "medium", "moderate": "medium",
            "low": "low", "l": "low",
            "info": "informational", "informational": "informational",
            1: "informational", 2: "low", 3: "medium", 4: "high", 5: "critical",
            "e_notice": "informational", "e_low": "low",
            "e_medium": "medium", "e_high": "high", "e_critical": "critical",
        }
        return mapping.get(str(vendor_severity).lower(), "medium")

    def _normalize_status(self, vendor_status: str) -> str:
        """Map vendor-specific status strings to our normalized enum."""
        mapping = {
            "new": "new", "open": "new", "active": "new",
            "pending": "triaging", "investigating": "triaging", "under_investigation": "triaging",
            "in_progress": "in_progress", "inprogress": "in_progress", "processing": "in_progress",
            "resolved": "resolved", "closed": "resolved", "done": "resolved",
            "false_positive": "false_positive", "fp": "false_positive",
            "escalated": "escalated",
        }
        return mapping.get(str(vendor_status).lower(), "new")
