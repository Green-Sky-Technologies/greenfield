# Story 0.3: can Claude draw? FigCraft commands vs HTML frames

Model `claude-sonnet-5-5` via gateway-oidc, same model for both arms. Generated 2026-11-24T16:34:33.178Z.

## Summary

Tokens are totals over the 6 cases; turns and wall time are per-case means.

| Arm / variant | Pass | Input (uncached) | Cache read | Cache write | Output | Est. cost | Turns | Wall |
|---|---|---|---|---|---|---|---|---|
| HTML frame (current agent) | 6/8 | 54 | 568972 | 14666 | 16425 | $0.3148 | 2.4 | 12.2 s |
| FigCraft `v2` | 8/8 | 78 | 398846 | 36510 | 14455 | $0.3158 | 3.9 | 15.1 s |

<details><summary>Method, adaptations and fixture gaps</summary>

- **Cases**: `evals/golden/interactive.json` (6 prompts on the `landing` fixture), same prompt text,
  selection and scope for both arms.
- **HTML arm**: the current interactive agent run as `packages/agent/src/evals/harness.ts` does
  (prefix, turn context, memory host with scope enforcement), rendered with `@crunch/renderer`'s
  static HTML in headless Chromium at 1280 px.
- **FigCraft arm**: headless `figcraft-cli mcp` (v0.18.1), fixture rebuilt with one `batch`
  (`spikes/0.3-agent/src/figcraft/fixture.ts`); each layer is named after its HTML node id. Same
  request shape (adaptive thinking, medium effort, cached prefix, automatic conversation
  breakpoint) and the same `suggest_generation_job` tool. Render = the `screenshot` tool (CPU
  renderer); `ui.render` is browser-only.
- **Touched layers** (FigCraft): layers named in mutating command params, plus a document diff
  that ignores layout-derived geometry (x/y, and width/height on hug/fill axes). Button label
  layers count as their button (the HTML Button is one instance node). Scoped requests are
  enforced like the HTML host: an out-of-scope edit is undone and returned as a tool error.
- **lintClean** (FigCraft): no ds-lint for layers, so touched layers are checked for off-token
  values (colours, font sizes, radii, gap/padding not in the token scales given in the prompt).
- **Not comparable**: the HTML agent also has `create_slider` and `ask_questions`; the FigCraft
  arm has neither (density-slider can only be an edit there).
- **Fixture gaps**: tokens are literal values (no variables/styles); the Button is a plain
  auto-layout frame, not a component instance; no responsive breakpoints (desktop/lg only);
  no semantic tags; `ch` max-widths approximated in px; grid cards hug instead of stretching
  to equal height; Inter isn't installed, so both arms fall back to SF Pro (Chromium picks the
  SF Text/Display optical size, so wrapping differs slightly).
</details>

## alternatives-offers-job

> What would this page look like with a completely different layout? I'd like to compare a few.

| Arm | Result | Turns | In | Cache r | Cache w | Out | Wall | Touched |
|---|---|---|---|---|---|---|---|---|
| HTML frame | **fail**: job suggestion: expected alternatives, got null | 1 | 4 | 27993 | 0 | 581 | 4.6 s | – |
| FigCraft `v2` | pass | 2 | 6 | 16070 | 326 | 393 | 5.0 s | – · job: alternatives |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/alternatives-offers-job/html.png) | ![v2](v2/alternatives-offers-job/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I haven't changed your page. Comparing several layouts means generating new frames, so I've offered a background job that makes three alternatives of the page. They would be a split hero, a centered hero with a feature grid, and alternating feature rows. All three would use your current copy and design tokens. Start the job if you want to compare them.",
 "commands": []
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I can set up a few layout alternatives to compare. First I need to know what direction you want.",
 "commits": [],
 "notes": [
  "turn ended on ask_questions"
 ]
}
```
</details>

## button-larger-scoped

> Make this button larger.

| Arm | Result | Turns | In | Cache r | Cache w | Out | Wall | Touched |
|---|---|---|---|---|---|---|---|---|
| HTML frame | pass | 2 | 6 | 55765 | 0 | 473 | 4.4 s | n_herocta001 |
| FigCraft `v2` | pass | 2 | 6 | 15569 | 0 | 231 | 3.4 s | n_herocta001 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/button-larger-scoped/html.png) | ![v2](v2/button-larger-scoped/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I made the button larger. I raised the padding from 8/16 to 16/32 and the label size from 14 to 18. The fill, 8px corner radius and Semibold weight are unchanged. I rendered it and it looks right.",
 "commands": [
  {
   "command": "node.set",
   "params": {
    "id": 10,
    "padding": [
     16,
     32,
     16,
     32
    ],
    "cornerRadius": 8
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 11,
    "fontSize": 18
   }
  }
 ]
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I made the CTA button larger. I increased its padding to 1rem on top and bottom and 2rem on the sides, and raised the font size to 1.125rem. I used design tokens for all of these, and the lint check found no issues.",
 "commits": [
  {
   "ops": [
    {
     "op": "setStyle",
     "id": "n_herocta001",
     "breakpoint": "base",
     "prop": "paddingTop",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_herocta001",
     "breakpoint": "base",
     "prop": "paddingBottom",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_herocta001",
     "breakpoint": "base",
     "prop": "paddingLeft",
     "value": {
      "token": "space.8"
     }
    },
    {
     "op": "setStyle",
     "id": "n_herocta001",
     "breakpoint": "base",
     "prop": "paddingRight",
     "value": {
      "token": "space.8"
     }
    },
    {
     "op": "setStyle",
     "id": "n_herocta001",
     "breakpoint": "base",
     "prop": "fontSize",
     "value": {
      "token": "text.lg"
     }
    }
   ],
   "label": "Make CTA button larger"
  }
 ]
}
```
</details>

## density-slider

> Give me a control to adjust how dense the feature cards are.

