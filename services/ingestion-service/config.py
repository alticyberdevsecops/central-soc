from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url_sync: str = "postgresql+psycopg2://soc_admin:soc_secret_2024@postgres:5432/central_soc"
    redis_url: str = "redis://:redis_secret_2024@redis:6379/0"
    poll_interval_default: int = 300

    class Config:
        env_file = ".env"


settings = Settings()
