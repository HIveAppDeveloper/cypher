---
name: Open GrokBot
description: A light messaging workspace with a quiet roster and expressive bot identities.
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
  notice-surface: "#fff5f8"
  notice-border: "#e4b4c9"
  notice-text: "#8b204d"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "27px"
    fontWeight: 500
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    lineHeight: 1.5
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
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
  search-input:
    rounded: "{rounded.md}"
    padding: "10px"
---

# Design System: Open GrokBot

## Overview

The implemented interface follows the supplied light GrokBot reference: a quiet gray roster beside a near-white conversation, with pink outgoing messages and organic colored bot marks. Rounded forms and restrained chrome keep names, message content, and the active identity prominent.

This document records the current CSS and React components, rather than claiming a pixel-exact screenshot match. No backend is connected in the reviewed environment; model behavior has only been exercised through mocked tests. Visible empty and error states remain part of the interface.

**Key Characteristics:**
- Light neutral surfaces with a pink messaging accent.
- A compact identity pill and organic two-stroke bot avatars.
- Rounded messages, restrained borders, and a persistent composer.
- A desktop roster that becomes a narrow vertical rail on small screens.

## Colors

### Primary

Pink is the messaging accent. The legacy `accent-blue` token is pink despite its name; preserve the source name when referencing the CSS. Outgoing bubbles, send controls, focus outlines, and the owner avatar use closely related but distinct implemented pink values. They are not a consolidated single accent token.

### Neutral

White panels, near-white conversation, a light-gray sidebar, and gray incoming bubbles create the hierarchy. Dark text anchors names; muted text identifies previews and secondary actions. The selected roster row uses a gray fill. Runtime notices use a pale pink surface with a darker readable message.

Status green and red exist as CSS primitives; their presence does not establish a visible live-status system. Bot avatars choose deterministically from pink, red, black, teal, purple, brown, and orange in `BotAvatar.tsx`.

## Typography

Use the system sans stack in the frontmatter. The workspace label is compact and semibold; bot names and identity labels use medium weight. Conversation text is larger and comfortably spaced. Timestamps are deliberately secondary at (11px).

The empty-state heading uses the headline role; dialog headings use (24px) at medium weight. At the mobile breakpoint, message and composer text shrink to (15px), identity labels to (15px), and empty-state headings to (22px). There is no external display font. A monospace primitive exists for tool-oriented content but does not replace conversation typography.

## Layout

The app fills the dynamic viewport height with a non-scrolling outer flex layout; roster and message stream scroll independently. Desktop sidebar width is (27%), bounded by (270px) minimum and (380px) maximum, with (8px) internal padding and a hairline right divider. The conversation takes remaining width with a shrinking minimum of zero.

The conversation header is (75px) high with a centered identity pill. The message stream has (12px 24px 30px) padding and (18px) gaps. Messages fit their content, up to (84%) width; outgoing messages align right, incoming left. Tool messages can reach (94%). The composer sits below the stream with (12px 22px 18px) margins and (10px) internal gap.

At viewport widths of (700px) or less, the sidebar becomes a (90px) vertical rail with (6px) padding. Workspace name, bot preview text, and workspace label hide; avatar navigation and controls remain. Empty-roster prose is also hidden on mobile while the create-plus control remains available. Header height becomes (65px), stream padding (12px), message maximum width (95%), and composer margin (8px). The fixed runtime notice adjusts its left inset at this breakpoint and at the wide-sidebar cap (1408px).

The declared spacing scale is reusable, but the incumbent implementation also uses component-specific measurements; do not imply every gap is a scale multiple.

## Elevation & Depth

Most surfaces are flat and separated by tone or a fine border. Only the identity pill and composer receive faint shadows: identity (`0 2px 12px #00000009`) and composer (`0 2px 7px #0000000a`). Preserve this low-contrast hierarchy; the roster does not float above the conversation.

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

Roster search has a light border, rounded corners, (10px) padding, and a width inset from its parent. General form fields use (10px 12px) padding and (10px) corners. The composer groups a borderless, transparent textarea with a (40px) pink send circle inside a white bordered capsule. The textarea has a (24px) line height and maximum height (150px). Enter sends; Shift+Enter adds a line. Send remains disabled until content and a conversation are available or while sending.

The composer textarea restores a visible keyboard-focus outline in focus pink at (2px), offset by (2px), with (8px) corners. Preserve this explicit treatment alongside the global control focus rule.

### Bot Creation Dialog

A native dialog uses a white surface, fine gray border, (20px) corners, and (28px) padding. Width is capped at (500px), with (32px) total viewport clearance; maximum height is the dynamic viewport minus (32px), with internal scrolling. The translucent black backdrop (`#0005`) creates the modal layer. Labels use (14px) text, and action buttons align right with (10px) gaps.

### Runtime Notice

Connection errors appear as readable alerts; the roster-level notice is fixed over the conversation and offset for the sidebar. Preserve the pale pink surface, fine border, and compact (13px) text. Never substitute successful mock conversation content for an unavailable runtime.

## Do's and Don'ts

### Do:

- Do preserve the light surface hierarchy and pink outgoing-message treatment.
- Do retain the organic SVG bot identity with two white strokes.
- Do keep visible empty, disabled, and error states truthful to runtime behavior.
- Do preserve keyboard labels and visible focus on supported controls.

### Don't:

- Don't turn screenshot text into real conversation data.
- Don't describe the implementation as pixel exact or backend verified.
- Don't replace the mobile vertical rail with a top roster without an intentional layout change.
