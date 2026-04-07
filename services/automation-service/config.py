from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"
    redis_url: str = "redis://:redis_secret_2024@redis:6379/0"
    jwt_secret: str = "change_me_super_secret_jwt_key_2024"
    jwt_algorithm: str = "HS256"
    incident_service_url: str = "http://incident-service:8000"
    tenant_service_url: str = "http://tenant-service:8000"

    class Config:
        env_file = ".env"


settings = Settings()
