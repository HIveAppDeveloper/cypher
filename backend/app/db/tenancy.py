"""Tenant isolation for authenticated workspaces."""

from contextvars import ContextVar

from sqlalchemy import Column, String, event
from sqlalchemy.orm import Session, with_loader_criteria

current_tenant_id: ContextVar[str | None] = ContextVar("current_tenant_id", default=None)


class TenantScoped:
    tenant_id = Column(String(255), nullable=False, index=True)


def install_tenant_events():
    @event.listens_for(Session, "do_orm_execute")
    def add_tenant_filter(execute_state):
        tenant_id = current_tenant_id.get()
        if tenant_id is None or execute_state.execution_options.get("skip_tenant_filter"):
            return
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                TenantScoped,
                lambda row: row.tenant_id == tenant_id,
                include_aliases=True,
                track_closure_variables=False,
            )
        )

    @event.listens_for(Session, "before_flush")
    def assign_tenant(session, _flush_context, _instances):
        tenant_id = current_tenant_id.get() or "legacy-owner"
        for row in session.new:
            if isinstance(row, TenantScoped):
                if row.tenant_id and row.tenant_id != tenant_id:
                    raise ValueError("Cannot create a record for another workspace.")
                row.tenant_id = tenant_id
