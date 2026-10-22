---
name: Open GrokBot
description: A light agent workspace with team conversations, multimodal input, and adjustable run controls.
colors:
  panel: "#fff"
  conversation: "#faf9f7"
  sidebar: "#f3f2ef"
  card: "#eeede9"
  card-hover: "#e9e8e4"
  selected: "#e6e4e0"
  border-light: "#e1dfd9"
  text: "#202020"
  text-muted: "#656460"
  accent-blue: "#404047"
  outgoing: "#e8e6e1"
  send: "#404047"
  focus: "#55534e"
  status-green: "#33785c"
  status-red: "#b82840"
  notice-surface: "#fff9fc"
  notice-border: "#e4d8de"
  notice-text: "#6e3f56"
  room-surface: "#e9e5e8"
  room-ink: "#77536a"
  member-chip: "#f1f1f1"
  attachment-surface: "#f2f2f2"
  running: "#936621"
  glass-trigger: "rgba(255,255,255,.83)"
  glass-menu: "rgba(252,251,253,.91)"
  glass-dialog: "rgba(255,255,255,.9)"
  glass-border: "rgba(98,85,99,.16)"
  glass-ink: "#29262c"
  violet: "#6945c6"
  forest: "#26765f"
  slate-blue: "#324f85"
  graphite: "#404047"
typography:
  display:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "26px"
    fontWeight: 550
    lineHeight: 1.3
    letterSpacing: "-.03em"
  headline:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "27px"
    fontWeight: 500
  title:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    lineHeight: 1.65
  label:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 600
rounded:
  sm: "6px"
  md: "12px"
  lg: "24px"
  full: "999px"
  roster-row: "11px"
  message: "18px"
  composer: "24px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.panel}"
    rounded: "12px"
    padding: "10px 18px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    rounded: "12px"
    padding: "10px 18px"
  button-round:
    backgroundColor: "{colors.panel}"
    width: "30px"
    height: "32px"
    rounded: "50%"
  message-incoming:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.message}"
    padding: "10px 16px"
  message-outgoing:
    backgroundColor: "{colors.outgoing}"
    textColor: "{colors.text}"
    rounded: "{rounded.message}"
    padding: "10px 16px"
  team-member-chip:
    backgroundColor: "{colors.member-chip}"
    rounded: "20px"
    padding: "3px 8px"
  glass-select-trigger:
    backgroundColor: "{colors.glass-trigger}"
    textColor: "{colors.glass-ink}"
    rounded: "12px"
    padding: "12px 16px"
    height: "48px"
  glass-select-option:
    rounded: "13px"
    padding: "13px 17px 13px 42px"
    height: "50px"
  glass-dialog:
    backgroundColor: "{colors.glass-dialog}"
    rounded: "24px"
  search-input:
    rounded: "{rounded.md}"
    padding: "10px"
---

# Design System: Open GrokBot

## Overview

The October 22 workspace uses a full-bleed warm off-white conversation, a quiet neutral navigation rail, subdued initials avatars, and an adjustable Graphite default action accent. A single conversation toolbar and a centered two-row composer establish hierarchy. Open GrokBot keeps its own name and mark. Glass remains available for menus and dialogs; conversation text stays the primary visual anchor.

The frontmatter and the October 22 refresh below describe the current composition. Earlier dated sections are preserved as implementation history; the October 22 values supersede conflicting frame, palette, bubble, sidebar, and composer descriptions. Existing product capability and verification limits remain separate from visual evidence.

Production revision b473 previously verified database/worker operation, generated OpenAI PNG, Gemini JPEG, and Veo MP4 media, and a real GPT-6 Luna → Gemini group job. DeepWiki tool invocation was also verified. The former free-credit restriction is historical and no longer describes the current verified capability. The new glass controls, appearance preferences, goals, channels, and per-plugin tool controls have passed source checks (31 backend tests and the frontend production build), but have not yet been verified live. Prior live results do not prove the new workflows or every model, provider, sandbox, or connected service.

**Key Characteristics:**
- Full-bleed off-white messaging workspace with browser-local action accent customization.
- Muted initials identities and symmetric neutral message bubbles.
- Compact composer selectors and readable translucent dialog menus with keyboard navigation.
- Bounded scrolling dialogs with persistent actions.
- Explicit progress, connection, goal, and delivery states.

## Colors

### Primary

Graphite is the default active appearance accent. Preferences can switch to Rose, Violet, Forest, or Slate blue; existing saved choices remain effective. The source retains the legacy `accent-blue` name; appearance applies its value to send actions, primary actions, and the focus variable. Current message bubbles stay neutral. Some legacy literal pink accents remain in secondary details; do not claim every existing pink is dynamically bound.

