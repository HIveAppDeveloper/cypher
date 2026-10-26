# Reviewed specialist workflow sources

Cypher adapts short workflow principles from the pinned agent/skill files listed
in `backend/app/services/data/specialist_sources.json`. The manifest records the
repository, exact commit and path, Git blob SHA, content SHA-256, review scope,
license, dated star observation and the adaptation used by each profile axis.

The 10,000 profiles are compositions of 100 domain adaptations and 100
procedures. They are not 10,000 independently published GitHub skills, trained
models, or validated expert systems. Repository stars apply to the upstream
repository, not each individual file, and are not evidence of performance.

Sources and retained licenses:

Backend distribution copies are included under `app/services/data/licenses/`
as `owner--repository.LICENSE`, with this notice, so container/wheel users also
receive the license texts.

- [Agency Agents](https://github.com/msitarzewski/agency-agents), MIT,
  copyright 2025 AgentLand Contributors — `msitarzewski--agency-agents/LICENSE`.
- [Superpowers](https://github.com/obra/superpowers), MIT,
  copyright 2025 Jesse Vincent — `obra--superpowers/LICENSE`.
- [Knowledge Work Plugins](https://github.com/anthropics/knowledge-work-plugins),
  Apache-2.0 — `anthropics--knowledge-work-plugins/LICENSE`.
- [Awesome Copilot](https://github.com/github/awesome-copilot), MIT,
  copyright GitHub, Inc. — `github--awesome-copilot/LICENSE`.

Modifications: Cypher writes concise tool-free workflow adaptations, combines
domain and procedure guidance, and adds its own evidence, cost and authorization
boundaries. It does not import upstream scripts, installation steps, claimed
experience, permission grants, forced customer questionnaires, or unmeasured
speed/accuracy promises. No upstream content is downloaded or executed during a
customer request. Product/tool names do not imply upstream sponsorship.
