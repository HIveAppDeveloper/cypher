---
name: Open GrokBot
description: A light agent workspace with team conversations, multimodal input, and adjustable run controls.
colors:
  panel: "#fff"
  conversation: "#fdfdfd"
  sidebar: "#f5f5f5"
  card: "#efefef"
  card-hover: "#e4e4e4"
  selected: "#e5e5e5"
  border-light: "#e6e6e6"
  text: "#202020"
  text-muted: "#696969"
  accent-blue: "#c6227b"
  outgoing: "#c5237b"
  send: "#d52686"
  focus: "#b51f70"
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
typography:
  display:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(25px,2.7vw,36px)"
    fontWeight: 500
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
    fontSize: "18px"
    lineHeight: 1.5
  label:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 600
rounded:
  sm: "6px"
  md: "12px"
  lg: "24px"
  full: "999px"
  roster-row: "15px"
  message: "27px"
  composer: "36px"
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
    rounded: "18px"
    padding: "10px 18px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    rounded: "18px"
    padding: "10px 18px"
  button-round:
    backgroundColor: "{colors.panel}"
    width: "43px"
    height: "43px"
    rounded: "50%"
  message-incoming:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.message}"
    padding: "12px 16px"
  message-outgoing:
    backgroundColor: "{colors.outgoing}"
    textColor: "{colors.panel}"
    rounded: "{rounded.message}"
    padding: "12px 16px"
  team-member-chip:
    backgroundColor: "{colors.member-chip}"
    rounded: "20px"
    padding: "3px 8px"
  search-input:
    rounded: "{rounded.md}"
    padding: "10px"
---

# Design System: Open GrokBot

## Overview

The implemented interface follows the supplied light GrokBot reference: a quiet gray roster beside a near-white conversation, with pink outgoing messages and organic colored bot marks. Rounded forms and restrained chrome keep names, message content, and the active identity prominent. The workspace now opens on a task-first prompt, with role presets, named models, team rooms, attachment input, and compact run controls. Configuration is progressively disclosed while preserving the same light visual system.

This document records the current CSS and React components, rather than claiming a pixel-exact screenshot match. The root Vercel Services and Daemon configuration is active and the authorized Atlas native database credential is configured. At this checkpoint deployment revision f2e345 is building; live runtime success is not established. Fifteen mocked-backend tests and a production frontend build passed, but do not establish live database, worker, provider, media, MCP, or sandbox operation. The interface must distinguish configuration from verified execution. Visible empty and error states remain part of the interface.

**Key Characteristics:**
- Light neutral surfaces with a pink messaging accent.
- A compact identity pill and organic two-stroke bot avatars.
- Rounded messages, restrained borders, and a persistent composer.
- A desktop roster that becomes a narrow vertical rail on small screens.

## Colors

### Primary

Pink is the messaging accent. The legacy `accent-blue` token is pink despite its name; preserve the source name when referencing the CSS. Outgoing bubbles, send controls, focus outlines, and the owner avatar use closely related but distinct implemented pink values. They are not a consolidated single accent token.

### Neutral

White panels, near-white conversation, a light-gray sidebar, and gray incoming bubbles create the hierarchy. Dark text anchors names; muted text identifies previews and secondary actions. The selected roster row uses a gray fill. Runtime notices use a very pale pink surface with a muted mauve message and border.

Status green and red exist as CSS primitives; their presence does not establish a visible live-status system. Bot avatars choose deterministically from pink, red, black, teal, purple, brown, and orange in `BotAvatar.tsx`.

## Typography

Use self-hosted Inter Variable with the system fallbacks in the frontmatter. The workspace label is compact and semibold; bot names and identity labels use medium weight. Conversation text is larger and comfortably spaced. Timestamps are deliberately secondary at (11px).

