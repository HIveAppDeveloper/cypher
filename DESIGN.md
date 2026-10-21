---
name: Open GrokBot
description: A light agent workspace with team conversations, multimodal input, and adjustable run controls.
colors:
  panel: "#fff"
  conversation: "#fff"
  sidebar: "#f4f4f6"
  card: "transparent"
  card-hover: "#e4e4e4"
  selected: "#e7e5ec"
  border-light: "#e6e6e6"
  text: "#242329"
  text-muted: "#6e6b75"
  accent-blue: "#404047"
  outgoing: "#404047"
  send: "#404047"
  focus: "#404047"
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
    fontSize: "clamp(28px,3.2vw,42px)"
    fontWeight: 550
    lineHeight: 1.2
    letterSpacing: "-.035em"
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
  roster-row: "12px"
  message: "18px 18px 5px 18px"
  composer: "18px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.outgoing}"
    textColor: "{colors.panel}"
    rounded: "12px"
    padding: "10px 18px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    rounded: "12px"
    padding: "10px 18px"
  button-round:
    backgroundColor: "{colors.panel}"
    width: "43px"
    height: "43px"
    rounded: "50%"
  message-incoming:
    backgroundColor: "{colors.card}"
    rounded: "0px"
    padding: "0px"
  message-outgoing:
    backgroundColor: "{colors.outgoing}"
    textColor: "{colors.panel}"
    rounded: "{rounded.message}"
    padding: "13px 18px"
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

The light Grok workspace uses a quiet neutral roster, white conversation, subdued initials avatars, and an adjustable Graphite default accent. A framed desktop workspace and a single conversation toolbar establish hierarchy. Glass remains available for menus and dialogs; conversation text stays the primary visual anchor.

Production revision b473 previously verified database/worker operation, generated OpenAI PNG, Gemini JPEG, and Veo MP4 media, and a real GPT-6 Luna → Gemini group job. DeepWiki tool invocation was also verified. The former free-credit restriction is historical and no longer describes the current verified capability. The new glass controls, appearance preferences, goals, channels, and per-plugin tool controls have passed source checks (31 backend tests and the frontend production build), but have not yet been verified live. Prior live results do not prove the new workflows or every model, provider, sandbox, or connected service.

**Key Characteristics:**
- Light neutral messaging workspace with browser-local accent customization.
- Muted initials identities, plain incoming text, and rounded outgoing messages.
- Large translucent select menus with keyboard navigation.
- Bounded scrolling dialogs with persistent actions.
- Explicit progress, connection, goal, and delivery states.

## Colors

### Primary

Graphite is the default active appearance accent. Preferences can switch to Rose, Violet, Forest, or Slate blue; existing saved choices remain effective. The source retains the legacy `accent-blue` name; appearance applies its value to outgoing bubbles, send actions, primary actions, and the focus variable. Some legacy literal pink accents remain in secondary details; do not claim every existing pink is dynamically bound.

### Neutral

Keep the white/near-white conversation, light-gray sidebar, plain incoming text, muted previews, and hairline dividers. Glass uses translucent near-white surfaces and subdued violet-gray borders rather than saturated translucent panels. Selected menu rows mix the current focus accent at 11% with white. Status text remains explicit independently of green, red, or amber color.

## Typography

Use self-hosted Inter Variable with the frontmatter fallbacks. The QuickStart heading uses the display role: medium weight, tight tracking, and responsive size, with the earlier mobile rule setting (30px). Default messages use (16px/1.65), with markdown line height (1.8) and mobile message text bound to the same appearance size variable, adjustable from (14–22px). Names and active identities remain medium weight; timestamps and metadata remain small and muted. Main-panel font selection offers Inter, system sans, and Georgia; browser-local appearance controls message size separately.

Select triggers and options use (15px) text, with mobile options (14px), and labels in agent/model forms (14px/1.5). Menu descriptions and selectable labels must wrap or truncate intentionally rather than forcing unreadable tiny text.

## Layout

