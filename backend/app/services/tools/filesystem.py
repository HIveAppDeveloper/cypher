"""
Filesystem Tool — File operations inside bot sandbox containers.

Read, write, list, and search files within the bot's isolated Docker
sandbox, enabling persistent file management across sessions.
"""

import logging
import asyncio
import shlex
import base64
import posixpath

from app.services.sandbox import SandboxManager

logger = logging.getLogger(__name__)


class FileSystemTool:
    """File operations inside a bot's Docker sandbox container."""

    async def read_file(self, bot_id: str, path: str) -> dict:
        """Read the contents of a file from the sandbox.

        Args:
            bot_id: The bot's ID (maps to a sandbox container).
            path: Absolute path to the file inside the container.

        Returns:
            Dict with file content or error.
        """
        logger.info(f"Reading file for bot {bot_id}: {path}")
        try:
            result = await asyncio.to_thread(SandboxManager.exec_in_sandbox, bot_id, ["cat", "--", path])
            if result["exit_code"] == 0:
                content = result["output"]
                # Truncate very large files
                max_size = 50000
                truncated = len(content) > max_size
                return {
                    "success": True,
                    "path": path,
                    "content": content[:max_size],
                    "size_bytes": len(content),
                    "truncated": truncated,
                }
            else:
                return {
                    "success": False,
                    "path": path,
                    "error": result["output"],
                }
        except Exception as e:
            logger.error(f"Read file failed: {e}")
            return {"success": False, "path": path, "error": str(e)}

    async def write_file(self, bot_id: str, path: str, content: str) -> dict:
        """Write content to a file in the sandbox.

        Creates parent directories automatically if they don't exist.

        Args:
            bot_id: The bot's ID.
            path: Absolute path for the file.
            content: Content to write.

        Returns:
            Dict indicating success or failure.
        """
        logger.info(f"Writing file for bot {bot_id}: {path}")
        try:
            encoded = base64.b64encode(content.encode()).decode()
            parent_dir = posixpath.dirname(path) or "."
            command = f"mkdir -p -- {shlex.quote(parent_dir)} && printf %s {shlex.quote(encoded)} | base64 -d > {shlex.quote(path)}"
            result = await asyncio.to_thread(SandboxManager.exec_in_sandbox, bot_id, ["bash", "-lc", command])

            if result["exit_code"] == 0:
                return {
                    "success": True,
                    "path": path,
                    "bytes_written": len(content),
                }
            else:
                return {
                    "success": False,
                    "path": path,
                    "error": result["output"],
                }
        except Exception as e:
            logger.error(f"Write file failed: {e}")
            return {"success": False, "path": path, "error": str(e)}

    async def list_directory(
        self, bot_id: str, path: str = "/workspace"
    ) -> dict:
        """List files and directories at a given path.

        Args:
            bot_id: The bot's ID.
            path: Directory path to list.

        Returns:
            Dict with list of entries (name, type, size).
        """
        logger.info(f"Listing directory for bot {bot_id}: {path}")
        try:
            # Use ls with detailed output
            result = await asyncio.to_thread(SandboxManager.exec_in_sandbox, bot_id, ["ls", "-la", "--time-style=long-iso", "--", path])

            if result["exit_code"] == 0:
                lines = result["output"].strip().split("\n")
                entries = []
                for line in lines[1:]:  # Skip "total" line
                    parts = line.split(None, 7)
                    if len(parts) >= 8:
                        is_dir = parts[0].startswith("d")
                        entries.append({
                            "name": parts[7],
                            "type": "directory" if is_dir else "file",
                            "permissions": parts[0],
                            "size": int(parts[4]) if not is_dir else None,
                            "modified": f"{parts[5]} {parts[6]}",
                        })

                return {
                    "success": True,
                    "path": path,
                    "entries": entries,
                    "count": len(entries),
                }
            else:
                return {
                    "success": False,
                    "path": path,
                    "error": result["output"],
                }
        except Exception as e:
            logger.error(f"List directory failed: {e}")
            return {"success": False, "path": path, "error": str(e)}

    async def search_files(
        self, bot_id: str, pattern: str, path: str = "/workspace"
    ) -> dict:
        """Search for files matching a pattern.

        Args:
            bot_id: The bot's ID.
            pattern: Search pattern (glob or filename).
            path: Directory to search in.

        Returns:
            Dict with list of matching file paths.
        """
        logger.info(f"Searching files for bot {bot_id}: {pattern} in {path}")
        try:
            command = f"find {shlex.quote(path)} -name {shlex.quote(pattern)} -type f 2>/dev/null | head -100"
            result = await asyncio.to_thread(SandboxManager.exec_in_sandbox, bot_id, ["bash", "-lc", command])

            if result["exit_code"] == 0:
                matches = [
                    m.strip()
                    for m in result["output"].strip().split("\n")
                    if m.strip()
                ]
                return {
                    "success": True,
                    "pattern": pattern,
                    "path": path,
                    "matches": matches,
                    "count": len(matches),
                }
            else:
                return {
                    "success": False,
                    "pattern": pattern,
                    "error": result["output"],
                }
        except Exception as e:
            logger.error(f"Search files failed: {e}")
            return {"success": False, "pattern": pattern, "error": str(e)}