The empty-state heading uses the headline role; dialog headings use (24px) at medium weight. At the mobile breakpoint, message and composer text shrink to (15px), identity labels to (15px), and empty-state headings to (22px). Inter Variable is bundled locally rather than loaded from an external font service. The main panel can switch to System (`system-ui, sans-serif`) or Georgia (`Georgia, serif`), while the sidebar retains Inter. The current QuickStart heading uses `clamp(25px,2.7vw,36px)`, medium weight, (1.2) line height, and (-.035em) tracking; its mobile size is (25px). A monospace primitive exists for tool-oriented content but does not replace conversation typography.

## Layout

The app fills the dynamic viewport height with a non-scrolling outer flex layout; roster and message stream scroll independently. Desktop sidebar width is (27%), bounded by (270px) minimum and (380px) maximum, with (8px) internal padding and a hairline right divider. The conversation takes remaining width with a shrinking minimum of zero.

A persistent (54px) toolbar introduces workspace context and the Controls disclosure above the welcome or conversation area. The conversation header is (75px) high with a centered identity pill. The message stream has (12px 24px 30px) padding and (18px) gaps. Messages fit their content, up to (84%) width; outgoing messages align right, incoming left. Tool messages can reach (94%). The composer sits below the stream with (12px 22px 16px) margins and (10px) internal gap.

At viewport widths of (700px) or less, the sidebar becomes a (90px) vertical rail with (6px) padding. Workspace name, bot preview text, and workspace label hide; avatar navigation and controls remain. Empty-roster prose is also hidden on mobile while the create-plus control remains available. Header height becomes (65px), stream padding (12px), message maximum width (95%), and composer margin (8px). The fixed runtime notice adjusts its left inset at this breakpoint and at the wide-sidebar cap (1408px). Its final desktop bottom offset is (20px), mobile (12px), with maximum width (760px); it remains an overlay rather than a flex-column item.

The declared spacing scale is reusable, but the incumbent implementation also uses component-specific measurements; do not imply every gap is a scale multiple.

## Elevation & Depth

Most surfaces are flat and separated by tone or a fine border. The identity pill and composer receive faint shadows: identity (`0 2px 12px #00000009`) and composer (`0 2px 7px #0000000a`). Preserve this low-contrast hierarchy; the roster does not float above the conversation.

No animated transitions are declared in the global stylesheet. Reduced-motion preference forces automatic scroll behavior.

## Shapes

The recurring language is soft and rounded: message bubbles, capsule labels, a broad composer, and circular icon controls. Actual component radii include roster rows (15px), general action buttons (18px), messages (27px), workspace labels and tool containers (28px), composer (36px), and identity pill (40px). Use the extracted primitives where they already apply rather than forcing every component onto one radius.

Bot marks are organic inline SVG silhouettes with two short white strokes, not circular letter avatars. The owner avatar is a separate circular initial badge.

## Components

### Buttons

Primary actions use white text on outgoing pink with (10px 18px) padding and rounded edges. Secondary actions are white with a fine gray border. Toolbar buttons are circular, bordered white controls with (22px) stroke icons; their desktop footprint is (43px) and mobile footprint (33px). Toolbar hover is light gray. Disabled buttons retain their form at (0.45) opacity and use the default cursor. Global focus-visible uses a (2px) pink outline offset by (3px).

### Navigation

Each roster row pairs a (46px) organic avatar with a name and a single-line ellipsized preview. Rows use (13px 10px) padding and (10px) gaps. Hover and selected rows share a gray background. Mobile rows hide text, center the avatar, and use (42px) marks. Identity-pill avatars are (30px), shrinking to (26px) on mobile.

### Cards / Containers

Incoming messages use the gray card surface; outgoing messages use pink and white text. Both preserve whitespace and wrap long content. Tool-message containers use white, a fine border, muted text, and a wider maximum width. Timestamps sit beneath each bubble; outgoing timestamps align right. The centered identity pill uses white and the faint identity shadow.

### Inputs / Fields

Roster search has a light border, rounded corners, (10px) padding, and a width inset from its parent. General form fields use (10px 12px) padding and (10px) corners. The composer groups a borderless, transparent textarea with a (40px) pink send circle inside a white bordered capsule. The textarea has a (24px) line height and maximum height (150px). Enter sends; Shift+Enter adds a line. The attachment plus opens the file picker. Send remains disabled until a conversation and either text or attachments are available, or while sending.