### Neutral

Keep the warm off-white conversation, light-gray navigation rail, neutral incoming and outgoing bubbles, muted previews, and hairline dividers. Glass uses translucent near-white surfaces and subdued violet-gray borders rather than saturated translucent panels. Selected menu rows mix the current focus accent at 11% with white. Status text remains explicit independently of green, red, or amber color.

## Typography

Use self-hosted Inter Variable with the frontmatter fallbacks. The QuickStart heading uses the display role, reduced to (24px) on mobile. Default message size remains the browser-local appearance choice, initially (16px/1.65), adjustable from (14–22px). Main-panel font selection retains Inter, system sans, and Georgia. The compact roster uses (13px/450) names; preview text is hidden, with the description retained in the title. Composer input is (15px) on desktop and (16px) on mobile.

Standard dialog selects retain readable labels and wrapping options. Compact composer and first-task selectors use (11px) desktop labels and at least (36px) triggers; mobile controls grow to (40px). Do not apply their compact dimensions to provider/model forms.

## Layout

The app fills (100dvh) with no outer frame, gap, border, or main-panel corners. The rail defaults to (256px), remains adjustable from (220–480px), and leaves at least (360px) for the conversation. The collapsed rail is (64px). Collapse, resize, left/right docking, reset, and keyboard navigation remain available. Navigation and conversation headers are (56px) high.

Conversation content and the two-row composer share a (752px) maximum measure. Default message width remains (88%), bounded at (75ch), and adjustable (60–100%). At (1000px) the composer model metadata hides. At (760px) navigation becomes a labeled native modal drawer, message width allows (94%), and composer margins shrink to (12px). Mobile attachment/send targets are (44px); output/tools controls are at least (40px). The Work drawer retains (8px) viewport clearance.

QuickStart uses the same content measure, a two-row white composer, and an arrow action with its Start task accessible name retained. The empty-state heading sits above it; starter prompts and the existing agent/team shortcuts follow. Dialog bodies scroll independently while actions remain reachable. Agent-creation validation appears in the persistent footer, including when advanced instructions are collapsed.

Browser-local roster density remains effective: compact rows are at least (36px) with (5px) vertical padding, comfortable desktop rows (42px) with (7px), and spacious rows (56px) with (12px). Preferences apply immediately in this browser; they do not imply account-level synchronization.

## Elevation & Depth

The message workspace stays mostly flat. Message bubbles have no enclosing shadow; composers remain flat, including on focus, when their border darkens. The authoritative workspace layer removes the legacy glass trigger shadow. Menus use a stronger diffuse shadow and translucent blur; dialogs use a broad ambient shadow and blurred dim backdrop. Menu content renders at z-index (1000) and portals into its nearest native dialog when present, keeping popovers within the dialog top layer.

Default glass blur is (24px), adjustable (0–40px). Triggers saturate backdrop at (140%), menus (160%), and dialogs (145%). Dialog blur is implemented on a noninteractive isolated pseudo-element, keeping portaled select content positioned correctly; do not move that filter onto the dialog ancestor. The backdrop has its own (5px) blur.

Menu entrance lasts (160ms) with `cubic-bezier(.16,1,.3,1)`, moving from (-4px) and scale (.985) to rest. Trigger state transitions last (150ms ease). The OS reduced-motion preference removes menu entrance; the appearance motion switch removes all interface animations and transitions.

## Shapes

Incoming and outgoing messages use symmetric message corners from the frontmatter. Desktop composers have the documented composer radius, reduced to (22px) on mobile. Roster avatars are small circles: (26px) desktop and (28px) mobile. Form controls and glass overlays retain their established shapes: trigger (12px), menu (16px), options (13px), and general dialog (24px); the agent-creation dialog uses (20px). Desktop composer send/attachment controls are circular (40px), growing to (44px) on mobile. Standard form inputs remain distinct from compact composer controls.

## Components

### Glass Selects

Use the Radix-backed `GlassSelect` for provider, named model, typeface, role, manager, workspace, output, accent, and density choices. Standard triggers use the frontmatter dimensions; menu padding is (7px), maximum width `min(560px,calc(100vw - 32px))`, and maximum height bounded by (360px) and available popover space. Position uses an (8px) offset and (12px) collision clearance. Options reserve left space for the checkmark, wrap long labels, highlight with a pale accent fill, and use weight (550) when checked. Disabled options have (.4) opacity. Preserve keyboard/typeahead/selection semantics and visible focus. Do not recreate the native option popup or use tiny crowded browser selects for these controls.