| Arm | Result | Turns | In | Cache r | Cache w | Out | Wall | Touched |
|---|---|---|---|---|---|---|---|---|
| HTML frame | pass | 2 | 6 | 59368 | 1761 | 1735 | 12.1 s | – |
| FigCraft `v2` | pass | 2 | 6 | 21208 | 3040 | 1669 | 12.5 s | new:22, new:23, new:24, new:25, new:26, new:27, new:28, new:29, new:30 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/density-slider/html.png) | ![v2](v2/density-slider/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I added a \"Density\" segmented control above the feature cards, with Compact, Comfortable and Spacious options. Comfortable is selected, which matches the current card spacing. The render looks right.\n\nIt only looks like a control for now. Clicking the options doesn't resize the cards, because nothing is wired to them. To make it work, you'd need to add interactions or variants that change the card padding and gap. I can set that up if you want.",
 "commands": [
  {
   "command": "node.create",
   "as": "row",
   "params": {
    "type": "frame",
    "parent": 12,
    "index": 0,
    "name": "n_density0001",
    "props": {
     "layout": "horizontal",
     "gap": 12,
     "crossAlign": "center",
     "mainAlign": "min",
     "sizingH": "fill",
     "sizingV": "hug",
     "fill": "none",
     "gridColumn": 0,
     "gridRow": 0,
     "gridColumnSpan": 3,
     "paddingBottom": 8
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "row"
    },
    "name": "n_density_label",
    "text": "Density",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Medium",
     "fontSize": 14,
     "fill": "#6B6B70"
    }
   }
  },
  {
   "command": "node.create",
   "as": "seg",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "row"
    },
    "name": "n_density_seg",
    "props": {
     "layout": "horizontal",
     "gap": 4,
     "padding": 4,
     "crossAlign": "center",
     "sizingH": "hug",
     "sizingV": "hug",
     "fill": "#F6F6F4",
     "cornerRadius": 9999,
     "stroke": "#E4E4E7",
     "strokeWeight": 1
    }
   }
  },
  {
   "command": "node.create",
   "as": "o1",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "seg"
    },
    "name": "n_density_compact",
    "props": {
     "layout": "horizontal",
     "padding": [
      8,
      16,
      8,
      16
     ],
     "mainAlign": "center",
     "crossAlign": "center",
     "sizingH": "hug",
     "sizingV": "hug",
     "fill": "none",
     "cornerRadius": 9999
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "o1"
    },
    "name": "n_density_compact_label",
    "text": "Compact",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Medium",
     "fontSize": 14,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "as": "o2",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "seg"
    },
    "name": "n_density_comfortable",
    "props": {
     "layout": "horizontal",
     "padding": [
      8,
      16,
      8,
      16
     ],
     "mainAlign": "center",
     "crossAlign": "center",
     "sizingH": "hug",
     "sizingV": "hug",
     "fill": "#4F46E5",
     "cornerRadius": 9999
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "o2"
    },
    "name": "n_density_comfortable_label",
    "text": "Comfortable",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 14,
     "fill": "#FFFFFF"
    }
   }
  },
  {
   "command": "node.create",
   "as": "o3",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "seg"
    },
    "name": "n_density_spacious",
    "props": {
     "layout": "horizontal",
     "padding": [
      8,
      16,
      8,
      16
     ],
     "mainAlign": "center",
     "crossAlign": "center",
     "sizingH": "hug",
     "sizingV": "hug",
     "fill": "none",
     "cornerRadius": 9999
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "o3"
    },
    "name": "n_density_spacious_label",
    "text": "Spacious",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Medium",
     "fontSize": 14,
     "fill": "#18181B"
    }
   }
  }
 ]
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I added a \"Card spacing\" slider. It controls the padding inside each feature card, the gap between the title and body text, and the gap between cards. Low values give compact cards and high values give airy ones. I haven't checked how it looks on the canvas.\n\nThe slider sets literal pixel values rather than design-system spacing tokens, so the cards will stop using tokens for spacing once you move it.",
 "commits": [
  {
   "ops": [
    {
     "op": "upsertSlider",
     "slider": {
      "id": "s_cardspace1",
      "label": "Card spacing",
      "min": 0,
      "max": 1,
      "step": 0.05,
      "value": 0.5,
      "bindings": [
       {
        "target": {
         "nodeId": "n_features01",
         "prop": "gap",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 8,
         "to": 32,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat1card00",
         "prop": "paddingTop",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat1card00",
         "prop": "paddingBottom",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat1card00",
         "prop": "paddingLeft",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat1card00",
         "prop": "paddingRight",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat1card00",
         "prop": "gap",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 4,
         "to": 16,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat2card00",
         "prop": "paddingTop",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat2card00",
         "prop": "paddingBottom",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat2card00",
         "prop": "paddingLeft",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat2card00",
         "prop": "paddingRight",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat2card00",
         "prop": "gap",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 4,
         "to": 16,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat3card00",
         "prop": "paddingTop",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat3card00",
         "prop": "paddingBottom",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat3card00",
         "prop": "paddingLeft",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat3card00",
         "prop": "paddingRight",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 12,
         "to": 40,
         "unit": "px"
        }
       },
       {
        "target": {
         "nodeId": "n_feat3card00",
         "prop": "gap",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 4,
         "to": 16,
         "unit": "px"
        }
       }
      ],
      "pinned": false,
      "createdBy": "agent"
     }
    }
   ],
   "label": "Add slider “Card spacing”"
  }
 ]
}
```
</details>

## feature-cards-spacing

> Tighten the spacing in the features section a bit.

| Arm | Result | Turns | In | Cache r | Cache w | Out | Wall | Touched |
|---|---|---|---|---|---|---|---|---|
| HTML frame | pass | 2 | 6 | 60305 | 0 | 923 | 6.0 s | n_features01, n_feat1card00, n_feat2card00, n_feat3card00 |
| FigCraft `v2` | pass | 2 | 6 | 21202 | 931 | 636 | 6.3 s | n_features01, n_feat1card00, n_feat2card00, n_feat3card00 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/feature-cards-spacing/html.png) | ![v2](v2/feature-cards-spacing/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I tightened the spacing in the features section, and the render looks fine. I changed three things:\n- **Card spacing:** the gap between the cards went from 16px to 12px.\n- **Section padding:** the bottom padding went from 64px to 48px.\n- **Card text:** the gap between each card's title and body went from 8px to 4px.\n\nI left the cards' inner padding at 24px. Say so if you want it tighter too.",
 "commands": [
  {
   "command": "node.set",
   "params": {
    "id": 12,
    "gap": 12,
    "padding": [
     0,
     24,
     48,
     24
    ]
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 13,
    "gap": 4
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 16,
    "gap": 4
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 19,
    "gap": 4
   }
  }
 ]
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I tightened the spacing in the features section:\n\n- **Gap between cards:** `space.4` → `space.3`.\n- **Section bottom padding:** `space.16` → `space.12`.\n- **Card padding:** `space.6` → `space.4` on all three cards.\n\nI didn't run the lint check on these edits.",
 "commits": [
  {
   "ops": [
    {
     "op": "setStyle",
     "id": "n_features01",
     "breakpoint": "base",
     "prop": "gap",
     "value": {
      "token": "space.3"
     }
    },
    {
     "op": "setStyle",
     "id": "n_features01",
     "breakpoint": "base",
     "prop": "paddingBottom",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat1card00",
     "breakpoint": "base",
     "prop": "paddingTop",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat1card00",
     "breakpoint": "base",
     "prop": "paddingBottom",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat1card00",
     "breakpoint": "base",
     "prop": "paddingLeft",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat1card00",
     "breakpoint": "base",
     "prop": "paddingRight",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat2card00",
     "breakpoint": "base",
     "prop": "paddingTop",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat2card00",
     "breakpoint": "base",
     "prop": "paddingBottom",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat2card00",
     "breakpoint": "base",
     "prop": "paddingLeft",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat2card00",
     "breakpoint": "base",
     "prop": "paddingRight",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat3card00",
     "breakpoint": "base",
     "prop": "paddingTop",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat3card00",
     "breakpoint": "base",
     "prop": "paddingBottom",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat3card00",
     "breakpoint": "base",
     "prop": "paddingLeft",
     "value": {
      "token": "space.4"
     }
    },
    {
     "op": "setStyle",
     "id": "n_feat3card00",
     "breakpoint": "base",
     "prop": "paddingRight",
     "value": {
      "token": "space.4"
     }
    }
   ],
   "label": "Tighten features spacing"
  }
 ]
}
```
</details>

