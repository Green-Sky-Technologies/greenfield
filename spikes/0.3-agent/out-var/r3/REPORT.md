# Story 0.3: can Claude draw? FigCraft commands vs HTML frames

Model `claude-sonnet-5-5` via gateway-oidc, same model for both arms. Generated 2026-11-24T16:34:46.897Z.

## Summary

Tokens are totals over the 6 cases; turns and wall time are per-case means.

| Arm / variant | Pass | Input (uncached) | Cache read | Cache write | Output | Est. cost | Turns | Wall |
|---|---|---|---|---|---|---|---|---|
| HTML frame (current agent) | 6/8 | 52 | 531711 | 18540 | 17748 | $0.3303 | 2.3 | 13.3 s |
| FigCraft `v2` | 7/8 | 82 | 453319 | 39967 | 15465 | $0.3454 | 4.1 | 15.6 s |

<details><summary>Method, adaptations and fixture gaps</summary>

- **Cases**: `evals/golden/interactive.json` (6 prompts on the `landing` fixture), same prompt text,
  selection and scope for both arms.
- **HTML arm**: the current interactive agent run as `packages/agent/src/evals/harness.ts` does
  (prefix, turn context, memory host with scope enforcement), rendered with `@greenfield/renderer`'s
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
| HTML frame | **fail**: job suggestion: expected alternatives, got null | 1 | 4 | 27993 | 0 | 564 | 4.0 s | – |
| FigCraft `v2` | pass | 2 | 6 | 16070 | 352 | 437 | 5.3 s | – · job: alternatives |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/alternatives-offers-job/html.png) | ![v2](v2/alternatives-offers-job/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I haven't changed your page. Comparing a few completely different layouts means generating several new versions of it, so I've offered a background job for that. It would create 3 alternatives that keep your copy and design tokens but change the structure. For example, one could have a split hero, one a centered hero with a feature grid, and one an alternating feature list. Start the job if you'd like to compare them.",
 "commands": []
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I can set up a few layout alternatives for you to compare. First I need a bit of direction.",
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
| HTML frame | pass | 2 | 6 | 55765 | 0 | 465 | 4.1 s | n_herocta001 |
| FigCraft `v2` | pass | 2 | 6 | 15569 | 0 | 225 | 2.7 s | n_herocta001 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/button-larger-scoped/html.png) | ![v2](v2/button-larger-scoped/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I made the button larger. The padding is now 16px top and bottom and 32px left and right, and the label is 18px instead of 14px. The colour and corner radius are the same, and I checked the render. It looks right.",
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
 "reply": "I made the CTA button larger. It now has more padding (1rem top and bottom, 2rem left and right) and bigger text (1.125rem). All values use design tokens, and the lint check found no issues.",
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
| HTML frame | pass | 2 | 6 | 59368 | 1651 | 1597 | 10.6 s | – |
| FigCraft `v2` | **fail**: patch scope: touched outside n_features01: new:22, new:23, new:24, new:25, new:26, new:27, new:28, new:29, new:30 | 2 | 6 | 21208 | 2979 | 1621 | 11.8 s | new:22, new:23, new:24, new:25, new:26, new:27, new:28, new:29, new:30 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/density-slider/html.png) | ![v2](v2/density-slider/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I added a \"Card density\" segmented control above the feature cards, with Compact, Comfortable and Spacious options. Comfortable is selected, which matches the cards' current 24px padding. It uses the design system's pill shape, colors and SF Pro.\n\nIt's only the visual control for now. Clicking an option doesn't change the cards yet. I haven't tried to make it work, and I haven't chosen padding and gap values for Compact or Spacious.",
 "commands": [
  {
   "command": "node.create",
   "as": "row",
   "params": {
    "type": "frame",
    "parent": 2,
    "index": 2,
    "name": "n_density0001",
    "props": {
     "layout": "horizontal",
     "gap": 12,
     "padding": [
      0,
      24,
      16,
      24
     ],
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
    "type": "text",
    "parent": {
     "$ref": "row"
    },
    "name": "n_densitylabel",
    "text": "Card density",
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
    "name": "n_densityseg",
    "props": {
     "layout": "horizontal",
     "gap": 4,
     "padding": 4,
     "crossAlign": "center",
     "sizingH": "hug",
     "sizingV": "hug",
     "fill": "#F6F6F4",
     "stroke": "#E4E4E7",
     "strokeWeight": 1,
     "cornerRadius": 9999
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
     "fill": "#6B6B70"
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
     "fill": "#6B6B70"
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
 "reply": "I added a \"Card density\" slider. It controls the padding inside each feature card, the gap between title and body, and the gap between the cards. At 50 it matches the current layout. Lower values give tighter cards and higher values give roomier ones.",
 "commits": [
  {
   "ops": [
    {
     "op": "upsertSlider",
     "slider": {
      "id": "s_density01",
      "label": "Card density",
      "min": 0,
      "max": 100,
      "step": 1,
      "value": 50,
      "bindings": [
       {
        "target": {
         "nodeId": "n_features01",
         "prop": "gap",
         "breakpoint": "base"
        },
        "map": {
         "type": "linear",
         "from": 4,
         "to": 28,
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
         "from": 8,
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
         "from": 8,
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
         "from": 8,
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
         "from": 8,
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
         "from": 2,
         "to": 14,
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
         "from": 8,
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
         "from": 8,
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
         "from": 8,
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
         "from": 8,
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
         "from": 2,
         "to": 14,
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
         "from": 8,
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
         "from": 8,
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
         "from": 8,
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
         "from": 8,
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
         "from": 2,
         "to": 14,
         "unit": "px"
        }
       }
      ],
      "pinned": false,
      "createdBy": "agent"
     }
    }
   ],
   "label": "Add slider “Card density”"
  }
 ]
}
```
</details>

## feature-cards-spacing

> Tighten the spacing in the features section a bit.

| Arm | Result | Turns | In | Cache r | Cache w | Out | Wall | Touched |
|---|---|---|---|---|---|---|---|---|
| HTML frame | pass | 2 | 6 | 60305 | 0 | 943 | 6.4 s | n_features01, n_feat1card00, n_feat2card00, n_feat3card00 |
| FigCraft `v2` | pass | 2 | 6 | 21202 | 758 | 557 | 5.6 s | n_features01, n_feat1card00, n_feat2card00, n_feat3card00 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/feature-cards-spacing/html.png) | ![v2](v2/feature-cards-spacing/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I tightened the spacing in the features section. I checked it in a render, and the three cards still look right.\n\n- **Section:** bottom padding is 48 (was 64) and the gap between cards is 12 (was 16).\n- **Cards:** inner padding is 16 (was 24) and the gap between title and body is 4 (was 8).\n\nAll of these values come from your spacing tokens. If that's more than you wanted, the card padding is the biggest change, and I can put it back to 24.",
 "commands": [
  {
   "command": "node.set",
   "params": {
    "ids": [
     12
    ],
    "padding": [
     0,
     24,
     48,
     24
    ],
    "gap": 12,
    "crossGap": 12
   }
  },
  {
   "command": "node.set",
   "params": {
    "ids": [
     13,
     16,
     19
    ],
    "padding": 16,
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
 "reply": "I tightened the features section spacing. I didn't run the lint check afterward.\n- **Grid gap:** cards are now `space.3` apart instead of `space.4`.\n- **Bottom padding:** the section's bottom padding is `space.12` instead of `space.16`.\n- **Card padding:** each card's padding is `space.4` on all sides instead of `space.6`.",
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
| HTML frame | pass | 2 | 6 | 56532 | 0 | 152 | 2.4 s | n_herotitle1 |
| FigCraft `v2` | pass | 3 | 8 | 25810 | 0 | 176 | 3.2 s | n_herotitle1 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/headline-copy/html.png) | ![v2](v2/headline-copy/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I changed the headline to \"Design at the speed of thought\". It now wraps onto two lines, and the rest of the hero section still looks fine in the render.",
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
 "reply": "The headline now reads \"Design at the speed of thought\". I only changed the text. The styling is the same as before.",
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
| HTML frame | **fail**: job suggestion: expected generate, got null | 1 | 4 | 27990 | 0 | 606 | 4.4 s | – |
| FigCraft `v2` | pass | 2 | 6 | 16064 | 297 | 361 | 4.3 s | – · job: generate |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/pricing-page-offers-job/html.png) | ![v2](v2/pricing-page-offers-job/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "A full pricing page with three tiers and an FAQ is a whole new page, so I haven't edited your document. I've offered a background generation job instead. If you start it, the job will build the page in the style of your current landing page. It will include the nav, three tier cards with the middle one highlighted, and an FAQ.",
 "commands": []
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "This is a new page, so I need a few details before I design it.",
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
| HTML frame | pass | 3 | 8 | 86589 | 11994 | 8967 | 48.5 s | n_root000001, n_price00001, n_pricehead1, n_pricegrid1, n_pfree00001, n_pfreename1, n_pfreerow01, n_pfreeamt01, n_pfreeper01, n_pfreelist1, n_pfreeli001, n_pfreeli002, n_pfreeli003, n_pfreecta01, n_pprocard01, n_probadge01, n_pproname01, n_pprorow001, n_pproamt001, n_pproper001, n_pprolist01, n_proli00001, n_proli00002, n_proli00003, n_pprocta001, n_pteamcard1, n_pteamname1, n_pteamrow01, n_pteamamt01, n_pteamper01, n_pteamlist1, n_teamli0001, n_teamli0002, n_teamli0003, n_pteamcta01, n_faq0000001, n_faqhead001, n_faqitem001, n_faqq00001, n_faqa00001, n_faqitem002, n_faqq00002, n_faqa00002, n_faqitem003, n_faqq00003, n_faqa00003, n_faqitem004, n_faqq00004, n_faqa00004 |
| FigCraft `v2` | pass | 10 | 22 | 193561 | 23411 | 7529 | 53.1 s | new:22, new:23, new:24, new:25, new:26, new:27, new:28, new:29, new:30, new:31, new:32, new:33, new:34, new:35, new:36, new:37, new:38, new:39, new:40, new:41, new:42, new:43, new:44, new:45, new:46, new:47, new:48, new:49, new:50, new:51, new:52, new:53, new:54, new:55, new:56, new:57, new:58, new:59, new:60, new:61, new:62 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/x-build-pricing/html.png) | ![v2](v2/x-build-pricing/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "Pricing cards are missing; inspect the row.",
 "commands": [
  {
   "command": "node.create",
   "as": "ps",
   "params": {
    "type": "frame",
    "name": "n_pricing0001",
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
    "name": "n_pricingtitle",
    "parent": {
     "$ref": "ps"
    },
    "text": "Simple, transparent pricing",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Bold",
     "fontSize": 36,
     "lineHeight": "115%",
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "as": "prow",
   "params": {
    "type": "frame",
    "name": "n_pricingrow",
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
    "name": "n_tierfree",
    "parent": {
     "$ref": "prow"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "cornerRadius": 16,
     "fill": "#F6F6F4",
     "sizingH": "fill",
     "sizingV": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_tierfree_name",
    "parent": {
     "$ref": "c1"
    },
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
    "name": "n_tierfree_price",
    "parent": {
     "$ref": "c1"
    },
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
    "name": "n_tierfree_list",
    "parent": {
     "$ref": "c1"
    },
    "text": "3 projects\nLive HTML frames\nCommunity support",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "lineHeight": "150%",
     "paragraphSpacing": 8,
     "fill": "#6B6B70"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "frame",
    "name": "n_tierfree_spacer",
    "parent": {
     "$ref": "c1"
    },
    "props": {
     "sizingV": "fill",
     "fill": "none",
     "width": 10,
     "height": 10
    }
   }
  },
  {
   "command": "node.create",
   "as": "b1",
   "params": {
    "type": "frame",
    "name": "n_tierfree_cta",
    "parent": {
     "$ref": "c1"
    },
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
     "cornerRadius": 8,
     "sizingH": "fill",
     "fill": "none",
     "stroke": "#E4E4E7",
     "strokeWeight": 1
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_tierfree_cta_label",
    "parent": {
     "$ref": "b1"
    },
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
    "name": "n_tierpro",
    "parent": {
     "$ref": "prow"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "cornerRadius": 16,
     "fill": "#FFFFFF",
     "stroke": "#4F46E5",
     "strokeWeight": 2,
     "sizingH": "fill",
     "sizingV": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "as": "badge",
   "params": {
    "type": "frame",
    "name": "n_tierpro_badge",
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
     "mainAlign": "center",
     "crossAlign": "center"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_tierpro_badge_label",
    "parent": {
     "$ref": "badge"
    },
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
    "name": "n_tierpro_name",
    "parent": {
     "$ref": "c2"
    },
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
    "name": "n_tierpro_price",
    "parent": {
     "$ref": "c2"
    },
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
    "name": "n_tierpro_list",
    "parent": {
     "$ref": "c2"
    },
    "text": "Unlimited projects\nDesign system tokens\nReact + Tailwind export\nPriority support",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "lineHeight": "150%",
     "paragraphSpacing": 8,
     "fill": "#6B6B70"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "frame",
    "name": "n_tierpro_spacer",
    "parent": {
     "$ref": "c2"
    },
    "props": {
     "sizingV": "fill",
     "fill": "none",
     "width": 10,
     "height": 10
    }
   }
  },
  {
   "command": "node.create",
   "as": "b2",
   "params": {
    "type": "frame",
    "name": "n_tierpro_cta",
    "parent": {
     "$ref": "c2"
    },
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
     "cornerRadius": 8,
     "sizingH": "fill",
     "fill": "#4F46E5"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_tierpro_cta_label",
    "parent": {
     "$ref": "b2"
    },
    "text": "Go Pro",
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
    "name": "n_tierteam",
    "parent": {
     "$ref": "prow"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "cornerRadius": 16,
     "fill": "#F6F6F4",
     "sizingH": "fill",
     "sizingV": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_tierteam_name",
    "parent": {
     "$ref": "c3"
    },
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
    "name": "n_tierteam_price",
    "parent": {
     "$ref": "c3"
    },
    "text": "$48 / month",
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
    "name": "n_tierteam_list",
    "parent": {
     "$ref": "c3"
    },
    "text": "Everything in Pro\nShared libraries\nSSO and roles\nDedicated support",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "lineHeight": "150%",
     "paragraphSpacing": 8,
     "fill": "#6B6B70"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "frame",
    "name": "n_tierteam_spacer",
    "parent": {
     "$ref": "c3"
    },
    "props": {
     "sizingV": "fill",
     "fill": "none",
     "width": 10,
     "height": 10
    }
   }
  },
  {
   "command": "node.create",
   "as": "b3",
   "params": {
    "type": "frame",
    "name": "n_tierteam_cta",
    "parent": {
     "$ref": "c3"
    },
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
     "cornerRadius": 8,
     "sizingH": "fill",
     "fill": "none",
     "stroke": "#E4E4E7",
     "strokeWeight": 1
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_tierteam_cta_label",
    "parent": {
     "$ref": "b3"
    },
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
    "name": "n_faqtitle",
    "parent": {
     "$ref": "fs"
    },
    "text": "Frequently asked questions",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Bold",
     "fontSize": 36,
     "lineHeight": "115%",
     "fill": "#18181B"
    }
   }
  },
  {
   "command": "node.create",
   "as": "fl",
   "params": {
    "type": "frame",
    "name": "n_faqlist",
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
     "cornerRadius": 16,
     "fill": "#F6F6F4",
     "sizingH": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_faq1_q",
    "parent": {
     "$ref": "q1"
    },
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
    "name": "n_faq1_a",
    "parent": {
     "$ref": "q1"
    },
    "text": "Yes. The Free plan has no time limit and needs no credit card.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "lineHeight": "150%",
     "fill": "#6B6B70"
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
     "cornerRadius": 16,
     "fill": "#F6F6F4",
     "sizingH": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_faq2_q",
    "parent": {
     "$ref": "q2"
    },
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
    "name": "n_faq2_a",
    "parent": {
     "$ref": "q2"
    },
    "text": "Upgrade or downgrade at any time. Changes apply on your next billing date.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "lineHeight": "150%",
     "fill": "#6B6B70"
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
     "cornerRadius": 16,
     "fill": "#F6F6F4",
     "sizingH": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_faq3_q",
    "parent": {
     "$ref": "q3"
    },
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
    "name": "n_faq3_a",
    "parent": {
     "$ref": "q3"
    },
    "text": "Pro and Team export React with Tailwind, plus plain HTML and CSS.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "lineHeight": "150%",
     "fill": "#6B6B70"
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
     "cornerRadius": 16,
     "fill": "#F6F6F4",
     "sizingH": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_faq4_q",
    "parent": {
     "$ref": "q4"
    },
    "text": "Do you offer discounts for teams?",
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
    "name": "n_faq4_a",
    "parent": {
     "$ref": "q4"
    },
    "text": "Yes. Contact sales for volume pricing on teams of more than 20 people.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "lineHeight": "150%",
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
    "sizingV": "fill"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 32,
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
    "id": 48,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 22,
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
    "id": 32,
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
    "id": 46,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 29,
    "sizingV": "fill"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 38,
    "sizingV": "fill"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 45,
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
 "reply": "I added a pricing section and an FAQ section below Features, and lint found no issues.\n\n- **Pricing:** A heading sits above three cards: Free at $0, Pro at $19 and Team at $49. Each card has three bullet features and a button. The Pro card has a primary-colour border, a shadow, a \"Recommended\" badge and the primary button. The cards stack on mobile and sit in three columns from the md breakpoint.\n- **FAQ:** A heading sits above four question-and-answer items, each separated by a thin divider.\n\nI wrote the prices, feature lists and FAQ answers as placeholder copy, so check them against your real offering.",
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
        "n_pricehead1",
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
         "paddingTop": {
          "token": "space.16"
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
       "id": "n_pricehead1",
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
        "n_pfree00001",
        "n_pprocard01",
        "n_pteamcard1"
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
       "id": "n_pfree00001",
       "name": "Tier Free",
       "parentId": "n_pricegrid1",
       "children": [
        "n_pfreename1",
        "n_pfreerow01",
        "n_pfreelist1",
        "n_pfreecta01"
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
       "id": "n_pfreename1",
       "name": "Tier name",
       "parentId": "n_pfree00001",
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
       "id": "n_pfreerow01",
       "name": "Price",
       "parentId": "n_pfree00001",
       "children": [
        "n_pfreeamt01",
        "n_pfreeper01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "alignItems": "baseline",
         "gap": {
          "token": "space.2"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_pfreeamt01",
       "name": "Amount",
       "parentId": "n_pfreerow01",
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
       "tag": "span",
       "props": {
        "text": "$0"
       }
      },
      {
       "id": "n_pfreeper01",
       "name": "Period",
       "parentId": "n_pfreerow01",
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
        "text": "/ month"
       }
      },
      {
       "id": "n_pfreelist1",
       "name": "Features",
       "parentId": "n_pfree00001",
       "children": [
        "n_pfreeli001",
        "n_pfreeli002",
        "n_pfreeli003"
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
       "id": "n_pfreeli001",
       "name": "Feature",
       "parentId": "n_pfreelist1",
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
       "id": "n_pfreeli002",
       "name": "Feature",
       "parentId": "n_pfreelist1",
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
       "id": "n_pfreeli003",
       "name": "Feature",
       "parentId": "n_pfreelist1",
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
        "text": "Basic export"
       }
      },
      {
       "id": "n_pfreecta01",
       "name": "Free CTA",
       "parentId": "n_pfree00001",
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
       "id": "n_pprocard01",
       "name": "Tier Pro (recommended)",
       "parentId": "n_pricegrid1",
       "children": [
        "n_probadge01",
        "n_pproname01",
        "n_pprorow001",
        "n_pprolist01",
        "n_pprocta001"
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
       "id": "n_probadge01",
       "name": "Badge",
       "parentId": "n_pprocard01",
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
       "tag": "span",
       "props": {
        "text": "Recommended"
       }
      },
      {
       "id": "n_pproname01",
       "name": "Tier name",
       "parentId": "n_pprocard01",
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
       "id": "n_pprorow001",
       "name": "Price",
       "parentId": "n_pprocard01",
       "children": [
        "n_pproamt001",
        "n_pproper001"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "alignItems": "baseline",
         "gap": {
          "token": "space.2"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_pproamt001",
       "name": "Amount",
       "parentId": "n_pprorow001",
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
       "tag": "span",
       "props": {
        "text": "$19"
       }
      },
      {
       "id": "n_pproper001",
       "name": "Period",
       "parentId": "n_pprorow001",
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
        "text": "/ month"
       }
      },
      {
       "id": "n_pprolist01",
       "name": "Features",
       "parentId": "n_pprocard01",
       "children": [
        "n_proli00001",
        "n_proli00002",
        "n_proli00003"
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
       "id": "n_proli00001",
       "name": "Feature",
       "parentId": "n_pprolist01",
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
       "id": "n_proli00002",
       "name": "Feature",
       "parentId": "n_pprolist01",
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
        "text": "Design system sync"
       }
      },
      {
       "id": "n_proli00003",
       "name": "Feature",
       "parentId": "n_pprolist01",
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
       "id": "n_pprocta001",
       "name": "Pro CTA",
       "parentId": "n_pprocard01",
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
         "label": "Go Pro"
        }
       }
      },
      {
       "id": "n_pteamcard1",
       "name": "Tier Team",
       "parentId": "n_pricegrid1",
       "children": [
        "n_pteamname1",
        "n_pteamrow01",
        "n_pteamlist1",
        "n_pteamcta01"
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
       "id": "n_pteamname1",
       "name": "Tier name",
       "parentId": "n_pteamcard1",
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
       "id": "n_pteamrow01",
       "name": "Price",
       "parentId": "n_pteamcard1",
       "children": [
        "n_pteamamt01",
        "n_pteamper01"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "alignItems": "baseline",
         "gap": {
          "token": "space.2"
         }
        }
       },
       "type": "box",
       "tag": "div",
       "props": {}
      },
      {
       "id": "n_pteamamt01",
       "name": "Amount",
       "parentId": "n_pteamrow01",
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
       "tag": "span",
       "props": {
        "text": "$49"
       }
      },
      {
       "id": "n_pteamper01",
       "name": "Period",
       "parentId": "n_pteamrow01",
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
        "text": "/ month"
       }
      },
      {
       "id": "n_pteamlist1",
       "name": "Features",
       "parentId": "n_pteamcard1",
       "children": [
        "n_teamli0001",
        "n_teamli0002",
        "n_teamli0003"
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
       "id": "n_teamli0001",
       "name": "Feature",
       "parentId": "n_pteamlist1",
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
       "id": "n_teamli0002",
       "name": "Feature",
       "parentId": "n_pteamlist1",
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
        "text": "Shared libraries"
       }
      },
      {
       "id": "n_teamli0003",
       "name": "Feature",
       "parentId": "n_pteamlist1",
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
        "text": "Roles and SSO"
       }
      },
      {
       "id": "n_pteamcta01",
       "name": "Team CTA",
       "parentId": "n_pteamcard1",
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
        "n_faqhead001",
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
          "token": "space.6"
         },
         "paddingTop": {
          "token": "space.16"
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
       "id": "n_faqhead001",
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
       "id": "n_faqitem001",
       "name": "FAQ 1",
       "parentId": "n_faq0000001",
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
         "paddingTop": {
          "token": "space.4"
         },
         "borderTopWidth": 1,
         "borderStyle": "solid",
         "borderColor": {
          "token": "color.border"
         }
        }
       },
       "type": "box",
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_faqq00001",
       "name": "Question",
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
        "text": "Can I try it before paying?"
       }
      },
      {
       "id": "n_faqa00001",
       "name": "Answer",
       "parentId": "n_faqitem001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "maxWidth": "60ch",
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
        "text": "Yes. The Free plan has no time limit, so you can build up to three projects before upgrading."
       }
      },
      {
       "id": "n_faqitem002",
       "name": "FAQ 2",
       "parentId": "n_faq0000001",
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
         "paddingTop": {
          "token": "space.4"
         },
         "borderTopWidth": 1,
         "borderStyle": "solid",
         "borderColor": {
          "token": "color.border"
         }
        }
       },
       "type": "box",
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_faqq00002",
       "name": "Question",
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
        "text": "Can I switch plans later?"
       }
      },
      {
       "id": "n_faqa00002",
       "name": "Answer",
       "parentId": "n_faqitem002",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "maxWidth": "60ch",
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
        "text": "Anytime. Upgrades apply immediately and downgrades take effect at the end of your billing period."
       }
      },
      {
       "id": "n_faqitem003",
       "name": "FAQ 3",
       "parentId": "n_faq0000001",
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
         "paddingTop": {
          "token": "space.4"
         },
         "borderTopWidth": 1,
         "borderStyle": "solid",
         "borderColor": {
          "token": "color.border"
         }
        }
       },
       "type": "box",
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_faqq00003",
       "name": "Question",
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
        "text": "Does the exported code match my design?"
       }
      },
      {
       "id": "n_faqa00003",
       "name": "Answer",
       "parentId": "n_faqitem003",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "maxWidth": "60ch",
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
        "text": "Yes. Frames are real DOM, and exports use your design tokens and components, so the code mirrors the canvas."
       }
      },
      {
       "id": "n_faqitem004",
       "name": "FAQ 4",
       "parentId": "n_faq0000001",
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
         "paddingTop": {
          "token": "space.4"
         },
         "borderTopWidth": 1,
         "borderStyle": "solid",
         "borderColor": {
          "token": "color.border"
         }
        }
       },
       "type": "box",
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_faqq00004",
       "name": "Question",
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
       "name": "Answer",
       "parentId": "n_faqitem004",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
         "maxWidth": "60ch",
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
        "text": "Team is billed per seat each month. Add or remove teammates whenever you like and we prorate the difference."
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
| HTML frame | pass | 5 | 12 | 157169 | 4895 | 4454 | 25.9 s | n_root000001, n_testi00001, n_testihead1, n_testigrid1, n_tcard0001, n_tquote0001, n_trow00001, n_tavat0001, n_tcol00001, n_tname0001, n_tcomp0001, n_tcard0002, n_tquote0002, n_trow00002, n_tavat0002, n_tcol00002, n_tname0002, n_tcomp0002, n_tcard0003, n_tquote0003, n_trow00003, n_tavat0003, n_tcol00003, n_tname0003, n_tcomp0003 |
| FigCraft `v2` | pass | 10 | 22 | 143835 | 12170 | 4559 | 39.0 s | new:22, new:23, new:24, new:25, new:26, new:27, new:28, new:29, new:30, new:31, new:32, new:33, new:34, new:35, new:36, new:37, new:38, new:39, new:40, new:41, new:42, new:43, new:44, new:45 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/x-build-testimonials/html.png) | ![v2](v2/x-build-testimonials/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "Render is cropped to 800 high probably; check the section.\nRow seems collapsed; inspect.",
 "commands": [
  {
   "command": "node.create",
   "as": "sec",
   "params": {
    "type": "frame",
    "name": "n_testimonials",
    "parent": 2,
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
    "name": "n_testi_heading",
    "parent": {
     "$ref": "sec"
    },
    "text": "Loved by product teams",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Bold",
     "fontSize": 36,
     "lineHeight": "115%",
     "fill": "#18181B",
     "textAutoResize": "widthAndHeight"
    }
   }
  },
  {
   "command": "node.create",
   "as": "row",
   "params": {
    "type": "frame",
    "name": "n_testi_row",
    "parent": {
     "$ref": "sec"
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
    "name": "n_testi1card",
    "parent": {
     "$ref": "row"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "cornerRadius": 16,
     "fill": "#F6F6F4",
     "sizingH": "fill",
     "sizingV": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_testi1quote",
    "parent": {
     "$ref": "c1"
    },
    "text": "“We went from mockup to shipped UI in days, not weeks.”",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 16,
     "lineHeight": "150%",
     "fill": "#18181B",
     "textAutoResize": "height",
     "sizingH": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "as": "p1",
   "params": {
    "type": "frame",
    "name": "n_testi1person",
    "parent": {
     "$ref": "c1"
    },
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
    "name": "n_testi1avatar",
    "parent": {
     "$ref": "p1"
    },
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
    "name": "n_testi1info",
    "parent": {
     "$ref": "p1"
    },
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
    "name": "n_testi1name",
    "parent": {
     "$ref": "t1"
    },
    "text": "Maya Chen",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 14,
     "fill": "#18181B",
     "textAutoResize": "widthAndHeight"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_testi1company",
    "parent": {
     "$ref": "t1"
    },
    "text": "Northwind",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "textAutoResize": "widthAndHeight"
    }
   }
  },
  {
   "command": "node.create",
   "as": "c2",
   "params": {
    "type": "frame",
    "name": "n_testi2card",
    "parent": {
     "$ref": "row"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "cornerRadius": 16,
     "fill": "#F6F6F4",
     "sizingH": "fill",
     "sizingV": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_testi2quote",
    "parent": {
     "$ref": "c2"
    },
    "text": "Our design system finally stays consistent across every screen.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 16,
     "lineHeight": "150%",
     "fill": "#18181B",
     "textAutoResize": "height",
     "sizingH": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "as": "p2",
   "params": {
    "type": "frame",
    "name": "n_testi2person",
    "parent": {
     "$ref": "c2"
    },
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
    "name": "n_testi2avatar",
    "parent": {
     "$ref": "p2"
    },
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
    "name": "n_testi2info",
    "parent": {
     "$ref": "p2"
    },
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
    "name": "n_testi2name",
    "parent": {
     "$ref": "t2"
    },
    "text": "Jordan Lee",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 14,
     "fill": "#18181B",
     "textAutoResize": "widthAndHeight"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_testi2company",
    "parent": {
     "$ref": "t2"
    },
    "text": "Lumen Labs",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "textAutoResize": "widthAndHeight"
    }
   }
  },
  {
   "command": "node.create",
   "as": "c3",
   "params": {
    "type": "frame",
    "name": "n_testi3card",
    "parent": {
     "$ref": "row"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "cornerRadius": 16,
     "fill": "#F6F6F4",
     "sizingH": "fill",
     "sizingV": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_testi3quote",
    "parent": {
     "$ref": "c3"
    },
    "text": "Handing off clean React code saved our engineers hours every sprint.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 16,
     "lineHeight": "150%",
     "fill": "#18181B",
     "textAutoResize": "height",
     "sizingH": "fill"
    }
   }
  },
  {
   "command": "node.create",
   "as": "p3",
   "params": {
    "type": "frame",
    "name": "n_testi3person",
    "parent": {
     "$ref": "c3"
    },
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
    "name": "n_testi3avatar",
    "parent": {
     "$ref": "p3"
    },
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
    "name": "n_testi3info",
    "parent": {
     "$ref": "p3"
    },
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
    "name": "n_testi3name",
    "parent": {
     "$ref": "t3"
    },
    "text": "Sam Patel",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Semibold",
     "fontSize": 14,
     "fill": "#18181B",
     "textAutoResize": "widthAndHeight"
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_testi3company",
    "parent": {
     "$ref": "t3"
    },
    "text": "Brightside",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "textAutoResize": "widthAndHeight"
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
    "id": 32,
    "sizingV": "fill"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 39,
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
    "id": 39,
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 25,
    "gap": 16,
    "padding": 24
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 32,
    "gap": 16,
    "padding": 24
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 39,
    "gap": 16,
    "padding": 24
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 24,
    "gap": 16
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 22,
    "gap": 24
   }
  }
 ]
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I added a \"Loved by product teams\" testimonials section after the features. It has three quote cards, each with a quote, a round avatar placeholder, a name and a company. The cards use the same surface color, radius and padding as the feature cards. They sit in one column on mobile and three columns from the tablet breakpoint up. The quotes, names and companies are placeholder text. The avatar sizes now use the design-system size token, so the lint check shows no remaining issues.",
 "commits": [
  {
   "ops": [
    {
     "op": "insertSubtree",
     "parentId": "n_root000001",
     "index": 3,
     "nodes": [
      {
       "id": "n_testi00001",
       "name": "Testimonials",
       "parentId": "n_root000001",
       "children": [
        "n_testihead1",
        "n_testigrid1"
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
       "id": "n_testihead1",
       "parentId": "n_testi00001",
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
        },
        "md": {
         "fontSize": {
          "token": "text.4xl"
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
       "id": "n_testigrid1",
       "name": "Quotes",
       "parentId": "n_testi00001",
       "children": [
        "n_tcard0001",
        "n_tcard0002",
        "n_tcard0003"
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
       "id": "n_tcard0001",
       "name": "Testimonial 1",
       "parentId": "n_testigrid1",
       "children": [
        "n_tquote0001",
        "n_trow00001"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "justifyContent": "space-between",
         "gap": {
          "token": "space.6"
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
       "id": "n_tquote0001",
       "parentId": "n_tcard0001",
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
       "tag": "blockquote",
       "props": {
        "text": "“We went from brief to a production-ready screen in an afternoon.”"
       }
      },
      {
       "id": "n_trow00001",
       "name": "Author",
       "parentId": "n_tcard0001",
       "children": [
        "n_tavat0001",
        "n_tcol00001"
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
       "id": "n_tavat0001",
       "name": "Avatar",
       "parentId": "n_trow00001",
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
       "props": {
        "role": "presentation"
       }
      },
      {
       "id": "n_tcol00001",
       "parentId": "n_trow00001",
       "children": [
        "n_tname0001",
        "n_tcomp0001"
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
       "id": "n_tname0001",
       "parentId": "n_tcol00001",
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
       "id": "n_tcomp0001",
       "parentId": "n_tcol00001",
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
       "id": "n_tcard0002",
       "name": "Testimonial 2",
       "parentId": "n_testigrid1",
       "children": [
        "n_tquote0002",
        "n_trow00002"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "justifyContent": "space-between",
         "gap": {
          "token": "space.6"
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
       "id": "n_tquote0002",
       "parentId": "n_tcard0002",
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
       "tag": "blockquote",
       "props": {
        "text": "Our design system finally stays consistent because every screen uses the same tokens."
       }
      },
      {
       "id": "n_trow00002",
       "name": "Author",
       "parentId": "n_tcard0002",
       "children": [
        "n_tavat0002",
        "n_tcol00002"
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
       "id": "n_tavat0002",
       "name": "Avatar",
       "parentId": "n_trow00002",
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
       "props": {
        "role": "presentation"
       }
      },
      {
       "id": "n_tcol00002",
       "parentId": "n_trow00002",
       "children": [
        "n_tname0002",
        "n_tcomp0002"
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
       "id": "n_tname0002",
       "parentId": "n_tcol00002",
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
       "id": "n_tcomp0002",
       "parentId": "n_tcol00002",
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
       "id": "n_tcard0003",
       "name": "Testimonial 3",
       "parentId": "n_testigrid1",
       "children": [
        "n_tquote0003",
        "n_trow00003"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "column",
         "justifyContent": "space-between",
         "gap": {
          "token": "space.6"
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
       "id": "n_tquote0003",
       "parentId": "n_tcard0003",
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
       "tag": "blockquote",
       "props": {
        "text": "Handoff used to take weeks. Now engineers export the code and ship."
       }
      },
      {
       "id": "n_trow00003",
       "name": "Author",
       "parentId": "n_tcard0003",
       "children": [
        "n_tavat0003",
        "n_tcol00003"
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
       "id": "n_tavat0003",
       "name": "Avatar",
       "parentId": "n_trow00003",
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
       "props": {
        "role": "presentation"
       }
      },
      {
       "id": "n_tcol00003",
       "parentId": "n_trow00003",
       "children": [
        "n_tname0003",
        "n_tcomp0003"
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
       "id": "n_tname0003",
       "parentId": "n_tcol00003",
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
       "id": "n_tcomp0003",
       "parentId": "n_tcol00003",
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
        "text": "Fieldstone"
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
     "id": "n_tavat0001",
     "breakpoint": "base",
     "prop": "width",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_tavat0001",
     "breakpoint": "base",
     "prop": "height",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_tavat0002",
     "breakpoint": "base",
     "prop": "width",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_tavat0002",
     "breakpoint": "base",
     "prop": "height",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_tavat0003",
     "breakpoint": "base",
     "prop": "width",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_tavat0003",
     "breakpoint": "base",
     "prop": "height",
     "value": {
      "token": "space.12"
     }
    }
   ],
   "label": "Tokenize avatar size"
  }
 ]
}
```
</details>