### Buttons and Inputs

Primary and secondary dialog actions retain minimum height (44px); compact toolbar actions use their observed smaller dimensions. The primary binds to the active accent. Global focus follows the focus variable; the enclosing composer signals focus with a darker border and no added shadow. Inputs and textareas in agent forms use (15px) text and (12px 14px) padding. QuickStart groups its textarea with an enclosing focus border, starter chips, and output menu. Retain actual error details and task text after failure.

### Conversation and Media

Incoming and outgoing replies use neutral bubbles on the off-white thread; timestamps sit beneath, and tool disclosures use bounded monospace output. Active accent remains on actions rather than message fills. Attachments have removable staging chips, image previews, file links, audio controls, and video controls. Prior production verification includes PNG/JPEG/MP4 output; this is evidence of those tested paths, not a guarantee for every model or future request. Do not fabricate media or completed-work previews.

### Appearance

The native dialog groups accent and density glass selects with text-size, message-width, and blur sliders, plus an Interface animations checkbox. Defaults are Graphite, (16px), (88%), (24px), comfortable density, and animations enabled. Outputs use tabular numerals and align right. Reset appearance and Done stay visible in the footer.

### Goals and Channels

Goals reuse scrolling glass dialogs, clearly labeled outcome/completion fields, workspace/manager menus, and interval/run sliders. Divided goal rows show title, textual state, run count, schedule, summary, workspace action, details, and Pause/Resume where applicable. Completed state uses forest ink; blocked work reads Needs review. Do not present paused, blocked, or exhausted work as active.

Channel rows show enable state, connection-test action, and delivery-log access. Newly created credentials appear in a pale lavender key panel with (18px) padding and corners, masked by default, with explicit one-time-save text, reveal, and copy controls. Keep queueing, processing, and successful outbound delivery as distinct statuses. Hiding a key is not proof that the external account is authenticated.

### Connections and Runtime

Connections preserves MCP/variable tabs, encrypted-token entry, divided server rows, and explicit configured/needs-link states without exposing values. Add individual tool switches and a refresh action; refresh failure preserves the connection. Setup distinguishes database, worker heartbeat, gateway configuration, actual model results, and per-tool checks. Use current evidence rather than stale billing failures or inferred success. New goals/channels require their own live verification.

## Do's and Don'ts

### Do:

- Do preserve the light Grok identity while making glass controls generous and readable.
- Do keep blur and motion user-adjustable and keyboard states visible.
- Do keep dialog actions reachable while fields scroll.
- Do use explicit state text for goals, queued work, blocked runs, and deliveries.
- Do keep private credentials masked and separate from connection-status claims.

### Don't:

- Don't claim new goals, channels, preferences, or plugin controls are live verified from source tests alone.
- Don't infer private-account OAuth access from a webhook or MCP URL.
- Don't replace task content with invented successful examples.
- Don't force every surface into a floating glass card.
- Don't claim screenshot pixel fidelity or universal provider/tool readiness.

## Team text thread

The main workspace opens the existing Agent lounge as Your team. Preserve the light palette and glass controls. The conversation header uses a direct title and quiet subtitle; participant chips collapse under a teammates disclosure. Message options retain all model and media controls behind one disclosure, with the current mode and Sol/Luna visible in its summary. Consecutive same-sender messages within five minutes group visually. Message actions use a small Options disclosure. Queued/running indicators derive only from real task status. No fabricated typing, staff exchanges, completed work, or online presence. Computer controls show progress, successful connection, and a stop action after a successful request.

### Steering

A collapsed Steer your team disclosure precedes Message options. Its brief, constraints, working pace, and reply style use existing glass controls and readable input fields. Saving updates the next-message options and browser-local thread preference. A separate active-task action posts a visible direction change, applied at model/tool boundaries. In-flight actions and media cannot be undone; text limits do not implement provider billing caps. Status notices distinguish saved-next-message settings from accepted active-task instructions.

### Immediate messaging, memory, and account controls

Sent text appears immediately with Sending state and is reconciled by message UUID. Attachments retain previews, removable file chips, visible read/error states, and a drag target. The conversation adds Context & memory as a collapsed disclosure beside steering and message options; notes remain editable and deletable without filling the thread with settings. Connections nests signup assistance and optional passkey enrollment under Accounts & device approval, with explicit unconnected Gmail/Resend states. No simulated biometric success or provider login state is shown.