## headline-copy

> Change this headline to 'Design at the speed of thought'.

| Arm | Result | Turns | In | Cache r | Cache w | Out | Wall | Touched |
|---|---|---|---|---|---|---|---|---|
| HTML frame | pass | 2 | 6 | 56532 | 0 | 159 | 2.3 s | n_herotitle1 |
| FigCraft `v2` | pass | 3 | 8 | 25810 | 0 | 171 | 3.2 s | n_herotitle1 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/headline-copy/html.png) | ![v2](v2/headline-copy/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I changed the headline to \"Design at the speed of thought\". In the render it now wraps onto two lines, and the styling is unchanged.",
 "commands": [
  {
   "command": "text.set",
   "params": {
    "id": 8,
    "characters": "Design at the speed of thought"
   }
  }
 ]
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I changed the headline to \"Design at the speed of thought\". I didn't run lint, since only the text changed and the styles are the same.",
 "commits": [
  {
   "ops": [
    {
     "op": "setProps",
     "id": "n_herotitle1",
     "patch": {
      "text": "Design at the speed of thought"
     }
    }
   ],
   "label": "Update headline text"
  }
 ]
}
```
</details>

## pricing-page-offers-job

> Now add a full pricing page with three tiers and an FAQ.

| Arm | Result | Turns | In | Cache r | Cache w | Out | Wall | Touched |
|---|---|---|---|---|---|---|---|---|
| HTML frame | **fail**: job suggestion: expected generate, got null | 1 | 4 | 27990 | 0 | 587 | 4.1 s | – |
| FigCraft `v2` | pass | 2 | 6 | 16064 | 298 | 330 | 4.0 s | – · job: generate |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/pricing-page-offers-job/html.png) | ![v2](v2/pricing-page-offers-job/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I didn't edit the document. A full pricing page with three tiers and an FAQ is a new page, so I've offered it as a background generation job instead. If you start it, it will match the existing Acme landing page.",
 "commands": []
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I'll ask a few quick questions first so the pricing page fits your product.",
 "commits": [],
 "notes": [
  "turn ended on ask_questions"
 ]
}
```
</details>

## x-build-pricing

> Build a pricing section directly below the features section: a heading, three tiers (Free, Pro, Team) as cards with the price, a short feature list and a call-to-action button each, with Pro highlighted as recommended. Then add an FAQ section with four questions and answers below it. Build it directly on this page now; do not suggest a job.

