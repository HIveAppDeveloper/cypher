"""Idempotent upgrades for databases created before workspace isolation."""

from sqlalchemy import inspect

from app.db.session import Base
from app.db.tenancy import TenantScoped


def ensure_tenant_schema(connection):
    inspector = inspect(connection)
    schema = Base.metadata.schema
    existing = set(inspector.get_table_names(schema=schema))
    preparer = connection.dialect.identifier_preparer
    quote = preparer.quote
    scoped = {mapper.local_table.name: mapper.local_table for mapper in Base.registry.mappers if isinstance(mapper.class_, type) and issubclass(mapper.class_, TenantScoped)}
    for name, table in scoped.items():
        if name not in existing:
            continue
        formatted = preparer.format_table(table, use_schema=bool(schema))
        columns = {column["name"] for column in inspect(connection).get_columns(name, schema=schema)}
        if "tenant_id" not in columns:
            connection.exec_driver_sql(f"ALTER TABLE {formatted} ADD COLUMN {quote('tenant_id')} VARCHAR(255) NOT NULL DEFAULT 'legacy-owner'")
        if connection.dialect.name == "postgresql":
            connection.exec_driver_sql(f"CREATE INDEX IF NOT EXISTS {quote('ix_' + name + '_tenant_id')} ON {formatted} ({quote('tenant_id')})")
    if "bots" in existing and connection.dialect.name == "postgresql":
        table = Base.metadata.tables.get(f"{schema}.bots")
        if table is None:
            table = Base.metadata.tables.get("bots")
        if table is None:
            return
        formatted = preparer.format_table(table, use_schema=bool(schema))
        for constraint in inspector.get_unique_constraints("bots", schema=schema):
            if constraint.get("column_names") == ["name"] and constraint.get("name"):
                connection.exec_driver_sql(f"ALTER TABLE {formatted} DROP CONSTRAINT {preparer.quote(constraint['name'])}")
        connection.exec_driver_sql(f"CREATE UNIQUE INDEX IF NOT EXISTS {quote('uq_bot_tenant_name_idx')} ON {formatted} ({quote('tenant_id')}, {quote('name')})")
