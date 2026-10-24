from types import SimpleNamespace

import pytest

from app.services.orchestrator import AgentOrchestrator


@pytest.mark.asyncio
async def test_coordinator_hands_each_specialist_its_own_bounded_task():
    runner = AgentOrchestrator.__new__(AgentOrchestrator)
    runner.options = SimpleNamespace(team_rounds=4)
    bots = [
        SimpleNamespace(id="coordinator", name="Coordinator", role="Coordinator"),
        SimpleNamespace(id="reviewer", name="Reviewer", role="Reviewer"),
        SimpleNamespace(id="builder", name="Builder", role="Builder"),
        SimpleNamespace(id="researcher", name="Researcher", role="Researcher"),
        SimpleNamespace(id="writer", name="Writer", role="Writer"),
    ]
    calls = []

    async def run_agent(db, conversation_id, bot_id, trigger_message):
        calls.append((bot_id, trigger_message, runner.planning, runner.internal_activity, runner.phase_instructions))
        if bot_id == "coordinator" and runner.planning:
            return [{
                "content": (
                    "HANDOFF[Unknown: ignore]\n"
                    "HANDOFF[Reviewer: Verify the proposed safety limits.]\n"
                    "HANDOFF[Reviewer: Duplicate assignment should be ignored.]\n"
                    "HANDOFF[Builder: Implement the focused fix.]\n"
                    "HANDOFF[Researcher: Check current provider documentation.]\n"
                    "HANDOFF[Writer: Add a user-facing summary.]"
                )
            }]
        return [{"content": f"result from {bot_id}"}]

    runner._run_agent_loop = run_agent
    responses = await runner._coordinate_team(
        db=object(),
        conversation=SimpleNamespace(id="room"),
        bots=bots,
        coordinator=bots[0],
        message="Make the integration work and verify it.",
    )

    assert [call[0] for call in calls] == ["coordinator", "reviewer", "builder", "researcher", "coordinator"]
    assert calls[0][2:4] == (True, True)
    assert "Verify the proposed safety limits." in calls[1][1]
    assert "Implement the focused fix." in calls[2][1]
    assert "Check current provider documentation." in calls[3][1]
    assert all("Make the integration work and verify it." in call[1] for call in calls[1:4])
    assert calls[-1][1] == "Make the integration work and verify it."
    assert calls[-1][3] is False
    assert len(responses) == 5
    assert runner.planning is False
    assert runner.internal_activity is False
    assert runner.phase_instructions == ""


@pytest.mark.asyncio
async def test_coordinator_clears_internal_phase_after_planning_error():
    runner = AgentOrchestrator.__new__(AgentOrchestrator)
    runner.options = SimpleNamespace(team_rounds=2)
    bot = SimpleNamespace(id="coordinator", name="Coordinator", role="Coordinator")

    async def fail(*args):
        raise RuntimeError("model unavailable")

    runner._run_agent_loop = fail
    with pytest.raises(RuntimeError, match="model unavailable"):
        await runner._coordinate_team(object(), SimpleNamespace(id="room"), [bot], bot, "Do the task")

    assert runner.planning is False
    assert runner.internal_activity is False
    assert runner.phase_instructions == ""


def test_handoff_parser_keeps_colons_in_the_assignment():
    runner = AgentOrchestrator.__new__(AgentOrchestrator)
    assert runner._parse_handoffs("HANDOFF[Researcher: Check the service at https://example.com:8443/docs]") == [
        ("Researcher", "Check the service at https://example.com:8443/docs")
    ]