| Arm | Result | Turns | In | Cache r | Cache w | Out | Wall | Touched |
|---|---|---|---|---|---|---|---|---|
| HTML frame | pass | 4 | 10 | 124047 | 8081 | 7604 | 39.9 s | n_root000001, n_price00001, n_priceh0001, n_pricegrid1, n_tierfree01, n_tfreenm01, n_tfreepr01, n_tfreels01, n_tfreeli01, n_tfreeli02, n_tfreeli03, n_tfreebt01, n_tierpro001, n_tprobdg01, n_tpronm001, n_tpropr001, n_tprols001, n_tproli001, n_tproli002, n_tproli003, n_tprobt001, n_tierteam01, n_tteamnm01, n_tteampr01, n_tteamls01, n_tteamli01, n_tteamli02, n_tteamli03, n_tteambt01, n_faq0000001, n_faqh000001, n_faqlist001, n_faqitem001, n_faqq00001, n_faqa00001, n_faqitem002, n_faqq00002, n_faqa00002, n_faqitem003, n_faqq00003, n_faqa00003, n_faqitem004, n_faqq00004, n_faqa00004 |
| FigCraft `v2` | pass | 10 | 22 | 179842 | 19627 | 7011 | 47.4 s | new:22, new:23, new:24, new:25, new:26, new:27, new:28, new:29, new:30, new:31, new:32, new:33, new:34, new:35, new:36, new:37, new:38, new:39, new:40, new:41, new:42, new:43, new:44, new:45, new:46, new:47, new:48, new:49, new:50, new:51, new:52, new:53, new:54, new:55, new:56, new:57, new:58, new:59, new:60, new:61, new:62 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/x-build-pricing/html.png) | ![v2](v2/x-build-pricing/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "Pricing cards are missing; let me inspect the row.",
 "commands": [
  {
   "command": "node.create",
   "as": "ps",
   "params": {
    "type": "frame",
    "name": "n_pricing001",
    "parent": 2,
    "props": {
     "layout": "vertical",
     "gap": 32,
     "padding": [
      64,
      24,
      64,
      24
     ],
     "sizingH": "fill",
     "sizingV": "hug",
     "fill": "#FFFFFF"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "ps"
    },
    "name": "n_pricehead01",
    "text": "Simple, transparent pricing",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Bold",
     "fontSize": 36,
     "fill": "#18181B",
     "lineHeight": "115%"
    }
   }
  },
  {
   "command": "node.create",
   "as": "row",
   "params": {
    "type": "frame",
    "name": "n_pricerow01",
    "parent": {
     "$ref": "ps"
    },
    "props": {
     "layout": "horizontal",
     "gap": 16,
     "crossAlign": "min",
     "sizingH": "fill",
     "sizingV": "hug",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "as": "c1",
   "params": {
    "type": "frame",
    "name": "n_tierfree01",
    "parent": {
     "$ref": "row"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "sizingH": "fill",
     "sizingV": "fill",
     "cornerRadius": 16,
     "fill": "#F6F6F4"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c1"
    },
    "name": "n_tierfree01_name",
    "text": "Free",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 18,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c1"
    },
    "name": "n_tierfree01_price",
    "text": "$0 / month",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Bold",
     "fontSize": 36,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c1"
    },
    "name": "n_tierfree01_list",
    "text": "3 projects\nLive HTML frames\nCommunity support",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%",
     "paragraphSpacing": 8
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "c1"
    },
    "name": "n_tierfree01_spacer",
    "props": {
     "sizingH": "fill",
     "sizingV": "fill",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "as": "b1",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "c1"
    },
    "name": "n_tierfree01_cta",
    "props": {
     "layout": "horizontal",
     "padding": [
      8,
      16,
      8,
      16
     ],
     "mainAlign": "center",
     "crossAlign": "center",
     "sizingH": "fill",
     "cornerRadius": 8,
     "fill": "#FFFFFF",
     "stroke": "#E4E4E7"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "b1"
    },
    "name": "n_tierfree01_cta_label",
    "text": "Start free",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 14,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "as": "c2",
   "params": {
    "type": "frame",
    "name": "n_tierpro0001",
    "parent": {
     "$ref": "row"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "sizingH": "fill",
     "sizingV": "fill",
     "cornerRadius": 16,
     "fill": "#FFFFFF",
     "stroke": "#4F46E5",
     "strokeWeight": 2
    }
   }
  },
  {
   "command": "node.create",
   "as": "badge",
   "params": {
    "type": "frame",
    "name": "n_tierpro0001_badge",
    "parent": {
     "$ref": "c2"
    },
    "props": {
     "layout": "horizontal",
     "padding": [
      4,
      12,
      4,
      12
     ],
     "cornerRadius": 9999,
     "fill": "#4F46E5",
     "sizingH": "hug"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "badge"
    },
    "name": "n_tierpro0001_badge_label",
    "text": "Recommended",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 12,
     "fill": "#FFFFFF"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c2"
    },
    "name": "n_tierpro0001_name",
    "text": "Pro",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 18,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c2"
    },
    "name": "n_tierpro0001_price",
    "text": "$24 / month",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Bold",
     "fontSize": 36,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c2"
    },
    "name": "n_tierpro0001_list",
    "text": "Unlimited projects\nDesign system tokens\nReact + Tailwind export\nPriority support",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%",
     "paragraphSpacing": 8
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "c2"
    },
    "name": "n_tierpro0001_spacer",
    "props": {
     "sizingH": "fill",
     "sizingV": "fill",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "as": "b2",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "c2"
    },
    "name": "n_tierpro0001_cta",
    "props": {
     "layout": "horizontal",
     "padding": [
      8,
      16,
      8,
      16
     ],
     "mainAlign": "center",
     "crossAlign": "center",
     "sizingH": "fill",
     "cornerRadius": 8,
     "fill": "#4F46E5"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "b2"
    },
    "name": "n_tierpro0001_cta_label",
    "text": "Get Pro",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 14,
     "fill": "#FFFFFF"
    }
   }
  },
  {
   "command": "node.create",
   "as": "c3",
   "params": {
    "type": "frame",
    "name": "n_tierteam001",
    "parent": {
     "$ref": "row"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "sizingH": "fill",
     "sizingV": "fill",
     "cornerRadius": 16,
     "fill": "#F6F6F4"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c3"
    },
    "name": "n_tierteam001_name",
    "text": "Team",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 18,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c3"
    },
    "name": "n_tierteam001_price",
    "text": "$60 / month",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Bold",
     "fontSize": 36,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c3"
    },
    "name": "n_tierteam001_list",
    "text": "Everything in Pro\nShared libraries\nSSO and roles",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%",
     "paragraphSpacing": 8
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "c3"
    },
    "name": "n_tierteam001_spacer",
    "props": {
     "sizingH": "fill",
     "sizingV": "fill",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "as": "b3",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "c3"
    },
    "name": "n_tierteam001_cta",
    "props": {
     "layout": "horizontal",
     "padding": [
      8,
      16,
      8,
      16
     ],
     "mainAlign": "center",
     "crossAlign": "center",
     "sizingH": "fill",
     "cornerRadius": 8,
     "fill": "#FFFFFF",
     "stroke": "#E4E4E7"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "b3"
    },
    "name": "n_tierteam001_cta_label",
    "text": "Contact sales",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 14,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "as": "fs",
   "params": {
    "type": "frame",
    "name": "n_faq0000001",
    "parent": 2,
    "props": {
     "layout": "vertical",
     "gap": 32,
     "padding": [
      64,
      24,
      96,
      24
     ],
     "sizingH": "fill",
     "sizingV": "hug",
     "fill": "#FFFFFF"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "fs"
    },
    "name": "n_faqhead001",
    "text": "Frequently asked questions",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Bold",
     "fontSize": 36,
     "fill": "#18181B",
     "lineHeight": "115%"
    }
   }
  },
  {
   "command": "node.create",
   "as": "fl",
   "params": {
    "type": "frame",
    "name": "n_faqlist001",
    "parent": {
     "$ref": "fs"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "sizingH": "fill",
     "sizingV": "hug",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "as": "q1",
   "params": {
    "type": "frame",
    "name": "n_faq1",
    "parent": {
     "$ref": "fl"
    },
    "props": {
     "layout": "vertical",
     "gap": 8,
     "padding": 24,
     "sizingH": "fill",
     "cornerRadius": 16,
     "fill": "#F6F6F4"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "q1"
    },
    "name": "n_faq1_q",
    "text": "Can I try Acme for free?",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 18,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "q1"
    },
    "name": "n_faq1_a",
    "text": "Yes. The Free plan has no time limit and includes three projects.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%"
    }
   }
  },
  {
   "command": "node.create",
   "as": "q2",
   "params": {
    "type": "frame",
    "name": "n_faq2",
    "parent": {
     "$ref": "fl"
    },
    "props": {
     "layout": "vertical",
     "gap": 8,
     "padding": 24,
     "sizingH": "fill",
     "cornerRadius": 16,
     "fill": "#F6F6F4"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "q2"
    },
    "name": "n_faq2_q",
    "text": "Can I change plans later?",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 18,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "q2"
    },
    "name": "n_faq2_a",
    "text": "Upgrade or downgrade at any time. Changes apply on your next billing date.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%"
    }
   }
  },
  {
   "command": "node.create",
   "as": "q3",
   "params": {
    "type": "frame",
    "name": "n_faq3",
    "parent": {
     "$ref": "fl"
    },
    "props": {
     "layout": "vertical",
     "gap": 8,
     "padding": 24,
     "sizingH": "fill",
     "cornerRadius": 16,
     "fill": "#F6F6F4"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "q3"
    },
    "name": "n_faq3_q",
    "text": "What code can I export?",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 18,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "q3"
    },
    "name": "n_faq3_a",
    "text": "Pro and Team export React with Tailwind, using your design tokens.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%"
    }
   }
  },
  {
   "command": "node.create",
   "as": "q4",
   "params": {
    "type": "frame",
    "name": "n_faq4",
    "parent": {
     "$ref": "fl"
    },
    "props": {
     "layout": "vertical",
     "gap": 8,
     "padding": 24,
     "sizingH": "fill",
     "cornerRadius": 16,
     "fill": "#F6F6F4"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "q4"
    },
    "name": "n_faq4_q",
    "text": "Do you offer team discounts?",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 18,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "q4"
    },
    "name": "n_faq4_a",
    "text": "Contact sales for volume pricing on teams of more than 20 people.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%"
    }
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 24,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 25,
    "sizingV": "fill"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 25,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 32,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 41,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 33,
    "sizingH": "hug",
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 24,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 25,
    "sizingV": "fill"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 41,
    "sizingV": "fill"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 30,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 39,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 46,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 32,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 24,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 25,
    "sizingV": "fill"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 41,
    "sizingV": "fill"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 32,
    "sizingV": "fill"
   }
  }
 ]
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I added a pricing section and an FAQ section below Features. The lint check found no issues.\n\n- **Pricing:** There's a centered heading and three tier cards. Free is $0, Pro is $19 and Team is $49, each per month. Each card has a three-item feature list and a Button. Pro has a primary border, a shadow, a \"Recommended\" badge and the primary Button. Free and Team use the secondary Button. The cards stack on mobile and sit in three columns from the md breakpoint up.\n- **FAQ:** There's a heading and four question-and-answer pairs. They cover the free plan, changing plans, code export and Team billing.\n\nThe prices, feature lists and FAQ answers are placeholder copy I wrote, so replace them with your real details.",
 "commits": [
  {
   "ops": [
    {
     "op": "insertSubtree",
     "parentId": "n_root000001",
     "index": 3,
     "nodes": [
      {
       "id": "n_price00001",
       "name": "Pricing",
       "parentId": "n_root000001",
       "children": [
        "n_priceh0001",
        "n_pricegrid1"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.8"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.16"
         },
         "paddingLeft": {
          "token": "space.6"
         }
        }
       },
       "type": "box",
       "tag": "section",
       "props": {}
      },
      {
       "id": "n_priceh0001",
       "name": "Pricing heading",
       "parentId": "n_price00001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.4xl"
         },
         "fontWeight": {
          "token": "weight.bold"
         },
         "lineHeight": {
          "token": "leading.tight"
         },
         "textAlign": "center",
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "h2",
       "props": {
        "text": "Simple, transparent pricing"
       }
      },
      {
       "id": "n_pricegrid1",
       "name": "Tiers",
       "parentId": "n_price00001",
       "children": [
        "n_tierfree01",
        "n_tierpro001",
        "n_tierteam01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "grid",
         "alignItems": "stretch",
         "gap": {
          "token": "space.4"
         },
         "gridTemplateColumns": "repeat(1, minmax(0, 1fr))"
        },
        "md": {
         "gridTemplateColumns": "repeat(3, minmax(0, 1fr))"
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_tierfree01",
       "name": "Tier Free",
       "parentId": "n_pricegrid1",
       "children": [
        "n_tfreenm01",
        "n_tfreepr01",
        "n_tfreels01",
        "n_tfreebt01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.4"
         },
         "paddingTop": {
          "token": "space.6"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.6"
         },
         "paddingLeft": {
          "token": "space.6"
         },
         "backgroundColor": {
          "token": "color.surface"
         },
         "borderRadius": {
          "token": "radius.lg"
         }
        }
       },
       "type": "box",
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_tfreenm01",
       "parentId": "n_tierfree01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.xl"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "h3",
       "props": {
        "text": "Free"
       }
      },
      {
       "id": "n_tfreepr01",
       "parentId": "n_tierfree01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.4xl"
         },
         "fontWeight": {
          "token": "weight.bold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "p",
       "props": {
        "text": "$0 / month"
       }
      },
      {
       "id": "n_tfreels01",
       "name": "Features",
       "parentId": "n_tierfree01",
       "children": [
        "n_tfreeli01",
        "n_tfreeli02",
        "n_tfreeli03"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.2"
         },
         "flexGrow": 1
        }
       },
       "type": "box",
       "tag": "ul",
       "props": {}
      },
      {
       "id": "n_tfreeli01",
       "parentId": "n_tfreels01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "li",
       "props": {
        "text": "3 projects"
       }
      },
      {
       "id": "n_tfreeli02",
       "parentId": "n_tfreels01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "li",
       "props": {
        "text": "Basic components"
       }
      },
      {
       "id": "n_tfreeli03",
       "parentId": "n_tfreels01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "li",
       "props": {
        "text": "Community support"
       }
      },
      {
       "id": "n_tfreebt01",
       "name": "Free CTA",
       "parentId": "n_tierfree01",
       "children": [],
       "positioning": "flow",
       "style": {},
       "type": "instance",
       "componentRef": {
        "componentId": "Button",
        "variant": {
         "variant": "secondary"
        }
       },
       "props": {
        "values": {
         "label": "Start free"
        }
       }
      },
      {
       "id": "n_tierpro001",
       "name": "Tier Pro (Recommended)",
       "parentId": "n_pricegrid1",
       "children": [
        "n_tprobdg01",
        "n_tpronm001",
        "n_tpropr001",
        "n_tprols001",
        "n_tprobt001"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.4"
         },
         "paddingTop": {
          "token": "space.6"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.6"
         },
         "paddingLeft": {
          "token": "space.6"
         },
         "backgroundColor": {
          "token": "color.background"
         },
         "borderWidth": 2,
         "borderStyle": "solid",
         "borderColor": {
          "token": "color.primary"
         },
         "borderRadius": {
          "token": "radius.lg"
         },
         "boxShadow": {
          "token": "shadow.md"
         }
        }
       },
       "type": "box",
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_tprobdg01",
       "name": "Badge",
       "parentId": "n_tierpro001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "alignSelf": "flex-start",
         "paddingTop": {
          "token": "space.1"
         },
         "paddingRight": {
          "token": "space.3"
         },
         "paddingBottom": {
          "token": "space.1"
         },
         "paddingLeft": {
          "token": "space.3"
         },
         "fontSize": {
          "token": "text.xs"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.primaryText"
         },
         "backgroundColor": {
          "token": "color.primary"
         },
         "borderRadius": {
          "token": "radius.full"
         }
        }
       },
       "type": "text",
       "tag": "small",
       "props": {
        "text": "Recommended"
       }
      },
      {
       "id": "n_tpronm001",
       "parentId": "n_tierpro001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.xl"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "h3",
       "props": {
        "text": "Pro"
       }
      },
      {
       "id": "n_tpropr001",
       "parentId": "n_tierpro001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.4xl"
         },
         "fontWeight": {
          "token": "weight.bold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "p",
       "props": {
        "text": "$19 / month"
       }
      },
      {
       "id": "n_tprols001",
       "name": "Features",
       "parentId": "n_tierpro001",
       "children": [
        "n_tproli001",
        "n_tproli002",
        "n_tproli003"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.2"
         },
         "flexGrow": 1
        }
       },
       "type": "box",
       "tag": "ul",
       "props": {}
      },
      {
       "id": "n_tproli001",
       "parentId": "n_tprols001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "li",
       "props": {
        "text": "Unlimited projects"
       }
      },
      {
       "id": "n_tproli002",
       "parentId": "n_tprols001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "li",
       "props": {
        "text": "Custom design system"
       }
      },
      {
       "id": "n_tproli003",
       "parentId": "n_tprols001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "li",
       "props": {
        "text": "React + Tailwind export"
       }
      },
      {
       "id": "n_tprobt001",
       "name": "Pro CTA",
       "parentId": "n_tierpro001",
       "children": [],
       "positioning": "flow",
       "style": {},
       "type": "instance",
       "componentRef": {
        "componentId": "Button",
        "variant": {
         "variant": "primary"
        }
       },
       "props": {
        "values": {
         "label": "Get Pro"
        }
       }
      },
      {
       "id": "n_tierteam01",
       "name": "Tier Team",
       "parentId": "n_pricegrid1",
       "children": [
        "n_tteamnm01",
        "n_tteampr01",
        "n_tteamls01",
        "n_tteambt01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.4"
         },
         "paddingTop": {
          "token": "space.6"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.6"
         },
         "paddingLeft": {
          "token": "space.6"
         },
         "backgroundColor": {
          "token": "color.surface"
         },
         "borderRadius": {
          "token": "radius.lg"
         }
        }
       },
       "type": "box",
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_tteamnm01",
       "parentId": "n_tierteam01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.xl"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "h3",
       "props": {
        "text": "Team"
       }
      },
      {
       "id": "n_tteampr01",
       "parentId": "n_tierteam01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.4xl"
         },
         "fontWeight": {
          "token": "weight.bold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "p",
       "props": {
        "text": "$49 / month"
       }
      },
      {
       "id": "n_tteamls01",
       "name": "Features",
       "parentId": "n_tierteam01",
       "children": [
        "n_tteamli01",
        "n_tteamli02",
        "n_tteamli03"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.2"
         },
         "flexGrow": 1
        }
       },
       "type": "box",
       "tag": "ul",
       "props": {}
      },
      {
       "id": "n_tteamli01",
       "parentId": "n_tteamls01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "li",
       "props": {
        "text": "Everything in Pro"
       }
      },
      {
       "id": "n_tteamli02",
       "parentId": "n_tteamls01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "li",
       "props": {
        "text": "Shared workspaces"
       }
      },
      {
       "id": "n_tteamli03",
       "parentId": "n_tteamls01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "li",
       "props": {
        "text": "Priority support"
       }
      },
      {
       "id": "n_tteambt01",
       "name": "Team CTA",
       "parentId": "n_tierteam01",
       "children": [],
       "positioning": "flow",
       "style": {},
       "type": "instance",
       "componentRef": {
        "componentId": "Button",
        "variant": {
         "variant": "secondary"
        }
       },
       "props": {
        "values": {
         "label": "Contact sales"
        }
       }
      }
     ]
    },
    {
     "op": "insertSubtree",
     "parentId": "n_root000001",
     "index": 4,
     "nodes": [
      {
       "id": "n_faq0000001",
       "name": "FAQ",
       "parentId": "n_root000001",
       "children": [
        "n_faqh000001",
        "n_faqlist001"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.8"
         },
         "width": "fill",
         "maxWidth": "48rem",
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.16"
         },
         "paddingLeft": {
          "token": "space.6"
         },
         "marginRight": "auto",
         "marginLeft": "auto"
        }
       },
       "type": "box",
       "tag": "section",
       "props": {}
      },
      {
       "id": "n_faqh000001",
       "name": "FAQ heading",
       "parentId": "n_faq0000001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.4xl"
         },
         "fontWeight": {
          "token": "weight.bold"
         },
         "lineHeight": {
          "token": "leading.tight"
         },
         "textAlign": "center",
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "h2",
       "props": {
        "text": "Frequently asked questions"
       }
      },
      {
       "id": "n_faqlist001",
       "name": "Questions",
       "parentId": "n_faq0000001",
       "children": [
        "n_faqitem001",
        "n_faqitem002",
        "n_faqitem003",
        "n_faqitem004"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.4"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_faqitem001",
       "name": "FAQ 1",
       "parentId": "n_faqlist001",
       "children": [
        "n_faqq00001",
        "n_faqa00001"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.2"
         },
         "paddingBottom": {
          "token": "space.4"
         },
         "borderBottomWidth": 1,
         "borderStyle": "solid",
         "borderColor": {
          "token": "color.border"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_faqq00001",
       "parentId": "n_faqitem001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.lg"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "h3",
       "props": {
        "text": "Can I try Acme for free?"
       }
      },
      {
       "id": "n_faqa00001",
       "parentId": "n_faqitem001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "lineHeight": {
          "token": "leading.normal"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "p",
       "props": {
        "text": "Yes. The Free plan has no time limit and includes up to three projects."
       }
      },
      {
       "id": "n_faqitem002",
       "name": "FAQ 2",
       "parentId": "n_faqlist001",
       "children": [
        "n_faqq00002",
        "n_faqa00002"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.2"
         },
         "paddingBottom": {
          "token": "space.4"
         },
         "borderBottomWidth": 1,
         "borderStyle": "solid",
         "borderColor": {
          "token": "color.border"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_faqq00002",
       "parentId": "n_faqitem002",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.lg"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "h3",
       "props": {
        "text": "Can I change plans later?"
       }
      },
      {
       "id": "n_faqa00002",
       "parentId": "n_faqitem002",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "lineHeight": {
          "token": "leading.normal"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "p",
       "props": {
        "text": "Anytime. Upgrades apply immediately and downgrades take effect at the next billing cycle."
       }
      },
      {
       "id": "n_faqitem003",
       "name": "FAQ 3",
       "parentId": "n_faqlist001",
       "children": [
        "n_faqq00003",
        "n_faqa00003"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.2"
         },
         "paddingBottom": {
          "token": "space.4"
         },
         "borderBottomWidth": 1,
         "borderStyle": "solid",
         "borderColor": {
          "token": "color.border"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_faqq00003",
       "parentId": "n_faqitem003",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.lg"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "h3",
       "props": {
        "text": "Does the exported code work with my stack?"
       }
      },
      {
       "id": "n_faqa00003",
       "parentId": "n_faqitem003",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "lineHeight": {
          "token": "leading.normal"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "p",
       "props": {
        "text": "Pro and Team export clean React and Tailwind components that drop into any modern codebase."
       }
      },
      {
       "id": "n_faqitem004",
       "name": "FAQ 4",
       "parentId": "n_faqlist001",
       "children": [
        "n_faqq00004",
        "n_faqa00004"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.2"
         },
         "paddingBottom": {
          "token": "space.4"
         },
         "borderBottomWidth": 1,
         "borderStyle": "solid",
         "borderColor": {
          "token": "color.border"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_faqq00004",
       "parentId": "n_faqitem004",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.lg"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "h3",
       "props": {
        "text": "How does Team billing work?"
       }
      },
      {
       "id": "n_faqa00004",
       "parentId": "n_faqitem004",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "lineHeight": {
          "token": "leading.normal"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "p",
       "props": {
        "text": "Team is billed monthly per workspace, with unlimited editors and a single invoice."
       }
      }
     ]
    }
   ],
   "label": "Add pricing and FAQ sections"
  }
 ]
}
```
</details>

## x-build-testimonials

> Add a testimonials section after the features: a heading and three customer quote cards, each with the quote, a round avatar placeholder, the person's name and their company. Match the existing page style. Build it directly; do not suggest a job.

| Arm | Result | Turns | In | Cache r | Cache w | Out | Wall | Touched |
|---|---|---|---|---|---|---|---|---|
| HTML frame | pass | 5 | 12 | 156972 | 4824 | 4363 | 24.6 s | n_root000001, n_testi000001, n_testihead01, n_testigrid01, n_quote1card01, n_quote1text01, n_quote1auth01, n_quote1avat01, n_quote1info01, n_quote1name01, n_quote1comp01, n_quote2card01, n_quote2text01, n_quote2auth01, n_quote2avat01, n_quote2info01, n_quote2name01, n_quote2comp01, n_quote3card01, n_quote3text01, n_quote3auth01, n_quote3avat01, n_quote3info01, n_quote3name01, n_quote3comp01 |
| FigCraft `v2` | pass | 8 | 18 | 103081 | 12288 | 4014 | 39.3 s | new:22, new:23, new:24, new:25, new:26, new:27, new:28, new:29, new:30, new:31, new:32, new:33, new:34, new:35, new:36, new:37, new:38, new:39, new:40, new:41, new:42, new:43, new:44, new:45 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/x-build-testimonials/html.png) | ![v2](v2/x-build-testimonials/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "Root probably has a fixed height, clipping the new section. Checking.\nI added a testimonials section after the features. It has a \"Loved by product teams\" heading and three quote cards. Each card has the quote, a round grey avatar placeholder, the person's name and their company. The cards use the same surface fill, 16px radius and 24px padding as the feature cards, and the fonts follow the page's tokens. The render looks right.\n\nThe three cards are all the same height here because their quotes wrap to two lines. If you edit a quote to a different length, the cards will no longer match. The vertical \"fill\" sizing I first used collapsed the cards, so I set them to hug their content instead.\n\nThe names, companies and quotes are placeholders I wrote, so swap in real ones.",
 "commands": [
  {
   "command": "node.create",
   "as": "sec",
   "params": {
    "type": "frame",
    "parent": 2,
    "name": "n_testimonials",
    "props": {
     "layout": "vertical",
     "gap": 24,
     "padding": [
      0,
      24,
      64,
      24
     ],
     "sizingH": "fill",
     "sizingV": "hug",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "sec"
    },
    "name": "n_testi_heading",
    "text": "Loved by product teams",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Bold",
     "fontSize": 24,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "as": "row",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "sec"
    },
    "name": "n_testi_row",
    "props": {
     "layout": "horizontal",
     "gap": 16,
     "crossAlign": "min",
     "sizingH": "fill",
     "sizingV": "hug",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "as": "c1",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "row"
    },
    "name": "n_testi1card",
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "mainAlign": "spaceBetween",
     "sizingH": "fill",
     "sizingV": "fill",
     "fill": "#F6F6F4",
     "cornerRadius": 16
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c1"
    },
    "name": "n_testi1quote",
    "text": "“We went from brief to shipped screens in a day. Engineers loved the handoff.”",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 16,
     "lineHeight": "150%",
     "fill": "#18181B",
     "sizingH": "fill",
     "textAutoResize": "height"
    }
   }
  },
  {
   "command": "node.create",
   "as": "p1",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "c1"
    },
    "name": "n_testi1person",
    "props": {
     "layout": "horizontal",
     "gap": 12,
     "crossAlign": "center",
     "sizingH": "fill",
     "sizingV": "hug",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "ellipse",
    "parent": {
     "$ref": "p1"
    },
    "name": "n_testi1avatar",
    "width": 40,
    "height": 40,
    "props": {
     "fill": "#E4E4E7"
    }
   }
  },
  {
   "command": "node.create",
   "as": "t1",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "p1"
    },
    "name": "n_testi1info",
    "props": {
     "layout": "vertical",
     "gap": 4,
     "sizingH": "hug",
     "sizingV": "hug",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "t1"
    },
    "name": "n_testi1name",
    "text": "Maya Chen",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 14,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "t1"
    },
    "name": "n_testi1company",
    "text": "Northwind",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70"
    }
   }
  },
  {
   "command": "node.create",
   "as": "c2",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "row"
    },
    "name": "n_testi2card",
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "mainAlign": "spaceBetween",
     "sizingH": "fill",
     "sizingV": "fill",
     "fill": "#F6F6F4",
     "cornerRadius": 16
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c2"
    },
    "name": "n_testi2quote",
    "text": "“Our design system finally stays consistent across every team and screen.”",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 16,
     "lineHeight": "150%",
     "fill": "#18181B",
     "sizingH": "fill",
     "textAutoResize": "height"
    }
   }
  },
  {
   "command": "node.create",
   "as": "p2",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "c2"
    },
    "name": "n_testi2person",
    "props": {
     "layout": "horizontal",
     "gap": 12,
     "crossAlign": "center",
     "sizingH": "fill",
     "sizingV": "hug",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "ellipse",
    "parent": {
     "$ref": "p2"
    },
    "name": "n_testi2avatar",
    "width": 40,
    "height": 40,
    "props": {
     "fill": "#E4E4E7"
    }
   }
  },
  {
   "command": "node.create",
   "as": "t2",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "p2"
    },
    "name": "n_testi2info",
    "props": {
     "layout": "vertical",
     "gap": 4,
     "sizingH": "hug",
     "sizingV": "hug",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "t2"
    },
    "name": "n_testi2name",
    "text": "Daniel Ortiz",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 14,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "t2"
    },
    "name": "n_testi2company",
    "text": "Lumen Labs",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70"
    }
   }
  },
  {
   "command": "node.create",
   "as": "c3",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "row"
    },
    "name": "n_testi3card",
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "mainAlign": "spaceBetween",
     "sizingH": "fill",
     "sizingV": "fill",
     "fill": "#F6F6F4",
     "cornerRadius": 16
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "c3"
    },
    "name": "n_testi3quote",
    "text": "“Exporting React and Tailwind straight from the canvas saves us hours every sprint.”",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 16,
     "lineHeight": "150%",
     "fill": "#18181B",
     "sizingH": "fill",
     "textAutoResize": "height"
    }
   }
  },
  {
   "command": "node.create",
   "as": "p3",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "c3"
    },
    "name": "n_testi3person",
    "props": {
     "layout": "horizontal",
     "gap": 12,
     "crossAlign": "center",
     "sizingH": "fill",
     "sizingV": "hug",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "ellipse",
    "parent": {
     "$ref": "p3"
    },
    "name": "n_testi3avatar",
    "width": 40,
    "height": 40,
    "props": {
     "fill": "#E4E4E7"
    }
   }
  },
  {
   "command": "node.create",
   "as": "t3",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "p3"
    },
    "name": "n_testi3info",
    "props": {
     "layout": "vertical",
     "gap": 4,
     "sizingH": "hug",
     "sizingV": "hug",
     "fill": "none"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "t3"
    },
    "name": "n_testi3name",
    "text": "Priya Nair",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 14,
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "parent": {
     "$ref": "t3"
    },
    "name": "n_testi3company",
    "text": "Brightside",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70"
    }
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 24,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 25,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 32,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 39,
    "sizingV": "hug"
   }
  }
 ]
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "Fix avatar sizes with tokens.\nI added a testimonials section after the features. It has a \"Loved by product teams\" heading and three quote cards. The cards stack on mobile and sit in three columns from the md breakpoint, like the features.\n\nEach card has a quote, a round avatar placeholder, a name and a company. The names, companies and quotes are placeholder text, so swap in real ones. The styling uses design-system tokens, and the avatar sizes are tokenized after the lint check.",
 "commits": [
  {
   "ops": [
    {
     "op": "insertSubtree",
     "parentId": "n_root000001",
     "index": 3,
     "nodes": [
      {
       "id": "n_testi000001",
       "name": "Testimonials",
       "parentId": "n_root000001",
       "children": [
        "n_testihead01",
        "n_testigrid01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.6"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.16"
         },
         "paddingLeft": {
          "token": "space.6"
         }
        }
       },
       "type": "box",
       "tag": "section",
       "props": {}
      },
      {
       "id": "n_testihead01",
       "parentId": "n_testi000001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.2xl"
         },
         "fontWeight": {
          "token": "weight.bold"
         },
         "lineHeight": {
          "token": "leading.tight"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "h2",
       "props": {
        "text": "Loved by product teams"
       }
      },
      {
       "id": "n_testigrid01",
       "name": "Quotes",
       "parentId": "n_testi000001",
       "children": [
        "n_quote1card01",
        "n_quote2card01",
        "n_quote3card01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "grid",
         "gap": {
          "token": "space.4"
         },
         "gridTemplateColumns": "repeat(1, minmax(0, 1fr))"
        },
        "md": {
         "gridTemplateColumns": "repeat(3, minmax(0, 1fr))"
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_quote1card01",
       "name": "Testimonial 1",
       "parentId": "n_testigrid01",
       "children": [
        "n_quote1text01",
        "n_quote1auth01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.4"
         },
         "paddingTop": {
          "token": "space.6"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.6"
         },
         "paddingLeft": {
          "token": "space.6"
         },
         "backgroundColor": {
          "token": "color.surface"
         },
         "borderRadius": {
          "token": "radius.lg"
         }
        }
       },
       "type": "box",
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_quote1text01",
       "parentId": "n_quote1card01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "lineHeight": {
          "token": "leading.normal"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "p",
       "props": {
        "text": "“We went from brief to a shippable page in an afternoon. Engineers had nothing to redo.”"
       }
      },
      {
       "id": "n_quote1auth01",
       "name": "Author",
       "parentId": "n_quote1card01",
       "children": [
        "n_quote1avat01",
        "n_quote1info01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "alignItems": "center",
         "gap": {
          "token": "space.3"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_quote1avat01",
       "name": "Avatar",
       "parentId": "n_quote1auth01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "flexShrink": 0,
         "width": 48,
         "height": 48,
         "backgroundColor": {
          "token": "color.border"
         },
         "borderRadius": {
          "token": "radius.full"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_quote1info01",
       "name": "Info",
       "parentId": "n_quote1auth01",
       "children": [
        "n_quote1name01",
        "n_quote1comp01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column"
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_quote1name01",
       "parentId": "n_quote1info01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.sm"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "strong",
       "props": {
        "text": "Maya Chen"
       }
      },
      {
       "id": "n_quote1comp01",
       "parentId": "n_quote1info01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.sm"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "span",
       "props": {
        "text": "Northwind"
       }
      },
      {
       "id": "n_quote2card01",
       "name": "Testimonial 2",
       "parentId": "n_testigrid01",
       "children": [
        "n_quote2text01",
        "n_quote2auth01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.4"
         },
         "paddingTop": {
          "token": "space.6"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.6"
         },
         "paddingLeft": {
          "token": "space.6"
         },
         "backgroundColor": {
          "token": "color.surface"
         },
         "borderRadius": {
          "token": "radius.lg"
         }
        }
       },
       "type": "box",
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_quote2text01",
       "parentId": "n_quote2card01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "lineHeight": {
          "token": "leading.normal"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "p",
       "props": {
        "text": "Our tokens stay intact on every screen. Design reviews got dramatically shorter."
       }
      },
      {
       "id": "n_quote2auth01",
       "name": "Author",
       "parentId": "n_quote2card01",
       "children": [
        "n_quote2avat01",
        "n_quote2info01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "alignItems": "center",
         "gap": {
          "token": "space.3"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_quote2avat01",
       "name": "Avatar",
       "parentId": "n_quote2auth01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "flexShrink": 0,
         "width": 48,
         "height": 48,
         "backgroundColor": {
          "token": "color.border"
         },
         "borderRadius": {
          "token": "radius.full"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_quote2info01",
       "name": "Info",
       "parentId": "n_quote2auth01",
       "children": [
        "n_quote2name01",
        "n_quote2comp01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column"
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_quote2name01",
       "parentId": "n_quote2info01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.sm"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "strong",
       "props": {
        "text": "Daniel Okafor"
       }
      },
      {
       "id": "n_quote2comp01",
       "parentId": "n_quote2info01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.sm"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "span",
       "props": {
        "text": "Lumen Labs"
       }
      },
      {
       "id": "n_quote3card01",
       "name": "Testimonial 3",
       "parentId": "n_testigrid01",
       "children": [
        "n_quote3text01",
        "n_quote3auth01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "gap": {
          "token": "space.4"
         },
         "paddingTop": {
          "token": "space.6"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.6"
         },
         "paddingLeft": {
          "token": "space.6"
         },
         "backgroundColor": {
          "token": "color.surface"
         },
         "borderRadius": {
          "token": "radius.lg"
         }
        }
       },
       "type": "box",
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_quote3text01",
       "parentId": "n_quote3card01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.base"
         },
         "lineHeight": {
          "token": "leading.normal"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "p",
       "props": {
        "text": "The React export is clean enough to merge as-is. It’s now part of our daily workflow."
       }
      },
      {
       "id": "n_quote3auth01",
       "name": "Author",
       "parentId": "n_quote3card01",
       "children": [
        "n_quote3avat01",
        "n_quote3info01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "alignItems": "center",
         "gap": {
          "token": "space.3"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_quote3avat01",
       "name": "Avatar",
       "parentId": "n_quote3auth01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "flexShrink": 0,
         "width": 48,
         "height": 48,
         "backgroundColor": {
          "token": "color.border"
         },
         "borderRadius": {
          "token": "radius.full"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_quote3info01",
       "name": "Info",
       "parentId": "n_quote3auth01",
       "children": [
        "n_quote3name01",
        "n_quote3comp01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column"
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_quote3name01",
       "parentId": "n_quote3info01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.sm"
         },
         "fontWeight": {
          "token": "weight.semibold"
         },
         "color": {
          "token": "color.text"
         }
        }
       },
       "type": "text",
       "tag": "strong",
       "props": {
        "text": "Priya Raman"
       }
      },
      {
       "id": "n_quote3comp01",
       "parentId": "n_quote3info01",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "fontSize": {
          "token": "text.sm"
         },
         "color": {
          "token": "color.muted"
         }
        }
       },
       "type": "text",
       "tag": "span",
       "props": {
        "text": "Brightside"
       }
      }
     ]
    }
   ],
   "label": "Add testimonials section"
  },
  {
   "ops": [
    {
     "op": "setStyle",
     "id": "n_quote1avat01",
     "breakpoint": "base",
     "prop": "width",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_quote1avat01",
     "breakpoint": "base",
     "prop": "height",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_quote2avat01",
     "breakpoint": "base",
     "prop": "width",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_quote2avat01",
     "breakpoint": "base",
     "prop": "height",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_quote3avat01",
     "breakpoint": "base",
     "prop": "width",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_quote3avat01",
     "breakpoint": "base",
     "prop": "height",
     "value": {
      "token": "space.12"
     }
    }
   ],
   "label": "Tokenize avatar sizes"
  }
 ]
}
```
</details>