## Simplified conversation toolbar
Move the stacked Recent work, Context & memory, Steer your team, and Message options disclosures into a single Settings popover at the top. Keep the composer free of configuration rows, with 44px attachment/send targets and a text field that grows up to 150px. Preserve Inter and the existing light glass palette. Plugins is a named sidebar destination; Add plugin reveals custom MCP setup while the catalog remains browsable.

## Dockable sidebar and connector browser
The existing light workspace now uses a 280px default sidebar, adjustable from 220px to 480px while preserving at least 360px for the conversation; narrow screens use a 64px rail. The collapsed desktop rail is 72px. A 32px desktop layout strip contains docking, collapse, and reset; its grip previews the drop side. Sidebar names use 14px Inter with 12px descriptions and 36px avatars. Pin and actual-work filters improve scanning without invented activity.

The Plugins surface is a 920px maximum, 760px maximum-height dialog with a 24px corner and independently scrolling content. Browse contains a single website input, followed by source-backed service tiles with actual logos, short descriptions, categories, and Connect actions. Connected tools, custom server setup, and settings use separate tabs. Desktop tiles form 3 columns, intermediate widths 2, and mobile 1. Graphite primary buttons and pale lavender secondary controls preserve the incumbent system while removing the former oversized technical form. No server is labeled connected until tool discovery succeeds. Provider logos retain source URLs in the committed catalog and origin metadata in PNG assets.

## Workspace usability pass — October 21, 2026

The Operate surface now imports `workspace-ux.css` after legacy styles as the authoritative interaction and responsive layer. Retain the existing light identity and user-selected accent. Use 12px control corners, a 20px composer, a 24px dialog, Inter body text, and quiet gray surfaces. Primary actions remain explicit; layout adjustments move into a compact sidebar menu. The account footer derives its identity from the signed-in email.

Below 760px, navigation uses a labeled native modal drawer with a visible menu control, Escape dismissal, and automatic closing after navigation. Desktop retains collapse, resize, and left/right docking. The chat occupies the full mobile width. Settings dismiss with Escape or an outside click while allowing portaled model menus. Login controls fill their container and retain readable 16px inputs on mobile.

The agent list keeps at least 104px of usable height. In short windows the surrounding sidebar scrolls rather than compressing the list beneath Plugins, Goals, and Channels. Fixed navigation controls retain their height, and agent selection remains reachable by pointer and keyboard.

Workspace failures appear inline with Retry and Connection settings; they no longer cover the composer. Chat drafts store text in session storage per conversation and survive switching away. Active tasks expose Stop beside the composer, and scrolling away reveals Jump to latest. Plugin catalog and connected-service loading fail independently and offer refresh and clear-filter recovery. First tasks submit with Enter, with Shift+Enter retained for writing. Accepted first tasks open immediately; retries use an idempotent request ID.

Validation: Next production compilation and type checking, four existing attachment tests, and six simulated interaction checks (mobile navigation, email error/retry, draft restoration, Stop, task keyboard submission, and plugin partial-failure recovery). Simulated checks mock network requests and native dialog behavior; they do not verify provider authentication, model execution, or actual mobile browser focus trapping. Live signed-out login is the accessible visual surface; authenticated visual review requires sign-in.


## Workspace refinement — October 21, 2026

This refinement supersedes the earlier toolbar, organic avatar, bubble, and desktop sizing descriptions where they differ. Preserve existing agent, team, plugin, media, memory, steering, appearance, and account behavior.

### Command palette

Search workspace opens a native dialog through a body portal, including from mobile navigation. Cmd+K or Ctrl+K toggles it. Its search matches conversation/action labels, groups, and descriptions, showing at most 20 results. Arrow keys move selection, Enter opens the selected result, and Escape or the close control dismisses. Choosing an action closes mobile navigation. This searches available workspace destinations and actions; it does not search message history. Use an (18px) dialog radius, (560px) width cap, (16dvh) top offset, and results bounded by the smaller of (420px) and (55dvh).

### Conversation controls

One toolbar holds the conversation title, Search, Work count, and Conversation settings. Remove the duplicated identity heading. Keep teammates in a collapsed disclosure and computer controls separate when a direct agent conversation exposes them. Search this conversation filters the currently loaded noninternal message content, case-insensitively; show the result count and explicit empty state. Loading earlier messages expands that searchable set. Escape and Close clear the query and return focus to Search. Do not imply server-side or complete-history search.

The composer exposes Text/Image/Video response format and a Tools on/off toggle, with model metadata aligned to the right. These controls share the same run options as Conversation settings. Media-specific controls remain available there. Composer attachment and send buttons use (36px) visuals with (4px) surrounding margins. Keep real attachment staging, validation failures, in-flight send state, Stop, and Jump to latest behavior. Text drafts remain tab-local per conversation.

