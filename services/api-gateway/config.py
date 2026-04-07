from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    auth_service_url: str = "http://auth-service:8000"
    incident_service_url: str = "http://incident-service:8000"
    tenant_service_url: str = "http://tenant-service:8000"
    ingestion_service_url: str = "http://ingestion-service:8000"
    automation_service_url: str = "http://automation-service:8000"
    jwt_secret: str = "change_me_super_secret_jwt_key_2024"
    jwt_algorithm: str = "HS256"
    class Config:
        env_file = ".env"

settings = Settings()
