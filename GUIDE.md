# Right of Way — Player Guide

You're building a transmission grid. Place towers, string power lines between them, keep the network energized, and survive the storms that come for it. There are no menus — everything happens by clicking directly in the world.

## Core loop

- **Click empty ground** to place a tower there.
- **Click a tower** to select it (it turns orange).
- **Click a second tower** while one is selected to string a line between them. The line sags into a real catenary curve, strings itself in, then energizes and glows green.
- **Click the selected tower again** to deselect it without stringing anything.

That's the whole interaction model. Nothing else needs a mode switch.

## Economy

Two resources, shown top-left:

- **CapEx** — capital. Earned passively from every energized line, every second. Spent on placing towers.
- **Crew-Hours** — labor. Regenerates on its own up to a cap. Spent on stringing lines and upgrading towers.

Placing towers gets pricier as your network grows — each tower already on the board adds a little to the cost of the next one. Terrain multiplies that cost further (see below). Stringing a line costs Crew-Hours, scaled by how far apart the two towers are — short hops are cheap, long ones add up. Terrain matters here too: a line with an end on a hill or marsh costs more Crew-Hours to string than the same line over flat ground.

If you can't afford something, the attempted action shakes and denies instead of going through.

## Terrain

The ground isn't uniform. Four types, all rendered as tinted patches:

- **Flat** — no modifier, the default.
- **Hill** — buildable, but towers cost more here (steeper installation), and lines strung to a hilltop tower cost more Crew-Hours too.
- **Marsh** — buildable, costs even more than a hill for both towers and lines (soft, unstable ground needs more reinforcement). Marsh ground is also more storm-prone — lines with an end on marsh get struck more often.
- **Water** — not buildable at all.

Hover the ground before clicking to see the placement preview change opacity based on whether you can currently afford it.

## Storms and repairs

Storms strike periodically and fault a random energized line, turning it red with a pulsing alarm. A faulted line stops earning CapEx until repaired.

- A few seconds before each storm check, you get a warning — a low rumble and a **STORM ROLLING IN** line in the HUD. It's a heads-up that weather is approaching, not a promise something will actually be hit — whether a strike lands (and what it hits) is still decided at the moment the storm actually arrives.
- **Click a faulted (red) line** to repair it, for a flat CapEx + Crew-Hours cost.
- Storms get more frequent as your network grows, but never faster than a hard floor — the game won't spiral into constant storms no matter how big you get.
- Storms never strike your *only* energized line, and never strike at all until your network has had time to establish itself. You can't be wiped out by an unlucky first storm.
- Lines with a marsh endpoint are more likely to be picked as a storm's target. A Resilience-branch tower (see below) makes its own lines noticeably less likely to be struck.

## Permitting

Every newly placed tower spends a short time in a pending state — visibly pulsing, translucent — before it can be selected or wired into a line. Clicking a pending tower shakes and denies rather than selecting it. This applies to every tower, no exceptions, so it's worth planning your placements a little ahead rather than one at a time.

## Upgrading towers

Select a tower and press a key to upgrade it. Tier 1 towers support 2 lines; upgrading raises that ceiling.

- **`U`** — upgrade. At tier 1, this is the only option and takes you to tier 2. At tier 2, `U` continues to be the default upgrade path: the **Capacity** branch, pushing your connection limit to the highest tier available.
- **`I`** — only does something at tier 2. Takes the **Resilience** branch instead: your final tier keeps a lower connection limit than Capacity, but every line connected to this tower becomes meaningfully less likely to be picked as a storm's target.

There's no picker menu — the HUD context line shows both options and their costs the moment a tier-2 tower is selected. Pick whichever fits the spot: a hub tower deep in your network probably wants Capacity; a tower anchoring a line across risky terrain probably wants Resilience.

Higher tiers visibly grow more cross-arms and insulator strings lower on the shaft — the number of insulators you can see on a tower is always exactly how many lines it can carry. A maxed-out Capacity tower visibly bristles with connection points; a Resilience tower shows a reinforced double-arm instead of extra line capacity.

## Camera

- **Right-click and drag** to pan.
- **Scroll wheel** to zoom, eased rather than snapping instantly.

## Hotkeys

- **`U`** — upgrade the selected tower (the Capacity branch, once at tier 2).
- **`I`** — upgrade the selected tower via the Resilience branch (tier 2 only).
- **`Shift` + `R`** — **reset.** Wipes your save and starts a fresh game immediately. No confirmation, no undo.

## Reading the HUD

- **Top-left panel** — CapEx and Crew-Hours, live.
- **Red line (blinking)** — appears only when something's faulted, with a live fault count and repair cost.
- **Red line (steady)** — a storm warning: weather's rolling in, a check is imminent. Not blinking, so you can always tell it apart from a real, active fault.
- **Orange line** — context for whatever's currently selected (a tower's tier, upgrade options and costs).
- **Dim line** — an onboarding hint for your first few actions. It stops appearing once you've placed two towers and strung a line, and never comes back.

Your progress autosaves continuously — closing the tab and coming back picks up right where you left off.