The composer textarea restores a visible keyboard-focus outline in focus pink at (2px), offset by (2px), with (8px) corners. Preserve this explicit treatment alongside the global control focus rule.

### Bot Creation Dialog

A native dialog uses a white surface, fine gray border, (20px) corners, and (30px) desktop padding ((24px) mobile). Width is capped at (480px), with (32px) total viewport clearance; maximum height is the dynamic viewport minus (32px), with internal scrolling. The translucent black backdrop (`#0005`) creates the modal layer. In agent creation, the title and introduction stay outside the scrolling form fields. The bounded form uses a shrinking, independently scrolling field region, while its white action footer remains visible with a fine top divider, (16px) top padding, and (12px) top margin. This preserves Cancel and Create agent on small screens. Other native dialogs retain their bounded whole-dialog scroll. Dialog titles now use (26px) medium text with (-.035em) tracking. Labels use (14px) text, and action buttons align right with (10px) gaps.

### QuickStart Task Workspace

The default home centers a (60px) organic bot mark, a compact question headline, muted supporting copy, and one task form. The form is at most (640px) wide, with (22px) corners, (16px) padding, a fine border, and faint shadow. Its three-line textarea uses (16px/1.6) text. Focus within shifts the enclosing border to muted pink (`#b788a0`); the textarea itself has no separate outline. The form footer combines a quiet gray native output menu with a pink Start task button and arrow icon. The menu offers Ask anything, Create an image, and Create a video, changing the prompt placeholder accordingly.

Small outlined starter chips populate the prompt without submitting it. Agent and team shortcuts sit below as understated text actions. A short footnote names the runtime dependency and media credits. Submission errors retain the actual failure detail and keep the task text available. The output select sizes to its content with a bounded width; Start task and its icon do not shrink or wrap. On mobile, the form radius becomes (17px), padding (11px), and textarea text (14px); the home has (30px 16px 110px) padding. Do not replace this prompt-first home with the older two-action welcome.

### Team Room Navigation and Picker

Uppercase section labels use (11px) type and (.05em) tracking. Team rooms use a muted mauve rounded-square identity tile (46px), shrinking to (40px) on mobile. The room dialog uses the same native modal as bot creation, with soft-gray selectable agent rows, small role descriptions, and pink-accent native (18px) checkboxes. Select 2–6 agents; selected members appear as compact gray chips with (20px) avatars above the stream. These member chips convey identity rather than a filter state.

### Agent Presets, Models, and Tools

GPT-6.1 Sol is the main default. Agent creation begins with a role-preset select and an optional name. Blank names receive a safe available default such as Assistant or Assistant 2; an explicit duplicate name returns a visible validation error. Presets supply instructions, so the default flow does not require authoring a system prompt. Native Provider and Model menus expose named choices for Gemini, OpenAI, and Anthropic, with muted model-access help. Keep raw model identifiers behind Customize this agent and its Use a custom model checkbox. That advanced disclosure also contains editable instructions and four human-readable tool categories: browsing, code, files, and image/video generation. DeepSeek, Ollama, and compatible-provider entry belong to the custom configuration.

Advanced sections use a fine top divider, compact (13px) medium summary text, and a plus/minus indicator. Optional labels and helper copy remain small and gray. OpenAI adds a three-stop Model power slider with Everyday, Reasoning, and Advanced outputs; eligible models expose five Thinking effort stops from none through xhigh. Processing speed offers Economy, Standard, and Fast priority processing with cost and availability help. Range controls use pink accents, (22px) height, compact labels, right-aligned outputs, and small endpoint descriptions. These choices configure requests; they do not prove access or guarantee response speed.

### Run Controls

