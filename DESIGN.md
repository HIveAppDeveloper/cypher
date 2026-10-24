---
name: Cypher
description: A quiet monochrome agent workspace with the original Cypher identity and functional connected tools.
colors:
  conversation: "#f2f2f7"
  panel: "#fff"
  sidebar: "#eee"
  subtle: "#e8e8e8"
  text: "#000000"
  text-secondary: "#626262"
  text-tertiary: "#737373"
  separator: "#dedee4"
  selected: "rgba(0,0,0,.075)"
  dark-conversation: "#111"
  dark-panel: "#1c1c1c"
  dark-sidebar: "#191919"
  dark-subtle: "#292929"
  dark-text: "#f5f5f5"
  dark-text-secondary: "#b5b5b5"
  dark-text-tertiary: "#aaa"
  dark-separator: "#3d3d3d"
  dark-selected: "rgba(255,255,255,.1)"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif'
    fontSize: "clamp(48px,6vw,72px)"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-.04em"
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif'
    fontSize: "20px"
    fontWeight: 650
    letterSpacing: "-.02em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "-.005em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif'
    fontSize: "16px"
    lineHeight: 1.6
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 500
rounded:
  sm: "6px"
  md: "8px"
  card: "10px"
  composer: "14px"
  dialog: "16px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-primary-dark:
    backgroundColor: "{colors.dark-text}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: "40px"
  search-input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "10px"
  select-trigger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "8px 11px"
    height: "40px"
  nav-row:
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "6px 7px"
  filter-chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    padding: "7px 13px"
  connector-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "16px"
  task-composer:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.composer}"
    padding: "9px 14px"
    height: "auto"
  dialog:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
---

# Design System: Cypher

## Overview

**Creative North Star: "Cypher's original monochrome binary identity"**

Cypher's original monochrome binary identity gives a functional agent workspace a quiet, recognizable center. Neutral surfaces, restrained separators, system typography, and generous space around the home task composer make the work readable. The existing binary lens and brief opening signature supply the identity's motion.

The current rules are extracted from the final imported brand stylesheet and its component sources. They supersede earlier Grok, adjustable-accent, lavender, glass, and decorative-orbit directions. This document records the implemented local candidate; final correction verification was pending at documentation time. It does not declare production activation or provider readiness.

**Key Characteristics:**
- Neutral light and dark surfaces with monochrome actions and visible keyboard focus.
- Original PNG artwork in navigation and sign-in; unchanged BinaryLens and CipherIntro for motion.
- Platform typography with existing optional conversation typefaces retained.
- Compact navigation, a calm task entry, and persistent recovery and authorization states.

## Colors

The palette is achromatic: soft neutral fields support graphite actions in light appearance and light actions in dark appearance. The frontmatter is the normative token layer; the source authority is `frontend/src/app/cypher-brand.css`, imported last by the root layout.

### Primary

Graphite text also supplies light-mode primary actions, outgoing messages, links, focus, carets, and selection. Light ink supplies the same roles in dark mode; action text uses the corresponding inverse. The legacy variable name `--accent-blue` remains a compatibility alias for the monochrome action, not a blue color or an exposed preference.

### Neutral

Conversation, panel, sidebar, subtle fill, separator, and three text levels have matching light and dark roles in the frontmatter. Connector counts, tabs, search, catalog tiles, secondary notices, and sidebar controls use these same roles. Preserve explicit status text; existing green/red/amber task and error states are semantic signals rather than additional brand accents. Do not generalize their individual legacy literals into a second palette.

**The Original Asset Rule.** Use the original PNG bytes through the proportional image viewport; never redraw its lettering, distort it, recompress it, or substitute a generated logo.

**The Neutral Action Rule.** App-owned brand, selection, link, and action styling stays neutral in both appearances; a saved legacy accent must not restore blue or purple chrome.

## Typography

**Display Font:** platform UI stack, with system sans fallbacks.

**Body Font:** the same platform UI stack by default.

**Label/Mono Font:** platform labels; existing monospace code and tool output remain distinct.

The hierarchy is restrained outside the home title. The display token applies to the single Cypher heading; mobile overrides it to (44px). Dialog headings use the headline role, toolbar titles use the title role, and roster names use (12px/500). Body message text defaults to the body role and remains adjustable from (14–22px). Composer text is (15px) on desktop and (16px) on mobile. Compact home selectors use (12px); mobile selector and send targets are at least (44px) high. The sign-in title is (27px/500) with a (1.2) line height.

**The Optional Typeface Rule.** System UI is the workspace default. Existing Inter and Georgia conversation choices remain preferences, not a replacement brand identity.

## Layout

