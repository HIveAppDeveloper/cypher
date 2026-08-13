import docker
import logging
from app.config import settings

logger = logging.getLogger(__name__)

class SandboxManager:
    _client = None

    @classmethod
    def get_client(cls):
        if not cls._client:
            cls._client = docker.from_env()
        return cls._client

    @classmethod
    def create_sandbox(cls, bot_id: str):
        client = cls.get_client()
        container_name = f"grokbot_sandbox_{bot_id}"
        try:
            # Check if exists
            try:
                existing = client.containers.get(container_name)
                existing.start()
                return existing.id
            except docker.errors.NotFound:
                pass

            container = client.containers.run(
                settings.SANDBOX_IMAGE,
                name=container_name,
                detach=True,
                tty=True,
                command="tail -f /dev/null",
                network_mode="bridge"
            )
            return container.id
        except Exception as e:
            logger.error(f"Failed to create sandbox: {e}")
            return None

    @classmethod
    def stop_sandbox(cls, bot_id: str):
        client = cls.get_client()
        container_name = f"grokbot_sandbox_{bot_id}"
        try:
            container = client.containers.get(container_name)
            container.stop()
            container.remove()
        except docker.errors.NotFound:
            pass
        except Exception as e:
            logger.error(f"Failed to stop sandbox: {e}")

    @classmethod
    def exec_in_sandbox(cls, bot_id: str, command: str):
        client = cls.get_client()
        container_name = f"grokbot_sandbox_{bot_id}"
        try:
            container = client.containers.get(container_name)
            exit_code, output = container.exec_run(command)
            return {"exit_code": exit_code, "output": output.decode('utf-8')}
        except Exception as e:
            logger.error(f"Exec failed: {e}")
            return {"exit_code": -1, "output": str(e)}

    @classmethod
    def get_sandbox_status(cls, bot_id: str):
        client = cls.get_client()
        container_name = f"grokbot_sandbox_{bot_id}"
        try:
            container = client.containers.get(container_name)
            return container.status
        except docker.errors.NotFound:
            return "not_found"

    @classmethod
    def cleanup_stale_sandboxes(cls):
        pass
