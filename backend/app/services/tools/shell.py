"""
Shell Tool — Execute commands inside bot sandbox containers.

Runs shell commands via Docker exec in the bot's isolated sandbox,
capturing stdout, stderr, and exit codes with timeout protection.
"""

import logging
from typing import Optional

from app.services.sandbox import SandboxManager

logger = logging.getLogger(__name__)


class ShellTool:
    """Execute shell commands inside a bot's Docker sandbox."""

    async def execute(
        self,
        bot_id: str,
        command: str,
        timeout: int = 30,
        working_dir: str = "/workspace",
    ) -> dict:
        """Execute a shell command in the bot's sandbox container.

        Args:
            bot_id: The bot's ID (maps to a sandbox container).
            command: Shell command to execute.
            timeout: Maximum execution time in seconds.
            working_dir: Working directory inside the container.

        Returns:
            Dict with stdout, stderr, exit_code, and execution info.
        """
        logger.info(f"Shell exec for bot {bot_id}: {command}")

        # Wrap command with timeout and working directory
        wrapped_command = (
            f"timeout {timeout} bash -c 'cd {working_dir} && {command}'"
        )

        try:
            result = SandboxManager.exec_in_sandbox(bot_id, wrapped_command)

            # Parse output — Docker exec returns combined output
            output = result.get("output", "")
            exit_code = result.get("exit_code", -1)

            # Truncate very long output to avoid context bloat
            max_output_len = 10000
            truncated = False
            if len(output) > max_output_len:
                output = output[:max_output_len]
                truncated = True

            return {
                "success": exit_code == 0,
                "exit_code": exit_code,
                "stdout": output,
                "stderr": "",  # Docker exec combines streams
                "command": command,
                "working_dir": working_dir,
                "truncated": truncated,
            }
        except Exception as e:
            logger.error(f"Shell execution failed: {e}")
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": str(e),
                "command": command,
                "error": str(e),
            }
