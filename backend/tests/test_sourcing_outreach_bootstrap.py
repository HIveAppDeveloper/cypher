from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


async def skip_directory_seed(_connection):
    return 0


@pytest.mark.asyncio
async def test_fresh_bootstrap_is_idempotent_and_preserves_outreach_rows(tmp_path, monkeypatch):
    from app.db import bootstrap
    from app.db.tenancy import current_tenant_id
    from app.models.sourcing_outreach import SourcingOutreach, SourcingMailPolicy
    from app.services import mcp_directory

    monkeypatch.setattr(mcp_directory, 'seed_directory_rows', skip_directory_seed)
    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'fresh-bootstrap.db'))
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        await bootstrap.initialize_database(engine)
        async with engine.connect() as connection:
            tables = await connection.run_sync(lambda sync: set(inspect(sync).get_table_names()))
            outreach_columns = await connection.run_sync(lambda sync: {column['name'] for column in inspect(sync).get_columns('sourcing_outreach')})
        assert {'sourcing_outreach', 'sourcing_mail_policy'} <= tables
        assert 'gmail_draft_id' in outreach_columns

        tenant = current_tenant_id.set('bootstrap-fixture-owner')
        outreach_id = str(uuid4())
        policy_id = 'fixture-recipient-policy'
        try:
            async with sessions() as db:
                db.add(SourcingOutreach(
                    id=outreach_id, tenant_id='bootstrap-fixture-owner', request_id=str(uuid4()), digest='a'*64,
                    provider='gmail', account_id='fixture-grant', account_binding='b'*64,
                    sender='investor@example.test', recipient='founder@example.test',
                    subject='Preserved draft proposal', body='Synthetic body to preserve.',
                    status='awaiting_approval', review_token='fixture-review-token',
                    review_expires_at=datetime(2099, 1, 1),
                ))
                db.add(SourcingMailPolicy(
                    id=policy_id, tenant_id='bootstrap-fixture-owner', recipient='founder@example.test',
                    held=True, suppressed=False, reason='Synthetic hold', history=[{'reason':'Synthetic hold'}],
                ))
                await db.commit()
        finally:
            current_tenant_id.reset(tenant)

        await bootstrap.initialize_database(engine)
        await bootstrap.initialize_database(engine)
        tenant = current_tenant_id.set('bootstrap-fixture-owner')
        try:
            async with sessions() as db:
                outreach = (await db.execute(select(SourcingOutreach).where(SourcingOutreach.id == outreach_id))).scalar_one()
                policy = (await db.execute(select(SourcingMailPolicy).where(SourcingMailPolicy.id == policy_id))).scalar_one()
            assert outreach.subject == 'Preserved draft proposal'
            assert outreach.body == 'Synthetic body to preserve.'
            assert outreach.status == 'awaiting_approval'
            assert outreach.gmail_draft_id is None
            assert policy.held is True
            assert policy.reason == 'Synthetic hold'
            async with engine.connect() as connection:
                assert await connection.scalar(text('SELECT COUNT(*) FROM sourcing_outreach')) == 1
        finally:
            current_tenant_id.reset(tenant)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_legacy_outreach_upgrade_adds_tenant_and_draft_columns_without_losing_data(tmp_path, monkeypatch):
    from app.db import bootstrap
    from app.services import mcp_directory

    monkeypatch.setattr(mcp_directory, 'seed_directory_rows', skip_directory_seed)
    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'legacy-bootstrap.db'))
    outreach_id = str(uuid4())
    try:
        async with engine.begin() as connection:
            await connection.execute(text('''CREATE TABLE sourcing_outreach (
                id VARCHAR(36) PRIMARY KEY,
                request_id VARCHAR(36) NOT NULL,
                digest VARCHAR(64) NOT NULL,
                provider VARCHAR(12) NOT NULL,
                account_id VARCHAR(36) NOT NULL,
                account_binding VARCHAR(64) NOT NULL,
                sender VARCHAR(254) NOT NULL,
                recipient VARCHAR(254) NOT NULL,
                subject VARCHAR(200) NOT NULL,
                body TEXT NOT NULL,
                status VARCHAR(24) NOT NULL,
                review_token VARCHAR(80) NOT NULL,
                review_expires_at DATETIME NOT NULL,
                approved_at DATETIME,
                approved_by VARCHAR(255),
                not_before DATETIME,
                attempted_at DATETIME,
                completed_at DATETIME,
                detail JSON NOT NULL,
                created_at DATETIME NOT NULL
            )'''))
            await connection.execute(text('''INSERT INTO sourcing_outreach
                (id, request_id, digest, provider, account_id, account_binding, sender, recipient,
                 subject, body, status, review_token, review_expires_at, detail, created_at)
                VALUES (:id, :request, :digest, 'gmail', 'legacy-grant', :binding, 'investor@example.test',
                 'founder@example.test', 'Legacy proposal', 'Keep this content', 'awaiting_approval',
                 'legacy-review-token', '2099-01-01 00:00:00', '{}', '2026-10-25 00:00:00')'''), {
                'id':outreach_id, 'request':str(uuid4()), 'digest':'c'*64, 'binding':'d'*64,
            })

        await bootstrap.initialize_database(engine)
        await bootstrap.initialize_database(engine)
        async with engine.connect() as connection:
            columns = await connection.run_sync(lambda sync: {column['name'] for column in inspect(sync).get_columns('sourcing_outreach')})
            saved = (await connection.execute(text('''SELECT id, recipient, subject, body, status,
                gmail_draft_id, tenant_id FROM sourcing_outreach WHERE id=:id'''), {'id':outreach_id})).mappings().one()
            count = await connection.scalar(text('SELECT COUNT(*) FROM sourcing_outreach'))
        assert {'tenant_id', 'gmail_draft_id'} <= columns
        assert saved['id'] == outreach_id
        assert saved['recipient'] == 'founder@example.test'
        assert saved['subject'] == 'Legacy proposal'
        assert saved['body'] == 'Keep this content'
        assert saved['status'] == 'awaiting_approval'
        assert saved['gmail_draft_id'] is None
        assert saved['tenant_id'] == 'legacy-owner'
        assert count == 1
    finally:
        await engine.dispose()
