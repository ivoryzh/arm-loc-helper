# Listing Arm Location Helper on the IvoryOS Automation Hub

Arm Location Helper is a tool more than an instrument: each lab exports its own controller from it.
So it goes on the Hub as a **v2 plugin** (the editor as a tab in ivoryos-next), entered at
https://ivoryos.ai/hub/contribute while signed in. The controllers it exports are per-deck and are
not listed. If the Hub gains a category for skills or tools, the same package and import path apply.

## Plugin (`/hub/contribute?type=plugin`)

| Field | Value |
| --- | --- |
| Name | Arm Location Helper |
| Description | Lay out a robot arm's deck in 3D (trays, stations, side-load racks, safe points), import the waypoints of a URScript file, check reach and gripper alignment, preview every move, and export a safe pick-and-place controller for Universal Robots (ur_rtde) that IvoryOS runs as an instrument. |
| pip name | `arm-loc-helper` once it is on PyPI; until then `https://github.com/ivoryzh/arm-loc-helper.git` (the built page is in the repository, so no Node is needed) |
| Import path | `arm_loc_helper.next_plugin` |
| Module name (attribute) | `plugin` |
| Plugin API | v2 (an `ivoryos_edge` Plugin, `placement="tab"`) |
| Platforms | none required: it works with any deck (the exported controller is an ordinary instrument) |
| Screenshot | `https://raw.githubusercontent.com/ivoryzh/arm-loc-helper/main/docs/arm-loc-helper.png` |
| Demo URL | the Vercel deployment (runs entirely in the browser) |

## Order of operations

1. Merge the branch to `main` so the screenshot URL and the `git+https` install resolve.
2. Publish `arm-loc-helper` to PyPI (optional; the GitHub install works meanwhile).
3. Create the plugin entry.
