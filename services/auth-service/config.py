from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"
    redis_url: str = "redis://:redis_secret_2024@redis:6379/0"
    jwt_secret: str = "change_me_super_secret_jwt_key_2024"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7

    class Config:
        env_file = ".env"


settings = Settings()
