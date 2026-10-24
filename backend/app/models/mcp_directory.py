from sqlalchemy import Column, DateTime, Integer, JSON, String, Text

from app.db.session import Base


class McpDirectoryEntry(Base):
    """Public MCP Registry snapshot shared by all workspace tenants."""

    __tablename__ = 'mcp_directory_entries'

    id = Column(String(64), primary_key=True)
    registry_name = Column(String(400), nullable=False, index=True)
    title = Column(String(200), nullable=False, index=True)
    version = Column(String(100), nullable=False)
    description = Column(Text, nullable=False, default='')
    url = Column(Text, nullable=False, default='')
    source = Column(Text, nullable=False, default='')
    icon = Column(Text, nullable=True)
    domains = Column(JSON, nullable=False, default=list)
    category = Column(String(48), nullable=False, default='Other', index=True)
    transport = Column(String(32), nullable=False, default='unknown', index=True)
    setup_note = Column(Text, nullable=False, default='')
    test_status = Column(String(32), nullable=False, default='not_tested', index=True)
    test_message = Column(Text, nullable=False, default='')
    tool_count = Column(Integer, nullable=True)
    registry_updated_at = Column(DateTime, nullable=True)
    tested_at = Column(DateTime, nullable=True)
    snapshot_at = Column(DateTime, nullable=False, index=True)