The shell fills (100dvh), with no outer card frame. Its desktop sidebar defaults to (256px), with a rendered CSS clamp from (220px) to the smaller of (420px) and the viewport minus (360px). The controller retains a (480px) stored-width limit; this does not override the rendered cap. Collapsed navigation is (64px). Docking, resizing, reset, collapse, filtering, and pinning preserve their existing behavior and browser-local layout storage. Current toolbar and sidebar-header height is (52px). The home task view hides the conversation toolbar rather than repeating a second title.

The home panel is capped at (660px). Its binary lens uses a (560:210) aspect ratio with width capped at (460px), becoming at most (320px) on mobile. The original logo viewport has a separate (1624:806) aspect ratio; do not force either silhouette into a square. Navigation uses a (40×20px) mark and sign-in a (180px) wide hero mark. The home task form is one desktop row with textarea and control cluster; at (760px) it becomes a textarea row above its controls. Starter actions remain short text choices with ample space around the primary task.

Conversation content uses the inherited (760px) thread measure. Message width defaults to (88%) and is bounded at (75ch); the desktop preference spans (60–100%). Below (760px), navigation uses a labeled modal drawer and the conversation uses the available width. At (1000px), compact composer model metadata hides. Long dialog bodies scroll independently while actions remain reachable; connector tiles move from three columns through two to one on narrow screens. The connector mobile layout changes at (600px).

Appearance stores text size, width, density, and motion in this browser. Compact roster density uses (36px) minimum rows and (5px) vertical padding; spacious uses (56px) and (12px). Comfortable current sidebar rows are (42px). Cross-device synchronization is not implied.

## Elevation & Depth

Opaque surfaces, tonal fills, and thin separators establish depth. Menus retain a modest diffuse shadow and dialogs a broader one; the home composer has a faint shadow that strengthens on focus. Sign-in is a quiet bordered card without an enclosing shadow. The earlier user-adjustable blur and glass treatment are historical, not current guidance.

### Shadow Vocabulary

- **Home composer:** `0 3px 12px rgba(0,0,0,.035)` at rest; `0 3px 16px rgba(0,0,0,.065)` on focus.
- **Menu:** `0 10px 28px rgba(0,0,0,.12)` for floating control surfaces.
- **Dialog:** `0 18px 48px rgba(0,0,0,.18)` for the modal layer.

Menu state transitions retain their short existing timing; app motion-off and OS reduced motion suppress interface animation. The unchanged BinaryLens flips digits and sweeps its pulse only when active. QuickStart gates it by intersection, document visibility, OS reduced motion, and the saved app preference. CypherEntrance restores appearance and gates the initially hidden or reduced-motion case before mounting the unchanged CipherIntro. The intro gathers, lifts at (760ms), and completes at (1180ms); Escape and Skip intro dismiss it. Session storage makes it once per tab where available. These are the existing signature animations, not a progress meter.

**The Evidence Rule.** Animation, a catalog listing, an open consent page, and a screenshot never establish completed work or an authorized connection.

## Shapes

Controls use small, gently curved corners: select and standard input corners use the medium radius, connector tiles the card radius, and the home form the composer radius. The sign-in card uses the dialog radius. The desktop home send action remains circular at (38px), growing to (44px) on mobile. Sidebar identities are compact (28px) rounded squares. Incoming and outgoing conversation bubbles retain their directional (16px) corners with a (5px) tail corner. Keep the original wide mark free of decorative borders, orbit rings, or square clipping.

## Components

### Buttons and Inputs

Primary actions use the monochrome action and its inverse; hover may reduce opacity to (.84). Secondary controls use opaque panel surfaces and neutral borders. The global keyboard outline retains its control-specific width with neutral ink. Preserve disabled state and text labels, including visually hidden accessible names. Text inputs inherit panel color and legible text; connector search uses a neutral border and a subtle neutral focus ring.

### Selects

The existing Radix-backed select retains keyboard, typeahead, selection, and native-dialog portal behavior. Standard triggers use the select token; compact composer variants are smaller on desktop and have (44px) minimum height on mobile. Menus use opaque surfaces, a (10px) radius and (5px) padding; options use a (6px) radius and retain room for the checkmark. Selected and highlighted options use neutral fill. The component name GlassSelect is legacy implementation vocabulary, not permission to reintroduce translucent lavender styling.

### Navigation

Navigation yields space to the task: New task is prominent, actual agents and groups occupy the central list, and secondary workspace destinations remain under More. Working filters derive from actual state. Names carry identity; initials use neutral fill. Desktop layout controls retain left/right docking, keyboard resizing, collapse, and reset. Mobile uses the existing labeled drawer and dismissal behavior.

### Home Task and Brand

