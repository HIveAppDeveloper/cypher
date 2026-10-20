"""
Tool Registry — Central registry for all agent tools.

Manages registration, discovery, and execution of tools available to bots.
Provides OpenAI-compatible tool definitions for LLM function calling.
"""

import logging
from typing import Any, Callable, Optional

from app.services.tools.browser import BrowserTool
from app.services.tools.shell import ShellTool
from app.services.tools.filesystem import FileSystemTool

logger = logging.getLogger(__name__)

# Singleton tool instances
_browser_tool = BrowserTool()
_shell_tool = ShellTool()
_filesystem_tool = FileSystemTool()


class ToolRegistry:
    """Central registry for all tools available to agent bots.

    Tools are registered with OpenAI-compatible function definitions
    and async handler functions. The registry filters available tools
    per-bot based on each bot's tools_enabled configuration.
    """

    def __init__(self):
        self._tools: dict[str, dict] = {}

    def register(
        self,
        name: str,
        description: str,
        parameters: dict,
        handler: Callable,
    ):
        """Register a tool with its definition and handler.

        Args:
            name: Unique tool name (e.g., 'browse_url').
            description: Human-readable description for the LLM.
            parameters: JSON Schema for the tool's parameters.
            handler: Async callable that executes the tool.
        """
        self._tools[name] = {
            "definition": {
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": parameters,
                },
            },
            "handler": handler,
        }
        logger.info(f"Registered tool: {name}")

    async def load_plugins(self, db, bot):
        if "plugins" not in (bot.tools_enabled or []):
            return
        from sqlalchemy import select
        from app.models.plugin import Plugin
        from app.services.plugins import invoke
        for plugin in (await db.execute(select(Plugin).where(Plugin.enabled == True))).scalars():
            for index, tool in enumerate(plugin.tools):
                if not tool.get('enabled',True):continue
                async def handler(arguments, bot_id, pid=plugin.id, tool_name=tool['name']):
                    return await invoke(pid, tool_name, arguments)
                self.register(f"plugin_{plugin.id.replace('-', '')[:12]}_{index}", f"{plugin.name}: {tool['description']}", tool['schema'], handler)

    def register_default_tools(self):
        """Register all built-in tools."""
        for kind in ("image", "video"):
            self.register(
                name=f"generate_{kind}",
                description=f"Generate an actual {kind} from a detailed text prompt. This uses paid model credits. The result is attached to the conversation. Do not call again for the same request unless the first call failed.",
                parameters={"type": "object", "properties": {"prompt": {"type": "string"}, "aspect_ratio": {"type": "string", "enum": ["16:9", "9:16"]}, "duration": {"type": "integer", "enum": [4, 6, 8]}, "image_provider": {"type": "string", "enum": ["openai", "google"], "description": "Choose automatically for the task: OpenAI GPT Image or Google Gemini image generation."}}, "required": ["prompt"]},
                handler=self._handle_generate_image if kind == "image" else self._handle_generate_video,
            )
        # --- Browser Tools ---
        self.register(
            name="browse_url",
            description=(
                "Navigate to a URL in a web browser and return the page title "
                "and status. Use this to visit websites, log into services, or "
                "access web applications."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to navigate to.",
                    },
                },
                "required": ["url"],
            },
            handler=self._handle_browse_url,
        )

        self.register(
            name="browser_click",
            description=(
                "Click an element on the current web page by CSS selector or "
                "visible text content."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector or visible text of the element to click.",
                    },
                },
                "required": ["selector"],
            },
            handler=self._handle_browser_click,
        )

        self.register(
            name="browser_type",
            description="Type text into an input field on the current web page.",
            parameters={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the input field.",
                    },
                    "text": {
                        "type": "string",
                        "description": "The text to type into the field.",
                    },
                },
                "required": ["selector", "text"],
            },
            handler=self._handle_browser_type,
        )

        self.register(
            name="browser_screenshot",
            description=(
                "Take a screenshot of the current web page. Returns a base64-"
                "encoded PNG image along with the page title and URL."
            ),
            parameters={"type": "object", "properties": {}},
            handler=self._handle_browser_screenshot,
        )

        self.register(
            name="browser_extract",
            description=(
                "Extract text content, links, and form fields from the current "
                "web page. Use this to read and understand page content."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "instruction": {
                        "type": "string",
                        "description": "What specific content to extract from the page.",
                    },
                },
                "required": ["instruction"],
            },
            handler=self._handle_browser_extract,
        )

        self.register(
            name="browser_fill_form",
            description=(
                "Fill multiple form fields on the current web page at once. "
                "Provide a mapping of CSS selectors to values."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "fields": {
                        "type": "object",
                        "description": "Object mapping CSS selectors to field values.",
                        "additionalProperties": {"type": "string"},
                    },
                },
                "required": ["fields"],
            },
            handler=self._handle_browser_fill_form,
        )

        # --- Shell Tool ---
        self.register(
            name="shell_exec",
            description=(
                "Execute a shell command inside the bot's sandbox environment. "
                "Returns stdout, stderr, and exit code. Use for running scripts, "
                "installing packages, or any command-line operation."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to execute.",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Maximum execution time in seconds (default: 30).",
                        "default": 30,
                    },
                    "working_dir": {
                        "type": "string",
                        "description": "Working directory for the command (default: /workspace).",
                        "default": "/workspace",
                    },
                },
                "required": ["command"],
            },
            handler=self._handle_shell_exec,
        )

        # --- Filesystem Tools ---
        self.register(
            name="read_file",
            description="Read the contents of a file from the bot's sandbox filesystem.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file to read.",
                    },
                },
                "required": ["path"],
            },
            handler=self._handle_read_file,
        )

        self.register(
            name="write_file",
            description=(
                "Write content to a file in the bot's sandbox filesystem. "
                "Creates parent directories if needed."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path for the file to write.",
                    },
                    "content": {
                        "type": "string",
                        "description": "The content to write to the file.",
                    },
                },
                "required": ["path", "content"],
            },
            handler=self._handle_write_file,
        )

        self.register(
            name="list_directory",
            description="List files and directories at a given path in the sandbox.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path of the directory to list.",
                        "default": "/workspace",
                    },
                },
                "required": ["path"],
            },
            handler=self._handle_list_directory,
        )

        self.register(
            name="search_files",
            description="Search for files matching a pattern in the sandbox filesystem.",
            parameters={
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob or search pattern (e.g., '*.py', 'config').",
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory to search in.",
                        "default": "/workspace",
                    },
                },
                "required": ["pattern"],
            },
            handler=self._handle_search_files,
        )

        logger.info(f"Registered {len(self._tools)} default tools")

    def get_tools_for_bot(self, bot) -> list[dict]:
        """Get OpenAI-format tool definitions available to a bot.

        Filters tools based on the bot's tools_enabled list. If
        tools_enabled is None or empty, returns all tools.

        Args:
            bot: Bot model instance (or None for all tools).

        Returns:
            List of tool definitions in OpenAI function-calling format.
        """
        if bot is None or not getattr(bot, "tools_enabled", None):
            return [t["definition"] for t in self._tools.values()]

        # Map tool category names to tool prefixes
        category_map = {
            "plugins": "plugin_",
            "media": ["generate_image", "generate_video"],
            "browser": ["browse_url", "browser_click", "browser_type", "browser_screenshot", "browser_extract", "browser_fill_form"],
            "shell": "shell",
            "filesystem": ["read_file", "write_file", "list_directory", "search_files"],
        }

        enabled_tool_names = {"consult_specialist", "set_goal", "complete_goal", "remember_context", "search_chat_history"} if getattr(bot, "llm_provider", "") == "openai" and getattr(bot, "llm_model", "") in {"gpt-6.1-sol", "gpt-6-luna"} else set()
        for category in bot.tools_enabled:
            category_lower = category.lower()
            if category_lower in category_map:
                mapping = category_map[category_lower]
                if isinstance(mapping, list):
                    enabled_tool_names.update(mapping)
                else:
                    for tool_name in self._tools:
                        if tool_name.startswith(mapping):
                            enabled_tool_names.add(tool_name)
            else:
                # Direct tool name
                enabled_tool_names.add(category_lower)

        return [
            t["definition"]
            for name, t in self._tools.items()
            if name in enabled_tool_names
        ]

    async def execute_tool(
        self, name: str, arguments: dict, bot_id: str
    ) -> dict:
        """Execute a registered tool by name.

        Args:
            name: The tool name to execute.
            arguments: Dict of arguments to pass to the handler.
            bot_id: ID of the bot executing the tool (for sandbox routing).

        Returns:
            Dict with the tool's execution result.
        """
        if name not in self._tools:
            logger.warning(f"Tool not found: {name}")
            return {"error": f"Unknown tool: {name}"}

        handler = self._tools[name]["handler"]
        try:
            result = await handler(arguments, bot_id)
            return result
        except Exception as e:
            logger.exception(f"Tool execution failed: {name}")
            return {"error": str(e), "tool": name}

    # --- Handler implementations ---

    async def _handle_browse_url(self, args: dict, bot_id: str) -> dict:
        return await _browser_tool.navigate_to(args["url"], session_id=bot_id)

    async def _handle_browser_click(self, args: dict, bot_id: str) -> dict:
        return await _browser_tool.click(args["selector"], session_id=bot_id)

    async def _handle_browser_type(self, args: dict, bot_id: str) -> dict:
        return await _browser_tool.type_text(
            args["selector"], args["text"], session_id=bot_id
        )

    async def _handle_browser_screenshot(self, args: dict, bot_id: str) -> dict:
        return await _browser_tool.screenshot(session_id=bot_id)

    async def _handle_browser_extract(self, args: dict, bot_id: str) -> dict:
        return await _browser_tool.extract_content(
            args.get("instruction", ""), session_id=bot_id
        )

    async def _handle_browser_fill_form(self, args: dict, bot_id: str) -> dict:
        return await _browser_tool.fill_form(args.get("fields", {}), session_id=bot_id)

    async def _handle_shell_exec(self, args: dict, bot_id: str) -> dict:
        return await _shell_tool.execute(
            bot_id=bot_id,
            command=args["command"],
            timeout=args.get("timeout", 30),
            working_dir=args.get("working_dir", "/workspace"),
        )

    async def _handle_read_file(self, args: dict, bot_id: str) -> dict:
        return await _filesystem_tool.read_file(bot_id=bot_id, path=args["path"])

    async def _handle_write_file(self, args: dict, bot_id: str) -> dict:
        return await _filesystem_tool.write_file(
            bot_id=bot_id, path=args["path"], content=args["content"]
        )

    async def _handle_list_directory(self, args: dict, bot_id: str) -> dict:
        return await _filesystem_tool.list_directory(
            bot_id=bot_id, path=args.get("path", "/workspace")
        )

    async def _handle_search_files(self, args: dict, bot_id: str) -> dict:
        return await _filesystem_tool.search_files(
            bot_id=bot_id,
            pattern=args["pattern"],
            path=args.get("path", "/workspace"),
        )

    async def _handle_generate_image(self, args: dict, bot_id: str) -> dict:
        from app.services.media import generate_media
        files = await generate_media("image", args["prompt"], args.get("aspect_ratio", "16:9"), image_provider=args.get("image_provider"))
        return {"success": True, "message": "Generated image attached to this conversation.", "_attachments": files}

    async def _handle_generate_video(self, args: dict, bot_id: str) -> dict:
        from app.services.media import generate_media
        files = await generate_media("video", args["prompt"], args.get("aspect_ratio", "16:9"), args.get("duration", 4))
        return {"success": True, "message": "Generated video attached to this conversation.", "_attachments": files}
