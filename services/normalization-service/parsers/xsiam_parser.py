from datetime import datetime
from parsers.base_parser import BaseParser

class XSIAMParser(BaseParser):
    VENDOR = "xsiam"

    def parse(self, raw_incident: dict) -> dict:
        """Map XSIAM raw data to enriched incident dictionary."""
        tenant_id = raw_incident.get("tenant_id")
        incident_id = str(raw_incident.get("vendor_incident_id", ""))
        payload = raw_incident.get("raw_payload", {})
        
        inc = payload.get("incident", {})
        extra_data = payload.get("extra_data", {})

        title = inc.get("incident_name") or inc.get("description") or "XSIAM Incident"
        source_ts = raw_incident.get("source_created_at")
        
        mod_ts_ms = inc.get("modification_time")
        last_updated_iso = None
        if mod_ts_ms:
            import pytz
            from datetime import datetime
            try:
                utc_dt = datetime.fromtimestamp(mod_ts_ms / 1000, tz=pytz.UTC)
                ist_tz = pytz.timezone('Asia/Kolkata')
                ist_dt = utc_dt.astimezone(ist_tz)
                last_updated_iso = ist_dt.isoformat()
            except Exception:
                pass
        
        # Calculate Ticket ID using tenant info passed from worker
        tenant_name = raw_incident.get("tenant_name", "SOC")
        prefix = tenant_name[:4].upper()
        ticket_id = f"{prefix}-{incident_id}"

        # Build enriched payload as requested by user
        enriched_payload = {
            "incident": {
                "ticket_id": ticket_id,
                "incident_id": incident_id,
                "is_blocked": inc.get("is_blocked", False),
                "incident_name": title,
                "creation_time": source_ts,
                "modification_time": inc.get("modification_time"),
                "detection_time": inc.get("detection_time"),
                "status": inc.get("status"),
                "severity": inc.get("severity"),
                "description": inc.get("description", ""),
                "assigned_user_mail": inc.get("assigned_user_mail"),
                "assigned_user_pretty_name": inc.get("assigned_user_pretty_name"),
                "alert_count": inc.get("alert_count", 0),
                "low_severity_alert_count": inc.get("low_severity_alert_count", 0),
                "med_severity_alert_count": inc.get("med_severity_alert_count", 0),
                "high_severity_alert_count": inc.get("high_severity_alert_count", 0),
                "critical_severity_alert_count": inc.get("critical_severity_alert_count", 0),
                "user_count": inc.get("user_count", 0),
                "host_count": inc.get("host_count", 0),
                "notes": inc.get("notes", ""),
                "resolve_comment": inc.get("resolve_comment", ""),
                "resolved_timestamp": inc.get("resolved_timestamp"),
                "manual_severity": inc.get("manual_severity"),
                "manual_description": inc.get("manual_description"),
                "xdr_url": inc.get("xdr_url"),
                "starred": inc.get("starred", False),
                "starred_manually": inc.get("starred_manually", False),
                "hosts": inc.get("hosts", []),
                "users": inc.get("users", []),
                "incident_sources": inc.get("incident_sources", []),
                "rule_based_score": inc.get("rule_based_score", 0),
                "predicted_score": inc.get("predicted_score", 0),
                "manual_score": inc.get("manual_score", 0),
                "aggregated_score": inc.get("aggregated_score", 0),
                "wildfire_hits": inc.get("wildfire_hits", 0),
                "alerts_grouping_status": inc.get("alerts_grouping_status"),
                "mitre_tactics_ids_and_names": inc.get("mitre_tactics_ids_and_names", []),
                "mitre_techniques_ids_and_names": inc.get("mitre_techniques_ids_and_names", []),
                "alert_categories": inc.get("alert_categories", []),
                "original_tags": inc.get("original_tags", []),
                "tags": inc.get("tags", []),
                "incident_domain": inc.get("incident_domain"),
                "custom_fields": inc.get("custom_fields", {})
            },
            "alerts": [],
            "network_artifacts": extra_data.get("network_artifacts", {}).get("data", []) if extra_data else [],
            "file_artifacts": extra_data.get("file_artifacts", {}).get("data", []) if extra_data else []
        }

        alerts_list = extra_data.get("alerts", {}).get("data", []) if extra_data else []
        if not alerts_list:
             alerts_list = []
             
        for a in alerts_list:
            if not isinstance(a, dict):
                continue
                
            detection_ts = a.get("detection_time")
            detection_iso = None
            if detection_ts:
                try:
                    import pytz
                    from datetime import datetime
                    utc_dt = datetime.fromtimestamp(detection_ts / 1000, tz=pytz.UTC)
                    ist_tz = pytz.timezone('Asia/Kolkata')
                    ist_dt = utc_dt.astimezone(ist_tz)
                    detection_iso = ist_dt.isoformat()
                except Exception:
                    detection_iso = str(detection_ts)

            enriched_payload["alerts"].append({
                "Time": detection_iso,
                "alert_id": a.get("alert_id"),
                "severity": a.get("severity"),
                "description": a.get("description"),
                "category": a.get("category"),
                "action": a.get("action"),
                "name": a.get("name"),
                "endpoint_id": a.get("endpoint_id"),
                "host_ip": a.get("host_ip"),
                "host_name": a.get("host_name"),
                "source": a.get("source"),
                "mitre_technique_id_and_name": a.get("mitre_technique_id_and_name"),
                "mitre_tactic_id_and_name": a.get("mitre_tactic_id_and_name"),
                "actor_process_instance_id": a.get("actor_process_instance_id"),
                "actor_process_image_name": a.get("actor_process_image_name"),
                "actor_process_image_path": a.get("actor_process_image_path"),
                "actor_process_image_sha256": a.get("actor_process_image_sha256"),
                "actor_process_image_sha256_verdict": a.get("actor_process_image_sha256_verdict"),
                "causality_actor_process_image_name": a.get("causality_actor_process_image_name"),
                "causality_actor_process_image_path": a.get("causality_actor_process_image_path"),
                "causality_actor_process_image_sha256": a.get("causality_actor_process_image_sha256"),
                "causality_actor_process_image_sha256_verdict": a.get("causality_actor_process_image_sha256_verdict"),
                "action_file_name": a.get("action_file_name"),
                "action_file_path": a.get("action_file_path"),
                "action_file_sha256": a.get("action_file_sha256"),
                "action_file_sha256_verdict": a.get("action_file_sha256_verdict"),
                "action_local_ip": a.get("action_local_ip"),
                "action_local_ip_v6": a.get("action_local_ip_v6"),
                "action_local_port": a.get("action_local_port"),
                "action_local_ip_verdict": a.get("action_local_ip_verdict"),
                "action_remote_ip": a.get("action_remote_ip"),
                "action_remote_ip_v6": a.get("action_remote_ip_v6"),
                "action_remote_port": a.get("action_remote_port"),
                "action_remote_ip_verdict": a.get("action_remote_ip_verdict"),
                "action_country": a.get("action_country"),
                "action_process_image_name": a.get("action_process_image_name"),
                "action_process_image_sha256": a.get("action_process_image_sha256"),
                "action_process_image_sha256_verdict": a.get("action_process_image_sha256_verdict"),
                "os_actor_process_image_name": a.get("os_actor_process_image_name"),
                "os_actor_process_image_path": a.get("os_actor_process_image_path"),
                "os_actor_process_image_sha256": a.get("os_actor_process_image_sha256"),
                "os_actor_process_image_sha256_verdict": a.get("os_actor_process_image_sha256_verdict"),
                "action_external_hostname": a.get("action_external_hostname"),
                "action_external_hostname_verdict": a.get("action_external_hostname_verdict"),
                "dst_action_external_hostname": a.get("dst_action_external_hostname"),
                "dst_action_external_hostname_verdict": a.get("dst_action_external_hostname_verdict"),
                "dst_action_country": a.get("dst_action_country"),
                "actor_process_image_cmd": a.get("actor_process_image_cmd"),
                "causality_actor_process_image_cmd": a.get("causality_actor_process_image_cmd"),
                "actor_process_image_signature": a.get("actor_process_image_signature"),
                "actor_process_image_signature_vendor": a.get("actor_process_image_signature_vendor"),
                "causality_actor_process_image_signature": a.get("causality_actor_process_image_signature"),
                "causality_actor_process_image_signature_vendor": a.get("causality_actor_process_image_signature_vendor")
            })

        # Extract IOCs from network/file artifacts in extra_data
        iocs = []
        for na in (extra_data.get("network_artifacts", {}).get("data", []) if extra_data else []):
            if not isinstance(na, dict):
                continue
            for field in ("network_remote_ip", "network_remote_domain", "network_remote_hostname"):
                val = na.get(field)
                if val:
                    iocs.append({"type": field.replace("network_remote_", ""), "value": val})
        for fa in (extra_data.get("file_artifacts", {}).get("data", []) if extra_data else []):
            if not isinstance(fa, dict):
                continue
            sha = fa.get("file_sha256")
            name = fa.get("file_name")
            if sha:
                iocs.append({"type": "sha256", "value": sha, "name": name or ""})

        # Prefer manual_severity if analyst set it in XSIAM, else use computed severity
        effective_severity = inc.get("manual_severity") or inc.get("severity")

        # Enrich description with stitched alert count so it reflects the current state
        alert_count = inc.get("alert_count", 0)
        base_description = inc.get("manual_description") or inc.get("description") or title
        if alert_count and alert_count > 1:
            description = f"{base_description} [{alert_count} alerts stitched]"
        else:
            description = base_description

        return {
            "tenant_id": tenant_id,
            "source_vendor": self.VENDOR,
            "vendor_incident_id": incident_id,
            "ticket_id": ticket_id,
            "title": title[:500],
            "description": description,
            "severity": self._normalize_severity(effective_severity),
            "status": self._normalize_status(inc.get("status", "new")),
            "affected_hosts": [{"hostname": h} for h in (inc.get("hosts") or [])],
            "affected_users": [{"username": u} for u in (inc.get("users") or [])],
            "iocs": iocs,
            "mitre_tactics": inc.get("mitre_tactics_ids_and_names") or [],
            "mitre_techniques": inc.get("mitre_techniques_ids_and_names") or [],
            "raw_payload": enriched_payload,
            "source_created_at": source_ts,
            "last_updated_at": last_updated_iso,
        }