Render the unchanged BinaryLens canvas above one Cypher title, the working task composer, and Research/Write/Build starter choices. The model/provider and output selections remain real inputs to the backend request. Preserve pending state, error detail, task text after failure, and account-scoped tab-local drafts. Use CypherMark for navigation and sign-in: its SVG viewport references the unoptimized original `/cipher-logo.png` (2000×2000), preserving the embedded Cipher lettering and all source bytes. SHA-256: `11143e325ca3ac26ffd640e89a88fbf7fb0cd7a7a45b80a9bd7b6ced49351c69`. Dark appearance inverts display ink without changing the PNG. The sign-in card preserves Google/email authentication.

### Conversation, Appearance, Goals, and Channels

Incoming messages use a neutral surface; outgoing messages use the monochrome action and inverse text. Attachments retain their real staging, previews, removal, and media controls. Settings retain model/media/run controls, memory, and steering. Appearance offers density, text size, message width, and Interface animations, with persistent Reset appearance and Done actions; defaults remain comfortable density, (16px), (88%), and motion enabled. The old accent and blur controls are removed. Legacy saved accent values are ignored and inline action/focus overrides are removed when appearance is restored. Goals and channels keep explicit queued, running, paused, blocked, exhausted, and delivery states; credential masking and reveal/copy behavior do not establish an authenticated account.

### Connections and Permission Handoff

Connector search and catalog cards use the same neutral panel and text roles as the workspace. Actual provider images remain source-backed and are displayed in grayscale. Discovery coverage is distinct from granted access and executed tools. Provider sign-in retains the named link, Sign in → Allow/Authorize → Verify instructions, explicit check, cancellation, and recovery from blocked popups or temporary polling errors. Pending consent stays tab-local for at most ten minutes; browser-bound cookies and backend state/PKCE checks authorize completion. Returning from consent preserves the same-origin workspace and removes codes/state from the URL. A service becomes enabled only after backend tool discovery succeeds. Closing Plugins or opening a provider page does not grant access.

## Do's and Don'ts

### Do:

- Do use the final neutral palette in both light and dark surfaces, including connector chrome and navigation.
- Do preserve the original logo bytes, proportions, and embedded Cipher lettering while using Cypher for product text.
- Do use the existing binary animations with visibility and motion gates.
- Do keep keyboard focus, task errors, drafts, real run state, and provider authorization recovery visible.
- Do keep dialog actions reachable while long content scrolls.

### Don't:

- Don't restore blue, purple, lavender, or a user-selectable color accent to app-owned brand and controls.
- Don't add a graph, invented orbital logo animation, or simulated task progress to the task workspace.
- Don't make Inter a new default brand face or remove the existing conversation typeface options.
- Don't label a service connected before the backend discovers its tools or treat Sign in as an Allow grant.
- Don't claim production deployment, live provider execution, pixel fidelity, or performance superiority from local tests and synthetic captures.

<details>
<summary>Historical design record through October 23, 2026 — superseded visual directions and earlier verification limits</summary>

The archived text below is retained for implementation and validation history. Its brand name, color choices, typography defaults, dimensions, glass styling, and claims of current composition are not normative for this Cypher candidate. Earlier production results remain evidence only for the revisions and paths stated. Current product capability and verification limits remain in PRODUCT.md and deployment/VERIFICATION.md. No final verification or ship verdict for the latest Cypher correction batch is asserted here.

~~~~markdown
---
name: Open GrokBot
description: A system-style agent workspace with light and dark appearance, team conversations, multimodal input, and adjustable run controls.
colors:
  panel: "#fff"
  conversation: "#fff"
  sidebar: "#f5f5f7"
  card: "#f2f2f7"
  card-hover: "rgba(116,116,128,.12)"
  selected: "rgba(0,122,255,.12)"
  border-light: "rgba(60,60,67,.18)"
  text: "#1d1d1f"
  text-muted: "#6e6e73"
  accent-blue: "#007aff"
  outgoing: "#007aff"
  send: "#007aff"
  focus: "#007aff"
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
  system-surface: "#fff"
  dark-surface: "#2c2c2e"
  violet: "#6945c6"
  forest: "#26765f"
  slate-blue: "#324f85"
  graphite: "#404047"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif'
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.035em"
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 600
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif'
    fontSize: "16px"
    lineHeight: 1.65
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 600
rounded:
  sm: "6px"
  md: "8px"
  lg: "16px"
  full: "999px"
  roster-row: "7px"
  message: "16px"
  composer: "16px"
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
    rounded: "8px"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    rounded: "8px"
    padding: "8px 12px"
  button-round:
    backgroundColor: "{colors.panel}"
    width: "30px"
    height: "32px"
    rounded: "8px"
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
  select-trigger:
    backgroundColor: "{colors.system-surface}"
    textColor: "{colors.text}"
    rounded: "8px"
    padding: "8px 11px"
    height: "40px"
  glass-select-option:
    rounded: "6px"
    padding: "8px 10px 8px 34px"
    height: "36px"
  dialog:
    backgroundColor: "{colors.system-surface}"
    rounded: "16px"
  search-input:
    rounded: "{rounded.md}"
    padding: "10px"
