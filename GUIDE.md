# Right of Way — Player Guide

You're building a transmission grid — connecting real Power Plants to real
Neighborhoods that need power, keeping the network energized and redundant, and
surviving the storms that come for it. Place towers, string lines, build out
substations and distribution feeders, and complete milestones as neighborhoods come
online. There are no menus — everything happens by clicking directly in the world, and
the free-build sandbox underneath it all is always there too: nothing stops you from
just building for its own sake.

## Core loop

- **Click empty ground** to place a tower there.
- **Click a tower** to select it (it turns orange).
- **Click a second tower** while one is selected to string a line between them. The line sags into a real catenary curve, strings itself in, then energizes and glows green.
- **Click the selected tower again** to deselect it without stringing anything.

That's the whole interaction model. Nothing else needs a mode switch.

## Economy

Two resources, shown top-left:

- **CapEx** — capital. Earned passively from every energized line, every second (more from a line whose throughput you've upgraded — see below). Spent on placing towers.
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

## Upgrading lines

Towers aren't the only thing that upgrades — individual lines do too, independently of the towers they connect.

- **Click a healthy (green, energized) line** to try upgrading its throughput — same directness as clicking a faulted one to repair. No selection step, no menu: it either succeeds or shakes and denies.
- Each upgrade costs CapEx and Crew-Hours, and boosts how much CapEx that specific line earns per second from then on — a real investment decision, since the payoff is spread out over time rather than immediate.
- A line's thickness always tells you its tier — a thick cable is genuinely carrying more capacity, not just decorated to look that way.

## Plants, Substations & Neighborhoods

The board now has two more kinds of structure alongside your towers:

- **Power Plants** — fixed generation sources. Fuel type shows in the shape itself:
  twin stacks for coal, one tall stack for gas, a cooling-tower silhouette for nuclear,
  a dam for hydro, a tilted panel array for solar, turbines for wind. Click one to see
  its nameplate and effective (capacity-factor-adjusted) MW. Coal, gas, and nuclear
  plants burn a running fuel cost — a quiet CapEx drain, only while they're actually
  connected to the grid — while hydro/solar/wind cost essentially nothing to run beyond
  their own lower nameplate/capacity factor. Solar and wind output isn't fixed either:
  solar tracks the day/night cycle (near-zero after dark), and wind drifts up and down
  on its own slow, semi-random rhythm — you'll see its turbine blades spin faster in a
  gust and nearly stop in a lull, a real, live readout of how much power that plant is
  actually putting out right now.
- **Neighborhoods** — small house clusters that need power delivered to them. Click one
  to see its MW demand. Demand isn't flat either — it rises and falls over the course of
  each day/night cycle, peaking in the evening like a real neighborhood's load curve. A
  served Neighborhood's windows glow brighter the more demand it's currently pulling,
  and go fully dark the instant it loses power — window light never lies about whether
  the lights are actually on.
- **Substations** — the voltage-transition point between your transmission network and a
  neighborhood's local distribution. **`Shift` + click** buildable ground to place one
  instead of a regular tower (same cost/terrain-gating and permit-pending wait as a
  tower, just a distinct fenced-yard silhouette and a steeper price). Select one and
  press **`U`** to upgrade it to tier 2 — more connection slots and a higher MW ceiling,
  the same "visible insulator count = real capacity" idea as tower tiers, just without a
  branch choice.

Link a Plant, Tower, or Substation to another one by selecting one and clicking the
other, exactly like stringing a tower-to-tower line. Select a Substation and click an
unconnected Neighborhood to run its local distribution feeder — a visibly thinner,
tauter line than your transmission spans (real utility poles, not lattice towers). Each
Neighborhood ever gets one distribution feeder.

**A fully connected Neighborhood earns real money.** Once a Plant-to-Neighborhood chain
carries enough capacity to cover a Neighborhood's current demand, it starts paying
CapEx/sec on top of whatever your individual lines already earn — a completely separate
income stream, not a replacement for it. A Neighborhood that can't currently get enough
power earns nothing until you fix that. Since demand cycles and generation drifts,
"currently" is doing real work here — a chain that comfortably serves a Neighborhood at
noon might come up just short of its evening peak, or when its wind plant hits a lull.

**Blackouts.** A Neighborhood with only one path back to a Plant is "at risk" — if it
ever loses service while at risk (a storm taking out its one path, a demand peak
outrunning capacity, or a wind/solar plant's output dropping), the Neighborhood goes
fully dark (a bigger burst and a screen-tightening vignette pulse mark the moment it
happens, then a pulsing red glow across its whole cluster while it stays that way — worse
than a single faulted line) and stops earning until you restore it. A second, independent
path through a different Substation protects against all of these at once. Repairing the
fault (or otherwise restoring service) clears the blackout automatically.

**Milestones.** Every Plant+Neighborhood pair is a real objective — a status line under
the top panel tracks the most urgent one (how much of its target MW is currently served,
and whether it's redundant yet), plus a count when more than one is active at once. A
milestone completes once its Neighborhood is fully served *and* has that second
independent path (full N-1 redundancy) — served alone isn't enough. Completing one is a
real event (a bigger fanfare and burst of light, a brief bloom/vignette flash across the
whole screen, and the MILESTONES counter ticks up) and a fresh Plant+Neighborhood pair
appears elsewhere a short while later, with a different fuel type. The game never ends —
there's always another one coming, and you'll gradually take on more than one active
milestone at a time as you complete more of them.

**Demand grows.** On top of its daily rise-and-fall cycle, a Neighborhood's baseline
demand also climbs slowly and permanently over time, even after a milestone completes —
a chain that comfortably serves it today can fall behind later if you never revisit it.
A rising tone (distinct from the storm rumble) plus a steady HUD line warn you a
Neighborhood is about to outgrow its current capacity, with enough lead time to upgrade
a span's throughput or add another path before it actually stops being served.

## Camera

- **Right-click and drag** to pan.
- **Scroll wheel** to zoom, eased rather than snapping instantly.
- **`Q`** / **`E`** to rotate the view 90° at a time, eased rather than snapping — useful when a tower or line is blocking your view of what's behind it.

## Hotkeys

- **`U`** — upgrade the selected tower (the Capacity branch, once at tier 2) or the selected Substation (its only upgrade path).
- **`I`** — upgrade the selected tower via the Resilience branch (tier 2 only).
- **`Q`** / **`E`** — rotate the camera 90° left/right.
- **`Shift` + click** on buildable ground — place a Substation instead of a Tower.
- **`Shift` + `R`** — **reset.** Wipes your save and starts a fresh game immediately. No confirmation, no undo.

## Reading the HUD

- **Top-left panel** — CapEx, Crew-Hours, and your completed milestone count, live.
- **Green line** — the most urgent active milestone's status (MW served/target, served/redundant state), prefixed with a count once more than one is active at a time. Blank for a short while right after a milestone completes, before the next one appears.
- **Red line (blinking, blackout)** — appears only when a Neighborhood has gone dark. Restore its last path to clear it.
- **Red line (blinking, fault)** — appears only when something's faulted, with a live fault count and repair cost.
- **Red line (steady)** — a storm warning: weather's rolling in, a check is imminent. Not blinking, so you can always tell it apart from a real, active fault.
- **Red line (steady, capacity)** — a Neighborhood is about to outgrow its current capacity. Upgrade a span or add another path before it stops being served.
- **Orange line** — context for whatever's currently selected (a tower's or Substation's tier, upgrade options and costs).
- **Dim line** — an onboarding hint for your first few actions. It stops appearing once you've placed two towers and strung a line, and never comes back.

Your progress autosaves continuously — closing the tab and coming back picks up right where you left off.