The app fills (100dvh). Desktop uses a pale outer canvas with (12px) padding and gap around the white main workspace, whose border and (20px) corners frame the conversation. The sidebar defaults to (280px) in state; the stylesheet fallback is (260px), with a CSS clamp from (220px) to the smaller of (420px) and viewport width minus (420px). Collapse, resize, and docking remain available. The single conversation toolbar is (76px) high; message stream and composer align within a (900px) content measure. Default message width is (88%), bounded at (75ch), adjustable (60–100%).

At (1000px) and below, secondary toolbar labels hide while accessible names remain. At (760px) and below, the frame padding, gap, border, and corners disappear; the toolbar becomes (68px), navigation opens in a labeled native modal drawer, and messages permit (94%) available width. Mobile toolbar actions are at least (44px); output and tools controls are at least (40px). Search inputs use (16px) on mobile. The Work drawer uses (8px) viewport clearance on mobile.

QuickStart centers its task composer at up to (700px), with output choice and a nonwrapping Start task action; the action spans its own row on mobile. General dialogs retain a (480px) cap, (32px) viewport clearance, independently scrolling form body, and persistent actions. Mobile dialog padding is (24px 18px).

Agent-list density uses vertical row padding of (8px) compact, (13px) comfortable, or (18px) spacious. Preferences apply immediately and persist only in this browser. They do not establish account-level synchronization.

## Elevation & Depth

The message workspace stays mostly flat. Incoming text and identity have no enclosing shadow; composer shadow appears on focus. The authoritative workspace layer removes the legacy glass trigger shadow. Menus use a stronger diffuse shadow and translucent blur; dialogs use a broad ambient shadow and blurred dim backdrop. Menu content renders at z-index (1000) and portals into its nearest native dialog when present, keeping popovers within the dialog top layer.

Default glass blur is (24px), adjustable (0–40px). Triggers saturate backdrop at (140%), menus (160%), and dialogs (145%). Dialog blur is implemented on a noninteractive isolated pseudo-element, keeping portaled select content positioned correctly; do not move that filter onto the dialog ancestor. The backdrop has its own (5px) blur.

Menu entrance lasts (160ms) with `cubic-bezier(.16,1,.3,1)`, moving from (-4px) and scale (.985) to rest. Trigger state transitions last (150ms ease). The OS reduced-motion preference removes menu entrance; the appearance motion switch removes all interface animations and transitions.

## Shapes

Outgoing messages use an asymmetric (18px 18px 5px 18px) silhouette; incoming text has no bubble padding or radius. The composer uses (18px) corners, initials avatars (11px), and shared controls (12px). Glass overlays extend the family: trigger (12px), menu (16px), options (13px), and dialog (24px). General form inputs have (14px) corners and minimum height (48px). Compact task/output triggers use (15px) corners with minimum height (44px); standard select triggers remain at least (48px). Options remain at least (50px), including mobile.

## Components

### Glass Selects

Use the Radix-backed `GlassSelect` for provider, named model, typeface, role, manager, workspace, output, accent, and density choices. Standard triggers use the frontmatter dimensions; menu padding is (7px), maximum width `min(560px,calc(100vw - 32px))`, and maximum height bounded by (360px) and available popover space. Position uses an (8px) offset and (12px) collision clearance. Options reserve left space for the checkmark, wrap long labels, highlight with a pale accent fill, and use weight (550) when checked. Disabled options have (.4) opacity. Preserve keyboard/typeahead/selection semantics and visible focus. Do not recreate the native option popup or use tiny crowded browser selects for these controls.

### Buttons and Inputs

Primary and secondary actions have minimum height (44px). The primary binds to the active accent. Global focus follows the focus variable; composer retains its explicit (2px) outline with (2px) offset and (8px) corners. Inputs and textareas in agent forms use (15px) text and (12px 14px) padding. QuickStart groups its textarea with an enclosing focus border, starter chips, and output menu. Retain actual error details and task text after failure.

### Conversation and Media

Incoming replies use plain text on white; outgoing messages use the active accent, timestamps sit beneath, and tool disclosures use bounded monospace output. Attachments have removable staging chips, image previews, file links, audio controls, and video controls. Prior production verification includes PNG/JPEG/MP4 output; this is evidence of those tested paths, not a guarantee for every model or future request. Do not fabricate media or completed-work previews.

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