---

# Design System: Open GrokBot

## Overview

The October 22 workspace uses a system-style interface with platform fonts, blue actions, a neutral sidebar, restrained separators, and a compact conversation toolbar. System appearance follows the operating system's light or dark setting. Open GrokBot keeps its own name and mark and remains a web app.

The frontmatter and current visual direction below describe the shipped composition. Earlier dated sections are preserved as implementation history; the current values supersede conflicting frame, palette, typography, bubble, sidebar, and composer descriptions. Existing product capability and verification limits remain separate from visual evidence.

### Current visual direction — Apple-native web workspace

Use the system UI font stack, platform semantic colors, an opaque sidebar and menus, one-pixel separators, clear keyboard focus, and familiar toolbar and form controls. The interface adapts to light and dark system appearance. Blue is the default action accent; browser-local accent choices remain available. Inter and Georgia remain optional conversation typefaces. The design borrows familiar macOS conventions without claiming native OS integration.

Keep the app full-bleed with an adjustable sidebar, a compact conversation toolbar, and a centered task composer. Use small control corners, subtle edges, and clear focus states. Incoming bubbles use a neutral surface; outgoing bubbles use the current accent with white text. Menus, dialogs, and selectors use opaque system surfaces instead of glass blur. Preferences retain accent, density, message size, message width, and motion settings.

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

Keep model setup one action from both the empty task composer and conversation settings. In OmniRoute mode, the owner can check the saved OpenAI, Gemini, and Claude connections, follow a fresh Google account-verification link when required, and retry a real model check. Checks continue in the worker after the dialog closes, with explicit queued, checking, verified, and failure states. API keys are password fields, encrypted on the server, and replace an existing key only after a model response succeeds. Direct mode retains the one-request Gemini test and provider setup links. These checks do not imply that consumer subscriptions or every provider are connected.

Provider rows use the same native system surfaces and compact controls as the workspace. Keep the provider name and verification state visible, wrap actions on narrow screens, and maintain accessible focus and minimum touch targets. Show the last check time and failure details as text; never imply that opening a verification link marks the connection verified.

## Plugin authorization consistency — October 23, 2026

Preserve the current Operate interface. All browser sign-ins use one permission handoff with a named provider link, clear Sign in → Allow/Authorize → Verify instructions, an explicit connection check and cancellation. A blocked or closed popup leaves the workspace available. Pending consent is retained in tab-local session storage for at most ten minutes; browser-bound HttpOnly cookies and the existing backend state/PKCE checks still authorize completion. Closing Plugins keeps provider sign-in available. Temporary polling failures retry and resume when the user returns; opening the provider page never marks a connection successful.

Callbacks retain the same-origin workspace/conversation and remove provider codes and state from the return URL. Restoring a conversation does not dismiss the permission result panel. Managed and direct denials both report cancellation. The existing optional Inter conversation font is retained; its documented use has a value-specific detector exception. Sixteen controlled flow and callback regression tests and the production build pass. Browser fixture checks and live deployment evidence are recorded separately from real provider grants.
~~~~
</details>


## Plugin motion refinement — October 23, 2026

The plugin surface stays Operate and monochrome. Prefer compact list rows to elevated service cards, show account connections first, and put secondary management under disclosure. Original binary motion remains the signature; fast overlays, a moving tab underline, capped list arrivals and tactile controls explain interaction. Respect both OS reduced motion and the saved app preference. Callback registration failures reveal a bounded own-client setup form without printing a long callback error banner or claiming access. See verification/plugin-motion-release.md for exact evidence and provider limits.

## Reference composition — October 24, 2026

The supplied Claude Cipher artifact is the visual authority for this refinement. Preserve its pale gray canvas, original animated BinaryLens, large single wordmark, restrained controls and generous space. QuickStart uses a 620px task form with a white, lightly divided input area and a separate full-width black pill action. Keep the working model/output choices, recent work and accessible collapsible navigation. The Google service chooser belongs to the same visual world: simple permission rows, original CypherMark, and one clear continuation to Google. Preserve the original PNG bytes and visibility/reduced-motion gates.


## VentureCruiter release · October 24, 2026

Operate refinement: warm off-white canvas (`#f7f7f5`), graphite ink (`#242423`), pale neutral navigation, original binary lens, and existing dark appearance. The home wordmark is 40–52px with one 620px composer. Model, output, and a labeled Start task share its footer; voice is a quiet text action below. Prospecting and Connect tools remain directly accessible; advanced workspace functions stay under More. Controls retain keyboard focus and mobile touch targets. Repeated staggered entrances, decorative pulsing, and navigation movement are removed. The original intro and binary lens remain, with OS and saved reduced-motion settings respected. No new brand assets or functional claims were introduced.
