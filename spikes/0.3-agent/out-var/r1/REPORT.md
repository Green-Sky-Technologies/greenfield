# Story 0.3: can Claude draw? FigCraft commands vs HTML frames

Model `claude-sonnet-5-5` via gateway-oidc, same model for both arms. Generated 2026-11-24T16:35:09.881Z.

## Summary

Tokens are totals over the 6 cases; turns and wall time are per-case means.

| Arm / variant | Pass | Input (uncached) | Cache read | Cache write | Output | Est. cost | Turns | Wall |
|---|---|---|---|---|---|---|---|---|
| HTML frame (current agent) | 6/8 | 54 | 568642 | 14265 | 16103 | $0.3105 | 2.4 | 11.9 s |
| FigCraft `v2` | 8/8 | 72 | 326459 | 32206 | 13564 | $0.2816 | 3.5 | 14.0 s |

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
| HTML frame | **fail**: job suggestion: expected alternatives, got null | 1 | 4 | 27993 | 0 | 616 | 4.7 s | – |
| FigCraft `v2` | pass | 2 | 6 | 16070 | 354 | 400 | 4.6 s | – · job: alternatives |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/alternatives-offers-job/html.png) | ![v2](v2/alternatives-offers-job/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I haven't changed the page. Comparing several layouts means building multiple alternative frames, so I've offered a background job for it. It would produce 3 alternatives of the page using your existing copy and tokens. If you start it, you can compare them side by side.",
 "commands": []
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I'll set up a few layout alternatives for you to compare. First, a few quick questions so they fit what you want.",
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
| HTML frame | pass | 2 | 6 | 55765 | 0 | 466 | 3.9 s | n_herocta001 |
| FigCraft `v2` | pass | 3 | 8 | 23078 | 257 | 245 | 4.0 s | n_herocta001 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/button-larger-scoped/html.png) | ![v2](v2/button-larger-scoped/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I made the button larger. I increased the padding from 8/16 to 16/24 and the label size from 14 to 18. The button still hugs its content. The fill, the 8px corner radius and the Semibold weight are unchanged. I checked the render and it looks right.",
 "commands": [
  {
   "command": "node.set",
   "params": {
    "id": 10,
    "padding": [
     16,
     24,
     16,
     24
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
 "reply": "I made the CTA button larger by increasing its padding and setting its font size to `text.lg`. The padding is now `space.4` on top and bottom and `space.8` on the sides. Lint found no issues.",
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
| HTML frame | pass | 2 | 6 | 59368 | 1787 | 1741 | 11.7 s | – |
| FigCraft `v2` | pass | 2 | 6 | 21208 | 2037 | 1497 | 11.2 s | new:22, new:23, new:24, new:25, new:26, new:27, new:28, n_features01 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/density-slider/html.png) | ![v2](v2/density-slider/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I added a segmented density control (Compact / Default / Spacious) above the feature cards. \"Default\" is selected. It sits in the features section, spans all three columns, and uses the existing tokens.\n\nIt's a static design element only. I didn't wire it to change the cards' padding or gap, so the cards still look the same whichever option is selected.",
 "commands": [
  {
   "command": "node.create",
   "as": "c",
   "params": {
    "type": "frame",
    "parent": 12,
    "index": 0,
    "name": "n_densityctl01",
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
     "strokeWeight": 1,
     "gridColumn": 0,
     "gridRow": 0,
     "gridColumnSpan": 3
    }
   }
  },
  {
   "command": "node.create",
   "as": "o1",
   "params": {
    "type": "frame",
    "parent": {
     "$ref": "c"
    },
    "name": "n_densityopt1",
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
    "name": "n_densityopt1_label",
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
     "$ref": "c"
    },
    "name": "n_densityopt2",
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
    "name": "n_densityopt2_label",
    "text": "Default",
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
     "$ref": "c"
    },
    "name": "n_densityopt3",
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
    "name": "n_densityopt3_label",
    "text": "Spacious",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Medium",
     "fontSize": 14,
     "fill": "#6B6B70"
    }
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 12,
    "crossGap": 16
   }
  }
 ]
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I added a \"Card density\" slider. It controls the card padding, the space between the title and body inside each card, and the gap between the three cards. It runs from 12 to 48 and starts at 24, which matches the current look. Lower values make the cards tighter and higher values make them roomier.\n\nI didn't run lint on this change.",
 "commits": [
  {
   "ops": [
    {
     "op": "upsertSlider",
     "slider": {
      "id": "s_density01",
      "label": "Card density",
      "min": 12,
      "max": 48,
      "step": 4,
      "value": 24,
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
         "to": 48,
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
         "to": 48,
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
         "to": 48,
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
         "to": 48,
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
         "to": 48,
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
         "to": 48,
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
         "to": 48,
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
         "to": 48,
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
         "to": 48,
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
         "to": 48,
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
         "to": 48,
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
         "to": 48,
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
| HTML frame | pass | 2 | 6 | 60305 | 0 | 941 | 6.2 s | n_features01, n_feat1card00, n_feat2card00, n_feat3card00 |
| FigCraft `v2` | pass | 2 | 6 | 21202 | 708 | 477 | 5.1 s | n_features01, n_feat1card00, n_feat2card00, n_feat3card00 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/feature-cards-spacing/html.png) | ![v2](v2/feature-cards-spacing/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I tightened the spacing in the features section. I rendered it once afterward, and it looks fine.\n\n- **Section:** bottom padding went from 64 to 48, and the gap between cards went from 16 to 12.\n- **Cards:** inner padding went from 24 to 16, and the gap between each title and its body text went from 8 to 4.\n\nI used values from the spacing tokens.",
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
 "reply": "I tightened the spacing in the features section. I didn't run the lint check on these edits.\n\n- **Grid:** The gap between cards went from `space.4` to `space.3`, and the bottom padding from `space.16` to `space.12`.\n- **Cards:** The padding inside each card went from `space.6` to `space.4`.",
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
| HTML frame | pass | 2 | 6 | 56532 | 0 | 163 | 2.3 s | n_herotitle1 |
| FigCraft `v2` | pass | 3 | 8 | 25810 | 0 | 184 | 3.5 s | n_herotitle1 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/headline-copy/html.png) | ![v2](v2/headline-copy/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I changed the headline to \"Design at the speed of thought\". I checked the render. The new text wraps onto two lines, and the layout still looks fine. I didn't change anything else.",
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
 "reply": "I changed the headline to \"Design at the speed of thought\". I didn't touch its styling, and I didn't run lint because this was only a text change.",
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
| HTML frame | **fail**: job suggestion: expected generate, got null | 1 | 4 | 27990 | 0 | 584 | 4.4 s | – |
| FigCraft `v2` | pass | 2 | 6 | 16064 | 258 | 306 | 4.2 s | – · job: generate |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/pricing-page-offers-job/html.png) | ![v2](v2/pricing-page-offers-job/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "A full pricing page is a new page, so I've offered it as a background generation job instead of editing this frame. If you start the job, it will build the page in the same style as your landing page. It will have three tiers and an FAQ, and I haven't changed anything in the document.",
 "commands": []
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I'll ask a few quick questions first so the pricing page fits your needs.",
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
| HTML frame | pass | 4 | 10 | 123575 | 7600 | 7122 | 37.3 s | n_root000001, n_price00001, n_pricehead1, n_pricegrid1, n_tierfree01, n_freename01, n_freeprice1, n_freelist01, n_freeli00001, n_freeli00002, n_freeli00003, n_freecta001, n_tierpro001, n_probadge001, n_proname0001, n_proprice001, n_prolist0001, n_proli000001, n_proli000002, n_proli000003, n_procta00001, n_tierteam01, n_teamname001, n_teamprice01, n_teamlist001, n_teamli00001, n_teamli00002, n_teamli00003, n_teamcta0001, n_faq0000001, n_faqhead001, n_faqlist001, n_faqitem001, n_faqq000001, n_faqa000001, n_faqitem002, n_faqq000002, n_faqa000002, n_faqitem003, n_faqq000003, n_faqa000003, n_faqitem004, n_faqq000004, n_faqa000004 |
| FigCraft `v2` | pass | 8 | 18 | 134738 | 20235 | 6865 | 46.0 s | new:22, new:23, new:24, new:25, new:26, new:27, new:28, new:29, new:30, new:31, new:32, new:33, new:34, new:35, new:36, new:37, new:38, new:39, new:40, new:41, new:42, new:43, new:44, new:45, new:46, new:47, new:48, new:49, new:50, new:51, new:52, new:53, new:54, new:55, new:56, new:57, new:58, new:59, new:60, new:61 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/x-build-pricing/html.png) | ![v2](v2/x-build-pricing/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "I added a pricing section and an FAQ section below the features, both matching the page's existing styling. The pricing section has the heading \"Simple, honest pricing\" and three cards: Free ($0), Pro ($24) and Team ($49). Each card has a price, a three-item feature list and a button at the bottom. Pro has an indigo border, a \"Recommended\" badge and a filled button. The FAQ has four question-and-answer cards.\n\nI made up the prices, feature lists and FAQ wording as placeholders, so replace them with your real details.\n\nThe pricing row has a fixed height of 400px so the three cards stay equal. If you add more lines to a card, you'll need to raise that height.",
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
     "fill": "none"
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
    "text": "Simple, honest pricing",
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
    "name": "n_pricingrow01",
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
    "name": "n_tierfree000",
    "parent": {
     "$ref": "row"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
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
     "fill": "#6B6B70",
     "lineHeight": "150%",
     "paragraphSpacing": 8,
     "sizingH": "fill",
     "textAutoResize": "height"
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
     "sizingH": "fill",
     "fill": "none"
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
     "sizingH": "fill",
     "fill": "none",
     "stroke": "#E4E4E7",
     "cornerRadius": 8
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
    "name": "n_tierpro0000",
    "parent": {
     "$ref": "row"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
     "sizingH": "fill",
     "sizingV": "fill",
     "fill": "#FFFFFF",
     "stroke": "#4F46E5",
     "strokeWeight": 2,
     "cornerRadius": 16
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
     "sizingH": "hug",
     "fill": "#4F46E5",
     "cornerRadius": 9999
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
    "text": "Unlimited projects\nDesign system tokens\nReact + Tailwind export",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%",
     "paragraphSpacing": 8,
     "sizingH": "fill",
     "textAutoResize": "height"
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
     "sizingH": "fill",
     "fill": "none"
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
     "sizingH": "fill",
     "fill": "#4F46E5",
     "cornerRadius": 8
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
    "name": "n_tierteam000",
    "parent": {
     "$ref": "row"
    },
    "props": {
     "layout": "vertical",
     "gap": 16,
     "padding": 24,
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
    "text": "$49 / month",
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
    "text": "Everything in Pro\nShared libraries\nPriority support",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%",
     "paragraphSpacing": 8,
     "sizingH": "fill",
     "textAutoResize": "height"
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
     "sizingH": "fill",
     "fill": "none"
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
     "sizingH": "fill",
     "fill": "none",
     "stroke": "#E4E4E7",
     "cornerRadius": 8
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
    "name": "n_faq00000001",
    "parent": 2,
    "props": {
     "layout": "vertical",
     "gap": 24,
     "padding": [
      64,
      24,
      96,
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
    "name": "n_faqtitle001",
    "parent": {
     "$ref": "fs"
    },
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
   "as": "q1",
   "params": {
    "type": "frame",
    "name": "n_faqitem01",
    "parent": {
     "$ref": "fs"
    },
    "props": {
     "layout": "vertical",
     "gap": 8,
     "padding": 24,
     "sizingH": "fill",
     "fill": "#F6F6F4",
     "cornerRadius": 16
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_faqitem01_q",
    "parent": {
     "$ref": "q1"
    },
    "text": "Can I try Pro before paying?",
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
    "name": "n_faqitem01_a",
    "parent": {
     "$ref": "q1"
    },
    "text": "Yes. Every Pro plan starts with a 14-day free trial, no card required.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%",
     "sizingH": "fill",
     "textAutoResize": "height"
    }
   }
  },
  {
   "command": "node.create",
   "as": "q2",
   "params": {
    "type": "frame",
    "name": "n_faqitem02",
    "parent": {
     "$ref": "fs"
    },
    "props": {
     "layout": "vertical",
     "gap": 8,
     "padding": 24,
     "sizingH": "fill",
     "fill": "#F6F6F4",
     "cornerRadius": 16
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_faqitem02_q",
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
    "name": "n_faqitem02_a",
    "parent": {
     "$ref": "q2"
    },
    "text": "Upgrade or downgrade at any time. Changes apply at your next billing date.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%",
     "sizingH": "fill",
     "textAutoResize": "height"
    }
   }
  },
  {
   "command": "node.create",
   "as": "q3",
   "params": {
    "type": "frame",
    "name": "n_faqitem03",
    "parent": {
     "$ref": "fs"
    },
    "props": {
     "layout": "vertical",
     "gap": 8,
     "padding": 24,
     "sizingH": "fill",
     "fill": "#F6F6F4",
     "cornerRadius": 16
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_faqitem03_q",
    "parent": {
     "$ref": "q3"
    },
    "text": "Is the exported code production-ready?",
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
    "name": "n_faqitem03_a",
    "parent": {
     "$ref": "q3"
    },
    "text": "Yes. Exports are clean React and Tailwind that use your design tokens.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%",
     "sizingH": "fill",
     "textAutoResize": "height"
    }
   }
  },
  {
   "command": "node.create",
   "as": "q4",
   "params": {
    "type": "frame",
    "name": "n_faqitem04",
    "parent": {
     "$ref": "fs"
    },
    "props": {
     "layout": "vertical",
     "gap": 8,
     "padding": 24,
     "sizingH": "fill",
     "fill": "#F6F6F4",
     "cornerRadius": 16
    }
   }
  },
  {
   "command": "node.create",
   "params": {
    "type": "text",
    "name": "n_faqitem04_q",
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
    "name": "n_faqitem04_a",
    "parent": {
     "$ref": "q4"
    },
    "text": "Annual billing saves 20%, and we offer education and nonprofit pricing.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70",
     "lineHeight": "150%",
     "sizingH": "fill",
     "textAutoResize": "height"
    }
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 24,
    "sizingV": "fixed",
    "height": 360
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
    "ids": [
     30,
     39,
     48,
     34,
     37,
     46
    ],
    "sizingV": "hug"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 24,
    "height": 380
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
    "id": 34,
    "textAutoResize": "widthAndHeight"
   }
  },
  {
   "command": "node.set",
   "params": {
    "id": 24,
    "height": 400
   }
  }
 ]
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I added a pricing section and an FAQ section below Features, and lint found no issues.\n\n- **Pricing:** The heading is followed by Free ($0), Pro ($24) and Team ($79) cards. Each has three bullet features and a button. Pro is highlighted with a primary-color border, a shadow, a \"Recommended\" badge and the primary button. Free and Team use the secondary button. The cards sit in three columns from the tablet breakpoint (768px) up and stack on mobile.\n- **FAQ:** A centered heading with four question-and-answer pairs.\n\nThe prices, features and FAQ answers are placeholder copy I wrote, so swap in your real details.",
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
        "n_freename01",
        "n_freeprice1",
        "n_freelist01",
        "n_freecta001"
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
          "token": "space.8"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.8"
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
       "id": "n_freename01",
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
       "id": "n_freeprice1",
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
       "id": "n_freelist01",
       "parentId": "n_tierfree01",
       "children": [
        "n_freeli00001",
        "n_freeli00002",
        "n_freeli00003"
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
       "id": "n_freeli00001",
       "parentId": "n_freelist01",
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
       "id": "n_freeli00002",
       "parentId": "n_freelist01",
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
       "id": "n_freeli00003",
       "parentId": "n_freelist01",
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
       "id": "n_freecta001",
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
        "n_probadge001",
        "n_proname0001",
        "n_proprice001",
        "n_prolist0001",
        "n_procta00001"
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
          "token": "space.8"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.8"
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
       "id": "n_probadge001",
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
       "tag": "span",
       "props": {
        "text": "Recommended"
       }
      },
      {
       "id": "n_proname0001",
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
       "id": "n_proprice001",
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
        "text": "$24 / month"
       }
      },
      {
       "id": "n_prolist0001",
       "parentId": "n_tierpro001",
       "children": [
        "n_proli000001",
        "n_proli000002",
        "n_proli000003"
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
       "id": "n_proli000001",
       "parentId": "n_prolist0001",
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
       "id": "n_proli000002",
       "parentId": "n_prolist0001",
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
       "id": "n_proli000003",
       "parentId": "n_prolist0001",
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
       "id": "n_procta00001",
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
         "label": "Go Pro"
        }
       }
      },
      {
       "id": "n_tierteam01",
       "name": "Tier Team",
       "parentId": "n_pricegrid1",
       "children": [
        "n_teamname001",
        "n_teamprice01",
        "n_teamlist001",
        "n_teamcta0001"
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
          "token": "space.8"
         },
         "paddingRight": {
          "token": "space.6"
         },
         "paddingBottom": {
          "token": "space.8"
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
       "id": "n_teamname001",
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
       "id": "n_teamprice01",
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
        "text": "$79 / month"
       }
      },
      {
       "id": "n_teamlist001",
       "parentId": "n_tierteam01",
       "children": [
        "n_teamli00001",
        "n_teamli00002",
        "n_teamli00003"
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
       "id": "n_teamli00001",
       "parentId": "n_teamlist001",
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
       "id": "n_teamli00002",
       "parentId": "n_teamlist001",
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
       "id": "n_teamli00003",
       "parentId": "n_teamlist001",
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
       "id": "n_teamcta0001",
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
        "n_faqhead001",
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
       "id": "n_faqhead001",
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
        "n_faqq000001",
        "n_faqa000001"
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
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_faqq000001",
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
       "id": "n_faqa000001",
       "parentId": "n_faqitem001",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
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
        "text": "Yes. The Free plan has no time limit, and you can upgrade whenever you're ready."
       }
      },
      {
       "id": "n_faqitem002",
       "name": "FAQ 2",
       "parentId": "n_faqlist001",
       "children": [
        "n_faqq000002",
        "n_faqa000002"
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
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_faqq000002",
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
       "id": "n_faqa000002",
       "parentId": "n_faqitem002",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
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
        "text": "Absolutely. Upgrade or downgrade at any time and billing adjusts automatically."
       }
      },
      {
       "id": "n_faqitem003",
       "name": "FAQ 3",
       "parentId": "n_faqlist001",
       "children": [
        "n_faqq000003",
        "n_faqa000003"
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
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_faqq000003",
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
        "text": "How many people can join a Team?"
       }
      },
      {
       "id": "n_faqa000003",
       "parentId": "n_faqitem003",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
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
        "text": "Team workspaces support up to 25 collaborators. Need more? Contact sales."
       }
      },
      {
       "id": "n_faqitem004",
       "name": "FAQ 4",
       "parentId": "n_faqlist001",
       "children": [
        "n_faqq000004",
        "n_faqa000004"
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
       "tag": "article",
       "props": {}
      },
      {
       "id": "n_faqq000004",
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
        "text": "Do you offer refunds?"
       }
      },
      {
       "id": "n_faqa000004",
       "parentId": "n_faqitem004",
       "children": [],
       "positioning": "flow",
       "style": {
        "base": {
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
        "text": "Yes, within 30 days of purchase, no questions asked."
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
| HTML frame | pass | 5 | 12 | 157114 | 4878 | 4470 | 24.5 s | n_root000001, n_testi000001, n_testihead01, n_testigrid01, n_tcard000001, n_tquote00001, n_tperson0001, n_tavatar0001, n_tinfo0000001, n_tname0000001, n_tcomp0000001, n_tcard000002, n_tquote00002, n_tperson0002, n_tavatar0002, n_tinfo0000002, n_tname0000002, n_tcomp0000002, n_tcard000003, n_tquote00003, n_tperson0003, n_tavatar0003, n_tinfo0000003, n_tname0000003, n_tcomp0000003 |
| FigCraft `v2` | pass | 6 | 14 | 68289 | 8357 | 3590 | 33.7 s | new:22, new:23, new:24, new:25, new:26, new:27, new:28, new:29, new:30, new:31, new:32, new:33, new:34, new:35, new:36, new:37, new:38, new:39, new:40, new:41, new:42, new:43, new:44, new:45 |

| HTML frame | FigCraft `v2` |
|---|---|
| ![html](v2/x-build-testimonials/html.png) | ![v2](v2/x-build-testimonials/figcraft.png) |

<details><summary>FigCraft <code>v2</code>: reply and commands</summary>

```json
{
 "reply": "Quotes 2 and 3 are missing their opening quote marks. I'll fix that.\nI added a \"Loved by product teams\" section after the features. It has a Bold 36px heading and three quote cards in a row. Each card has the quote, a round grey avatar placeholder, the person's name and their company. The cards use the same surface fill, 16px radius and 24px padding as the feature cards.\n\nThe render showed quotes 2 and 3 missing their opening quote marks, so I added them to both. I haven't re-rendered since that fix.\n\nThe quotes, names and companies are placeholders I made up (Maya Chen at Northwind, Daniel Ortiz at Lumen Labs, Priya Nair at Foundry). Swap in real customers when you have them.",
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
     "gap": 24,
     "padding": 24,
     "sizingH": "fill",
     "sizingV": "hug",
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
    "text": "“We went from prompt to production-ready screens in a single afternoon.”",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 16,
     "fill": "#18181B",
     "lineHeight": "150%",
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
   "as": "i1",
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
     "$ref": "i1"
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
     "$ref": "i1"
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
     "gap": 24,
     "padding": 24,
     "sizingH": "fill",
     "sizingV": "hug",
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
    "text": "Our design system finally stays consistent across every team and screen.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 16,
     "fill": "#18181B",
     "lineHeight": "150%",
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
   "as": "i2",
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
     "$ref": "i2"
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
     "$ref": "i2"
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
     "gap": 24,
     "padding": 24,
     "sizingH": "fill",
     "sizingV": "hug",
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
    "text": "Code handoff is painless. Engineers get exactly what we designed.",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 16,
     "fill": "#18181B",
     "lineHeight": "150%",
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
   "as": "i3",
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
     "$ref": "i3"
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
     "$ref": "i3"
    },
    "name": "n_testi3company",
    "text": "Foundry",
    "props": {
     "fontFamily": "SF Pro",
     "fontStyle": "Regular",
     "fontSize": 14,
     "fill": "#6B6B70"
    }
   }
  },
  {
   "command": "text.set",
   "params": {
    "id": 33,
    "text": "“Our design system finally stays consistent across every team and screen.”"
   }
  },
  {
   "command": "text.set",
   "params": {
    "id": 40,
    "text": "“Code handoff is painless. Engineers get exactly what we designed.”"
   }
  }
 ]
}
```
</details>

<details><summary>HTML frame: reply and patches</summary>

```json
{
 "reply": "I added a testimonials section after Features. It has a \"Loved by product teams\" heading and three quote cards. Each card has a quote, a round avatar placeholder, a name and a company. The cards use the same surface, radius and padding as the feature cards. They show in one column on mobile and three columns from the medium breakpoint up. Lint flagged the avatar sizes as literal values, so I switched them to the `space.12` token.\n\nThe quotes, names and companies are placeholder text. The names are Maya Chen (Northwind), Daniel Okafor (Lumen Labs) and Priya Raman (Orbit Systems).",
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
       "id": "n_testigrid01",
       "name": "Quotes",
       "parentId": "n_testi000001",
       "children": [
        "n_tcard000001",
        "n_tcard000002",
        "n_tcard000003"
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
       "id": "n_tcard000001",
       "name": "Testimonial 1",
       "parentId": "n_testigrid01",
       "children": [
        "n_tquote00001",
        "n_tperson0001"
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
       "id": "n_tquote00001",
       "parentId": "n_tcard000001",
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
       "id": "n_tperson0001",
       "parentId": "n_tcard000001",
       "children": [
        "n_tavatar0001",
        "n_tinfo0000001"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "row",
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
       "id": "n_tavatar0001",
       "name": "Avatar",
       "parentId": "n_tperson0001",
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
       "id": "n_tinfo0000001",
       "parentId": "n_tperson0001",
       "children": [
        "n_tname0000001",
        "n_tcomp0000001"
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
       "id": "n_tname0000001",
       "parentId": "n_tinfo0000001",
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
       "id": "n_tcomp0000001",
       "parentId": "n_tinfo0000001",
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
       "id": "n_tcard000002",
       "name": "Testimonial 2",
       "parentId": "n_testigrid01",
       "children": [
        "n_tquote00002",
        "n_tperson0002"
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
       "id": "n_tquote00002",
       "parentId": "n_tcard000002",
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
        "text": "Our design system finally stays consistent, because every screen uses the same tokens."
       }
      },
      {
       "id": "n_tperson0002",
       "parentId": "n_tcard000002",
       "children": [
        "n_tavatar0002",
        "n_tinfo0000002"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "row",
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
       "id": "n_tavatar0002",
       "name": "Avatar",
       "parentId": "n_tperson0002",
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
       "id": "n_tinfo0000002",
       "parentId": "n_tperson0002",
       "children": [
        "n_tname0000002",
        "n_tcomp0000002"
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
       "id": "n_tname0000002",
       "parentId": "n_tinfo0000002",
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
       "id": "n_tcomp0000002",
       "parentId": "n_tinfo0000002",
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
       "id": "n_tcard000003",
       "name": "Testimonial 3",
       "parentId": "n_testigrid01",
       "children": [
        "n_tquote00003",
        "n_tperson0003"
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
       "id": "n_tquote00003",
       "parentId": "n_tcard000003",
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
        "text": "Handoff used to take weeks. Now engineers export the code and ship it."
       }
      },
      {
       "id": "n_tperson0003",
       "parentId": "n_tcard000003",
       "children": [
        "n_tavatar0003",
        "n_tinfo0000003"
       ],
       "positioning": "flow",
       "style": {
        "base": {
         "display": "flex",
         "flexDirection": "row",
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
       "id": "n_tavatar0003",
       "name": "Avatar",
       "parentId": "n_tperson0003",
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
       "id": "n_tinfo0000003",
       "parentId": "n_tperson0003",
       "children": [
        "n_tname0000003",
        "n_tcomp0000003"
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
       "id": "n_tname0000003",
       "parentId": "n_tinfo0000003",
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
       "id": "n_tcomp0000003",
       "parentId": "n_tinfo0000003",
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
        "text": "Orbit Systems"
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
     "id": "n_tavatar0001",
     "breakpoint": "base",
     "prop": "width",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_tavatar0001",
     "breakpoint": "base",
     "prop": "height",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_tavatar0002",
     "breakpoint": "base",
     "prop": "width",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_tavatar0002",
     "breakpoint": "base",
     "prop": "height",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_tavatar0003",
     "breakpoint": "base",
     "prop": "width",
     "value": {
      "token": "space.12"
     }
    },
    {
     "op": "setStyle",
     "id": "n_tavatar0003",
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