A native details/summary disclosure opens a right-aligned white popover with fine border, (16px) corners, (20px) padding, and desktop width (300px). Its content is bounded to the viewport minus (92px), scrolls internally, and contains overscroll. Mobile width is `min(280px,calc(100vw - 110px))`, with bounded scrolling. It combines a response-style select, pink-accent native range sliders, right-aligned numerical outputs, and a typeface select. Temperature spans (0–1.5), response length (256–8192) tokens, tool steps (1–25), and team-only rounds (1–4). Defaults are (0.5), (2048), (10), and (1). Run settings apply to the next submitted job; the typeface changes the main-panel presentation immediately.

### Attachments and Job Tray

The composer accepts up to four files and (3 MB) combined: PNG/JPEG/WebP images, PDFs, UTF-8 text, MP3, and WAV. Selected attachments appear in wrapping soft-gray chips with filenames, removal actions, and (36px) image thumbnails. Sent image previews are bounded to (320px) height with (16px) corners; other files use outlined links with (9px) corners. Provider compatibility remains visible in a small note below the composer. Audio input means uploaded files; this interface does not provide recording or video input.

A compact disclosure above the composer shows active work or recent work, up to six job rows, with ellipsized titles and text statuses. Running is warm amber, completed green, and failed red. Tool output uses a disclosure with scroll-bounded monospace content at (12px/1.6); it does not dominate ordinary conversation text. Status labels remain readable independently of their colors.

### Workspace Setup and Media Output

Workspace setup reuses the bounded native dialog. A gray connection card pairs a small amber dot with explicit checking or disconnected text; a green dot accompanies API/database reachability, while explicit text distinguishes a recent worker heartbeat from an API whose worker is not ready. Supporting copy distinguishes those signals from model and tool readiness. A short ordered setup list and an optional deployment-guide disclosure keep the first view readable. Check again and Done use the established secondary and primary actions. The active managed worker configuration is not by itself evidence of verified laptop-independent execution.

Conversation output controls use small gray native selects for text, image, or video and relevant media options, with concise credit-cost guidance. Rendered videos use browser controls in a rounded (14px) container, at most (480px) wide and (420px) high. The Python media-generation implementation exists, but live media generation is unverified in this environment; no sample media or progress display should imply a completed provider call.

### Connections and Work Status

Connections reuses the bounded modal with scrolling fields and a persistent footer. Two compact tabs separate MCP servers and Vercel variables; the active tab uses a pale mauve fill (`#f0e7ed`) and dark pink text (`#8f275d`). MCP rows use fine dividers, compact names, tool counts, expandable descriptions, an Enabled/Disabled pill, and a small disconnect action. Enabled switches use muted green ink (`#286347`) on pale green (`#e5eee8`). The password field accepts an optional bearer token; explanatory text describes encrypted storage and the scope of enabled tools.

The variable inventory shows names, project labels, and Configured/Needs link states in divided rows, never secret values. Keep these statuses textual. The current inventory of 177 names and eight imported values is deployment context, not an enduring visual token or evidence that a service works. The sidebar Connections action collapses to its icon on mobile.

Agent lounge displays six distinct member identities and coordinator/specialist contributions using the existing room, sender-label, and message patterns. Job rows include a compact pink cancellation action. Keep cancellation-requested, cancelled, interrupted, failed, and completed labels truthful; a cancellation does not imply rollback of completed external actions.

### Runtime Notice

Connection errors appear as readable alerts; the roster-level notice is fixed over the conversation and offset for the sidebar. Preserve the very pale pink surface, fine border, and compact (12px) text. Never substitute successful mock conversation content for an unavailable runtime.

## Do's and Don'ts

### Do:

- Do preserve the light surface hierarchy and pink outgoing-message treatment.
- Do retain the organic SVG bot identity with two white strokes.
- Do keep visible empty, disabled, and error states truthful to runtime behavior.
- Do preserve keyboard labels and visible focus on supported controls.
- Do lead with the task prompt and named choices, keeping custom IDs and instructions in advanced configuration.

### Don't:

- Don't turn screenshot text into real conversation data.
- Don't describe the implementation as pixel exact, backend verified, media verified, or an active always-on cloud service.
- Don't replace the mobile vertical rail with a top roster without an intentional layout change.