### Work and direction

Work opens the native Work & direction drawer, capped at (430px), with (12px) desktop viewport clearance, (20px) corners, a persistent header/navigation, and an independently scrolling body. Recent work prioritizes real active jobs, then recency, and displays up to 30 jobs with explicit queued, running, stopping, completed, failed, stopped, or interrupted text. Stop task remains available only for pending/running jobs and reports failures inline. Direction reuses the existing steering controls, distinguishing future-message settings from an active-task redirect. Never invent progress, results, or presence.

### Identity and motion

Bot avatars use initials from the first two name words with a deterministic muted background chosen from warm gray, sage, blue gray, and mauve. Standard avatars are (36px) with (11px) corners; small avatars are (28px) with (9px) corners. Roster names use (13px/550), descriptions (11px), and rows at least (56px). Names carry identity; color is supplementary.

The drawer entrance uses (220ms cubic-bezier(.16,1,.3,1)), moving from (20px) right at (.65) opacity to rest. OS reduced motion removes all animations, transitions, and smooth scrolling; the appearance motion switch removes animations/transitions. Jump to latest respects the OS preference.

Validation for this refinement: source review resolved six listed issues; four mocked interaction checks and the attachment suite passed. The production build and type checks passed after the final fixes. These checks establish no screenshot comparison, visual approval, live provider execution, or real mobile focus-trap verification. Earlier validation notes above describe earlier revisions.


## Workspace composition refresh — October 22, 2026

This Operate refresh follows the requested current Grok composition while retaining Open GrokBot branding and functional controls. The final imported workspace composition stylesheet supersedes conflicting October 21 frame, sidebar, typography, bubble, and composer values. It adds no image assets, commercial claims, provider grants, or production activation.

The first desktop viewport is a full-bleed conversation field beside a compact rail. New task, Computer, Memory/skills/routines, and Goals precede the actual agents; Plugins, Channels, Appearance, and the account remain reachable. The centered empty task composer and restrained heading carry the main emphasis. In populated conversations, search, Work, settings, attachment staging, output/tools options, Stop, and draft recovery retain their existing handlers. Enter submits, Shift+Enter writes a new line, and composing input is not intercepted. Manual first-task model choices preserve their provider/model pair; Auto uses the valid OpenAI Sol base pair with automatic routing.

Validation is local: the production build and 20 focused frontend tests passed according to the UI owner's packet, including 11 QuickStart checks. Actual desktop (1440×1000) and mobile (390×844) screenshots cover empty/populated threads, loading, agent validation, and connection/appearance dialogs. The independent reviewer inspected the supplied captures and code; the existing detector returned no findings. Synthetic text is labeled as such. This evidence does not establish production deployment, pixel fidelity, live model/tool execution, provider authentication, or performance superiority. Earlier production evidence above remains historical and must not be attributed to this refresh.


## Focused usability follow-up — October22,2026

Preserve the current Operate composition. Creation now exposes role and optional name first, with a friendly selected-model summary; Customize contains instructions, model controls and tools. Validation expands and focuses the invalid instructions without changing creation request identity. Mobile task model/output controls use44px targets and12px labels, with a full-row model selector. Keep startup feedback tied to real pending requests, without simulated progress.

Home task drafts are scoped to the existing authenticated account ID in tab storage. Conversation recovery preserves drafts and loaded history, offers Reconnect or Sign in, honors server retry windows, and retains safe quota details. Workspace search ignores composing Enter; Jump to latest honors both OS and app motion settings. Login grid sizing constrains the existing Google widget without changing authentication.

Validation against reconciled upstream912eb6d:272backendtests,52frontendtests,12offline layout checks, production build,13local actualAPI/SQLite/worker cases with controlled inference, and actual Mac desktop/mobile screenshots. These establish no live Google/email/provider behavior or production performance claim. The observed production/callback origin mismatch remains a configuration coordination gate. See verification/ux-followup.md and its linked results.

## Model connection follow-up — October 22, 2026

Keep model setup one action from both the empty task composer and conversation settings. The workspace setup dialog separates Gemini API access from Google consumer subscriptions, opens the configured OmniRoute dashboard without exposing URL credentials or query values, and tests Gemini with one short request through the actual configured model route. Loading, success, failure, and quota-cost states remain explicit. This test proves only the selected Gemini route at the moment it runs; it does not claim other providers or subscription OAuth are connected.
