# Decision log

Newest first. Every entry: what was decided, why, and what would reopen it. Existing
entries are never edited into a different decision — reversing or amending one gets a
*new* entry that supersedes it (a status-line annotation on the old entry is fine).
Entries are for expensive-to-reverse or silently-undoable choices, not routine
implementation calls (D-155). When an entry hangs on a claim about current technology
state (API availability, browser support, tooling behavior), check a current source or
run a local experiment (root AGENTS.md rule 3).

**Reading:** scan the D-NNN headings (or grep) and read only the entries your task
touches. Full read is for structural or cross-cutting work.

**Culling (D-023):** the log is periodically pruned — superseded or moot entries whose
context no longer informs anything current are deleted outright; git history is the
archive. D-numbers are never reused, so a citation to a culled entry stays unambiguous
(recover it from git history if needed). One guard: some entries are written as diffs
against the entry they supersede (e.g., D-020 is "as D-014, with refinements") — a
superseded entry whose content a live entry builds on cannot be culled until that
content is folded forward into a self-contained entry.

Format:

```
## D-NNN: Title  (YYYY-MM-DD, status: accepted | proposed | superseded by D-MMM)
Decision / Context / Consequences / Reopen if
```

---

## D-173: Close M3.5 with a game-owned deterministic scenario and adopt Chrome 152 (2026-08-22, accepted)

**Decision:** M3.5 is complete. Its exit contract is the game-owned, versioned
`m35-gameplay-slice@1` scenario: seed 424242, 8,000 ticks, and 34 ordinary simulation
commands that accept two quests, defeat and loot three burrow gnawers, buy two fish and
one bittergreen, craft fisher's stew, reach level 3, and complete both multi-objective
quests. Engine telemetry exposes a generic immutable scenario registry; it does not
import or name game content. The app registers the game definition, and every core
`smoke@1` launch retrieves it through that generic seam, replays it twice, requires
byte-identical saves and hashes, loads and re-saves it through the live simulation
worker, validates its exact semantic counters, and restores the pre-probe state. The
report contract advances to schema v72 / mandatory metric set v35. Public telemetry
snapshot schema remains v43 because its payload did not change.

Adopt CfT Stable 152.0.7977.54, revision 1669021, as the current harness browser and
retain 151.0.7922.108 as a checked-in reconstruction anchor. The win64 152 archive and
executable SHA-256 are
`91850065e6b80bba0c752e17a150fe1b9e39bba51ed705640c1273f565950dda` and
`b0123437c55a3893e8988328f576ffcbe68cee7743d3653ffe865c73633b1ef4`;
CDP reports `Chrome/152.0.7977.54` at
`@24072c1aa400ec4a89dc738b6b6acd12a8589b6f`. This transition satisfies the full
M3.5-exit / M4-entry currency checkpoint. Other available runtime and build-tool
candidates remain deferred to their isolated component-family gates in
`dependencies.md`; no budget or accepted threshold changes.

**Context:** The prior short replay proved simulation determinism but did not execute
the complete gameplay promise added during M3.5. A game-authored command log makes the
exit content reviewable and repeatable without leaking gameplay knowledge into the
engine or giving the harness privileged mutation access. During the exit run the
official Chrome-for-Testing feed advanced from 151 to 152. Parallax's latest-Chrome
constraint required qualifying the new Stable rather than silently closing on the old
pin. D-154 already defines the three-fresh/three-warm streaming relative-range result as
informational; the 152 result's small relative-range noise remained inside the mandatory
absolute allowance, while every per-launch 250 ms streaming budget and all other
mandatory checks passed.

**Consequences:** The scenario becomes recurring smoke correctness evidence, not a
performance workload: its own duration is observed, while the existing 120-tick sample
remains the simulation performance gate. A scenario change requires a new scenario ID
or version and corresponding exact outcomes rather than silently rewriting accepted
M3.5 evidence. Chrome 152 is the default physical harness input; 151.0.7922.108 remains
available only for reconstruction and transition comparisons. M4 remains pending even
though its entry dependency checkpoint is satisfied.

**Implementation evidence:** Final `pnpm check` passed the repeatable production build,
lint, 202 test files, and 2,568 tests (one skipped). The exact build artifact is
`c7054f88eb10976bce076be4819f994be2b2624b5067913d587261ae857be279` and the install
release is
`15528289e8b0fca4a6e5d2eaa39281814c5f0648311176c94d31c574bce690f3`.
Every direct and physical scenario replay/save/load converged on
`8548ffcd21d3217d5fb7643391647a53771e71d6f123a161eda534c238d3b59e`.
The old-pin report
`smoke-1-c7054f88eb10-dev-01-showcase-2026-08-22T23-18-27-097Z.{json,md}`
passed schema v72 / metric set v35, all six launches, all three facets, and 36/36
checks; JSON/Markdown SHA-256 are
`d39501914092df62a6cbfc72bb51c1af618bf99426715473ffe3af5444babed7` /
`1cb881ffe807c766556bfdf98662df77581d9675c9ba9811a77952b6cbda7979`.
The adopted-152 report
`smoke-1-c7054f88eb10-dev-01-showcase-2026-08-22T23-28-14-949Z.{json,md}`
passed the same complete contract; JSON/Markdown SHA-256 are
`41a50d66aed751725dd7f3cdffa0bad12ff4890b6fedfbbfcb8641cc6302c185` /
`fbe384171c3a94648ab8f13f8af3252fc740e578b1139e876d293a5d64706ff8`.
Its ordinary simulation-step high-water was 0.740 ms.

**Reopen if:** M3.5 content or exact outcomes change; the scenario cannot be expressed
through ordinary commands; a game-specific dependency enters engine telemetry; replay,
save bytes, live-worker round-trip, or semantic counters diverge; Chrome 152 is withdrawn
or a relevant regression/advisory appears; or a later milestone needs a different
performance workload.

## D-172: Present gameplay systems through the hybrid UI and make level-up payoff explicit (2026-08-22, accepted)

**Decision:** Consume the canonical inventory, crafting, progression, loadout, quest,
and journal state through D-161's hybrid UI rather than duplicating game authority in
page state. `progression.snapshot@1` joins the existing inventory, quest, and journal
queries and exposes the complete learned build, attributes, loadout, current-level XP,
unspent choices, and a derived slot-access rule. Heavy-screen visuals and hit testing
remain render-worker owned; the DOM HUD owns health, stamina, aether, current-level XP,
unspent-choice warnings, concise screen text, and the sparse semantic action bridge.
Every mutating control produces the existing fixed-size simulation command and refreshes
from a later query/event; UI state never treats a click as authoritative success.
Because HUD meters and messages revise the shared presentation continuously (regen,
current-level XP, the Ironset countdown), the render service accepts a worker action
pinned to an older presentation revision when the heavy screen it was hit-tested against
is action-identical (same cancel action, primitives, action IDs, and disabled states) to
the current one; a changed or closed screen still drops the stale action silently.
Without that rule, HUD-only churn during the input round trip silently ate heavy-screen
activations.

Keep all four active and both knack slots available from level 2. This makes the
classless build's full shape legible immediately, lets early ability choices be tried in
any slot, and avoids saved unlock state. If slot staging is revisited, it must be derived
from level. The deterministic level-up payoff refills stamina and aether, clears their
fractional regeneration bookkeeping, and does not refill health. The sim publishes
`progression.level-up-payoff` with the resulting level and pools for presentation.
Ironset publishes `combat.ironset-started` and `combat.ironset-ended` (duration,
stamina-exhaustion, or downed reason); the HUD shows its remaining duration and the
planted +4-guard, stagger-immunity, half-movement trade-off.

**Context:** D-167, D-168, and D-171 deliberately stopped at deterministic systems,
commands, and queryable state. D-161 supplied only the shared presentation substrate.
The first real consumers therefore had to preserve worker authority while making
unspent choices, crafting results, quest history, and Ironset's otherwise invisible
movement trade-off understandable. A full health refill made attrition disappear at
the exact moment XP rewards should encourage continuing; stamina/aether refill gives an
immediate offensive payoff while leaving damage meaningful. Staging empty slots did not
improve the level-2 choice set and added rules without adding build depth.

**Consequences:** `I`, `P`, and `J` toggle inventory/crafting, progression/loadout, and
quest/journal screens. Accessible screen actions share the worker action contract and
keyboard/pointer validation. The HUD updates only when its typed status changes, and all
new sim state remains covered by the existing save/replay hash because the payoff changes
canonical combat pools but adds no saved field or schema version. UI copy and layouts are
game-owned placeholder presentation; M5/M6 can replace their greybox visual treatment
without changing command/query authority.

**Implementation evidence:** The pre-review candidate's `pnpm check` passed 201 test
files / 2,566 tests (one skipped), including worker-action/query integration, level-up
payoff, slot access, Ironset lifecycle, HUD/heavy-screen, landmark-XP, save/load, and
replay coverage; its exact build artifact was
`946a3c9fa33b2a504c81fb7b608833a8ed1c51a10a7eeb347b99eaf30d2f883a` with install
release `69e55ae8c500e814f50019404fbc5e13b01bb574aa1c8d66ede038ddd57a1529`.
Physical-console `smoke@1` on dev-01 Showcase for that artifact passed schema 71, all
three facets, and 36/36 checks across six launches with no blocking failures. The exact
report is
`smoke-1-946a3c9fa33b-dev-01-showcase-2026-08-22T21-32-13-649Z.{json,md}`; JSON and
Markdown SHA-256 are
`aae5f774adc44fb2df6666e21a59ee0bc81e9d4b8c37d5b856319d5f550a1d95` and
`117682679c0008fd420c400ffef507f8e3ba07aab4298c1eb5c5ff807be785d3`.
On-demand review then corrected two findings — heavy-screen actions were silently
dropped whenever a HUD-only presentation landed during the input round trip (fixed by
the action-identical acceptance rule above, in the render service and the gameplay UI
controller), and the HUD hard-coded Ironset duration/trade-off numbers and the level
cap instead of reading `IRONSET_STANCE` and `PROGRESSION_LEVEL_CAP`. The corrected
candidate's `pnpm check` passed 201 test files / 2,567 tests (one skipped), including
new engine and controller regression tests for the churn-drop mechanism. Its exact
build artifact is
`1b55b0b31a77bb2db6a6af1327fc6137941f8e3162dd862fd3f792abb9d2593f`; its install
release is `fbc5f4f15aaab6bd6ca4352f4d19fee1477a05199f8cd70200afff09ec03d325`,
with unchanged 266-resource / 2,621,468,856-byte OPFS identity
`70cfaf8dee37bedd834413b079c602223ad1724300dd5d41788237c732a06742` and replay
semantic-contract digest
`367762458e077a9ea07aab34f9034ad00cf34474904ae37596bf944251807b17`. The corrected
candidate's required physical-console dev-01/Showcase `smoke@1`
`smoke-1-1b55b0b31a77-dev-01-showcase-2026-08-22T22-41-48-630Z.{json,md}` passed
schema v71 / mandatory metric set v34, all six launches, all three facets, and 36/36
checks for that exact artifact and release. JSON/Markdown SHA-256 are
`06664ebaebcc54df0484365b079c8d58f2d4843e01a75b8ff112393ec9076910` /
`0d8ecd043341d73a5c474fd8facf14827b0ab43b420ff929dc5b2efb5106b81c`.
Every replay/save/load hash matched
`fde033eaca8b27038fba54eb65e4e4dfb12332156a1eb951d5021dad8eabfa74`, the
4,497-tick positioning replay/load digest was
`4f776d3979300c9f5cc58e0ab9d2b80be8cdbfbcb9ebd3cc112eb60037a9be5a`, and the
combined simulation-step high-water was 0.795 ms. D-119 makes this exact
evidence-only closure non-triggering.

**Reopen if:** representative playtesting shows the no-health payoff causes unavoidable
post-level defeat or the resource refill erases encounter pressure; empty level-2 slots
confuse players more than they invite experimentation; the 16-action sparse bridge or
256-primitive pool cannot express representative final screens; or a new screen action
cannot be represented by an existing deterministic command/query boundary.

---

## D-171: Make quests and the journal canonical deterministic simulation state (2026-08-16, accepted)

**Decision:** Implement ruleset-v2 quests as stable, game-owned data interpreted by a
single deterministic reducer. The ordered vocabulary contains the six-stage main arc
and eight system-tagged side quests. Quest, stage, objective, and intent order is saved
or commanded identity and may only be appended. Typed objectives cover reach, collect,
defeat, talk, craft, and deliver. They advance only from canonical semantic sim events;
acceptance and dialog outcomes cross the fixed 16-byte `quests.command@1` boundary as
validated intents. Persistent reach/collect facts reconcile from canonical exploration
and inventory when a quest is accepted or a later stage begins, so prior discovery or
acquisition cannot strand the state machine. Deliveries validate every cost before
removing any stack.

Advance the game payload from save schema v9 to v10 by appending an 8,400-byte quest
block after exploration. It reserves 31 quest identities (one stage-index byte each plus
one reserved byte), 64 objectives, and 256 fixed-size append-only journal entries. State stores active/completed masks, stage
indexes, monotonic objective progress, three bounded preparation flags, nominal quest
XP, cumulative counters, and the journal sequence. Load reconstructs masks, stage
indexes, objective progress, preparation flags, and counters from the journal; unknown
rules, identities, flags, reserved bytes, noncanonical event semantics, or disagreement
with the exploration landmark bitset fail closed. `quests.snapshot@1` exposes quest and
objective state, while paginated `journal.snapshot@1` exposes stable localization keys
and subjects for recap/localization consumers.

Every completed stage awards its authored XP through D-167's shared progression
boundary and emits ordinary semantic quest/progression events. Preparation is bounded
to three authored hooks: a consumed spare Clearing Draught suppresses the Warden Below's
phase-3 vents, a validated forest parley idempotently clears aggro and yields living
Wayland brigands, and Reliquary completion records the warden insight. New consequence
types require a new design decision. Amend D-168's Resonant Focus recipe to use
emberpetal instead of the boss-only Mythic catalyst core: stage 4 requires that craft
before the boss, so requiring the boss drop was an impossible prerequisite loop.

**Context:** D-170 deliberately established one-time discovery, semantic awards, and
the shared XP path before quest progression. The journal must be canonical saved state,
not a UI-derived transcript, because replay, recap, localization, and future multiplayer
need the same ordered history. Fixed capacities and compact entries match the existing
bounded two-district save design while leaving presentation to D-161's consumer layer.

**Consequences:** Same-host replay/save-load covers quest acceptance, all objective
shapes, delivery costs, stage XP, preparation consequences, and ordered history. UI and
Summarizer code query the sim and never infer authority from free-form dialog or rendered
text. Adding content within the fixed capacities is routine only when stable order and
the existing semantic shapes are preserved; changing order, layout, journal meaning,
objective/consequence types, or an existing XP schedule is a migration or rules change.

**Implementation evidence:** Direct coverage binds the complete authored vocabulary and
XP ledger, semantic-only progression, prior-fact reconciliation (including satchel
recovery), atomic delivery, rejected repeat preparation intents, no-op steady-state
ticks, the one-stage-index-byte-per-reserved-quest layout, preparation consequences,
paginated queries, fixed-block round trip, journal/exploration parity, corruption
rejection, save/load, and replay. The converged post-review candidate's `pnpm check`
passed the repeatable production build, Biome over 502 files, and 200 test files / 2,561
passing tests (one skipped) for build artifact
`06bdd2412d794c200ffa72ecb2d1dd93adaa1807e77a1e992c381b0f7e77ccee`, install release
`81bf0074da8a928f16b7feb6619b9bc072cb7bb3fb0bcd13a08b0c97d03cdb0d`, unchanged OPFS
resource identity `70cfaf8dee37bedd834413b079c602223ad1724300dd5d41788237c732a06742`,
and installer-repair semantic-contract digest
`50b5c8d9ffb503b197977a62fd21355c7b3617d236eaacb1be05828af17d52c3`.
The required physical-console dev-01/Showcase `smoke@1`
`smoke-1-06bdd2412d79-dev-01-showcase-2026-08-22T20-58-41-357Z.{json,md}` passed
schema v71 / mandatory metric set v34, all six launches, all three facets, and 36/36
checks for that exact artifact and release. JSON/Markdown SHA-256 are
`cb5cb34b0ce3237f981f1608f62823c0d8cfd13f17dd83aaf80d3ce8deb79bbb` /
`9602788be1416c43436d8f9e4aeaa32a5b43a6de1f81d945701b596d28e62193`.
Every 120-tick replay/save/load converged on
`fde033eaca8b27038fba54eb65e4e4dfb12332156a1eb951d5021dad8eabfa74`, every
4,497-tick positioning replay/load converged on
`4f776d3979300c9f5cc58e0ab9d2b80be8cdbfbcb9ebd3cc112eb60037a9be5a`, and the
combined character/crowd/creature step high-water was 0.835 ms. D-119 makes this exact
evidence-only closure non-triggering.

**Reopen if:** the two-district slice outgrows 31 quests, 64 objectives, or 256 journal
entries; recap/localization needs a different canonical history vocabulary; M4 content
requires a new objective or preparation-consequence type; multiplayer changes command
ownership; or a save migration must preserve pre-v10 payloads.

---

## D-170: Make named-landmark discovery canonical progression state (2026-08-16, accepted)

**Decision:** Land the exploration foundation before quest XP. A stable, append-only
`NAMED_LANDMARKS` table identifies named places by game ID, district ID, authored world
marker ID, player-facing name, discovery radius, and XP award. D1 begins with six:
Castle Gate Waystone, Village Square Waystone, Forest Edge Waystone, Castle Undercroft,
Village Well, and Forest Throat. Each awards the ruleset-v2 value of 25 XP once when the
authoritative player position enters its 24 m radius. Adapter initialization resolves
and validates the current district's authored marker references, requires exact parity
between the table and authored `landmark` tags, and rejects markers outside the navigation
projection; fixed simulation steps then use only that immutable resolved data. Module
load rejects more than 31 entries, duplicate game or marker IDs, unregistered districts,
and nonpositive/nonfinite radius or reward values.

Advance the game payload from save schema v8 to v9 by appending a canonical 16-byte
exploration block after items. It stores the stable discovery bitset, its exact
population count, cumulative nominal landmark XP, and landmark rules version; load
rejects unknown bits, inconsistent derived totals, or unsupported reward rules. Discovery
awards call D-167's existing progression boundary in stable table order and publish a
`landmark.discovered` event followed by the ordinary
`progression.experience-gained` event. Public counters expose discovered count and
nominal XP awarded (which can exceed net XP credited at the level cap), while
`landmarks.snapshot@1` returns every known identity, district, name, nominal value, and
saved discovery state for future journal/recap/localization consumers.

**Context:** The quest/journal plan item explicitly requires discovery to prove the
shared XP and semantic-event path before quest completion uses it. Keeping identity and
presentation text in game-owned data preserves deterministic replay, N-district data
ownership, and a localization-ready query boundary. A fixed bitset is sufficient for
the bounded two-district slice and extends the existing compact save approach without
introducing quest-specific state prematurely.

**Consequences:** The first authoritative step at the Castle Gate spawn produces one
discovery and one progression award; existing replay event sequences intentionally gain
those two semantic events. Landmark order is save identity and may only be appended.
The Village Square and Forest Edge rows intentionally carry the existing `waystone` tag,
so both are 12 m reshape sites as well as 24 m discovery sites; regression coverage binds
that economy behavior.
The six quest state machines, eight side quests, typed objective reducer, preparation
flags, and append-only journal remain the next work inside the still-open plan item.
Changing landmark order, the save layout, or the event payload is a migration/contract
change; changing an existing reward bumps the persisted landmark rules version. Adding
landmarks within the remaining bit capacity is content work only when the registered
district, unique identity, exact tagged-marker binding, and walkability checks remain met.

**Implementation evidence:** Direct coverage proves stable-order one-time discovery,
31-bit capacity enforcement, definition and exact tagged-marker validation, walkability,
explicit reward-rules rejection, nominal level-cap semantics, progression award/event
emission, no repeat award, save/load, query output, marker count, and reshape at both new
waystones. `pnpm check` passed the repeatable production build, Biome over 499 files, and
199 test files / 2,551 passing tests (one skipped). The exact installer-repair replay
contract binds build artifact
`5a87bce7a9199c9b1119500e4e0216334149f27b7f0b46b9e31bd0140fa6baf4`, install release
`3c025b458de5cbbcd061b56be8e76b2dc3d50214624fd3783df0335d2441a2d1`, unchanged OPFS
resource identity `70cfaf8dee37bedd834413b079c602223ad1724300dd5d41788237c732a06742`,
and semantic-contract digest
`5e461230a7cdbf0a7b648c594af452192ebe6a56a773f10deec49679e4fe0a92`.
The required D-157 physical-console `smoke@1` passed on `dev-01` / showcase with Chrome
151.0.7922.108: environment, evidence-completeness, and budget-evaluation facets passed,
with 36 checks across six launches under report schema 71 / mandatory metric set 34.
Every launch produced matching replay/save/load hash
`ccab5b4122ab513cb42f9acb76d417bf75f1adb8e9d6b2de7e40671e32ce7eba`
and positioning replay/load hash
`a7a33d75dce027b0d99c654f6b673dea2cf57f1b7f85694d926d611b4566faf3`;
the worst character+crowd simulation-step high-water was 0.8 ms. The measured source
tuple is commit `6384b6978010d7ca3d2dd364e630a00f871a7177` plus dirty-tree digest
`943725c50ebf6dce301c9d7662a44d2fbf4942ce96373edbedc7638f46bacce5`.
The immutable report is
`harness/results/smoke-1-5a87bce7a919-dev-01-showcase-2026-08-16T23-45-06-840Z.json`
(SHA-256 `0e00728f7718509d1adbcd2a164cdc793e2f045a6040d60a65a6428262d0343e`),
with Markdown summary of the same stem (SHA-256
`456a7722ec6fdf9e5c4dc4b9eff1522bd7e56ddf657be759280f8d1f750dadd5`). This is the
mechanical D-119 evidence-only closure of the already measured runtime candidate.

**Reopen if:** the two-district landmark set outgrows the 31-bit canonical mask; M4
requires discovery identity outside the game-owned world graph; playtesting shows the
24 m radius causes accidental or missed awards; recap/localization consumers need a
different stable query vocabulary; or a save migration must preserve pre-v9 payloads.

---

## D-169: Refresh dev-01's registered Windows servicing baseline (2026-08-16, accepted)

**Decision:** Update the registered dev-01 OS build from Windows `26200.8875` to
`26200.9168`. This is a servicing-baseline refresh only: the registered machine,
physical-console requirement, Showcase tier, CPU/RAM, RTX 4080 Super, D3D12 backend,
driver `32.0.16.1074`, display envelope, power scheme, pinned Chrome, and all budgets
remain unchanged.

**Context:** The D-168 physical smoke observed `26200.9168` consistently after the
host's August Windows servicing updates while the descriptor still required
`26200.8875`. The pre-review six-launch attempt passed gameplay evidence, all three
facets other than exact registered-environment identity, and 36/36 budget checks; its
sole terminal failure was the stale OS-build pin. Local registry and hotfix inspection
confirmed this was the real dev-01 host rather than a substituted machine or remote
display identity. The developer delegated the explicit baseline decision after review.

**Consequences:** New dev-01 reference evidence must bind `26200.9168` exactly and is
invalid on the prior build. The converged D-168 candidate required a fresh six-launch
physical-console smoke because the registered-machine descriptor is an evaluated smoke
input; the earlier failed report cannot be relabeled or promoted.

**Closure evidence:** The fresh dev-01/Showcase physical-console smoke passed the exact
updated environment identity, all three facets, and 36/36 budget checks for artifact
`b0d26cc3f3f52448e2ca75a958bb70d8667cbb1968d2869381dc097a36d1c29b`; D-168 records
the retained report and immutable hashes.

**Reopen if:** Windows advances again; another registered identity field changes; the
refresh coincides with a measurable regression that needs OS attribution; or the host
cannot reproduce the registered physical-console, driver, display, and power identity.

---

## D-168: Make the item loop canonical deterministic simulation state (2026-08-16, accepted)

**Decision:** Implement ruleset-v2 items as one sim-worker-owned, command-driven
system. The stable item vocabulary covers the slice's regional materials, base and
crafted gear, upgrades, catalysts, tonics, oils, and food; stable order is save and
command identity and future entries append. The complete 24-recipe table is versioned
balance data. Recipes use two or three ingredients, crafted gear is Fine with one
seeded slot-eligible affix, and Resonant Focus records an explicit ember/frost/aether
attunement. Static vendor offers use the authored price and universal half-price
(floored) buyback rule; there is no dynamic price or hidden stock mutation. Vendor
stock deliberately omits salvage iron so the forge's valuable Fine outputs cannot be
funded wholly by a repeatable buy-craft-sell marks loop. More generally, every recipe
whose full input is vendor-stocked remains break-even or worse even with Tinker's
Thrift.

Gathering nodes are world data with stable identities, four-meter authority checks,
five-minute deterministic regrowth, saved cooldowns, and first-harvest bits. Forager's
Eye adds one yield; Tinker's Thrift reduces each common recipe ingredient by one to a
minimum of one. Monster defeat events consume the named loot RNG stream exactly once
per death transition, awarding authored materials/marks and bounded rarity/affix gear.
Common/Fine/Exceptional/Mythic carry 0/1/2/2 affixes; conditional Bracing/Nimble remain
Exceptional+, every affix is validated against its slot, and duplicate equipped affix
identities aggregate once except Light's distinct per-weapon and per-shield costs.
Weapon, armor, shield, and catalyst slots may each be empty. Equipped gear, food, tonic, oil,
upgrade, and Resonant Focus effects all feed the combat sheet. The authored weapon
distinctions are real rules: axe recovery, spear reach, bow range, scale-coat stamina
penalty, and Light stamina cost reduction are not presentation labels. The boss's
Mythic Resonant Focus exposes the named **Warden's Echo** unique property and applies
the normal resonance bonus to ember, frost, and aether spells; it adds no new proc or
resource rule.

Advance the game payload from save schema v7 to v8 by appending a canonical fixed item
block after progression. It stores stacks, at most 32 gear instances, equipment,
marks, active preparation effects, the 32-node gathering mask/cooldowns, cumulative
counters, and one recoverable loose-material satchel. Gear entries are packed and use
stable serials; unknown identities, illegal affix/upgrade-slot combinations, nonzero
reserved bytes, and noncanonical flags fail closed. On defeat the satchel replaces any
prior satchel and excludes consumables, gear, and the boss catalyst core. Inventory is
available through a bounded `inventory.snapshot@1` query; mutations remain fixed-size
serializable commands with semantic success/rejection events. Waystone reshape is the
same item transaction: it charges 25 marks only when the build would actually change.
At a full material stack, loot overflow becomes marks at its half-price value with a
one-mark minimum instead of disappearing. Ordinary gear overflow becomes its
half-price value; guaranteed Mythic loot deterministically replaces the unequipped item
with the lowest preservation priority, pays that item's half-price value, and emits the
displaced serial. Preservation compares unique property, rarity, installed-upgrade
count, and base price in that order; a tied newest serial is displaced first.

**Context:** D-165 fixed the content surface and D-167 deliberately left Forager's
Eye, Tinker's Thrift, marks, and reshape awaiting their owning system. The implementation
needed enough combination depth to make loot and crafting exciting without turning
play into recipe-reference work. The chosen depth lives in gear rolls and preparation;
the basic loop remains place → gather/fight → choose a station → see exact costs → make
or trade one result.

**Consequences:** Same-host replay/save-load now covers item acquisition and spending,
gathering cooldowns, crafted/looted gear identity, preparation effects, and satchel
state. Public counters expose gathering, craft, trade, loot, gear, equipment,
consumable, upgrade, marks, and satchel activity from day one. The later hybrid-UI item
consumes the query/events and has no gameplay authority. Adding content within the
stable shapes is routine balance data; reordering identities, changing the save layout,
adding a new affix mechanic/aggregation rule, introducing dynamic prices, or changing
craft rarity is a design/save migration.

**Closure evidence:** Final `pnpm check` passed the repeatable production build, lint,
and 198 test files / 2,540 passing tests (one skipped). After D-169 accepted Windows
`26200.9168` as dev-01's servicing baseline, the required physical-console
dev-01/Showcase smoke retained schema-v71 / mandatory-metric-set-v34 artifact
`harness/results/smoke-1-b0d26cc3f3f5-dev-01-showcase-2026-08-16T20-28-25-602Z.{json,md}`
for build `b0d26cc3f3f52448e2ca75a958bb70d8667cbb1968d2869381dc097a36d1c29b`
and install release
`5c356a3b07e0234cd74b66f9697aefdff98066b0ed7252ae6d12626a1c1a4240`.
JSON/Markdown SHA-256 are
`570812938b6d67c7d4158403f8607080a46751fec52952c56c5faae348040e8d` /
`47e7811b8d56a853fade1f66f358173334e9303fd7becbc5c7285e89349e5dbf`.
All six launches, all three facets, and 36/36 budget checks passed; every 120-tick
replay and live save/load converged on
`ab4e013c5f298c9b796ca4855ad2c1435f5884c3aafa125eeee7f84ec6312dda`,
the 4,497-tick positioning replay/load digest was
`31e9fd4dcc1318605fb9e84ec94875791357adec89967c6f0502ab9831208880`,
and the combined character/crowd/creature step high-water was 0.7 ms. Per D-119,
recording these exact report facts and status pointers requires no additional physical
run.

**Post-closure correction evidence:** Review found that Tinker's Thrift made the
vendor-funded Hearthloaf recipe one mark profitable per craft and that guaranteed
Mythic overflow compared only unique property, base price, and serial. Hearthloaf now
costs four grain plus one sea salt, making its Thrift-adjusted vendor-funded cost equal
its four-mark buyback. An invariant test covers every fully vendor-funded recipe with
and without Thrift. Mythic overflow now applies the preservation order recorded above;
focused item tests cover rarity, upgrades, unique gear, price, and the newest-serial
tie-breaker. Final `pnpm check` passed the repeatable production build, lint, and 198
test files / 2,542 passing tests (one skipped) for artifact
`4e8725a0361c44f2a1fd5fb68110f6982b7bec11dc55ed96bf2a2228d87bf4c6`
and install release
`70a039e899f9e0ad38915b8f2dbf2319fe8aeecd7c35afbd6f1959bd3fdf8b60`.
D-157 requires no new physical smoke: the current smoke workload sends movement/input
commands and executes neither crafting/trade nor boss-loot inventory overflow.

**Reopen if:** 32 carried gear instances or 32 stable gathering identities are too
small for the two-district slice; playtesting shows five-minute node regrowth or the
two-to-three-ingredient grammar harms the loop; the fixed affix mask cannot express an
adopted mechanic; multiplayer state sync changes item-command ownership; or a save
migration must preserve pre-v8 payloads.

---

## D-167: Make classless progression canonical deterministic simulation state (2026-08-11, accepted)

**Decision:** Implement D-165's progression rules as one versioned sim-worker system.
The cumulative XP curve is `100×n` to advance from level `n`, capped at level 10;
each gained level grants exactly one attribute point and one ability pick. The existing
level-2 martial starter becomes canonical state with its first point already reflected
in the starter attributes and Piercing Lunge learned and equipped. The ordered
14-ability vocabulary is a stable save/command identity: append future identities,
never reorder existing ones. State records learned abilities, four active slots, two
knack slots, unspent picks/points, and cumulative observability counters.

Spend-attribute, learn-ability, equip-active, and equip-knack operations are fixed-size
serializable commands. They apply only while the player is action-idle, emit stable
changed/rejected semantic events, and reconcile the current combat pools against a
new progression-derived player sheet without refilling them. Learned passives apply
without consuming a slot. The combat consumer now honors Answering Strike, Ironset
Stance, Wellspring, and Quiet Tread; Forager's Eye and Tinker's Thrift are canonical
learned/loadout identities whose gathering and crafting effects land with the next
M3.5 system. Monster XP is awarded from authoritative `combat.defeated` semantic
events. Later quest and discovery systems call the same pure XP award boundary rather
than mutating level state independently.

Advance the game payload save schema from v6 to v7 by appending one canonical 96-byte
progression block after all prior fields. It stores the ability set as the stable
ordered bit mask, stores loadout slots as ordered ability indices, rejects unknown or
ill-typed combinations, and requires the final 16 reserved bytes to remain zero.
Public counters expose progression XP, awards, level gains, points/picks, learns, and
loadout changes. D-165's headless balancer now asserts the scripted-slice pacing ledger:
3,963 XP reaches level 9, within the authored level 9–10 completion band.

**Context:** The combat foundation still sourced one fixed level-2 player profile and
loadout. That made ruleset-v2 stats, leveling, ability choice, and their save/replay
authority aspirational, and left the balancer's XP pacing band unasserted. Quest,
discovery, marks, gathering, and crafting authority do not exist yet, so this item
establishes their stable progression seams without inventing parallel placeholder
economies. The waystone reshape transaction remains consumer work for the item/economy
system that owns the 25-mark payment; character-creation folk selection remains with
its later presentation/content delivery.

**Consequences:** Same-host replay and save/load now cover every progression choice and
combat-derived XP award. A later UI can query state and submit commands without gaining
gameplay authority. New abilities can append to the vocabulary while the current
32-bit mask has room; changing existing order, level economics, point cadence, slot
counts, or the persistence layout requires an explicit migration. This candidate
required one D-157 physical `smoke@1` because it changed the smoke-exercised simulation
replay/save-load workload and combined sim-step cost.

**Closure evidence:** Final `pnpm check` passed the repeatable production build, lint,
and 197 test files / 2,514 passing tests (one skipped). The required physical-console
dev-01/Showcase smoke retained schema-v71 / mandatory-metric-set-v34 artifact
`harness/results/smoke-1-c4a409e1d19b-dev-01-showcase-2026-08-11T16-24-09-800Z.{json,md}`
for build `c4a409e1d19bf70858215f26afa121fb5d9327b44514f694e796b398db616437`.
JSON/Markdown SHA-256 are
`b9762cd9fef585258e109aa01db9df197ac1c6516b17a2bfb694631c67e32e0b` /
`fe27d7caf1d4d9cd5fe45fd70511c321dc7156955273abe57703e4ff0c0f3f7c`.
All six launches, all three facets, and 36/36 budget checks passed; every 120-tick
replay and live save/load converged on
`b13fb8309b4042f95da2e848f782c31f7bd87bc8781c585deb1a4f850fa8ec25`,
the 4,497-tick positioning replay/load digest was stable, and the combined
character/crowd/creature step high-water was 0.731 ms. Per D-119, recording these exact
report facts and status pointers requires no additional physical run.

**Reopen if:** progression must support more than 32 stable ability identities; the
slice changes its level cap, point cadence, shared-pool model, or slot counts; respec or
folk selection needs new persistent authority rather than consuming these fields; a
multiplayer state-sync decision changes command/replay ownership; or a save migration
must preserve pre-v7 game payloads.

---

## D-166: Bind authored creature packs to deterministic navigation-aware combat AI (2026-08-10, accepted)

**Decision:** Replace the combat foundation's retaliation dummy with one generic
sim-worker creature-AI interpreter driven by versioned per-kit behavior profiles and
district-owned spawn/pack data. Perception is a bounded radius plus an exact clear
segment through D-159's immutable navigation projection; a sighting or received hit
propagates aggro only through the authored pack within 16 m. Aggro, pursue/flank,
flee, return, idle, and yield are explicit serialized modes. Creatures use synchronous
previous-tick separation and deterministic fixed-angle fallback steering, and every
accepted step must be walkable and swept-clear in the same navigation projection.
Loss-of-interest and home leashes return a creature to its authored spawn instead of
making render residency or player distance permanent authority.

The slice behaviors consume game-design.md rather than inventing a parallel ruleset:
greymaws alternate authored encirclement points with closing passes; the last member
of a burrow-gnawer pack flees; Wayland brigands use a 70-stamina player-model block/
dodge defense and yield below one-quarter health; wardens retain their existing break
opening; and the Warden Below summons a bounded four-skitterling clutch at two-thirds,
then at one-third shortens recovery only and, while actively aggroed, pulses the
authored arena-edge Burning vent annulus. Wind-up floors never change. D1 starts with
six stable authored greybox creatures across two packs and one solitary brigand. The
existing cap of 12 live / 16
serialized monsters keeps player + 48 villagers + monsters within the render worker's
64-placeholder presentation pool.

Advance the game payload save schema from v5 to v6. Each monster now saves home, pack,
mode, decision serial/cooldown, boss phase, and vent cooldown; reserved bytes remain
canonical zero and saved creature poses are validated against navigation on load.
Stable semantic events expose aggro start/clear, behavior changes, boss phases, spawns,
and hazards. Public game counters expose perception, aggro/deaggro, behavior/flee/boss
transitions, summons, and cumulative movement. These fields remain inside D-156's
existing engine save envelope and command protocol.

**Context:** The M3.5 combat item deliberately shipped only minimal face/approach/swing
retaliation and left perception, aggro, flee, navigation tactics, and authored world
spawns to this plan item. D-141 also requires semantic danger transitions before the
later adaptive-audio consumer, while D-159 forbids gameplay authority from following
streamed render LODs.

**Consequences:** Same-host replay and save/load now cover creature decisions and
authored spawns. The final candidate required one D-157 physical `smoke@1` because it
changed the smoke-exercised simulation replay/save-load workload and combined sim-step
cost.
Parley content for the yielded brigand remains a dialog/quest consumer, not free-form
AI authority. Catacomb spawn placement lands with D2 world content; its warden,
skitterling, and boss behavior profiles are already executable and directly tested.

**Closure evidence:** Final `pnpm check` passed the repeatable production build, lint,
and 196 test files / 2,507 passing tests (one skipped). The required physical-console
dev-01/Showcase smoke retained schema-v71 / mandatory-metric-set-v34 artifact
`harness/results/smoke-1-2c9f23fff5d7-dev-01-showcase-2026-08-10T15-05-44-099Z.{json,md}`
for build `2c9f23fff5d7505fc01e03ab7b8030b793e4418c8df36c9443277e3401a91bd1`.
JSON/Markdown SHA-256 are
`7cd994ab1c754406706a56f3c807cb02bf1dd2a9cc139c9b173e48a45513aaa6` /
`f72f843d3778f55fdd7d218116844061426d391f320604261a262408f86ae1e9`.
All six launches, all three facets, and 36/36 budget checks passed; every 120-tick
replay and live save/load converged on
`13eb6f64b9528d887cc3f1c256734f7d744d2b670ff50d24f9de5e3cb3b74433`,
the 4,497-tick positioning replay/load digest was stable, and the combined
character/crowd/creature step high-water was 0.8 ms. Per D-119, recording these exact
report facts and status pointers requires no additional physical run.

**Reopen if:** representative combat density exceeds the 12-live/64-presentation
envelope; local steering cannot traverse authored encounter geometry; pack tactics
need squad-level planning; sight needs a distinct visibility projection; or later
multiplayer adopts rollback/state sync that changes the serialized decision boundary.

---

## D-165: Adopt ruleset v2 and the headless balancer as M3.5's balance instrument (2026-08-09, accepted)

**Decision:** The M3.5 ruleset design pass concretizes D-142's structural v1 into
**ruleset v2** in game-design.md, under three human-chosen directions from the
2026-08-09 design session: (1) **full v2 scope** — resolution math, tick timings, the
complete 14-ability pool, bestiary stat blocks, XP curve, 24 recipes, the affix list,
prices, and the main-arc/side-quest content outline land now, so the remaining M3.5
system items are implementation against a coherent spec rather than per-system design;
(2) **deliberate-but-forgiving combat feel** — committed attacks and readable
telegraphs with survivable mistakes (bands: commons die in 4–8 hits, chaff in 2–3,
and the player survives common hits within per-loadout envelopes, both bounds
asserted; telegraph wind-up floors of exactly 30 ticks, or 24 for attacks tagged
*fast* in kit data; enrages accelerate recoveries, never wind-ups); (3) **the headless balancer is the balance
instrument** — a deterministic Node-side sweep of reference loadouts × levels ×
bestiary over seeded streams with asserted TTK/win-rate/pacing bands, built with the
combat foundation and run in the ordinary unit gate, with the M3.5-exit harness
gameplay scenario as the physical outer proof. Bands assert at each archetype's
declared at-level matchup; overlevel matchups assert win rate only, underlevel
matchups are report-only. Monster ratings (accuracy, guard, resist, raw damage,
channel, and inline potency for spell-type attacks) are authored flat per kit, not
derived from attributes; check type is per-attack (weapon-type: accuracy vs. guard;
spell-type: potency vs. resist), and Exposed lowers guard only.

A same-day engagement revision (external design review, same session) is folded in:
**asymmetric hit reliability** — player *baseline* offensive checks (unmodified by
conditions, affix triggers, or ability/stance modifiers) band at 70–85% at-level
against chaff/commons while monster baseline checks band at 45–65%; elites/boss sit
below baseline by design (Exposed openings are the lane), modified checks are meant
to exceed the band and are proxy-tracked rather than asserted, and a failed check
always presents as a deflection or resist flash, never an empty whiff; **caster
continuity** — every equipped catalyst grants the zero-cost Aetherspark bolt outside
the 14-ability pool, and keen spell successes refund ⌊cost/2⌋; **exactly two
condition interactions** (thermal-shock pair: ember consumes Chilled → Staggered,
frost consumes Burning → Exposed); **two conditional affixes** (Bracing, Nimble)
gated to Exceptional+, with fixed slot eligibility and single-active-copy
aggregation for every affix; **deterministic quest-preparation hooks** feeding
encounter data — never LLM output, with the boss-vent quench an *optional* stage-4
objective (mandatory draught work only mitigates the vents) so the authored vent
mechanic stays reachable in ordinary playthroughs; **per-loadout
survivability envelopes** (martial 6–10, hybrid 5–9, caster 4–7 common hits) with
shared win-rate/duration bands; and **report-only engagement proxies** in the
balancer (resource starvation, action distribution, damage share, rotation
dominance, opening exploitation), promotable to asserted bands only by decision.

Two structural additions beyond D-142: **rules math is integer-only** (design
implication #8 — floor-division rationals, no floats in rules state; protects replay
hashing and future cross-machine determinism), and the **check model is fixed** as a
uniform R ∈ [−8, +8] plus rating difference, with score ≥ 8 keen (×3/2) and
always-fail/always-succeed edges so no rating gap is deterministic.

**Context:** plan.md's M3.5 first track. D-142 bound the forks (deliberate real-time,
aether + crafted catalysts, classless loadout, waystone/satchel death) but left every
number and content list open; the combat-foundation item needs the math and timings,
and the human opted to fix the full content surface at the same time. All names
original; *(working name)* markers remain for the M5 creative pass; no D&D-protected
material.

**Consequences:** game-design.md's mechanics section is now v2 and remains the spec
home for formulas, shapes, and bands; authoritative tunable values move into
`game/balance/` versioned data as each system lands (implication #6). Specific values
in v2 are starting points — tuning changes freely within the balancer bands and needs
no decision entry; band *structure* changes, new pools, new conditions, or a new
resolution model do. The plan's ruleset checkbox stays unchecked until the balancer
exists and has consumed the spec (first balanced combat build).

**Reopen if:** the balancer cannot satisfy the deliberate-but-forgiving bands without
structural change; integer-only math proves unworkable for a needed mechanic; the
17-outcome check's ≈6%-per-point granularity is too coarse for meaningful gear/level
steps; or M4/M5 content scale invalidates the fixed 14-ability/24-recipe surface.

## D-164: Accept M3 exit and the M3.5-entry dependency checkpoint (2026-08-09, accepted)

**Decision:** Accept M3 as complete, adopt CfT Stable 151.0.7922.108 as the current
harness browser, accept the 2026-08-09 full dependency checkpoint, and begin M3.5.
D-163's local schema-v71 / mandatory-metric-set-v34 dev-01 proof remains the
budget-authoritative M3 exit result. The exact reviewed candidate was subsequently
deployed to `https://parallax-web.com` with frozen 286-file deployment fingerprint
`f7cae777800de45f046ff5fb11364e99e821b2a1340c91549708d6e2b7431c44`.

D-150's separately required `branded-parity@1` gate then passed under installed branded
Chrome 151.0.7922.72, CDP revision
`@2903d8558c752b5a554a1a47b4ea7219ba1a31ef`, against the CfT 151.0.7922.108
comparison reference. It verified the production artifact
`1100d5e4e75490ceb9b12c7ead060643c82406560c046e7bdcb83826a8ab0e73`
and release `17326acbe80f97e82ccc040805ecb369248d9ba9e5cef7fd0c52ca533c485259`
before and after the run, passed all three facets and all 36 checks across the same six
schema-v71 / metric-set-v34 launches, and remained baseline-ineligible,
nonpromotable, and non-budget-authoritative. The exact report is
`harness/results/branded-parity/branded-parity-v2-2026-08-09T20-45-12-228Z/result.{json,md}`;
JSON/Markdown SHA-256 are
`7220e4ef1ddaefdf11b8974c11a7013c973e847b533fa569e9b4c95ee300c7be` /
`72483ba44e1b0c846ef1d99c07274d4ae309e7346a9a17cedcc01e3300e0a2a4`.

**Context:** D-163 intentionally left M3 open because its dependency checkpoint moved
the CfT pin and D-150 requires installed branded-Stable parity against the exact
deployed production candidate. Explicit deployment authorization was granted, the
preview and fixed-destination apply both verified the frozen inventory and preserved
all five exact model objects, and the resulting production parity run satisfied that
last external exit condition without changing any budget.

**Consequences:** M3's playable NPC fallback, save/reload, and deterministic replay loop
is closed on registered dev-01 Showcase. CfT 151.0.7922.108, wasm-bindgen 0.2.127, and
transitive nanoid 3.3.18 are the accepted M3.5-entry checkpoint. Installed branded
Chrome evidence remains a parity result only; CfT remains the authoritative pinned
browser for budgets and baselines. M3.5 is now the active milestone.

**Reopen if:** the retained local or parity result fails reconstruction; production no
longer serves the recorded artifact/release identity; a relevant Chrome regression
invalidates the same-major/build parity assumption; or an M3 contract changes rather
than being extended by M3.5.

## D-163: Make the M3 exit loop an adjudicable mandatory smoke proof (2026-08-09, accepted)

**Decision:** Advance `smoke@1` to report schema v71 and mandatory metric set v34. Every
core launch must now retain raw, independently cross-checkable M3 exit evidence rather
than completion booleans alone:

- run the same 120-tick command log twice on fresh adapters and require both state
  hashes, the loaded-save hash, and the save bytes to match;
- load that state into the live sim, save it through the ordinary service, load the
  exact saved bytes twice, and require both loads to equal the pre-save state hash;
- use a fixed 4,497-tick replay to place the player within the authored five-metre
  interaction range of stable NPC entity 1000, Mara Venn;
- activate her through the real canvas-focused `KeyE` gameplay-input path, enter
  `Is the road safe?` through the ordinary DOM dialog, and require the exact retrieved
  authored fallback while both installed and dialog model states are `unavailable`;
- require exact +1 gameplay-input, sim-interaction, dialog-request, knowledge-request,
  and freshly assembled-entry deltas; then use the ordinary End conversation control,
  prove input suppression is cleared, and reload the pre-probe save before warmup and
  measurement.

The harness may enable gameplay input on an automation runtime only through the exact
WebDriver-gated `parallaxAutomationGameplayInput=smoke` opt-in layered on the existing
`parallaxAutomation=runtime` authorization. That opt-in starts the ordinary input
service; it does not enable gameplay-owned streaming observers, replace the keyboard or
DOM seams, or remain in the V8-only diagnostic route. Baseline eligibility revalidates
the raw hashes, exact question/response, unavailable model states, stable NPC identity,
and every before/after delta.

Chrome 151.0.7922.108 also began returning Chrome-owned `browser_ui` omnibox targets
with the app page's `browserContextId` (RE-048). The all-realm heap topology therefore
excludes only `browser_ui` targets whose URL starts with `chrome://`. It continues to
require the exact app page and eight expected dedicated workers and rejects every other
same-context target, including a non-Chrome URL mislabeled as `browser_ui`.

**Context:** M3's systems already had unit fixtures and separate physical gates, but
the milestone exit text required one playable conversing-NPC loop, direct save/reload,
and same-input determinism on pinned dev-01. A literal `true` in a report could not
prove hash equality, cumulative counters could not prove that the observed dialog turn
produced retrieval, and leaving the dialog or 4,497-tick positioning state active would
have contaminated the unrelated steady-state measurements. Automation launches also
intentionally kept gameplay input idle, so testing `KeyE` required a narrow authorized
route rather than a harness-only simulation command.

The converged local dev-01/Showcase six-launch run passed all three facets, 36/36 budget
checks, and the new proof with replay/save hash
`3d46af17a59b8872309bdf533e63401b33a59e1087eb7e867ce07c6e844dd381`
and positioning hash
`c2cfd94dc90e394e226ba3771e73ac9c1f9cebb0aab200d3cf3f6a6ad01f7d94`.
Exact final report identity is recorded with the M3 exit item in `plan.md`.

**Consequences:** The implemented M3 exit behavior now has one mandatory physical proof
that is both player-path-realistic and independently adjudicable. It adds correctness
evidence, not a new numeric performance budget. The milestone itself remains open:
the same dependency checkpoint selects CfT 151.0.7922.108, and D-150 still requires
installed branded-Stable parity against the exact deployed production candidate before
that browser pin, the full checkpoint, or the M3→M3.5 transition can be accepted.

**Reopen if:** the authored NPC identity/question/fallback changes; the interaction
range or deterministic route makes the fixed positioning replay invalid; save format or
simulation timing changes; the automation authorization can bypass WebDriver/runtime
gating; Chrome exposes a supported ownership field for browser UI targets; or the M3.5
loop requires additional exit evidence rather than extending the same sim contract.

## D-162: Bind ordinary NPC dialog to the installed app-owned model (2026-08-09, accepted)

**Decision:** Implement one lazy, window-owned ordinary dialog service over D-074/D-096's
exact wllama 3.5.1 backend. Installed launch supplies D-137's release-bound five-shard
source; the service opens those immutable OPFS objects as `File` blobs and uses wllama's
direct blob load API. It does not mint browser-readable URLs, duplicate the model into
wllama's URL cache, fetch missing content, or fall back automatically from WebGPU to
CPU/WASM. The selected placement is explicit for the service lifetime. Model
unavailability, load failure, generation failure, or rejected output returns control to
game-owned authored fallback dialog; a failed load is terminal until the next launch so
one interaction cannot trigger repeated multi-gigabyte initialization attempts.

Every generated turn uses native strict JSON-schema decoding for exactly three strings:
`speech`, `intent`, and `subject`. `no_action` must pair with `none`; every other pair
must occur in the active persona card's finite intent/subject allowlist. The engine
publishes only that validated type. Game code may observe the intent and later serialize
it as an ordinary sim command, but neither freeform speech nor the dialog controller can
mutate sim state. The first authored persona is stable entity 1000, Mara Venn. Her card
includes a functional opening plus road, lodging, work, and default fallback replies.
Her bounded rolling memory retains four full turns and folds older turns into a
1,024-character extractive summary. The prompt has an explicit retrieved-context slot
that D-033's generic knowledge service will fill next.

Conversation presentation consumes D-161's DOM dialog surface and owns gameplay input
while visible. The sim selects the nearest authored conversational entity and emits only
its stable entity ID as a semantic event. The ordinary service exposes load, TTFT, token,
failure, rejected-output, and render-impact telemetry through the public export. Render
samples conservatively retain the worker's full 60-frame batch on each generation edge;
this avoids claiming that a sub-second generation had zero frame impact merely because
it began and ended between batched telemetry publications. Frame-impact samples reset at
each generation, while request, generation, token, rejection, and failure counters remain
cumulative for the service lifetime.

**Context:** D-137 intentionally stopped after release-bound model-source resolution
because its URL-driven spike could not consume ordinary OPFS objects without inventing a
second storage path. wllama 3.5.1 already exposes `loadModel(Blob[])`; using the admitted
files directly preserves the install/launch/run lifecycle and keeps the five exact
shards as the only model copy. The controller remains window-owned under D-096, while
llama.cpp, WebGPU execution, and pthread work stay in wllama-created workers. wllama's
window-side proxy still services worker file-read requests with `Blob.slice()` /
`arrayBuffer()` calls against the OPFS-backed `File`; D-162 therefore does not claim that
all model I/O is off the window thread. D-074's rendering evidence used the same
window-owned wllama broker, while the ordinary service records its own load and padded
render-impact telemetry so regressions in the direct-file path remain observable.

D-074's retained physical artifacts already measure both selected placements during
concurrent rendering. The qualifying WebGPU artifact
`app-owned-llm-spike-1-fd85032d3831-dev-01-2026-07-17T18-57-21-704Z.json` retained
4,980 generation-window frames across cold and warm runs; its qualifying 2,580-frame
warm-restart measurement had callback interval p95 16.790 ms (maximum 33.430 ms) and
render duration p95 0.535 ms (maximum 1.715 ms). The CPU/WASM topology artifact
`app-owned-llm-spike-1-4e24f4809c68-dev-01-2026-07-17T18-39-34-316Z.json` retained
59,940 frames across cold and warm runs; its 28,920-frame warm-restart measurement had
callback interval p95 16.770 ms (maximum 17.150 ms) and render duration p95 0.270 ms
(maximum 7.140 ms). That CPU artifact remains non-qualifying for structured output
because it predates the JSON-schema constraint; its raw frame timing is retained only as
placement-impact evidence. D-162 changes the caller and storage source, not the measured
inference kernels or placement.

**Consequences:** The greybox has a real conversational seam and a fully playable
unavailable-model path. Privileged legacy harness launches intentionally see the
release-bound source as unavailable and therefore do not silently fetch a model; the
dedicated D-074 harness remains the bounded inference qualifier. The public snapshot
schema stays v43 because D-162 adds a direct `npcDialogSnapshot()` instrumentation
method rather than changing the combined snapshot envelope. The current persona's
small structured game-state context is authored inline only until the immediately next
D-033 plan item supplies the generic provider/assembly service. Rolling dialog memory is
session state in this item; the M3 exit's save/reload work must bind its serialized form
to the save lifecycle before claiming conversation-memory persistence.

**Closure evidence:** Final `pnpm check` passed the repeatable production build, lint,
and 190 test files / 2,461 tests (one skipped). The required dev-01 physical smoke
retained schema-70 artifact
`harness/results/smoke-1-fadede8ba3ae-dev-01-showcase-2026-08-09T16-46-18-033Z.json`
(SHA-256 `74bed174cb0be2db34b9fdb451d743744bff26041cb41c21b33547cd94a138d0`,
build `fadede8ba3aed2f22f0c7417c56372c04b2ec59f513af26dcca4c6d6a7d9bfbc`):
all environment/evidence/budget facets passed, mandatory metric set v33 was complete,
and 36/36 budget checks passed across all six launches. Per D-119 this exact
evidence-only closure does not require another physical run.

**Reopen if:** wllama removes its window/controller restriction; direct OPFS `File`
loading regresses or makes the 120-second bounded load fail; a measured gameplay
workload requires a different explicit placement; strict schema decoding cannot
reliably produce useful allowed intents; or saved dialog memory requires a different
privacy/lifecycle boundary.

---

## D-161: Implement the hybrid UI stack without a page framework (2026-08-08, accepted)

**Decision:** Implement D-160's shared substrate as a framework-free, typed engine
service. The main thread owns a keyed DOM/CSS HUD and dialog tree plus a bounded sparse
semantic/focus/IME bridge. The render worker owns world anchors, heavy-screen geometry,
focus navigation, and hit testing through versioned presentation/input/action messages.
It retains the newest presentation across render recovery and admits worker actions only
when they are the exact result expected for the oldest outstanding input, topmost pointer
hit or mirrored focus state, monotonically ordered response, revision, source, and enabled
game-owned action ID. Opening a heavy screen explicitly suppresses gameplay input even
before interactive input starts and releases pointer lock; closing it attempts restoration
and records any denied request.

Worker visuals use fixed boot-time Babylon Lite geometry pools: 64 world anchors and
256 normalized heavy-screen primitives, split across four tones. The eight combined
meshes use the already-warmed Standard opaque pipeline family; this change creates no
new runtime PSO family and does not allocate one mesh or listener per primitive. The
game layer supplies layouts and player-facing text through the engine contract and
never touches DOM, worker, or WebGPU APIs.

**Context:** D-160 settled surface ownership but intentionally did not select an
implementation library. The immediate M3 need is a substrate before real inventory,
journal, settings, and dialog layouts exist. The required behavior is small and
contract-heavy: keyed DOM reconciliation, fixed worker pools, a sparse semantic bridge,
recovery replay, and telemetry. Adding a general page UI framework at this boundary
would add a second lifecycle and dependency without evidence that it solves a current
screen-composition problem. Framework-free does not mean one-off page code: the shared
service and versioned presentation model are the reusable stack.

**Consequences:** HUD meters and dialog choices preserve native focus, selection,
accessibility, and IME. Canvas-heavy screens expose only their bounded semantic controls
to the DOM and keep their visual tree worker-owned. Stable semantic/form identities
preserve live focus, selection, unpublished typed input, and IME composition across
unrelated presentation revisions; stable live-region nodes avoid stale re-announcements,
closing surfaces return focus to the canvas, and non-composing Escape remains available
from the heavy-screen sparse bridge without intercepting dialog controls. Accessible
labels and submit copy remain game-owned. The current
worker primitive format is a strictly layered colored-rectangle substrate; real screens
must add game-owned layout, icon, and glyph assets without bypassing the fixed-pool/pipeline
contract. The highest-layer rectangle occludes pointer hits regardless of whether it is
decorative, disabled, or actionable; only enabled primitives with action IDs emit actions.
Retained presentations are posted before Ready listeners run, keyed meter nodes are not
reinserted when their order is unchanged, and failed boot attempts dispose all created
runtime services in reverse order, remove mounted/global handlers and the telemetry export,
restore pristine hidden runtime surfaces with a fresh canvas, and permit a new measured
launch attempt before the retry latch reopens. Public telemetry
advances to v43. `smoke@1` advances to report schema v70 / mandatory metric set v33 and
requires each core launch to retain a ready DOM tree and the matching worker presentation
revision with at least one visible world-anchor record ingested by the worker. That is
logical cross-thread evidence, not attributable draw/pixel proof. Flythrough and
render-recovery report schemas advance to v35 and v31 because their embedded public telemetry envelope changed;
their mandatory metric sets and numeric budgets do not.

**Closure evidence:** After external, skeptic, and adversarial review corrections for
pointer occlusion, Ready ordering, keyed meter stability, complete failed-boot teardown,
surface rollback, relaunch, and shell-authority races, the final registered dev-01/Showcase
physical `smoke@1` report
`smoke-1-50a6674402e5-dev-01-showcase-2026-08-09T15-04-36-814Z.json` (JSON SHA-256
`371296488ac0f3c2a276bd933f79cec96f676274d26d192bf78ee7df3373b244`; Markdown
SHA-256 `63e42417ca3b8bb40d038747c23b75a1e3a2a0b2fef1477ab8b4b75f66701969`)
passed all six launches, all three facets, and 36/36 evaluated checks under schema v70 /
mandatory metric set v33, pinned Chrome 151.0.7922.71, artifact
`50a6674402e501110c31710785d0f356d179d8eb039a66a82149eae8977cf3da`, install release
`f9f3b0febfd0e73a462c12f9a1b3ffd8fc58eb64c79e875427e949de629318e5`, source commit
`4e28a86f09d1c0df8ddd8523a5c6ad9ca1900a97`, and dirty-tree digest
`149175e958c2d8fc37eec24ce584d8a02252c183222c98ef1eaab5a59f313df4`.
An earlier immutable report
`smoke-1-f1f4444d58ab-dev-01-showcase-2026-08-09T01-03-47-932Z.json` (SHA-256
`08b657796eef5640c57c479434f5c6c4d2e0593fd1228806522b875525555efa`)
failed before measurement because the new page-realm readiness predicate captured a
module constant. The final candidate passes that schema identity explicitly as serialized
predicate input and carries source-audit regression coverage. `pnpm check` passed 2,439
tests with one intentional skip after all skeptic/adversarial corrections converged.

**Reopen if:** real-screen implementation shows, with profiles or repeated correctness
failures, that keyed DOM reconciliation is a material maintenance/performance bottleneck;
the heavy-screen primitive contract cannot express required visuals without runtime
allocation or a new pipeline family; or Chrome exposes an attributed cross-thread
presentation transaction that changes D-160's ownership split.

## D-160: Resolve P-008 with a per-surface hybrid UI substrate (2026-08-08, accepted)

**Decision:** Use a hybrid game-UI substrate. Render **world-anchored UI** and the
visual/high-churn portion of **heavy screens** in the render worker's WebGPU canvas.
Render the **HUD** and **dialog** as main-thread DOM/CSS. A bounded, sparse DOM semantic
bridge for in-canvas screens remains allowed for accessibility, text entry, and IME,
but it must not recreate the measured 200-element visual grid or become a second visual
presentation path. This resolves P-008 and supersedes D-143's experiment-only status.

The assignment follows D-143's predeclared criteria without recalibration:

- **World-anchored UI — in-canvas.** DOM round-trip staleness was p95 2 rendered
  frames (maximum 4; 36,063 samples) versus the eligibility limit of 1 frame; the
  in-canvas arm was p95 0. DOM application latency was p95 16.970 ms. All three
  physical screenshots also showed the magenta DOM marker detached from the cyan
  in-canvas marker: centroid separation was 10.616, 5.028, and 9.722 px against the
  fixed 4 px capture limit. The raw report incorrectly encoded a threshold exceedance
  as `invalid` rather than a measured value with failed eligibility. Because repository
  metric semantics reserve `invalid` for untrustworthy evidence, D-160 does not consume
  that state as a verdict. An independent RGB scan of the immutable PNGs reproduced
  their hashes, color-pixel counts, and centroid distances exactly; visual inspection
  also confirmed detachment. This adjudicates the schema defect without relabeling or
  mutating the report.
- **HUD — DOM/CSS.** At the scheduled 10/20/30-event/s phases, all 12,001 events were
  scheduled and presented by both arms. DOM event-to-visible latency was p95
  32.410 ms, below 50 ms; mutation cost was p95 0.040 ms; and no UI-attributable
  main-thread Long Task exceeded 50 ms. The in-canvas comparison was p95 15.589 ms,
  but D-143 did not require the faster arm when DOM passed.
- **Heavy screens — in-canvas visual/interaction surface.** The 240-image inventory
  plus journal cycled 300 times open and 300 times closed. Input capture-to-sim-command
  enqueue was p95 17.800 ms, above the fixed 16.7 ms limit. All 600 inputs were still
  enqueued with zero drops or sim rejections, and open/closed render-present intervals
  were both p95 16.715 ms, but those secondary results do not erase the threshold
  failure.
- **Dialog — DOM/CSS.** Dialog is a low-update text and interaction surface rather than
  a frame-coherent world anchor or 200-element high-churn screen. The harder DOM HUD
  rate passed, and the probe exposed correct accessible progressbar name/role/range/
  value semantics. DOM therefore preserves native focus, selection, IME, subtitles,
  and accessibility where they matter most. Translator readiness is not claimed: the
  exact English-to-Spanish probe returned `downloadable`, so no translation output was
  produced or accepted.

**Evidence:** The registered dev-01 physical-console Showcase run used pinned Chrome
for Testing 151.0.7922.71 (executable SHA-256
`112b7b761c1b6cfa898c56e725f87f7a999a16a0d367d5345824d53336f52acc`) and an RTX
4080 SUPER. Pre/post host identity matched, remote-session state was false, the local
candidate serving contract was reverified, and numeric coverage was valid. The report
is `ui-substrate-probe-1-a41718b70818-dev-01-2026-08-08T23-08-45-806Z.json` (SHA-256
`32b6bd7678b98b9217c8115935ddd544ed76fbb96b91b6b2e7f0d63df40d13b1`), build artifact
`a41718b70818e7421827021ff2911d48a69e800bd9c5308aa346ffd1f47ec083`, release
`f8c820ca6618fce0f99d06bc4e7159e3e3d37d708a47737ec4053bfb1a013289`, source commit
`d27adb41164a6bb14a1533ceca76d6450fd6aca2`, and dirty-tree digest
`a2442e785bdeea2521fc06508e15c13c502a338c3d78b28c1100713abe160515`.
The report's numeric verdict coverage is valid and truthfully records two ineligible
DOM surfaces. Its overall `valid: false` comes from the `ui-substrate-probe@1` schema
defect above: the capture function used `invalid` for each trustworthy threshold
failure. The independent
`ui-substrate-probe-1-a41718b70818-dev-01-2026-08-08T23-08-45-806Z-independent-screenshot-validation.json`
result (`ui-substrate-independent-screenshot-validation@1`, Python 3.14.3/Pillow
12.3.0; SHA-256
`915963035bafdd2fa2ecc6a151a1cb404cc3d395f443d502e83d3497c4701ab6`) re-read the
three immutable PNGs without importing probe or harness image-analysis code and exactly
reproduced 10.615561869230138, 5.0276036627770795, and 9.721641688037838 px. No raw
artifact was rewritten. D-099 independently
reconstructed the exact dirty source before cleanup in the ignored sibling directory
ending `-reconstruction`; its 38,770-byte binary patch has SHA-256
`af711b11597bb7316d69d47d0066ab9857f30310a361c8dc60f9239191990428` and its
75,776-byte untracked archive has SHA-256
`e79f28fd6b2eb037704350368066f217a94f158c812d3c8929d0fa50fa98b657`.

The bounded apparatus identified and used no page-visible primitive that frame-locks or
attributes compositor presentation of main-thread DOM to a worker-owned WebGPU canvas
frame. This is an experiment-bounded observation, not an exhaustive audit of every
Chrome-internal facility. Frame-ID round trips and captured pixels supplied the
available evidence; RE-047 records the unresolved platform request. The temporary
probe, protocol, render quads, app UI, scenario, tests, and commands are removed under
the closed-experiment rule after this record and reconstruction bundle preserve their
result.

**Consequences:** The next M3 item builds one shared hybrid substrate: render-worker
primitives and input routing for world anchors/heavy screens, DOM components for HUD/
dialog, and an explicit semantic/focus bridge rather than duplicated visual trees.
Production framework selection remains a separate implementation choice. Infinite
localization remains unqualified until the Translator model is ready and exact output
can be exercised offline.

**Reopen if:** representative M3.5 combat or M5 content materially changes these
measurements; Chrome adds a usable DOM/canvas frame transaction or attributed
presentation primitive; a current Chrome release materially changes cross-thread
composition; or an accessibility implementation cannot expose in-canvas screen
semantics without reproducing the measured DOM cost. Reopening requires a bounded
rerun under then-current pins and predeclared thresholds.

---

## D-159: Bind deterministic tiled navigation and a 48-agent village crowd to sim authority (2026-08-08, accepted)

**Decision:** Derive D1 NPC navigation once per isolated game adapter from D-158's
immutable simulation-world collision projection. A 16 m grid expands authored AABBs by
the NPC capsule radius, rejects boundary samples, admits only bounded heightfield steps,
and uses exact swept segment/AABB intersection for graph edges, diagonal avoidance
movement, and saved-pose validation. Stable A* tie-breaking builds cyclic paths between
data-authored `npc-schedule:*` / contiguous `npc-stop:*` markers. Live render LOD
residency never becomes simulation authority.

Run 48 stable-ID agents at 60 Hz. Agents start at collision-free phases, follow authored
paths at a game-owned speed, dwell at stops, and apply synchronous pairwise separation
against previous-tick crowd poses and the current post-controller player pose. Every
accepted movement remains swept-clear and directly connected to its current waypoint;
cursor advancement never exceeds the per-tick speed bound. Game save schema v4 stores
route/stop/path cursor, dwell, pose, and wide cumulative crowd counters and rejects
off-mesh, wrong-height, or path-inconsistent state. The existing presentation SAB
carries player plus crowd transforms; the render worker consumes them through a fixed
64-capsule placeholder pool and restores the latest gameplay presentation after
scenario reset.

Advance the sim worker protocol to v3 so replay evidence records adapter initialization
duration. Advance `smoke@1` to schema v68 / mandatory metric set v32 and redefine the
existing ≤2.00 ms sim-step gate as the combined controller plus exact 48-agent workload.
The gate requires 256 navigation tiles, 8 path queries, positive topology/path work,
movement, avoidance, and traveled schedule transitions. Grid bytes, path nodes,
expansions, moving agents, distances, and initialization duration remain observable.

**Context:** D-158 deliberately left NPC navigation as the next calibration point and
forbade collision authority from following render residency. Coarse node-only obstacle
tests let edges cross thin colliders; endpoint-only runtime tests, manufactured spawn
transitions, narrow counters, and permissive saved poses could hide deadlock or corrupt
long-lived state. Skeptic, adversarial, and external reviews exposed those cases before
physical qualification; swept edges/movement, collision-free phasing, path-consistent
save validation, wide counters, and per-tick serialization/displacement regressions
close them.

**Consequences:** The accepted physical-console report is schema-v68 / mandatory-
metric-set-v32
`smoke-1-e93e5d805b97-dev-01-showcase-2026-08-08T21-36-03-455Z.{json,md}`
(JSON SHA-256 `b866a30b9cf9e5047613a14d521f2878c3bc9b389d7c3ff6c92a7188a5e5b0a3`;
Markdown SHA-256 `6ac396f89c703cf508065208f4c2c1d8acfde4b176cd4df8916e379883531989`).
All six registered dev-01/Showcase launches, all three facets, and 36/36 checks passed
for artifact `e93e5d805b970246a3bf3a6ee5c0403b67c350d054b72e14fa21657d99367560`
and release `6e41e5cad74582c83fb540aa555ad89e38c05b1cd1d447bde41a31014f492573`.
Combined character/crowd step high water measured 0.445–0.755 ms (maximum 0.755 ms
versus 2.00 ms); adapter/nav initialization measured 93.545–94.740 ms. Each replay
reported 64,865 nodes, 128,716 edges, 330,245 grid bytes, 104 path nodes / 265 A*
expansions across 8 queries, 48 moving agents, 1,855 avoidance adjustments,
237.06979370117188 m aggregate NPC movement, and 6 traveled schedule transitions.
The measured source identity is commit `bd175113e9367e02fb81055da74b856ee23eae9c` plus
dirty-tree digest `f9980f11aa2d736b97ce3f86d3f6c0b5b6848924f7750d0e94357c641a5e27c7`.
The report's old pre-D-121 local baseline predecessor is explicitly incomparable, so
the PASS was not automatically promoted as a new baseline.

**Reopen if:** village population or schedule density exceeds the 48-agent/64-mesh
envelope; 16 m sampling cannot represent required traversal geometry; streamed
collision admission must become sim-visible; avoidance needs velocity prediction or
lane formation; save migration needs freeform repositioning; or representative later
systems push the combined sim step toward 2.00 ms.

---

## D-158: Bind the first playable controller to the deterministic sim and scenario-owned presentation (2026-08-08, accepted)

**Decision:** The D1 character loop runs entirely through D-156's authority. The game
adapter receives a boot-time immutable simulation-world projection containing district
bounds, collision heightfields/AABBs, and authored markers; it does not receive or infer
collision from render LODs. A fixed-step capsule controller consumes versioned
`player.input-axes@2` commands, samples ground height, resolves horizontal obstacles,
and emits transition activation as a semantic event. Movement speed, capsule shape,
and interaction range remain game-owned balance data.

`engine/input` owns keyboard/pointer capture and coalesces changes to at most one frame
per animation callback. `game/` owns conversion to commands, player identity, event
decoding, and the binding from interpolated snapshots to renderer/streaming interfaces;
`app/` only composes those public services. The render worker owns the placeholder
player mesh and third-person camera. Benchmark/flythrough preflight and measurement
take explicit presentation/observer ownership and suppress gameplay application until
reset, while retaining the latest gameplay pose for resumption. Reset also clears the
flythrough environment sample. Render recovery publishes its replacement canvas through
the engine interface so input rebinds to the visible surface. Save/load publishes the
restored command-sequence anchor; the game bridge rebases sequence/tick scheduling and
emits current physical input after a rewind. The engine service suppresses commands
behind a load barrier: a successful rewind discards them before the bridge emits current
input against restored anchors, while a rejected load rebases them beyond the latest
published tick plus snapshot-cadence lag and applies them to the unchanged timeline.

Advance the sim worker protocol to v2 and nested telemetry to v3, public telemetry to
v41, `smoke@1` to schema v67 / mandatory metric set v31, flythrough to schema v33, and
render recovery to schema v29. The replay result and live sim telemetry expose movement
distance, collision-resolution count, interaction attempt/activation count, and the
accepted command-sequence anchor. `smoke@1`'s 120-tick moving-controller replay must
show positive movement and gates the maximum measured step-duration high water across
both deterministic executions at a provisional ≤2.00 ms on both tiers. This is
controller-subsystem capacity evidence, not the combined
character-plus-NPC envelope; NPC navigation/crowds must recalibrate that later workload.

**Context:** D-156 intentionally stopped at an empty authoritative loop. Implementing
movement on the main thread or inside the render worker would split authority and make
save/replay/P2P constraints fictional. Sending the complete render district to the sim
would also duplicate irrelevant LOD/material payloads and couple gameplay collision to
presentation.

**Consequences:** The first playable greybox loop uses keyboard/pointer input, a visible
placeholder capsule, terrain/obstacle collision, third-person camera control, streamed
observer movement, and authored transition interaction without selecting the future UI
substrate. Save schema v1's envelope remains compatible because the binary envelope is
unchanged; the game payload advances to state schema v2. A physical `smoke@1` is required
under D-157 because this changes sim replay, render-worker content/camera, streaming
observer wiring, public telemetry, and the smoke validator.

The accepted physical-console evidence is schema-v67 / mandatory-metric-set-v31 report
`smoke-1-ea19e3ab0e9b-dev-01-showcase-2026-08-08T16-49-59-763Z.{json,md}`
(JSON SHA-256 `0b533a01771d621553ff91e6c2c4dfef00ea7c9e35fd814c0b146379d86cf195`;
Markdown SHA-256 `d22ba583a7f2903b0d7960b07a1ad2f319be4ee543220225b76d0490b846bf69`).
All six launches and all three facets passed with 36/36 checks. The two-execution
moving-controller step-duration high water measured 0.365–0.430 ms across launches
(maximum 0.430 ms versus the 2.00 ms budget), and every replay moved exactly
14.875040054321289 m.

**Reopen if:** representative controller work makes the boot-time collision projection
material, streamed collision needs cell-level admission/eviction, a non-capsule body is
required, or measured input/control traffic needs a SAB path rather than coalesced
commands.

---

## D-157: Match physical qualification to the scenario's exercised surface (2026-08-08, accepted)

**Decision:** Supersede D-097's artifact-wide physical-smoke trigger with an
impact-based trigger. A final candidate requires the registered physical-console
`pnpm harness:smoke` only when the change has a credible causal path to behavior,
telemetry, evidence validation, or a budget that the current `smoke@1` scenario
actually exercises or evaluates. Changing a built artifact or its digest is not, by
itself, a physical-smoke trigger.

The current smoke surface is the six-launch boot/launch core and its explicitly
observed greybox rendering, world streaming, simulation replay/save-load, SAB
transport, Rust/Wasm threads, render callback pacing, all-worker heap, Dawn pipeline
cache, PSO warmup, serving/environment identity, telemetry, report finalization, and
their smoke-specific validators and budgets. A change to one of those paths, its
collector, its reference-machine inputs, or its smoke budget/mandatory contract
requires one post-review physical smoke. A change isolated from every one of those
paths does not.

Changes to a subsystem exercised only by a specialized scenario use that scenario's
own documented trigger; they do not inherit a routine smoke requirement merely because
they alter app, engine, game, worker, Wasm, dependency, or build bytes. Likewise, a
flythrough-only validator, an AI-only path, dormant future code, or a non-smoke budget
does not trigger routine smoke unless the candidate also affects the smoke surface.
Documentation-only, test-only, and machine-local changes remain exempt unless they
change a smoke-specific contract, budget, reference input, or an existing
candidate/result qualification claim.

Every handoff records either `Physical smoke: required` with the affected smoke
surface, or `Physical smoke: not required` with the reason no current smoke path is
affected. Agents resolve uncertainty by tracing the scenario, telemetry, validators,
and budget consumers; they do not use artifact identity drift as a proxy for impact.
D-097's final-candidate batching, physical-console requirements, fail-closed evidence,
and intermittent-failure rules remain in force when the impact trigger fires.

**Context:** The routine Showcase smoke takes six physical launches and coordinates a
local interactive display. Its evidence is valuable for the systems it runs, but an
unrelated bundled subsystem can change artifact identity without executing during the
scenario or affecting any collected value. Requiring the same physical run in that
case spends scarce console time without increasing confidence in the change. The
project already uses targeted opt-in qualifiers for subsystem-specific evidence; the
routine gate should follow the same evidence-to-claim discipline.

**Consequences:** `pnpm check` remains the universal deterministic handoff gate. The
physical run becomes a mapped verification step instead of an artifact-wide tax. Plan
items and handoffs must identify the applicable scenario surface explicitly, making an
incorrect skip reviewable. Historical D-097 results and qualification decisions remain
immutable; this changes only the trigger for future candidates and does not weaken any
budget or scenario once applicable.

**Reopen if:** impact analyses routinely miss regressions that the broad artifact-wide
trigger would have caught; the smoke becomes cheap and unattended enough that broad
coverage is again worthwhile; or the scenario gains an explicit whole-product property
whose validity truly depends on every shipped byte.

---

## D-156: Establish the M3 simulation boundary and six-role worker topology (2026-08-08, accepted)

**Decision:** Run authoritative gameplay in an engine-owned dedicated worker at a fixed
60 Hz. Game code supplies one pure adapter through an exact same-origin,
content-addressed game-simulation module; the common worker owns scheduling, ordered
tick-stamped command admission, semantic event sequencing, binary save/load, hashing,
and telemetry. Live authority and every replay use separate adapter instances created
by the admitted game-module factory. Stable positive integer entity IDs and transforms
publish at 30 Hz
through a fixed-at-boot triple-buffered SAB sized for 4,096 entities. Rendering/UI may
interpolate those presentation snapshots but cannot mutate authoritative state.

Advance the build manifest to v16 with exactly
`decode|installer|render|sim|streaming|wasm-thread`, public telemetry to v39, smoke to
schema v65 / mandatory metric set v30, flythrough to schema v31, and render recovery to
schema v27. Advance the installed launch lifecycle to `launch-to-interactive@3` /
schema v3; interactive completion now requires an observed simulation-worker request
and running state as well as the existing shell, streaming, and render milestones.
Because asset-update evidence embeds that lifecycle shape, advance newly produced
evidence to `asset-update-v8-lifecycle@4` / schema v4. Retained v3 evidence remains
valid only with its exact `launch-to-interactive@2` shape and five-role release
topology; it is not reinterpreted under the new lifecycle.
`smoke@1` core-run completion now requires two identical 120-tick replays of
the same non-empty input log plus worker save/load hash agreement. Save schema v1 binds
the fixed timestep, tick, last applied sequence, next semantic-event sequence, game
payload, and queued future commands under one SHA-256 digest. State hashes identify the
canonical game payload without rebuilding the save/queue envelope on the 30 Hz
presentation path. Cross-machine replay remains advisory under D-150.

**Context:** M3 is the first milestone with authoritative gameplay state. The earlier
architecture deliberately reserved a sim worker but build-manifest v15 admitted only
five roles. Keeping the scheduler in `game/` would violate the platform boundary;
statically bundling game rules into the worker would violate D-010's shareable common
engine contract. Variable-size `postMessage` snapshots would also silently abandon the
existing high-rate sim→render SAB constraint.

**Consequences:** The empty foundation loop adds no standalone performance threshold.
Step-duration/scheduler-lag high waters, dropped catch-up ticks, queue pressure, hashes,
save/load counts, and exact SAB capacity/bytes are observable from day one; unchanged
frame, heap, long-task, and fixed-SAB budgets still gate the candidate. Calibrate a
sim-step threshold only after character and NPC workloads are representative. The next
M3 item can add controller rules entirely in the game adapter and connect interpolated
snapshots to rendering without changing command, save, or worker ownership.

Each SAB slot uses an atomically committed generation marker so a recycled slot cannot
be accepted while being rewritten; ticks and entity IDs use lossless safe-integer
low/high words. A presentation consumer that falls three or more publications behind
drops the stale transform view while still consuming its ordered semantic events and
telemetry. Publication generations fail before signed-31-bit wrap. Synchronous replay
requests are bounded to 10,000 ticks, 65,536 commands, and 16 MiB of command data, and a
request timeout terminates the worker cohort rather than leaving an apparently-running
wedged authority.

**Qualification evidence:** The replacement registered dev-01/Showcase physical-console
`smoke@1` result
`smoke-1-97de6eac2741-dev-01-showcase-2026-08-08T15-02-01-915Z.{json,md}` qualifies the
fresh-adapter replay and terminal-lifecycle review fixes. It passed schema v65 /
mandatory metric set v30 with environment, evidence-completeness, and budget facets
all passed, 30/30 checks evaluated, and no core-run failure. It binds artifact
`97de6eac27417c97ee94f322305b352d73aee4a87970802ed318e6b7eb0c6c7e` and release
`cfec1186befa476ae0b9ad09513af1815d7ef3b6231c5106b082e558a5e3a301`; the JSON SHA-256
is `cf14bdffa7e2dbf6938606dd197501a2973aa3cabc2823a55838f95bf414e08a`. The prior
schema-v65 result for artifact `656bca1dafb0…` remains valid evidence for that earlier
candidate.

**Reopen if:** measured structured-clone/control traffic rather than transform payloads
becomes material; 4,096 presentation entities is insufficient for the slice; save
migration needs a sectioned/delta successor; or future P2P evidence requires rollback
or authoritative-state sync instead of deterministic command replay.

---

## D-155: Process rightsized to MVP scale — one pass, human gate, reviews on demand (2026-08-04, accepted)

**Decision:** The default unit of work is one agent implementing the task, running the
repo checks (`pnpm check`, plus the one physical D-157 `pnpm harness:smoke` when the
change qualifies), and handing the working tree to the human, who scans the note and
diff and commits. The mandatory review pipeline — tech-lead adversarial pre-handoff
review, reviewer-mode multi-agent fan-out with adversarial challenge, and
fix-pass/verify-pass modes (D-026/D-027/D-030/D-049) — is removed. Reviews happen on
demand: one agent, one pass over the whole uncommitted diff, hunting real defects
(data loss/corruption, security, broken behavior) and fixing directly unless the human
asked for a report only. Heavyweight review (multi-agent fan-out, adversarial
challenge, fix/verify rounds) survives only as an owner-requested option for
data-destroying or security-sensitive changes — the production deployer, OPFS
install/uninstall deletion paths, and harness budget/evidence checks. Logging
thresholds rise accordingly: decision entries only for expensive-to-reverse or
silently-undoable choices; rough-edges entries when a quirk cost real debugging time;
measurement/current-source grounding for the claims a decision actually hangs on
(root rules 1–3 rewritten; old rules 3 and 10 merged; old 11/12 renumbered to 10/11).

**Context:** Owner direction (2026-08-04): this is an MVP/PoC/demo with roughly one
user, and the process was sized for production software. The same rightsizing was
made in the owner's cve.meenan.dev repo and recorded there as its D-062.

**Consequences:** Faster iteration; some defects reach the tree that the pipeline
would have caught — accepted given the blast radius. Unchanged: the load-bearing
constraints, the human commit gate (agents never commit), the D-157/D-145
validation and physical-gate cadence, the production-deployment safety rules, the
pinned-tool registry, and the closed-experiment rule. workflow.md's loop and its
tech-lead, reviewer, fix-pass, and verify-pass sections are replaced by the lean
build → commit loop with on-demand reviews.

**Reopen if:** the project acquires real users or contributors, or regressions start
costing more than reviews would.

---

## D-154: Make short-smoke streaming repeatability informational without weakening per-launch gates (2026-08-02, accepted)

**Decision:** Advance `smoke@1` to report schema v64 / mandatory metric set v29 and
remove only its three-fresh/three-warm streaming cell-load p95 cross-launch
repeatability result from mandatory evidence and facet authority. Continue to compute
the exact D-116 bounded result (`max(10% × minimum cohort p95, 1 ms)`), validate it by
recomputing from the six launch records, retain invalid reasons and ranges in JSON and
Markdown, and include invalid states among non-blocking informational failures. Keep
each launch's streaming evidence mandatory and keep the 250 ms p95 budget and all 30
budget checks unchanged. Do not change flythrough or public-benchmark repeatability.

**Context:** The immutable schema-v63 production-target report
`smoke-1-2404befc4e5d-dev-01-showcase-2026-08-02T21-26-10-326Z.{json,md}`
(JSON/Markdown SHA-256
`157da01e5f9380cab43122d16d58ba964958238e13eee37636c866cd2efe5428` /
`8caf05bb68ea162b4ee89d95f678611f365d44c1dbeab892cacc5da7dbd4eead`)
completed all six core launches with no core-run failure, exact verified production
pre/post build/release identity, and a passing registered dev-01 Showcase environment.
Its fresh and warm streaming p95 absolute ranges were
1.1499998569488525/1.2650001049041748 ms against the 1 ms allowance. That made evidence
completeness fail and withheld the otherwise populated 30-check budget verdict even
though each individual launch retained valid streaming evidence and remained within
the separate 250 ms absolute budget. This decision does not relabel that failed report
or infer a cause for its measured variation; it corrects the prospective authority of
a short-scenario diagnostic that is not itself a performance budget.

**Consequences:** Current validators still reject forged, missing, non-finite, negative,
or structurally inconsistent streaming observations and recompute the diagnostic from
the per-launch evidence. Baseline parsing and promotion may accept an invalid
cross-launch diagnostic only when the report otherwise passes all facets and checks;
the invalid diagnostic remains explicit. A fresh schema-v64 production-target result
is required by D-097/workflow before a later candidate is accepted. D-153's retained
closure evidence and all historical reports remain immutable.

**Qualification evidence (2026-08-02):** Retain the first schema-v64 production attempt
`smoke-1-2404befc4e5d-dev-01-showcase-2026-08-02T21-47-55-215Z.{json,md}` as failed
(JSON/Markdown SHA-256
`1af2c47a72180407199897990b4f3abf45db49a1497f2b0560269fe435d8ebf8` /
`d4417d8c20d5f714f7e83fb8ca45a43f520cb65db69bad558cc8720ee325d893`).
The physical environment changed during that run to a remote session and Microsoft
Remote Display Adapter at 6017x3386/32 Hz; callback pacing and one heap sample became
invalid. It is environment-invalid evidence and is not relabeled. Its over-limit fresh
streaming range remained correctly visible only as an informational failure.

After the user restored the physical console, the one adjudicated corrected report
`smoke-1-2404befc4e5d-dev-01-showcase-2026-08-02T21-53-48-499Z.{json,md}` passed
(JSON/Markdown SHA-256
`fa88dcb2f14d4608e02a53dbc5bb7951508a79670aa418eaba755c64e21ac9b0` /
`71fa1951e038968a9216bab1e64a5883e42dbb43918a9371669534cb1560e990`).
It binds source `7fdc5465b5903751301a4e319a160848eacefac6` /
`e007e3389eea6f26d4f3e498360683fda9de47dc766a1db235bc0e89fe9164a1`,
artifact/release
`2404befc4e5d0e2faa0c75c8e9893fe0c5c93ba57589698b4edf648525c1e9bb` /
`61d3c12f08737f3dae8756da14c2d7e1b1191e249a5a9005500af34c69e5e785`,
and exact verified production pre/post identity under CfT 151.0.7922.71 on registered
dev-01 Showcase. All six launches, all three facets, and all 30 unchanged checks passed.
Fresh/warm informational streaming ranges were 0.8849999904632568/0.4100000858306885 ms.
Independent validation accepted the report. This evidence-only recording is covered by
D-119 and requires no additional physical run.

**Reopen if:** short-smoke repeatability becomes demonstrably predictive of a player-
visible regression that the per-launch 250 ms budget and longer scenario gates miss; a
new calibrated threshold is adopted with evidence; or any implementation suppresses
the diagnostic rather than merely removing its facet authority.

## D-153: Close M2 on the exact dev-01 candidate and advance to M3 (2026-08-01, accepted)

**Decision:** Close M2. Every M2 plan item is complete, D-149 accepts the full
M2-exit/M3-entry dependency checkpoint, D-150 makes dev-01 the sole required physical
gate, D-151 accepts the exact install/launch/update lifecycle evidence, and D-152 accepts
the required installed branded-Stable parity result. Treat M3 as the next active
milestone. This is a D-119 evidence-only closure: it changes no runtime or harness byte,
budget, threshold, mandatory evidence contract, dependency/browser pin, deployment
content, or registered-machine descriptor and therefore requires no new run.

**Context:** The exact-current CfT 151.0.7922.71 production `smoke@1` report
`smoke-1-e4532dcec4d6-dev-01-showcase-2026-08-02T00-30-12-454Z.{json,md}`
binds source `7fdc5465b5903751301a4e319a160848eacefac6` /
`95a0fa40b928d2a2ba5a98b8481a66a1d174925a8399d5dd0a9b722fe707a48e`,
artifact/release
`e4532dcec4d615501d2130425571c5d3e1128331187dcfd7ef92f99e4f44351b` /
`be1a7f53c1b74a1aad1638cab5291fdc95bc7fdcba27f63604111efb4469a96e`,
and JSON/Markdown SHA-256
`6028aa225b14e6c32398ead849dc00784f075c4b410e61a336376b970e105a8e` /
`1b00d8746308e0297d93f7e68c1c14cb8f0437d2832249efe7029a2328e02a20`.
Exact pre/post production identity, versioned nginx MIME/isolation behavior, registered
dev-01 physical-console and sandbox identity, all six launches, all three facets,
schema v62 / mandatory metric set v28, all 30 checks, and rendered output passed. The
baseline remains untracked. The exact production artifact was already deployed with
the five model objects preserved and the versioned nginx configuration installed; KTX2
is served as `image/ktx2`.

The final deterministic closure gate preserved repeatable build output, linted 422
files, passed 2,274 tests across 172 files with one skip, and passed
`git diff --check`. D-149 and D-152 retain the browser-transition and branded-parity
evidence, including their immutable failed attempts and exact claim boundaries. The
M2 platform synthesis is current in
[chrome-platform-gaps.md](chrome-platform-gaps.md); the underlying rough-edge entries
remain the evidence source of truth.

**Consequences:** M2 is complete only at the accepted dev-01 Showcase scope. No
Standard or other-hardware result is implied, no baseline is promoted, and the separate
branded result remains baseline-ineligible, nonpromotable, and not budget-authoritative.
M3 may begin against the accepted Node 24.18.1 / CfT 151.0.7922.71 checkpoint without
repeating M2's already accepted physical qualifiers. Historical failures and D-138
evidence remain immutable.

**Reopen if:** an accepted evidence identity or retained verdict is invalidated; the
production artifact/config no longer matches the exact qualified candidate; a later
runtime, harness, budget, pin, or registered-machine change triggers D-097; or a future
milestone explicitly depends on an M2 lifecycle property outside the recorded scope.

## D-152: Bind branded Chrome parity to exact product plus truthful reduced-UA identity (2026-08-01, accepted)

**Decision:** Advance `branded-parity@1` to schema v2. Keep the installed executable's
exact four-component file version bound to the exact `Browser.getVersion.product`
`Chrome/<version>` value. Accept the single Chrome user-agent token only when its
four-component value is either that same exact full version or the exact reduced
`<major>.0.0.0` form. Reject another family, major, partial reduction, mismatched full
version, or multiple Chrome tokens. Persist the independently validated installed
identity and bounded exact-key raw `Browser.getVersion` tuple before relational
validation, so a contradiction remains visible in failed evidence without ever passing.

**Context:** The immutable schema-v1 attempts
`branded-parity-v1-2026-08-01T23-45-46-873Z/result.{json,md}` (SHA-256
`12a59e930c3d31a1a5a8e5434fa1d827f26fa180f5fcc7977c491de703ac71b6` /
`678af5e3b1bcac4a707ba115effff555debee5bcce1a70f78cf571aad0fb7e24`)
and `branded-parity-v1-2026-08-01T23-58-58-934Z/result.{json,md}` (SHA-256
`e0809f6208cd7b5acf8b5cb71c54acef5b80237a063c3bc9947d3fb9a95c8d33` /
`f8ef58588ac9045e0ac4dfea1ab4e132265aafa5181b9781bd6d5af9636205fc`)
failed respectively on inbox PowerShell module-path harness drift and an impossible
full-version reduced-UA harness contract. Both remain immutable and adjudicated; neither
is a Chrome rough-edge claim. One bounded identity-only launch on dev-01 using the
reviewed branded launcher observed installed/product
`151.0.7922.72`, revision `@2903d8558c752b5a554a1a47b4ea7219ba1a31ef`, UA
`Chrome/151.0.0.0`, V8 `15.1.206.10`, and protocol `1.3`; Chrome was immediately
closed and no parity scenario ran.

The corrected `branded-parity@1` schema-v2 pair
`branded-parity-v2-2026-08-02T00-19-27-032Z/result.{json,md}` passed with
JSON/Markdown SHA-256
`94bfed662d329612fe4fe2717a1950b8afcf1d0f4a8a6ca9950adc2ebd9abed9` /
`f33c187f4e60478bef9cdbf85c7c61b4fbd84659fd184e3d2313b13b9178dddd`.
It binds source `7fdc5465b5903751301a4e319a160848eacefac6` /
`95a0fa40b928d2a2ba5a98b8481a66a1d174925a8399d5dd0a9b722fe707a48e`,
artifact/release
`e4532dcec4d615501d2130425571c5d3e1128331187dcfd7ef92f99e4f44351b` /
`be1a7f53c1b74a1aad1638cab5291fdc95bc7fdcba27f63604111efb4469a96e`,
installed branded Chrome 151.0.7922.72 executable SHA-256
`7ef01c7774d223c14034de437d3f33040b1199f5ed322b45e49245419027c5d9`,
exact CDP product `Chrome/151.0.7922.72`, revision
`@2903d8558c752b5a554a1a47b4ea7219ba1a31ef`, and reduced UA
`Chrome/151.0.0.0`. Its six launches, three facets, and 30/30 smoke checks passed.

**Consequences:** Full executable/product identity and selected-CfT major/build
comparability remain fail-closed. UA validation describes the strongest exact
relationship the current branded browser truthfully exposes. The D-149 installed
branded-Stable parity trigger is satisfied. The result remains baseline-ineligible,
nonpromotable, and not budget-authoritative, so it neither replaces nor invalidates the
final pinned-CfT dev-01 qualification. Old results remain immutable.

**Reopen if:** Chrome changes the desktop UA reduction form, CDP stops exposing an
exact full product version, or a stronger stable browser-owned identity becomes
available.

## D-151: Accept the exact dev-01 install-lifecycle exit and remove redundant new-object verification (2026-08-01, accepted)

**Decision:** Treat a successful `finalizePartial` return from the sole production OPFS
release store as the verification boundary for a newly transferred object. The store
returns that reference only after exact partial size/SHA-256 validation, replacement
copy and flush, an exact size/SHA-256 reread of the published bytes, and creation of the
immutable verified marker. The installer transfer layer therefore does not immediately
call `verifyObject` and hash those same new bytes a third time. A resource discovered as
an already verified/reused object still goes through `verifyObject`, and release
activation still runs `verifyRelease` across the complete staged release before ready
marking and publication.

Accept the dev-01 Showcase
`asset-update-v8-lifecycle@3` result
`harness/results/asset-update-v8/asset-update-v8-v3-2026-08-01T19-10-36-547Z.{json,md}`
as the exact-candidate M2 install/launch/update lifecycle exit evidence. It binds CfT
151.0.7922.71 and base artifact/release
`e4532dcec4d615501d2130425571c5d3e1128331187dcfd7ef92f99e4f44351b` /
`be1a7f53c1b74a1aad1638cab5291fdc95bc7fdcba27f63604111efb4469a96e`.
JSON/Markdown SHA-256 are
`a7060701006fbcea03b26dd6281eee4d2e9d0b66fd176d4766a3e716489a83d6` /
`c9e1d7723e9c83149bb43136dbb598a77d048b6bfc5a378deccfea5b0f868ee8`.

**Context:** The prior D-144 pair closed the bounded V8/asset-only-update item but did
not qualify a full initial install or fresh installed launch for the final M2 candidate.
The v3 qualifier therefore measures installer-worker network-active time independently
from wall time and gates their residual as local critical-path work. Earlier retained v3
attempts exposed a source-representation mismatch, two genuine local-work budget
failures, and result/post-validation contract drift. A pre-final passing pair preceded
the final exact V8 diagnostic-state correction. They remain evidence, but none is the
accepted result and none establishes a Chrome rough edge.

The accepted run completed the 99,359.9553 ms initial install with an exact
21,286.798001527786 ms installer-worker network-active union across two control requests
and 266 full-resource Range transfers totaling 2,621,468,856 bytes. The resulting
78,073.15729847222 ms network-idle/local-critical residual passed the unchanged 90,000
ms ceiling. The final-verification first-observed span was 16,232.9675 ms under 20 ms
polling. Fresh installed launch was 5,821.355 ms against the 30-second ceiling;
pre/post-update warm launches were 9,157.250/5,681.140 ms against the 10-second ceiling,
with a signed post-minus-pre delta of -3,476.110 ms. Exact authority and independent
post-validation passed.

**Consequences:** M2's dev-01 lifecycle exit checkbox is satisfied for this exact
candidate. The full-store activation verification and reused-object corruption check
remain intact while newly downloaded bytes avoid an immediately redundant full reread
and hash. V8 trace, cache, and production diagnostics retain their exact measured or
invalid states and remain non-gating; they are not cache-hit evidence. The relative
post-update launch threshold remains unset.

At this decision boundary D-149, its `.34`/`.71` transition, final production smoke,
branded-Stable parity, nginx installation, deployment, and M2 closure were still
independent open gates. D-149, D-152, and D-153 subsequently record their completion.

**Reopen if:** another store implementation can return a reference without the exact
finalization sequence above; new-object finalization stops rereading published bytes or
writing an immutable marker; reused resources stop receiving `verifyObject`; activation
stops running complete `verifyRelease`; or a later accepted lifecycle result invalidates
the measured budget conclusion.

## D-150: Make dev-01 the sole required hardware qualification gate (2026-08-01, accepted)

**Decision:** Unless a future explicit human decision changes the policy, dev-01 is the
sole required physical/reference, budget, and milestone entry/exit gate for every
milestone. Standard-profile, macOS/Metal, cross-machine replay, cross-hardware transfer,
and all other-machine work remain aspirational planning or exploratory/advisory
research. They may produce platform findings, but cannot block a milestone or invalidate
an exact-candidate dev-01 acceptance. Deterministic replay remains required as repeated
same-host replay on pinned dev-01; cross-machine determinism remains a design objective
for future P2P, not a current gate. Browser-pin comparisons and installed branded-Stable
parity remain required when their standing triggers fire, but run on dev-01. This changes
machine coverage, not browser, source, artifact, evidence, or physical-console
correctness.

**Context:** The project currently has one registered and calibrated gate machine,
dev-01. Prior plan clauses required hardware that was unregistered or unavailable and
therefore turned aspirational transfer and cross-platform goals into milestone blockers
without improving the validity of dev-01 evidence. The human explicitly set dev-01 as
the only required test machine on 2026-08-01. D-150 supersedes D-016's cross-machine
verification gate, D-018's Standard gate provisions, and D-141's mandatory M6 Standard
qualification provision while preserving their multiplayer, transfer, Metal/D3D12, and
planning intent.

**Consequences:** M2 closes on exact-candidate dev-01 cold-install/warm-launch evidence;
M3 and M3.5 require same-host deterministic replay on dev-01; M6 qualification is
dev-01-only. Standard numerical budgets and machine profiles remain advisory envelopes.
Optional other-hardware results are labeled findings-oriented and never promoted as a
required substitute for dev-01. Existing historical results and claims keep their
original scope.

**Reopen if:** the human explicitly adds a required machine or profile; a committed
multiplayer architecture requires a cross-machine acceptance gate; or dev-01 no longer
represents the intended Showcase target and a replacement is explicitly registered and
adopted.

## D-149: Accept the M2-exit/M3-entry dependency checkpoint (2026-08-01, accepted)

**Decision:** Adopt four bounded dependency changes for the M2-exit/M3-entry currency
checkpoint: Node 24.18.1 from 24.18.0,
Chrome for Testing Stable 151.0.7922.71 from
151.0.7922.34 at unchanged CfT revision 1654411, harness-only `sharp` 0.35.3 from
0.34.5, and transitive PostCSS 8.5.25 from 8.5.17. Keep pnpm 11.12.0 and the exact
Vite/Vitest manifest pins; PostCSS moves through their existing compatible ranges with
no override. Retain every other repository-selected input under the explicit selected,
deferred, or current disposition in the dated dependency checkpoint.

**Context:** Node 24.18.1 is a 2026-07-29 security release with three high-severity and
multiple lower-severity fixes. Its official Windows x64 ZIP matched SHA-256
`ec56b84a7551893ab2324ebdfdc4ab974a63b4781162600b68a1293cc3e53765`;
the extracted `node.exe` matched
`ac51903c4c111815d52280b1fdcc8da067cbb37e2fe1a765097b85c3292c8582`.
The official CfT known-good feed binds 151.0.7922.71 to revision 1654411; the installed
win64 browser reports `Chrome/151.0.7922.71`, CDP revision
`@ef35003457e93c278f911a334b06e4a5f8967e06`, and executable SHA-256
`112b7b761c1b6cfa898c56e725f87f7a999a16a0d367d5345824d53336f52acc`.
GitHub's reviewed advisories mark `sharp` versions before 0.35.0 and PostCSS through
8.5.17 affected; the selected candidate versions clear both findings. Official Node release and
checksums, CfT feed, npm metadata, upstream releases, and GitHub advisories were checked
2026-08-01. Deterministic gates and exact identities are recorded in
[dependencies.md](dependencies.md#full-checkpoint--2026-08-01-m2-exit--m3-entry).

The same-source transition retained CfT 151.0.7922.34 anchor
`smoke-1-e4532dcec4d6-dev-01-showcase-2026-08-01T23-33-08-928Z.{json,md}`
(SHA-256
`9e82f666df9ab559e26972c20ac466329f5783d20a2f71a2da033c2e1383b40a` /
`c631475fa912d167ed273b76ec9f1d0e2a5ca12da0f15f0da49f2611ea8c844b`)
and selected CfT 151.0.7922.71 half
`smoke-1-e4532dcec4d6-dev-01-showcase-2026-08-01T23-40-44-832Z.{json,md}`
(SHA-256
`3053a55fa243414e786cf58356fcad1788ed861be2a8fc5eb28877d20d03a984` /
`5da376c711a7d1200e1ce046e36c53ed0e5e040b98182e5641ffd56bbf33e0fa`).
Both bind source `7fdc5465b5903751301a4e319a160848eacefac6` /
`66dc25c2649ff8d82cc7413fb44349b719dedcd27cc7ba1cb506ad34e4a585f9`,
artifact/release
`e4532dcec4d615501d2130425571c5d3e1128331187dcfd7ef92f99e4f44351b` /
`be1a7f53c1b74a1aad1638cab5291fdc95bc7fdcba27f63604111efb4469a96e`,
and the same `smoke@1` scenario. Each passed schema v62 / mandatory metric set
v28 with all six launches, all three facets, and 30/30 checks. Transition review found
no calibrated relative threshold or pin-specific regression; it does not invent one.

D-152 accepts the separately required installed branded-Stable parity result. The final
exact-current CfT 151.0.7922.71 production report
`smoke-1-e4532dcec4d6-dev-01-showcase-2026-08-02T00-30-12-454Z.{json,md}`
(SHA-256
`6028aa225b14e6c32398ead849dc00784f075c4b410e61a336376b970e105a8e` /
`1b00d8746308e0297d93f7e68c1c14cb8f0437d2832249efe7029a2328e02a20`)
binds current source `7fdc5465b5903751301a4e319a160848eacefac6` /
`95a0fa40b928d2a2ba5a98b8481a66a1d174925a8399d5dd0a9b722fe707a48e`
and artifact/release
`e4532dcec4d615501d2130425571c5d3e1128331187dcfd7ef92f99e4f44351b` /
`be1a7f53c1b74a1aad1638cab5291fdc95bc7fdcba27f63604111efb4469a96e`.
Exact pre/post production identity, MIME/isolation, registered dev-01 physical-console
and sandbox identity, rendered output, six launches, three facets, and 30/30 checks
passed under schema v62 / mandatory metric set v28.

**Consequences:** Node 24.18.1, CfT 151.0.7922.71, harness-only `sharp` 0.35.3,
and transitive PostCSS 8.5.25 are accepted current/reference inputs. The old Node and
CfT 151.0.7922.34 installs remain intact for reconstruction. No baseline was promoted;
the branded result remains baseline-ineligible, nonpromotable, and not
budget-authoritative. No gate on another machine is added. This checkpoint satisfies
M3 entry; D-153 closes M2's separate exit after all M2 items and production gates are
complete.

**Reopen if:** a relevant advisory or release appears; a deferred component-family
trigger in dependencies.md fires; exact install, build, or repeatability diverges; the
`sharp` rendered-output fixture changes; or a later qualifying dev-01 result finds a
pin-specific regression.

## D-148: Retire the literal 100 GiB write qualifier; accept modeled install-manifest plus representative physical scale (2026-08-01, accepted)

**Decision:** Amend D-009's scale-proof mechanism. Keep a deterministic model that
generates exact bytes for a ≥100 GiB document and submits the document decoded from
those bytes to the production install-manifest parser. The parser's summary is the
authority for resource count and byte accounting, and the SHA-256 of the exact manifest
bytes is manifest-level release
identity. Comparing three accepted documents describes a one-resource update and a
source rotation at the manifest level without materializing resource bodies or
executing transfer, resume, integrity, update, cleanup, or eviction at 100 GiB. Accept
the representative streaming qualifier as the physical scale boundary:
its modeled inventory is 165,505,371,388 bytes across 71,680 resources and its
materialized decode → GPU-upload target is 2,623,040,066 bytes. The accepted
`scale-streaming-v1-2026-08-01T11-18-11-203Z.{json,md}` SHA-256 values are
`e2a2028b548e27934ea5a6365cb4f9ce690dca8b7a9bcf5cf8b4fb2dbd5833b2` /
`243c31b2e430cc7db720257b8d2b592ed7ab6ff0611bffef38ac73ccd1def910`.

The representative corpus also advances the district index to schema v2. Its seventh
top-level `resources` key contains exact content-addressed KTX2, legacy meshopt, and
versioned meshopt vertex/index descriptors; per-cell `dependencies` name their roots.
Descriptors form an acyclic, topologically resolved graph. The streaming worker keeps
a reference-counted CPU dependency cache correlated with render-worker GPU ownership,
so shared resources are decoded/uploaded once and released only after their last
resident cell. Each dependency is capped at 8 MiB encoded and 32 MiB decoded, and one
atomic batch may stage at most 128 MiB. These are fail-closed content and allocation
bounds, not measured resident-memory claims.

Delete the dedicated physical lifecycle runner, evidence schema, orchestration tests,
quota-UX-only helpers, and public store-retention export. The production store keeps
its private two-checkpoint pruning policy.

**Context:** Current Chromium source sets the temporary storage pool to 80% of total
disk and the per-storage-key quota to 75% of that pool, a nominal 60% of total disk.
The local C: volume reported 1,998,819,684,352 total bytes, implying a nominal
approximately 1.199 TB per-key ceiling, subject to storage pressure and free space.
Chromium's static quota feature reports the privacy-shaped `usage + 10 GiB`, not that
internal ceiling. The WHATWG Storage Standard deliberately leaves quota policy
implementation-defined and specifies a conservative estimate, while OPFS is quota
bound and does not prompt for permission. Sources checked 2026-08-01:
[WHATWG Storage](https://storage.spec.whatwg.org/),
[web.dev OPFS](https://web.dev/articles/origin-private-file-system), Chromium
[`quota_features.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/storage/browser/quota/quota_features.cc),
[`quota_settings.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/storage/browser/quota/quota_settings.cc), and
[`quota_manager_impl.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/storage/browser/quota/quota_manager_impl.cc).

Four physical lifecycle attempts remain immutable history under
`harness/results/scale-lifecycle/`. The first incorrectly treated Chromium's
privacy-shaped `usage + 10 GiB` estimate as total hard capacity. The second rejected an
asynchronous progress overshoot, and the third assumed one retained checkpoint when the
product retains two. The fourth retained only the generic failure `Scale lifecycle
progress stalled`, with no phase, diagnostics, journal, or deadline state; it is
underdiagnosed harness evidence and supports no transfer or Chrome attribution. None
demonstrated a Chrome capacity limit. The latest
`scale-lifecycle-v2-2026-08-01T13-56-10-939Z.{json,md}` SHA-256 values are
`76eb44956bd87786c8732b955643002e11e0d492e4a43710c22abe4e6f508280` /
`9219b97a6eccdda2379ea3515abc4be9cdaec1c310474260b8d94a17327fe88b`.
No Chrome rough edge is claimed from these attempts.

**Consequences:** M2's scale item closes on size-independent production
install-manifest parsing, summary arithmetic, manifest-level identity/change
descriptions, and representative physical streaming evidence. Separate bounded M2
physical qualifiers—not this model—support actual transfer, resume, integrity, update,
cleanup, and eviction mechanisms. This decision makes no literal 100 GiB execution
claim and does not guarantee capacity on every machine. A reported quota estimate is
planning evidence, never install admission authority; actual bounded transfers remain
resumable, integrity-checked, and `QuotaExceededError`-aware. D-009's ≥100 GiB
architectural floor remains, but its instruction to grow a physical filler write until
a platform limit appears is superseded. The accepted scale result did not close M2's
then-current multi-machine exit gate; D-150 later replaces that gate with exact-candidate
dev-01 qualification.

**Reopen if:** production install-manifest parsing, summary accounting, or
manifest-level identity/change contracts develop a size-dependent path not covered by
the model; representative encoding, file-distribution, dependency, decode, or upload
properties change materially; a current browser measurement contradicts the reviewed
quota implementation; or a real install exposes a reproducible limit below the
supported product scale.

## D-147: Accept the confirmed dual-mechanism uninstall lifecycle (2026-07-31, accepted)

**Decision:** Close D-024's M2 uninstall item with two explicit, destructive, reload-only
paths behind the same in-shell confirmation surface. The client-side path first disposes
the installer runtime, obtains exclusive cross-client authority, and then enumerates,
deletes, and twice rechecks service-worker registrations, Cache Storage, IndexedDB, and
OPFS before reporting success and measured quota release. The static path is the exact
same-origin, query-free `POST /uninstall` endpoint with
`Clear-Site-Data: "storage", "cache"`; the stable service worker must pass that request
directly to the network rather than synthesize or proxy its response. Both paths lock all
installer/destructive actions once started and require reload before reuse. The save
export control remains visibly unavailable and states why: M2 has no save-game subsystem
and therefore no saved progress to export.

Accept `uninstall-verification@1` schema v3 as the bounded physical qualifier. It uses a
fresh profile and browser process per mechanism, seeds unique nonempty sentinels plus a
32 MiB OPFS payload, independently observes storage and quota before and after, requires
exact product telemetry for the client-side operation, and binds the header path to the
completed direct-network request. Product and harness `navigator.storage.estimate()` and
inventory samples are separate time windows: each must be internally exact and positive,
while the unique per-operation sentinels bind them. Incidental full-inventory or estimate
equality across those windows is not an acceptance predicate.

**Context:** Physical qualification exposed two real product defects. The first
client-side pass retained `parallax-offline-shell-v1` because the shell platform kept an
IndexedDB connection open; the corrected adapter opens and closes the database around
each operation, including failure. The second was the stable worker's
`respondWith(fetch(request))` handling of `/uninstall`: a Clear-Site-Data response must
come from the network navigation/request boundary, so the worker now deliberately leaves
that exact endpoint unhandled. Other failed attempts localized collector setup, response
provenance, result-lifecycle, and cross-window comparison defects; every pair remains
immutable under `harness/results/uninstall-verification/`. The final two rejected
cross-window reports have JSON/Markdown SHA-256
`97b81bb7fb74105f79f2c8dacd642579e7af93efb18d7107035e5c4cf4a2e2d3` /
`77cf66def4b81787e8b934d31e2918f92ed0298c1e5e43a762b88469565bd33f`
and
`f5833951903775e2a698cfc0fb238df8bb9b5b3fc9eea2d7ed86a7fea0c7383c` /
`3467a635d584516df90e7012e9aa9a5a8fb5ad54aead5d37f08972fcab63b4dc`.
One intervening preflight-only pair records the missing-`dist` operator error with
JSON/Markdown SHA-256
`cdfa6cfe2a78f7e0eff82ff590a90c2fff196e1b6b7d219df7549404bda93c08` /
`75708f74f8b283a40e0b6cbe539c719154db31981bbc39da30ee6fd1f2be4cb0`;
it never launched Chrome or evaluated product behavior.

The accepted pair
`uninstall-verification-v3-2026-08-01T01-42-43-231Z.{json,md}` has JSON/Markdown
SHA-256
`3a4f177af4d6b12dce9b2063ef09c9f1b75e2485751c236487c9f24864d32e9b` /
`63be4b24077caebd6b89fcdbf78598f94763b396c4a77a2c497ed8eb131606a4`.
It binds artifact/release
`b4085ad29b37afe696653687d7433f1de7ab21380e8fc86748fcd209f8d06544` /
`1b20e95ee4b28a968c077f11b73f36077b66258c0df07556e7a06bd7bee81a14`,
pinned Chrome 151.0.7922.34, registered `dev-01` Showcase, and exact source identity.
The client-side arm released 22,931,758 independently observed bytes and reported a
33,657,928-byte product-window release. The header arm released 33,643,554 bytes and
retained an exact completed status-200 network response with no service-worker
provenance. Both cleared every seeded OPFS, service-worker, Cache Storage, and IndexedDB
sentinel, used distinct processes/profiles, and passed cleanup plus post-validation.

**Consequences:** Close only M2's Uninstall path. HTTP cache, V8 code cache, and Dawn GPU
cache probes were attempted but cannot prove origin-scoped eviction; RE-046 records that
platform observability gap. This result is local physical evidence and makes no
production-deployment, scale-corpus, multi-machine, or M2-exit claim. Scale tests are
next.

**Reopen if:** a destructive path can start without explicit confirmation; another
client can retain authority; any observable surface or positive quota evidence is
omitted; the endpoint is service-worker mediated or loses exact method/header/source
provenance; a save subsystem lands without a real export path; or Chrome exposes an
origin-scoped cache inventory/eviction API that can replace RE-046's unobservable
verdicts.

---

## D-146: Make installer target discovery network-first and accept the bounded offline fault lifecycle (2026-07-31, accepted)

**Decision:** Controlled app pages request only the root `build-manifest.json` and
`install-manifest.json` installer-target documents with the exact
`x-parallax-installer-target: network-first-with-offline-shell-fallback` marker. The
stable service worker treats only same-origin, query-free `GET` requests for those two
paths with that marker as network-first. A network response wins regardless of status;
only a fetch `TypeError` permits fallback to the selected, independently verified
offline-shell cache. Other errors propagate. All other shell requests keep D-138's
existing cache policy. Shell/release mismatch diagnostics include both exact digests.

Accept `offline-fault-lifecycle@1` as the bounded M2 offline fault qualifier. It runs
three ordered cells against one registered physical environment and exact retained
D-138/D-144/D-145 provenance: (1) terminate a live asset-only update after an exact
8 MiB checkpoint and prove restart resumes that checkpoint without publishing the
partial release; (2) stop the origin, prove connection refusal, relaunch a different
browser process with offline configured before navigation, and reach exact Ready with
zero network requests; and (3) delete one selected-generation cached response, prove a
stopped-origin fail-closed rollback with no mixed-generation response, then restore the
origin and reach exact post-update Ready after refetching the corrupt path. Evidence is
create-only and collision-safe, records exact browser/source/build/release/process,
cache, journal, checkpoint, accounting, cleanup, and pre/post authority, and preserves
every terminal attempt as an immutable JSON-primary/Markdown pair.

**Context:** The first four retained attempts localized qualifier defects without
weakening product predicates. They respectively exposed a missing Chrome developer
switch and concurrent environment probe, an extra failure-evidence key, a server that
was still reachable before the claimed offline navigation, and a Ready-only wait that
ignored an immediate typed terminal failure. Their JSON/Markdown SHA-256 pairs are:

- `offline-fault-lifecycle-v1-2026-07-31T22-13-14-688Z`: `946645311f6b4821f228aee85214bd391c0f1898f3a371ba16a61d749c32350b` / `1ab0149bd52f1a2e5045e3efcea3f23e787c841ca05cd954e87df99bcfe925b7`;
- `offline-fault-lifecycle-v1-2026-07-31T22-16-43-255Z`: `5c1879add4ce9533e4adbc0bb8ede514a8dca648952c9386b4f70b591fc91d0` / `5ed92df0c758e79545d3d3c217bbaa4cf7b44a9e6fbf8b7e5038db096883637c`;
- `offline-fault-lifecycle-v1-2026-07-31T22-19-36-521Z`: `e6ab011cb3cac1332e1aa04692f4409a14b74c37c78582fa351e15a085bd87a6` / `064f53153730c1452160cd1cfaaadb3d3810bd0d4438f8a1ba7ca70677936b00`;
- `offline-fault-lifecycle-v1-2026-07-31T22-27-34-570Z`: `bd6d3c074686e7e3ebb19df34d537d7d9c0eccbdd9ba6e57722472c1f3d886e` / `33eb629570cf532c6678865efd0898dc93c471b2de20e1e924d95eb466def378`.

The fifth pair
`offline-fault-lifecycle-v1-2026-07-31T23-05-38-732Z.{json,md}` retained JSON/Markdown
SHA-256 `266970f0389ce7eaccbea8754056128963f14100a3a632c83ff6b3173a4154da` /
`4eba79b28e92ba9b2e0fb79207e27cebf8957b65aea035a6542b28fe9d84e638`.
It passed interrupted update and stopped-origin restart, then truthfully failed online
corrupt-cache recovery with exact `shell-release-mismatch`: the controlled app's
`cache: no-store` installer-target requests were still intercepted by the stable worker
and returned the pre-update cached manifests, while the worker's own update fetch saw
the post-update network manifests. This was a product split-authority defect, not a
measurement threshold. The network-first rule above resolves that defect and is covered
for exact method, origin, query, header, path, status, and TypeError-only fallback.

Because the product correction changed shipped bytes, the earlier D-145 pass remains
valid history but could not authorize the corrected artifact. One current-artifact
schema-v12 trust refresh passed all eight cells. Its pair
`installer-trust-faults-v12-2026-07-31T23-19-36-299Z.{json,md}` has JSON/Markdown
SHA-256 `7316cab2603750f4a25108d848640ca1e1fbe52b81647b5a360c17a6cb992637` /
`75b3dca9cf2ed9568382897b1ec337b045d56da05f680e1ba7d2347c1a20adf4`
and canonical payload SHA-256
`1db69917ce7963f05b0c95ddc1dfa10debb7cc9d4dc4753d9ced13ed86769e8c`.
It binds artifact/release
`29616033e34061fa9da270bd99aae657c392e1bf34d154de2574ce6bde7d5179` /
`2dc78203a4fa1cf7ae6e9f2a131507b4db113f90d7b7e1c00e1fa68855f15914`.

The single post-fix offline qualification
`offline-fault-lifecycle-v1-2026-07-31T23-37-54-560Z.{json,md}` passed all three cells
in order against that exact artifact/release and Chrome 151.0.7922.34. Its
JSON/Markdown SHA-256 are
`7f55441d0c57972941746f321683d82c71407c527846b41ec7cea18d928a965e` /
`233aac8c2ca6a292ce0ce6331fee74acbf57ad3d2bd0d5f888a3ccc8cd318adf`.
It retained complete cleanup, exact source/provenance post-validation, 8 MiB resumed
plus 24 MiB downloaded for the interrupted resource, separate browser process IDs,
connection-refused stopped-origin probes, zero offline network requests, exact cache
inventories, fail-closed rollback, and a 25-response online recovery journal that
refetched the removed path.

**Consequences:** Close M2's Offline fault suite. D-138 supplies offline hard reload,
D-145 supplies disk-full/quota injection, and this decision supplies interrupted
update, browser restart offline, and corrupt-cache recovery without duplicating those
large prior qualifiers. This does not close Uninstall, Scale tests, the multi-machine
exit gate, or M2.

Later root-rule-12 cleanup on 2026-08-02 removes the closed
`offline-fault-lifecycle` runner, evidence/deadline/cancellation/provenance/orchestration
modules, partial-witness helper, tests, package command, and routine source assertions.
Its ignored result and D-099 reconstruction artifacts remain untouched; the hashes,
measurements, conclusions, and reopen conditions recorded here remain authoritative.

**Reopen if:** installer-target documents gain another root path; an offline fallback
can be selected without independent generation validation; a non-`TypeError` failure
falls back; the three-cell evidence cannot be revalidated from its exact retained
inputs; or a supported browser/service-worker change invalidates the stopped-origin or
process-restart boundary.

---

## D-145: Gate qualification on product invariants and retain raw observations (2026-07-31, accepted)

**Decision:** M2 browser qualifiers retain bounded, ordered raw runtime telemetry as
their primary diagnostic input and gate only the product invariants required by the
acceptance claim: exact identity and authority, typed fault and resource identity,
publication, repair or recovery, accounting or conservation, and cleanup. Exact
callback/publication counts, fixed phase positions, and a closed-world event topology
are mandatory only when the claim itself depends on them. Equivalent intermediate
planning, progress, or store publications remain diagnostic and do not independently
fail qualification.

The active installer-trust result contract is schema v12. Its nested raw-observation
failure evidence is schema v3: complete ordered validation, transition-proof
accounting, and SHA-256 hashing continue for the full accepted stream, while the
diagnostic artifact retains a byte-bounded prefix, rolling tail containing the actual
immediate predecessor, exact accepted count, retained-window digest, full-stream hash
commitment, and exactly one separately bounded rejected sample. The raw artifact is
limited to 524,288 bytes, each serialized observation to 69,632 bytes, and the
rejected-sample envelope to 73,728 bytes; the immutable trust report remains bounded to
8 MiB. Active capture stores a bounded exact projection of install-store publication
plus installer-transfer release identity and the canonical structured failure tuple,
while historical full-snapshot and compact-v2 raw evidence remains valid. New active
transition proofs are schema v3 and bind an exact final-barrier witness for every
observed phase; proof schemas v1/v2 are historical-only. Trusted evidence must cross
the production recorder/barrier and the same
ownership/finalization seam used by the runner; a plain transition or synthetic
fallback cannot mint it. The shared compact outcome contract covers all eight cells and
the failed mid-append attempt, including outer authority/resource/cell-position
rebinding. Successful result schema v5 is unchanged. Raw-evidence schema v2 and result
schemas through v11 remain available only to validate retained historical evidence.

Milestone execution also changes as follows: use a fresh minimal-context subagent for
each bounded implementation or review project; use focused tests, typecheck, and lint
during correction; run one full deterministic gate after implementation and review
converge; and run at most the one authorized physical attempt for that converged
candidate. A third correction pass caused solely by evidence machinery triggers a
qualifier redesign or simplification before more proof structure or physical attempts
are added.

**Context:** D-138 required fifteen evidence-contract corrections. The subsequent
installer-trust attempts exposed a missing idle transition and a repeated equivalent
planning publication; both were defects in the harness's exact event model rather than
product or Chrome failures. Preserving and extending that closed-world graph consumed
most of the implementation and review effort while sometimes preventing the actual raw
failure from being retained. That behavior had drifted away from D-049's task-sized
units and D-097's per-final-candidate gate cadence. The schema-v11 physical pair remains
immutable and failed with JSON/Markdown SHA-256
`df4b0eec4bffca1a8c5df7090950bc497b8fc0a01ada1129bc1f148b019ecb98`/
`1cd11af1a69a5c1140fd076172d3a7bc2488fd9a0512079a8b0915e42a157697`
and canonical binding
`6c8d1421623dd1e042c58ea9facdb5b79546217bae08db16e67f159c4acf34d6`.

The first schema-v12 physical pair
`installer-trust-faults-v12-2026-07-31T15-49-19-378Z.{json,md}` remains failed with
JSON/Markdown SHA-256
`735e5538670810fee79849a5635b9d49e643ad41cacea62daefcfbe651ecb0ca`/
`46372de222531f8a0181544129ee0bb7386cd1bbf1608e10e1231a4409669843`
and canonical payload SHA-256
`aeaa68f1e92f02d62e07c89042112f30f379b920f44695a84b196a08aa066535`.
It completed zero cells and failed during `retain-seed-transitions`: an unexpected
queued callback exception rejected the barrier while the recorder's structured error
remained `null`, and the page boundary discarded the caught reason before relaying that
`null`. This is a qualifier implementation defect; no product cell invariant or Chrome
behavior was evaluated. The correction guards malformed binding prefixes, converts
every queued callback parse failure to the first typed `binding-outcome-invalid`
failure, preserves existing structured failures, and otherwise transports one
bounded/redacted queue-internal cause. It adds no event cardinality or topology rule.

The corrected schema-v12 pair
`installer-trust-faults-v12-2026-07-31T16-19-13-719Z.{json,md}` also remains failed,
with JSON/Markdown SHA-256
`edc1177d8056f38507b3b36baba65a6bc6f2055306b9a10933f215525e30b769`/
`074d1a018249c71dced756e707d7c3da621f97dfa0a5a0b74d66a64e9af3abb6`
and canonical payload SHA-256
`1f5c0652eafba0987fdf9f90907b61d0f15258a721db8aa19c3d2c06f864c7e6`.
It again completed zero cells, but the corrected boundary localized the failure to a
`binding-outcome-invalid` acknowledgement at seed order 6 after order 5 was accepted.
The Node recorder retained no rejected raw sample, establishing that the raw
observation had been accepted and the structured page↔Node acknowledgement envelope
failed afterward. This still evaluated no product cell invariant and establishes no
Chrome finding.

That result activates this decision's third evidence-only correction trigger. The live
binding first stopped transporting the structured kind/predicate/prefix envelope and
returned only a boolean acknowledgement. The resulting pair
`installer-trust-faults-v12-2026-07-31T16-42-04-880Z.{json,md}` remains failed with
JSON/Markdown SHA-256
`36548dea73d28443045b24acd2f5d55797dcf55f15a9d672aa7330593129b5b8`/
`7de009806d2d70a1f190cfd6f76325770ec3e22d080e5689fe1990c9445cd092`
and canonical payload SHA-256
`0b1730306f5f19f674b1e045042b3e2b6f64cf70769fadb2cbcae2927bb1204b`.
It again completed zero cells and failed at the same seed order 6 after order 5 was
accepted, with no rejected raw sample. Removing the structured envelope therefore did
not remove the failure: the live per-event callback acknowledgement itself was the
wrong qualification boundary. This still evaluated no product invariant or Chrome
behavior.

The active qualifier now removes that callback boundary entirely. The page synchronously
snapshots each raw observation and projected transition into an aligned bounded window;
its existing clear/phase/seal barrier atomically rotates the window and returns the
batch. Node exact-checks the batch shape and alignment and feeds every raw observation,
in order, to the authoritative recorder before deriving milestones or continuing.
Capture errors are bounded, redacted, typed, and fail the next barrier. Historical
prefix-bearing and binding-diagnostic evidence remains
backward-valid, but no active binding, acknowledgement, prefix hash/count transport, or
replacement event topology exists. This is a deletion of incidental proof transport,
not another event model.

The first barrier-batch physical pair
`installer-trust-faults-v12-2026-07-31T17-20-02-628Z.{json,md}` remains failed with
JSON/Markdown SHA-256
`235469d11cfc84d35c872e807c7afed2a23d320d95ab7dc18ad326a2a5684a85`/
`0820d1cac262adee3d8afea352f22175df025c67fdf9880aec1390225b0320d8`
and canonical payload SHA-256
`2deae28de4209518625df2955d1acfd15a7737d37b8b7448619f00764c3b640d`.
It completed zero cells and failed at `retain-seed-transitions` because the first
barrier-batch implementation deferred its durability-warning DOM read until a
microtask, then reported a typed `InstallerTrustTransitionCaptureError` at that commit
boundary. This is qualifier capture drift; no product invariant or Chrome behavior was
evaluated. The correction removes the deferred capture layer. The app's diagnostic
event continues to supply the event-time persistence classification synchronously; the
transition stream retains its compatibility warning projection from that classification,
while the existing dedicated persistence recorder remains solely responsible for
verifying the actual rendered warning and its terminal consistency. There is no
pending-capture queue, timer, later DOM read, or product-byte change.

The corrected synchronous-capture pair
`installer-trust-faults-v12-2026-07-31T17-29-42-528Z.{json,md}` remains failed with
JSON/Markdown SHA-256
`5ffb2bfeaefdad2810d00717d07e9b19897132a399a44eae987b8a4f590cada8`/
`10267bf69d8cb3c3ee4380765450bd0591cdad6949374d88e1153e28cac9cb4f`
and canonical payload SHA-256
`331dfd2435c2fa2e596faa1d336686ca1066a94b8b3734388ddd757dde42a899`.
It passed the page-to-Node boundary and validated 168 ordered raw seed observations,
then failed the 450,535-byte accepted-prefix ceiling before cell 1. The ceiling had
incorrectly become a runtime publication limit; it evaluated no product invariant or
Chrome behavior.

The first attempted capacity correction retained the partial reservation
`installer-trust-faults-v12-2026-07-31T17-36-11-929Z.{json,md}` with JSON/Markdown
SHA-256
`3c368febc1ba8d6597abe06aac4ce4bd29136f9e813f9c87d559c9f518fa045d`/
`1e773d08d4359d38323dae99ec9f741120cf7a755d395faa017f82854eaedf6a`.
It validated 750 seed observations before reaching the enlarged 2 MiB raw ceiling,
then correctly failed immutable JSON readback because the shared result writer is
bounded to 4 MiB; its Markdown remains the owned `finalization-failed` placeholder, so
this is not a terminal pair. Raising coupled evidence ceilings was the wrong fix.

The active correction keeps the original 512 KiB raw-artifact and 8 MiB trust-report
bound, aligns the shared immutable writer's readback ceiling from 4 MiB to that already
declared report limit,
and stores only the five telemetry fields actually consumed by transition consistency:
store active release/state and transfer state/failure code/failure resource. Full
snapshots remain independently validated in cell and terminal evidence, and historical
full-telemetry raw observations remain backward-valid. The measured 750-event seed
compactly occupies 341,088 bytes, leaving bounded headroom without relaxing a product
predicate, constraining publication count, or changing product bytes.

The compact-retention physical pair
`installer-trust-faults-v12-2026-07-31T17-45-34-492Z.{json,md}` remains failed with
JSON/Markdown SHA-256
`fa1eee3253eef4bace71c15d58dfd34026b9123b8c5c258029f81c5b6ded2709`/
`2be6d17a840d2916bc7f6dbb0833ff32919552b4ae783aaa01636f75c683ecb9`
and canonical payload SHA-256
`c1b47f2710339f66f8ac6d0ac548fe1082c74f6057f9939d41796e6183719c33`.
It validated 990 ordered compact seed observations for the first
`reused-object-corruption` cell and then reached the unchanged 450,535-byte retained
prefix ceiling at `retain-seed-transitions`. No cell invariant or Chrome behavior
failed. This disproves the assumption that compacting five telemetry fields alone
provides sufficient bounded headroom. The retained-prefix ceiling must no longer be a
live acceptance gate: the next bounded qualifier project must separate complete stream
validation/hash/accounting from bounded diagnostic retention. No further physical retry
is authorized for the current prefix-gated design.

The reviewed correction performs that separation without raising a ceiling or changing
product bytes. Nested raw evidence advances from schema v2 to v3 only. The recorder
continues exact online validation, transition-proof construction, observation counting,
and full-stream hashing after the diagnostic prefix fills; it retains a fixed byte-split
prefix and rolling tail so a rejected sample is checked against its actual immediate
predecessor. The retained windows and rejected sample remain independently bounded and
hashed, and the full accepted count plus stream digest commit the omitted middle.
Historical schema-v2 evidence remains backward-valid. Focused tests validate 1,220
compact observations beyond the former 990-event ceiling, then retain and independently
reject a later semantic phase regression; adversarial predecessor-tail mutation also
fails. This converged design is eligible for one physical schema-v12 qualification only
after the deterministic gate passes.

That deterministic gate passed repeatable build, typecheck, Biome over 367 files,
149 test files / 1,863 passing tests with one skip, and `git diff --check`. The first
bounded-evidence physical pair
`installer-trust-faults-v12-2026-07-31T18-03-51-764Z.{json,md}` remains failed with
JSON/Markdown SHA-256
`738d2597af2e2af916ea79cd70ca63a1fb498d268f9569f4615e610a1a532bb2`/
`11ab8cf6b9fe4cd6a30a966429fd3513f7cbc0b12a6744e1e69a17d6d964385b`
and canonical payload SHA-256
`3c54f908bec1885ee5e80c246cc35e21ff53a544505089ca008bb37ec4298374`.
It retained and validated 5,785 ordered seed observations, then rejected order 5,786
when the store changed from `publishing` with no active release to `ready` with the
exact active release while transfer remained `verifying`, UI remained `installing`,
and release/shell-generation UI authority remained null. Direct product tracing confirms
the intended sequence is `verifyRelease` → `markReleaseReady` → atomic `publishRelease`
→ return from the worker operation → transfer `ready` → app/UI Ready. The rejected
observation is therefore the legitimate store-publication handoff after complete
verification, not premature publication, a product trust failure, or a Chrome finding.

The reviewed correction allows only that exact intermediate shape: store `ready`, exact
active release, transfer `verifying`, UI `installing`, and no release or shell-generation
UI authority. It continues to reject store `publishing`, a wrong active digest, any
pre-Ready shell/release authority, other pre-Ready transfer states, and every
failure-phase publication. This changes no product bytes, result/evidence schema, or
bound and is eligible for one corrected physical qualification after its deterministic
gate.

That corrected deterministic gate passed repeatable build, typecheck, Biome over 367
files, 149 test files / 1,864 passing tests with one skip, and `git diff --check`. The
next physical pair
`installer-trust-faults-v12-2026-07-31T18-11-34-819Z.{json,md}` remains failed with
JSON/Markdown SHA-256
`573824c6517c5e5c78db3a0376114942c4d5bd7d2e048527805bcb8945826f01`/
`226beac9b3b3260f4061dacc8d43c715cf7acae907be977fddf7f8756614020b`
and canonical payload SHA-256
`29f87eceacf25e67c2bc3700102cd2e30bb7294a0157e1a34a563bb6b47a907e`.
It completed the first five cells and reached the next quota-failure terminal, where
the active raw semantic validator accepted the typed failure with no authority and a
safely idle store. Aggregate proof finalization then re-ran the legacy closed-world
validator, which required the independent store subsystem itself to be `failed` and
raised `contradictory transfer failure`. The result correctly retained five completed
cells, null failed-cell evidence, exact failure provenance, and no cleanup failure. This
is a qualifier finalization defect, not a product trust failure or Chrome finding.

The correction removes that duplicate legacy semantic gate from active schema-v12
acceptance as a class instead of adding another store-state exception. A separate
active-raw aggregate validator retains exact proof envelope/state/edge identity,
trail/gap feasibility, dimension accounting, phase completeness and monotonicity,
authority, shared typed outcomes, and terminal verdicts, but does not require incidental
planning milestones or legacy operation/store topology. Recorder finalization and every
live schema-v12 completed-cell, pending, passed, and terminal-pair validation path use
that mode. Schemas through v11 remain on the unchanged historical validator. The live
raw barrier rejects an unexpected product terminal before the historical product-terminal
fallback can finalize. Independent adversarial review traced those routes, validated the
retained failed pair under the corrected code, and passed 189 focused tests with no
finding. This changes no product bytes, schema, or evidence bound.

The next physical pair
`installer-trust-faults-v12-2026-07-31T18-44-29-502Z.{json,md}` remains failed with
JSON/Markdown SHA-256
`dc62c17f9f5eb3cf1e7d4ce220c0493bed190243615929628c75c5706b64875c`/
`084c6d19ec362def7d53528f33e252ab9cfb84677a2cc6a53b75cf0d0a5a1402`
and canonical payload SHA-256
`1b426e3a3aab2d9c47890f94058c37715ac28fc463d7190d48b6e385140006df`.
It completed six cells, then rejected order 33 of
`mid-append-quota-resume` attempt 2 while UI persistence was requesting and the
worker/store snapshot still exposed the exact failed quota state from attempt 1. This
was a mixed-time page/worker observation captured between their independent clocks,
not a product trust failure or Chrome finding.

The accepted correction makes every raw sample retain and validate telemetry-native
publication safety, exact transfer release identity, exact cell/phase structured fault
identity, and same-source persistence/warning consistency. Cross-clock UI-to-worker
equality and phase outcomes run only at explicit page-to-Node barriers. Transition-proof
schema v3 binds the exact final barrier for every observed phase, and current schema-v12
passing evidence requires v3; proof v2 is available only through a closed validator for
the exact immutable 18:44 failed JSON/Markdown pair and its full authority. The exact
prior attempt-1 quota tuple may remain diagnostic during attempt-2 handoff, but any
store/transfer state, release identity, or fault-field mutation fails, and a stale tuple
at the Ready barrier fails cross-surface consistency. Independent re-review accepted the
complete projection after 61 focused tests. This changes no product bytes or outer
result schema. The single converged deterministic gate then passed repeatable build,
typecheck, Biome over 367 files, 149 test files / 1,901 passing tests with one skip,
and `git diff --check`; the candidate is eligible for one physical qualification.

That physical pair
`installer-trust-faults-v12-2026-07-31T20-14-14-758Z.{json,md}` remains failed with
JSON/Markdown SHA-256
`fcbffb29215727a5ade03f2d695718bb0217881ece4e08c1483960d99857a969`/
`b51586b9b0b81a99bbf2efea950b5de80fc22bb967c2858249baced7841c68ac`
and canonical payload SHA-256
`1df333d70c1f988d10f7416d17c6c7633389cc496999e54335ab5caab029c7fe`.
It again completed six cells and rejected order 33 of the mid-append attempt-2 handoff,
but the complete retained sample established the remaining semantic error: transfer
telemetry held the exact release digest while the store publication digest remained
null and both subsystems retained the exact failed quota tuple. Authoritative worker
source sets transfer `activeReleaseDigest` to the operation target when the request
starts and does not clear it on typed failure; only install-store `activeReleaseDigest`
is publication authority. The qualifier had incorrectly required both to be null.

The reviewed correction requires the transfer target to equal the exact release digest,
the store publication to remain null, both states to remain failed, and every structured
quota field to remain exact. Null or wrong transfer targets, non-null store publication,
state changes, diagnostic mutations, and stale Ready-barrier telemetry all fail. Source-
traced independent re-review passed 62 focused tests. This is a qualifier semantic
correction only; product bytes and outer evidence schema remain unchanged. Its
corrected deterministic gate passed repeatable build, typecheck, Biome over 367 files,
149 test files / 1,902 passing tests with one skip, and `git diff --check`.

The corrected physical pair
`installer-trust-faults-v12-2026-07-31T20-39-51-656Z.{json,md}` is accepted with
JSON/Markdown SHA-256
`7cc0cbaf170d11c1444016c07b8059eecdfde8d1b7c7b9de02cbdcf620e797d4`/
`df0014b4c5245ea1f38efcb35d3234bcbe7610b3302333f88a982d58c7bfae8e`
and canonical payload SHA-256
`fa641190100ef324eb60c4ca8e6a7834b1cbdfe95effbe4ea2ddc516e80c7ff4`.
Pinned sandboxed Chrome 151.0.7922.34 passed the exact eight cells in required order
with fresh disposable profiles, transition-proof schema v3 and exact phase-final
barriers throughout, no terminal failure, exact artifact/release identity, and complete
cleanup. Independent review recomputed both embedded manifest identities, all three
evidence hashes, source/browser/environment authority, accounting, injected-fault
outcomes, fail-closed publication, repair/resume, persistence-denial truth, and the
exact Markdown companion. This closes Installer trust + crash-safety only.

**Consequences:** This narrows proof machinery, not product correctness. Identity,
authority, integrity, repair/recovery, accounting, and cleanup remain fail-closed. The
new evidence contract requires a complete deterministic gate and a new physical result;
historical attempts and adjudications are preserved. Reviews should attack the product
invariants and raw-evidence provenance instead of requiring incidental publication
cardinality.

**Reopen if:** bounded raw evidence is insufficient to adjudicate a failure, tolerance
for equivalent publications permits a product invariant violation to pass, or an
acceptance claim genuinely requires an exact internal publication topology.

---

## D-144: Qualify the asset-only update launch outcome and keep V8 attribution best-effort (2026-07-30, accepted)

**Decision:** Accept `asset-update-v8-lifecycle@2` as the bounded M2
asset-only-update/V8 lifecycle contract. One invocation owns a single persistent
profile and orders exact initial install/Ready, fresh launch, produce diagnostic,
pre-update diagnostic and warm launch, publication of a manifest-verified
non-executable-only release diff, transfer/final verification/publication/Ready,
post-update warm launch, and post-update diagnostic. It fails unless the executable
resource set and its aggregate identity are unchanged, the changed/unchanged resource
sets and transfer accounting are exact, both warm launches are at most 10 seconds, and
the target, active store release, offline-shell generation, Ready state, and Launch
authority all name the exact expected release. The signed post-minus-pre launch delta
is retained. The relative-regression threshold remains explicitly `null`; this one
pair does not calibrate or imply one.

The accepted same-profile dev-01 Showcase result is
`harness/results/asset-update-v8/asset-update-v8-v2-2026-07-30T10-05-24-152Z.{json,md}`
(JSON/Markdown SHA-256
`be82dd00ba7af11d64c7cdae2899d80befd010279065c643f7fd3f11b155fb24`/
`95d6fc8bb47d39a71ed40dbdb7d1a5e95873a4aa179feeda98873bf5a93a2028`).
Pinned Chrome for Testing 151.0.7922.34 used one persistent registered dev-01
Showcase profile. The pre artifact/release were
`2dbb7b95bb776e1e76d1d416db6c69a42d0df3d9a662aeea595a4dad7014edc6`/
`c75e8f95ac4c55961a573cfdfe695e854994cc296c5dab8463c5a1b5fdedaa1c`;
the post artifact/release were
`5d2e2dcdea4d150992fd448f655ad63cd60f2353ffda6cb5f7e1360182675b1b`/
`d464a4dcc1b8c1d00415b2e34b5b92380012ac6c18fee53233081117e62433dc`.
Exactly the district index and cell 00-00 changed, both non-executable. The other 282
resources and executable identity digest
`dd7736a1ab68879cf05b946c5771e9a2ed585cff46a08beb230ece09fb96fc1e`
were unchanged. Transfer downloaded 72,759 bytes; final verification covered all
263 resources and 2,621,434,134 bytes; store, shell, Ready, and Launch authority were
exact.

The fresh launch measured 6,098.435 ms. The pre-update and post-update warm launches
measured 5,831.760 and 5,748.105 ms, both inside the unchanged fixed 10-second
ceiling, with signed delta −83.655 ms. This is the complete in-app
`launch-to-interactive@2` outcome. It does not weaken the ceiling, average away a
failure, or convert the unset relative threshold into a verdict.

V8 evidence remains narrow. All four best-effort traces reported zero data loss.
Fresh and produce cache/production attribution remained `invalid` because the initial
installer navigation preloaded app, engine, game, and installer scripts and therefore
mixed their cache lineages. Pre/post cache attribution remained `invalid` because the
expected compilation events were absent. Separately valid pre/post production evidence
measured zero code-cache re-production across all six cacheable scripts.
`WebAssembly.instantiateStreaming` was measured against the exact pinned Wasm artifact
on produce, pre-warm, and post-warm. These observations establish lossless collection,
absence of observed re-production, and the exact streaming API/artifact; they do not
prove a V8 cache hit or successful cache consumption.

**Current implementation correction (2026-08-02):** lifecycle-v3 and the selected
thread-spike service now use `WebAssembly.compileStreaming` on the original fetched
response, then structured-clone the exact compiled `WebAssembly.Module` to both workers
for their used runtime instances. Exact `application/wasm` and canonical positive
`Content-Length` response metadata retain artifact-size authority without cloning and
fully buffering the body a second time. The unused main-thread instance, its imports,
and its unreachable externref initializer are removed. Retained lifecycle-v2 evidence
and its validator continue to require the recorded `instantiateStreaming` value; this
implementation correction creates no new cache-hit or performance claim.

**Retained failures and correction:** all earlier result pairs remain immutable and
keep their original verdicts.

- The first v1 pair
  `asset-update-v8-v1-2026-07-30T06-26-26-687Z.{json,md}` remains `pending`
  (JSON/Markdown SHA-256
  `618c70fa63fa3099b9c6076e828f92765c5c43cf97c343655a57df45c0b10446`/
  `5d92b8b7236c0528debc0bd422e3a6fbb170bad8bd615d986af51452a9049026`).
  The v1 finalizer failed to replace its reserved pending pair with terminal failure
  evidence, so it carries no lifecycle verdict.
- The valid v1 budget failure
  `asset-update-v8-v1-2026-07-30T07-03-59-378Z.{json,md}` remains failed
  (JSON/Markdown SHA-256
  `9785a506c98eba3d7651a3e54b1f0d483d819faebb46a4091f66430a8f8535f2`/
  `9e9aea4abb3769e54f6e0b0b25d5786b2ec862c054b3167cab9d9ef78778edf2`);
  pre/post warm launches measured 8,714.375/14,834.930 ms.
- The v2 diagnostic candidate
  `asset-update-v8-v2-2026-07-30T07-36-11-804Z.{json,md}` remains failed
  (JSON/Markdown SHA-256
  `7a1920327b707dbbade5df9af8c240121c19db6377688c7ae550914517697a03`/
  `d191c53a92eb4e5c32761aeabfde2f843a50f435da37a0f104f2a84af297fe64`);
  pre/post measured 9,821.055/13,541.615 ms.
- The first corrected v2 candidate
  `asset-update-v8-v2-2026-07-30T07-53-40-357Z.{json,md}` remains failed
  (JSON/Markdown SHA-256
  `89fe1b0a8b613fc3a1aa31bee0e4f76d3415c6da19354edf0b6e834d199b79f9`/
  `41c3d3ec0e97280c0e69743c11d83a7cc7b24dc2638523f02c02b05bc05b9573`);
  pre/post measured 9,009.270/10,157.520 ms.

The phase timing added in v2 localized project work rather than a browser cache
failure. Ordinary runtime admission had reused the full release-selection routine:
each active-release query/admission could revalidate every OPFS object for both the
newest active release and the complete previous rollback release, despite needing only
the active identity. The accepted correction gives ordinary admission an active-only
resolver: it reads commit ordinals newest-first, stops at one unambiguous eligible
active release, validates/caches that release, and does not publish an incomplete
active-only answer into the active/previous telemetry pair. Full active/previous scans
remain where rollback, publication, reconciliation, and GC require them. Each retained
pair above belongs to its then-current changed candidate; the accepted run follows this
reviewed correctness/performance correction and is not an unchanged-artifact retry.

Streaming telemetry advances to v11 to expose exact worker launch-startup phase timing,
and the public envelope advances to v35. Smoke/flythrough/render-recovery report schemas
advance to v61/v28/v24. Smoke mandatory metric set v28 and the other scenarios'
mandatory metric sets and all thresholds are unchanged.

The final D-097 production report is
`harness/results/smoke-1-2dbb7b95bb77-dev-01-showcase-2026-07-30T11-16-07-360Z.{json,md}`
(JSON/Markdown SHA-256
`015a6edda2cd7a72be2862afcf028430996b7e0596fbca6332e42470318d0eee`/
`1feda3865885e805ae856302e137a210d40c5c4fe8282d6e93cba2bb44771ec1`).
Production preflight/postflight both bound exact artifact/release
`2dbb7b95bb776e1e76d1d416db6c69a42d0df3d9a662aeea595a4dad7014edc6`/
`c75e8f95ac4c55961a573cfdfe695e854994cc296c5dab8463c5a1b5fdedaa1c`.
Under schema v61 / mandatory metric set v28 all six launches, all three facets, and
30/30 checks passed. The baseline remains untracked. No V8 smoke diagnostic was
requested because the dedicated asset-update lifecycle already supplied this item's
targeted V8 evidence.

**Sources checked (2026-07-30):** the five immutable local JSON/Markdown lifecycle
pairs above; the accepted result's raw target, release-diff, transfer, launch,
authority, trace, production, and Wasm records; the current OPFS active-selection
implementation and deterministic tests; and the final production smoke JSON/Markdown.
No current browser-support claim or web source is required for this decision.

**Consequences:** Close only M2's V8 code-cache/asset-only-update checkbox. The
install/update feature remains active: Installer UX, repair, offline faults, uninstall,
scale tests, multi-machine exit qualification, and M2 itself remain open. The earlier
failures are project finalization, correctness, performance, and harness evidence; they
establish no browser bug, specification gap, or new rough-edge entry.

**Reopen if:** an asset-only update changes executable identity; the fixed pre/post
warm-launch gate regresses; enough representative measured pairs justify proposing a
relative threshold; active-only admission no longer preserves exact release authority;
the executable/cacheable script topology or pinned Wasm identity changes; or Chrome
exposes authoritative per-artifact cache-consumption evidence that can replace the
best-effort attribution contract.

## D-143: Bound the game-UI substrate spike (2026-07-29, accepted; resolved by D-160)

**Decision:** Run one bounded spike to resolve **P-008 (game UI substrate)**: whether
main-thread DOM/CSS layered over the worker-owned WebGPU canvas can carry the game's
UI — frame-coherent world-anchored elements, low-latency HUD, heavy screens without
input disruption — or whether some or all surfaces must render in-canvas. A hybrid
split is a first-class outcome, not a failure. This entry is the experiment contract;
a later entry records the result and resolves P-008.

**Apparatus.** A probe layer on the existing app shell (the render worker already runs
the greybox flythrough), sized as a spike:

- **Probe A — world-anchored DOM:** a marker/nameplate tracks a designated moving
  world object through the standard 12 m/s traversal. The render worker publishes
  per-frame screen-space position stamped with frame ID + timestamp over the existing
  telemetry/SAB path; the main thread applies it as a DOM transform. Measured:
  positional staleness — how many rendered frames (and ms) old the applied position is
  when it becomes visible — plus screenshot evidence at speed.
- **Probe B — event-rate HUD:** three pool bars and an event ticker driven by
  synthetic sim-shaped events at combat-plausible burst rates (10–30 events/s).
  Measured: event→visible latency and main-thread task cost.
- **Probe C — heavy screen:** an inventory grid (≥200 slots with images) and a journal
  text page opened/closed repeatedly during the flythrough. Measured: UI-attributable
  main-thread long tasks, input-capture→worker-command-enqueue delay under load,
  dropped/late inputs, and render-worker frame-time deltas.
- **Probe D — in-canvas comparison arm:** Probe A/B equivalents rendered by the render
  worker as simple quads/text (bounded — no UI framework), producing the comparison
  numbers for the same metrics.

Frame correlation uses frame IDs stamped on both sides; presentation-time attribution
uses what the platform actually exposes (rAF timestamps, capture-based evidence where
needed). If DOM-vs-worker-frame presentation alignment is not cleanly observable, that
unobservability is itself a logged finding — the absence of any primitive to
frame-lock main-thread DOM updates to a worker's canvas presentation is exactly the
class of rough edge this spike exists to surface. The accessibility/i18n payoff
claims are spot-verified, not assumed: screen-reader name/role/value on the HUD
probes and Translator API over probe text, recorded pass/fail as evidence.

**Predeclared verdict criteria** (per surface class; any mix is a valid outcome):

- *World-anchored:* DOM is eligible only if p95 positional staleness ≤ 1 rendered
  frame with no visible detachment in the screenshot evidence at 12 m/s; otherwise
  world-anchored UI is in-canvas.
- *HUD:* DOM is eligible only if p95 event→visible ≤ 50 ms and burst rates produce no
  UI-attributable main-thread long task > 50 ms.
- *Heavy screens:* DOM is eligible only if input-capture→command-enqueue p95 stays
  within one sim tick (working value 16.7 ms at 60 Hz) with zero dropped inputs
  during open/close cycling.

Thresholds are fixed before the run; recalibrating one afterward requires its own
decision entry with the measured case, never a silent relax-to-pass.

**Bounds and cadence.** No production UI framework selection (that is a later, separate
decision over the winning substrate); no visual design work. Metrics enter a versioned
harness scenario/schema (root rule 3 — extending the harness is part of the spike);
verdict-carrying numbers come from registered dev-01 under pinned Chrome at the
physical console, and other runs are advisory. The spike has no sim dependency and may
run before M3 opens; it must conclude before M3's dialog-presentation work starts.
Closed-experiment rules apply: after the resolving decision, probe apparatus is
removed, with a D-099 reconstruction bundle if the measured source is dirty. Findings
go to rough-edges.md either way — a clean pass on all criteria is as much a platform
result as a failure.

**Context:** D-141 scheduled the UI-stack track at M3; game-design.md's ruleset
(D-142) now defines the real consumers (HUD pools, world-anchored nameplates,
inventory/journal screens, dialog presentation). The DOM bet's upside — free
accessibility, IME, subtitles, and the translation surface infinite localization
needs — is worthless if world-anchored or combat-rate UI can't hold frame coherence
over a worker-rendered canvas, and no current source settles that; it must be
measured (root rules 3/10).

**Consequences:** plan.md's M3 UI item and the features.md Game UI stack row point
here; P-008 is registered in the proposed/open list. The resolving entry will assign
each UI surface class (world-anchored, HUD, screens, dialog) to DOM or in-canvas and
becomes binding on all M3+/M3.5 UI work.

**Reopen if:** the resolving verdict is later contradicted by representative-content
measurements (M5 art-pass scenes or M3.5 combat-rate reality differing from the
synthetic burst model), or a Chrome change materially alters DOM/worker-canvas
compositing behavior — either triggers a bounded re-run under then-current pins, not
a silent verdict flip.

## D-142: Adopt slice-scale ruleset v1 (2026-07-29, accepted)

**Decision:** The M3.5 ruleset design pass ran early (pulled ahead of M3 because the
sim data model and save schema derive from it). The human chose the four structural
forks in the 2026-07-29 design session; game-design.md's "Mechanics — slice-scale
ruleset v1" section is the spec home. The core choices:

- **Combat: deliberate real-time.** Committed wind-up/active/recovery actions in sim
  ticks, resolved by contested checks (seeded roll + rating vs. rating) — stat-driven
  under the hood, positioning/stamina/telegraph-reading on the surface, soft-lock
  targeting, no twitch aiming. One action/resolution model shared by players and
  monsters. Chosen over action combat and pausable-tactical for fit with the
  fixed-timestep deterministic sim, command-pattern input, cross-machine replay
  hashing, and future P2P.
- **Magic: aether pool + crafted catalysts.** Spells spend a regenerating Aether pool
  and require an equipped catalyst crafted from harvested reagents — deliberately
  fusing magic, crafting, gathering, loot, and economy into one loop rather than
  three disconnected demos.
- **Progression: classless + ability loadout.** One shared authored pool (12–16
  abilities), 4 active + 2 knack slots, level cap 10, three playable folk with minor
  modifiers. Chosen over light classes (≈3× authoring for the slice) and
  skill-by-use (grind-shaped, replay-noisy).
- **Death: waystone respawn + recoverable satchel.** Demo-friendly, save-scum-free,
  fully inside the sim, and the waystone network doubles as world landmarks.

Supporting structure: four attributes (Might/Finesse/Vitality/Attunement), three
pools, five damage channels chosen to double as rendering/VFX showcases, five bounded
status conditions, 20–30 recipes, three NPC-owned crafting stations,
district-partitioned gathering, seeded loot tables with rarity tiers and 0–2 affixes,
a 6–8 archetype bestiary, one main arc engineered to drive repeated D1↔D2 transitions
(M4's exercise), and 6–10 side quests covering every system. Explicit slice
exclusions (stealth, mounts, factions, dynamic economy, durability, companions, fast
travel) are recorded in the spec; re-adding one is a decision, not a content add.

Two binding architecture implications were added to game-design.md: rules are
versioned data tables with named per-system seeded RNG streams (replay stability as
content grows), and LLM output mutates state only through validated structured
intents (D-074).

**Context:** D-141 created the ruleset design pass as M3.5's first track;
running it before M3 de-risks the sim data model (damage/status shapes entity
components, the magic model shapes ability/resource state, crafting shapes the item
schema). Tuning values in the spec are starting points for M3.5's replay-driven
balancing and change freely; this entry binds only the structural choices above. No
D&D-protected names, creatures, or mechanics text; all names original, placeholders
marked *(working name)* pending the M5 creative pass.

**Consequences:** game-design.md carries the spec; plan.md's M3.5 ruleset checkbox is
annotated but stays unchecked until M3.5's balancing consumes and validates it. The
M3 sim data model, save schema, event-stream vocabulary, and NPC behavior scoping all
derive from this spec.

**Reopen if:** M3 determinism work invalidates per-contact contested checks;
greybox playtests show deliberate real-time reads poorly at the 12 m/s traversal
scale; M3.5 balancing demands a structural change (new pool, new resolution model);
or the M5 character pipeline cannot deliver three visually distinct folk plus the
bestiary within budget.

## D-141: Fill the gameplay, UI, audio-content, and animation plan gaps (2026-07-29, accepted; mandatory Standard-tier qualification provision superseded by D-150)

**Decision:** Second pass of the D-140 gap review, applying the same test — systems the
vision and game-design docs promise ("no system is toy-grade") that no plan item
builds:

- New milestone **M3.5 — Gameplay systems** between M3 and M4 (D-140's numbering
  convention; nothing renumbered). Its first track is a ruleset design pass expanding
  game-design.md's single genre paragraph into a slice-scale mechanics spec; then
  combat, creature/monster behavior AI (distinct from LLM dialog), progression,
  items/crafting/economy/loot, and quests/journal — all deterministic sim-worker state
  under the M3 replay constraints, greybox-first. Replays double as gameplay
  regression tests.
- **M3 gains the UI-stack track:** decide the game's UI substrate before the first
  real screens exist. Leading bet: DOM/CSS overlay on the worker-owned WebGPU canvas
  (free accessibility, IME, subtitles, and the translation surface infinite
  localization needs) versus in-canvas UI, with main-thread-DOM vs. worker-frame
  compositing latency as the research question — a finding either way. HUD, dialog,
  journal, inventory, and settings/remap all consume the outcome.
- **M6's one-line audio item expands** into spatial-audio tech, an adaptive music
  system (weather/danger/district-reactive), and SFX/ambience content plus the audio
  asset pipeline `assets/` never had (its pipeline is visual-only). A design-now
  constraints section in features.md binds M3: the sim event stream must expose
  semantic, serializable gameplay events (combat/danger/weather/quest transitions)
  that audio, quests/journal, and Summarizer recaps consume — retrofitting events at
  M6 would be a rewrite.
- **M5 gains the animation content pipeline:** retargeted and/or AI-generated
  locomotion/combat/schedule animation sets across the races/monsters body types,
  QA-gated — a distinct toolchain problem from mesh/texture generation. M3.5 combat
  runs on placeholder animation until it lands.
- **M6 gains Standard-tier qualification:** M1 closed Showcase-only (D-115/D-116) and
  no plan item ever scheduled the Standard tier (registered mac-01, D-018). The
  demo-goal claim "a stranger can play" must be measured on both gate tiers.
- **Milestone exits gain a findings-synthesis checkpoint** (standing-workstream
  amendment): update chrome-platform-gaps.md from the milestone's findings and
  queue/publish the write-ups it earned at each exit, giving the primary goal-1
  deliverable a forcing function instead of an indefinitely deferrable side task.
- **Cinematics/scripted cameras are logged as undecided** — an `explored` feature row
  requiring an explicit adopt-or-rule-out decision before M6, rather than an implicit
  omission.

**Context:** The D-140 review found the rendering-technology hole; this pass asked
what else the plan promises but never schedules. M3's exit was "conversing NPCs" and
M6's was "a demo a stranger can play," with combat, magic, monsters, progression,
crafting, and quests (all committed in game-design.md) existing in no milestone; the
architecture assigns "UI logic" to `game/` with no plan item choosing or building a UI
stack; audio was one line of spatialization tech with no music system or audio asset
path; and animation content was implied by "AI-generated rigged characters" while
being a different toolchain problem. Non-goals were checked: low-end/mobile hardware,
monetization/accounts, and cross-browser remain excluded; Standard tier is not
low-end — it is an existing registered gate tier (D-018) that was simply never
scheduled.

**Consequences:** plan.md gains M3.5 and the M3/M5/M6 items above; features.md gains
seven matrix rows and the adaptive-audio design-now constraints section. The M3 sim
event stream is now a binding contract with three named consumers (audio, journal,
recaps). Slice-scale ruleset depth is a design output of M3.5's first track, not a
pre-commitment. Budgets follow the D-140 model where tracks are exploratory: measure
first, calibrate budgets through decisions.

**Reopen if:** the M3.5 ruleset design pass concludes a system should be cut or
radically reduced for the slice (record the reduction, don't silently shrink); the UI
spike's compositing measurements invalidate the DOM-overlay bet; M3.5 scope proves
large enough to split; or Standard-tier qualification needs to move earlier because M5
art decisions depend on Standard-tier headroom.

## D-140: Run the rendering-feature program as iterative explore-and-decide tracks (2026-07-29, accepted)

**Decision:** The plan gains an explicit rendering/simulation technology program:

- New milestone **M4.5 — Environment rendering technology** between M4 and M5.
  Existing milestone numbers are deliberately not renumbered, so cross-doc references
  to M5–M8 stay valid. Its tracks: lighting/shadows/GI (including fire/torch/magic
  local-light nights), sky and atmosphere, instruction-set procedural terrain,
  procedural materials (metals via the standard PBR path), vegetation plus a shared
  wind system, water (rendering and simulation costed separately), reflections,
  post-processing/AA/temporal upscaling/HDR output, transparency/OIT and decals,
  GPU-driven rendering and occlusion culling, and virtual texturing.
- M3 gains NPC navigation/crowds. M5 gains the character-surface/dynamics tracks
  (skin/SSS, eyes, hair/fur, cloth, muscle deformation, movement/IK). M6's former
  one-line "VFX and weather pass" expands into a shared GPU particle/volumetrics
  substrate, fire/smoke coupled to the M4.5 lighting work, precipitation/accumulation,
  and physics garnish (ragdolls, ropes/chains, buoyancy with a rowboat).

Working model, binding for every track: **heavily iterative human-plus-agent
exploration**, not spec-then-implement. Prototype competing approaches, measure their
real costs on the harness, weigh cost against visual payoff and both project goals, and
converge on a per-track decision entry — adopt (with measured cost), rule out, or
defer — usually with rough-edges findings, since most tracks press directly on WebGPU
gaps (no ray tracing, no mesh shaders, no bindless, no platform upscaler).

**No pre-set budgets.** These tracks intentionally start without budgets.md
allocations. Costs are discovered first; budgets are calibrated afterward through
decision entries (the existing budgets.md recalibration model, run in discovery
order). Root rule 3 is unchanged — adoption claims still come from harness numbers,
and adopted features join the standard flythrough coverage.

**Scope definitions and exclusions:** "Generated terrain" means instruction-set-driven
procedural terrain: placements and features are authored and deterministic while
geometry/textures are generated at install or runtime rather than fully modeled and
downloaded — an install-size research angle tied to M2, not random worldgen.
Destructible environments are ruled out: no track and no design-now constraints.

**Context:** The plan previously jumped from greybox streaming (M1–M4) to the art pass
(M5) and a one-line VFX pass (M6) with no milestone building the technology those
passes stand on — M5's "swap greybox to final art" implicitly assumed terrain,
vegetation, water, materials, lighting, and character-surface tech that no plan item
created, and dynamic lighting was already a binding constraint (game-design.md
implication #1) with nothing behind it. Destruction was considered and dropped: it
conflicts with the deterministic-sim constraint (features.md M7 constraint 3), the
immutable content-addressed streaming/install model, and D-090's separately authored
collision, and carries no current creative requirement.

**Consequences:** plan.md and features.md are updated in this change (new matrix rows;
the High-fidelity rendering, VFX & weather, Character & animation, and Physics rows now
reference the tracks). budgets.md gains per-feature entries only as tracks conclude.
Ordering inside M4.5 is dependency-driven — lighting first, terrain/materials next —
with substrate-independent tracks free to run concurrently.

**Reopen if:** a track proves large enough to deserve its own milestone; measured
dependencies invert the lighting-first ordering; destruction acquires a concrete
creative need (a reopening decision must include determinism/streaming/collision
impact analysis); or the instruction-set terrain angle fails its install-size/quality
research premise.

## D-139: Bind progressive boot warmup to a release-owned PSO trace (2026-07-30, accepted)

**Decision:** Build-manifest v15 adds exactly one content-addressed JSON asset-pack with
resource ID `game-specific-pso-warmup-trace`. The payload is
`pso-warmup-trace@1`, not an opaque engine cache: it binds Babylon Lite 1.12.0, an exact
render-state compatibility digest, priority-then-ID ordering, and the current logical
Standard-material/opaque/MSAA4 pipeline family plus its state digest. The effective
pipeline descriptor is derived and asserted at the Babylon registration boundary and
canonically includes the explicit canvas/depth formats, shader/material/mesh features,
vertex layouts and entry points, target blend/write state, primitive and depth/stencil
state, and multisample defaults; a change to any field changes or invalidates identity.
The existing install-manifest v1 vocabulary represents it as an exact game-specific/OPFS
`asset-pack`; this adds no new install-manifest shape or kind. The release digest and
resource SHA-256 bind its exact bytes.

Ordinary runtime preflight reads the trace only through the admitted active-release
binding, checks manifest/reference/path byte and SHA-256 identity, and parses exact
canonical bytes. The render worker independently revalidates the structured-clone
bundle, including trace identity and installed-release provenance. The explicit
WebDriver-attested legacy runtime route uses the same embedded canonical trace and
reports `privileged-embedded`; ordinary runtime has no embedded or network fallback.

Before Ready and the first interactive frame, a render-worker-owned registry crosses a
task boundary for every compile miss and invokes the matching Babylon scene
registration. The same authoritative state request is replayed once and must become a
registry hit without invoking the compile callback. Missing, duplicate-pending,
unknown, incompatible, or failed requests fail startup. Parse, incompatibility,
unknown-entry, and compile failures retain typed evidence through worker recovery and
public export; a failed compile truthfully permits an uncompiled cache miss while
preserving exact counter invariants. `pso-warmup-telemetry@1`
records source/release/trace/build identities, request/compile/deferral and registry
hit/miss counts, queue high-water, total/maximum/per-entry durations, request counts,
and typed failure state.

Public telemetry advances to v34. Smoke advances to report schema v60 and mandatory
metric set v28 with exact progressive replay evidence in each of its six existing core
launches. Flythrough and render-recovery advance to v27/v23 only because they consume
the public envelope; their metric sets and thresholds do not change. Baseline promotion
independently revalidates the new mandatory telemetry.

The separately triggered `pnpm harness:pso-warmup:qualify <smoke.json> <result.json>`
implements `pso-warmup-launch-pair@1`. It accepts only a passing smoke-v60/set-v28
report with exact finalized facets, registered physical/source/browser/executable/
target identities, and three exact ordered adjacent fresh/warm persistent D3D12
lineages. It independently resolves the build/install manifests and trace bytes without
importing engine constants, requires exact replay identity, conserves fresh
render-pipeline/shader misses into paired warm hits and across lineages, and requires
zero pipeline/shader compilation overlap with the gameplay measurement window. Before
input validation it reserves collision-safe create-only JSON-primary and companion
evidence; validation or companion failure still retains immutable sanitized failure
evidence, while success requires a second authority validation. This is an independent
consumer of D-036's
existing Dawn trace plus subprocess-UMA evidence; application registry hits never
substitute for Dawn backend cache evidence.

**Context:** The exact local `@babylonjs/lite@1.12.0` package source and emitted
render-worker build were inspected on 2026-07-29. The local Babylon scene-registration
path owns current pipeline creation, but exposes no stable public serialized pipeline
cache import. D-036's retained local Dawn evidence already distinguishes fresh
misses from same-profile warm hits. The chosen artifact is therefore a project-owned
declarative replay trace, while Dawn remains the authority for browser/backend cache
behavior. No external technology claim or workaround is needed.

The deterministic build emits a 3,907-byte trace with SHA-256
`54d23fc5b78fc120d6af712e9579662a97b391ce71faddb28c60c024f2af2a20`,
state digest
`55da5b2f0c319263d25dcf57bf2ae6fe645986cb2f8812e604c778137fc985e4`,
and compatibility digest
`abd16f6b4964b1e9e147148a075deea28f4cf4e79c76dbf4f4dd2915a0acbf31`.
The final build/repeatability, type, lint, diff, and unit gates pass 123 files / 1233
tests, including hostile descriptor, exact-identity, qualifier, evidence-lifecycle, and
typed-failure coverage.

The accepted local D-097 smoke is
`smoke-1-8f3ae8585efe-dev-01-showcase-2026-07-30T04-17-04-822Z.json`
(SHA-256
`1ec8212e2c5ef332dcdfdb6415b50cde03f4b0f28226be561d82433eee9f2562`)
for artifact
`8f3ae8585efecabd922bc8be15c426d60ff2467039954ac7e25253aafa76440b`
and release
`258e6b079eca14849ac1f1cb70d8a0af687e3b6de21accae30aecdc13f78fa07`.
All six launches, all three facets, and 30/30 checks passed on registered dev-01
Showcase. Its three fresh lineages each recorded 2 graphics-PSO and 4 shader misses;
each adjacent warm launch recorded the conserved 2/4 hits, with zero opposite counts
and zero gameplay overlap. The retained qualifier JSON/Markdown SHA-256 values are
`d63fb00c0a5b8752f017085a3fd2ac7fc5c9645d9b9974167af677121d521fb8`/
`c464f51bb74edfd9c7e701524ae61eca4dc359615967481682134149b81f9237`.
Independent review recomputed the exact build, release, source, browser/executable,
machine, target, trace, chronology, conservation, and evidence-ownership identities
without findings. Two earlier qualifier pairs remain immutable: one failed before
validation because an operator-supplied literal `--` shifted the arguments; the other
truthfully exposed the qualifier's incorrect exact render-surface comparison. The
correction now applies the registered ±2-pixel surface tolerance exactly, received
independent review, and required the accepted new physical smoke because it changed
source identity. Neither failed pair is final evidence.

**Consequences:** The application now proves that every declared current pipeline
family was progressively requested before gameplay and that its own registry
deduplicated replay. The independently retained Dawn evidence establishes the exact
fresh/warm backend outcome without inferring it from the application registry. Close
only M2's PSO trace/progressive-warmup checkbox. The change does not alter a performance
threshold, qualify Standard/Metal, publish/deploy an artifact, or close Installer UX or
M2. V8 code-cache lifecycle evidence is the next active M2 project.

**Reopen if:** a new material/render-pass family requires another trace entry; Babylon
Lite changes the authoritative registration boundary; the render-state compatibility
record changes; Dawn exposes a stable public pipeline-cache import; non-D3D12 cache
evidence receives an independently validated contract; or measured boot progression
requires a different yielding policy.

## D-138: Select a complete release-bound offline shell generation explicitly (2026-07-29, accepted)

**Decision:** Build one stable root-scope module worker at `/service-worker.js`, list it
as an exact build/install artifact, and keep the build manifest outside its own artifact
list so no self-hash cycle exists. Build-manifest v14 carries the exact offline-shell
generation-schema v1, save-schema v1, and stable worker path. An ordinary app-shell
target refresh or completed install explicitly registers the worker and sends a bounded
prepare request; worker `install` and `activate` events only take control and never
prepare, select, or delete a shell generation. D-135's WebDriver-attested automation
branch neither creates this service nor depends on a shell generation. The service
worker grants no authority from a request/client URL: a previously controlled
automation page receives the exact selected cached shell resources, while non-shell
legacy runtime requests fall through to the network normally.
An explicit prepare checks the current network build when reachable; an initial network
failure may reuse only a fully reverified active generation whose app entrypoint is the
one already loaded. A reachable but malformed target never falls back to cached state.

A generation binds the exact build-manifest SHA-256 `artifactDigest`, install-manifest
SHA-256 `releaseDigest`, build/install/save schema versions, app and engine artifact
identities, service-worker identity, and every install resource whose target is
`shell`, plus the two manifest documents. Model shards, district data, and every other
OPFS target are excluded from Cache Storage. Preparation fetches exact same-origin
paths with reload semantics and redirects rejected, then independently checks 200
status, final origin/path, byte length, SHA-256, MIME type, immutable-or-revalidating
cache policy, `nosniff`, COOP, and COEP before retaining a response.

Each generation has a separate Cache Storage namespace. A separate
`parallax-offline-shell-prepare-v1` lock owns the complete preparation, while the
`parallax-offline-shell-v1` exclusive Web Lock protects only short IndexedDB selection
transactions and rollback. The candidate identity is durable before population;
network transfer, population, and full-cache validation run outside the selection
lock, followed by exact plan/candidate revalidation before one IndexedDB transaction
changes `active`/`previous`. A failed or abandoned candidate cannot change the active
selection, and cleanup cannot delete a currently authorized active/previous generation.
Destructive uninstall acquires and holds the install-store, offline-shell prepare-owner,
and offline-shell selection locks in that global order across the complete teardown; it
never requests prepare ownership while already holding the selection lock.
For a third generation, the durable transaction selects
`active=C`/`previous=B` before best-effort deletion of obsolete A; a failed selection
write removes only unselected C and preserves durable B/A plus both caches, while
failed post-commit GC leaves an unselected orphan without failing activation. Fetch
dispatch consults only the exact active generation, refuses
reserved shell paths absent from it, and never searches another cache. If a selected
response is missing or corrupt, the worker verifies the one compatible previous
generation, atomically selects it, retires the failed generation from selection,
best-effort deletes its cache, and can satisfy the same navigation from that rollback
generation. No response mixes generations.

Ready binds the exact selected shell generation and release. Exact-worker
selection-change notifications from another controlled client invalidate Ready.
Launch re-queries the exact active D-136 target without another full prepare/verify
pass, then runtime performs D-137's final OPFS admission followed by one locked full
shell `admit(expected)`. Successful locked admission is the already-loaded immutable
page's shell boundary: a selection change before it fails typed, while a change after
it applies to the next navigation and does not revoke the running code, regardless of
whether the page has set its local `runtimeStarted` marker yet. Because the two manifest
responses are selected shell resources,
D-136 target discovery remains available offline; D-137 continues to open only exact
active-release OPFS references. Incompatibility is a typed `shell-release-mismatch` and
does not unlock Launch. Cached and generated failure responses preserve
`Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: require-corp`, and
`X-Content-Type-Options: nosniff`.

Offline-shell telemetry v2 exposes state, active/previous/candidate identities,
prepare/verify/activate/rollback/failure and cache hit/miss counts, cumulative verified
bytes/duration plus verification-duration high water, and a fixed zero
mixed-generation count. The retained adapter failures below do not change that
offline-shell schema. The accepted current runtime envelope is public telemetry v33
with nested offline-shell v2, install-store v3, and installer-transfer v3;
smoke/flythrough/render-recovery report schemas are v59/v26/v22; mandatory metric sets
v27/v11/v5 are unchanged. Registration calls and awaits the stable registration's
explicit `update()` inside the same request bound while online, then selects the newest
installing, waiting, or active worker in that order. An offline `TypeError` from that
update may reuse only the registration's exact activated `active` worker when it is
already the page's controller and the root scope/script identity still match; a null or
different controller, pending replacement, non-network error, or online failure is not
suppressed. It waits for exact activation, rejects a
redundant candidate, checks exact same-origin root script/scope, installs permanent
state/controller/message listeners before the final activation recheck, and invalidates
the cached endpoint on controller or worker-state changes. Registration does not
complete until that exact activated candidate is also
`navigator.serviceWorker.controller`; transient null/old control may wait only inside
the existing request bound. Exact control loss/replacement advances page-local
authority, rejects a response racing that change, and publishes typed failure telemetry
so Ready and pre-admit Launch become unavailable. Each endpoint synchronously rechecks
that its activated worker is still the exact current controller immediately before
posting and before accepting a response; correctness does not depend on the queued
`controllerchange` callback. Pre-admit Launch carries abortable shell authority through
the complete D-137 OPFS preflight and locked shell admission, with the immutable-page
boundary published only after both complete under the same still-current authority.
Successful locked runtime admission is still that boundary; later control changes
affect only future navigations. Container notifications are
accepted only when `MessageEvent.source` is that exact activated worker. Every request
captures an immutable request ID and owns its timeout and MessageChannel cleanup, so
overlapping reverse-order responses cannot be mistaken for stale duplicates. The
separately triggered
`pnpm harness:offline-shell-adapter` is a fresh-profile visible-Chrome exercise that
drives the ordinary Install flow to its exact Ready/Launch-enabled state, then checks
real service-worker control, complete Cache Storage population, offline isolated reload,
cached manifest identity, and OPFS-resource exclusion. Its local server exposes the
exact pinned model shards through hard-linked immutable sources so the ordinary
installer still transfers and verifies their bytes without making a second multi-GB
fixture copy. The adapter transport does not rewrite any install source or manifest:
every original manifest-bound path is served with its exact size/hash-derived strong
ETag and strict single open-ended Range semantics (`206`, matching `If-Range`, or exact
completed `416`). Same-origin GET requests carrying `Range` bypass offline-shell cache
resolution and go directly to the network; ordinary non-Range shell requests remain
cache-first. It is not run by deterministic gates and is not D-097 evidence. Adapter
schema v4 requires a genuinely fresh profile to settle at exact ordinary UI/transfer
`idle`, then records the actual UI `requesting-persistence`/`installing`/`ready` and
installer-transfer `transferring`/`verifying`/`ready` plus install-store
`writing`/`verifying`/`publishing`/`ready` transitions before claiming a fresh install.
It binds the manifest-declared worker URL and canonical
`artifactDigest:releaseDigest` generation to both the controlling worker and the
ordinary UI's Ready authority online and after offline reload. It captures one exact
controller across snapshot/cache/manifest inspection, rechecks its state/identity and
the document's navigation identity around every asynchronous phase, and durably retains
a bounded diagnostic ring installed before first navigation. Pending evidence is
created before profile, serving-tree, model-link, and server setup. Missing fixtures,
failed links, listen failures, and cleanup failures replace pending evidence with failed
evidence; the server, partial serving tree/hard links, and profile are cleaned. Result
stem reservation creates both JSON and Markdown placeholders exclusively before
returning and advances through a bounded numeric suffix on either collision. It never
deletes a result pathname after creation. Ownership of each successful `wx+` handle is
registered before its first `stat`; initial identity failure retains the path and handle,
writes bounded `reservation-abandoned` evidence through that exact handle, and closes it.
Every other still-owned partial placeholder is likewise rewritten through its retained
handle and closed before suffix advance or failure; a replaced pathname remains untouched
and stops the reservation with its logical failure detail. Every later write uses the
retained verified file handle. The runner retains both original `wx+`
handles and records their BigInt `dev`/`ino`; each member must remain a distinct regular
single-link file, and pathname `lstat` must resolve to the same recorded identity before
and after every write. A terminal pair write that partly fails
restores both owned placeholders to `finalization-failed` before the runner records the
structured failed result; an unrecoverable ownership-state write identifies its
logical result path and never touches unrelated bytes. Pending and failed setup
evidence reports exact validated/linked model counts and bytes as `pending` or
`incomplete`; only a fully
completed passing setup may claim `hard-linked-exact`. Failed JSON and Markdown retain
the same bounded/redacted primary failure, every cleanup failure with operation and
logical path, and each possibly remaining logical path.

**Context:** D-015 required offline navigation and isolation-header preservation;
D-128–D-137 supplied exact shell artifacts, crash-safe installed objects, publication,
reload discovery, and release-bound consumers, but ordinary navigation still depended
on the network and no atomic shell selection existed. HTTP cache presence alone is not
an application-level offline navigation contract.

Current sources checked on 2026-07-29: the
[Service Workers specification](https://www.w3.org/TR/service-workers/) for lifecycle,
fetch, Cache Storage, and client-control semantics; the
[Fetch Standard](https://fetch.spec.whatwg.org/) for reload cache mode, same-origin
credentials, and redirect-error behavior; the
[Web Locks API](https://www.w3.org/TR/web-locks/) for cross-context exclusive
coordination; the
[Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB-3/) for atomic read/write
transactions and the `strict` durability hint; and the
[HTML Standard](https://html.spec.whatwg.org/multipage/browsers.html) for COOP/COEP
cross-origin-isolation processing; and
[HTTP Semantics RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests)
for strong validators, Range/If-Range, partial `206`, and unsatisfied `416` semantics.
Those specifications define API semantics, not a
passing Chrome qualification; the adapter is the bounded implementation check.

**First-review correction:** Independent review rejected the initial proposal because
it deleted obsolete A before committing C/B, trusted an unattested automation query in
the service worker, admitted Launch from stale Ready state, cached an old active worker
while its replacement installed, and compared overlapping replies against a mutable
request ID. The first corrected candidate implemented commit-before-GC,
no-URL-authority, Ready invalidation plus launch admission, replacement-safe
registration, and per-request correlation. The adapter now inspects the activated
controlling worker rather than `ready.active`.

**Second-review correction:** Re-review rejected the corrected proposal because stable
same-URL registration did not explicitly run `update()`, container notifications were
not source-bound, the text incorrectly placed the admission boundary at
`runtimeStarted`, Launch redundantly performed multiple full shell passes without
byte/time telemetry, and admission failures could disagree with durable telemetry.
The current candidate implements the explicit bounded update and listener ordering,
exact-source filtering, locked-admit boundary, one Launch verification with telemetry
v2, and durable exact failure response/telemetry contract above.

**Third-review correction:** Re-review found that the outer preparation failure path
and the default cached-generation rollback path discarded the partial byte/time
measurement carried by a failed full verification. The current candidate folds each
attempted measurement into cumulative count, bytes, duration, and high-water telemetry
before durably recording failure or rollback, matching the admission paths.
Late-resource candidate-corruption and cached-active rollback regressions require the
exact partial work to remain observable.

**Browser-adapter adjudication and fourth correction:** The first authorized browser
adapter result,
`offline-shell-adapter/adapter-v1-2026-07-29T18-32-53-347Z.json`
(JSON SHA-256
`9ba839b53a747a03221e6292c8f37153cf1494a77fda750a80d537ef3eed5db9`;
Markdown SHA-256
`7569bfa5d4c3809b5388f507c773ba12d0518149c06571cfa98d37be045100bc`),
is retained failed on Chrome 151.0.7922.34 after the adapter's first control wait
succeeded but a later inspection evaluation observed a null controller. Adapter v1
split the observation across evaluations, so the evidence establishes an adapter TOCTOU
and does not establish why page control became null; no Chrome rough edge is claimed.
Review then found the separate product gap: registration activated a candidate without
requiring it to be the page's exact controller, and `controllerchange` disposed the
endpoint without revoking page-local Ready/pre-admit authority. The current correction
implements the exact controller/authority and immutable-admit boundary contracts above.
Adapter schema v2 retains bounded controller/state, page lifecycle/navigation,
registration-slot, Playwright document/request/response, and safely available CDP
service-worker diagnostics in pending/failed JSON, while executable fake-runtime tests
cover null/replaced/state/navigation and reverse completion timing. Exactly one
corrected v2 adapter run is authorized only after deterministic gates,
build/repeatability, and independent review converge. The retained v1 JSON and Markdown
are immutable.

**Controller-continuity re-review and fifth correction:** Re-review rejected the
fourth candidate because every reload required a successful network worker update,
controller loss during OPFS preflight did not revoke Launch authority, endpoint
correctness depended on delivery of `controllerchange`, and the adapter did not bind
the exact worker/generation to the ordinary Ready UI online and offline. The current
candidate adds the narrowly fail-closed offline-update reuse rule, synchronous endpoint
identity checks, abortable pre-admit authority through OPFS preflight and locked admit,
and exact manifest-worker/canonical-generation/ordinary-UI adapter assertions described
above. The authorized corrected adapter-run count is unchanged.

**Adapter-transport re-review and sixth correction:** Re-review accepted the product
controller changes but rejected the adapter because the ordinary static server returned
`200` to installer Range requests, the active service worker could substitute cached
shell `200` responses, a preexisting Ready profile could pass, and setup failures before
the protected block could leave pending evidence or temp state behind. The sixth
candidate adds the exact no-rewrite Range transport, production-safe network
pass-through for same-origin Range GETs, explicit fresh-idle and lifecycle-transition
proof, and pending-first protected setup/cleanup contract above. Tests cover shell and
model `206`, completed `416`, If-Range mismatch, invalid transport contracts, unchanged
release-manifest bytes/digest, ordinary cache-vs-Range policy, preexisting Ready
rejection, required transfer/publication-ready transitions, and retained
missing-shard/link/listen failures with cleanup. The authorized corrected adapter-run
count remains one and is still contingent on deterministic gates and independent
review.

**Evidence-lifecycle re-review and seventh correction:** Re-review accepted the
transport, worker, and fresh-install corrections but rejected the adapter evidence
lifecycle because timestamp collisions could overwrite retained Markdown, cleanup
failures were collapsed into one message, and pending/failed setup could claim exact
model linking before setup completed. The seventh candidate adds bounded exclusive
JSON/Markdown result creation with suffix collision handling, structured
primary-plus-all-cleanup failure evidence and logical remaining-path disclosure, and
live validated/linked file-and-byte progress with pass-only `hard-linked-exact`. Tests
seed colliding JSON/Markdown and prove their bytes remain unchanged after a failed
result is written, exercise missing-shard/link/listen primaries with cleanup failures
while verifying every cleanup attempt, cross-validate all structured failure fields in
JSON and Markdown, and reject premature exact-setup claims. Schema v2 remains proposed
and unretained, so this truthful strengthening does not consume a schema bump or the
single authorized corrected adapter run. That run remains withheld pending
deterministic gates and independent review.

**Owned-pair re-review and eighth correction:** Final re-review found one remaining
TOCTOU: the seventh candidate reserved JSON first but left Markdown unowned until
terminal publication, so another writer could claim that Markdown path after the stem
was returned. The eighth candidate reserves both create-only placeholders before
return, carries one unpredictable ownership token in both, and verifies that token on
an opened file handle before every pending or terminal write. Partial reservation
removes only its own verified placeholder and advances to a bounded suffix; a cleanup
failure or suffix exhaustion fails closed. Partial terminal publication restores both
owned files to a matching `finalization-failed` state before failed-result publication,
and exposes any ownership-state recovery failures by logical result path without
touching unrelated bytes. Deterministic tests cover a collision after a first completed
reservation, concurrent same-timestamp reservations, partial pair creation, bounded
suffix exhaustion, matched passed/failed publication, one-side terminal failure and
recovery, and refusal to modify replaced unrelated bytes. Schema v2 remains proposed
and unretained, and the authorized browser-run count remains unchanged.

**Filesystem-identity re-review and ninth correction:** Re-review found that a copied
token or a hardlink/path replacement could satisfy the eighth candidate's text-only
ownership check. It also found that all create failures were treated like suffix
collisions, masking `EACCES`, `ENOSPC`, `EIO`, and similar failures. The ninth candidate
retains the two original create-exclusive handles for the run, records their distinct
nonzero Windows volume/file identities through Node 24's BigInt `dev`/`ino`, and
requires handle and pathname identity equality, regular non-symbolic type, and link
count one before and after every pending or terminal write. Writes use only the
retained handle, so a pathname swap never modifies the replacement. Only an actual
`EEXIST` during JSON or Markdown creation advances the suffix. Every other create error
fails immediately; partial cleanup removes only a still-exact owned identity, and an
`AggregateError` retains the original create error plus every cleanup error.

On the validated Windows host, a local Node 24.18.0 probe returned matching nonzero
`dev`/`ino` for a new path and its open handle. Node's `Stats` API does not expose the
raw Windows reparse tag: the adapter therefore rejects the exposed symlink/junction
classes through `lstat`, and rejects any redirection or replacement whose pathname
identity/type differs from the retained regular-file handle. An exotic reparse point
that Node reports as a regular file with the exact same volume/file identity is not
separately classified by this adapter and would reopen the contract. Deterministic
Windows tests exercise JSON-to-Markdown hardlink replacement, an additional hardlink,
regular path replacement, copied-token impostors, a junction, and a file symlink when
host privileges permit it; all preserve unrelated bytes. Injected `EACCES`, `ENOSPC`,
and `EIO` tests prove immediate failure, exact partial cleanup, and original-plus-cleanup
error retention. At that review boundary D-138 and schema v2 remained proposed; the
browser run remained withheld.

**Path-deletion and close-lifecycle re-review and tenth correction:** Re-review found
that the ninth candidate still validated a pathname and then deleted it, leaving a
replacement race, and that terminal publication could write `passed` before a handle
close failed. The tenth candidate performs no pathname deletion in the result owner.
Each still-owned partial placeholder becomes explicit bounded
`reservation-abandoned` evidence carrying the create/collision failure and logical
path, then its handle is closed. An ordinary `EEXIST` may advance only after successful
abandonment; abandonment/path-identity/close failure stops immediately with the
original plus every per-file failure. At most 100 partial abandoned files can be added
by one exhausted invocation. If a pathname is replaced before abandonment, the
replacement is untouched, the original handle is closed, and the structured aggregate
identifies the failed logical result path.

JSON and Markdown handle-close state is tracked independently and changes only after
that exact close succeeds. Every call attempts both still-open handles; a later call
retries only prior failures and a completed close is idempotent. Terminal publication
writes and verifies the candidate pair, then closes both handles. Any close failure
reacquires only a pathname that still matches the recorded identity, restores both
artifacts to `finalization-failed`, and throws structured per-file close/recovery
details; the runner then publishes a failed pair and retries closure. It reports a
passing pair only after both closes succeed, and an unconditional runner `finally`
attempts both closures on every exit. Tests cover replacement at the old
validation/deletion boundary, bounded abandoned-orphan retention, publication plus
recovery failure, first/second/both close failures, retry/idempotence, matching pair
state, and closed-handle status. At that review boundary D-138 remained proposed and
the browser run remained withheld.

**Descriptor-lifetime re-review and eleventh correction:** Re-review found three
remaining descriptor escape paths in the tenth candidate: the first post-`wx+` `stat`
ran before the handle entered guarded ownership; failed reopened-handle validation
suppressed a close rejection and dropped the still-open handle; and partial abandonment
attempted close only once before returning. The eleventh candidate constructs the owned
result-file record immediately after `wx+`, so initial stat/identity failure is retained
as `reservation-abandoned` through the exact open handle and closure is attempted under
the same guard. Reopen validation plus close failure now throws one aggregate containing
both errors while preserving the handle/open state for a later retry; the handle becomes
null only after its exact close succeeds.

Partial abandonment retries only still-open handles for three bounded instrumented
attempts, retains every attempt error beside the primary create/collision error, and
keeps the complete owner set reachable through a final direct close attempt that test
fault hooks cannot bypass. A real final `FileHandle.close()` rejection is also retained
at process scope rather than leaving an unreachable live descriptor. Injected tests
cover initial-stat failure, combined reopen-validation/close failure, repeated partial
close with eventual success, and all three bounded close attempts failing before the
final owned close; their handle counters prove successful closure at attempts 1, 2, 3,
and 4 as applicable. At that review boundary D-138 remained proposed and the browser
run remained withheld.

**Retained v2 MIME-failure adjudication and twelfth correction:** The one authorized
schema-v2 run is retained failed as
`offline-shell-adapter/adapter-v2-2026-07-29T20-27-58-742Z.json`
(JSON SHA-256
`1fec1d32c69faa5749be5e8eb479aedf8b341ecd87a8ea68283049ef03e539e8`;
Markdown SHA-256
`e6d597e9ff9aa11c6b79a2451c916c4de9ee156619cd21e4fa9a7cc8a9756403`).
It binds Chrome 151.0.7922.34, artifact
`e1d6a8cebf7fadce2901e68d164bd3ca23563d1334fca4e483ade97371792b28`,
release `5a835f9b81c1ff652e4941e16fc48bd16d44b96d0271b497ef0005e99f8f596a`,
and source
`7fdc5465b5903751301a4e319a160848eacefac6/247a40a7f33d86c34d015d8928b8c59fcfca9069e49ee873d5bdaf58e8c78542`.
The service worker activated and controlled the page, but ordinary target refresh
failed before transfer: generation descriptors required
`application/javascript`, while the adapter's ordinary local server returned
`text/javascript; charset=utf-8` for the first app module. MIME-essence validation
therefore correctly raised `shell-contract`; the UI moved from `checking` to terminal
reload-required `failed`, both buttons remained disabled, and transfer/store remained
`idle`. This is deterministic project serving-contract drift, not a Chrome finding,
and no unchanged-artifact retry is authorized.

The correction deliberately selects one project JavaScript representation:
`application/javascript`. The current production server was checked by bounded HEAD on
2026-07-29 and returned that exact value for an immutable app module; the versioned
nginx types table, ordinary local server, deployment/target validators, generation
descriptors, and service-worker cache validation now agree. Validation compares the
parsed MIME essence, so parameters such as `charset=utf-8` are normalized, but
`text/javascript` and the other browser-recognized JavaScript MIME aliases are rejected
as project-contract drift. This is narrower than browser support: the current
[MIME Sniffing Standard](https://mimesniff.spec.whatwg.org/#javascript-mime-type)
recognizes both `application/javascript` and `text/javascript` as JavaScript MIME
types and defines MIME essence separately, while
[nginx `types`](https://nginx.org/en/docs/http/ngx_http_core_module.html#types)
maps configured extensions to response types. The exact-dist composition test now
performs generation preparation through the ordinary server transport and retains a
deterministic reproduction of the former mismatch.

Because schema v2 is retained, the corrected adapter advances to schema v3. Diagnostics
re-review rejected summary-only Markdown binding, permissive nested diagnostic values,
and first-N capture. The correction keeps schema v3 unretained and makes every
failure-time UI, installer/store/transfer/offline-shell telemetry, transition,
service-worker request, controller, registration, and document object exact-keyed,
bounded, redacted, and semantically cross-validated. Candidate release/generation,
worker/scope, terminal transition, failure code/message/recovery, button authority,
counters, and request ordering must agree. Unknown, oversized, or contradictory input
becomes a typed `diagnostic-collection` failure instead of invented or partial fields.

Event capture is now partitioned rolling retention for critical failures, controller
changes, lifecycle checkpoints, network traffic, and routine diagnostics. Late failure
checkpoints, page errors, service-worker failures, controller evidence, and terminal
lifecycle checkpoints cannot be displaced by the ordinary request stream. The server
journal aggregates every response/status and the exact expected/observed resource-path
set for all 283 install resources, while separately retaining rolling response, Range,
and failure tails; tail truncation cannot claim complete resource coverage. Terminal
Markdown binds the canonical JSON tuple of terminal state, diagnostics,
failure diagnostics, and server journal by exact base64url bytes plus SHA-256, and the
runner validates that equality before pair publication. All prior create-only
result-pair ownership, identity, close, and failure-recovery mechanics remain
unchanged. Exactly one corrected-artifact schema-v3 run became eligible only after
deterministic gates and independent review converged. No Chrome/adapter run was part of
this correction. At that correction boundary D-138 remained proposed and Installer
UX/M2 remained open.

State-contract re-review then rejected treating every browser failure as the retained
MIME failure, incomplete server-summary invariants, and bounded-but-open protocol
strings. At that review boundary schema v3 remained unretained. Failure diagnostics now carry an exact
phase/primary-classification discriminant with separate offline-shell preparation,
installer transfer/store/persistence, runner-online inspection, and offline-reload
validation branches. Each branch preserves the same raw surfaces but asserts only its
own truthful UI/shell/transfer/button/checkpoint contract; offline-reload evidence also
requires the retained pre-offline Ready/inspection checkpoints. The evidence parser
independently pins all store, transfer, shell, UI, persistence, recovery, failure-code,
worker, transition, and event enums so a producer-only widening cannot silently weaken
the retained contract.

The server summary now retains a complete canonical response population with
multiplicity plus exact expected, observed, missing, and unexpected path sets. Range
and failure populations, status/count summaries, path-set counts/digests, tail
membership, and truncation are derived projections of those retained bytes rather than
independent claims. Completeness is an exact biconditional: the expected and observed
283-resource sets match, missing and unexpected sets are empty, and no failed response
exists. A terminal `passed` state additionally requires that complete projection and
the other passing gates. Contradictory booleans, counts, digests, enum values, phases,
branches, populations, or tails fail diagnostic collection.

Ordering re-review requires the journal to retain a complete monotonic response
sequence and its canonical digest in addition to the multiplicity population. Range
and failure sequences are exact filtered subsequences, and each rolling response,
Range, or failure tail must equal the final `min(limit, count)` entries of its sequence,
including duplicate entries. Population membership alone cannot establish a tail.

Runner-online and offline-reload failures also retain the exact preceding Ready
authority: Ready UI, enabled Launch/disabled Install, ready store and transfer,
active offline shell, release digest, and canonical generation must all agree. An
offline reload may either remain at that exact Ready projection or retain a failed
transition whose immediate predecessor is a failure-free checking transition with the
next sequence number, the same strictly positive adapter attempt, and the exact
generation. Attempt zero is pre-attempt context and cannot authorize the edge.
Intervening Ready or another attempt cannot be relabeled as causal; arbitrary checking or
unavailable snapshots cannot substitute for Ready. The canonical terminal JSON/
Markdown binding and accepted partitioned retention remain unchanged.

**Retained v3 live-install adjudication and thirteenth correction:** The one authorized
schema-v3 run is retained failed as
`offline-shell-adapter/adapter-v3-2026-07-29T22-03-29-816Z.json`
(JSON SHA-256
`d2343b0f4f0e60d867534893fb045c2689aa55f9a169e9f455ff3c39d61a16a3`;
Markdown SHA-256
`eb6a24825642d0ac94ae52452f9a1e91b81bc8bdae63cd5bc18f9c79d599959e`;
canonical terminal binding SHA-256
`e87fa6cc5744cfa8563f2cf9a1798f1c8a55d0f812a8690ce516e8f02eaffd0b`).
It binds Chrome 151.0.7922.34, artifact
`30a44d3bb0506a2895bbd829d24aaa66a7890d1811ba89ae467d43bbfcbf11b4`,
release `57246b8b8586d5a3d36173fcb68b3f3e35b9b7a44900f27a2ec2652dfd5c9305`,
and source
`7fdc5465b5903751301a4e319a160848eacefac6/43ef86b10d0201ab76096d20a29d9198ce252e336198ef811764da636c85fe6b`.
The fixed 600-second Ready wait expired while the installer was still making forward
progress: 253 of 262 OPFS resources and 2,621,395,425 of 2,621,430,227 planned bytes
were complete, leaving 34,802 bytes across the current plus final eight cells. The
retained transport recorded 254 successful Range responses and zero transport,
validator, integrity, server, or app-reported failure. The exact
degraded-durability warning accompanied a truthful persistence denial. This is not a
Chrome finding.

Code inspection and deterministic operation-count tests identify the project defect:
every checkpoint and object finalization recomputed a recursive whole-store inventory.
The install therefore performed work proportional to chunks × accumulated inventory
plus resources × accumulated inventory; the small final cells became slower as the
store grew even though network transport remained healthy. The correction keeps
reconciliation/full refresh authoritative only at open, restart, explicit reconcile,
garbage collection, and exceptional recovery boundaries. Under the existing store
lock, ordinary partial mutations update only the affected partial and verified-object
inventory entries and preserve exact aggregate counters. Deterministic stress tests
assert zero global scans across hundreds of checkpoint appends and linear local
operations across hundreds of resources, while injected interruption/reopen tests
reconstruct exact counters from durable state.

Install-store telemetry v3 and installer-transfer telemetry v3 add monotonic,
cross-validated final-release verification phase, byte, resource, and total counters.
They flow through the app diagnostic snapshot and public telemetry v33; smoke,
flythrough, and render-recovery report schemas advance to v59/v26/v22 with mandatory
metric sets v27/v11/v5 unchanged. Final verification still reads every release object
and Ready remains impossible until the phase is exact `complete`.

Because v3 evidence is retained, the adapter advances to schema v4. The fixed Ready
wait is replaced by a 120-second no-progress watchdog over one monotonic tuple of
downloaded, checkpointed, verified, completed-resource, and final-verification
progress, plus a 30-minute absolute correctness ceiling. Only tuple progress resets the
watchdog; duplicate UI events, state churn, or counter regression do not. Terminal UI
failure stops immediately and retains a bounded sanitized underlying app/Playwright
cause. A persistence denial remains eligible only with the exact degraded-durability
warning and no durability claim. JSON and Markdown bind the configured limits,
observed maximum/last progress gaps, last tuple, and terminal classification. The
30-minute ceiling is evidence safety, not performance allowance: the standing install
budget remains actual bandwidth plus at most 90 seconds local work. Exactly one
corrected-artifact schema-v4 run became eligible only after deterministic gates and
independent review converged. No Chrome/adapter run was part of this correction; the
v1, v2, and v3 result pairs remain immutable. The build/repeatability, type, lint,
diff, and unit gates passed 115 files / 1100 tests. At that correction boundary D-138
remained proposed and Installer UX/M2 remained open.

**Schema-v4 contract re-review and fourteenth correction:** Independent review found
that a nonsettling Ready observation could outlive both liveness limits, retained causes
were only length-bounded, the affected-entry path still reread and reparsed the complete
release manifest, evidence filenames still used a fixed v3 stem, exceptional object
failure could leave live inventory/selection stale, and the five final-verification
fields were not cross-validated store-to-transfer. The corrected contract races every
observation read against independently owned stall and absolute timers; the exact
earliest deadline wins even at the boundary, aborts/ignores late reads, and cleans every
timer/listener. One shared sanitizer removes local paths, URL credentials/query data,
secret/token/user fields, and controls; validation recomputes that canonical form.
Under the existing store lock, each session caches the exact SHA-bound parsed immutable
manifest plus resource-ID map, invalidating it on reconcile, release-selection change,
GC, exceptional recovery, and reopen. Stress gates record actual manifest reads,
hashes, parses, and directory lists: 400 checkpoints and 200 resources perform no
hot-path manifest validation or recursive inventory list, while local work remains
linear. Any integrity/finalization/publication/rollback failure clears the cache and
authoritatively refreshes inventory and selection before returning failure. Adapter
result stems now derive from the pending schema (`adapter-v4-*`). Installer protocol
and adapter diagnostics require exact equality of final-verification phase,
bytes/resources, and both totals across store and transfer; Ready additionally requires
complete counters equal to the release byte/resource totals. Hostile, corruption,
reopen, rollback, deadline-race, late-read, and redaction tests fail closed. No browser,
deployment, D-097, or new retained evidence is part of this correction; retained v1-v3
remain immutable.

**Retained v4 evidence adjudication and fifteenth correction:** The one authorized
schema-v4 run is retained failed as
`offline-shell-adapter/adapter-v4-2026-07-29T23-33-28-971Z.json`
(JSON SHA-256
`289ff895c16cf3c5cd94d84d4c8a47178668b18253c0f74251260449b9b89d39`;
Markdown SHA-256
`7370c6da55c9a2985c6cb5749052b6c529e1add2daf4f40c9228aa5432268b65`).
It binds Chrome 151.0.7922.34, artifact
`fed5ce02e5529526047c2526e3368e6038b114afc1df8730da1c4e61ef91cd9b`,
release `1708f2b628a8eaa03b851b71ba55936ad19585dd135ba35d8eff9f07275ac378`,
and source
`7fdc5465b5903751301a4e319a160848eacefac6/5d2f06ff3748561e190a07f37f7daf61a06750594035fd0aaef447033e2b1b6e`.
The ordinary browser lifecycle completed exact final verification for all 262 OPFS
resources and 2,621,430,227 bytes, reached Ready, completed online and offline
inspection under the same isolated generation, and retained complete 283-resource
server coverage with 297 responses and zero failures. Result finalization nevertheless
failed deterministically because generic POSIX-path redaction classified the typed
leading-slash same-origin `server-response.detail.path` as a machine-local path. The
diagnostics close was then invoked a second time and duplicated that same finalization
failure as cleanup. This is harness evidence-contract/lifecycle drift, not a Chrome
finding, and the v4 JSON/Markdown remain failed and immutable.

The correction leaves strict generic redaction unchanged and adds one shared
field-aware exception only for the exact typed server-response path. It requires a
bounded canonical same-origin URL pathname with no scheme, authority, credentials,
query, fragment, backslash, controls, dot traversal, encoded/nested traversal, unsafe
decoded separators, or noncanonical encoding. Every opaque string still uses generic
redaction; arbitrary event kinds and other fields cannot claim the exception. The same
validator is applied before retention and during terminal JSON/Markdown validation.
Diagnostics close now records its attempted state before invoking the first close, so
a close failure remains the primary once; only a distinct failure from a genuine first
cleanup close is appended. Adversarial field-scope, redaction, idempotence,
canonical-binding, and single-close tests fail closed. At that correction boundary,
exactly one corrected-artifact schema-v4 run became eligible only after deterministic
gates and independent review converged. No Chrome/adapter run, deployment, D-097
action, or new retained evidence was part of the correction; retained v1-v4 remain
immutable.

**Passing v4 acceptance evidence:** The one post-review corrected-artifact run passed
as
`offline-shell-adapter/adapter-v4-2026-07-30T00-02-06-305Z.{json,md}`.
The JSON SHA-256 is
`10b5ad394182d6114e99e0eb0cc4347735fc5854dff0cb84ff178b0812f9c1af`,
the Markdown SHA-256 is
`3177e40fff6118a81ea3a69be11bb1304a636ddf056443c32ae56dcc769f4cc2`,
and their canonical terminal diagnostics binding is
`09027941aaafde516ee6d9f70bf96cb3d80c33bafc8ac4da43cb5fd19d6de3f3`.
It binds Chrome 151.0.7922.34 with executable SHA-256
`409805a16d6416087e6b2f778df1cf8f7bbb267d6b99f6b5bb0a618eace234f2`,
artifact
`fed5ce02e5529526047c2526e3368e6038b114afc1df8730da1c4e61ef91cd9b`,
release
`1708f2b628a8eaa03b851b71ba55936ad19585dd135ba35d8eff9f07275ac378`,
and source
`7fdc5465b5903751301a4e319a160848eacefac6/5b6f79ea5e5b07ba11d62cf381893c638e8181f96103d1b2b23866590ca7acd8`.

The complete lifecycle took 142,089 ms. Ordinary fresh-profile Ready completed in
131,945 ms; its maximum observed progress gap was 27,299 ms and its terminal gap was
4,009 ms, both within the exact 120-second stall watchdog. Final verification agreed
store-to-transfer-to-UI at 2,621,430,227 bytes and 262 resources. The server journal
proved complete 283/283 resource coverage across 297 responses, including 262 Range
responses and zero failures. Online and offline inspection retained the exact same
isolated, service-worker-controlled generation, complete shell cache, manifest
identity, Ready authority, enabled Launch, and active release while excluding OPFS
resources from Cache Storage. The main-thread persistence request was denied exactly;
installation continued with the required degraded-durability warning and made no
durability claim.

Independent final review recomputed the pair hashes and binding, traced the exact
identity and Ready/liveness/final-verification projections, checked complete server
coverage plus the online/offline authority invariants, and accepted D-138 without
further findings. The failed v1, v2, v3, and first v4 pairs and every adjudication above
remain immutable evidence; acceptance neither relabels nor removes them.

**Consequences:** Ordinary reload can recover the exact admitted shell and target
manifests without network access while installed game/model objects remain in OPFS.
Stable worker delivery is explicitly `no-cache` and exact-path; content-addressed shell
objects retain immutable caching. Build and deployment validators fail closed on the
v14 compatibility object and stable worker artifact. Deterministic tests cover
complete-before-select ordering, stale-candidate recovery, replacement failure,
selection-write failure, commit-before-GC, ignored orphan-GC failure, same-request
rollback, no mixing, origin/path/header/MIME/cache/byte/hash rejection, offline manifest
discovery, idempotent preparation, online update and exact offline-controller reuse,
newest-worker activation/exact control/replacement, synchronous endpoint identity,
overlapping request ordering/timeout/control-change isolation, privileged-route
separation, cross-client Ready and controller-authority invalidation through OPFS
preflight and locked admit, one-pass launch admission, post-admit selection/control
continuity, exact-source
notification filtering, and truthful selection/corruption admission failures.
The retained pre-v4 ordering-corrected deterministic build/repeatability, lint, and
unit gate passed 114 files / 1081 tests.

D-138 closes only M2's service-worker offline-shell checkbox; Installer UX and M2
remain open. The passing adapter exercised a fresh-profile local exact-byte install,
including the five pinned model shards' 2,620,371,552 bytes, only as setup for ordinary
Ready authority. Hard links avoided a second fixture copy but did not avoid the
explicit localhost transfer. That result does not establish production-network
transfer, performance, quota, persistence,
interruption, or multi-GB lifecycle qualification. D-138 does not provide corruption-by-refetch,
browser-restart-offline evidence, interrupted real updates, update UI, uninstall,
quota/persistence qualification, code-cache/Dawn-cache conclusions, deployment,
production verification, performance evidence, or a D-097 run. The next ordered
standalone M2 project is PSO trace capture and progressive warmup at boot.

Later root-rule-12 cleanup on 2026-08-02 removes the closed offline-shell browser
adapter runner, diagnostics/lifecycle/inspection/fresh-install/setup modules, their
tests, package command, and routine source assertions. The shared result-pair owner,
progress liveness, diagnostic redaction, and exact-range projection remain under
generic names because active installer-trust, OPFS, scale, and uninstall paths consume
them. Ignored adapter results and D-099 reconstruction artifacts remain untouched; the
hashes, measurements, conclusions, and reopen conditions recorded here remain
authoritative.

**Reopen if:** Chrome's bounded adapter contradicts the specified Cache/IndexedDB/Web
Lock ordering, worker-served isolation headers do not preserve `crossOriginIsolated`,
the stable-worker lifecycle cannot remain independent of release selection, save-schema
compatibility needs a migration graph rather than exact equality, or measured shell
classes belong in OPFS.

## D-137: Bind ordinary runtime consumers to the exact active installed release (2026-07-29, accepted)

**Decision:** Ordinary Launch carries the exact `releaseDigest` admitted by D-136 and
fails closed unless that digest is still the release store's exact active selection.
Before exposing the runtime UI, the app resolves both current ordinary consumer sets:
the District 1 index plus every indexed world cell, and all five pinned app-owned model
shards. Every resolution cross-checks resource ID, kind, scope, target, byte length,
SHA-256 identity, release digest, and content-addressed OPFS object reference against
the stored install manifest. A missing, aliased, malformed, out-of-release, or
wrong-identity reference aborts Launch; there is no network or legacy-cache fallback.
This validates D-136's durable verified-object records and sizes on open, not a new
multi-GB launch-time rehash. Explicit repair and full-release verification remain later
lifecycle operations.

The streaming worker independently repeats the exact active-release binding, reads and
strictly validates the installed district index, binds every index entry to its exact
installed world-cell resource, and opens sync access handles directly on the release
store's immutable content-addressed objects. Ordinary streaming does not fetch the
build manifest, district index, or cells and does not create, provision, prune, or read
the old `parallax-streaming-v1` subsystem cache. Streaming telemetry v10 distinguishes
the exact installed digest/resource count/bytes from legacy network request count and
requires those modes to be mutually exclusive.

District-index v1 has one canonical semantic identity per cell. For district
`districtId`, non-negative coordinate `[x,z]`, and content `sha256`, each coordinate
token is base-10 padded to at least two digits; `cellId` is
`<districtId>-cell-<xx>-<zz>`, immutable source is
`immutable/<artifact-scope>-cell-<xx>-<zz>-<sha256>.json`, and install resource ID is
`game-specific-world-cell-<artifact-scope>-<xx>-<zz>`. `artifact-scope` is the existing
lower-case district ID with non-alphanumerics collapsed to hyphens. The generator,
production build publisher/classifier, build-manifest validator, benchmark validator,
and installed consumer share the engine-owned identity helper. The v1 district index
itself has exactly `bounds`, `cellSizeMeters`, `cells`, `districtId`, `materials`, and
`schemaVersion`; authored generator/marker/traversal metadata remains in the game
bundle rather than the streaming index.

The app-owned model consumer is an exact release-bound five-shard source contract with
installed path, resource ID, byte length, and hash identity plus model-source telemetry
v1. It resolves during Launch and exposes zero network fallbacks. D-137 deliberately
does not invent an ordinary inference UI or retrofit the D-096 experimental wllama
runner: there is no ordinary model invocation yet. Authored non-AI gameplay remains
the optional-AI gameplay behavior, but it is not a storage, identity, integrity, or
network fallback and cannot make a failed installed-source Launch succeed.

The pre-M2 build-manifest fetch, world-cell download/cache path, and URL-driven wllama
spike remain available only through D-135's exact
`parallaxAutomation=runtime` route after WebDriver attestation. Smoke, flythrough,
render-recovery, and app-owned-LLM runners use that privileged compatibility route;
ordinary navigation cannot select it. Public telemetry advances to v31 and
smoke/flythrough/render-recovery reports advance to v57/v24/v20 with mandatory metric
sets v27/v11/v5 unchanged. This is an evidence-contract advance, not a metric,
threshold, topology, scenario, or measurement change.

**Context:** D-129 created immutable common/game object namespaces and exact release
references; D-136 published and rediscovered an exact active release but intentionally
left the pre-M2 consumers untouched. Launching that runtime could therefore re-download
District 1 into a subsystem cache and had no release-bound model source, defeating the
install/launch/run lifecycle even though publication itself was correct.

**Consequences:** Ordinary runtime content is now release-coherent and network-silent
for the migrated streaming and model sets. Main-thread preflight gives Launch a
fail-closed boundary, while post-handle worker admission protects the independently
executing streaming realm before decode, ready, or scheduling state. Deterministic adversarial
coverage includes active-selection drift, wrong references, incomplete model shards,
unbound index cells, malformed index identity, digest propagation, and a source audit
that keeps fetch/provision/cache operations out of the installed branch. This project
was rejected in its first independent review: batched cell resolution reparsed the
manifest per resource, parallel preflights could outlive a rejected Launch, initial
selection/manifest admission and worker post-handle admission were not atomic, and the
district-index parser trusted material objects and insufficiently bounded coordinates.
The corrected candidate reads and validates one manifest/staged record per ordered
batch, runs model then streaming preflight sequentially before a final atomic
admission, performs the worker's final atomic admission only after handles open and
closes them on drift, and strictly validates canonical materials, ordered bounds, exact
cell keys, and derived cell extents. The corrected build/repeatability, type, lint, and
full unit gates now pass (99 files / 896 tests); D-137 remains proposed pending
independent re-review. That re-review found two remaining gaps: path/size/hash binding
did not prove cell ID, coordinate, source filename, and semantic resource ID described
the same cell, and the district-index parser did not reject extra top-level keys. The
corrected candidate now applies the shared schema-v1 identity helper at generation,
classification, validation, and consumption; exact top-level keys and swapped
ID/coordinate/path/resource fixtures fail before Launch. The second corrected
build/repeatability, type, lint, diff, and full unit gates pass (100 files / 900 tests);
final independent re-review traced the shared identity through generated `dist` and
every validation layer and accepted D-137 without further findings. This project
does not add ordinary inference, corruption-by-refetch, service-worker/offline shell
activation, update/rollback UX, uninstall, deployment, physical evidence, or D-097
qualification.

**Reopen if:** runtime consumers need a transaction stronger than immutable
active-release references, launch-time full-object rehash proves affordable and
necessary, installed model inference requires a different browser-readable source
shape, or lifecycle automation no longer needs the bounded privileged compatibility
route.

## D-136: Publish the verified target and rediscover its exact active selection (2026-07-29, accepted)

**Decision:** Complete the installer worker's release transaction under D-133's
whole-operation transfer lock. After every OPFS resource has transferred or been
reused, the worker requires the returned byte and resource totals to equal the exact
target install-manifest summary, verifies the complete staged release again through
the release store, marks it ready, publishes it, and requires the resulting active
selection to equal the target `releaseDigest`. No `install-complete` response or
terminal `ready` telemetry is emitted before that exact publication succeeds.

Cancellation remains effective through the potentially long whole-release verification:
the activation boundary checks the operation signal before and after verification and
again after ready marking, withholding publication when cancellation wins any of those
boundaries. Publication is the final short durable commit after the last cancellation
check; once that commit begins, `cancel-complete` reports that cancellation was too late
instead of falsely claiming success. The app then reconciles exact target status,
restores `ready` only for the exact active release, and preserves any typed publication
or status failure. Aggregate release failures carry no fabricated resource identity.

Advance the installer protocol to v2 with a strict `target-status` request/response.
Both install and status requests carry the loaded app module's exact same-origin
entrypoint path. Production accepts it only when it has the
`immutable/app-<full-sha256>.js` form, the target build manifest lists that exact
artifact, and the full filename digest equals its artifact SHA-256. This prevents an
already-open old shell from publishing or launching a new release when deployment
races the page; the typed `shell-incompatible` failure permits only Reload.

The worker fetches and independently validates the current same-origin build and
install manifests using the same canonical build-root resolver as installation, reads
the store's eligible active selection, and reports both exact digests. The protocol
accepts `active: true` only when `activeReleaseDigest === releaseDigest`. On ordinary
reload, the app shell enters a checking state and unlocks Launch only for that exact
current target; a different or absent active target remains installable, while a
malformed target or incompatible loaded shell fails with typed recovery. A page-local
generation guard prevents a late status response from overwriting an installation
started afterward. Target discovery has a 30-second request bound that rejects and
aborts even if the underlying operation never settles. Network/HTTP, response-URL,
manifest-shape, manifest-integrity, and loaded-shell failures retain distinct typed
classifications and recovery actions.

The status query proves target-manifest identity and eligible publication metadata; it
does not rehash every multi-GB object. Runtime consumers must still validate exact
resource references as they open them and the later repair project owns
corruption-by-refetch. This decision supersedes only D-135's narrow reload provision
that required another explicit Install/Retry because no target-status API existed.

Because terminal installer `ready` now means verified **and active**, advance
installer-transfer telemetry to v2 and the public telemetry envelope to v30. Smoke,
flythrough, and render-recovery reports advance to v56/v23/v19 respectively while
their mandatory metric sets remain v27/v11/v5. No metric, threshold, topology,
scenario, or measurement semantics change.

**Context:** D-133 deliberately stopped at an unpublished ready release, and D-135
could therefore gate only on an `install-complete` observed by the current page. That
made every reload repeat the install action and left Launch starting the pre-M2 runtime
without a durable active-release identity. D-129 already provides exact ready,
publication, eligible-selection, and verification primitives. The build already names
the app entry module with its full content SHA-256, giving the page a non-circular
loaded-shell compatibility identity that can cross the worker boundary. The installer
can therefore close this transaction without moving network, OPFS, lock, or activation
ownership into the app shell.

**Consequences:** Publication and reload discovery are deterministic and independently
tested, including transfer-total mismatch, full-release integrity mismatch,
cancellation at both verification boundaries, wrong active selection, exact loaded-app
compatibility, strict protocol shape, stale UI response suppression, and active/inactive
reload states. Terminal `install-complete` is additionally cross-validated against the
same request's transfer-ready counters and the transfer/store active-release digests.
Adversarial review rejected early-completion acceptance, the publication/cancel race,
unbounded target discovery, collapsed target errors, and late-cancel loss of typed
failures; all five were corrected with focused regression tests before acceptance.
The corrected final gate passed 95 files / 880 tests, and final independent review
accepted the slice without findings. This bounded key prevents cross-deployment
app-module/release mixing; the
later service-worker project still owns full HTML/engine/manifest/save-schema
compatibility and atomic offline shell activation. This project does not yet migrate
streaming/model consumers, add offline navigation, update/rollback UX, corruption
repair, deploy, or provide new physical evidence. D-097 remains reserved for the final
converged runtime-affecting M2 candidate.

**Reopen if:** publication must coordinate atomically with a service-worker shell
version, active-selection metadata cannot remain a fast launch gate, a later consumer
requires a different compatibility identity, cancellation must be accepted after the
publication commit starts, or update/rollback policy requires more than the current
active/previous selection.

## D-135: Gate app-shell installation and launch on an explicit user action (2026-07-29, accepted)

**Decision:** Split app-shell startup from runtime startup. A normal navigation eagerly
creates only D-133's installer service/worker and presents the installer shell; render,
streaming, decode, telemetry-export, benchmark, and game-runtime services are created
only after an explicit Launch action. Installation begins only from the shell's
Install/Retry button. The same direct click call stack invokes the engine-owned
`requestPersistence()` method, which calls `navigator.storage.persist()` before
returning its promise. A `false` result is a visible degraded-durability warning and
does not stop installation; a rejected request is an actionable failure that permits
retry.

The shell derives byte/resource progress from D-133's existing installer-transfer
snapshot: total, planned download, newly downloaded, reused, resumed, verified,
completed resource count, and current resource. Cancel remains available while
persistence or transfer is active. Retry resumes through the worker/store contracts
rather than creating a second resume implementation in the app. Quota, integrity,
transport, validator, manifest, persistence, and unknown failures retain their typed
classification and receive user-facing recovery text. The Launch button is enabled
only after this page has observed an exact `install-complete` result and retained its
`releaseDigest`; store counts or a prior page's generic `ready` state are not inferred
to identify the current target.

D-133's downloaded, resumed, verified, and completed-resource counters are
worker-lifetime instrumentation. The shell snapshots them at the start of each
Install/Retry action and displays only nonnegative operation deltas. Plan totals,
planned-download bytes, and reuse are hidden until that attempt reaches a post-plan
state, so an earlier attempt cannot be combined with a later plan or make retry
progress reach completion early. A fail-closed worker/service protocol failure and a
runtime boot failure are terminal for the current page: the shell preserves their
classification, disables Install/Retry, and offers an explicit Reload action. Ordinary
transfer, quota, integrity, validator, manifest, and persistence failures remain
retryable.

Existing privileged runners use one narrow compatibility route:
`?parallaxAutomation=runtime` is honored only when `navigator.webdriver === true`.
Smoke (including its V8 diagnostic), flythrough, render-recovery, and the app-owned-LLM
runner add that exact parameter while retaining exact-navigation checks. Ordinary
users cannot bypass the shell with the query parameter alone. The route preserves the
pre-D-135 runtime and measurement path while M2 consumer migration is still pending.
It changes neither report structure nor measurement semantics, so no report,
telemetry, or mandatory-metric schema advances.

This project deliberately stops before release publication/activation, consumer
migration, service-worker/offline shell work, update/rollback UX, PSO warmup, or
lifecycle evidence. Launch currently starts the existing pre-M2 runtime only after the
target release reaches `ready`; it must not be described as consuming that OPFS
release. A reload asks for explicit Install/Retry again and may complete mostly through
reuse, because D-133 intentionally exposes no target-manifest readiness query separate
from the explicit install operation.

**Context:** D-133 proved the eager worker, resumable transfer, quota preflight,
integrity verification, and transition to `ready`, but intentionally had no persistence
request or UI and the old app entrypoint eagerly booted every runtime service. RE-045's
2026-07-29 pinned-Chrome worker probe found `StorageManager.persisted()` available in a
dedicated worker but `StorageManager.persist()` absent, requiring the persistence
request to remain at the window/app-shell boundary. Keeping the platform call behind
the engine service preserves layer ownership while the controller remains
dependency-injected and testable.

**Consequences:** The install gesture, persistence decision, operation-scoped progress,
cancellation, retry, terminal reload, classified failures, and exact page-observed
launch gate are independently unit-tested. The static runtime module is still part of
the current app bundle; this decision defers shell-code precaching and module-fetch
isolation to the service-worker project. D-097 still requires one physical smoke only
after the complete reviewable runtime-affecting M2 candidate converges, not for this
intermediate slice.

The first review rejected the candidate because runtime-boot and fail-closed-worker
errors entered unrecoverable Retry loops, retry progress combined lifetime counters
with the new plan, and two documented metrics were absent from the UI. The corrected
candidate adds explicit terminal recovery, per-attempt counter baselines and post-plan
visibility, and renders planned bytes plus completed/total resources. The focused
controller/service/automation/target suite passed 42/42 tests. The final deterministic
gate passed 91 files / 854 tests, production builds, exact engine/Wasm repeatability,
lint, and `git diff --check`. D-135 is accepted without deployment or physical
qualification; those remain subject to D-097 after the complete reviewable M2 runtime
candidate converges.

**Reopen if:** Chrome's storage-persistence surface changes, the installer gains an
exact current-target readiness query, harness automation no longer exposes WebDriver,
runtime consumers migrate to published OPFS releases, or the service-worker shell
introduces a different launch/compatibility coordinator.

## D-134: Retain the first D-133 smoke as failed and correct exact heap-worker topology (2026-07-29, accepted)

**Decision:** Retain
`smoke-1-ab2674968dbd-dev-01-showcase-2026-07-29T14-05-58-150Z.json`
(SHA-256
`78cf5159c781147cc636e9f4a8852b5800a96f632a4133f458f90d9493459c18`;
Markdown SHA-256
`47a6c11032ad4f2010d8e47cedf83c26afccc6dd1af4dd6f428f0f506a644d46`)
as failed. It measured the exact production artifact
`ab2674968dbd7e7d64ee85f7d0d02a68c1d2e7b4b6bedba97f439d759c3952a9`
and release
`995a1c9a99af1e0c4f1f22ff0571607caeae0c830f21bdc79311936d7a1ab630`
before and after all six launches. The environment facet passed, all six core launches
completed, all 24 executed absolute budget checks passed, and both streaming and
render-callback repeatability checks passed. The evidence facet failed and the budget
facet was correctly `not-evaluated`: every all-realm JS-heap sample rejected the eager
installer worker as an unknown target, so all six heap checks were withheld rather
than silently measuring an incomplete target set.

Classify this as deterministic harness contract drift introduced when D-133 added the
fifth eager worker, not as an intermittent browser or product-runtime failure. One
shared pure harness resolver now requires exactly one distinct build-manifest v13
entrypoint for each of `decode|installer|render|streaming|wasm-thread`, rejects
missing, duplicate, or unexpected role topology, and returns the exact steady-state
target multiset: installer, render, streaming, and the telemetry-declared number of
decode workers. The wasm-thread entrypoint remains part of the validated build
topology but is excluded from the steady-state target set because those diagnostic
workers are not live there. The existing all-realm sampler still rejects every
unknown, missing, duplicate, or extra CDP target. Smoke advances to report schema v55
and flythrough to v22; mandatory metric sets remain v27 and v11, and no metric,
threshold, budget, launch count, duration, or product artifact changes.

Authorize exactly one corrected D-097 production `smoke@1`, only after deterministic
gates pass, adversarial review accepts the correction, and exact production
artifact/release identity is reverified. There is no immediate same-artifact
classification retry because the retained failure is already causally explained.
D-133 remained proposed until that corrected smoke and final independent review passed.

That single corrected run is retained as the accepted passing evidence:
`smoke-1-ab2674968dbd-dev-01-showcase-2026-07-29T14-38-09-308Z.json`
(SHA-256
`87713a1fa9a73c1e5c83d9be8e30dc8441b51d26fb671d6e33be810dee994c4f`;
Markdown SHA-256
`62a42d958a5d9faac7c946fc6ba4471118f6a812e0067572eb112dd6ec0be31b`).
Schema v55 / mandatory metric set v27 passed all six launches, all three facets,
and 30/30 checks against the same exact production artifact and release before and
after measurement. Every heap check measured exactly eight live realms: the page,
installer, render, streaming, and four telemetry-declared decode workers. Fresh
streaming p95 values were 1.920000076/2.210000038/2.280000210 ms, a
0.360000134 ms spread; warm values were
2.254999876/1.824999809/2.470000029 ms, a 0.645000219 ms spread. Both are within
the unchanged 1 ms allowance. The baseline remains `untracked`; no retry or
promotion occurred. The measured source is
`7fdc5465b5903751301a4e319a160848eacefac6/7a8fb7a7a7c81bfa0b17aed02986895695f86273bda5d11f25091627b4589202`.
Final review independently rechecked the JSON/Markdown hashes, exact pre/post
production identity, all six launch records, all 30 checks, and the raw all-realm
samples. Every heap sample contained exactly the page, installer, render, streaming,
and four decode workers; every recorded high-water equalled the maximum raw aggregate
sample. Callback, streaming, and presentation repeatability recomputed exactly.
D-133 is therefore accepted. This does not close Installer UX or M2.

**Context:** D-133 correctly added the installer worker to build-manifest v13 and made
it eager so installer telemetry is observable before UI work. Smoke and flythrough
still constructed the all-realm target multiset from only render, streaming, and
decode roles. CDP therefore observed the exact additional installer target that the
manifest declared, while the fail-closed sampler correctly refused to sum a topology
its runner had not authorized. The correction is confined to harness measurement and
evidence contracts. The current `dist` remains artifact
`ab2674968dbd7e7d64ee85f7d0d02a68c1d2e7b4b6bedba97f439d759c3952a9`,
release
`995a1c9a99af1e0c4f1f22ff0571607caeae0c830f21bdc79311936d7a1ab630`,
and installer-worker SHA-256
`114c72048fac628e993faf7bf639da0c8814b52d736644fb5cf26eeac7f887ba`.

**Consequences:** The failed schema-v54 result remains immutable and cannot qualify
D-133. The schema-v55 correction measured the installer worker's live V8 heap in both
fresh and warm launches and still fails closed if any target beyond the exact page plus
resolved worker multiset appears. The harness-only correction implied no deployment;
production identity was checked immediately before the one authorized run.

**Reopen if:** the steady-state worker lifecycle changes, decode multiplicity stops
being telemetry-declared, a worker role becomes non-eager or multiply instantiated, or
CDP target ownership can no longer prove the exact page/worker context.

## D-133: Use a dedicated transfer lock and strong-validator resumable installer worker (2026-07-29, accepted)

**Decision:** Add an eager fifth dedicated worker, `installer`, and advance the exact
build-manifest worker-role set to
`decode|installer|render|streaming|wasm-thread` under schema v13. Its main-thread
`InstallerService` exposes only install, cancel, snapshot, subscription, and disposal.
The service owns no browser network, storage, quota, hashing, transfer-policy, or UI
logic; production installation always begins from the fixed same-origin
`/build-manifest.json`.

The worker holds the separate exclusive Web Lock
`parallax-installer-transfer-v1` from manifest fetch through quota preflight, transfer,
final release verification, and ready marking. D-129 store methods retain their own
short `parallax-install-store-v1` locks. The transfer lock is never nested inside the
store lock and the store lock is never held across network waits. Cancellation aborts
an active fetch, discards only the uncheckpointed in-memory tail, permits an in-flight
append/flush/checkpoint to quiesce, retains staged/checkpointed state, and releases the
transfer lock. Any resource failure or owner cancellation cooperatively aborts every
sibling fetch/body task, preserves the primary classified failure, and withholds the
operation result and transfer-lock release until all sibling tasks have settled. The
worker stops at `ready`: it never publishes a release, changes active/previous
selection, migrates a consumer, or requests persistence.
Every readable positive safe request ID is consumed before the rest of its envelope is
validated. The IDs increase strictly within one worker lifetime; the worker keeps only
the latest ID, rejects duplicates and out-of-order requests even after a malformed newer
envelope, and a new worker lifetime restarts that bounded sequence.
InstallerService begins disposal with a synchronous closed-work boundary. New public
work receives the typed disposed tuple, callers already awaiting non-disposal or
persistence responses are rejected immediately, and repeated disposal shares the same
terminal promise. Worker correlations become draining: their eventual parsed terminal
response is consumed without re-settlement or ordinary live-result telemetry validation,
and any unanswered drain is cleared when disposal acknowledgement proves worker
quiescence. Persistence still invokes `navigator.storage.persist()` synchronously for
user activation; the service-owned caller promise absorbs any later platform settlement.
Manifest exact-key validation and durable install-store record serialization reject lone
UTF-16 surrogates before canonicalization. Valid keys are ordered lexicographically by
Unicode scalar value rather than locale or UTF-16 code-unit order.

Every resource request, including offset zero, uses `Range: bytes=<offset>-`.
A nonzero resume also requires the exact persisted strong `If-Range` validator.
The shared store/transfer validator accepts exactly 1–1,024 ASCII `qdtext` characters
inside quotes and rejects weak tags, empty tags, quoted-pair escapes, `obs-text`, and
overlong tags.
Only an exact same-origin 206 representation with the full expected
Content-Range/Content-Length, absent Content-Encoding, and a stable strong ETag is
consumed. A 200 fallback is cancelled without consumption. A 416 is usable only when
the requested durable offset already equals the expected size and
`Content-Range: bytes */<size>` proves that boundary. Complete fixed-size chunks are
appended, flushed, and checkpointed; the only short chunk is the exact resource tail.
Network/timeout errors and 408/429/500/502/503/504 receive at most three total attempts
with fixed 250 ms and 1,000 ms delays; every retry re-reads durable state. The timeout is
a network-idle deadline spanning fetch through first body byte and each later pending read,
not local checkpoint work or the whole response body. On a resumed request only, a 200
fallback or changed strong ETag on 206 permits one extra bounded recovery that cancels the
body, discards the stale partial, and restarts from zero without resumed-byte credit; a
second mismatch is terminal. All other contract, validator, encoding, range,
overflow/underflow, and integrity failures are terminal.
The D-151 correction advanced installer protocol v6, installer-transfer telemetry v8,
public telemetry v38, smoke v63, flythrough v30, and render-recovery v26 solely to carry
the truthful `store-discard-partial` failure-evidence tuple; metric sets and thresholds
do not change.

The 2026-08-02 M2 Repair-authority correction advances the live installer protocol to
v7 and installer-transfer telemetry to v9. `repair` requests now carry the app shell's
exact admitted release digest; the worker rejects a rediscovered different release as
the canonical retryable `repair-target-mismatch` tuple before mutation. Failure
responses and telemetry carry that expected digest plus an `operation|session` source,
so nullable current-release state cannot fabricate authority for a later Repair. This
changes protocol and diagnostic identity only; D-133's transfer policy, locks, budgets,
and retained physical evidence remain unchanged and are not rebound by this correction.

D-129 partial checkpoints advance to schema v2 and bind `strongEtag`. A legacy v1
checkpoint cannot authorize resume and is removed while its partial data is
conservatively truncated to zero. New `prepareResource`, `planRelease`, and bounded
flushed quota-probe methods avoid message-text inference. Install-store telemetry
advances to v2; installer-transfer telemetry starts at v1; the public envelope advances
to v29. D-133 initially advanced smoke/flythrough/render-recovery reports to
v54/v21/v18; D-134 subsequently advances smoke/flythrough to v55/v22 without changing
mandatory metric sets or measurement semantics.

Production concurrency and checkpoint size are selected by D-133's declared nine-cell
calibration, run after implementation review. The selection rule was fixed before
measurement: among cells with zero correctness/protocol failures and acceptable
repeatability, choose the lowest concurrency and then the smallest checkpoint size
within 5% of the best median ready throughput across concurrency 1/2/4 and checkpoint
1/4/8 MiB using four exact same-origin 32 MiB synthetic resources. Calibration
scenario `installer-transfer-policy-calibration@1` fixes one unmeasured warmup and
three measured trials per cell, with acceptable repeatability defined before the run
as a pure ready-throughput relative range no greater than 10%. Warmups run once in
`c1-mib1, c1-mib4, c1-mib8, c2-mib1, c2-mib4, c2-mib8, c4-mib1, c4-mib4,
c4-mib8` order. The three measured rounds use that order, its exact reverse, and the
same order rotated left by three cells. Each trial starts after proving the calibration
install-store root absent, stages a new release, counts all four resources as actual
download rather than reuse, observes quota before/at-ready/after-cleanup, and proves
the root absent again after result capture. Schema-v1 independent validation recomputes
cell medians, repeatability, eligibility, and the declared tie-break from raw trials.
It also anchors the exact warmup/measured orders and ordinals, zero-retry trials, all
nine cell-to-policy mappings, and the four ordered synthetic byte/hash/strong-ETag
identities rather than accepting those fields as report-authored self-description.
The passing result selects production concurrency 1 and an 8 MiB checkpoint.

**Context:** A disposable visible pinned-Chrome worker surface probe ran on 2026-07-29
at 11:41:42 UTC using Chrome for Testing 151.0.7922.34
(executable SHA-256
`409805a16d6416087e6b2f778df1cf8f7bbb267d6b99f6b5bb0a618eace234f2`).
The retained ignored result JSON has SHA-256
`abf808f0ab4fffc00e4ae71b431fe240e77ee0d5d95986b3dd5eea18dabe2d6b`.
Inside a `DedicatedWorkerGlobalScope`, `navigator.storage.getDirectory`,
`estimate`, and `persisted`, OPFS sync access handles, and Web Locks request/query all
worked. `persisted()` returned false; `persist()` was absent. This matches the checked
2026-07-29 [Storage Standard](https://storage.spec.whatwg.org/), [File System
Standard](https://fs.spec.whatwg.org/), and [Web Locks
specification](https://www.w3.org/TR/web-locks/): workers can observe storage and own
OPFS/Web Locks, while the persistence request stays in the later user-gesture
main-thread UX.

The due runtime-integrity dependency checkpoint adopted exact `@noble/hashes` 2.2.0.
The signed immutable upstream release points at commit `81983c2` (2026-04-11); the
zero-dependency ESM, Node `>=20.19`, `sideEffects: false`, `./sha2.js`, and `./utils.js`
contracts used here are unchanged, and repository/GitHub advisory checks found no
match. Isolated tarballs, 480 boundary/chunk comparisons, one 64 MiB comparison, and
TypeScript compilation were checked before the exact pin/lock move; full
`pnpm check` and explicit repeatability then passed. Only unminified `engine.js` and
`installer-worker.js` changed, each by +6,596 bytes. That observation makes no
performance claim; the full evidence and official links are in
[dependencies.md](dependencies.md).

The unchanged pinned-Chrome real-OPFS adapter also passed on both sides of the pin.
The 2.0.1 result
`adapter-v2-2026-07-29T12-05-01-406Z.json` has SHA-256
`6b050ffc44cec855146bc31e53f22b1fe8fe97e146ecd1ca235e779d731de08b`,
artifact `63b47da2768c0524214058aa7a8b269b7e65790faef946b391f77f8a731921f1`,
release `884f8b611d62cd5436c32f42d960f9295e9bbe134edf1573c3390c7fa5d9e61c`,
and dirty-source digest
`7b96229e76fb7182f35a182f722ee6edd753ba2184095aada366cd816509054d`.
The 2.2.0 result
`adapter-v2-2026-07-29T12-07-25-730Z.json` has SHA-256
`215efc51e710a349acb693234514cf4ea036052e7589c1267310dec06d16002f`,
artifact `288a46c95c3aa9b9e6ddf9a36a8954b0601a60e47b9fd5a1aaa7afb4f01dc89a`,
release `241b5d61180e6c1707579df5ab09ed8d28d2fc212147a224217182e2d61c560b`,
and dirty-source digest
`ba27a8015d60b99a5e5387dc0d6bf4787431cd87d4b573c76ac42095b3908e91`.
Both used CfT 151.0.7922.34 with executable SHA-256
`409805a16d6416087e6b2f778df1cf8f7bbb267d6b99f6b5bb0a618eace234f2`
and passed the same five lifecycle/lock verdicts. These are bounded synthetic store
adapter comparisons, not D-133 transfer qualification or performance evidence.

The visible pinned-Chrome calibration then passed on 2026-07-29. Retained result
`installer-transfer-calibration-v1-2026-07-29T12-45-30-495Z.json` has SHA-256
`9afbc10aecda989883883ff499841444b399c14d7dd30c0b4600f8073a357e9e`;
its Markdown SHA-256 is
`9dd50ee60b9b8a652a5e0ac61c0bee714323a491a3175f0d2ca8f1e36f0b1e72`.
It binds source
`7fdc5465b5903751301a4e319a160848eacefac6/6b3702e6f0bb03ebcc509cf36aa2655c8696bc654a8e6e0617e516540700dd1f`,
artifact
`c3e3067afadbf0246d8670ddb455b405c9557d55f49a4e9154f60eda570c8015`,
release
`cc6e640634389d1df83c3297bfba151ed97be2b6f47a94cf72b96ba09b88b2df`,
and the same CfT executable identity above on local, non-remote dev-01. The four
33,554,432-byte same-origin resources had exact SHA-256/strong-ETag identities
`f0831efe09084904341b63163c4801665f7d1bca9fd7cea53ef901a9beef3556`,
`2168710c42c12b4a2a0dcfa872c84f2a6d41de459f4f1a1b958622c081b4b280`,
`8bbb6cdf3ea86325592e15ae03efad41269e1ddd7a9b14fbc27d7198c74ddfcc`,
and `42b67752331b15863260ca5f6997d442f2044ba3fa16b1bec93aed9638c763f9`.

All 36 warmup/measured trials proved a clean install-store root before and after,
downloaded all 134,217,728 bytes with four 206 requests, reused zero bytes, and
reported zero retry, transport, validator, correctness, or protocol failures. Passing
cells were c1-mib1 (6,969,500 B/s median; 3.30% range), c1-mib4 (13,977,191 B/s;
2.61%), c1-mib8 (16,472,212 B/s; 4.12%), c2-mib1 (6,908,426 B/s; 4.69%), c2-mib4
(13,970,194 B/s; 5.28%), and c4-mib1 (6,765,376 B/s; 2.18%). c2-mib8, c4-mib4, and
c4-mib8 failed only the predeclared repeatability gate at 13.93%, 16.57%, and 20.06%.
The best passing median was c1-mib8; its 15,648,602 B/s eligibility floor and the
declared tie-break therefore select concurrency 1 / 8 MiB. This is a bounded
ready-throughput policy selection, not a general network or OPFS throughput budget.

D-099's ignored
`d099-installer-transfer-calibration-6b3702e6f0bb-reconstruction` bundle captures the
complete dirty source. Manifest SHA-256
`ad1272ccdef9dd1d4800de396d58ae818efcbab928e3d20baa0f65c7cf018274`
and verification SHA-256
`baa3e26910865ee04ad207d97af9b18e42eb83d168d6824081423f0b84db2aab`
record clean-scratch reconstruction of both source-identity fields; its untracked
snapshot is archived with SHA-256
`ccbb7935cbe28e437c19f8405212bc432927c2d9b1e5fa3df94eec052d18a547`.
The
calibration-only runner, server, synthetic generator, command, and fixtures are
removed. After reconstruction, root rule 12 cleanup also removed the schema-v1 Markdown
formatter and synthetic/adversarial envelope apparatus. A later root rule 12 pass removed
the independent calibration validator and its SHA-pinned exact check because no live
import or recurring gate consumed them. The ignored retained result, D-099 reconstruction
records, and hashes and conclusions documented here remain the historical evidence.

The selected constant changes the post-calibration product identity, so the result's
pre-selection artifact above is not relabeled. The cleaned production candidate builds
as artifact
`9ad57a71c8d3ea73cb202df5fa461f7240d7bc9346125ccb28b6885ba6e78473`,
release
`9cc1a3bcd559e016864e6d3eea8d7bddcab6757888493188c8f94fd85faca6c5`,
and installer worker
`c4e32b6648e3a4973043629b923c65a6d9b30a6043cd57e118285c3a9d672e05`
(123,450 bytes). Full `pnpm check` passed 87 files / 779 tests, and an explicit
independent repeatability build reproduced every engine/worker/Wasm output. This
post-selection candidate was the input to the then-pending interruption/lock
qualification; no calibration metric is transferred to the new artifact.

The first production-path interruption qualification attempt is retained as failed,
not retried. Result
`installer-transfer-qualification-v1-2026-07-29T13-21-17-338Z.json` has SHA-256
`c7d825293585dc144bb8a3bd355cf0164715c63583017c26b4c62dc7c3e2c793`;
its fail-honest Markdown has SHA-256
`beaccda76c9a79a06a440ab980f58c0915d1e58feaf4ffa4221fef7bdd74bfdb`.
It failed before any synthetic resource request because the production worker resolved
the relative `install-manifest.json` entrypoint against its own hashed
`/immutable/installer-worker-*.js` URL instead of the already fixed root
`/build-manifest.json` URL. The measured artifact was
`9ad57a71c8d3ea73cb202df5fa461f7240d7bc9346125ccb28b6885ba6e78473`,
release
`9cc1a3bcd559e016864e6d3eea8d7bddcab6757888493188c8f94fd85faca6c5`,
and dirty source
`118aa26b34bd8c2b42d334e8c10a07e9f03e45872d1037921d4817a23511a3dd`.
The narrow correction derives one canonical root from the fetched build manifest and
uses it for both the exact install-manifest entrypoint and every relative transfer
source; neither may inherit the hashed worker directory. Hostile entrypoints and
non-canonical build URLs fail closed, and the hashed-worker integration regression
asserts exact root `synthetic/...` and `immutable/...` URLs without doubled path
segments. Its corrected deterministic artifact/release/worker identities are recorded
as artifact
`ab2674968dbd7e7d64ee85f7d0d02a68c1d2e7b4b6bedba97f439d759c3952a9`,
release
`995a1c9a99af1e0c4f1f22ff0571607caeae0c830f21bdc79311936d7a1ab630`,
and installer worker
`114c72048fac628e993faf7bf639da0c8814b52d736644fb5cf26eeac7f887ba`
(124,236 bytes). Full `pnpm check` passed 88 files / 815 tests and the explicit
independent repeatability build reproduced every engine/worker/Wasm output. It required
independent review before the single corrected qualification attempt described below;
no unreviewed Chrome retry ran.

That single independently authorized corrected qualification then passed. Retained
result
`installer-transfer-qualification-v1-2026-07-29T13-32-09-126Z.json` has SHA-256
`9300dd554fbbe0e5fd1f7cb2285706949c81a3190f050392f057725117353627`;
its Markdown SHA-256 is
`882ba0a1ee5d5123937902d1c129925bcfd8607e001bd09240ca125fd22f20f8`.
It binds corrected artifact/release above, source
`7fdc5465b5903751301a4e319a160848eacefac6/83f7d4b8788efc4f6407a84f816f7186cc348408e07230d84ed37b4280e7cf0f`,
CfT 151.0.7922.34 executable
`409805a16d6416087e6b2f778df1cf8f7bbb267d6b99f6b5bb0a618eace234f2`,
normal sandbox, local non-remote dev-01, and one profile retained across the abrupt
restart.

Scenario A killed the full Chrome process tree only after the exact 8,388,608-byte
durable checkpoint. The initial `bytes=0-` request had no `If-Range` and aborted; after
visible Chrome relaunched on the same profile, the first request was exactly
`Range: bytes=8388608-` with persisted
`If-Range: "sha256-ad1ad62ba82a32b066f442bdf5891e4bf03835b6c156a3960b873aece8e16f9d"`.
The resumed worker made one 206 request for the remaining 25,165,824 bytes, recorded
8,388,608 resumed bytes, and finished the exact 33,554,432-byte object ready with
active/previous still null. Scenario B observed one held and one pending exclusive
transfer lock. Client one downloaded the exact 33,554,432 bytes in one range request;
client two waited 4,386.965 ms, issued zero resource requests, reused all 33,554,432
bytes, and returned the same ready release. Both scenarios had zero retry, transport,
validator, or integrity failures; final lock state was empty and both 750 ms
post-result quiet windows were mutation-free.

D-099 independently reconstructed both dirty measured sources. The failed-source
bundle manifest/verification/archive SHA-256 values are
`9707eb44e95c8826c103017e4d9ae7aeba7a91f94d8e124eea24c6c169dff169`,
`f85b0479fca0e3ca15fa77395fc97d351f13050b8fe39fec2cb20f9e6ac230c1`,
and `0eed270329b0e3e03520113087c2e0703748c5c714163bf5ad10aed0f3f908e7`.
The passing-source bundle values are
`ff2483c4f1800ce548f9233f8050cf3d74ab2897c9ea1b40c8c1b7959481162a`,
`b77a31a8444f837c812a53856798c8817683da7a220ac96ab78b119e2ac34f15`,
and `1356e49ad8a109b4d751a5f72032d3b6420ebf7b427fbc43bc902b05dd1a9119`.
The qualification runner, paced server, synthetic generator, command, and fixtures are
removed after reconstruction. Root rule 12 cleanup also removed the schema-v1 Markdown
formatter and synthetic/adversarial envelope apparatus. Later root rule 12 cleanup
removed the independent qualification validator and its retained-file tests as closed
experiment apparatus too; no live import or recurring gate consumed them. The ignored
failed and passing result files, D-099 reconstruction records, and the hashes and
conclusions documented here remain the historical evidence. The calibration apparatus
was removed on the same rule 12 boundary. This is bounded 32 MiB
interruption/lock evidence, not power-loss, production/multi-GB completion, persistence,
publication, consumer migration, update/offline, disk-full, or 100 GB evidence. D-133 is
accepted by the final review recorded under D-134.

**Consequences:** The deterministic implementation can transfer an exact staged release
to ready without changing current consumers or activation state. Quota estimation is
explicitly best-effort: required peak is missing download bytes plus the largest
unverified copy-before-publish resource plus a fixed metadata reserve, followed by a
1 MiB flushed write/remove probe. An incomplete estimate does not manufacture a
failure; a clearly insufficient complete estimate or actual `QuotaExceededError`
fails while preserving durable checkpoints. The worker observes but never requests
persistence. Store-call failures are terminal rather than network-retry candidates:
`QuotaExceededError` retains its typed DOM exception for quota classification, while
other store faults use a typed terminal store error without message-text inference.

This accepted decision claims the bounded calibration, 32 MiB browser
interruption/lock qualification, and passing schema-v55 production smoke above, but no
installer-driven multi-GB model completion, persistence
grant/denial UX, power-loss or browser/OS-crash behavior, disk-full UX,
publication/update/rollback, consumer migration, service-worker or offline behavior,
uninstall, or 100 GB scale behavior. Installer UX and M2 remain open.

**Reopen if:** browser qualification exposes a protocol/storage/lock defect, the source server cannot sustain
the exact D-131 range/validator contract, Web Locks termination semantics change, OPFS
checkpoint durability evidence changes, or later activation/consumer work requires a
different ready boundary.

## D-132: Retain the corrected production model-source qualification as passed (2026-07-29, accepted)

**Decision:** Accept D-130's five exact self-hosted model resources and D-131's
response-specific HTTP contract as qualified for the bounded production-source gate.
The retained schema-v1 result is
`model-source-v1-2026-07-29T11-24-32-356Z.json` (SHA-256
`a305386877336b5d3083a78c1d28d2b514e0a0ed34d5aafe67500ed058676de4`;
Markdown SHA-256
`7152a0a92ea43e5da2809ffc2c5f64679d52c9759e5d4ba79740e6bc745af2c9`).
It passed from 2026-07-29 11:24:32.356–11:24:36.883 UTC against artifact
`108aee08e703a72c387a7766d0debad57fc07495c80141939a09380fe77ccb1c`,
release
`7eda948c4f28f10ffee048fa3ee5f442efb8444054bf09ecbc740467feb7176c`,
and source
`7fdc5465b5903751301a4e319a160848eacefac6/ba3be3021765f89600e435ca2ad9eaf95eeb9d85ef72fd3c83a764650ba5508a`.
The command used Node v24.18.0 (executable SHA-256
`9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de`).

The retained schema-v1 file is historical evidence under its recorded digest; current
code does not routinely parse or emit that host-path-bearing schema. D-130's corrected
implementation emits schema v2, which identifies the local source logically and
records only the Node executable basename plus its digest. This migration does not
rewrite or relabel the retained D-132 evidence.

The result binds all five resources and their exact 2,620,371,552-byte total from
local source through the fixed `plex:/var/www/parallax-web.com/immutable` filesystem
boundary. The webroot and immutable directory were UID/GID 1000/1000 and mode 0755.
Each exact final object was a regular, non-symlink file with its D-130 byte length and
SHA-256, UID/GID 1000/1000, and mode 0644. The installed nginx identity was separately
adjudicated after the rollback-safe human-admin install: the reviewed local include
SHA-256 was
`df7f4a41d9e4625acc5065550b574cdc5d29ae8a31bd309a164f3dca1230ba89`;
`/etc/nginx/sites-enabled/parallax-web.com` resolved to
`/etc/nginx/sites-available/parallax-web.com`; that resolved active file was regular,
root/root, mode 0644, and had the same SHA-256; nginx was active. No ownership or mode
claim is made for the symlink itself.

Public HTTP then passed all 25 bounded requests: five HEAD 200 responses, five
matching-`If-Range` 206 responses, five stale-`If-Range` full 200 responses cancelled
before reading body bytes, five plain one-byte 206 responses, and five unsatisfiable
416 responses. The successful range bodies totaled exactly 10 bytes. The five bounded
416 representations totaled 985 bytes. Each resource retained its strong ETag across
HEAD, matching range, stale `If-Range`, and plain range. Full HEAD 200 responses used
immutable caching and advertised byte ranges; every request carrying `Range` used
`no-cache`; 206 responses bound exact one-byte `Content-Range`/length/body; and 416
responses bound the exact unsatisfied `Content-Range`. No full model representation
was downloaded over HTTP.

**Context:** This is an evidence-only closure of the exact D-130/D-131 candidate and
does not alter runtime, config, harness, schema, thresholds, or evidence semantics.
D-131's earlier
`model-source-v1-2026-07-29T04-44-24-184Z.json` failure remains failed under its
recorded identities and digests. It stopped at the first shard's invalid blanket 206
header expectation before the corrected include was installed; the later pass neither
relabels nor erases it.

**Consequences:** The model-source provisioning prerequisite for the later transfer
executor is closed. This decision does not claim a production app deployment,
installer runtime, OPFS transfer or resume, storage persistence or quota behavior,
consumer migration or UI, Chrome/runtime/performance/D-097 qualification, a full HTTP
model download, interruption recovery, update/rollback behavior, or offline behavior.
Installer UX and M2 remain open. The installer worker/network transfer-resume executor
moves to D-133 or later.

**Reopen if:** any pinned resource identity or production path changes, the active
nginx include or response behavior changes incompatibly, the production filesystem
identity no longer meets D-130, or the transfer executor requires a stronger source
contract than D-131 qualified.

## D-131: Select immutable caching by request shape and validate range responses by HTTP semantics (2026-07-29, accepted)

**Decision:** Amend only D-130's production cache selection and model-source HTTP
evidence semantics. The nginx map key is now
`"$status:$http_range:$uri"`: an exact immutable path receives
`public, max-age=31536000, immutable` only for an ordinary full 200 or conditional
304 with no `Range` request header. Every request carrying `Range`, including a stale
`If-Range` request that resolves to a full 200, uses `no-cache`; 206 and 416 are
required to use `no-cache`. The config does not force `Accept-Ranges` onto responses.

The schema-v1 model-source result retains the same five request kinds and bounded-body
policy but validates each response kind separately. A full 200 must advertise
`Accept-Ranges: bytes`, bind exact Content-Length, type, security headers, no content
encoding, and the same strong ETag. A 206 must bind the exact one-byte
Content-Range/Length/body, type, security headers, no content encoding, and the same
strong ETag; `Accept-Ranges` may be absent or `bytes`, but no other value is accepted.
A 416 must bind only its status, exact unsatisfied `Content-Range`, bounded body, and
semantic `no-cache` policy. Its error representation may be HTML, omit ETag and
`Accept-Ranges`, and omit or duplicate security fields. Nullable result fields preserve
that observed absence rather than inventing successful-response metadata. Repeated
identical `no-cache` directives are evaluated as one semantic policy; conflicting
directives still fail. The command's outer boundary converts any rejected verification
to process exit code 1 after the inner lifecycle has atomically retained failed JSON
and best-effort Markdown.

**Context:** The first post-upload command is retained failed at
`model-source-v1-2026-07-29T04-44-24-184Z.json` (SHA-256
`55b502869608647d310cd73c4be575535fc90e234e0dd0f10fd8dae06b228f6a`;
Markdown SHA-256
`bde285de3171fd41782e01f42e37d184ccd43b5246333805c60e8489bcceb31e`).
It records artifact
`108aee08e703a72c387a7766d0debad57fc07495c80141939a09380fe77ccb1c`,
release `7eda948c4f28f10ffee048fa3ee5f442efb8444054bf09ecbc740467feb7176c`,
and source
`7fdc5465b5903751301a4e319a160848eacefac6/ca2628ebc63e62467d6606ef2f6089120c611008fa1a03ed49b6f66a9d74a377`.
It bound exact remote SSH identity and then stopped on the first shard's `range-0-0`
blanket header mismatch. It did not record the later response shapes and is not
relabeled.

A separate operator probe from 2026-07-29 04:44:33–04:44:54 UTC observed that shard's
actual transport. HEAD returned 200 with `Accept-Ranges: bytes`, a strong ETag,
`application/octet-stream`, and immutable caching. Plain and matching-`If-Range`
one-byte requests returned 206 with exact `Content-Length: 1`,
`Content-Range: bytes 0-0/23532320`, the same strong ETag, no content encoding, no
`Accept-Ranges`, and immutable caching. The unsatisfiable request returned 416 with
`Content-Range: bytes */23532320`, a 197-byte HTML body, no ETag or `Accept-Ranges`,
and duplicated identical immutable/security fields. Stale `If-Range` returned a full
200 with `Accept-Ranges: bytes`, the same ETag, and immutable caching; the probe aborted
it before downloading the full representation. This raw operator observation explains
the correction but is distinct from the failed JSON evidence.

RFC 9110 sections
[13.1.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5),
[14.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.3),
[14.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.4), and
[15.3.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.7) distinguish
`If-Range`, range advertisement, 206 representation metadata, and the recommendation
that a 416 include an unsatisfied `Content-Range`; Parallax deliberately makes that
field mandatory for this production contract. They do not make every
successful-response field a 416 requirement. The nginx
[`map` documentation](https://nginx.org/en/docs/http/ngx_http_map_module.html)
supports a source string composed from multiple variables, while the
[core-module documentation](https://nginx.org/en/docs/http/ngx_http_core_module.html)
documents static-resource ETag generation and byte-range handling. Checked
2026-07-29.

**Consequences:** D-130's self-hosted identities, upload/deploy guards, manifest
contract, and SSH evidence remain accepted. Its claim that the status-only cache map
already had the required behavior is superseded. The corrected nginx include requires
the existing human-admin rollback-safe install/reload step before the source command is
rerun. The retained failure remains evidence; a later pass must use the corrected
config and current reviewed verifier. This adds no installer worker, Chrome run,
performance result, or D-097 qualification. D-132 retains the corrected production
qualification as passed; the installer transfer executor moves to D-133 or later.

**Reopen if:** production or an intermediary changes 200/206/416/If-Range behavior,
the installer chooses a cache mode that depends on response caching, or a future
content origin requires a different range/cache contract.

## D-130: Self-host the exact generated GGUF shards as immutable install-only resources (2026-07-29, accepted; cache/evidence semantics amended by D-131)

**Decision:** Supersede only D-128's model-source provisioning. The five D-074/D-096
resources keep their exact IDs, kind, common scope, OPFS target, byte lengths, hashes,
and 2,620,371,552-byte total, but their sources are now same-origin
`immutable/model-<sha256>.gguf`. Install-manifest remains v1 and build-manifest remains
v12. These are install-only pinned resources: they are served from the production
webroot but remain absent from `dist`, the build-artifact inventory, and ordinary
target preflight's full-artifact fetch. Independent engine and harness validators
require the current build's resource inventory to equal the derived local artifacts
plus those exact five source paths; an unknown sixth HTTPS or same-origin install-only
resource and any collision with a normal build artifact fail closed. The generic
document parser remains able to validate future manifest shapes without weakening this
current-build policy.

`deploy/model-content.json` v2 binds the exact logical five-shard set and the source
identity `gemma-4-E2B-it-qat-GGUF-66a399f6` under registry key
`production-model-content`; it contains no host path. The ignored
`.parallax-toolchain.local.json` maps that key and exact version to the machine-local
directory. The production deployer and model-source verifier use one bounded resolver
that requires the checkout-bound registry schema, exact key/string types, an absolute
canonical existing directory, and no reparse-point ancestor; missing or malformed
state fails closed.
The ordinary production deployer independently parses the hash-verified built
install-manifest before any remote preview or mutation and requires its complete
kind-model projection (ID, kind, common scope, OPFS target, canonical same-origin
source, bytes, and SHA-256) to equal that validated deploy contract. Missing, extra,
duplicate, noncanonical, or drifted model entries fail closed; the independent harness
install-manifest and persisted-result pins remain separate validation witnesses rather
than importing the deployer's implementation constant.
`pnpm deploy:model-content` is a fixed-host/fixed-path, preview-by-default Windows
operation. Before any remote mutation it streams and verifies every local byte/hash and
requires every managed shard to be present. The later fixed package interface exposes
mutation only as `pnpm deploy:model-content:apply`, whose fixed no-argument wrapper
invokes the bounded deployer in the same PowerShell process with real `Deploy` and
disabled `Confirm` switch values. The corresponding app commands are
`pnpm deploy:production` and wrapper-backed `pnpm deploy:production:apply`; neither
apply package script uses pnpm argument forwarding or exposes a configurable target.
The approved underlying deploy mode reuses D-121's owner, permission, non-symlink, inode,
mount-confinement, and exclusive-lock guards; each missing or wrong object is copied
into the private lock directory, remotely size/SHA-256 verified, chmodded, and only
then moved to its final immutable name. The guarded webroot supplies the required
UID/GID; the immutable directory and final files must retain that ownership with modes
0755/0644. Safely owned wrong modes may be normalized only through the fixed apply
command. Wrong ownership, unsafe final types,
or unexpected `model-*.gguf` objects block the operation. The exact inventory is read
again under the owned lock before normalization or upload, so stale preview state is
not trusted. It never deletes an unexpected object to make the check pass. Lock cleanup
removes interrupted private uploads.

Ordinary production replacement now requires all five remote objects to be exact
before destructive mutation. Preview reports a blocker when they are absent, wrong,
unsafe, or accompanied by managed-prefix extras. During an approved app deployment,
the exact type/UID/GID/mode/byte identities are re-read under the owned lock and
reasserted after the webroot is made and verified 0700 and before the objects move into
the private lock. The ordinary webroot replacement runs, and
the objects move back before public permissions are restored. Failure cleanup restores
any already-preserved objects before any permitted lock release; a failure after the
webroot becomes private instead retains that owned lock for manual recovery. Final
verification requires the exact union of the frozen `dist` inventory and these five
regular files, including
their guarded UID/GID and 0755/0644 directory/file modes, with no other remote entry.
This keeps the app deployer from erasing model content and keeps the model uploader
from touching ordinary `dist` children.

`pnpm harness:model-source-verification` is the bounded post-upload evidence command.
It records JSON-primary schema v2 in a strict pending state before remote access. Its
local evidence uses `production-model-content/<shard-name>` rather than a host path,
and its Node identity uses the executable basename plus digest. Retained schema-v1
D-132 artifacts are historical-only and are not accepted by the current validator. A
fixed `ssh.exe plex` preflight hashes and stats the exact
`/var/www/parallax-web.com/immutable` five-file set; it establishes full remote byte
identity plus regular-file/non-symlink UID/GID/mode identity and must pass before any
HTTP request. HTTP then proves only public transport behavior. For each shard it checks
final URL, status, headers, Content-Length/Range, strong ETag, no Content-Encoding, and
downloaded bytes for HEAD, `bytes=0-0`, an unsatisfiable range, matching `If-Range`,
and stale `If-Range`. Exactly two successful one-byte bodies are read per shard
(`bytes=0-0` and matching `If-Range`); HEAD reads none, the 416 body is bounded, and
the stale-validator 200 body is cancelled immediately with zero downloaded bytes.
Strict discriminated pending/passed/failed envelopes are independently validated
before and after atomic JSON replacement, and state-honest Markdown is derived from the
final envelope. This command is deliberately not run before model publication.

**Context:** A bounded read-only check at 2026-07-29 03:35–03:37 UTC found that all
five D-128 Hugging Face `resolve` URLs returned `404 EntryNotFound` for HEAD, the
range cases, and both `If-Range` cases. The pinned upstream revision contains the
2,620,370,976-byte unsplit GGUF, not Parallax's five locally generated
`llama-gguf-split` outputs. All five local outputs re-hashed to their recorded
identities. This is an asset-provisioning error, not a browser/platform finding.

The installed D-121 nginx include accepts these names as immutable resources, serves
byte ranges, and exposes strong ETags without content encoding. D-131 supersedes
D-130's incorrect claim that no config change was required: the status-only cache map
made range-request 206/416 and stale-`If-Range` 200 responses immutable, and the
blanket verifier incorrectly required successful-response headers on 416.

The deterministic implementation candidate contains 277 listed artifacts totaling
10,846,956 bytes. Its build-manifest SHA-256 is
`108aee08e703a72c387a7766d0debad57fc07495c80141939a09380fe77ccb1c`;
its install-manifest/release SHA-256 is
`7eda948c4f28f10ffee048fa3ee5f442efb8444054bf09ecbc740467feb7176c`.
Two consecutive full builds matched both identities and the independent engine/Wasm
repeatability gates. These identify the uncommitted local implementation, not uploaded model content,
deployed application bytes, or HTTP verification evidence.
The read-only model-deployment preview streamed and accepted all five local identities
and reported all five remote final paths missing; the ordinary app-deployment preview
reported the corresponding destructive-deploy blocker. Neither preview made a remote
mutation.

**Consequences:** The later transfer executor has a same-origin resumable source
contract, but model upload and the bounded HTTP verifier remain explicit operational
steps after review. This project adds no installer worker, UI, OPFS transfer, consumer
migration, production upload, app deployment, Chrome launch, performance claim, or
D-097 qualification. Installer UX and M2 remain open; D-132 retains the corrected
production qualification as passed, and the installer executor is D-133 or later.

**Reopen if:** the fixed production origin cannot store the selected model, the exact
model/revision changes, production range/validator behavior fails the bounded verifier,
or a separately reviewed content origin provides equivalent immutable identity and
resume semantics.

## D-129: Use validated append-only records for the OPFS release store (2026-07-28, accepted)

**Decision:** Add the crash-safe `parallax-install-v1` OPFS release store as a bounded
engine subsystem. Common objects live below `objects/common/sha256`; Parallax-specific
objects live below `objects/games/parallax/sha256`. Equal hashes never alias across
those physical namespaces. The store consumes D-128's exact install-manifest bytes and
uses their SHA-256 as the release directory and identity.

Release state is derived only from exact, newline-terminated immutable v1 records:
verified-object, partial-checkpoint, staged, ready, published, commit, and abandoned. Every parser
requires exact keys, safe integers, lower-case SHA-256, and filename/body identity.
Large partials use bounded sync-access-handle appends followed by `flush()` and a new
immutable checkpoint, retaining the newest two checkpoints per transfer. Recovery
selects the highest valid checkpoint no greater than
the file size and truncates any uncheckpointed tail. Finalization incrementally hashes
the complete partial, copies bounded chunks into its hash-addressed object, re-reads and
re-hashes the exact object, and only then publishes the verified marker. Any previous
marker is removed before object mutation; missing or failed full verification removes
it as well. A marker plus
exact data size is sufficient for ordinary startup metadata reconciliation; the
explicit integrity API streams and re-hashes bytes to detect same-size corruption.

Ready is not active. Publication appends a uniquely named
`<20-digit ordinal>-<releaseDigest>.json` commit. Active is the highest valid commit
whose manifest, ready record, and every OPFS object remain eligible; previous is the
next lower valid commit for a different release. Torn/ineligible newer commits are
ignored. Rollback appends a new commit for previous. If record close completed but its
caller did not observe success, recovery may accept the fully valid record; it can
therefore observe old or new state, never a mixed release. No mutable status/pointer
file exists. Selection work is bounded in steady state by retaining the newest 64
ordinals plus active/previous anchors. An immutable published marker distinguishes
obsolete published releases from ready-but-unpublished content after older commits are
compacted; reconciliation repairs that marker if a commit close completed first.
Abandonment is terminal, is allowed only before ready, and is rejected for ready,
committed, active, or previous releases. Once abandoned, release-scoped resource lookup
and both object/release integrity APIs reject, including a reference issued before
abandonment.

Every mutation and reconciliation uses one origin-wide exclusive Web Lock named
`parallax-install-store-v1`; absence of Web Locks fails closed and there is no lease,
timeout stealing, or `steal:true`. Reconciliation never auto-activates ready content.
Garbage collection is deterministic, bounded, resumable, and rooted by active,
previous, and every non-abandoned in-progress release. It never leaves
`parallax-install-v1`, so saves and the existing streaming/model-cache roots are out of
scope. Its entry limit is one shared mutation budget: published-marker repair occurs
before commit pruning, then remaining budget may remove ordinary GC candidates.
Reported removal entries/bytes and remaining work include commit cleanup exactly.
Reconciliation accepts an explicit cleanup budget including zero and reports cleanup
mutations, removal entries/bytes, and remaining work; a zero cleanup budget performs no
metadata repair or pruning. Repair eligibility that binds or purports to bind the
unique newest commit remains strict fail-closed authority, and ambiguous newest-commit
authority is rejected without deleting its evidence. Superseded, orphaned, torn, or
manifest-less non-current repair records are deterministic reconcilable garbage under
the same budget; zero retains them with remaining work, while removal contributes exact
mutation, entry, and byte counts. A durable current repair record independently makes
that release ineligible, including at ordinary active admission while a crash-retained
verified marker remains. Reconciliation validates every current-authority claim before
mutation; marker revocation consumes one shared-budget removal mutation and its exact
entry/byte counts. A zero budget retains that marker and reports remaining repair work.

The platform policy is independent of DOM handles. A browser adapter and persistent
deterministic in-memory filesystem cover exact reads, record replacement, bounded
append/truncate/flush, listing/removal, locking, torn/short/quota faults, and restart
reconstruction. Its shared FIFO mutex queues contenders, and reconstructing a facade
cannot clear a live owner. Fault tests cover stage, checkpoint recovery, exact-size
interrupted repair, finalization boundaries, torn publication, rollback, cross-scope
identity, bounded metadata/GC, abandonment, confinement, and observer faults. The
real-Chrome adapter exercise imports the adapter/store implementation from the exact
D-129 build and stages a synthetic one-resource release through
publication/reopen/reconciliation, two-store/two-worker serialization through the
adapter's hard-coded lock, and queued progress after the owning worker terminates. Each
contender acknowledges immediately after submitting its Web Lock request, and the
runner waits for that acknowledgement before either the quiet window or owner
termination. It retains pending then passed/failed machine-local JSON plus a
human-readable report with browser, imported build-artifact, recorded production
build-manifest release, and dirty-source identities. That production release identity
is result/build provenance, not the staged OPFS release.

The retained result
`harness/results/opfs-release-store-adapter/adapter-v2-2026-07-29T03-23-51-061Z.json`
(JSON SHA-256
`370a724f18d9aec361cc9de93636c588b3965e62cd284fdcfe508534a35005fd`;
Markdown SHA-256
`7a8fd5c8f76cc0e8e4d72952ade3e29eb7534b480c2b88bef519800f4d4083c3`)
passed in 1.728 seconds. All five evidence fields were true:
`blockedBeforeRelease`, `firstFinalization`, `lifecycle`,
`reopenReconciliation`, and `terminatedOwnerReleasedLock`. The runner imported the
adapter/store implementation from artifact
`5404dcd3299f5fd03564907d5002ba6b5a1e26f57089cc349370ba18a84b6f51`,
and the result recorded production build-manifest release identity
`79f9f463f84a55e072945851ad705f1089b2a868227a68d8cfac5f96fda98ef9`,
source
`7fdc5465b5903751301a4e319a160848eacefac6/f1136b8a32977ebb0243b366de95b30eef0cd62e17874ef3d619408e8dc0cc6f`,
and Chrome 151.0.7922.34 executable SHA-256
`409805a16d6416087e6b2f778df1cf8f7bbb267d6b99f6b5bb0a618eace234f2`.
The recorded production `releaseDigest` is result/build provenance, not the digest of
the synthetic one-resource release staged by the browser exercise. This is bounded
proof of that small real-OPFS split-checkpoint/resume lifecycle through first
finalization, verification, ready/publication, reopen/reconciliation/reverification,
fixed Web Lock exclusion across workers, and a queued waiter proceeding after owner
termination. It is not evidence for power loss or browser/OS crash, torn real writes,
multi-GB transfer, network, quota, persistence, real update/rollback, production,
performance, registered-environment identity, or D-097 qualification.

**Context:** Current primary sources were checked 2026-07-28. The
[File System Standard](https://fs.spec.whatwg.org/#api-filesystemfilehandle-createwritable)
says implementations only “try to ensure” old-or-new contents for `createWritable()`,
while sync-access writes require explicit flush for reflected changes. Chrome's
[OPFS documentation](https://web.dev/articles/origin-private-file-system) documents
file `move()`, but gives no atomicity guarantee, and the
[WHATWG move proposal](https://github.com/whatwg/fs/pull/10) remains open with
concurrency/handle questions. Therefore `move()` is not a release commit primitive.
The [Web Locks draft](https://w3c.github.io/web-locks/) defines same-origin
window/worker exclusion and releases an agent's locks when that agent terminates.

**Consequences:** Runtime store parsing validates the exact self-authenticating manifest
document, while D-128 build/harness validation continues to enforce the full local
inventory and five pinned model shards. This permits bounded protocol qualification
fixtures without weakening production build identity. Install-store telemetry starts
at schema v1 with state, selection,
inventory, byte-flow, integrity/quota/recovery/publication/rollback/GC counters, current
work, duration, and failure. Public telemetry advances to v28 and initially reports the
store explicitly `unavailable`; the later installer worker will forward live snapshots
without opening OPFS on the app main thread. Smoke advances to report schema v53,
flythrough to v20, and render recovery to v17. Their mandatory metric sets, populations,
thresholds, and budget semantics do not change.

The deterministic reviewed candidate contains 277 deployed artifacts totaling
10,847,344 bytes. Its build-manifest SHA-256 is
`5404dcd3299f5fd03564907d5002ba6b5a1e26f57089cc349370ba18a84b6f51`;
its install-manifest/release SHA-256 is
`79f9f463f84a55e072945851ad705f1089b2a868227a68d8cfac5f96fda98ef9`.
Two same-host full builds matched those identities and the existing independent engine
and Wasm repeatability checks. They identify this uncommitted candidate, not deployed
or physically qualified production.

This project adds no network fetch, installer UI, `persist()` request, shell/service
worker activation, current streaming/model consumer migration, update policy, uninstall,
deployment, baseline promotion, or physical qualification. Installer UX and the broader
installer trust/crash-safety checkbox remain open; the installer worker/transfer
executor is the next project. Reopen the publication primitive
only with current specification guarantees plus an interrupted-operation Chrome
experiment; implementation convenience alone is insufficient.

## D-128: Bind M2 installation to install-manifest v1 and build-manifest v12 (2026-07-28, accepted)

**D-130 supersedes only the five model source URLs; all other D-128 schema, identity,
classification, placement, and dual-digest decisions remain current.**

**Decision:** Introduce deterministic `install-manifest.json` schema v1 with exact
top-level keys `gameId`, `resources`, and `schemaVersion`; `gameId` is `parallax`.
Every resource has exactly `bytes`, `id`, `kind`, `scope`, `sha256`, `source`, and
`target`. Scopes are `app-shell`, `common`, and `game-specific`; targets are `shell`
and `opfs`; kinds are `document`, `module`, `worker`, `wasm`, `model`,
`district-index`, `world-cell`, and `asset-pack`.

Build-manifest v12 references it through the singular exact
`installManifestEntrypoint: { path: "install-manifest.json", schemaVersion: 1 }`.
The install manifest is an ordinary build artifact, but does not list itself. Its
artifact SHA-256 is the explicit `releaseDigest`; it therefore avoids a self-reference
while binding every other production artifact and every external install resource.
The `build-manifest.json` SHA-256 remains the compatibility-preserving
`artifactDigest` and continues to identify the exact serving inventory and
entrypoints. Local/production target preflight verifies both identities independently.

The current mapping is exact:

- `index.html` and the app module are `app-shell/shell`;
- the engine module, four workers, and runtime/decoder Wasm are `common/shell`;
- the game module is `game-specific/shell`;
- the generated district index and 256 world cells are `game-specific/opfs`;
- D-074/D-096's five exact pinned GGUF shards are external HTTPS
  `common/opfs/model` resources totaling 2,620,371,552 bytes.

Resource IDs are stable lower-case semantic IDs derived from role or unhashed logical
path, while SHA-256 is object identity. Common and game-specific OPFS namespaces remain
distinct even when a future storage implementation addresses their bytes by hash.
The engine owns the canonical browser-side parser. The harness has an independent
parser and independently pins the five model identities. Both reject unsupported keys,
types, placements, unsafe IDs/paths/integers, unsafe HTTPS URLs, duplicate IDs,
sources, or hashes, ordering drift, aggregate overflow, incomplete or swapped local
classification, build-metadata mismatch, and model drift. Build validation
independently derives exact app/engine/game/worker/Wasm/district/cell classifications
instead of trusting install-manifest labels. Build validation also preserves the exact
four-worker and district-index invariants. The streaming worker pins the exact v12
entrypoint shape before consuming it and rejects empty/unsafe or duplicate district
IDs/paths, duplicate artifact paths/hashes, a missing install-manifest artifact, and
any district path absent from the exact artifact inventory. That streaming-consumer
validator deliberately leaves worker-role validation and full served-tree byte
inventory to their owning runtime consumers and the independent harness validator;
the selected district body is fetched and validated immediately afterward. The
production deployer invokes the compiled independent harness validator against the
frozen local tree before remote mutation;
external model resources are deliberately absent from `dist`, deployment inventory,
and the production target's full-artifact fetch.

**Context:** M2 needs one deterministic contract before implementing resumable OPFS
writes or installer state. The prior build manifest was a serving inventory, not an
install plan. A separate listed install manifest can express external model shards
without either deploying them or conflating remote install resources with served
files, while preserving the established build-manifest `artifactDigest` semantic.
D-010 also requires the common/game split before a future COS index exists.

The first generated candidate contains 281 resources: 2 app-shell, 21 common, and 258
game-specific; 19 shell and 262 OPFS. Scope bytes are 18,351 app-shell,
2,629,905,218 common, and 1,096,851 game-specific. Target bytes are 9,589,285 shell
and 2,621,431,135 OPFS. The generated install-manifest SHA-256 is
`5ee4346cd960f6df61d3b6266f6fc4fb18d5c12dce4235130def8c5006140983`;
the separately verified build-manifest SHA-256 is
`7223ff0f1ba8d6c7879917930f2290fc31e949d9d747b2e7d414b86876d43fd7`.
These hashes identify the reviewed dirty-tree candidate, not a deployed or qualified
runtime.

**Consequences:** The manifest contract is complete, but the Installer UX plan item
remains open. This decision adds no OPFS writer, resume protocol, UI, service worker,
update/uninstall behavior, scale corpus, Storage Buckets choice, streaming-bridge
change, or installer telemetry. Runtime telemetry begins with the later installer state
machine rather than inventing counters for a build-only contract.

Every current report family that persisted the build artifact identity now also
persists the release identity. `smoke@1` advances to report schema v52 with mandatory
metric set v27 unchanged; `flythrough-d1@1` advances to v19/v11; render recovery to
v16/v5; page benchmark result/status to v6/v5; and the app-owned-LLM report to v3 while
its telemetry remains v3. The baseline store stays schema v1: its retained
`artifactDigest` is the build-manifest SHA that cryptographically binds the listed
install-manifest artifact SHA, and promotion first validates the report's exact dual
target identity plus top-level/target release equality. Page benchmark repeat equality
also treats both digests as comparison-relevant. No metric registry, population,
threshold, or telemetry measurement semantic changed, so mandatory metric-set versions
do not advance. No deployment, Chrome run, baseline promotion, or D-097 physical gate
is authorized by this decision.

## D-127: Qualify D-126's production artifact and close M2's production-deployment item (2026-07-27, accepted)

**Decision:** Retain the passing production `smoke@1` report
`smoke-1-9d4c1be5c290-dev-01-showcase-2026-07-27T02-43-18-518Z.json`
(SHA-256
`ca7a7288ecf6d44787ed1a2f685459c3e81a364cc3d1218adc91dd4d97d681b9`;
Markdown SHA-256
`a12ab47176d74766c272b69de5985144220bc93273fbaa78c3108f99bf74e71a`)
as D-126's one authorized D-097 qualification. It measured exact production
artifact
`9d4c1be5c290133a58c9ad90327591804121b226be84cae4c333d3442f2dc86b`
from source commit `7fdc5465b5903751301a4e319a160848eacefac6` and dirty-tree
digest
`f31df298595bae73ac61fb540bf8ebfaa9b31a5842ee8b13684c0139d95ce0b1`
under `smoke@1` schema v51 / mandatory metric set v27. Production preflight and
postflight each verified the exact same 276-artifact, 10,624,120-byte inventory
and serving contract at `https://parallax-web.com`.

The registered dev-01 Showcase physical-console environment and Chrome sandbox
passed. All six launches completed; environment, evidence-completeness, and
budget facets passed; and all 30 evaluated budget checks passed with no core-run
or finalization failure. JSON-primary and Markdown persistence completed.
Fresh streaming cell-load p95s were
1.980000019/2.024999976/2.314999938 ms, a 0.334999919 ms spread within
D-116's 1 ms allowance. Warm p95s were
1.639999986/1.694999933/2.375 ms, a 0.735000014 ms spread within the same
allowance.

Every launch recorded 74 render-batch requests and 74 completed transactions.
Each measurement window retained 48 samples arranged as 16 complete ordered
three-cell batches, with exact canonical membership and the required timing
conservation. This qualifies the current single-request/single-response
transaction contract. It does not establish that halving D-125's four
request/response messages per canonical batch to D-126's two caused the passing
repeatability result, distinguish browser from OS scheduling, or observe GPU
completion. D-116 is unchanged and RE-043 remains open.

The report's baseline state is `untracked`; no baseline is promoted. No further
physical smoke, public benchmark, flythrough, render-recovery, or V8 lifecycle
run is required for this production-deployment item. Under D-119, this entry and
the matching status-pointer updates are evidence-only closure of the exact
retained result: they change no runtime, harness logic, build output, budget,
threshold, evidence contract, pin, machine descriptor, or claim beyond that
report.

**Context:** D-121 put production serving/deployment and explicit target identity
under version control. D-124 removed the consumed diagnostic. The cleaned
candidate and D-125's first bounded correction each retained all 30 absolute
checks but failed one D-116 cohort. D-126 then removed the remaining application-
owned commit crossing and required exactly one post-correction qualification.
The report above is that run and satisfies the production item's remaining exit
condition without relabeling either failed predecessor.

**Consequences:** Close only M2's production-deployment checkbox. M2 remains
`in progress`; Installer UX is the next active project. Preserve D-125's failed
report and verified D-099 reconstruction bundle. Existing D-122/D-123 retained
evidence and D-124 closure are also unchanged.

**Reopen if:** the exact retained report or artifact identity fails
reverification; production serving no longer satisfies D-121; a later qualifying
input changes under D-097; or new evidence directly triggers another bounded
RE-043 investigation.

---

## D-126: Collapse the batch-atomic render transaction to one request and response (2026-07-26, accepted; supersedes D-125's two-phase protocol)

**Status annotation:** D-127 records the passing one authorized post-D-126
production smoke, closes M2's production-deployment checkbox, and leaves D-116
unchanged and RE-043 open.

**Decision:** Retain D-125's post-correction production report
`smoke-1-d6ed5d3560c4-dev-01-showcase-2026-07-27T01-43-29-439Z.json`
(SHA-256
`ec93b944b8ca296f4462f389cef806939d036a3b0fc76463aa0e6803ce27fd7f`)
as failed, and authorize no retry of its exact artifact
`d6ed5d3560c498f62071d6f235baec32191ad7b0cac4172908919159144a7189`.
All six launches and all 30 absolute budget checks completed and passed. Warm
streaming repeatability passed with p95s
3.170/3.515/4.140 ms and a 0.970 ms spread, but fresh p95s
4.245/3.585/2.995 ms produced a 1.250 ms spread above D-116's unchanged 1 ms
allowance. D-125's batching had already reduced the canonical three-cell
replacement from twelve cross-realm messages to four, a 3× reduction, yet the
failure remained.

Replace D-125's ordered `stream-batch` request/response followed by a
`commit-batch` request/response with one ordered `render-batch-transaction`
request and one `render-batch-transaction-complete` response. The render worker
fully validates exact transaction, request, batch, ordered membership, cell
identity, encoded-byte accounting, and replay monotonicity before mutation. It
uploads members in order. The upload primitive owns cleanup of a throwing member and
does not make that member resident; the transaction boundary then rolls back all
completed peers in reverse order. Invalid per-member/aggregate accounting occurs after
the current member became resident, so it rolls back that member followed by all
completed peers in reverse order. If the synchronous response-enqueue callback throws,
the complete batch rolls back in reverse. A successful enqueue ends the transaction
with no render-side pending map, cell state, timer, or later commit.

The streaming worker retains its 5-second request timeout. Its aggregate encoded
reservation spans preparation, request, response receipt, and exact response
validation and releases exactly once on every success or failure path.
Residency, GPU/encoded accounting, samples, and completed-transaction telemetry
publish only after the sole response is received and validated. If an already
enqueued response is subsequently lost, the streaming worker cannot command
rollback over the missing response; it times out, fails the cohort, and the
existing service teardown terminates the renderer. Disposal is fail-honest while
draining: an outstanding transaction or scheduler failure is latched as `failed`
and wins over the ordinary `disposed` acknowledgement, so teardown cannot be
suppressed by a concurrent disposal request. This is honest fail-closed
lifecycle containment, not an acknowledgement of GPU queue completion.

Remove `renderUploadRoundTripMs`, `renderUploadWaitMs`, and
`renderCommitRoundTripMs`. Add `renderTransactionRoundTripMs`, measured from
each cell's decode completion through continuation after the sole response, and
`renderTransactionWaitMs`, the portion outside that cell's direct `uploadMs`.
Retain `uploadMs`, shared `batchDirectUploadMs`, and total OPFS-to-sole-response
completion with 0.1 ms conservation tolerance. Replace upload/commit request
counters with `renderBatchRequestCount` and retain
`renderBatchTransactionCount`; their delta is 0 or 1 while unsettled and they
are equal at settlement. Retain transaction identity, ordered membership,
cell-count/direct-upload high waters, and the lack of WebGPU queue-completion
or presentation attribution.

Advance streaming telemetry to v9 and the public envelope to v27. Advance
`smoke@1` to schema v51 / mandatory metric set v27,
`flythrough-d1@1` to v18/v11, and render recovery to schema v15 while retaining
metric set v5. Advance page benchmark result/status to v5/v4. Build manifest
remains v11. These are exact-envelope/mandatory-evidence changes; the scenario,
sample populations, D-116 cohorts, windows, nearest-rank p95, thresholds,
scheduler, decode concurrency, OPFS work, and observers do not change.
Pre-D-126 baselines are ineligible.

After implementation and adversarial review converge, deterministically rebuild,
deploy and verify the exact production artifact, then run exactly one D-097
physical-console production smoke. No automatic retry is authorized; retain and
adjudicate any failure before another run.

**Context:** D-125 proved that scheduler batching removed per-cell amplification
but left a second application-owned realm crossing solely to convert uploaded
resources from uncommitted to committed. The render handler is synchronous: it
can validate, upload, construct the complete response, and detect synchronous
enqueue failure inside one call. Maintaining render-side resources across a
second request therefore added traffic, pending state, a timer, and a response-loss
state without adding a stronger observable completion boundary.

**Consequences:** The normal three-cell batch now uses two cross-realm messages,
half D-125's four and one-sixth the original twelve. Response loss after successful
enqueue remains distinguishable only as a streaming-side timeout followed by
cohort failure and renderer teardown. RE-043 remains open and D-116 is unchanged.
D-125's result and verified D-099 reconstruction bundle remain immutable evidence.

**Reopen if:** synchronous enqueue is no longer an honest ownership boundary;
reverse rollback or lifecycle teardown fails to contain a partial/lost
transaction; exact accounting or recovery membership cannot be preserved; an
unchanged budget fails; or the one authorized smoke supplies evidence for a new
action.

---

## D-125: Make each scheduler load batch one atomic render transaction (2026-07-26, accepted; two-phase protocol superseded by D-126)

**Decision:** Retain the final cleaned D-121 production `smoke@1` report
`smoke-1-8e932618990f-dev-01-showcase-2026-07-27T00-17-19-184Z.json`
(SHA-256
`dbc45ae35014b9010f3c84e7ca56c8288756a5b91d6327a324b3f722d9ba061b`)
as failed and deny a blind retry. Its six launches completed, all 30 absolute budget
checks passed, and fresh streaming repeatability passed, but warm p95s
3.380/2.055/2.730 ms produced a 1.325 ms spread above D-116's unchanged 1 ms
allowance. Correct the concrete transaction amplification already visible in the
ordinary architecture: coalesce every authoritative scheduler load batch into one
ordered upload request/ack and one ordered commit request/ack. A normal three-cell
replacement therefore uses four cross-realm messages rather than twelve.

The render boundary remains two-phase and fail-closed. Upload acknowledgement follows
complete upload of every declared member. Commit must reproduce exact transaction,
batch, ordered cell identity, ordinals, membership count, and upload correlation.
Malformed, missing, duplicate, extra, or reordered membership/correlation fails the
streaming cohort. Partial upload rolls back all successfully uploaded peers. An
uncommitted batch keeps the existing 5-second timeout and rolls back every member.
Encoded-residency budget reservation is atomic over the aggregate batch and is released
exactly on success or failure. Disposal rolls back pending render batches; recovery
rehydrates the checkpoint's exact deterministic membership through the same transaction.

Per-cell OPFS access/read, decode, direct upload duration, encoded/GPU bytes, sequence,
and OPFS-to-post-commit total remain intact. Each cell's render-upload round trip starts
at that cell's decode completion and ends at the shared upload acknowledgement, so it
honestly includes waiting for decoded peers and peer upload work. The batch's direct
upload duration and deterministic transaction identity are retained with every member,
and streaming telemetry adds transaction/request counters plus cell-count and
direct-upload high-water observations. Residency and samples become authoritative only
after the shared commit acknowledgement. There is still no WebGPU queue-completion or
presentation claim.

Advance streaming telemetry to v8 and the public envelope to v26. Advance routine
smoke to schema v50 / mandatory metric set v26 and flythrough to v17/v10 because their
mandatory streaming validators require the new transaction evidence. Advance
render-recovery to schema v14 while retaining mandatory metric set v5: its scenario and
mandatory metrics are unchanged, but its exact telemetry snapshots now carry v8.
Because the page-owned benchmark embeds those snapshots, its result schema advances to
v4 and benchmark status telemetry to v3 without changing its advisory metrics, repeat
policy, or 10% rule. Pre-D-125 baselines are intentionally ineligible. D-116's threshold, nearest-rank p95,
sample population, measurement windows, fresh/warm cohorts, scheduler, decode
concurrency, OPFS work, observers, and all waits are unchanged. Do not restore the
D-122/D-123 diagnostic.

After implementation and adversarial review converge, deterministically rebuild,
deploy and verify the exact production artifact, then run exactly one D-097
physical-console production smoke. No retry is authorized by this decision; any
failure is retained and adjudicated before another run.

**Context:** The final cleaned artifact
`8e932618990f1c6d1fb8aaab2db2bbba016c7b2c21e41eda32d375798d51d87d`
reproduced the same bounded warm-only failure after D-124 removed all diagnostic
apparatus. Its ordinary implementation independently sent upload and commit
transactions for each concurrently decoded member. The canonical three-cell movement
batch therefore multiplied one scheduler decision into six requests/acks (twelve
messages), while the sampled per-cell render wait included independent realm crossings.
Batching removes that application-owned amplification without asserting that it is the
browser/OS cause of RE-043 or changing a performance threshold.

**Consequences:** This is a runtime and mandatory-evidence-contract change, so it needs
the one post-review D-097 production smoke above. Old evidence remains immutable and
ineligible for a v26 comparison. RE-043 remains open: this correction reduces
application-owned cross-realm traffic but does not provide GPU completion or attribute
remaining variance to Chrome.

**Reopen if:** exact batch transaction evidence fails; partial upload, timeout,
disposal, or recovery cannot preserve atomic membership/residency; the correction
busts an unchanged budget; or the one authorized smoke fails and a new decision
identifies an evidence-supported next action.

---

## D-124: Close the consumed streaming-tail diagnostic without prescribing a scheduling fix (2026-07-26, accepted)

**Decision:** Retain D-123's single replacement as invalid, non-qualifying evidence;
authorize no retry or further streaming-tail diagnostic. Keep D-116's 250 ms absolute
cell-load budget and `max(10% × minimum p95, 1 ms)` short-smoke repeatability rule
unchanged, and leave RE-043 open. The five valid attempts localize the ordinary
application-visible tail inside cross-realm render request/acknowledgement waiting, but
the experiment does not distinguish browser from OS scheduling, does not observe
WebGPU queue completion or presentation, and therefore supports neither a Chrome
finding nor a runtime scheduling prescription, metric deletion, or D-116 change.

D-099 reconstruction is complete for both consumed source identities. Remove the
closed D-122/D-123 experiment in this human-gate unit: its engine authorization and
protocol shapes, timestamp/correlation/ring path, controls, worker and telemetry hooks,
public methods, harness scenario/validator/runner/CLI/tests, package command, generated
artifacts, and active operator instructions. Ordinary streaming telemetry v7, public
telemetry v25, smoke schema v49 / mandatory metric set v25, its six ordinary core runs
and their streaming samples, and every D-116 budget behavior remain unchanged. After
review convergence, rebuild and redeploy the cleaned D-121 production candidate,
verify exact public serving identity, and run its one final D-097 physical-console
production smoke. That smoke qualifies the converged candidate; it is not a
diagnostic retry.

**Context:** The exact D-123 invocation was consumed once with no retry. Retained
`streaming-tail-diagnostic@1` schema-v1 result
`harness/results/streaming-tail-diagnostic-1-bb200ab2c331-dev-01-showcase-2026-07-26T20-47-12.563Z.json`
has SHA-256
`69e5af5598b06ca5eea99b649049d1d2803ef8638ae2d74cc0c9e886e0c9c4a6`;
its consumption record has SHA-256
`44558176c73a60f21aca9dff9d9cb154dc7a0868731e4bead017b2cea148a74f`.
The measured source was commit
`7fdc5465b5903751301a4e319a160848eacefac6` plus dirty-tree digest
`aae43b0e5ba3e8531acf386a5ea09b44edb5e6f4abe1dec695dcd97f04489f8f`,
and the exact production artifact was
`bb200ab2c33196fd155192560e494b20f7c54705557cb86be8b74db7777f2958`.
Production preflight and postflight verified the exact origin, artifact, and full
serving contract. The registered dev-01/Showcase physical-console environment was
measured with pinned Chrome for Testing 151.0.7922.34, the Chrome sandbox intact, and
`remoteSession: false`.

The report is correctly `status: invalid`, `qualifies: false`: five attempts contain
valid evidence, while fresh repeat 2 has null evidence because zero-work
`control 8 timestamps are misordered`; the no-retry contract is consumed. Actual GPU
completion remains explicitly `unsupported`. Across the five valid attempts, ordinary
total p95s were 2.010, 1.515, 2.065, 1.700, and 2.515 ms. The illustrative warm-repeat-3
nearest-rank total-p95 cell measured 2.515 ms. Its 1.770 ms commit round trip consisted
of 1.195 ms outbound dispatch, 0 ms worker operation/bookkeeping, and 0.575 ms
acknowledgement/continuation; its direct OPFS read/access, decode, upload operation, and
streaming-worker remainder were small. This is enough to locate the application
boundary being waited on, but not the browser/OS/GPU cause of that wait.

The ignored D-099 bundle at
`harness/results/d099-streaming-tail-diagnostic-d123-bb200ab2c331-reconstruction/`
is independently verified. Its complete tracked patch has SHA-256
`b379003ed9c522ce5bbd3c3720d2ac99d25ad62bb1dfffdac5eb87716cef1ef5`;
its complete untracked-file archive has SHA-256
`ef1ef7d1f6fbb8d0b0fb0b409622e32be9677c7926121ab982db8a5268506af4`.
It reconstructed the exact commit/digest above and reverified both retained D-123
artifact hashes. D-122's retained invalid result, consumption record, and independently
verified reconstruction bundle remain unchanged.

**Consequences:** No diagnostic retry, GPU wait, scheduling tune, metric removal, or
threshold change is implied. RE-043 remains the honest platform-research outcome.
The cleaned runtime changes artifact identity, so production must be rebuilt,
redeployed, independently verified, and qualified once under D-097 before the M2
production item can close. Raw D-122/D-123 result, consumption, and bundle files remain
best-effort machine-local evidence; the load-bearing facts above and RE-043 are the
durable record.

**Reopen if:** a future ordinary qualifying run produces a directly actionable
repeatability failure and a new decision defines the smallest current experiment,
observable boundary, authorization, and bounded run count. Do not restore the removed
D-122/D-123 apparatus wholesale.

---

## D-123: Replace the consumed malformed D-122 invocation without changing its diagnostic contract (2026-07-26, accepted; consumed invalid, closed by D-124)

**Status annotation:** D-124 records the consumed replacement, verified reconstruction,
bounded observations, cleanup, and final qualification path. The pre-run decision below
is retained as the exact authorization contract, not current operator instruction.

**Decision:** Preserve D-122's consumed invocation and invalid verdict unchanged. Its
result proved that D-122's first readiness predicate was malformed because Playwright
serialized a callback that captured Node-module
`TELEMETRY_SCHEMA_VERSION`; the page realm had no such binding. Authorize exactly one
replacement physical-console invocation, with no retry, of the unchanged production
`streaming-tail-diagnostic@1` schema-v1 scenario:

```
pnpm harness:streaming-tail-diagnostic -- --target https://parallax-web.com --authorization D-123-one-shot
```

D-123 changes only that predicate: its complete `{ globalName, schemaVersion }`
argument is passed across the Playwright boundary and the serialized callback compares
against `schemaVersion` from that argument. A Node `vm` scope-isolation regression
executes the exact serialized callback without module bindings. The other diagnostic
runner callbacks were audited for the same class of outer capture and require no
change.

The operator-facing authorization is now the harness-only constant
`D-123-one-shot`, consumed exclusively through
`harness/results/streaming-tail-diagnostic-d123-consumption.json`. The old
`D-122-one-shot` operator argument is rejected and the existing D-122 consumption
record is neither read nor changed. The already deployed engine artifact necessarily
retains its internal D-122 protocol authorization; after accepting the D-123 operator
token, the runner passes that unchanged internal value only when arming the engine.
The report and consumption record identify D-123 operator authorization, while the
existing validator continues to require the internal D-122 snapshot authorization.
This translation does not change the deployed runtime, protocol, telemetry, artifact,
scenario, timing, controls, correlation, validation, target, environment, one-shot,
JSON-primary, postflight, or non-qualification contracts established by D-122.

The replacement is valid only for build-manifest/artifact digest
`bb200ab2c33196fd155192560e494b20f7c54705557cb86be8b74db7777f2958`
at exact production origin `https://parallax-web.com`; the runner rejects a different
validated build before pending JSON, consumption, or Chrome. Before its first Chrome
launch, the runner still writes pending JSON and atomically consumes the new D-123
record. It still performs the full registered-environment inspection and the same six
fresh/warm attempts, and it remains `qualifies: false` with no budget, baseline,
promotion, retry, or path to relabel D-122.

**Context:** D-122 was consumed at `2026-07-26T20:22:38.699Z`. Its immutable retained
result is
`harness/results/streaming-tail-diagnostic-1-bb200ab2c331-dev-01-showcase-2026-07-26T20-22-38.699Z.json`
(SHA-256
`75165f270397e89f064763159e96823b3df3354524eecc114c8a800ceccd6bd3`,
source commit `7fdc5465b5903751301a4e319a160848eacefac6`, dirty-tree digest
`68ae52d5d89b3c40dd51096acf989ca9e77cc06676fda3f043421fe9845aaa6a`).
It remains `status: invalid`, `qualifies: false`, with final failure
`6 of 6 diagnostic attempts were invalid`. Every attempt's evidence is null because
the first readiness predicate raised
`ReferenceError: TELEMETRY_SCHEMA_VERSION is not defined`; none reached readiness,
diagnostic arming, controls, warm-up, or measurement.

Evidence independent of that malformed predicate completed successfully. Production
preflight and the single retained postflight both verified the exact
`bb200ab2c331...` artifact, all 276 conditional artifacts and 10,639,725 bytes, plus
the required MIME/cache/ETag/304/isolation/nosniff contract. The registered
dev-01/Showcase environment gate was measured at the physical console with
`remoteSession: false`, the Chrome process sandbox verified, pinned CfT
151.0.7922.34, D3D12, and the registered RTX 4080 SUPER/display/driver/host identity.
That evidence establishes a runner-contract defect, not diagnostic timing evidence,
a runtime regression, or a platform finding.

D-099's ignored bundle at
`harness/results/d099-streaming-tail-diagnostic-d122-bb200ab2c331-reconstruction/`
is independently marked verified. Its 170,759-byte complete tracked binary patch
(SHA-256
`9b84b7271f21615a3c5f26737692e36f04cbe45585fa95f150cc535cb6302f8f`)
and 195,072-byte complete untracked-file archive (SHA-256
`087e8e367a52c11fe6d8588eb5f0267eb91165dcdf53ba355e2428df444fe7c5`)
reconstructed the exact source commit and dirty-tree digest above in a clean scratch
worktree, and reverified the retained result digest. D-123 does not modify that result,
its D-122 consumption record, or the verified bundle.

**Consequences:** D-122 is consumed and cannot be retried. D-123 is the only authorized
replacement and remains unconsumed until its fixed consumption file is created by the
runner. No production smoke is authorized before the replacement is consumed and
reviewed. Afterward, quote its load-bearing observations, create and independently
verify a new D-099 reconstruction bundle for its own measured source identity, and
remove the complete temporary apparatus in this same human-gate unit before deciding
whether a concrete change or exit decision permits production qualification.

**Reopen if:** the D-123 invocation is lost before pending JSON exists, the new
consumption/report authorization is not D-123, the artifact or production target
differs, or retained evidence proves another exact-contract defect. An invalid or
inconclusive replacement has no retry without a new decision.

---

## D-122: Authorize one bounded streaming-tail cross-realm diagnostic after production smoke repeatability failures (2026-07-26, accepted; consumed malformed, replacement consumed and closed by D-124)

**Status annotation:** D-124 closes this experiment after D-123's single replacement
was consumed and reconstructed. The command below is historical and is not authorized
for reuse.

**Decision:** Retain both failed D-121 production-target `smoke@1` reports and keep
D-116's absolute 250 ms budget plus `max(10% × minimum p95, 1 ms)` short-smoke
repeatability rule unchanged. Before another production qualification attempt,
authorize exactly one physical-console invocation of:

```
pnpm harness:streaming-tail-diagnostic -- --target https://parallax-web.com --authorization D-122-one-shot
```

The opt-in `streaming-tail-diagnostic@1` schema-v1 runner accepts only the exact
`https://parallax-web.com` target; omitted/default local and explicit local targeting
are rejected before pending-result creation or authorization consumption. It reuses
the ordinary three fresh plus three warm short-smoke traversal, ten-second warm-up,
and 120-frame measurement boundaries. It is diagnostic evidence only: every report says
`qualifies: false`, has no smoke/budget verdict or baseline/promotion surface, and
cannot replace D-097 qualification. A fixed machine-local exclusive consumption
record makes the authorization one-shot; there is no classification retry.

Pending JSON and atomic one-shot consumption precede the first Chrome launch. The
runner then uses the same registered-environment inspector as smoke, retaining the
runtime Chrome version, command line and sandbox verdict, CDP GPU devices, WebGPU
adapter, browser display, Windows host, machine descriptor, target identity, and
evaluated machine/tier gate. A failed gate retains invalid JSON and prevents all six
core attempts. Each attempted launch also waits for and validates the canonical SAB
ring-buffer and Wasm-thread completion contracts before accepting an explicitly
non-failed streaming state and arming diagnostic controls.

The direct streaming/render `MessagePort` first runs sixteen sequential zero-work
round trips and one fixed 10 ms render-worker busy-service positive control. Only
after those controls arm the session may ordinary traversal warm-up begin. In the
opt-in path, upload and commit requests retain epoch-relative
`performance.timeOrigin + performance.now()` boundaries for the existing streaming
phase start, request posted immediately before `postMessage`, render-handler entry,
operation start/end, response ready, and the existing streaming phase end sampled
immediately after the awaited acknowledgement. The report derives request preparation,
outbound dispatch, render-worker total, operation, worker bookkeeping, and combined
acknowledgement plus streaming-continuation time without clamping. Those five
non-overlapping components must sum to the unchanged existing upload or commit
round-trip sample within 0.1 ms; the diagnostic round trip and the ordinary
`renderUploadRoundTripMs` / `renderCommitRoundTripMs` samples must also agree directly
within 0.1 ms. The existing render-worker `uploadMs` boundary is unchanged, and its
value must agree with upload operation time within the same tolerance. Reports add
upload, commit, and combined summaries for preparation, outbound, worker,
acknowledgement-plus-continuation, and round trip. Every duration must be finite,
non-negative, and ordered. The positive operation must be at least 10 ms.

A 64-entry ring retains **complete cells**, each with both upload and commit
attribution. The runner selects records from the existing start/end
`cellLoadSampleCount` boundary and requires exact cell ID, sample sequence, both
request IDs, and batch identity. Warm-up records may age out. A missing, duplicate,
orphaned, mismatched, non-contiguous, or out-of-order record invalidates the attempt, as does
ring overflow that drops a sequence newer than measurement start. Reports keep raw
selected diagnostic cells and their exact ordinary `StreamingCellLoadTelemetry`
samples; p50/p95/max for diagnostic attribution plus ordinary total, OPFS, decode,
render upload/commit, and streaming-worker remainder components; and the nearest-rank
ordinary-total-latency p95 joined cell plus its selected joined batch peers. Diagnostic
`uploadMs` must agree both with its operation boundary and with the ordinary sample.
The retained join makes the p95 choice and all OPFS/decode/remainder attribution
reconstructable. Reports do not impose an invented dominance threshold.
Before diagnostic correlation or aggregation, the runner applies smoke's canonical
ordinary streaming-evidence validator to the start/end snapshots and uses only its
validated `measurementCellLoadSamples`. Its ten-sample minimum, finite and
non-negative timing rules, attribution conservation, batch/boundary identity, observer
progress, residency, eviction, and snapshot checks remain authoritative; the
diagnostic does not duplicate or weaken them.

JSON is primary and is written pending before the first Chrome launch, then updated
after every attempt. Failures, timeouts, malformed messages, disposal, target
postflight failure, source/build drift, and Markdown persistence failures retain an
invalid partial. Target preflight/postflight, environment, source/build identity,
controls, and all six attempts remain explicit. Actual GPU completion is
`unsupported`: this experiment deliberately does not reach through private Babylon
seams and does not call `GPUQueue.onSubmittedWorkDone()`, so its last boundary is
render-worker response readiness rather than queue completion or presentation.
Production target postflight is captured at most once. Catch/finalization handling
retains that first evidence and never retries a failed verification or overwrites it
with a later success.

The timing basis was checked 2026-07-26 against the current W3C High Resolution Time
Level 3 Recommendation, which specifies that `now()` values with the same time origin
use the same monotonic clock and defines translation via time origin:
https://www.w3.org/TR/hr-time-3/. The current WebGPU specification's queue completion
surface was also checked; omitting it is a deliberate scope/perturbation boundary, not
a claim that the API is absent: https://www.w3.org/TR/webgpu/#dom-gpuqueue-onsubmittedworkdone.

**Context:** Corrected D-121 deployment and independent public validation succeeded
for the exact production inventory and serving contract. The first production smoke
then completed all six launches and all 30 absolute checks but failed only streaming
repeatability: fresh p95s 3.370/3.175/2.060 ms (1.310 ms spread), warm
2.105/3.160/2.590 ms (1.055 ms). Its single D-097 classification retry again
completed all six launches and checks; fresh passed at 2.330/1.445/2.045 ms
(0.885 ms), while warm failed at 1.985/1.910/3.860 ms (1.950 ms). Both target
preflight/postflight verifications passed. OPFS direct read p95 remained
0.035–0.085 ms, while the slow cells accumulated in render upload/commit round-trip
wait. Network delivery, target verification, percentile arithmetic, and an absolute
streaming regression are therefore not supported as causes. This directly triggers
D-116's reopen condition and RE-043's still-unresolved worker/GPU boundary.

The retained reports are
`smoke-1-8e932618990f-dev-01-showcase-2026-07-26T18-23-45-839Z.json`
(SHA-256
`1c96ee7c8d19d99b1c9a887c1e1425f5e5d0340a78c197ac63833e09c9722231`)
and
`smoke-1-8e932618990f-dev-01-showcase-2026-07-26T18-26-29-257Z.json`
(SHA-256
`02c0424e828faeb8eefc9ac2a1cefb0a607e74de22620adeb6a3bff4cac396f3`).
D-114 removed the old trace-heavy experiment. D-122 rebuilds only a small
application-message attribution path and does not restore CDP tracing, presentation,
heap, GPU allocator, or execution-state apparatus.

**Consequences:** No further smoke is authorized until this one diagnostic is
reviewed and consumed. Its evidence may justify a concrete runtime or measurement
change, or may leave RE-043 unresolved; neither outcome weakens a gate. After the
result is recorded, remove the command, protocol, timing, controls, ring, temporary
tests, and public methods in the same human-gate change. Because that same gate would
otherwise contain no committed runnable source, export and verify D-099's complete
source-identity reconstruction bundle before cleanup. Only a concrete converged
runtime/measurement change or a separately recorded exit decision can authorize the
next production D-097 smoke.

**Reopen if:** the single invocation is lost before a pending JSON exists (which would
be an implementation defect requiring a new explicit authorization), or its retained
evidence proves this contract itself malformed. Do not retry an invalid or
inconclusive retained invocation, restore D-111, add a GPU wait, tune runtime
scheduling, or change D-116 without a new decision.

---

## D-121: Version production serving/deployment and make serving target report identity (2026-07-26, accepted)

**Decision:** Production serving is the checked-in
`deploy/nginx/parallax-web.com.conf`: direct static nginx at
`https://parallax-web.com`, rooted only at `/var/www/parallax-web.com`, with no
Cloudflare/intermediary. Mutable navigation and build-manifest responses use
`Cache-Control: no-cache`; resources whose `/immutable/` names carry a full SHA-256
use `public, max-age=31536000, immutable`. COOP `same-origin`, COEP `require-corp`,
cache policy, and `nosniff` use nginx `add_header ... always` so conditional 304s
retain the serving contract. Only GET/HEAD and existing static files are served.
Immutable caching is status-aware and applies only to successful 200/304 responses;
missing immutable paths and 405s remain mutable `no-cache` errors. A server-level,
route-aware method map emits `Allow: POST` for rejected `/uninstall` methods and
`Allow: GET, HEAD` for other 405s without introducing a nested `add_header` inheritance
boundary. Canonical HTTP and `www` origins redirect directly
to the fixed HTTPS origin. Installing this file under `/etc/nginx` and reloading nginx
is a separately documented human-admin action. The reviewed installer backs up the
active include and trap-restores, revalidates, and reloads it if candidate validation
or reload fails. Cleanup disables `set -e`, reports restoration/revalidation/reload
failures, and never removes the caller-owned candidate; the operator wrapper deletes
that candidate only after success.

The checked-in PowerShell deployer has fixed host `plex` and fixed target
`/var/www/parallax-web.com`. Every invocation performs a fresh pinned `pnpm build`,
requires the local inventory to equal every manifest artifact plus the manifest itself,
rejects the frozen `site/` placeholder and its obsolete memory64/Prompt-API framing,
previews local/remote inventories, and resolves the exact remote path. The remote
parent and webroot must be non-symlink directories owned by the SSH user with no group
or world write bits; every destructive boundary rechecks their device/inode identity
and rejects any webroot or descendant mount, including same-filesystem bind mounts.
Preview is the default. Explicit `-Deploy` plus PowerShell's high-impact confirmation
atomically acquires a fixed lock inside the webroot, makes and verifies the root 0700,
moves the pinned model objects into that private lock, preserves only that owned lock
while deleting the fixed webroot's other top-level children, then recursively copies
the frozen `dist` children with `scp`. The deployer revalidates the frozen local
path/size/hash inventory immediately before privatization and after copy, and remotely
keeps the webroot 0700 during replacement, rejects symlinks, normalizes only descendant
directory/file modes, and requires the exact directory/file mode/path/size/SHA-256
inventory, rejecting any non-lock entry that is neither a regular file nor a directory,
plus a final local-source revalidation before chmodding the root 0755 and
releasing the lock. Any post-privatization failure retains the private root and owned
lock for manual recovery; bounded cleanup may restore preserved model objects inside
that private root and reports guarded recovery-state evidence, but never republishes
partial bytes. Source drift, target replacement, contention, preservation/delete/copy/
normalization failure, mixed/extra/special entries, or corruption fails closed.
There is no `rsync`, staged publish, app backup, variable destination, or separate
placeholder publisher.

The fixed webroot is exclusively Parallax-owned exact-inventory storage. Unrelated
files and ACME HTTP-01 challenge files are prohibited beneath it; certificate
validation that needs filesystem writes must use a different location. Preview guards
perform read-only remote inspection only, and a retained lock rejects preview with its
fixed path and an explicit diagnostic. Manual recovery preserves the private 0700 root
and lock until the exact models and combined inventory can be proven. The portable unit
gate executes both the application deployment and model-content uploader mocked safety
suites; optional Git-sh/WSL semantic fixtures are opt-in developer diagnostics and do
not introduce machine-local executable paths into the acceptance gate.

Privileged smoke, flythrough, and render-recovery keep local as the default and accept
exactly `--target local` or `--target https://parallax-web.com`. Before Chrome starts,
the verifier rejects redirects and requires `/` to remain on the exact selected origin,
match manifest-listed `index.html` bytes, use correct HTML MIME, and pass mutable 200/
conditional-304 cache, ETag, COOP/COEP, and `nosniff` checks. The manifest is bounded
to 1 MiB; every manifest artifact is fetched with bounded concurrency eight and
verified by exact bytes/size/SHA-256 plus correct HTML/JavaScript/JSON/Wasm MIME,
status-specific mutable/immutable cache policy, isolation, `nosniff`, ETag, and
conditional 304. Each request has a 10-second header deadline, a 30-second body
deadline, and an expected-size body limit. Cache-Control parsing rejects malformed,
duplicate, or conflicting directives instead of accepting a matching substring.
Every Chrome app/identity navigation, including V8 diagnostics, must finish at the
exact selected URL.

The same complete check runs after measurement. Reports retain explicit verified
preflight and verified/failed postflight evidence plus a compact representation-class
summary; a postflight stall/failure persists as failed environment evidence and cannot
render as verified, and an otherwise-valid identity change is retained as explicit
drift failure rather than contradictory verified evidence. Baseline identity includes
kind/origin, so local and production results cannot compare or promote across targets;
local ephemeral ports normalize to the canonical loopback origin class. A pre-D-121
three-part D-087 local anchor is recognized as the canonical local predecessor but
remains intentionally ineligible
until an explicit `--rebaseline` migration, retaining the existing stale-digest and
actor/reason safeguards. Production selection never starts localhost.
Because static nginx has no harness-only counter endpoint, production smoke records its
local request-delta observation as `not-applicable`; target preflight remains mandatory
environment evidence. Smoke advances to schema v49 / mandatory metric set v25,
flythrough to v16/v9, and render-recovery to v13/v5. D-118 JSON-primary finalization
semantics are unchanged.

**Context:** Read-only production inspection on 2026-07-26 found nginx 1.30.2, direct
SSH hosting, and only the frozen 7,468-byte placeholder in the webroot. The first live
inspection at 15:16 UTC found `/` 200 and conditional 304 responses without COOP/COEP.
The human corrected the live HTML location during this work; reinspection at 15:19 UTC
found both responses retaining COOP/COEP and `no-cache, must-revalidate`, but the
unversioned config still has extension-based caching that omits current immutable JSON/
Wasm classes and the app is not deployed. Immutable behavior therefore cannot be
qualified until deployment. The initial deploy review also found `/var/www` mode 0777
and the webroot mode 0775. The human corrected both to non-symlink, `pmeenan`-owned
0755 directories during the fix pass; read-only inspection verified that prerequisite,
but no agent deployed content or changed nginx.

A subsequent human-admin install attempt failed safely at `nginx -t`: nginx 1.30.2
parsed the unquoted map regex quantifier `{64}` as configuration syntax and reported
`unexpected "{"`. The installer restored and revalidated the prior live include. The
checked-in candidate now quotes the complete regex token and at that point remained
uninstalled pending a human retry; this failed attempt is not public serving
qualification.

After the corrected include was installed by the human, the first authorized app
deployment attempt failed safely before the deletion command. Shell tracing showed
that the generated lock check wrapped command substitution in literal parentheses,
comparing `($(cat .../token))` instead of the token. The same defect prevented automatic
release. Read-only inspection confirmed that the webroot still contained only the
placeholder plus this deployer's lock; the human then removed only that lock after
checking its exact path, token, and contents. The deployer now generates
`test "$(cat .../token)" = '<token>'`, shares that construction between operation and
release, executes correct-token/wrong-token/owned-lock cleanup tests against an isolated
filesystem, and reports both the original operation failure and any cleanup failure.
No app files were deleted or copied, and this attempt is not production deployment
qualification.

Inspection of that failed attempt also found the lock directory at mode 0775 and its
token and uploaded expected inventory at 0664. The remote account's umask is 0002, and
`getent group pmeenan` reports another member, `tkadlec`; a same-group process could
therefore have modified the evidence used to authorize deletion or cleanup. Lock
acquisition now sets umask 0077, creates the lock explicitly at 0700, and creates and
chmods the token to 0600. Before trusting the token or removing the lock, the shared
guard requires a non-symlink directory and regular non-symlink token, both owned by the
current UID, at exact modes 0700/0600. The private directory gates the subsequently
uploaded inventory. Executed shell tests prove the created modes, owner-valid success,
wrong-token and group-accessible-mode rejection, owned-lock cleanup, and survival of a
sibling sentinel.

The second authorized deployment attempt passed lock validation, deleted the
placeholder, and copied the complete app, then reported SSH failure during final
inventory verification; owned-lock cleanup succeeded. Read-only inspection found the
live app present (`/` 5,389 bytes; `build-manifest.json` 68,020 bytes). The failure was
not an artifact mismatch: Windows `WriteAllLines` had serialized the expected inventory
with CRLF while the remote actual inventory used LF, so sorted bytewise `cmp` failed.
The same inspection found scp-created files at 0664 and an `immutable` directory at
0707 under umask 0002. The lead immediately normalized the fixed live webroot to root
and directories 0755 and files 0644 and verified no lock remained. The deployer now
writes explicit UTF-8/no-BOM LF inventory bytes with a terminal newline, compares modes
as part of the exact inventory, makes the webroot 0700 before preserving models and
keeps it private through preservation/delete/copy, rejects symlinks and other special
entries, and normalizes 0644/0755 before restoring the root to 0755. On any failure
after privatization, guarded cleanup restores only any preserved model objects inside
the 0700 root, retains the owned lock, and verifies and reports its private recovery state
alongside the original error; it never normalizes or republishes partial application
bytes. Descendant normalization and exact inventory comparison now occur while the root
remains 0700, and a final local-source revalidation gates the separate root-publication
step. The copied app is live but this failed attempt is not successful deployment or
public harness qualification.

Independent HTTPS verification then found a harness-only transport mismatch: Node
24/Undici fetch advertised gzip and exposed a weak 200 ETag after transparent decoding,
while conditional HEAD exposed nginx's strong ETag. Curl with identity encoding
confirmed nginx's strong 200/304 ETags match. Exact target requests now force
`Accept-Encoding: identity`, preserving manifest bytes/hash and stable ETag comparison.
This is Node collector behavior, not Chrome runtime or production qualification.

Current nginx documentation checked 2026-07-26 states that `add_header` normally
applies to listed statuses including 304 and that `always` applies regardless of status;
it also documents location-level header inheritance rules:
https://nginx.org/en/docs/http/ngx_http_headers_module.html. MDN checked the same day
documents COOP `same-origin` plus COEP `require-corp` or `credentialless` as the
cross-origin-isolation conditions used by `SharedArrayBuffer`:
https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated. Local
target unit tests exercise real Node-server 200/304 responses rather than relying on
configuration inspection alone. The deployment behavior test executes the generated
remote guard in a local shell to prove that `findmnt` failure fails closed and that
reported descendant mounts are rejected. Its isolated fake transport separately checks
PowerShell orchestration for preview/cancellation, guard/lock/inode failure handling,
source drift, mid-preservation plus restoration failure, delete/first-copy/mid-copy/
normalization/verification failure propagation, private-root/owned-lock retention,
publication/release ordering, special-entry rejection, and deletion-command confinement
to the fixed webroot. Those canned transport
responses do not execute a sandboxed remote filesystem replacement, remote inventory
verification, external-sentinel survival, or nginx rollback; installer rollback is
currently checked by script structure and ordering only.

**Consequences:** The M2 production checkbox remains open. A human must install/reload
the versioned nginx config, run the reviewed destructive deployer, verify the public
app and immutable responses, and later run the converged D-097 physical qualification.
The frozen `site/index.html` source is unchanged and is not a deployment input.

**Reopen if:** production requires dynamic origin behavior, the immutable naming
contract changes, nginx cannot preserve required headers on cached responses, or
operational evidence justifies a staged/atomic deployment design despite this
explicitly requested fixed-webroot replacement.

## D-120: Validate the machine-local smoke baseline before launching Chrome (2026-07-26, accepted)

**Decision:** `smoke@1` loads and parses its ignored machine-local baseline store during
preflight, before starting the local server or any Chrome context. Comparison against
that preflight snapshot is non-gating and fail-soft: malformed entry data yields an
explicit `untracked` comparison reason rather than throwing after measurement. Baseline
promotion remains separate, locked, deeply report-validated, and fail-closed.

**Context:** Final review found that the store was loaded only after all six physical
launches. An unreadable or malformed JSON store could therefore discard a completed
one-shot qualification before D-118 wrote primary JSON. The loader already rejects
unreadable or malformed top-level JSON; moving that work to preflight prevents wasting
the physical run. A shallowly malformed entry could still throw during late comparison,
so the report path now localizes that optional comparison as unavailable.

**Consequences:** Baseline-store damage fails before any Chrome launch when it prevents
loading the store at all. Entry-level comparison damage cannot erase completed
measurement evidence or produce a baseline candidate; the report remains independently
gated by its environment, evidence, and budget facets. No schema, metric set, budget,
scenario, launch count, or measurement timing changes.

External review also aligned the report parser with the existing discriminated
repeatability contract: a `measured` streaming-variance summary cannot carry an
invalidity `reason`. This rejects contradictory input without changing the schema,
metric set, generated report shape, or measurement.

**Result:** The final converged post-M1 physical smoke
`smoke-1-8e932618990f-dev-01-showcase-2026-07-26T12-39-01-804Z.json`
(SHA-256
`ec70dfdb8a34622641bb976d2e1b41a083653bce87a78ded9c179401842d2f4e`)
passed schema v47 / mandatory metric set v23 across all six launches, all three facets,
and 30/30 checks. Post-run identity and report persistence were measured, no
finalization or core-run failure occurred, and the valid older metric-set-v11 anchor
was correctly reported as `ineligible` rather than malformed. RE-044 retains the
same-artifact first attempt's pre-measurement fetch failure and the one passing
classification retry.

**Reopen if:** baseline comparison becomes a gating input, concurrent promotion must be
reflected inside an already-running report, or another machine-local postprocessing
input can still discard completed primary evidence.

## D-119: Allow evidence-only post-run documentation without an infinite qualification loop (2026-07-26, accepted; amends D-097)

**Decision:** After a completed qualifying physical run, mechanically recording that
exact report's path, digest, scenario/schema/mandatory-metric-set versions, and verdict,
and updating status pointers to that evidence, does not require another physical run.
This narrow exception applies only when the documentation changes no built runtime or
browser behavior, harness or measurement logic, budget or threshold, mandatory
evidence contract, runtime/tool/browser pin, reference-machine descriptor, or claim
beyond what the completed report establishes.

The measured identity remains the report's own recorded source tuple and runtime
artifact. Later evidence-only prose does not retroactively make the report a
measurement of the resulting documentation checkout. Qualification language must
therefore identify the measured runtime artifact or qualifying-input tree rather than
claiming that an arbitrary later “current tree” ran. Any other change to a D-097
qualifying input still requires a new physical result.

**Context:** D-097 correctly requires a rerun after a later change to a qualifying
input, including a substantive qualification claim. But a passing report cannot be
made authoritative without recording its immutable identity and verdict in tracked
documentation, and treating that mechanical record itself as a new qualifying input
creates an infinite run → document → rerun loop. The report already fail-closes its own
source identity, artifact identity, contract versions, environment, evidence, and
verdict; copying those facts adds no new measurement claim.

**Consequences:** D-097's runtime and evidence gates are unchanged. Evidence-only
closure may record only facts present in the completed report and status changes
entailed by those facts. Changing an interpretation, scope, threshold, contract, pin,
reference descriptor, runtime input, or measurement claim is outside this exception
and follows the ordinary D-097 cadence.

**Reopen if:** mechanically recorded report facts can alter a built or measured input,
or a status-pointer update is used to introduce a qualification claim not established
by the cited report.

## D-118: Make harness JSON persistence primary and report finalization fail closed (2026-07-26, accepted)

**Decision:** Ordinary `smoke@1` and privileged `flythrough-d1@1` now treat report
finalization as explicit mandatory evidence. Final build-manifest and source identity
are revalidated after measurement; drift or a revalidation error is retained inside
the report and fails the evidence facet rather than throwing before persistence.

JSON is the primary artifact. Each runner first writes a pending, fail-closed JSON
report, then formats and writes the human-readable Markdown report to a unique pending
path. The runner next replaces JSON with the successful finalization state and only
then atomically publishes Markdown at its final path. A formatter, Markdown-write, or
Markdown-publish failure rewrites the retained JSON with the localized failure and
exits failed. A JSON-write failure remains a hard storage error because no primary
artifact can be guaranteed. Smoke advances to report schema v47 / mandatory
metric set v23; flythrough advances to report schema v14 / mandatory metric set v7.
No runtime telemetry, budget, threshold, repeat policy, or measured scenario changes.

The privileged flythrough consumer also validates every camera aggregate bound and
checkpoint camera/color vector as exactly three finite numbers, and rejects any
aggregate axis whose minimum exceeds its maximum. This closes the prior stored-evidence
hole where `NaN`, infinities, missing/extra vector components, or inverted bounds could
evade the route-span comparisons.

**Context:** Both runners previously performed their final artifact/source check before
constructing the report, so late drift discarded otherwise complete or partial run
evidence. They also chained JSON and Markdown persistence; a secondary formatter/write
failure could make a successfully serializable measurement appear to have no result.
Flythrough's range checks subtracted typed tuple elements without validating the
runtime JSON shape, so non-finite values could make every `< minimum` comparison false.
Dependency-injected unit tests cover identity drift/probe errors, primary JSON failure,
formatter failure, Markdown-write failure, and the vector/bounds mutations.

**Consequences:** Existing reports remain immutable and versioned under their original
schemas. The one converged D-097 smoke for the post-M1 candidate used v47/v23 and is
recorded under D-120; this decision did not authorize a flythrough, benchmark, recovery,
or diagnostic rerun. Baseline promotion requires measured post-run identity and report
persistence evidence.

**Reopen if:** another persisted harness runner can still lose primary JSON because of
a secondary presentation artifact, or report storage needs an atomic replacement
protocol beyond the current pending/final fail-closed sequence.

## D-117: Close P-001 on M1's memory32 production evidence and remove the memory64 experiment (2026-07-25, accepted; resolves P-001 and supersedes D-086's apparatus-retention consequence)

**Decision:** Keep every current production Rust/Wasm module on memory32. M1 produced
no representative production module with an unavoidable single-module requirement
beyond 4 GiB: streaming partitions content by cell and generation, decode work is
bounded and worker-local, and the retained threaded Rust proof uses one fixed 33-page
shared linear memory. Aggregate Wasm or CPU envelopes do not justify a wider address
space because multiple memory32 modules can exceed 4 GiB in aggregate without any one
module crossing its address limit.

P-001 is therefore resolved as **no current adoption** rather than left open after its
M1 decision point. Remove D-086's now-unconsumed experiment from the app, public
telemetry, engine worker/service/protocol surface, build artifacts, repeatability gate,
and harness commands/tests. Preserve D-086's exact feasibility/cost result and the
related rough-edge records as historical evidence. Build-manifest v11 removes the
experiment-only worker and modules from shipped artifacts. Public telemetry v25 removes
the experiment section and start action; smoke report v46, flythrough report v13, and
render-recovery report v11 record that envelope change without changing their metric
sets, budgets, or measurement semantics.

**Context:** A repository-wide reference inventory on 2026-07-25 found no memory64 use
outside the D-086 apparatus and the current documentation that described it. In
particular, no `engine/src/wasm` production service imports the experiment, no streaming
or decode protocol passes 64-bit linear-memory addresses, and no active M2+ plan item or
recurring gate consumes `memory64-spike@1`. M1 completed on memory32 with its current
streaming/decode topology and stayed within every evaluated Showcase budget. D-086
already established that pinned Chrome/Binaryen could execute the optional path, so
keeping executable apparatus after the adoption decision would violate the
closed-experiment rule without improving the production claim.

**Consequences:** Memory32 is the selected/default address width, not a permanent ban on
memory64. Rust modules must continue to isolate memory-size assumptions and report
linear memory per module. A future module may reopen memory64 only with representative
evidence that its single address space must exceed 4 GiB after partitioning, streaming,
multiple memory32 modules, and resident-set reduction have failed, followed by a
current production-kernel cost comparison on then-current browser and Rust tooling.
That future work rebuilds the smallest relevant experiment from D-086/history rather
than carrying dormant WAT, runtime, or harness code.

**Reopen if:** a concrete production module demonstrates the unavoidable measured
single-module need above, or a platform/toolchain change invalidates the generic
memory32 design boundary for a planned production module. Do not reopen for aggregate
process memory, install size, or speculative future scale.

## D-116: Bound short-smoke streaming repeatability by 10% or 1 ms rather than an uncalibrated near-zero percentage (2026-07-25, accepted; supersedes D-115's schema-v44/metric-set-v21 pure-relative smoke consequence; M1 qualification completed)

**Decision:** Preserve the immutable failed schema-v44 / mandatory-metric-set-v21
report
`smoke-1-cf1a0420d451-dev-01-showcase-2026-07-26T02-56-25-489Z.json`
(SHA-256
`d9117a9440fc22144589fd29ae8ff1e4469aec996f1ad235b35c01442843109f`)
and replace only its newly introduced short-smoke streaming-repeatability contract
prospectively. Schema v45 / mandatory metric set v22 evaluates fresh and warm
independently over the same three existing p95 samples. A cohort is repeatable when
its absolute p95 spread is no greater than
`max(10% × minimum cohort p95, 1.000 ms)`. Reports retain the relative range as a
diagnostic and add the absolute spread plus computed allowance. Missing, non-finite,
negative, incomplete, or over-limit evidence is `invalid`; baseline ingestion and
promotion recompute all three values from the validated run evidence rather than
trusting the summary.

The 1 ms floor is deliberately conservative: it is 0.4% of the unchanged 250 ms
cell-load budget and does not admit multi-millisecond instability. Above a 10 ms
minimum, the existing 10% rule is exactly unchanged. At or below 10 ms, a
sub-millisecond absolute difference no longer becomes an arbitrarily large verdict
solely because the denominator is near zero. The authoritative ten-minute flythrough
and public benchmark retain their pure 10% relative-range contracts; this change is
specific to the short current-path smoke bridge.

**Context:** The retained v44 report passed the registered environment and completed
all six core runs. All 30 individual budget checks were evaluated and passed. Fresh
streaming p95s were 2.435/1.850/2.375 ms and warm p95s were
2.445/1.965/2.355 ms, all more than 100× below the 250 ms limit. The only failures were
the new pure-relative summaries: 31.622% fresh and 24.427% warm. Their absolute spreads
were only 0.585 and 0.480 ms (0.234% and 0.192% of the absolute budget). The full
per-cell evidence localizes the changing tail to sub-millisecond render upload/commit
waits; it does not expose a slow OPFS boundary, incomplete cohort, queue failure,
recovery, browser error, or busted absolute check.

This was the first physical application of D-115's prospective short-smoke streaming
repeatability check. Historical complete smoke reports retained the p95 samples but
did not gate them with a pure-relative streaming verdict; several otherwise qualified
short runs would have produced double-digit relative percentages from small absolute
spreads. Therefore v44 did not reveal a runtime regression against a calibrated
short-smoke baseline. It revealed that directly copying the long-window 10% ratio into
the much faster short workload made the verdict denominator-dominated. No runtime
change is justified by that evidence.

**Consequences:** The v44 report remains failed and may never be relabeled or promoted.
Because the mandatory evidence contract changes, M1 still requires exactly one
converged physical `smoke@1` on the qualifying-input tree under schema v45 / metric
set v22. That run adds no launches or duration. No flythrough, recovery, public benchmark, or
privileged diagnostic is reopened. M1 remains in progress until the new smoke passes
all six runs and all three facets.

**Qualification evidence (2026-07-25):** The one authorized converged physical report
`smoke-1-cf1a0420d451-dev-01-showcase-2026-07-26T03-19-56-378Z.json`
(SHA-256
`b10c83ff0019cd3b332eec322703e2556de4565ba3e01c942154909cfb5508c9`)
passed schema v45 / mandatory metric set v22 on registered dev-01 Showcase. All six
core runs completed with no core-run failure; environment, mandatory-evidence, and
budget facets passed; and all 30 evaluated budget checks passed. Fresh streaming p95s
were 1.885/2.130/2.500 ms, whose 0.615 ms absolute spread was within the 1 ms
allowance. Warm p95s were 2.300/2.340/1.810 ms, whose 0.530 ms spread was likewise
within 1 ms. The report retains compositor presentation as informational `invalid` and
page-attributed GPU memory as `unsupported`; it does not qualify worker long tasks,
combined CPU resident memory, Standard, or any other D-115 carry-forward. This report
completes D-115's versioned M1 evidence chain without authorizing another physical or
long-running gate.

**Reopen if:** a v45 cohort exceeds both the 10% allowance and 1 ms floor; the absolute
250 ms streaming budget changes; the short smoke's path, sample population, timing
source, or percentile aggregation changes; or accumulated reference-machine evidence
supports a tighter prospective absolute floor. Do not reopen merely because a retained
v44 report would produce a different verdict under v45.

## D-115: Close M1 on authoritative Showcase evidence while retaining unsupported platform gaps (2026-07-25, accepted; supersedes D-110's public-benchmark qualification requirement, D-102's visible-pop M1-exit implication, and D-108's extra recovery-rerun consequence; schema-v44/metric-set-v21 pure-relative smoke consequence superseded by D-116)

**Decision:** Complete M1's public Benchmark mode task on implementation and
result-contract correctness, not on a second numerical milestone verdict from its
intentionally advisory page-only metrics. `benchmark-result@1` schema v3 remains
unchanged. Its 10% repeatability checks remain unchanged, and the two complete
`ff05ec211444…` reports remain failed scenario evidence. Producing and exporting those
valid failed results is the required fail-honest behavior: it proves the in-game mode
can own the canonical three-repeat lifecycle, validate it, preserve unsupported
capabilities, and reject unrepeatable observations. It does not prove the failed
streaming/render p95s repeatable and does not qualify any performance budget.

The privileged `flythrough-d1@1` report remains M1's authoritative ten-minute
performance evidence, through the explicit versioned bridge below. D-102's registered
dev-01 Showcase report passed its environment, evidence, and budget facets, all 15
evaluated checks, and the unchanged streaming-p95 repeatability rule. The public
continuous-page result has a different lineage and cannot duplicate or override that
verdict. This decision therefore supersedes D-110's requirement that the public
artifact itself eventually become a passing final M1 qualification. No further
30-plus-minute public benchmark or privileged diagnostic is authorized or required for
M1. A future invocation follows the public mode's normal product/research trigger and
still applies schema v3's unchanged metrics and 10% rule; it is not a deferred M1 gate.

M1 qualification is a **versioned composite evidence ledger**, not a false assertion
that D-102's schema-v4/metric-set-v4 artifact satisfies today's
`flythrough-d1@1` schema-v12/metric-set-v6 validator:

1. D-102 is the passing registered long-window anchor for the unchanged canonical
   route, environment phases, streamed-presentation ownership, six rendered
   checkpoints, render aggregation, main-thread Long Tasks, synchronized all-realm V8
   used heap, Dawn/D3D12 overlap, absolute streaming p95, and 10% streaming-p95
   repeatability.
2. D-103/D-104 advanced flythrough's mandatory set for stricter streaming settlement
   and the generation-tagged settled recovery checkpoint; they did not change its
   route or numeric performance limits. D-104's dedicated schema-v4/metric-set-v3
   physical result qualifies the recovery protocol, and the final current
   schema-v44/metric-set-v21 smoke must validate every healthy boundary against the
   same current checkpoint/streaming contract and compute the cell-load p95 relative
   range independently across its three fresh and three warm repeats. This expressly revises any inference
   that a new metric-set-v6 ten-minute artifact is itself required for M1.
3. D-108 materially changed the streaming initialization/read path. The two later
   complete physical public reports do not carry a budget verdict and retain failed
   variance, but they do establish that the changed measured runtime completed six
   canonical ten-minute routes with exact 4K checkpoints, 256/256 handles, every
   individual streaming p95 below 250 ms, and zero Window Long Tasks. The final current
   smoke—not those advisory values—must carry the registered-environment, absolute
   streaming budget, and current-path short-scenario repeatability verdicts. This does
   not assert that the post-D-108 ten-minute route became repeatable.
4. D-114 corrected future heap-sampler scheduling after the D-102 artifact. D-115 does
   not replay or relabel that immutable schema-v4 report under today's validator. The
   final smoke must qualify the corrected sampler and current all-realm heap limit on
   the final runtime; D-102 remains only the versioned ten-minute observation it
   actually was.

This bridge narrows the exact M1 claim: it qualifies the D1 greybox architecture and
evaluated Showcase metrics across the versioned evidence chain; it does not claim that
one then-current D-115-era schema-v12 report passed or that the measured runtime artifact independently
repeated every ten-minute privileged probe. A future change to route pacing,
environment sequencing, streamed ownership/checkpoint rendering, long-window heap or
trace collection, numeric budgets, or the current streaming/recovery contracts reopens
the relevant long/dedicated gate.

M1's registered physical exit is scoped to **Showcase on dev-01**. D-018 remains
unchanged: the Standard M1 Pro/Metal/120 Hz profile has no registered machine, dev-01
Standard-preset runs are provisional, and no M1 result satisfies a Standard-tier exit
criterion. Closing this platform-ceiling greybox milestone makes no Standard/default-
experience, Metal, 120 Hz, or cross-machine transfer claim. Standard remains explicitly
unqualified until `standard-01` is registered and must be qualified before a later
milestone claims the default experience or final-art performance; M3's already-planned
cross-machine work is the earliest natural registration point.

Interpret M1's plan phrase “zero budget violations” as **zero violations among the
evaluated mandatory M1 metrics**, together with this explicit unsupported/deferred
coverage list. Unsupported is never a passing check and cannot support a claim about
the corresponding budget:

- **Physical presentation:** CfT 151's `Display::FrameDisplayed` events have neither
  success nor page attribution (RE-006/D-114). The standing M1 metric remains
  unqualified: `smoke@1` records it as informational `invalid` because callbacks exist
  but cannot prove scan-out, while D-114's provider inventory records authoritative
  presentation as `unsupported`. Render-worker and Viz callback cadence remain
  heuristics and are never substituted. M1 therefore makes no player-visible
  frame-budget claim.
- **Worker long tasks:** Window Long Tasks gates the main thread over the full
  flythrough, but no equivalent worker-wide surface exists. Worker long tasks remain
  `unsupported`, not zero.
- **Memory:** the qualified flythrough gates the synchronized all-realm V8
  `usedSize` high-water estimate. Routine smoke separately records the fixed
  2,162,688-byte synthetic threaded-Wasm shared memory and 8,224-byte SAB transport
  pool as bootstrap correctness/size invariants; neither is representative
  flythrough-Wasm residency, and neither may be added to V8 backing storage. The CPU
  envelope (JS + Wasm + SAB + staging) therefore remains unsupported as a combined
  resident total. Page-attributed resident/transient WebGPU memory remains unsupported
  under RE-014. Logical streaming encoded/upload byte bounds are not physical CPU/GPU
  residency.
- **Visible pop-in:** the budgets table labels its visual diff “later,” and no M1 plan
  task or exit bullet independently binds it. D-102 nevertheless listed it among the
  runner omissions “required by the later M1 exit.” This decision explicitly supersedes
  that scope implication rather than silently ignoring it. M1 checkpoint captures prove
  exact streamed-residency ownership and non-blank output, not absence of pop. Defer
  the deterministic visual-diff gate to M5's representative-art streaming swap, where
  the content can make that claim meaningful.
- **D1↔D2 transition:** remains M4 scope, including the not-yet-calibrated prefetch
  trigger; it is not an M1 omission.

M1 remains `in progress` until one converged D-097 `smoke@1` runs the current
runtime/dashboard/diagnostic-cleanup tree on registered dev-01 at the physical console.
That one report must use the pinned CfT/Node identities, wake the Windows display before
every Chrome context launch, pass environment and mandatory-evidence facets, and pass
every schema-v44/mandatory-metric-set-v21 check across all six core runs. Metric set
v21 adds a mandatory prospective repeatability check over the already-collected
streaming cell-load p95: three fresh values form one comparable cohort and three warm
values form the other, and each cohort's relative range must be no greater than the
unchanged 10% threshold. It adds no launch or measurement duration. Missing samples,
an incomplete cohort, or an exceeded range is `invalid` and fails evidence completeness.
Its informational `invalid` compositor-presentation metric and `unsupported` attributable-
GPU-memory metric remain visible and do not become passes. The already-qualified
flythrough and render-recovery scenarios are
not rerun. This explicitly supersedes D-108's consequence that its fixed-handle change
must repeat the dedicated recovery qualifier: D-104 already qualified the one-retry
cohort, D-108 did not change its fault/control protocol, and the later complete public
workload physically opened the same generation-initialization set at 256/256 handles in
204.96 ms. Replacement generations call that same validated initialization path. This
is not a claim that the combined post-D-108 fault path was remeasured; a future change
to recovery control flow or handle initialization reopens the dedicated qualifier.
After the exact-artifact smoke passes, the M1 exit checkbox and milestone status may be
closed with the unsupported/Standard carry-forwards above.

**Context:** The authoritative Showcase flythrough
`flythrough-d1-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-07-24-028Z.json`
is schema v4 / mandatory metric set v4. It passed all three facets and 15/15 checks
over three independent fresh-profile
ten-minute repeats; streaming p95 was 22.810/23.895/22.000 ms with 8.614% relative
range. Its three all-realm V8 used-heap high-water estimates were
40,450,636/41,631,772/41,472,352 bytes. D-104's dedicated physical report separately
qualified bounded whole-cohort recovery. Two later public reports completed all three
continuous-page ten-minute repeats and exact 4K preflight but correctly failed their
unchanged repeatability checks: D-110 records 30.243% streaming variance in the first,
and 21.572% streaming plus 20.968% render-duration variance in the retry. Their page
budget facet was already `not-evaluated`; requiring those advisory values to pass as a
second milestone gate would conflate two deliberately incomparable contracts.

D-111/D-113's privileged diagnostic did not create a missing implementation fix. D-114
proved the positive control but retained only a biased 41/92-cell trace prefix, no
completion, no successful/page-attributed presentation event, no attributable GPU
allocator dump, no full-window worker-long-task view, and no additive CPU total. That
is affirmative evidence that another identical long run cannot manufacture the
unavailable platform observability. The project goal prioritizes documenting such
limits; keeping M1 indefinitely open would relabel a demonstrated platform gap as an
application failure without adding evidence.

**Consequences:** The Benchmark mode plan item is complete and its feature status is
implemented/physically exercised. RE-043 remains an open research/observability gap,
but no longer blocks M1 and does not authorize another run. Standing numeric budgets,
public/flythrough metric states, retained artifacts, and all failed verdicts remain
unchanged. Routine smoke advances to schema v44 / mandatory metric set v21 solely for
the prospective current-path streaming-repeatability evidence. M1 may close after the
one converged physical smoke with the precise claim:
the versioned evidence chain plus the qualifying-input smoke qualifies every evaluated
mandatory M1 metric in Showcase; Standard and the enumerated platform-unobservable
metrics are unqualified. It may not be described as one then-current D-115-era schema-v12 flythrough
pass. No wording may shorten the claim to “all budgets passed.”

**Reopen if:** a concrete runtime or measurement change directly affects the public
benchmark lifecycle; Chrome exposes successful page-attributed physical presentation,
worker long-task, combined resident CPU, or page-attributed GPU residency evidence; a
Standard reference machine is registered; or representative M5 art makes the deferred
visible-pop check actionable. Each promotion requires a prospective versioned contract
and new evidence; none retroactively changes the retained failed reports.

## D-114: Close the consumed M1 exit diagnostic without authorizing another benchmark (2026-07-25, accepted; final M1 contract supplied by D-115)

**Decision:** Accept D-113's replacement execution as a valid
`m1-exit-diagnostic@1` schema-v1 **invalid partial**, adjudicate only the independently
retained evidence, and close the one-shot D-111/D-113 experiment. Remove its command,
runner, schema/persistence modules, trace categories, correlation/control logic, tests,
public telemetry methods, worker protocol/messages/marks, and broken
`SetThreadExecutionState` helper. Keep the ordinary inert F15 wake immediately before
each Windows Chrome launch. The maintained JavaScript heap sampler now schedules its
initial capture at the monotonic deadline instead of starting it inline; any
nevertheless-negative delay fails with the exact sample retained rather than being
clamped.

The retained report is
`m1-exit-diagnostic-1-12e68fa57ea7-dev-01-showcase-2026-07-26T01-24-11-033Z.json`
(artifact
`12e68fa57ea78777822c1361849e0c3dfd69c831c8b8bbc4e2031950980d3385`,
result SHA-256
`75f26f111a1bf979b746cc35ac30d2dd1cae1c868dd0b6cc377ad7b96f98e713`,
source commit `6f2fb1e9814904c733a64b4a629051c46c3fe145`, dirty-tree digest
`44aef5898ec59e8021c10d3aaac25b4a2a69b9fd76f50a100aec3b5547ddf4a9`).
Before cleanup, D-099's complete ignored reconstruction bundle captured the 532,448-byte
binary tracked diff and all 53 non-ignored untracked files. A clean detached worktree
reconstruction reproduced both source-identity fields exactly.

The 75 ms positive control worked: its worker mark lasted 75.083 ms inside one 75.338 ms
`ThreadControllerImpl::RunTask`, wholly before measurement. Cell-stage timestamps were
usable only for the biased first 41 of 92 canonical samples (sequences 64–104, batches
9–30). All six marks for each of the later 51 cells were absent, so the partial cannot
localize cross-repeat variance or justify a runtime/measurement fix. At the 40,000.7 ms
diagnostic cutoff the trace had delivered 4,190,120 events in 30,433 chunks /
878,610,107 serialized bytes. Collection ultimately retained 4,221,682 events in 30,589
chunks / 883,071,678 bytes after 165,167.074 ms without
`Tracing.tracingComplete`; `dataLoss` therefore remained unknown. This extends RE-008's
payload-bound long-window observation and is not the historical zero-chunk signature.

Current CfT emitted 13,892 `Display::FrameDisplayed` instant events with empty argument
objects and no page identity or success flag. Presentation is therefore explicitly
`unsupported`, not measured. The memory-dump request succeeded in 113.1782 ms, but the
trace contained zero allocator-bearing GPU-process dumps. The synchronized
used-heap-plus-reported-backing observation peaked at 89,593,455 bytes; independent used
heap/backing maxima were 43,119,472/71,505,215 bytes. Separately identified shared
memory was 2,170,912 bytes (2,162,688 Wasm plus 8,224 SAB), while logical staging bounds
were 12,580 encoded and 34,960 decoded-upload bytes. CDP does not establish overlap, so
there is no additive CPU resident total. Page-attributed GPU residency and full-window
worker long tasks remain unsupported. The attempted awake lease was never active
because PowerShell supplied signed values to the `UInt32` P/Invoke. The measured
attempt's post-run browser-display/host fields were null; that is missing evidence, not
environment drift.

**Context:** D-110 required one privileged canonical repeat before another public
benchmark. D-111's first execution lost its artifact; D-113 authorized exactly one
unchanged replacement. That replacement retained enough independent evidence to
adjudicate the probes, but post-capture validation correctly rejected the report after
the trace failed to complete, 51 cell correlations were missing, the GPU allocator dump
was unusable, the awake hold failed, and the heap sampler recorded a negative start
delay. The experiment answered its bounded questions without producing a variance
localization.

**Consequences:** No new Chrome defect is claimed. RE-006, RE-008, RE-012, RE-014, and
RE-043 retain the scoped observations. The public 10% gates and every standing budget
remain unchanged. The result supplies neither a concrete runtime/measurement fix nor a
prospective versioned contract change, so it does **not** authorize another public
benchmark. M1 benchmark qualification remains blocked. No further diagnostic or
benchmark invocation is authorized; the next task must decide the final M1 exit
contract and Standard/visible-pop policy without silently reintroducing this apparatus.

**Reopen if:** a future explicit decision defines a new bounded experiment against
then-current Chrome evidence, or a concrete independently supported runtime/measurement
change satisfies D-110's public-rerun precondition. Recover or rebuild only the smallest
current apparatus; do not restore the closed D-111 implementation wholesale.

## D-113: Authorize one exact-contract replacement for D-111's lost-artifact diagnostic (2026-07-25, accepted; replacement consumed and experiment closed by D-114)

**Decision:** Explicitly authorize exactly one replacement invocation of the existing
`pnpm harness:m1-exit-diagnostic` command after D-111's first physical execution was
consumed without an artifact. The replacement must use the current
`m1-exit-diagnostic@1` schema-v1 contract unchanged: one independent fresh-profile
Showcase `flythrough-d1@1` repeat with the same canonical route and seed, six rendered
checkpoint preflight, ten-second stabilization, complete 600,000 ms window, streaming
cohort, fixed 3840×2160 worker workload, pinned-CfT/registered-host validation, wake
policy, positive control, trace correlation, presentation inventory, memory evidence,
and immutable non-qualification provenance defined by D-111. This adjudication does
not authorize a shortened, relabelled, reconfigured, or newly versioned substitute.

Invoking that physical replacement consumes this authorization regardless of whether
the command completes, fails, or retains an artifact. There is no automatic retry. A
surviving artifact must be reviewed before any next measured action. It may authorize
another complete public benchmark only when its evidence supports a concrete
runtime/measurement implementation fix or a prospective versioned measurement-contract
change. It cannot itself qualify M1 or relax, waive, or retroactively reinterpret the
unchanged 10% cross-repeat gates. If the replacement also produces no artifact, stop:
the diagnostic and public benchmark remain blocked pending explicit human review and a
new decision. The workflow's generic bounded retry for intermittent RE-008/RE-036-class
failures does not apply to this one-use replacement.

The 30-plus-minute public benchmark remains one final M1 milestone qualification. It is
never a smoke, render-recovery, bulk-review, or unrelated-change gate, and this
replacement authorization does not add another public benchmark attempt by itself.

**Context:** D-111's first permitted physical command completed its approximately
12.5-minute capture and trace-processing lifecycle, but a fixed post-capture persistence
defect let validation, serialization, formatting, or writing reject before any JSON or
Markdown artifact survived. D-111 now fail-closes those paths into an invalid partial
and has an emergency persistence sink, but that repair cannot reconstruct the lost
evidence. The first attempt remains consumed and unreviewable. This decision is an
explicit adjudication of that specific fixed artifact-retention defect, not a refund,
retry policy, or relabelling of the first execution.

**Consequences:** The only presently authorized browser measurement is the one exact
D-111 replacement invocation. Preserve any result, including an invalid partial, and
adjudicate it as evidence. Until a surviving artifact supports the concrete change
required above, no further public benchmark is authorized. The standing 10% gates,
budgets, and independent D-097 smoke and render-recovery triggers are unchanged.

**Reopen if:** the replacement is consumed without an artifact, in which case stop for
human review; or its surviving evidence supports a concrete runtime/measurement fix or
prospective versioned contract change. Reopening requires a new explicit decision and
does not expand this one-use authorization.

## D-112: Render M1 streaming telemetry as an accessible in-game dashboard without a second metric contract (2026-07-25, accepted; implementation and final M1 physical gate complete)

**Decision:** The always-visible M1 world-streaming dashboard consumes the existing
public `WorldStreamingTelemetrySnapshot` without adding a second cache, polling loop, or
telemetry schema. Game UI code owns a pure view model and presentation copy; the app
shell only mounts semantic DOM and wires the existing synchronous streaming
subscription. The dashboard shows worker state/generation/recovery, resident capacity
and identities, observer targets and settlement backlog, fixed OPFS package/open-handle
identity, retained/cumulative load samples, nearest-rank total and stage p95s, resident
and in-flight encoded-byte accounting, logical streamed GPU-buffer bytes, decode queue
high-water, encoded-residency budget rejections, and proactive evictions. The
current public contract has neither a worker-stall counter nor an emergency-eviction
counter, so both are visibly `Unavailable` with the exact related evidence instead of
being inferred from unrelated counters.

The dashboard has no independent animation/update cadence: it changes only when the
authoritative service publishes. Its polite live region announces cohort state,
generation, residency, and failures; rapidly changing metric rows and expandable
resident/observer identities are ordinary semantic text so assistive technology is not
flooded. It remains visible during the public benchmark but does not start, configure,
pace, aggregate, or export benchmark work. No public telemetry or benchmark-result
schema changes because no producer field or measurement meaning changes.

**Context:** The prior integration copied a small subset of streaming values into
`#status.dataset.streaming*`. Those attributes supported automation but were not a
visible dashboard and omitted the fixed handle-set identity, stage attribution,
settlement, queue pressure, recovery generation, and explicit unsupported signals
needed to understand M1 behavior. Local pinned TypeScript and focused Vitest coverage
exercise running, unavailable, and failed dashboard states, a discriminating exact
nearest-rank p95 selection, retained-versus-cumulative history, opening/open/closed
storage identity, pressure, and stage formatting. The retained live p95 is descriptive
and explicitly not an M1 budget verdict because it has no canonical measurement-window
eligibility. No Chrome or performance claim is made by those tests.

**Consequences:** The M1 “streaming metrics dashboarded” exit subrequirement is
implemented without crossing the game/engine platform boundary or changing the public
measurement contract. Existing `data-*` automation diagnostics remain intact.
Because this changes the built app and adds main-thread DOM work when streaming
telemetry publishes, the converged M1 candidate still requires D-097's one physical
smoke gate; D-110 does not authorize another 30-plus-minute benchmark merely for this
UI addition.

**Reopen if:** the engine publishes target-cell identities, a defined worker-stall
counter, or an emergency-eviction state; the dashboard then surfaces those authoritative
fields through a versioned telemetry change rather than deriving proxies. Revisit the
mount boundary if game UI gains a platform-neutral renderer independent of the app
shell.

## D-111: Add one non-qualifying privileged canonical-repeat diagnostic before the next public benchmark (2026-07-25, accepted; experiment closed by D-114)

**Decision:** Implement `m1-exit-diagnostic@1` schema v1 as the only next measured
action permitted by D-110. `pnpm harness:m1-exit-diagnostic` reuses the authoritative
privileged `flythrough-d1@1` driver for exactly one independent fresh-profile Showcase
repeat: the same route/seed, six rendered checkpoint preflight, fixed ten-second
stabilization, complete 600,000 ms window, streaming cohort, pinned-CfT/registered-host
validation, and immediate Windows F15 pre-launch wake. The diagnostic additionally
sets and checkpoint-attests the public benchmark's exact 3840×2160 worker workload.
A scoped Windows `SetThreadExecutionState` lease holds the display and system awake
through the measured attempt and is released in `finally`; it sends no periodic input.

The streaming worker exposes an explicit opt-in telemetry handshake. After privileged
tracing starts but before the route marker, it enables bounded per-cell User Timing
stage marks and executes one requested 75 ms busy worker task. The result is valid only
if trace evidence identifies the acknowledged control as one same-thread enclosing
task wholly before measurement. Measured cell identities then correlate the existing
page-owned OPFS/decode/upload/commit/remainder durations with trace timestamps and
overlapping worker tasks. Routine smoke, the three-repeat flythrough gate, and the
public benchmark do not enable these marks or trace categories.

Presentation remains fail-honest. The diagnostic inventories actual GPU-process
candidate event names, categories, phases, process/thread IDs, nested argument-key
shapes, and bounded raw argument samples from current CfT. It reports presentation
`measured` only after a reviewed event contract proves both successful physical
scan-out and page attribution. Schema v1 has no such trusted provider, so callback
events remain structured `unsupported`, never relabeled presentation. One detailed
memory-infra request retains the existing structured page-attributed GPU-memory
`unsupported` result, but completion still requires Chrome to accept the dump and the
nested GPU-process allocator diagnostic to be usable. CPU inventory computes
`max(sample Σrealm(usedHeap + reportedBackingStorage))` from each synchronized
multi-realm capture and retains the independent used/backing maxima separately.
Shared WebAssembly memory and standalone SAB pools remain uniquely owner-attributed,
but CDP does not establish whether those bytes are absent from, present in, or
duplicated across per-realm backing-storage observations. Schema v1 therefore records
their overlap as unknown and reports no combined CPU resident total. Logical streaming
staging remains a non-residency bound rather than an observed allocation.

Every JSON/Markdown artifact carries exact artifact/source/Chrome/Node/machine identity,
trace completion and data-loss state, the one-repeat/fixed-pixel/canonical contract,
partial telemetry and diagnostics on failure, and immutable non-qualification
provenance. It has no budget facet and cannot qualify the benchmark, flythrough gate,
or M1 exit. Its persisted validator rejects lineage, route, pixel, trace-integrity, or
provenance drift before writing. A complete artifact additionally requires the exact
92-sample run-local streaming suffix and same-order trace correlation, a fully
contained/acknowledged 75 ms control, schema-v1 presentation `unsupported` with null
proof, eligible pinned runtime/environment equality, and bounded candidate shapes.
The runner projects raw flythrough/long-task/streaming evidence into a
diagnostic-only result that cannot carry budget checks or pass/fail verdicts. Failed
post-trace work retains each independently completed subrecord and trace-drain
diagnostics rather than collapsing the artifact to an empty shell.
The opt-in public methods do not change the serialized telemetry snapshot shape, so the
public envelope remains at v24 and the existing smoke, flythrough, and render-recovery
schemas and metric sets remain unchanged. The diagnostic evidence contract is versioned
independently as `m1-exit-diagnostic@1` schema v1.

**Context:** D-110 exhausted the complete public benchmark and its one same-artifact
retry while RE-043 remained below the application's worker/GPU boundary. Repeating
another 30-plus-minute public lifecycle cannot add that missing evidence. Current CDP
documentation checked 2026-07-25 describes `Runtime.getHeapUsage.usedSize` as JavaScript
heap and `backingStorageSize` as ArrayBuffer/external-string backing storage, supporting
the explicit non-double-counting split; it does not supply presentation success or
page-attributed WebGPU residency
([Runtime.getHeapUsage](https://chromedevtools.github.io/devtools-protocol/v8/Runtime/#method-getHeapUsage),
[Tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/)).
The first physical diagnostic must record what CfT 151 actually emits; implementation
alone makes no new Chrome claim, so no rough-edge entry is added yet.

The first physical command was launched on 2026-07-25. Its detached Node/CfT process
completed the approximately 12.5-minute capture and trace-processing lifecycle, then
exited and cleaned its browser/profile processes, but produced neither JSON nor
Markdown. The runner performed environment/source/build revalidation, strict persisted
validation, serialization, and Markdown formatting before creating the result
directory and had no post-capture fallback; any rejection in that sequence therefore
discarded the whole captured attempt. No surviving artifact can establish which
post-capture operation rejected or support a platform conclusion. This is a harness
artifact-retention failure, not a Chrome finding.

The runner now prepares validation, JSON serialization, and Markdown formatting before
writing. If any preparation step rejects, it emits a schema-v1 invalid partial,
admitting environment, heap, latest telemetry, trace-drain state, and each diagnostic
subrecord independently through the persisted validator and dropping only malformed or
non-serializable optional evidence. A persistence exception similarly gets one
fail-closed write of an invalid JSON/Markdown pair under a freshly allocated
machine-temporary emergency directory, rather than retrying the rejected result paths.
Markdown is written before JSON at either sink, so a partial write cannot strand a
complete-looking JSON report without its companion; the runner prints the actual
surviving paths. A machine-wide storage failure can still prevent all persistence and
is reported as such rather than described as recoverable. Environment and source/build
revalidation failures are converted to report failures instead of escaping. This fix
does not recreate the lost evidence and does not itself authorize another browser run.

**Consequences:** The first permitted command execution has been consumed without
reviewable evidence. Do not silently treat the retention fix as permission to rerun it;
any replacement attempt needs explicit adjudication of the lost-artifact condition.
If a replacement is authorized, its artifact will determine whether worker task/stage
attribution is usable, whether current CfT has a trustworthy presentation event, and
which memory fields can support a prospective M1 exit contract. Only a concrete
runtime fix or prospective versioned measurement-contract change based on evidence may
trigger another complete public benchmark. The standing 10% repeatability rule and
every budget remain unchanged.

**Reopen if:** the physical trace cannot retain the positive control or cell marks
without loss; trace overhead materially changes the canonical workload; current CfT
provides a reviewed successful-scan-out/page-attribution contract; or the inventory
shows that the proposed CPU category split overlaps.

## D-110: Stop repeated public benchmark reruns after the one permitted retry and diagnose one canonical repeat first (2026-07-25, accepted; public-benchmark qualification requirement superseded by D-115)

**Decision:** Retain the two complete physical-console
`benchmark-result@1` schema-v3 reports on artifact
`ff05ec211444b89d8c706305205cc60908a140be6af2f2e3ed4ba20a31cded7e`
as failed M1 benchmark qualification evidence. The first complete post-D-109 run and
its one permitted immediate same-artifact retry both fail the unchanged 10%
cross-repeat variance rule. Stop launching the 30-plus-minute public lifecycle to
classify the same failure.

Before any further complete public benchmark, run one privileged physical-console
diagnostic over a single exact `flythrough-d1@1` Showcase repeat. It must preserve the
canonical route, world seed, fixed 3840×2160 worker workload, checkpoint preflight, and
streaming cohort while adding the privileged cross-realm/trace evidence needed to
localize the remaining render/streaming variance. A future full public rerun requires
that diagnosis to produce a concrete implementation fix or a prospective, versioned
measurement-contract change. Neither outcome may retroactively relabel these reports,
discard a measured metric, or weaken the 10% gate to admit them.

The public benchmark is one M1 milestone qualification, not a recurring every-change
gate. Do not repeat it during the dedicated render-recovery qualifier, D-097 smoke,
bulk review, or unrelated gates. After it eventually qualifies, rerun it only when a
concrete change directly affects the benchmark lifecycle, canonical runtime workload,
measurement contract, or evidence being qualified. Recovery and smoke retain their own
independent triggers and verdicts.

**Context:** The first retained post-D-109 report,
`harness/results/benchmark-result-1-ff05ec211444-dev-01-showcase-2026-07-25T21-28-45-673Z.json`,
completed all three exact ten-minute repeats. Streaming cell-load p95 was
2.265/2.915/2.950 ms: every absolute value passed 250 ms, but the 30.243% relative
range failed. Render duration p95 was 0.255/0.250/0.275 ms and passed at the existing
10% boundary; callback p95 was 16.765/16.770/16.770 ms. The permitted immediate retry,
`harness/results/benchmark-result-1-ff05ec211444-dev-01-showcase-2026-07-25T22-04-07-075Z.json`,
again completed all three repeats. Streaming p95 was 2.735/3.325/3.075 ms and failed
at 21.572%; render duration p95 was 0.330/0.375/0.310 ms and failed at 20.968%;
callback p95 remained stable at 16.775/16.785/16.780 ms. Both reports recorded zero
Window Long Tasks.

Independent report replay selected exactly 92 samples per repeat
(sequences 64–155, 219–310, and 374–465) and reproduced each stored nearest-rank p95,
so neither suffix selection nor aggregation explains the verdict. Every boundary
retained 256 packages and 256 open access handles. OPFS-wait p95 remained small
(0.080–0.140 ms) rather than reproducing D-108's removed lookup/open/close residual.
The remaining movement appears across decode round trip, render-upload round trip, and
render-commit round trip rather than one recorded dominant stage. Those page-owned
durations do not distinguish cross-realm scheduling, browser/OS service, or GPU queue
causality. The evidence therefore justifies RE-043's scoped observability question, not
a Chrome defect claim.

**Consequences:** The benchmark plan item remains open and physical qualification has
failed under the standing gate. Its next measured action is the one-repeat privileged
diagnostic, not another three-repeat public run. The two reports remain separately
citable evidence even if a later fix qualifies the same scenario.

**Reopen if:** the privileged diagnosis proves the current metric or comparison
contract is unsound, in which case change it prospectively through a versioned decision;
or a concrete benchmark/runtime fix needs the single milestone qualification rerun.
Do not reopen merely because another unmodified rerun might happen to fall below 10%.

## D-109: Keep CSS viewport geometry as recorded benchmark diagnostics, not fixed-worker comparison identity (2026-07-25, accepted; implementation physically exercised, benchmark qualification failed under D-110)

**Decision:** `benchmark-result@1` continues to retain every raw environment capture,
including `screen.viewportCssPixels`, but schema v3 makes the comparison policy explicit
as `fixed-worker-render-pixels@1`. That policy excludes only
`screen.viewportCssPixels` from cross-boundary equality. Browser/engine version,
artifact, WebGPU adapter, capabilities, hardware concurrency, screen/available-screen
geometry, device-pixel ratio, physical-pixel estimate, color depth, orientation, and all
metric-state identity remain exact. A repeat is still invalid unless D-105/D-107's
independent render-worker evidence proves the selected fixed pixel dimensions at every
checkpoint and the complete flythrough contract passes.

This is a relevance split, not a numeric tolerance or discarded observation. The page
does not measure authoritative compositor presentation and already reports that metric
`unsupported`. Its render workload is fixed by the render-pixel override, its streaming
workload by the canonical route, and its Window Long Tasks counter has no CSS-geometry
input. Raw viewport
movement remains visible to analysts and can still motivate a separate presentation
investigation. A future benchmark with a measured presentation metric must version a
policy that makes the presentation viewport relevant.

**Context:** The retained D-108 physical attempt
`benchmark-result-1-7851397a6f82-dev-01-showcase-2026-07-25T20-35-51-111Z.json`
completed repeat 1's exact ten-minute 3840×2160 route with six exact 4K checkpoint
captures, 256/256 long-lived OPFS handles, no recovery, no Window Long Task, and no
page/console error. Its only before/after environment difference was
`screen.viewportCssPixels.height` 1,586 → 1,585. Screen geometry remained
2,819×1,586 CSS pixels, available geometry 2,819×1,542, device-pixel ratio
1.3625000715, physical estimate 3,841×2,161, and worker render size 3,840×2,160.
Exact all-field equality therefore rejected evidence whose measured workload identity
had not changed.

A bounded physical-console control in pinned CfT 151.0.7922.34 launched native
fullscreen with no viewport emulation and sampled a blank page for 31 seconds; a second
production-app control sampled every 500 ms through boot, all six 4K checkpoint
captures, stabilization, and 109 seconds of measurement. Both stayed at
2,819×1,586 with no resize or page error. This disproves a short fullscreen/startup
settling race, so adding a launch delay would not address the observed failure.
D-034/RE-003 already retain the same fractional-scale environment's integer CSS/device
pixel mismatch. The exact cause of the later one-CSS-pixel report boundary change
remains unresolved; it does not justify either a generic Chrome defect claim or a
silent equality tolerance.

The public telemetry envelope advances to v24. Unchanged mandatory metric sets are
accepted by `smoke@1` schema v43, `flythrough-d1@1` schema v12, and
`render-recovery@1` schema v10. Benchmark section telemetry remains v2 because its
lifecycle shape is unchanged.

**Consequences:** Raw reports can show viewport changes without conflating them with
fixed-worker workload drift, and their policy is machine-readable rather than implicit.
The retained failed report remains valid application-contract evidence and is not
relabelled. D-110's later complete physical reports exercised the schema-v3 lifecycle
and retained their advisory failures; D-115 consumed that evidence and superseded the
former benchmark, recovery-qualifier, and M1-smoke rerun requirements. No retained
verdict changes.

**Reopen if:** the in-game result measures authoritative compositor presentation,
the selected render size again follows CSS layout, worker checkpoint pixel attestation
is removed, or evidence shows CSS viewport changes affect one of the current measured
metrics despite fixed worker dimensions.

## D-108: Open the fixed streaming OPFS handle set once per worker generation (2026-07-25, accepted; fixed-handle workload physically exercised; extra recovery-rerun consequence superseded by D-115; benchmark result retained failed)

**Decision:** After integrity provisioning and stale-package removal, each streaming
worker generation opens and size-validates one synchronous OPFS access handle for every
distinct content-addressed package in its fixed district index. Movement-driven reads
then allocate their destination buffer and call `read()` synchronously through that
already-owned handle; they do not repeat asynchronous directory lookup, access-handle
creation, or close/reopen lock turnover. The worker closes the complete set on terminal
failure and orderly disposal. Public streaming telemetry records the exact package and
open-handle counts plus the generation's aggregate handle-open duration. A streaming
snapshot is eligible only when the counts are positive and equal, and the in-game
benchmark requires that identity to remain unchanged across each measured boundary.

The 10% repeat-variance rule and 250 ms cell-load budget are unchanged. Existing
`opfsAccessRoundTripMs`, `opfsReadMs`, and residual `opfsWaitMs` fields remain at their
documented application boundary; after this change the first covers only buffer
preparation plus the synchronous cached-handle read during movement.

**Context:** The completed physical in-game result
`benchmark-result-1-9a218e2fe23a-dev-01-showcase-2026-07-25T19-54-39-399Z.json`
ran all three exact 3840×2160 ten-minute repeats in one page lineage with no recovery,
page/console error, or Window Long Task. Every individual streaming p95 passed the
250 ms budget at 9.115/28.005/48.025 ms, but their 426.879% relative range correctly
failed scenario evidence. Each repeat selected an exact contiguous 92-sample suffix
(sequences 64–155, 219–310, and 374–465), ruling out the prior suffix/batch-boundary
class. OPFS-access p95 was 7.405/25.780/46.155 ms while direct synchronous read p95
stayed 0.040/0.045/0.045 ms. The high residuals clustered by load batch and later
subsided; neither endpoint monotonicity nor a per-cell data/read slowdown was present.

Code inspection found that D-091's nominally long-lived owner performed
`getFileHandle()` plus `createSyncAccessHandle()` and `close()` for every 3–6 KiB cell
read. A bounded headed physical-console probe in pinned CfT 151.0.7922.34 did not
reproduce the 4K application's tail while otherwise idle: lookup/open/read/close total
p95 was 0.605/0.540/0.540 ms across three 155-operation repeats. It therefore does not
support a generic Chrome lock-leak claim. The same probe successfully held 256 access
handles; startup-open p95 was 0.080 ms and cached-read p95 was
0.270/0.310/0.240 ms. That is sufficient capability evidence for the bounded fixed
district set and removes the only asynchronous operation inside the measured OPFS
access interval, but it is not performance qualification under the real 4K workload.

Streaming telemetry advances to v7 and the public envelope to v23. Unchanged mandatory
metric sets are consumed by `smoke@1` schema v42, `flythrough-d1@1` schema v11, and
`render-recovery@1` schema v9.

**Consequences:** Startup now owns a bounded set of worker-scoped exclusive file handles
for the running district generation. This matches the install/launch/run lifecycle:
installed content is immutable while that generation runs, and a recovery cohort opens
a fresh independently validated set. The later D-110 continuous-page reports physically
exercised the fixed-handle workload and retained their separate advisory repeatability
failures. Because the report plus idle probe localize no browser-internal subphase,
RE-042 remains an application-boundary scheduling observation, not a Chrome defect.
D-115 supersedes the former extra recovery-rerun consequence: later physical evidence
opened the shared generation-initialization set at 256/256 handles in 204.96 ms, without
claiming that the combined post-D-108 fault path was remeasured.

**Reopen if:** the fixed handle count materially harms launch or memory budgets, Chrome
cannot hold the indexed district set on a reference machine, M2 introduces concurrent
package mutation while gameplay remains active, or the next continuous-page result
still shows an OPFS residual variance failure.

## D-107: Require a rendered preflight boundary before checkpoint readback (2026-07-25, accepted; implementation/lifecycle physically exercised; later M1 disposition consumed by D-109/D-110/D-115)

**Decision:** Every flythrough preflight sample now has a generation-scoped,
request-scoped render acknowledgement. The render worker applies the exact scenario
sample, renders one complete frame, and acknowledges that sample's scenario ID,
environment phase, elapsed time, flythrough generation, and worker-observed pixel size.
Only after the engine validates that acknowledgement may it register the Babylon Lite
checkpoint readback; the following render frame services the capture. Reset, recovery,
and teardown reject pending preflight acknowledgements just as they reject pending
checkpoint readbacks.

This adds a causal render boundary rather than a delay or visual-threshold exception.
No public result or telemetry shape changes: `benchmark-result@1` remains schema v2,
the public envelope remains v22, and the current harness report schemas/metric sets
remain unchanged.

**Context:** The first physical M1 benchmark attempt is retained as
`benchmark-result-1-9d5680032be6-dev-01-showcase-2026-07-25T19-09-21-918Z.json`.
Pinned CfT 151.0.7922.34 ran visibly at the physical console with display/system sleep
suppressed and no page or console error. Repeat 1 completed all six exact
3840×2160 captures, but checkpoint 0 (`clear-daylight-start`) reported
`visiblePixelRatio=1` and hash
`7e9c4e59380a5f2bde18d4644c67e9eef193a84d45b9e16e8148b30a4bd575fd`;
all 8,294,400 pixels differed from its recorded clear color. Checkpoints 1–5 matched
the qualified physical flythrough's ratios to the expected dimension rounding, and
checkpoint 0 carried the expected camera/environment metadata. The run correctly
failed before measurement.

Code inspection localized the unproved boundary. Benchmark pixel override publication
recorded a resize when the window posted it, not when the worker had rendered it, and
preflight posted sample and capture requests back-to-back. The capture queue proved
that a frame serviced the readback, but not that a complete frame at the new size and
sample had already preceded readback registration. The retained artifact therefore
cannot distinguish a first-frame resize/resource transition from a camera/environment
state transition, and no finer Chrome or Babylon Lite cause is claimed.

Deterministic tests now hold the preflight-render acknowledgement and prove that no
checkpoint request registers early; render-service tests require exact sample,
generation, and 3840×2160 worker acknowledgement. A bounded local headed experiment
then ran the production build in pinned CfT 151.0.7922.34 at 3840×2160. All six
preflight captures passed without browser errors. Checkpoint 0 measured
`visiblePixelRatio=0.8665915557484568`; checkpoints 1–5 measured
`0.8907927035108024`, `0.8647642988040124`, `0.887058738425926`,
`0.9027319637345679`, and `0.9268149594907408`, matching the prior qualified
presentation apart from the fixed-size pixel rounding.

**Consequences:** Preflight now spends one additional unmeasured frame per checkpoint
to establish state before readback. The existing 180-second preflight timeout and
10-second stabilization remain unchanged. The failed physical report remains evidence
of an application protocol gap, not a platform finding or qualification result.

**Reopen if:** a later physical run produces an incoherent capture after the exact
render acknowledgement, the extra boundary becomes materially expensive in measured
preflight, or Babylon Lite exposes a state-tagged capture primitive that proves the
same ordering directly.

## D-106: Make benchmark ownership synchronous and reset/recovery boundaries bounded and cohort-consistent (2026-07-25, accepted; implementation/lifecycle physically exercised; later M1 disposition consumed by D-109/D-110/D-115)

**Decision:** Benchmark start and public reset publish an explicit `resetting` state
synchronously, before any acknowledgement is awaited. That state owns the flythrough
and observer-control surfaces just like preflight or measurement: duplicate starts,
preset configuration, and standalone flythrough/traversal controls reject until reset
settles. Every continuation crosses its generation check immediately after an awaited
flythrough reset and before changing render state. Render-pixel ownership is recorded
per benchmark generation; disposal synchronously restores that exact prior override
before publishing `disposed`, while a stale async continuation cannot restore over a
newer owner. A direct reset clears its matching in-flight ownership before publishing
terminal `idle` or `failed`, so a synchronous subscriber sees a state it can act on;
the generation-guarded finalizer remains only as fallback cleanup.

Render-worker flythrough reset acknowledgements have a 15,000 ms protocol-liveness
bound. Timeout rejects the pending reset with the exact reason and enters D-104's
existing one-retry whole-cohort recovery; acknowledgement and teardown both clear the
timer. This is a control-protocol bound, not added performance budget headroom and not a
weaker replacement for any existing gate. The render worker also crosses a causal
checkpoint-frame gate: reset cancellation waits until an already-active deferred
readback flush settles and schedules the next worker animation frame before posting the
streaming FIFO boundary. An acknowledgement therefore proves both direct-port
quiescence and render-loop resumption readiness.

Whole-cohort recovery gives the replacement cohort a fresh flythrough generation zero
because old worker handlers and ports have been terminated, while seeding the
replacement render worker's cumulative transport sequence from the exact acknowledged
streaming recovery checkpoint returned by the replacement-service launch. This keeps
the worker-lifetime transport identity continuous without requiring a new serialized
checkpoint field and lets run 1 → acknowledged reset → idle recovery → run 2 reconcile
correctly. Active-run recovery still invalidates the flythrough; its subsequent reset
advances the fresh cohort generation normally.
Each replacement render attempt also retains its latest requested pixel size. If
benchmark cleanup restores the prior override while that attempt is initializing, the
queued worker resize and eventual ready telemetry identify the same size rather than
republishing the attempt's stale start dimensions.

The new serialized `resetting` state advances benchmark section telemetry to v2 and the
combined public envelope to v22. Unchanged metric sets are accepted by `smoke@1` report
schema v41, `flythrough-d1@1` schema v10, and `render-recovery@1` schema v8. The
browser-neutral `benchmark-result@1` report remains schema v2 because its stored result
shape and measurement rules do not change.

**Context:** Adversarial verification demonstrated five production-path races: start
left terminal telemetry visible while awaiting reset; reset acknowledgement could
remain pending forever; replacement render and streaming workers disagreed after a
prior reset; reset acknowledgement could precede deferred capture-flush/rAF
resumption; and disposal could publish `disposed` while a never-settling environment
capture retained the benchmark pixel override. Final verification additionally found
that terminal direct-reset publication preceded release of its in-flight owner and that
late recovery readiness could republish the pixel size captured before benchmark
cleanup. Controlled tests now cover two
reentrant terminal subscribers, deferred start/direct reset ownership, standalone
control locking, heartbeat-alive reset timeout/recovery, structured benchmark failure
cleanup, reset-separated idle recovery identity, a withheld deferred capture flush,
disposal during a never-settling environment capture, synchronous success/failure reset
subscriber restarts, and override restoration during recovery initialization. These are application
protocol corrections; no browser finding is claimed.

**Consequences:** Public consumers must treat `resetting` as benchmark-owned work.
Recovery attempts expose their exact input checkpoint internally so the render service
can seed the replacement transport identity. Terminal reset publication means that
matching reset ownership has already cleared. A healthy reset can take up to the fixed
15-second liveness bound; exceeding it consumes the single D-104 recovery attempt and
remains a structured failure if cleanup cannot complete.

**Reopen if:** recovery begins preserving in-flight flythrough work instead of
invalidating it, reset quiescence moves to a browser primitive with an independently
measured bound, or benchmark disposal becomes an explicitly awaited reusable-result
operation.

## D-105: Ship M1 benchmark mode with in-game ownership and fail-closed page observability (2026-07-25, accepted; amended by D-106/D-109/D-110/D-115, implementation task completed by D-115 with failed advisory results retained)

**Decision:** Implement D-025's M1 benchmark as the game-owned
`m1-benchmark@1` definition over the exact `flythrough-d1@1` scenario and D1 world
seed. The engine owns orchestration and measurement, the game owns the definition,
fixed presentation presets, labels, and report formatting, and the app shell only
mounts the public controls. Showcase is fixed at 3840×2160 with a 60 Hz target and
Standard at 2560×1440 with a 120 Hz target. A run performs exactly three repeats in
one page lineage. Every repeat explicitly resets the completed render-worker
flythrough, performs the existing six GPU-backbuffer checkpoint preflight and fixed
10-second stabilization, and then runs the worker-owned ten-minute route. The page
owns measurement boundaries, progress, aggregation, variance, verdicts, and export.
Manual controls and URL automation call the same public `startBenchmark`,
`configureBenchmark`, `resetBenchmark`, and result-retrieval methods; automation may
launch or retrieve but contributes no timing.

The public artifact was introduced as browser-neutral `benchmark-result@1` schema v2
and advances to schema v3 under D-109's explicit environment comparison policy. This intentionally
refines D-025's phrase “same telemetry/result schema”: the mode embeds the same exact
scenario contract, complete flythrough telemetry, metric-state vocabulary, facets,
budgets, and variance rules, but does not pretend that an unprivileged page can emit
the harness's privileged `flythrough-d1@1` report byte-for-byte. The harness result
retains fresh-profile host/driver/power/console, CDP trace/Dawn, all-realm heap, and
presentation evidence. The in-game result records those fields as `unsupported` or
`not-applicable`, never estimates them. It measures render-worker callback/render
distributions, representative streaming cell-load p95, and Window Long Tasks over the
route. Its repeat lineage is explicitly `continuous-page`; it is not directly
comparable with the harness's independent fresh-profile repeats unless a future
scenario deliberately aligns that policy. Because page APIs cannot attest the
registered host, full driver, power scheme, physical-console session, or authoritative
presentation success, the current in-game Chrome result is advisory and its budget
facet is `not-evaluated`. Non-Chrome results are also advisory. Missing baseline
capabilities produce a structured capability failure with `passed: false` and retain
the environment capture that established the failure. Every run retains all environment
captures. D-109 keeps CSS viewport geometry as a recorded diagnostic while every
comparison-relevant field must equal the initial capture across all three repeats, not
merely within each repeat.

The benchmark owns the flythrough and streaming-observer control surfaces exclusively
from environment capture through aggregation. Public standalone flythrough and
synthetic-traversal controls reject during that interval, and a traversal already
running in the app stops before benchmark preflight. The engine independently validates
the completed scenario, route, ordered environment phases, full streamed-presentation
ownership, render distributions, exact streaming observer deltas, all checkpoint
content, and each checkpoint's worker-rendered pixel dimensions against the fixed
preset. Timeout and runtime failure abort the worker route/preflight, finish any active
Long Tasks observer, restore the exact prior render-size override, and emit a structured
invalid attempt/report. Completed, failed, and aborted flythroughs share one acknowledged
reset path: checkpoint readbacks are cancellable, the render worker stops route emission,
and a FIFO boundary waits for streaming scheduling and all earlier direct-port observer
traffic to settle before the flythrough becomes idle or aborted. Run-local observer
sequence restarts remain distinct from the worker-lifetime cumulative transport sequence,
and generation tags reject late prior-run traffic. Destroying the benchmark service is
different from a runtime result: disposal cancels work, restores ownership, and publishes
`disposed`, but does not promise a reusable report from a service that no longer exists.

The combined public telemetry envelope advances to v21. `smoke@1`,
`flythrough-d1@1`, and `render-recovery@1` accept that producer contract at report
schemas v40, v9, and v7 respectively; their mandatory metric sets remain v20, v6, and
v3 because benchmark telemetry changes no existing gate metric. Flythrough telemetry
advances to v3 for the explicit aborted state. The benchmark service
adds an explicit fixed render-pixel override and an awaitable FIFO render/streaming
flythrough reset; `resetBenchmark()` returns that Promise so callers cannot race reset
completion. Resize observation is ignored while the preset is active. The app provides an
always-available accessible panel, progress, fixed-preset selection, human-readable
summary that lists every check and evidence failure, JSON/text download, and
user-initiated clipboard copy with awaited accessible success/failure feedback.

**Context:** Current platform documentation checked 2026-07-25 supports the chosen
identity and observability boundary. [User-Agent Client Hints](https://wicg.github.io/ua-client-hints/)
defines the UA-CH identity surface, and the [WebGPU adapter information
contract](https://gpuweb.github.io/types/interfaces/GPUAdapterInfo.html) exposes only
the adapter fields captured here. [Long Tasks](https://www.w3.org/TR/longtasks-1/) is
Window-scoped, so worker long tasks remain unsupported. [Window
Management](https://www.w3.org/TR/window-management/) describes screen placement and
permission surfaces, not physical-console or remote-session attestation; [Battery
Status](https://www.w3.org/TR/battery-status/) does not establish OS power scheme,
display routing, or reference-machine eligibility. A local Node 24.18.0 validation
caught and corrected an initially invalid SIMD feature-probe module. Pinned local
typecheck and focused tests cover reset-and-rerun service lifecycle, never-settling
checkpoint cancellation, acknowledged streaming quiescence, cumulative transport versus
run-local observer sequence across two generations, late old-generation traffic
rejection, failed/aborted reset ordering, synchronous terminal-subscriber reentrancy
after ownership restoration, exact observer/pixel-size/route-span/render-state
attestation, cross-repeat environment drift, capability-environment retention, timeout
cleanup, unsupported metrics, complete formatting, clipboard feedback, and the
no-driver ownership audit. No performance or physical-console qualification claim is
made by those tests.

**Consequences:** D-025 remains the product direction, amended by the explicit
two-contract boundary above. The harness stays authoritative for D-097 budget gates;
the public benchmark is useful today for reproducible advisory browser/hardware
inspection without silently weakening evidence requirements. A future privileged
browser API or separately attested launcher can promote individual fields to
`measured`, but only through a new result schema and comparison-eligibility decision.
The M1 plan item remains open until adversarial review and one manual physical-console
run prove the complete 30-plus-minute UI lifecycle and exported artifact.

**Reopen if:** page APIs gain trustworthy host/driver/power/session/presentation or
worker/all-realm measurement surfaces; the harness adopts continuous-page repeats; or
a physical run shows that reset, fixed resolution, checkpoint warm-up, or export
semantics diverge from the canonical flythrough.

## D-104: Recover the complete render/streaming cohort once and qualify real browser faults separately (2026-07-25, accepted; physically qualified)

**Decision:** A render-worker or WebGPU-device failure restarts the complete coupled
render/streaming/decode cohort at most once. Recovery creates a new render worker, a
new streaming worker and decode pool, a new `OffscreenCanvas`, a new direct streaming
port, and new SAB rings. The streaming worker owns a generation-tagged settled
checkpoint containing immutable observers, sorted resident-cell IDs, and total/direct
observer sequences. Production recovery deliberately rolls back to the latest
worker-acknowledged checkpoint rather than an unacknowledged in-flight observer, then
requires the replacement worker to rebuild that exact residency and sequence identity.
Cohort recovery is published only after both the replacement render first frame and
streaming checkpoint hydration complete, in either order. Streaming hydration failure
is terminal for render too. A second fault is terminal:
the render recovery state becomes `exhausted`, the streaming cohort becomes `failed`,
and the restart count remains one. There is no unbounded retry or partial reuse of
potentially poisoned worker-owned state.

Qualify this behavior with the dedicated `render-recovery@1` browser scenario rather
than injecting faults into routine `smoke@1` or `flythrough-d1@1`. Three independent
fresh-profile attempts exercise the actual render-worker diagnostic paths:
`GPUDevice.destroy()` recovery, silent worker `close()` recovery detected by the
heartbeat, and device loss followed by a second silent close. The driver may invoke the
public diagnostic methods and collect evidence, but recovery state is produced by the
application. A successful recovery must complete within 30 seconds, advance render and
streaming generations together, complete a fresh SAB workload, restore decoder/world
telemetry, render a non-blank canvas, and restore the exact moved checkpoint's observer,
resident-cell, and observer-sequence identities. The movement precondition begins after flythrough preflight and
requires at least 96 m of subsequent direct render-to-streaming observer travel plus a
different settled cell set, preventing the test from passing only at the boot location.

Streaming telemetry advances to schema v6 with `settledRecoveryCheckpoint`; mutable
`currentObservers` remains live scheduling telemetry and is never a recovery cache.
The diagnostic uses one application-owned quiesce/fault-boundary handshake: the render
worker stops direct observer movement, the streaming worker settles and returns the
exact authoritative checkpoint, and only then does the render worker inject the real
fault. The combined envelope advances to v18; `smoke@1` advances to schema v37 / metric
set v20 and `flythrough-d1@1` to schema v6 / metric set v6 because their validators now
require the settled checkpoint. The dedicated result contract advances to schema v3 /
metric set v3, records fresh-profile measured-process environment identity for every
attempt, gates all three first recoveries, and preserves partial boundaries, elapsed
failure duration, and browser errors when an attempt fails. Its validator recomputes
the pinned executable/product, sandboxed command line, local host/display, requested
tier, and fresh-profile invariants from retained fields. It also binds every healthy
boundary to the exact current settled streaming checkpoint and canonical SAB contract,
and requires the first recovery to retain the flythrough's invalidated state.

**Context:** The first recovery implementation cached observers only when the window
called `WorldStreamingService.setObservers()`. During the ten-minute flythrough, the
render worker sends observer updates directly to the streaming worker, so that cache
could remain at the preflight position and restart the district at the wrong cells.
The new producer telemetry closes that cross-port ownership gap and makes the retained
position and resident set independently observable. Focused local verification covers
the direct-observer cache, retry state machine, result validator, and scenario ordering;
the first registered physical-console report,
`render-recovery-1-c3ded41419dc-dev-01-showcase-2026-07-25T13-21-01-582Z.json`,
is retained as a failed qualification. Its environment facet passed, but all three
attempts stopped before the initial evidence boundary because the Playwright callbacks
referenced the Node-realm `recoveryTelemetry` helper after serialization into the page
realm. Bounded recovery was therefore not evaluated. This is a harness implementation
failure, not application recovery evidence or a browser rough edge. The retained report
also records `contractValidationFailure` because the validator incorrectly required
successful attempt evidence before accepting each attempt's independently captured,
validated environment identity; that validator/runner inconsistency is fixed without
rewriting the retained artifact. The runner now uses one detached-safe page-realm
operation that explicitly validates the public telemetry global, with serialization and
call-site regression coverage.

The next registered physical-console report,
`render-recovery-1-c3ded41419dc-dev-01-showcase-2026-07-25T13-37-09-496Z.json`,
is also retained as a failed qualification. Its environment passed and its report
contract validated, but every attempt again stopped before the initial evidence
boundary with `Recovery boundary requires a settled streaming checkpoint`. The
detached initial-cohort wait proved render/streaming state, worker generations, SAB
completion, resident count, and observer-counter equality without requiring the
concrete `settledRecoveryCheckpoint`. The streaming worker can legitimately publish
those fields before its final settled-checkpoint publish, so the wait could resolve
against that transient snapshot and race the immediately following boundary capture.
This is a second harness readiness failure; it does not evaluate recovery behavior and
does not establish a browser rough edge. The detached dispatcher now keeps every
boundary-producing wait pending until a non-null checkpoint exactly matches the live
streaming generation, total/direct observer counters, observers, and sorted unique
nine-cell residency. Detached-realm regressions reject both null and stale checkpoint
snapshots.

The third registered physical-console report,
`render-recovery-1-c3ded41419dc-dev-01-showcase-2026-07-25T13-48-46-809Z.json`,
is retained as another failed qualification. Its environment and report contract
passed, but all three attempts still captured a null checkpoint immediately after the
initial wait and stopped before the first evidence boundary. The exact-checkpoint
predicate was correct but its shared dispatcher was declared `async`; pinned
Playwright 1.61.1's `waitForFunction` polling loop tests the predicate's immediate
return value for truthiness without awaiting it, so the returned `Promise<boolean>`
ended every wait even when it later resolved to `false`. This was verified locally on
2026-07-25 against pinned Node 24.18.0, Playwright 1.61.1, and CfT 151.0.7922.34: for a
flag flipped after 600 ms, the synchronous predicate waited 620 ms and returned
`true`, while the async predicate returned after 3 ms and its handle resolved to
`false`; the installed Playwright polling implementation independently shows the raw
`predicate()` result entering the truthiness branch. This is a third harness-only
failure; recovery was not evaluated and no platform finding is claimed. All six
recovery waits now use a separate detached-safe synchronous boolean dispatcher, while
the three `page.evaluate` actions retain their async dispatcher for the awaited fault
boundary. Regression coverage rejects thenable wait results and binds every
`waitForFunction` call to the synchronous dispatcher; an audit found no async predicate
among the harness's other waits.

The fourth registered physical-console report,
`render-recovery-1-c3ded41419dc-dev-01-showcase-2026-07-25T14-04-02-438Z.json`,
is retained as a failed qualification. It is the first report to reach real recovery:
the worker-crash attempt proved generation-1 movement from observer sequence 7 to 158,
advanced proactive evictions from 63 to 64, recovered the complete render/streaming
cohort as generation 2 in 8,528.327 ms, restored the exact moved checkpoint, completed
the fresh SAB workload, retained flythrough invalidation, and rendered a visible canvas.
Its otherwise valid generation-2 streaming snapshot had zero cell loads and zero
proactive evictions because exact checkpoint hydration required no redundant work. The
generic streaming snapshot validator incorrectly applied generation-1 measurement-
history requirements to that fresh hydration snapshot. Recovery validation now uses an
explicit lifecycle policy: initial and pre-fault boundaries require positive retained
history plus positive observer/load/eviction deltas, while recovered hydration allows
zero reset/no-op counters but keeps exact checkpoint/current identity, resource bounds,
zero CPU rejection, fresh SAB, residency, decoder/world, and generation invariants.

The device-loss and exhaustion attempts failed during flythrough preflight with the
generic `Flythrough rendered checkpoint evidence is incomplete or blank`. Code
inspection localized an application race: the window posted a preflight sample and
immediately posted capture, so the render worker could apply the sample and read back
the preceding framebuffer before its next animation frame. The intermittent outcome
(two failures and one successful preflight across identical independent profiles) is
consistent with that ordering race, but the developer also reported that the physical
monitor had gone to sleep during these runs. A sleeping display may have contributed to
the visual failures, so this retained report cannot apportion their observed frequency.
It does not remove the independently demonstrated frame-before-readback race or make the
report valid, and neither condition is evidence of a Chrome defect. Every current
Windows physical harness entrypoint (`smoke`, `flythrough-d1`, `render-recovery`,
`memory64-spike`, and `app-owned-llm-spike`) now sends an inert F15 key through
`WScript.Shell` immediately before every Chrome context launch, including
identity/reference and measured launches, and fails closed if that preflight cannot
run; workflow also requires the operator to confirm the monitor is visibly awake.
The first queue correction kept checkpoint requests pending until the animation loop
rendered the applied sample, then claimed that frame's requests and deferred invoking
readback until after the callback returned. The next registered report showed that
ordering was still wrong for Babylon Lite's frame-serviced capture queue. The visual
threshold remained unchanged.
Checkpoint validation now identifies the exact checkpoint and failed field. Failed
attempt partials retain the latest complete telemetry snapshot, including the
incrementally published checkpoint list, and Markdown reports summarize its state,
checkpoint count/last visible ratio, and render/streaming generations. This partial
shape advances only the dedicated report schema to v4; metric set v3 and application
telemetry schemas are unchanged. The retained schema-v3 report remains immutable. This
is a mixed harness-contract/application-preflight failure, not a platform finding, and
does not qualify D-104 despite the worker-crash attempt's positive recovery evidence.

The fifth registered physical-console report,
`render-recovery-1-f0cd7621fca7-dev-01-showcase-2026-07-25T15-58-46-432Z.json`,
is retained as failed. Its environment and persisted contract passed, and all three
attempts captured the initial boundary, but each then timed out after 180 seconds in
flythrough `preflighting` with zero checkpoint evidence, render/streaming generation 1,
and no browser errors. Source inspection of pinned Babylon Lite 1.12.0 confirms that
`captureScreenshot` synchronously registers a request and that only a subsequent
`renderFrame` records and submits it. The prior queue instead deferred capture
registration until after the just-rendered frame, then withheld the next frame while
awaiting that unserviced request, creating an exact screenshot-queue/render-frame
circular dependency. The identical boundary across three fresh attempts and this
installed-source contract identify an application scheduling bug; recovery was not
reached and no browser finding is claimed. The corrected queue registers capture
synchronously when the checkpoint request arrives, lets the next animation frame
service it, claims exactly that frame's requests, returns from the callback, and uses a
deferred macrotask only to await and publish the already-submitted evidence. Animation
resumes after all claimed requests settle. Requests arriving after the serviced frame
remain queued for the next rendered frame, and one failed request does not prevent its
same-frame peers or the render loop from progressing. Regression coverage uses a
frame-serviced capture fake that cannot resolve before the render signal and directly
guards pinned Lite's synchronous registration contract. Because attempts span many
minutes, the display wake is also moved from one run-level preflight to immediately
before every identity and measured Chrome context launch. These corrections do not
change the schema-v4 / metric-set-v3 result shape.

The sixth registered physical-console report,
`render-recovery-1-7f6f65d9c6fd-dev-01-showcase-2026-07-25T16-26-52-162Z.json`,
physically qualifies D-104. Schema v4 / metric set v3 passed its environment, evidence,
and three-check bounded-recovery facets with no run or contract-validation failure on
artifact `7f6f65d9c6fdb6e187ebaccbf547456ae3d767842a9613524034cc527ba1a0a1`,
source commit `6f2fb1e9814904c733a64b4a629051c46c3fe145`, and dirty-tree digest
`6f803448b48aaffa4f046f3f46d45e12766fcf1062fb38727379b385f7a833d4`.
All three independent fresh-profile attempts restored the exact moved generation-1
checkpoint as render/streaming/checkpoint generation 2 with nine resident cells,
matching observer and total/direct sequence identities, a fresh completed 100,000-
message SAB workload with zero sequence or payload errors, restored decoder/world
evidence, retained flythrough invalidation, and 87.502799% visible-canvas coverage.
Fault-boundary-to-ready recovery measured 2,332.244 ms for device loss, 5,617.312 ms
for the silent worker crash, and 2,332.155 ms for the exhaustion attempt's first
recovery. The exhaustion attempt's second silent worker close produced the expected
`Render worker heartbeat exceeded 3000 ms` browser error and left render failed with
recovery `exhausted`, streaming `failed`, generation 2, and restart count one. This
expected terminal diagnostic is contract evidence, not a browser finding.

The implementation and dedicated recovery report are qualified. Final exact-artifact
D-097 report
`smoke-1-7f6f65d9c6fd-dev-01-showcase-2026-07-25T16-36-37-999Z.json`
then passed schema v37 / mandatory metric set v20 across all six core runs, all three
facets, and 30/30 evaluated checks with no core-run failure. Its warm-repeat-3 core
trace completed after 5,315.897 ms with 71,365 events in 404 chunks,
11,729,783 serialized bytes, and `dataLoss=false`; D-094 already admits this complete
lossless drain under the unchanged ten-second routine-smoke validity bound. This closes
the render-worker robustness plan item without changing the recovery budget or adding
a duplicate browser finding.

**Consequences:** Recovery is intentionally a bounded rollback and visible whole-cohort restart, not
seamless continuation of an active flythrough; the versioned regression flythrough is
invalidated if recovery occurs inside its measurement. The dedicated scenario is the
only routine fault-injection path. Its 30-second bound is a recovery qualification
limit, not a player-visible frame or launch budget and does not imply that a long stall
is acceptable UX. No browser rough edge is claimed from these retained runs.

**Reopen if:** representative recovery cannot restore the exact moved settled checkpoint,
measurements show the whole-cohort policy is too slow, a future browser/API provides a
safe in-place device replacement, or later coupled workers require a broader atomic
restart boundary.

## D-103: Preserve failed smoke streaming evidence and admit conserved unsettled residency (2026-07-25, accepted)

**Decision:** Retain failed exact-artifact report
`smoke-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-15-06-917Z.json`
for artifact
`20770c3a4d6dba436a287cb77d60e6842e1c86dd5aa4ac82da3dcfc4b953747e`
and do not rerun it until the failure is diagnosable. The report passed environment
identity but stopped after three of six core runs when warm repeat 2 / launch 4 emitted
only `World-streaming telemetry does not satisfy the M1 streaming contract`. Schema
v34 discarded that invalid attempt's streaming start/end snapshots, so the exact
rejected field is not recoverable and this report cannot prove the cause.

Advance routine `smoke@1` report schema to v35, with mandatory metric set v18
unchanged. A streaming-validation failure now retains its localized reason and complete
raw measurement-start and measurement-end streaming snapshots under the structured
core-run failure. Successful v35 streaming values retain the measured start resident
count so stored-report validation can recheck conservation rather than infer it.
Snapshot validation reports the failed contract group and observed values instead of
one aggregate error.

Correct one independently demonstrated valid-state rejection before the next physical
run. The short smoke window does not wait for streaming settlement at either boundary.
The producer evicts before loading replacements and publishes after each eviction and
completion, so an unsettled snapshot can legitimately contain fewer than nine
residents. Require exactly nine residents only when the snapshot's settled-observer
watermark equals its total observer count. Across start/end snapshots require exact
conservation:

`end residents - start residents = completed-load delta - proactive-eviction delta`.

This replaces the former loose absolute skew check and does not weaken D-102's batch,
observer, ordering, completeness, attribution, or settled-boundary invariants. A
deterministic short-window model now covers a non-flythrough sequence, a complete prior
boundary batch, an unsettled start, a non-full ring, and both an active partial end
batch with eight residents and a fully settled nine-resident end. Invalid diagnostics
also prove that both raw snapshots and the localized reason survive.

**Context:** The preceding three runs in the failed report produced valid streaming
evidence. Because launch 4's raw payload was not retained, it is not honest to label
that failure as the transient-residency case after the fact. Code inspection and the
producer model nevertheless prove that the old unconditional nine-resident predicate
rejected a reachable state and contradicted the already documented evict-before-load
snapshot semantics.

Physical confirmation
`smoke-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-34-23-655Z.json`
then passed the exact artifact
`20770c3a4d6dba436a287cb77d60e6842e1c86dd5aa4ac82da3dcfc4b953747e`
under schema v35 / mandatory metric set v18: all six runs, environment/evidence/budget
facets, and 30 evaluated checks passed with no core-run failure. This qualifies the
final tree without reinterpreting the preceding schema-v34 failure; launch 4 there
remains retained and unknowable because its raw streaming snapshots do not exist.

**Consequences:** The D-100/D-102 flythrough qualification remains closed and passing.
The final D-097 exact-artifact routine smoke qualification now passes. A future
streaming-validation failure will identify the precise snapshot field and preserve
enough evidence for a start/end diff. The later M1 exit remains open for its standing
budgets outside the flythrough and smoke metric sets.

**Reopen if:** a retained schema-v35 failure disproves the conservation model, the
producer publishes a settled snapshot below nine residents, or a different repeatable
validator or producer defect appears.

---

## D-102: Retain the flythrough streaming-tail failure and add bounded attribution (2026-07-25, accepted)

**Decision:** Keep the failed physical `flythrough-d1@1` report
`flythrough-d1-1-68c66fccf453-dev-01-showcase-2026-07-25T08-17-32-898Z.json`,
the 250 ms absolute streaming budget, and the standing 10% repeat-variance limit
unchanged. Do not tune cell concurrency or scheduling from an unattributed tail.

Streaming telemetry v3 gives every completed load a deterministic load-batch ordinal,
cell ordinal/count, and the observer/flythrough sequence that selected the batch. The
streaming worker measures ordered boundaries on its own `performance.now()` clock:
OPFS access, decode round trip, render-upload round trip, render-commit round trip, and
post-commit streaming-worker remainder. Existing nested-worker `decodeMs`, sync-read
`opfsReadMs`, and render-worker `uploadMs` remain local duration observations; the
corresponding wait values are the same-clock round trip less that local work duration,
clamped at zero. No timestamp is compared across realms.

Evidence validation fails closed unless batch identity is consistent and each
round-trip/direct-work/wait decomposition, plus the full cell-load decomposition, agrees
within 0.1 ms. Distinct batches require distinct, increasing total-observer identities;
flythrough-sequence progress cannot exceed total-observer progress. Cell ordinals and
cell IDs are unique within a batch. Recorded batches begin at ordinal 2 because ordinal
1 is launch hydration while sampling is disabled; observer identity is positive, and
an ordinal cannot exceed its observer identity plus one or its sample sequence plus
one. Every batch wholly inside the measurement window
must contain exactly its declared cells. A partial leading batch is accepted only when
the start snapshot records completed cells from that exact batch and its observer
identity is newer than the start's settled-observer watermark; a partial trailing batch
is accepted only when the end snapshot is unsettled and that batch's observer identity
is newer than the last settled observer. The end settlement watermark cannot regress
behind the start. Every first measured batch, including one after a zero-sample start,
must be newer than the start settlement watermark. The start record retains the last batch identity even at a settled
boundary so the first measured batch cannot skip or reuse an ordinal. An ordinal
successor requires a complete retained boundary batch and must also carry a
total-observer identity strictly newer than both that retained batch and the start's
settled watermark, with producer-valid flythrough progress. The retained raw
pre-window prefix must itself have consistent, ordered batch identity. Stored
start-batch metadata must match it; completed ID/ordinal pairs match exactly when the
full boundary is retained and otherwise the demonstrably truncated raw suffix must be
a subset of the stored facts. A boundary cannot claim more completed cells than the
total start sample count. A null start-batch record is valid
only when the start cell-load count is zero; a nonzero start must retain its last batch
identity even after its raw prefix ages out of the end ring. Settled flythrough start/end
boundaries therefore admit no incomplete batch. Reports retain those explicit
start-boundary facts, raw samples, and derived attribution p95s. This observation change
advances public telemetry to v15, streaming telemetry to v3, routine `smoke@1` to report
schema v34 / mandatory metric set v18, and `flythrough-d1@1` to report schema v4 /
mandatory metric set v4. The flythrough subsystem section remains v2.

**Context:** The first D-101 physical run on artifact
`68c66fccf453fcbe5451f1c68ad5a755d97afe644ecae16b80c1921dcaa0803d`
completed all three ten-minute repeats with valid environment identity. Each repeat
retained 92 streaming samples, 3,002 heap samples with no missed deadline, and a
complete lossless approximately 426–429 MB Dawn trace that drained in
19,152.6–19,837.0 ms. All 15 observed budget checks passed. The aggregate nevertheless
failed evidence completeness: streaming cell-load p95 was 23.975, 30.820, and
22.230 ms, a 38.641% relative range against the unchanged 10% limit.

The distribution was stable below that tail: repeat medians were
11.870–12.765 ms, means 12.823–13.852 ms, and p90s 21.445–23.325 ms. Direct substage
p95s were only 0.100–0.105 ms for sync OPFS reads, 0.140–0.195 ms for decode work,
and 1.500–1.915 ms for upload work. The old fields therefore left
21.550–29.945 ms of p95 schedule-to-commit time unattributed. The flythrough report is
schema v3 and embeds streaming telemetry v2; neither records batch identity. A
deterministic replay of the recorded cell sequence through the unchanged scheduler—not
evidence contained in the report—partitions repeat 2, when viewed as the two
nine-sequence windows, as 3/1/3/1/(a two-cell batch crossing the window boundary) for
sequences 82–90 and 1/3/1/3 for sequences 91–99. The true tail clusters are inferred
three-cell batches 86–88 and 97–99, with peaks of 33.385 and 31.120 ms. That is real
pipeline wait/scheduling exposure, not timer quantization or a nearest-rank error, but
the v2 evidence cannot localize it to OPFS handle acquisition, decode queue/message
transit, render request transit, commit acknowledgement, or streaming bookkeeping.
RE-040 retains the unresolved observation.

That report stays failed: its budget facet is correctly `not-evaluated` because
mandatory repeatability evidence is incomplete, even though its 15 individual
observations are under their absolute limits. No baseline is promoted from it.

The final D-102 physical report
`flythrough-d1-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-07-24-028Z.json`
then passed environment, evidence, and budget facets, all 15 evaluated checks, and all
three measured repeats on artifact
`20770c3a4d6dba436a287cb77d60e6842e1c86dd5aa4ac82da3dcfc4b953747e`.
Streaming cell-load p95 was 22.810, 23.895, and 22.000 ms; the 8.614% relative
range passed the unchanged 10% gate. Every repeat retained 3,002 heap samples with no
missed deadline and a complete lossless trace. Component p95s localize the dominant
bounded interval to OPFS access wait at 17.635–18.025 ms; decode wait was
1.835–2.180 ms, render-upload wait 1.595–1.770 ms, render-commit round trip
1.975–2.205 ms, and streaming-worker remainder 0.010–0.015 ms. This is
application-stage attribution, not evidence about which browser or operating-system
operation inside OPFS access owns that wait.

**Consequences:** The physical run identifies OPFS access wait as the dominant bounded
stage without changing runtime scheduling behavior or weakening either gate. Both the
short smoke traversal and long flythrough reject malformed attribution and retain the
same batch identity needed to compare crowded and sparse replacements. The scripted
flythrough plan item is qualified; the later M1 exit item remains open because this
runner explicitly omits compositor presentation, aggregate CPU/WASM/SAB/GPU memory,
worker long tasks, visible-pop visual diff, and D1-to-D2 transition budgets.

**Reopen if:** the v3 decomposition is internally inconsistent on a real run, its added
instrumentation materially changes cell-load behavior, the tail is localized and calls
for a separately measured runtime change, or a browser-native cross-worker scheduling
timeline can replace these application-level round trips.

---

## D-101: Scale long-run trace and heap collection to retained physical evidence (2026-07-25, accepted)

**Decision:** Keep D-094's `smoke@1` trace contract unchanged at a 10,000 ms validity
deadline plus a 10,000 ms late diagnostic window. For the 600,000 ms
`flythrough-d1@1` window only, accept a complete readable trace with
`dataLoss=false` through 30,000 ms after `Tracing.end`, then remain attached for a
further 10,000 ms diagnostic window. Completion after 30 seconds remains invalid but
retained; no completion through 40 seconds, unreadable evidence, or any reported data
loss still fails closed. This is a payload-scaled off-window collection bound, not a
gameplay-duration or performance-budget allowance.

Also sample the flythrough's exact seven-isolate topology on fixed 200 ms start
deadlines. D-047's `smoke@1` interval remains 100 ms. The long-run sampler still sums
near-concurrent `Runtime.getHeapUsage.usedSize` responses per sample, gates the largest
observed aggregate, retains all response/cadence diagnostics, and invalidates response
skew, collection duration, or start delay at least as large as its configured interval.
The measurement-end sample substitutes only for the latest due deadline; every earlier
deadline is now matched by its exact scheduled timestamp rather than inferred from the
aggregate sample count. A skipped intermediate deadline therefore cannot be hidden by
a later periodic sample. The scheduler also advances by at least one interval from its
previous deadline so an early timer cannot collect the same scheduled deadline twice.

The flythrough report advances to schema v3 and mandatory metric set v3. Public
telemetry remains v14, its flythrough section remains v2, and routine `smoke@1` remains
report schema v33 / mandatory metric set v17 because neither public runtime evidence nor
the smoke collector changed.

**Context:** The first two physical-console attempts on identical artifact
`68c66fccf453` both completed the complete ten-minute route but remained invalid.
Report
`flythrough-d1-1-68c66fccf453-dev-01-showcase-2026-07-25T07-13-41-667Z.json`
retained a complete lossless trace containing 2,511,021 events in 14,058 chunks /
419,019,736 serialized bytes. `Tracing.end` returned in 0.3 ms and completion arrived
after 19,484.2 ms. Report
`flythrough-d1-1-68c66fccf453-dev-01-showcase-2026-07-25T07-25-16-847Z.json`
retained 2,527,527 events in 14,209 chunks / 428,288,884 bytes with
`dataLoss=false`; `Tracing.end` returned in 0.2 ms and completion arrived after
19,208.2 ms. Effective serialized delivery was approximately 21.5–22.3 MB/s. These are
large, steadily draining payloads, not RE-008's historical zero-event/nonterminal
signature. D-094 explicitly required reopening when valid drains approached or
exceeded ten seconds; applying its smoke-sized bound unchanged made the mandatory
full-window trace structurally ineligible.

The second report also retained one browser-wide/CDP heap-collection outlier at
478,100 ms. All seven realm responses completed after 139.1–169.5 ms, versus a
14.5 ms next-slowest collection in that run, and the sampler correctly skipped the
478,200 ms deadline rather than overlapping commands. Maximum fixed-deadline start
delay remained 15.9 ms. The collected schedule contained 6,000 periodic samples plus
the boundary sample, but its old count-based summary incorrectly reported zero missed
deadlines because a later sample masked the skipped intermediate timestamp. The first
report covered all 6,001 due timestamps but also issued five duplicate scheduled
captures after early timers, plus the boundary sample; its maximum collection duration
was 10.3 ms. A 200 ms interval is the smallest round fixed cadence
above the measured 169.5 ms whole-topology collection and still yields at least 3,000
full-topology observations per ten-minute repeat. It deliberately reduces temporal
resolution from 100 ms; RE-012's sampled-estimate limitation and exact high-water
honesty remain.

Both reports remain invalid under the contracts that produced them. Their environment
facets also fail closed because the primary trace/heap exception occurred before the
post-window display and host probes, leaving those structured attempt fields null; the
available pre-window identity remains retained. No result is promoted and the M1 plan
item remains open.

**Consequences:** The next physical run can retain the required full-window Dawn trace
without treating deterministic transfer time for roughly 420 MB as a gameplay failure,
while a stalled or lossy trace still fails closed. The heap collector reduces its
long-run CDP command volume from roughly 42,000 to 21,000 realm requests per repeat and
continues to expose every sample and any missing exact deadline. The larger trace
deadline and coarser heap interval are flythrough-specific; they cannot silently relax
routine smoke or any other scenario.

**Reopen if:** a complete flythrough trace exceeds 30 seconds, payload size or drain
throughput changes materially, a narrower trace can prove the same full-window Dawn
contract, a 200 ms heap sample still misses deadlines, or Chrome exposes continuous
cross-isolate heap high-water and page-correlated trace-completion diagnostics.

---

## D-100: Make `flythrough-d1@1` the worker-owned M1 regression scenario (2026-07-25, accepted; refined by D-101/D-102/D-103)

**Decision:** The versioned M1 regression scenario is `flythrough-d1@1`: a 600,000 ms,
7,200 m route through D1 at D-090's fixed 12 m/s. Game code owns the route and six
contiguous 100-second environment phases; engine code validates and executes that
scenario through typed contracts; the harness sees only the public telemetry schema and
public start/preflight operations. The ordered phases are clear daylight, overcast
daylight, storm dusk, storm night, overcast dawn, and clear daylight finish.

One start message transfers the complete scenario to the render worker. From that
boundary onward the render worker owns elapsed-time sampling on its
`requestAnimationFrame` loop, camera placement, environment application, aggregation,
and sequenced observer updates sent directly to the streaming worker over their
dedicated `MessagePort`. Observer updates are emitted on the first frame, at least every
50 ms of callback time, on every environment transition, and at completion; evidence
requires at least 8,000 contiguous updates over the ten-minute route. The window does
not pace the route. During the measured route,
D-091's resident streamed meshes own visible presentation and the D-090 whole-world
preview is hidden.
The completion boundary is cross-port: after the render aggregate arrives, the engine
waits until streaming has observed the render worker's exact final flythrough sequence
and has settled the corresponding total observer count. A main-thread snapshot taken
before that direct-port message cannot complete the run.

Before measurement, the engine settles one streamed midpoint checkpoint for each
environment phase and captures the actual WebGPU backbuffer through Babylon Lite's
public `captureScreenshot(surface)` API. Each capture must show streamed ownership,
zero visible preview meshes, a non-blank/non-all-geometry pixel ratio, and a distinct
hash. The visible-pixel threshold is derived from the recorded clear RGB and clamped to
2–24 RGB-distance units; it is a fail-closed ownership/blank-output check, **not** a
visual-quality or weather-fidelity threshold. The six captures run outside measurement,
followed by the existing fixed ten-second stabilization exclusion.

The reference collector runs three independent fresh-profile repeats. Each repeat
retains full-window callback/render distributions, camera/phase/path completion,
streaming high water/evictions/failures, full-window 200 ms all-realm JS used-heap
samples, main-thread long tasks, and Dawn trace/histogram boundary evidence. All relied-on
p95 values—streaming cell load, render duration, and render-worker callback spacing—must
meet the standing 10% repeat-variance rule. Callback spacing remains explicitly
non-presentation evidence under D-051/RE-006. Reports use the three D-045 facets and
enumerate standing budgets the current metric set does not evaluate; a green current-set
budget facet cannot be described as “zero M1 budget violations.”
Worker-origin completion evidence repeats the complete scenario contract—ordered path
points, speed, camera settings, and every phase's boundaries and state values—and the
harness compares it against its own independent `flythrough-d1@1` constant. Checkpoints
repeat their applied phase and midpoint time. Runtime validation rejects unknown
weather/time-of-day strings even if malformed data bypasses TypeScript.

Every started repeat is serialized as a measured or invalid attempt. Invalid attempts
retain any measured-browser identity, browser errors, trace-drain counters/timings/data
loss/deadline state, and `JsHeapValidationError` evidence available at failure. Only
measured attempts feed budgets and variance. Each measured browser records its own
`Browser.getVersion`, command line, sandbox result, adapter/GPU, display before/after,
and host/power identity before/after; the separate identity browser is labelled as a
probe and cannot stand in for these fields. Per-repeat adapter matching compares only
the physically observed stable WebGPU identity (vendor, architecture, and fallback
state), alongside the exact CDP GPU-device identity. Backend, driver, description,
device, and type remain richer evidence from the isolated developer-feature reference
probe per D-034/RE-004; the standard physical browser has been observed to redact them
to null or empty strings, so they are not compared across those differently configured
browsers.
The environment facet also requires the
actual Node version to equal both checked-in Node pins and retains the collector
executable digest.

This is M1 **lighting/environment-state coverage**, not the M6 weather/VFX system.
“Storm” currently changes the renderer's lighting/environment state but does not claim
rain, wind, particles, wet surfaces, or validated visual fidelity. D-025 also remains
open: the external collector may request and retrieve this run, but the complete
warm-up/repeat/environment/export lifecycle is not yet an in-game benchmark.

The current contracts use public telemetry v15, streaming telemetry v3, routine
`smoke@1` report schema v35/mandatory metric set v18, and `flythrough-d1@1` report
schema v4/mandatory metric set v4 after D-102's attribution addition. The flythrough
section schema remains v2. The scripted-flythrough plan item is qualified by D-102's
passing three-repeat physical report
`flythrough-d1-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-07-24-028Z.json`
on artifact
`20770c3a4d6dba436a287cb77d60e6842e1c86dd5aa4ac82da3dcfc4b953747e`
and D-097's final passing routine physical
`smoke-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-34-23-655Z.json`
on that exact artifact. This qualification covers only the flythrough report's
explicitly enumerated metric set, not the omitted budgets required by the later M1 exit
item.

**Context:** D-091 intentionally left streamed meshes GPU-resident but hidden until this
task established visible ownership. A local advisory run in pinned Chrome for Testing
151.0.7922.34 exercised all six backbuffer captures with preview visibility zero and
13–33 streamed meshes visible per checkpoint; it exposed the initial fixed 24-unit dark
scene threshold as invalid for storm/dusk and storm/night, motivating the recorded
adaptive threshold above. A rebuilt same-environment advisory rerun then reached
`prepared` with no browser errors: all six unique captures passed at visible-pixel
ratios 0.865–0.927, with the dark checkpoints using the recorded 2-unit floor. These
advisory observations are implementation feedback, not reference-machine qualification.
Babylon Lite 1.12.0's installed public typings and implementation were checked locally
on 2026-07-25 before binding the capture path.

**Consequences:** The long run exercises real streaming ownership and environment
bindings without sending per-frame commands through the main thread or harness. The
separate short `smoke@1` launch gate keeps its existing diagonal corner-stress observer
and does not inherit the ten-minute route. Full player-visible presentation and the
remaining standing memory envelopes are still required by the later M1 exit task.

**Reopen if:** representative physical runs show three fresh repeats are operationally
unstable or systematically miss warm-cache behavior that matters to the product;
streaming cannot stay settled at the direct observer cadence; a validated compositor
presentation surface replaces D-051's heuristic; or M6 weather implementation requires
a richer environment scenario schema.

---

## D-099: Preserve complete measured source identity before same-gate cleanup (2026-07-25, accepted)

**Decision:** When one human-gate unit both creates and closes an experiment, and no
commit contains the runnable apparatus, export an exact reconstruction bundle into that
experiment's ignored result directory before deleting the source. The bundle covers the
complete input to the measured source identity relative to its recorded base commit,
not only files believed to belong to the experiment:

- the exact base commit plus every tracked modification and deletion in the dirty tree,
  preserving binary content, modes, and paths;
- every non-ignored untracked path enumerated by the same harness source-identity
  algorithm, with its bytes, size, and SHA-256;
- a manifest for the captured source, result artifact, environment/tool pins, exact run
  command, and scenario/schema/metric-set identity; and
- a clean-scratch reconstruction check: check out the recorded base commit, apply the
  bundle, recompute source identity with the measured scenario's harness algorithm, and
  require both `commit` and `dirtyTreeDigest` to equal the report exactly before
  cleanup.

Ignored results, caches, installed tools, and other machine state are outside the source
digest unless a scenario explicitly includes them in its own identity contract. Storing
the bundle beneath ignored `harness/results/` therefore does not alter the ordinary
source identity.

This is a machine-local, best-effort rerun aid under D-081, not a new tracked evidence
mirror and not permission to retain closed executable baggage. Tracked decisions,
findings, and research docs must still quote every load-bearing top-line observation;
an ignored source bundle or raw report is not durable evidence.

**Context:** P-002's comparison app, worker, shaders, native adapter, and harness were
created and deleted inside one uncommitted human-gate cycle. D-081 kept its raw result
directory ignored. After the adversarial review, searches of tracked files, all git
history, and the available temporary tree found no exact source snapshot; the retained
base-commit and dirty-tree digests identify the measured state but cannot reconstruct
it. The exact `geometry-representation@5` runner is therefore unrecoverable and cannot
be rerun. This guard was not met for P-002 and cannot repair that loss retroactively.

**Consequences:** The closed-experiment rule still removes code immediately after a
decision. For future same-gate experiments, cleanup is incomplete until the ignored
reconstruction bundle has been created and verified, and the tracked docs contain the
top-line evidence. Git history alone is sufficient only when the measured source
identity is clean (`dirtyTreeDigest: null`) and its commit contains the apparatus. A
non-null measured digest still requires the complete reconstruction bundle even if an
earlier commit contains some or all experiment files. `docs/workflow.md` carries the
operating procedure.

**Reopen if:** ignored result directories become durable external artifacts keyed by
source and result digests; the human gate changes so every measured experiment receives
a source-bearing commit; or a reproducible experiment-package format replaces the
patch/snapshot convention.

---

## D-098: Retain triangle LOD after the bounded P-002 comparison produced no eligible challenger (2026-07-25, accepted)

**Decision:** Retain D-090's classic triangle-LOD path as the current D1 geometry
representation. Do not adopt the bounded meshlet/GPU-driven or Gaussian-splat arms, and
do not ship a hybrid representation from this spike. This is an incumbent-retention
decision: neither challenger supplied fully eligible displacement evidence. It is **not**
a finding that triangle LOD won on performance; the triangle arm itself did not achieve
a fully valid CPU+GPU comparison.

Keep streaming, cell packaging, collision, and renderer-facing boundaries
representation-agnostic. A future content class may reopen a different representation,
but it must do so with a new decision and representative evidence rather than retaining
the comparison implementation as dormant product code.

**Measured context:** `geometry-representation@5` (report schema 5, metric set 5) ran
all six candidate/profile arms and all 18 dynamic-light captures at the dev-01 physical
console under pinned Chrome for Testing 151.0.7922.34, Dawn D3D12, and the NVIDIA
GeForce RTX 4080 SUPER. The retained machine-local generated report is
`harness/results/geometry-comparison-p002/dev-01-2026-07-25T04-15-34-944Z/report.json`
(artifact
`82e2c3f434d39b49ad9e2eb528e18c9bc8787cb1c9b3031d3daf95951724e2ce`,
source commit `6f2fb1e9814904c733a64b4a629051c46c3fe145`, dirty-tree digest
`31dfd73f73fd32f0b3239393a28323bba6caa067b3c0e1c449bfd504b72bb8d5`).
Showcase environment identity was measured. Standard was deliberately advisory because
dev-01 is not a registered Standard reference machine. No exact source snapshot
survived the same-gate cleanup, so the ignored report is not a durable reproduction;
D-099 records that workflow failure. The tracked observations in this entry carry the
decision.

The policy used a fixed 1,200-frame warmup, three to six sequential 600-frame GPU
stabilization windows at the unchanged 10% relative-range limit, three 1,800-frame
measurement repeats per light state, timestamp queries, worker-owned capture, and
fail-closed metric eligibility. The complete report remained invalid:

| Candidate | CPU | GPU | RAF | Dynamic-light visual | Overall |
| --- | --- | --- | --- | --- | --- |
| triangle LOD | invalid | invalid | valid | valid | ineligible |
| bounded meshlet/GPU-driven | invalid | invalid | valid | valid | ineligible |
| bounded Gaussian splats | invalid | invalid | valid | invalid | ineligible |

CPU p95 repeat variance exceeded 10% for triangle in Showcase storm and all three
Standard light states; meshlets in Showcase overcast and Standard storm; and splats in
Showcase clear/storm and Standard clear/overcast. GPU evidence was invalid for triangle
because Standard storm did not stabilize; for meshlets because Showcase clear did not
stabilize and Showcase storm/Standard clear repeat variance exceeded 10%; and for
splats because Standard overcast did not stabilize and Showcase clear/Standard overcast
repeat variance exceeded 10%. RE-039 records this scoped timing instability without
assigning an unproven cause or generalizing it to the Standard hardware target.

Triangle and meshlet captures were pixel-identical in clear, overcast, and storm at both
render profiles. The generated report's provisional full-frame normalized-RGB-RMSE gate
marked splat clear and overcast valid below 0.25 and storm invalid. Post-run adversarial
adjudication showed that threshold was inadequate:

| Profile / splat state | Normalized RGB RMSE | Pixels with RGB distance > 24 | Mean absolute channel difference |
| --- | ---: | ---: | ---: |
| Showcase clear | 0.19513 | 75.217% | 32.636 |
| Showcase overcast | 0.15530 | 68.403% | 24.411 |
| Showcase storm | 0.28560 | 73.493% | 49.206 |
| Standard clear | 0.19698 | 75.882% | 33.452 |
| Standard overcast | 0.16182 | 68.241% | 25.331 |
| Standard storm | 0.29164 | 74.420% | 50.719 |

The gross all-state divergence invalidates the entire splat visual contract. The exact
under-threshold clear/overcast RMSE observations remain diagnostics, but no splat
visual-parity evidence survives. This tracked post-run adjudication intentionally
overrides the ignored generated JSON's clear/overcast eligibility fields; the generated
artifact itself is not rewritten.

The other planned axes were recorded even though they cannot rescue the invalid
performance comparison. Preparation fields below are one observed run per arm, not
repeat-qualified rankings; `upload/setup` includes GPU resource creation and pipeline
warmup.

| Profile / bounded arm | Encoded storage bytes | Logical GPU buffer bytes | Preprocess (ms) | OPFS write/read (ms) | Decode / upload+setup (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Showcase triangle | 1,164,976 | 34,342,720 | 25.110 | 2.710 / 5.865 | 0.345 / 0.910 |
| Showcase meshlet | 1,179,204 | 34,356,944 | 27.925 | 2.545 / 7.390 | 0.335 / 0.900 |
| Showcase splat | 3,026,892 | 36,204,640 | 55.245 | 3.835 / 9.815 | 0.500 / 1.610 |
| Standard triangle | 1,164,976 | 15,910,720 | 25.130 | 2.545 / 8.245 | 0.325 / 0.865 |
| Standard meshlet | 1,179,204 | 15,924,944 | 29.065 | 2.620 / 7.525 | 0.425 / 1.055 |
| Standard splat | 1,008,972 | 15,754,720 | 45.240 | 2.495 / 12.410 | 0.365 / 0.855 |

The compared representations were deliberately bounded. The meshlet arm partitioned
D1's 25,224 source triangles into at-most-64-triangle meshlets, compute-culled them, and
issued 395 per-meshlet indexed indirect draws for the captured view (190 visible,
205 culled); it was not a Nanite implementation with virtual geometry memory and a
visibility-buffer pipeline. The splat arm was an oriented material-carrying
Gaussian-billboard renderer derived from those triangles (25,224 splats at Standard,
75,672 at Showcase), with normals/base color and three fixed light states; it was not
research-grade mesh2splat output, a final asset proof, or a deferred splat G-buffer.
Triangle and splat each issued one render draw in the bounded arm. Resident VRAM stayed
explicitly unsupported under RE-014; logical buffer accounting is not a substitute.

The arms did establish a bounded Babylon Lite 1.12.0 interop result. All six proved raw
device availability, queue identity, a GPU-buffer round trip, sealed pipeline
registration, and zero runtime pipeline-creation attempts. Exact local package source
was checked on 2026-07-25. Because the selected production path has no native-interop
consumer, the guarded adapter, comparison worker/app/harness, shaders, registry, build
manifest v11 experiment, scripts, and tests are removed under the closed-experiment
rule. The ordinary build contract remains v10 with five workers. The rejected
`geometry-representation@1` result and generated `@5` result, including captures,
remain machine-local evidence aids. D-099 records why neither is an exact rerun source.

**Consequences:** P-002's geometry choice is resolved for the current M1 D1 content.
Triangle LOD stays because it is the already-qualified incumbent and no challenger
earned a valid displacement decision, not because the invalid aggregate establishes a
speed ranking. No P-002 metric changes a standing frame, storage, or memory budget.
Resident VRAM remains unobservable under RE-014, and worker RAF/callback intervals
remain scheduling heuristics rather than compositor presentation evidence under
RE-006. The final post-review source passed D-097's physical gate in
`smoke-1-c54679d7b006-dev-01-showcase-2026-07-25T05-39-39-928Z.json`: environment,
evidence-completeness, and budget facets passed with 30/30 checks and no failures under
pinned Node 24.18.0 and CfT 151.0.7922.34 with the production sandbox verified. Artifact
`c54679d7b0062e197675f6c321141882f540b0ab8dbb045daa809b8c3c7d19e4`
closes the P-002 plan item.

**Reopen if:** representative higher-density authored content changes the workload;
capture-origin scan-your-world UGC becomes active; a full virtual-geometry or
research-grade relightable-splat implementation is proposed; Chrome/Dawn timing
stability permits complete evidence; or a candidate supplies valid CPU, GPU, RAF,
visual, storage, preparation, and environment evidence at both registered targets.

---

## D-097: Qualify final runtime-affecting candidates at the physical console (2026-07-24, superseded in trigger scope by D-157)

**Decision:** Interpret the project's per-change performance requirement at the
reviewable-candidate boundary, not after every edit or review exchange.

- Run `pnpm check` before handing off an implementation candidate and again after a
  review fix changes code, generated artifacts, or test/build contracts.
- Run one physical-console `pnpm harness:smoke` after the final reviewable state of a
  runtime-affecting candidate. A candidate is runtime-affecting when it changes a built
  app/engine/game/worker/Wasm artifact, browser-facing behavior, the harness or
  measurement path, a runtime dependency or toolchain/browser pin, a reference-machine
  descriptor, a budget, or a mandatory evidence contract. Rerun after any later fix
  that changes one of those inputs.
- Do not require physical smoke for documentation-only, test-only, or machine-local
  tool-location changes that leave all of those inputs unchanged. Documentation that
  changes a budget, mandatory evidence contract, pin, or qualification claim is not
  exempt merely because the file is Markdown.
- Keep `pnpm harness:smoke:v8-cache` on D-095's targeted triggers. Run installed
  branded-Chrome parity when reviewing/adopting a Chrome pin and at the standing
  dependency checkpoint when browser currency is assessed, not on an unrelated weekly
  schedule.
- If a qualifying smoke run hits an intermittent RE-008/RE-036-class failure, retain
  the failed report and make one immediate same-artifact retry to classify it. The
  retry is a separate result and never relabels or erases the failure. Additional
  repetitions belong to an explicit diagnosis, not routine qualification.

Only an automated pinned-Chrome run on a registered reference machine at its physical
console can carry a budget verdict. Remote or otherwise non-gating runs remain useful
diagnostics but never substitute for the required final qualification.

**Context:** The schema-v31/metric-set-v15 routine gate already contains only current
contracts after D-095/D-096. Its accepted D-096 run executed six launches and 30 checks;
the final launch began 94.2 seconds into the sequence and the measured core sequence
finished at approximately 110.3 seconds. That cost is appropriate once per final
runtime candidate, but repeating it after edits that cannot change the artifact or
measurement contract adds physical-console coordination without adding evidence.

RE-008 has also shown that a complete trace may arrive late or fail intermittently, and
the former RE-036 occurred in browser-side Rust/Wasm startup. Preserving a physical
qualification boundary for browser-facing candidates continues to exercise those
paths. Retaining a failed report plus one same-artifact retry distinguishes an
intermittent from a deterministic regression without averaging away or silently
discarding the failure.

**Consequences:** “Every change” means every final reviewable runtime-affecting change,
not every intermediate working-tree state. Agents should batch the physical run after
implementation and review fixes have converged, while still rerunning it whenever a
subsequent fix changes qualifying inputs. This decision changes workflow only; it does
not change smoke scenario shape, repeats, budgets, schemas, fail-closed result
semantics, or baseline-promotion rules.

**Reopen if:** the routine gate becomes too slow for one run per runtime candidate; a
reliable unattended physical-console runner permits a useful additional cadence; field
or CI evidence shows that exempt changes can alter measured artifacts; or intermittent
failures require a different statistically justified qualification protocol.

---

## D-096: Select app-owned NPC inference and retire superseded Prompt/OPFS experiments (2026-07-24, accepted)

**Decision:** Resolve P-007 in favor of D-074's exactly pinned app-owned Gemma 4 E2B
QAT-GGUF backend on wllama 3.5.1. All-layer WebGPU offload is the default placement;
the measured `n_gpu_layers: 0` CPU/WASM path remains an explicit graphics-headroom mode,
never an automatic fallback. D-017's Prompt API backend and Chrome-managed model
lifecycle are superseded. Every NPC still requires authored fallback dialog, and no
quest-critical interaction may depend on model availability.

Close the superseded implementation surfaces under D-095:

- Remove the Prompt API engine service and public types, both CfT and branded harness
  scenarios, their profile/model-component utilities and tests, app controls, game
  fixtures, launch-switch surgery, and `@types/dom-chromium-ai`.
- Remove D-066's standalone 64 MiB OPFS microbenchmark, storage worker, telemetry,
  host-disk sampler, tests, and smoke checks. D-091's long-lived streaming worker now
  supplies the representative mandatory OPFS→decode→GPU integrity, timing, residency,
  eviction, and budget evidence.
- Remove the completed-milestone `m0:gate` alias; `pnpm harness:smoke` is the single
  routine gate name.

The combined telemetry envelope advances from v11 to v12, build manifest v9 to v10,
`smoke@1` report schema v30 to v31, and mandatory metric-set v14 to v15. Build-manifest
v10 requires five worker entrypoints rather than six. Metric-set v15 removes only the
standalone OPFS throughput and repeatability checks; the representative streaming
pipeline remains mandatory and retains per-cell OPFS read timings.

**Context:** D-074 passed the unchanged fixed fixture with 119.64 ms warm TTFT p95,
60.27 tokens/s mean decode throughput, exact five-shard OPFS lifecycle evidence,
structured-output/context checks, and concurrent render-worker callback telemetry.
D-065 proved that branded Chrome could deliver and reuse its built-in model, but
RE-021's observed first-token samples missed the dialog target, the API remained
window-only (RE-016), and its browser-managed lifecycle remained less controllable
(RE-017/RE-020). No current plan item, production runtime, platform floor, or recurring
qualification gate consumes the Prompt implementation.

D-091 subsequently replaced D-066's synthetic storage-boundary evidence with at least
ten contiguous representative cell loads per core run, including attributable OPFS
read, decode, upload, total latency, content integrity, queue/residency shape, proactive
eviction, and a blocking 250 ms p95. Keeping a second mandatory synthetic read workload
made every smoke launch slower while protecting no independent current contract.

**Consequences:** NPC inference has one production direction, one model/install
lifecycle, and no dormant backend abstraction branch. Prompt API and standalone OPFS
measurements remain in the decision/finding logs and machine-local result history; git
history retains their reproducible implementations. A future Chrome or backend
comparison starts as a new bounded experiment against then-current APIs and tooling.
The app build no longer ships the storage worker, and routine smoke starts traversal
after streaming residency without first running a synthetic 64 MiB read workload.

`pnpm check` passed with 43 files / 286 unit cases, including same-host byte
repeatability for all five emitted engine workers and all three generated Wasm modules.
Physical-console schema-v31/metric-set-v15 report
`smoke-1-0b65dbea0692-dev-01-showcase-2026-07-25T02-31-34-110Z.json` then completed all
six core launches and passed environment, mandatory-evidence, and budget facets with
all 30 checks passing. It recorded zero V8 diagnostic launches, as expected for the
routine gate.

**Reopen if:** a current milestone identifies a measured quality, contention,
installation-size, or lifecycle failure in the selected backend; Chrome's built-in
model demonstrates a materially better current tradeoff against the same game fixture;
or the representative streaming evidence can no longer localize an OPFS regression and
a smaller targeted storage probe is approved.

---

## D-095: Remove closed experiment baggage and make non-gating diagnostics targeted (2026-07-24, accepted)

**Decision:** Once an experiment has a recorded conclusion and no selected runtime,
active plan item, platform floor, or recurring qualification contract consumes it,
remove its code, dependencies, build outputs, fixtures, and decision-only tests. Keep
the durable evidence in decisions, findings, result artifacts, and git history. Apply
the same standard to routine checks: every-change gates protect current contracts and
budgets; useful non-gating investigations use explicit opt-in commands with documented
triggers.

Apply that policy now in two places:

- Remove the superseded D-073 Transformers.js/ONNX implementation, its two ONNX model
  manifests, local declaration shim, dedicated Parallax AI worker, Rollup/build-manifest
  entry, dependency/override/install policy, and ONNX-only tests. The selected app-owned
  LLM contract now describes only D-074's wllama/GGUF WebGPU and CPU/WASM modes.
- Stop running the isolated three-lineage V8 code-cache diagnostic in every
  `pnpm harness:smoke`. `pnpm harness:smoke:v8-cache` runs the same core smoke gate and
  opts into the existing nine V8 launches. Use it for browser, Node, Vite/Rollup,
  server/cache changes, dependency checkpoints, M2 install/update/lifecycle work, and
  explicit V8 investigations.

The public build manifest advances from v8 to v9 because it now requires six worker
entrypoints rather than seven. App-owned LLM telemetry advances from v2 to v3 and its
report from v1 to v2 because ONNX runtime/device variants disappear. `smoke@1` advances
from report schema v29 to v30 to record whether V8 diagnostics were requested and to
bind the new build contract. Mandatory metric-set v14 is unchanged: V8 evidence was
already informational, while all core environment, evidence, and budget checks remain.

**Context:** The 53-file, 385-case unit suite completed in 1.47 seconds and protects
current code contracts, so broad unit-test pruning would save little while increasing
regression risk. The routine physical smoke gate, by contrast, launched six required
core browser sessions followed by nine informational V8 sessions. Recent passing runs
spent roughly 12–13 seconds on the V8 phase, including occasional five-second trace
drains, even when the change could not affect script caching.

D-073's ONNX routes were already measured no-go paths and D-074 selected wllama/GGUF.
Nevertheless the repository still installed Transformers.js and ONNX Runtime, shipped a
seventh worker artifact, maintained an independent model/runtime protocol, and tested
that dormant branch. That is recovery convenience, not a current product or research
contract; git history is the appropriate recovery mechanism.

**Consequences:** Normal verification remains fail-closed for all current mandatory
evidence while avoiding nine irrelevant browser launches. V8 evidence is still easy to
collect at every trigger that can change it, and its historical results/findings remain
intact. The ONNX dependency chain, including its optional Node binding and transitive
`adm-zip` advisory, leaves the lockfile and served/build surfaces. The app-owned LLM and
build contracts become narrower and easier to reason about. Any future ONNX comparison
starts as a new bounded experiment against then-current tooling rather than reviving a
dormant production-shaped branch.

Physical-console report
`smoke-1-188e456726f4-dev-01-showcase-2026-07-25T02-00-45-198Z.json`
qualified the routine path: exactly six core launches passed all three facets and all
30 checks, and the report recorded zero V8 launches with diagnostics explicitly not
requested. Targeted report
`smoke-1-188e456726f4-dev-01-showcase-2026-07-25T02-07-11-589Z.json`
then passed the same core gate and completed all nine requested V8 launches. The
diagnostic selector now covers the five scripts in its stable capture topology
(app/engine/game/render/streaming); it excludes decode traversal and the Rust/WASM
worker because the isolated page does not trigger the former or wait for the latter.
Fresh/produce attribution measured across all three lineages. Warm cache-consumption
and render/streaming production remained informationally invalid for the existing
RE-009/RE-010 Chrome observability gaps. The targeted run also retained and accepted a
complete lossless core trace at 5,307.5 ms under D-094.

The current threaded-Wasm diagnostic compiles its original response once through
`WebAssembly.compileStreaming` and transfers that module to the two short-lived workers.
Historical targeted and D-144 records retain their original `instantiateStreaming`
identity; changing the current loader does not reinterpret those measurements.

The schema-v30 report remains unpromoted: the checked-in store's older metric-set-v11
anchor is intentionally incomparable with metric-set v14, so baseline replacement
still requires the separate explicit human promotion/rebaseline workflow.

**Sources checked (2026-07-24):** current manifests and lockfile; the build artifact and
worker-entrypoint pipeline; the app-owned LLM service/protocol/tests; the smoke launcher
and its recent physical-console reports; local `pnpm test:unit` timing.

**Reopen if:** a current milestone selects ONNX/Transformers again, V8 lifecycle
evidence becomes blocking, or measured diagnostic cost becomes low enough and broad
enough to justify restoring it to the every-change gate.

## D-094: Accept complete lossless trace drains within ten seconds  (2026-07-24, accepted; supersedes D-035/D-092's five-second validity threshold only)

**Decision:** A required `smoke@1` trace is valid when `Tracing.end` and
`Tracing.tracingComplete` finish within 10,000 ms, the trace is readable, and Chrome
reports no data loss. The collector remains attached for a further 10,000 ms diagnostic
window after that deadline; completion there is retained but invalid, and no completion
within the full 20 seconds remains terminal. End-command and completion latency stay
explicit evidence. No workload, trace category, payload, correctness check, or budget
other than the collection deadline changes.

**Context:** D-092 proved that the former five-second outer deadline coincided with
Perfetto's internal 5,000 ms data-source stop timeout. Two physical-console traces
completed successfully just after that boundary: 5,308.0 and 5,303.7 ms total, each
with approximately 70,000 events, 11.6–11.8 MB of serialized data, and
`dataLoss=false`. Trace collection occurs after the measured workload; accepting those
complete traces does not add time to the measured frame, streaming, heap, or Wasm
windows. The project needs complete trace evidence, not conformance to Perfetto's
internal stop timeout.

**Consequences:** Those two historical reports remain invalid under the contract that
produced them, but equivalent future samples between five and ten seconds are measured
evidence. RE-008 remains a trace-drain latency and diagnosability finding rather than a
gate failure at Perfetto's own forced-stop boundary. A drain beyond ten seconds, missing
completion, unreadable trace, or reported data loss still fails closed. Result schema
v29 and mandatory metric-set v14 are unchanged because the serialized evidence and
metric inventory are unchanged; this decision changes only the documented budget.
Physical-console report
`smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T01-15-05-125Z.json`
then passed all six core launches, all three facets, and all 30 checks. Its isolated V8
fresh-repeat-2 trace exercised the new range directly: 285 events / 45,205 serialized
bytes, `dataLoss=false`, and completion in 5,020.1 ms was valid measured evidence.

**Sources checked (2026-07-24):** D-092's Chromium/Perfetto source inspection and
physical-console reports
`smoke-1-8d18fd6125cd-dev-01-showcase-2026-07-25T00-43-30-949Z.json` and
`smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T01-05-37-290Z.json`, plus the
passing D-094 report above.

**Reopen if:** valid trace drains approach or exceed ten seconds, latency becomes
workload-correlated enough to hide a collection defect, or Chrome exposes a terminal
per-data-source stop/error contract that supports a better bound.

## D-093: Relocate wasm-bindgen thread scratch state outside Rust's pre-existing allocator chunk  (2026-07-24, accepted)

**Decision:** Keep the pinned nightly-2026-07-16, wasm-bindgen 0.2.126, Binaryen
131.0.0, two-worker topology, 33-page shared-memory contract, and 64 KiB follower
stack. During the deterministic Wasm build, disassemble wasm-bindgen's generated
module and relocate only its thread counter, temporary-stack lock, and scratch-stack
references from the linker's `__heap_base` to the extra page wasm-bindgen already
appends after the linker's `__heap_end`. Reassemble before the existing `-Oz` pass.
The build requires the exact generated-reference counts, preserves the four
dlmalloc linker-heap references, validates the relocated atomic operations after
optimization, and fails on any toolchain-layout drift. No runtime retry, timeout
increase, memory growth, or Chrome change is introduced.

**Context:** D-092's first physical-console probes changed RE-036's attribution.
Three failures constructed both `WebAssembly.Instance` objects and stopped with one
worker at `ready`, its peer at `runtime-startup-started`, and the identical shared
runtime tuple `initialization=2, instances=2, allocatorLock=43`. A successful launch
on the same unrelocated artifact recorded the required quiescent tuple `2/2/0`.

Disassembly then proved an overlap in the exact pinned toolchain. wasm-bindgen's
thread transform reserved its scratch page beginning at address 1,050,048, the
exported `__heap_base`, and used 1,050,052 as its lock. The rebuilt Rust standard
library's dlmalloc 0.2.13 had already compiled
`[__heap_base, __heap_end)`—1,050,048 through 2,097,152—as a pre-existing allocator
chunk. The leader's original startup could therefore write dlmalloc metadata value
43 over wasm-bindgen's lock before the follower acquired it; the follower's
unbounded `memory.atomic.wait32` expected the held value `1`, so `43` was
nonterminal. This explains the race-shaped history: the follower sometimes acquired
the lock before the leader initialized dlmalloc.

The relocated page begins at 2,097,152, outside dlmalloc's exclusive upper bound,
with the lock at 2,097,156 and scratch-stack top at 2,162,688. The already-added
33rd page covers that complete range.

**Consequences:** The relocated optimized module is 12,391 bytes with SHA-256
`3be99544a2c15e529d1bd27cd97cf453617d60189a8c61d611862ad504e03fc5`.
Physical-console schema-v29/metric-set-v14 artifact
`smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T00-58-50-184Z.json`
passed all six core launches, all three result facets, and all 30 checks. Each
cohort recorded `2/2/0` after initialization and completed the full workload in
31.9–39.3 ms. A same-artifact confirmation report
`smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T01-05-37-290Z.json`
failed independently on a retained late RE-008 trace, while all six additional
Wasm cohorts again recorded `2/2/0` and completed in 33.3–40.2 ms. This resolves
Parallax's RE-036 failure for the pinned artifact;
the underlying wasm-bindgen/Rust layout incompatibility remains an upstream
candidate (UP-004). RE-036 no longer supports a Chrome-side fix request.

**Sources checked (2026-07-24):** exact generated and optimized WAT; pinned
`wasm-bindgen-cli-support-0.2.126/src/transforms/threads/mod.rs`; pinned
`dlmalloc-0.2.13/src/wasm.rs`; failed physical-console artifacts
`smoke-1-8d18fd6125cd-dev-01-showcase-2026-07-25T00-43-30-949Z.json`,
`smoke-1-8d18fd6125cd-dev-01-showcase-2026-07-25T00-46-00-971Z.json`, and
`smoke-1-2902f53d2fd4-dev-01-showcase-2026-07-25T00-51-29-864Z.json`;
passing artifact above.

**Reopen if:** wasm-bindgen or Rust changes either memory-layout contract, an
upstream fix removes the overlap, the exact-reference guard fails, or a relocated
artifact reproduces nonterminal startup.

## D-092: Separate trace validity from late observation and split threaded-Wasm startup phases  (2026-07-24, accepted; five-second validity threshold superseded by D-094)

**Decision:** Keep D-035's five-second trace end/completion validity deadline and
D-088's 10,000 ms threaded-Wasm service boundary, concurrent topology, mandatory
participation checks, and no within-run retry. After a trace exceeds five seconds,
`smoke@1` now remains attached for a separate ten-second diagnostic observation window.
Completion during that window is retained and explicitly invalid; no completion during
the full 15 seconds is also retained. The late window never turns a failed trace into
measured evidence.

The pinned wasm-bindgen output now receives deterministic build-time instrumentation
around `new WebAssembly.Instance` and `__wbindgen_start`. Worker evidence distinguishes
`module-instantiation-started`, `module-instantiated`, `runtime-startup-started`,
`runtime-started`, and `ready`. On terminal failure, the engine also snapshots the
current fixture's shared initialization state, initialized-instance counter, and
allocator lock before terminating the workers. Successful initialization must also
record the quiescent `initialization=2, instances=2, allocatorLock=0` control. Those
offsets are explicitly fixture-specific; the build disassembles every optimized module
and fails if the pinned runtime operations drift. The public telemetry envelope advances to v11 and
`smoke@1` to result schema v29 / mandatory metric-set v14.

**Context:** Inspection of Chromium checkout `4dc95450a818a` on the development VM found
that DevTools acknowledges `Tracing.end` before Perfetto stops its data sources, reads
the trace, obtains final statistics, and emits `Tracing.tracingComplete`. Perfetto's
default data-source stop timeout is 5,000 ms—the same value as the previous outer
harness timeout. A producer that needs Perfetto's forced-stop path can therefore become
terminal only as the harness detaches, with trace reading and final-stat work still
pending. The existing 20-second RE-008 arm did not exercise this path because all six
of its samples completed in under 153 ms; it does not establish what a retained
five-second failure would have done next. `ReturnAsStream` already reproduced the zero-
chunk signature, so changing CDP delivery alone is not an evidenced fix.

The first schema-v29 physical-console sample then completed after the invalidity
boundary but inside the new observation window: `Tracing.end` returned in 2.5 ms,
Perfetto/CDP completion arrived 5,305.5 ms later, and the collector retained 70,985
events in 400 chunks / 11,649,521 serialized bytes with `dataLoss=false`. This proves
that the previous five-second outer timer could race the internal forced-stop path; it
does not justify weakening the validity deadline.

The previous D-088 phase marker surrounded the entire wasm-bindgen `initSync` call.
Source inspection of its exact generated binding showed that this call constructs the
instance and then synchronously invokes `__wbindgen_start`. Disassembly of the 12,680-
byte fixture found unbounded atomic waits in that startup routine around shared
initialization and allocator state. The old `[ready, initialize-received]` evidence
therefore did not prove a stall inside `WebAssembly.Instance`; it could also represent
Rust/wasm-bindgen startup. Serial initialization and independent per-worker compilation
remain rejected workarounds because both previously reproduced RE-036.

**Consequences:** A late RE-008 sample can now confirm or reject the suspected boundary
race without weakening the gate. If it completes shortly after five seconds, the
underlying missing data-source acknowledgement remains a Chromium/Perfetto issue while
the harness preserves the recovered evidence and fails correctly. If it remains
nonterminal for 15 seconds, the platform gap is stronger. JSON/protobuf and
event/stream controls remain conditional follow-ups: all share the same Perfetto stop
handshake and are useful only if the new phase evidence reaches trace reading or
delivery.

RE-036 failures can now be assigned first to V8 instance construction or to
Rust/wasm-bindgen startup. The first probes assigned the retained failures to startup
and exposed the layout overlap resolved by D-093. Product worker-pool recovery remains
future representative M1 work: if adopted, it must restart the whole cohort with fresh
shared memory rather than retry one worker against potentially poisoned state. The
synthetic qualification gate remains fail-closed and retry-free.

**Sources checked (2026-07-24):** local Parallax generated binding and optimized Wasm;
VM Chromium `content/browser/devtools/protocol/tracing_handler.cc`,
`third_party/perfetto/include/perfetto/ext/tracing/core/basic_types.h`,
`third_party/perfetto/src/tracing/service/tracing_service_impl.cc`, and
`v8/src/execution/futex-emulation.cc`; physical-console schema-v29 reports
`smoke-1-8d18fd6125cd-dev-01-showcase-2026-07-25T00-43-30-949Z.json` and
`smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T01-05-37-290Z.json`.

**Reopen if:** retained traces show the five-second boundary is unrelated to Perfetto's
forced-stop path, the pinned Rust/wasm-bindgen output changes its startup protocol, or
representative worker-pool measurements establish a safe recovery mechanism.

## D-091: Bound the M1 cell-streaming pipeline and keep presentation ownership explicit  (2026-07-24, accepted)

**Decision:** The production-shaped M1 path is a long-lived streaming worker that owns
its OPFS handles, a boot-sized nested decode pool, and nearest-observer residency
scheduling. It provisions the build's content-addressed D1 cell packages into a
district-keyed subdirectory of `parallax-streaming-v1`, then serves every load as OPFS synchronous read → decode-worker
validation/JSON decode → a direct `MessageChannel` handoff to the render worker →
Babylon Lite GPU-buffer creation. Provisioning is a temporary pre-M2 bridge to the
installer; it hashes both reused and fetched OPFS bytes and rewrites mismatches, but is
not permission for launch-2+ to depend on network fetches. The build manifest
advances to v8 and names the decode and streaming worker artifacts independently.

Pool size is fixed at boot to
`min(4, max(1, navigator.hardwareConcurrency - 2))`. The scheduler retains the nearest
nine cells across all observers, evicts farthest non-target residents before loading
their replacements, and fails closed if the target set exceeds its encoded-package
residency budget. Its initial encoded-residency cap is 16 MiB; this is not presented as
live CPU memory, which remains covered by the all-realm JS-heap sampler. Encoded package
bytes and created GPU-buffer bytes, their high-water marks, queue high water,
provision/read byte counts, proactive eviction counts, and encoded-budget rejection
counts are all exported. Player-motion input uses D-090's
12 m/s traversal speed. The bounded smoke stress path reverses along a 2.121 m diagonal
across a four-cell corner while preserving that linear speed. Its endpoint target sets
differ by three cells and it completes at least five one-way traversals in every
one-second window, supplying at least fifteen replacement opportunities rather than
merely proving initial population.
Initial hydration establishes residency and memory high-water evidence but is excluded
from movement-latency samples; otherwise decode-pool startup queueing would be mislabeled
as a player-triggered cell-load outcome. The harness waits for initial residency before
running the separately attributed OPFS spike, starts the 12 m/s traversal only after that
spike completes, and derives latency plus eviction evidence solely from replacements
completed between the smoke measurement start/end snapshots.
The public telemetry envelope advances to v10 and `smoke@1` to result schema v28 /
mandatory metric-set v13. Every core run must contain at least ten complete cell samples,
exactly nine residents, a positive GPU allocation, at least one proactive eviction, no
encoded-budget rejection, a bounded worker/queue shape, and a nearest-rank representative
cell-load p95 no greater than 250 ms. Because either measurement snapshot can bisect the
worker's evict-before-load phase, the harness permits the eviction and completion deltas
to differ by at most the nine-cell residency limit rather than requiring exact equality.

The render worker creates real LOD0 Lite meshes for streamed cells but keeps them hidden
while D-090's whole-district preview remains the visible presentation owner. This avoids
double-rendering the same world or silently changing the already-qualified D-090 visual
contract. The scripted-flythrough task will transfer visible presentation ownership to
the residency set and measure continuity. KTX2/Draco/meshopt remain preinstalled and
qualified at the render boundary under D-089; the v1 procedural JSON decoder establishes
pooling, scheduling, and failure semantics without pretending that JSON timing measures
those binary codecs.

**Context:** D-066 qualified worker-owned synchronous OPFS access but explicitly left
representative OPFS-to-renderable latency, production pool sizing, and eviction to M1.
D-090 supplied deterministic content-addressed packages and a 12 m/s traversal contract.
The new path was checked locally on 2026-07-24 using the exact Node 24.18.0 build and
pinned Chrome runtime: it reached nine residents, crossed a cell boundary, evicted
proactively, and reported no worker or render failure. Registered physical-console
schema-v28 attempts then established that Chrome 151 exposes the window, render worker,
streaming worker, and four nested decode workers as seven measurable app realms. Every
completed core run retained 48–51 measurement-window replacements at 8.2–11.8 ms p95,
exactly nine residents, positive attributable streamed GPU bytes, proactive eviction,
and zero encoded-budget rejection. Artifact
`smoke-1-392bec740604-dev-01-showcase-2026-07-25T00-04-07-045Z.json` passed all three
facets and 30 checks before a report-only realm-count wording correction. The final
source state retained four failed same-artifact attempts under RE-008 and RE-036, so
the registered gate remains the qualification authority and this task remains open.

**Consequences:** Streaming failures are terminal and observable. Large cell bytes cross
the decode boundary as transferables, and decoded cells cross only the dedicated
streaming/render port; the window receives telemetry summaries, not content. The fixed
render-request timeout prevents a failed render worker from suspending residency
transitions indefinitely, and GPU upload is transactional so partial uploads and
post-upload accounting failures do not orphan render resources. Successful uploads remain
provisional until the streaming worker commits them; the render worker rolls back an
uncommitted upload after five seconds, covering a lost or late completion response.
Disposal is acknowledged
only after active scheduling drains and every render-side resident is evicted. The fixed
limits are an initial measured contract, not eternal budgets. The plan item remains open
until the registered physical-console run supplies all six fresh/warm runs and passes
the new evidence and budget checks.

The pre-M2 provisioning bridge re-hashes all reused packages on launch and removes files
whose content hashes are absent from the current district's own directory and index.
District-keyed storage prevents one district's cleanup from deleting another district's
installed packages. This is deliberately
correct but O(all installed content); M2's installer must replace it with a trusted,
versioned verification ledger before multi-gigabyte launch performance is qualified.
Chrome 151 did expose all four nested decode workers as ordinary browser-context CDP
targets in every completed physical-console run; the mandatory heap sampler measured
all seven app realms. That risk is resolved for the pinned runtime, while the unrelated
RE-008 trace-completion and RE-036 Wasm-instantiation failures still prevent final-source
qualification.

**Reopen if:** representative binary assets require a different pool topology, the
flythrough shows nine cells cannot hide traversal latency or visual transitions, measured
memory attribution requires a stricter accounting boundary, or registered results show
the worker reservation or 250 ms limit is inappropriate. Change the versioned contracts
and decision together; do not weaken a check to accept a failing run.

## D-090: Fix the D1 procedural-greybox scale, cells, LOD, and collision contract  (2026-07-21, accepted)

**Decision:** District 1's M1 playable surface is a **4,096 m × 4,096 m square** centered
at the world origin. Parallax world coordinates are Y-up and one world unit is one
metre. D1 is partitioned into a row-major 16 × 16 grid of 256 m square cells. Generator
and schema version 1 use the fixed seed `0x5eedD101`; generation, validation, and
serialization have stable ordering so identical inputs produce byte-identical output.
The build emits one canonical, content-addressed JSON artifact per cell rather than
shipping one monolithic district object.

The initial render representation is a three-tier hybrid greybox chain: a terrain grid
reads the collision height samples at strides 1, 2, and 4 while triangle-box payloads
carry authored features. A tier contains a collection of representation-tagged payloads,
not one assumed mesh type. The tiers' maximum observer distances are 320 m, 960 m, and
4,096 m, with a 64 m hysteresis band at each transition. Selection takes one or more
observers, uses the nearest distance, retains prior-tier state through the hysteresis
band, and returns an explicit culled result beyond the far tier. Complexity may stay
equal or decrease as distance increases, but may never increase. The standard traversal
speed used to validate cell and LOD coverage is 12 m/s. Collision is independent of
visual LOD: every cell carries a 17 × 17 sample heightfield at 16 m spacing plus static
axis-aligned bounding boxes for authored solid features. This defines portable collision
content only; it does not select the M3 physics runtime or resolve P-003's determinism
implications.

The generated district contains the central hilltop castle and moat, surrounding
village, outer fields, forest, south shoreline, connecting paths, and distant-mountain
vista metadata. It also contains three D2 transition-entrance markers in distinct
castle, village, and forest surface contexts. These are game-owned world data. The
engine consumes cells through a generic representation union so the M1 P-002 comparison
can substitute triangle-box, heightfield-grid, meshlet, splat, or hybrid payloads without
changing the world graph or collision data. A versioned game-owned descriptor contains
the district-specific terrain layers, zones, feature rules, graph markers, and tunables;
a district-agnostic seeded generator interprets it. Spatial range bounds are inclusive.
The D1 village rule separately excludes the full castle-and-moat footprint, so inclusive
range boundaries cannot classify moat cells as village or place village features there.
Multi-primitive authored units such as a tree's trunk and foliage are feature groups:
LOD sampling selects whole groups, and tag-directed far LODs select the first group
whose own tag matches rather than the first primitive in a multi-tagged cell.

The M1 runtime preview materializes selected heightfield grids and triangle-box features
in the render worker, batches them by material, and animates dynamic lighting from the
first greybox slice. Heightfield batches add single-sided downward edge skirts only at
district/cull boundaries and between cells at different sample strides, so adjacent
mixed-LOD cells cannot expose a fine-to-coarse T-junction without duplicating skirts at
same-tier interior edges. Their triangle winding follows the terrain surface's front-face
convention so Babylon's backface culling retains both surfaces and skirts. The overview
camera uses a 5 m near plane against the 10 km far plane; this cannot clip the current
radius-1,100 m authored view and gives the depth buffer more separation than the original
0.5 m value.

Per-frame telemetry exports observed lighting phase and intensity; the smoke gate
requires both to change during the measurement window rather than trusting an asserted
capability flag. Telemetry separately names terrain patches, box features, total
triangles, main-thread deterministic-generation time, synchronous scene-`postMessage`
time, and worker materialization time.
The gate also captures the canvas alone after measurement, hashes its PNG, and requires
at least 35% but less than 99.9% of pixels to differ by RGB distance greater than 24 from
the clear RGB derived from renderer telemetry. The synthetic all-clear negative fixture
reproduces and rejects the reversed-winding/clear-canvas failure, while the 99.9% ceiling
makes a mismatched clear color fail closed unless more than 0.1% clear-color headroom remains.
Screenshot capture and decode stay outside timed work. The 35% lower bound remains
provisional until the first registered physical run records its actual ratio and
headroom.

Procedural descriptors live in `game/`; their build-generated, validated per-cell
bundles are the greybox library/package output. The build iterates the N-district
registry, gives each district its own content-addressed index and cell scope, and rejects
duplicate IDs or normalized artifact-scope collisions.
Until M5 introduces Blender-authored binaries, the greybox QA gate validates the
structural requirements in this decision
(schema/version, deterministic canonical serialization, cell coverage, bounds,
landmarks, LOD monotonicity, and collision layout) in place of Blender-specific mesh,
UV, and export checks. It does not waive the `assets/` gate or permit hand-authored
files to enter the library directly.

**Context:** M1's first task required “target world scale” without defining the target,
which left cell count, traversal coverage, LOD thresholds, collision density, packaging,
and smoke acceptance free to drift independently. A 4,096 m square makes the ten-minute
12 m/s path long enough to cross many cell and LOD boundaries while retaining room for
all required surface contexts. The 256 m cell grid yields 256 independently packaged
units and aligns the 16 m collision sampling interval exactly at both cell edges. The
contract deliberately supplies representative classic geometry for M1 without deciding
P-002 or coupling collision content to a renderer or physics library.

**Consequences:** Acceptance for the procedural-content task requires deterministic
generation and validation, exact 256-cell coverage with no gaps or overlaps, the named
landmarks and three transition contexts, content-addressed per-cell packaging, exported
render/world telemetry including main-thread generation cost, semantic landmark
retention at reduced LOD, mixed-LOD edge-skirt coverage, and a passing physical-console
smoke gate with hashed visible-pixel proof of the target-scale preview and observed
animated-lighting ranges. The first passing run also records whether the provisional
35% visible-pixel floor has sufficient headroom.

Registered physical-console artifact
`smoke-1-71ce33331758-dev-01-showcase-2026-07-24T21-55-57-222Z.json` supplies that
evidence under exact Chrome 151.0.7922.34 and Node 24.18.0. All six fresh/warm core runs,
all three facets, and all 24 blocking checks passed. Each run retained 87.78% visible
canvas coverage, 256 terrain patches, 394 box features, 25,224 triangles, changing
lighting phase/intensity, and 98.2–109.5 ms worker materialization. This measured ratio
leaves 52.78 percentage points above the provisional floor and 12.12 points below the
99.9% ceiling. The immediately preceding same-artifact attempt
`smoke-1-71ce33331758-dev-01-showcase-2026-07-24T21-52-32-648Z.json` failed closed when
RE-008 returned zero trace events/chunks after `Tracing.end`; retaining both reports
records unchanged-artifact recovery without erasing the platform failure.

This content contract advances the build manifest to v7, the public telemetry envelope
to v9, and `smoke@1` to result schema v27 / mandatory metric-set v12; promotion
revalidates the exact mandatory-metric name list and measured, structurally valid
greybox evidence in every fresh and warm run. The accepted result is correctly
`ineligible` for automatic comparison with the promoted metric-set-v11 baseline.
D-087's explicit `--rebaseline` acknowledgement remains a separate reviewed promotion
action; this gate did not rewrite the anchor. Any future D1 schema migration must advance
the affected versioned contracts. Existing promotions then become intentionally
incomparable and their reviewed replacement requires the same acknowledgement rather
than inheriting or silently rewriting the old anchor.
Representative OPFS-to-renderable cell-load latency, decode-pool behavior, and
proactive eviction belong to the immediately following M1 streaming task; this decision
does not claim or defer its ≤ 250 ms p95 budget.

**Reopen if:** representative flythrough measurements show the playable extent, cell
granularity, traversal speed, LOD thresholds/hysteresis, collision density, or packaging
shape cannot meet the frame, memory, streaming, or visual-continuity budgets. Revisions
require a new decision and generator/schema version; never reinterpret version 1 output.

## D-089: Self-host and preinstall compressed-asset decoders in the module render worker  (2026-07-20, accepted; re-grounds D-006 and executes D-078's M1 prerequisite)

**Decision:** Adopt Babylon Lite 1.12.0 and exact decoder pins
`@babylonjs/ktx2decoder` 9.17.0, `draco3dgltf` 1.5.7, and `meshoptimizer` 1.2.0. The build
content-addresses every decoder WASM binary. The module render worker installs the
decoder factories/globals before any scene or asset load and fails readiness unless a
real Draco mesh, BasisLZ KTX2 texture, and meshopt vertex buffer decode successfully.
Public telemetry schema v8 records versions, installation path, decode durations, and
decoded facts. The future asset QA gate is required to reject meshopt glTF that is not
canonical single-buffer by calling the engine's shared validator.

**Context:** Pinned Babylon Lite's Draco, KTX2, and meshopt loaders first consult globals,
but their fallback path creates a classic `<script>` through `document`, which is absent
in the module render worker. The pinned Draco and MSC packages publish generated
CommonJS/AMD wrappers rather than ESM browser factories. A narrow Rollup adapter exports
those exact factories without modifying `node_modules`; all local divergence and
upstream-ready proposals are recorded in [upstream-contributions.md](upstream-contributions.md).
The old 1.11.0 physical artifact `1e01757c4726…` passed before the isolated 1.12.0
candidate `23e3b2d0be3c…`; the latter raised engine + render-worker bytes from 597,345 to
606,811 and passed all three facets, six runs, and 24 checks. With decoders, the shared QA
validator, and schema v8, final artifact `040677b31910…` is 831,188 bytes and passed the
same gate
under Chrome 151.0.7922.34 on dev-01. Budgets were unchanged. One preceding same-artifact
attempt retained an RE-036 Wasm-instantiation stall and another retained two RE-008 trace
completion timeouts; the passing replacement does not erase either finding.

**Sources checked (2026-07-20):** the exact installed Lite 1.12.0 loader source and its
[official release](https://github.com/BabylonJS/Babylon-Lite/releases/tag/npm-lite-v1.12.0)
and [1.11→1.12 comparison](https://github.com/BabylonJS/Babylon-Lite/compare/npm-lite-v1.11.0...npm-lite-v1.12.0);
the Khronos [`KHR_texture_basisu`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md),
[`KHR_draco_mesh_compression`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_draco_mesh_compression/README.md),
and [`EXT_meshopt_compression`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md)
specifications; official [Draco 1.5.7](https://github.com/google/draco/releases/tag/1.5.7)
and [meshoptimizer 1.2](https://github.com/zeux/meshoptimizer/releases/tag/v1.2)
releases; and Khronos
[glTF-Sample-Assets commit `2bac6f8c…`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf).
The local worker fixture is controlling evidence for this topology.

**Consequences:** Compressed assets never depend on a CDN or DOM script injection.
Decoder code and binaries are install-manifest artifacts and materially increase shipped
bytes; later install/streaming work can cache them normally. The KTX2 gate currently
covers BasisLZ/MSC while all pinned UASTC and Zstd binaries are self-hosted; representative
content must extend fixtures when it adopts another path. Multi-buffer meshopt glTF must
become a build-time QA error when the first asset pipeline slice lands; it has no runtime
fallback. `@babylonjs/core` 9.17.0 is an auto-installed
peer used by the decoder package's shared enum module; Parallax still imports no classic
scene/renderer API and D-080 remains intact.

**Reopen if:** an upstream package ships worker-native ESM injection (remove the matching
adapter after the same fixtures pass), a decoder upgrade changes wrapper shape, another
KTX2 supercompression/transcode path is selected, or representative cell-load p95 shows
decoder initialization must move out of render startup.

## D-088: Keep Rust/Wasm worker startup fail-closed after intermittent instantiation stalls  (2026-07-20, accepted; extends D-085; phase attribution refined by D-092)

**Decision:** Retain D-085's concurrent two-worker initialization, 10,000 ms service
boundary, mandatory participation/correctness checks, and no within-run retry. Add
per-worker `script-evaluated`, `initialize-received`, `module-instantiated`, and `ready`
phase evidence to timeout failures. Do not raise the timeout, automatically retry a
failed launch, or replace the concurrent topology with either independent byte
compilation or serial instantiation merely to make the M0 gate pass.

**Context:** During the same-artifact Chrome 150→151 transition on registered dev-01,
Chrome 151 repeatedly left the D-085 workload nonterminal after the 12,680-byte module
had loaded and compiled. Schema-v26 report
`smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-49-36-294Z.json`
narrowed one physical-console failure to worker phases `[0:ready,1:initialize-received]`:
both module scripts evaluated and received their initialization messages, one instance
became ready, and its peer did not finish `WebAssembly.Instance` within 10 seconds. A
no-tracing retained-profile arm that compiled the same bytes independently in each
worker still failed one of eight relaunches after the affected worker reported
`module-compiled`; serial initialization then failed both attempted relaunches with the
second worker stuck after `initialize-received`, so neither arm is an evidenced safe
mitigation. Separate clean/retained-profile runs also falsified a one-time browser-install
or first-profile explanation. RE-036 carries the full negative evidence and RE-008
separately carries trace-completion failures from the same transition.

The unchanged concurrent topology then passed all six core launches in Chrome 150 anchor
`smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-46-41-973Z.json`
and in Chrome 151 candidate
`smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-58-13-338Z.json`.
Both reports passed all three facets and 24 blocking checks under Node 24.18.0; the
Chrome 151 result was explicitly promoted. This qualifies M0 without erasing the
intermittent platform failure or pretending a retry is correctness.

**Consequences:** A stalled instance invalidates the entire report with enough phase
evidence to distinguish worker-script loading, message delivery, instantiation, and
later execution. M1 production pools must define their own restart/failure policy from
representative workloads; they do not inherit an automatic retry from this synthetic
proof. Chrome 151 remains the promoted baseline because a complete unchanged-artifact
gate passed and the negative runs remain first-class platform evidence.

**Reopen if:** a minimal Chromium reproduction identifies a deterministic trigger or
fix, a current wasm-bindgen/Rust toolchain changes threaded instantiation semantics, or
representative M1 modules demonstrate a safe startup/recovery topology under the same
physical-console gate.

## D-087: Make Chrome baseline promotion an explicit result-store transition  (2026-07-20, accepted)

**Decision:** `smoke@1` records one promoted baseline per scenario, registered machine,
and quality tier in the machine-local ignored result store. Only an aggregate-passing
report with all three facets passing and the complete three-fresh/three-warm measured-run
contract is promotable. The promotion command requires an actor and reason and records
the report filename, report
SHA-256, artifact/source identities, schema and mandatory-metric-set versions, browser
pin/executable identity, and the registered host/GPU/display comparison identity. It
also records the Node collector version and executable digest. It never runs as part of
`m0:gate` or `harness:smoke`. Under the store lock it requires the report's observed
anchor digest to match the currently promoted record; stale reports are rejected.
An `ineligible` passing report can start a deliberately incomparable anchor only with
the additional `--rebaseline` acknowledgement.

Every smoke report labels its baseline state. With no prior promotion it is `untracked`.
With a matching browser it is `current`. A different Chrome executable/version is a
`candidate` only when the artifact digest, mandatory metric set, exact Node collector,
and registered comparison environment match; otherwise it is `ineligible`. Current and
candidate reports compare the fresh/warm mean of each matching budget observation plus
build byte totals against the promoted snapshot. Zero-valued baselines retain an
absolute delta and report the relative delta as unavailable. These deltas are diagnostic attribution evidence; the
unchanged budgets remain the blocking gate. A lead or human reviews a passing candidate,
logs any Chrome-attributable regression as a rough edge, and then explicitly runs
`pnpm harness:baseline:promote <report> --actor <name> --reason <reason> [--rebaseline]`.

**Context:** The methodology already prohibited automatic promotion but no result-store
implementation existed. Chrome Stable advanced from CfT 150.0.7871.115 to
151.0.7922.34 on 2026-07-20 while M0 was closing, making the gap concrete: replacing the
pin without first retaining the old result would erase the comparison point, while
leaving Chrome 150 selected would violate the latest-Chrome project constraint.
Exact-artifact Chrome 150 report
`smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-46-41-973Z.json` was explicitly
promoted before changing the pin. Chrome 151 report
`smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-58-13-338Z.json` then passed all
three facets and 24 checks and was explicitly promoted after review. Current Stable
identity came from Chrome for Testing's official
`last-known-good-versions-with-downloads.json` endpoint, checked 2026-07-20.

**Consequences:** Result schema advances to v26; mandatory metric-set v11 is unchanged.
Promotion revalidates the complete three-fresh/three-warm run contract and serializes
result-store updates under a stale-recoverable exclusive lock. A lock is an intentionally
short five-minute lease: after expiry it is recoverable regardless of PID reuse, and its
contents are re-read before removal so changed ownership detected there is retained.
Failure to verify lock ownership during release warns without changing an
already-persisted promotion into a reported failure. The local store remains
ignored because physical result artifacts are machine-local, but its records are
self-identifying and digest the source report. Chrome advances now produce an inspectable
old/new candidate section and cannot silently become the baseline. `pnpm m0:gate`
composes the existing build, local COOP/COEP server, six-run physical measurement, budget
evaluation, and JSON/Markdown report; promotion remains a separate reviewed action.

**Reopen if:** results gain a shared artifact service that can provide transactional
promotion/audit history, the comparison eligibility contract grows beyond the recorded
host/GPU/display identity, or calibrated relative regression thresholds become useful
enough to add as explicit budgets through a separate decision.

## D-086: Qualify memory64 feasibility without adopting wasm64  (2026-07-19, superseded by D-117 after resolving P-001; historical feasibility/result evidence retained)

**Decision:** Keep memory32 as the production default and keep P-001 open until M1
representative data demonstrates an unavoidable single-module requirement beyond 4 GiB.
Qualify the optional memory64 path with the dedicated `memory64-spike@1` scenario rather
than adding it to `smoke@1`. The measurement apparatus is a Binaryen-assembled WAT pair
whose prepare/scan instructions, working set, and deterministic checksum are identical
except for i32 versus i64 linear-memory addresses. Each run retains one cold, two warm-up,
and thirty measured samples. Measured compile and instantiate phases batch 2,048 synchronous
module constructions and 32,768 instances inside one short-lived nested worker per paired
sample; terminating that worker before the outer 64 MiB, eight-fill prepare and sixteen-scan
kernel phases prevents load-test allocation garbage from contaminating the hot-path sample.
Only the final memory64 instance's additional proof export grows to 65,537 pages and
round-trips `0x0badc0de` at byte address `0x1_0000_0000`; the worker then independently reads
that exact offset through a JavaScript `DataView` and requires it to match the value returned
by Wasm. Production modules remain Rust-authored. WAT is deliberately confined to this
paired experiment so the prepare/kernel comparison does not also measure different compiler
code generation. Because only memory64 contains the proof export, total module bytes and
compile/instantiate timings are end-to-end apparatus observations rather than an isolated
pointer-width delta.

The blocking cost metric is computed in paired order: memory64/memory32 for each adjacent
sample, then p95 within each run, then the ordinary 10% repeat-variance gate separately for
fresh and warm profiles. Absolute arm timings retain their own per-run p95 and variance state
as diagnostic evidence; they are never pooled across launches or substituted for the paired
comparison. A dedicated query mode suppresses the unrelated D-085 synthetic spike, and
measurement browsers use normal Chrome flags; only the short-lived identity browser enables
developer WebGPU fields. Chrome-internals display diagnostics complete before warmup, and
screen plus device-pixel canvas identity are checked before, during, and after the memory64
window under D-034.

**Context:** Pinned Chrome for Testing 150.0.7871.115 on registered physical dev-01
(i9-14900KF, RTX 4080 SUPER, 128 GB class RAM, 3840x2160@60 Hz) passed all six sandboxed
fresh/warm runs in artifact
`memory64-spike-1-a05e3d13d506-dev-01-showcase-2026-07-20T12-25-10.882Z.json`. Every
variant/sample produced checksum `1705018643`; every memory64 run wrote and read the
sentinel at exactly 4 GiB with a 4,295,032,832-byte logical memory. Across 180 measured
samples per variant, the median/worst per-run kernel p95 was 116.190/116.815 ms for memory32
and 115.350/117.660 ms for memory64. Median per-run paired-p95 memory64/memory32 ratios were
1.125x compile, 1.294x instantiate, 1.002x prepare, and 1.030x kernel; every fresh/warm
paired-ratio relative range was at most 4.93%. The separately retained absolute timing
diagnostic was invalid only for fresh memory32 prepare at 10.98% relative range; per the
decision above, that diagnostic is not substituted for or allowed to block the measured
paired comparison. Those results qualify this synthetic apparatus only,
not a general production performance claim. The optimized memory64 module was 294 bytes
versus 211 bytes (1.393x); sparse grow-and-touch took 2.405-3.405 ms, while its 4+ GiB
`byteLength` proves an address range rather than physical commitment or residency.

Current technology state was checked 2026-07-19. Chrome's official release notes and
Blink intent record memory64 enabled by default from Chrome 133; the pinned Chrome 150
run required no memory64 feature flag. V8's current limits define 65,536 pages for
memory32 and 262,144 for memory64. The current WebAssembly memory64 proposal defines i64
load/store addresses and notes memory32's smaller pointer representation. Rust's current
platform-support page still lists `wasm64-unknown-unknown` as Tier 3 without distributed
artifacts, so it was not made the build default. Sources:
developer.chrome.com/release-notes/133,
groups.google.com/a/chromium.org/g/blink-dev/c/5vTbd1dttwc/m/Z4UFehJBAgAJ,
chromium.googlesource.com/v8/v8/+/refs/heads/main/src/wasm/wasm-limits.h,
github.com/WebAssembly/memory64/blob/main/proposals/memory64/Overview.md, and
doc.rust-lang.org/nightly/rustc/platform-support/wasm64-unknown-unknown.html.

**Consequences:** The content-addressed memory32/memory64 pair, positive feature reporting plus
negative validation that memory64 cannot parse without its feature enabled,
same-host byte-repeatability check, engine worker/service telemetry, raw report, and
three-pair physical runner are retained. The scenario is explicitly invoked with
`pnpm harness:memory64`; ordinary launch and `smoke@1` do not reserve the 4+ GiB logical
memory. This resolves the M0 feasibility/cost spike but neither resolves P-001 nor assigns
a performance budget or production wasm64 module.

**Reopen if:** M1 representative memory measurements identify a single module that
cannot meet its requirement through partitioning, streaming, multiple memory32 modules,
or a smaller resident set; a production kernel shows materially different pointer-width
cost; Chrome/V8 changes memory64 limits or semantics; or Rust promotes and distributes a
supported wasm64 target.

---

## D-085: Pin a nightly Rust build-std pipeline for browser wasm threads  (2026-07-19, accepted; extends D-020/D-032)

**Decision:** Author engine WebAssembly in Rust under an exact dated
`nightly-2026-07-16` toolchain (rustc 1.99.0-nightly `d0babd8b6`), rebuild
`std`/`panic_abort` for `wasm32-unknown-unknown`, pin the crate and CLI sides of
wasm-bindgen to 0.2.126, and optimize with pinned Binaryen 131.0.0. Builds enable
`atomics`, `bulk-memory`, `mutable-globals`, `simd128`, and `relaxed-simd`
unconditionally, remap the repository path, and verify the optimized artifact's feature
section and byte repeatability. The M0 proof uses two dedicated module workers over one
fixed 33-page shared linear memory and a 64 KiB per-worker stack. Rust atomics claim and
reduce 262,144 SIMD tasks; exact completion, checksum, nonzero work on both instances,
worker mask, module/memory bytes, and phase timings are mandatory `smoke@1` evidence.

**Context:** A local 2026-07-19 build with current stable Rust 1.97.1 plus atomic target
features produced a shared-memory module, but wasm-bindgen 0.2.126 rejected its thread
transform for missing `__wasm_init_tls`. Rebuilding the standard library with the same
feature floor on the dated nightly produced the required TLS/thread initialization.
This matches wasm-bindgen's current official threads guide, which states that Rust does
not ship a precompiled threading-enabled web stdlib and prescribes nightly
`-Z build-std`. The current official release surfaces checked the same day listed Rust
1.97.1 stable, wasm-bindgen 0.2.126, and Binaryen `version_131`. The first assembled
in-app-Chromium diagnostic also caught and fixed an async-initializer race before any
result was promoted. The final schema-v25 / metric-set-v11 physical-console `smoke@1`
artifact `smoke-1-9a863a19906d-dev-01-showcase-2026-07-20T01-09-27-205Z.json` then
passed all three facets and 24 budget checks. Across six sandboxed runs, both workers
claimed nonzero work, all 262,144 tasks and checksum `0xb5140000` matched, and total
time ranged from 30.8 to 35.8 ms. Review corrected the parallel-execution endpoint to
the second worker completion, before the coordinator's serial reference checksum;
the replacement artifact measured that phase at 15.9-17.6 ms.

**Consequences:** `pnpm build` now owns Rust compilation, wasm-bindgen generation,
Binaryen optimization, content addressing, and a second output-directory rebuild.
Generated bindings and Cargo targets stay ignored. The engine owns worker orchestration;
the Rust crate forbids unsafe code and exposes numeric/atomic operations only. This is
the first concrete Rust pin under D-020 and a targeted dependency review, not the full
M0 currency checkpoint.

**Reopen if:** Rust ships a supported precompiled atomics-enabled browser target,
stable Cargo can rebuild the required stdlib, wasm-bindgen removes the build-std/TLS
requirement, or a measured production module needs a different fixed pool/stack shape.

---

## D-084: Do not promote restart-persistent NPC KV snapshots  (2026-07-19, accepted; closes D-075 and extends D-082/D-083)

**Decision:** Keep llama.cpp live exact-prefix reuse and make idle pre-seeding the
preferred follow-up: after model load, build a clean resident context containing
static world knowledge, tools, and the next character's persona while inference is
otherwise idle, then consume that staged context when the next conversation starts.
Rebuild it after launch or invalidation rather than persisting its KV bytes. Do not
promote D-075's OPFS slot snapshots for the pinned Gemma 4 E2B hybrid model/runtime
combination into the gameplay architecture. Remove the experiment-only service, store,
harness, fixtures, package/source patches, and custom WASM after recording the durable
results; keep no dormant runtime path. Do not run the optional `q8_0`-K/`q4_0`-V point:
symmetric `q8_0` already cuts
snapshot bytes by about 47%, passes quality, and cannot repair the load-bearing partial
restore. Reopen persistent snapshots only when the pinned runtime can restore the full
exact prefix on the target hybrid model and the WebGPU path is stable with the selected
attention configuration.

**Context:** On 2026-07-19, physical-console `npc-prefill-cache-spike@1` runs used
Chrome 150.0.7871.115 Stable on dev-01 (i9-14900KF, RTX 4080 SUPER, 128 GB class RAM,
3840x2160@60 Hz), the five exact D-074 GGUF shards, the checked D-083 WASM
`7723f56e7eeff507c3db43b5f58791cada24954f9591cf3e7e9a8050ca001382`, and final
artifact prefix `a7c4c4e56ed6`. All stable f16/q8_0 and WebGPU/CPU restore cells reported
only 409 cached tokens against 914-916-token exact reusable prefixes. Live same-session
reuse did preserve 914-916 tokens, so the loss is specific to restart persistence, not
fixture tokenization or cache accounting.

The stable cells were faster despite that incomplete state: end-to-first-token ratios
(OPFS read + native restore + generation TTFT, paired to the same character's cold
prefill) were 0.653/0.680 for WebGPU f16 + flash attention, 0.628/0.655 for WebGPU
q8_0, 0.670/0.643 for CPU f16 + flash attention, 0.543/0.612 for CPU f16 without it,
and 0.516/0.569 for CPU q8_0. Those figures satisfy D-083's timing threshold in
isolation but cannot qualify a cache that fails exact-prefix reuse. WebGPU f16 without
flash attention was worse: native restore returned, then first generation repeatedly
aborted inside the pinned llama.cpp/WebGPU module, so it produced no two-restore
result.

F16 snapshots were 12,039,128-12,137,688 bytes (median 12,867 bytes/token); q8_0
snapshots were 6,405,848-6,458,328 bytes (median 6,846-6,873 bytes/token). OPFS reads
were 10.29-25.12 ms and writes 15.74-53.56 ms in completed cells, so storage I/O was
not the blocker. Both WebGPU and CPU q8_0 cells passed all 30 unchanged D-074 quality
generations. Median aggregate user-agent/WASM-memory estimates were about
5.83/1.99 GB on WebGPU and 57.3-59.6/3.39-3.53 GB on CPU; page-attributable VRAM
remained unsupported under D-050. Render callback maxima were 33.35-50.04 ms on the
stable WebGPU cells and 16.92-17.02 ms on CPU, but remain D-051 diagnostics rather
than presentation evidence.

The six final reports are:
`npc-prefill-cache-spike-1-wllama-webgpu-f16-f16-fa-off-a7c4c4e56ed6-dev-01-2026-07-20T00-02-42-366Z.json`,
`npc-prefill-cache-spike-1-wllama-webgpu-f16-f16-fa-on-a7c4c4e56ed6-dev-01-2026-07-19T23-06-03-732Z.json`,
`npc-prefill-cache-spike-1-wllama-webgpu-q8_0-q8_0-fa-on-a7c4c4e56ed6-dev-01-2026-07-19T23-09-44-104Z.json`,
`npc-prefill-cache-spike-1-wllama-wasm-f16-f16-fa-off-a7c4c4e56ed6-dev-01-2026-07-19T23-02-50-702Z.json`,
`npc-prefill-cache-spike-1-wllama-wasm-f16-f16-fa-on-a7c4c4e56ed6-dev-01-2026-07-19T23-18-48-260Z.json`,
and
`npc-prefill-cache-spike-1-wllama-wasm-q8_0-q8_0-fa-on-a7c4c4e56ed6-dev-01-2026-07-19T23-39-21-313Z.json`.

**Consequences:** D-074 remains the production-direction app-owned LLM baseline with
ordinary live `cache_prompt` reuse. A future scheduler may pre-seed one or more clean
conversation contexts during measured idle headroom, but that work must define
cancellation, character priority, memory bounds, and render contention before it is
promoted. No restart-persistent KV dependency, cache budget, or save-data lifecycle is
added. The experiment-only code, dependency patch, and 7.7 MB custom WASM are removed;
the six ignored raw reports remain local on dev-01 under D-081, while this entry carries
the durable figures. This is deliberately a Gemma 4 E2B result, not a claim that persistent KV state
is impossible for every model architecture; separate model-size/performance evaluation
may revisit it for candidates such as Llama 3 3B. A future persistence attempt starts
from a fresh bounded implementation and must first demonstrate full-prefix restore on its exact pinned
model/runtime, then re-run correctness, timing, quality, memory, and real presentation
gates.

**Reopen if:** upstream llama.cpp/wllama changes hybrid-model sequence-state
serialization, a local reproduction restores all exact prefix tokens after restart, or
a separately evaluated pinned model/runtime (including a Llama 3 3B candidate) supplies
portable full-prefix state with a stable WebGPU restore path.

---

## D-083: Bound D-075 to a minimal wllama slot patch and a 20% restore threshold  (2026-07-19, superseded by D-084; extends D-075/D-082)

**Supersession:** D-084 removed the experimental patch, binary, store, fixtures, and
harness after measurement. The entry below describes the bounded measurement setup,
not the current repository runtime.

**Decision:** Keep D-075 on exactly pinned `@wllama/wllama` 3.5.1 and its pinned
llama.cpp submodule, and carry a repository-owned package patch plus WASM binary that
adds only exact chat tokenization and slot-state save/restore actions. The patch also
fixes the raw-field GLUE deserializer fallthrough exposed by the new binary payload;
it does not add another inference backend or a general cache abstraction. Treat a
persistent snapshot as disposable derived data under an exact identity over model and
all GGUF digests, runtime/llama.cpp build, chat template, common token prefix, context
size, K/V cache types, flash attention, device placement, and template arguments. Keep
an LRU hot set of two character snapshots.

For this spike, “materially faster than fresh prefill” means every paired
restart-restore end-to-first-token sample (OPFS read + native restore + generation
TTFT) is at most 80% of the same character's cold-prefill TTFT. This threshold is a
D-075 promotion criterion, not a production dialog budget. Even a faster result cannot
be promoted from M0 alone because D-051 exposes render-worker callback pacing rather
than compositor presentation.

**Context:** The installed wllama source and exact 3.5.1 checkout were inspected on
2026-07-19. Its public TypeScript surface has live `cache_prompt` reuse but no slot
state binding; the pinned llama.cpp server already carries slot save/restore tasks.
The local extension compiled from wllama commit
`766d28e03eeac044fe055327d06b83d3f9b84544` and llama.cpp commit
`dd4623a74f0c85e6b1dd9ee99a92b9c67cac3708` with Emscripten 4.0.20 and Dawn
`v20260317.182325`; the checked binary identity is recorded beside the artifact. The
native wllama build is not byte-repeatable: repeated clean same-path builds of the
initial extension, including single-job builds, alternated between two 7,675,431-byte
digests (`d3a7fa5e…` and `d940e16e…`). Physical preflight then exposed that wllama's
native-read bridge treats a llama.cpp slot filename as a missing model blob. The
bounded correction uses llama.cpp's in-memory sequence-state API and carries the
slot's token history beside the KV bytes; the checked 7,671,921-byte `7723f56e…`
binary therefore adds no snapshot filesystem dependency. That binary remains an
opaque exact input; D-020
level-1 verifies Parallax's packaging of that input and is not cited as source-build
reproducibility. The
memory probe uses the current experimental
[`Performance.measureUserAgentSpecificMemory()` contract](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory),
which estimates the whole cross-origin-isolated application rather than attributing
one worker. That is why the report separates user-agent aggregate memory from the
WASM heap and continues to mark page-attributable VRAM unsupported under D-050.

**Consequences:** The custom binary and package patch are runtime-critical dependency
inputs and receive targeted ledger review. D-074 continues to package the unmodified
wllama 3.5.1 WASM; only D-075 resolves the custom superset binary, preserving the
qualified uncached baseline. The versioned `npc-prefill-cache-spike@1`
run cold-installs the model, populates three static game-owned personas, evicts one,
restarts Chrome on the same profile, restores two, fresh-prefills the miss, and reports
raw identity, reuse, storage, timing, memory, quality, and callback evidence. Quantized
KV configurations re-run the unchanged 30-generation D-074 quality fixture. No
player-derived prompt content enters this cache.

**Reopen if:** wllama publishes a compatible stable slot API, llama.cpp changes state
compatibility or server-slot semantics, measurements justify a different hot-set or
materiality threshold, or Chrome adds attributable worker/GPU memory and presentation
evidence that can replace the current diagnostics.

---

## D-082: Add KV-cache-quantization and flash-attention axes to the D-075 prefill spike; TurboQuant is a no-go  (2026-07-19, accepted; extends D-075)

**Decision:** Extend the D-075 spike matrix with two measurement axes on both the
WebGPU and CPU/WASM placements: flash attention off/on, and KV-cache type `f16`
(baseline) vs `q8_0`, with an optional asymmetric `q8_0`-K/`q4_0`-V point if `q8_0`
alone leaves the snapshot budget short. Every quantized-cache configuration must
re-pass the unchanged D-074 schema/grounding/context fixture — a cache type that
degrades those checks is disqualified regardless of its memory win. Snapshot identity
(D-075) explicitly includes the K and V cache types and the flash-attention setting.
Do not adopt TurboQuant or any out-of-tree KV-compression fork.

**Context:** All claims checked 2026-07-19. The pinned `@wllama/wllama` 3.5.1 already
exposes `cache_type_k`/`cache_type_v` (`f16`/`q8_0`/`q5_x`/`q4_x`) and `flash_attn`
in `LoadModelConfig`, wired to llama.cpp context params (verified in the installed
package source). llama.cpp requires flash attention for a quantized V cache, and the
ggml WebGPU backend's `supports_op` accepts `FLASH_ATTN_EXT` with K/V in exactly
`f16`/`q4_0`/`q8_0` — no `q5` variants — per
[ggml-webgpu.cpp on master](https://github.com/ggml-org/llama.cpp/blob/master/ggml/src/ggml-webgpu/ggml-webgpu.cpp);
the CPU backend covers quantized KV via a dequantize-then-dot fallback. The pinned
wllama wasm binary embeds the WebGPU flash-attention shader family including
block-quantized-KV variants (`flash_attn_vec_blk` et al.) and contains the
`llama_state_seq_save_file`/`load_file` symbols unexposed by the JS action surface,
consistent with D-075. `llama_kv_cache::state_write_data`
([llama-kv-cache.cpp](https://github.com/ggml-org/llama.cpp/blob/master/src/llama-kv-cache.cpp))
serializes K/V rows at the cache's native storage row size and embeds the type ids,
so `q8_0` roughly halves and `q4_0` roughly quarters OPFS snapshot bytes versus
`f16`, and restore requires identical cache types. TurboQuant (Zandieh et al., ICLR
2026): upstream [PR #21089](https://github.com/ggml-org/llama.cpp/pull/21089)
(`tbq3_0`/`tbq4_0`, CPU kernels only) was closed unmerged 2026-06-02 with
maintainers unconvinced it beats existing types at equal bitwidth
([tracking discussion #20969](https://github.com/ggml-org/llama.cpp/discussions/20969));
community forks target CUDA/Metal/ROCm only, so adoption would mean maintaining a
patched llama.cpp inside a custom wllama build for a marginal gain over `q4_0`.

**Consequences:** The spike gains a cheap, fork-free lever that directly reduces the
persistent-cache memory footprint and OPFS transfer volume D-075 measures. Flash
attention is itself a new variable — D-074's 119.64 ms warm-TTFT baseline was
measured without it — so it gets its own before/after column prior to any quantized
run. Community measurements warn that `q4_0` K-cache hurts quality (K is more
sensitive than V) and that dequant overhead can slow long-context attention; both
are measurement targets at our fixture sizes, not assumptions. Uncached and
`f16`-cache controls remain so D-074 comparability is preserved.

**Reopen if:** TurboQuant or a comparable sub-4-bit KV method lands in upstream
llama.cpp and ships in a pinned wllama release, the WebGPU backend's supported
flash-attention cache types change, or spike measurements show quantized KV
regressing TTFT or fixture quality with no acceptable configuration.

---

## D-081: Raw harness result artifacts stay out of version control  (2026-07-19, accepted; refined by D-099)
**Decision:** `harness/results/` stays untracked, and no tracked evidence mirror is
added. The doc that cites a result — decision entry, finding, budgets baseline,
research doc — must itself record the load-bearing numbers and context, because the
documented top-line results are the durable record. Raw result JSONs and report files
are per-machine byproducts; recovering raw detail means re-running the pinned scenario
(harness rule 1: pinned Chrome, versioned run contracts, recorded environment), not
consulting an archive.

**Context:** A 2026-07-19 review found that every doc-cited artifact (27 files,
~14 MB, spanning the spike evidence through D-080) existed only on dev-01 and was one
`git clean` from loss; a tracked `harness/evidence/` mirror with a citation contract
test was prototyped in-tree. Pat rejected it: planned write-ups need only the
documented top-line results, and multi-megabyte measurement JSONs (a single
app-owned-LLM run reaches 6.6 MB) would grow the repository indefinitely for data
nobody re-reads. This is a deliberate decision *not* to preserve raw artifacts (root
rule 1), so the gap is not rediscovered and the mirror re-added.

**Consequences:** Losing a machine's results directory loses raw detail but not the
record. The citation discipline carries the weight: an entry that leans on a
measurement must quote the figures it relies on (as D-056 through D-080 already do)
rather than deferring to the raw file; a bare filename citation identifies the run but
is not, by itself, durable evidence. Local results directories are still kept on the
machines that produced them on a best-effort basis.

**Reopen if:** an external consumer (a Chrome bug report, fact-checking a publication)
needs raw artifacts the docs did not capture, a disputed result can no longer be
reproduced by re-running its pinned scenario, or low-cost external archival (LFS, an
artifact store keyed by the recorded digests) becomes worth the setup.

## D-080: Commit exclusively to Babylon Lite; remove renderer swappability  (2026-07-19, accepted; supersedes D-078's retained classic comparison path)
**Decision:** Babylon Lite is Parallax's sole rendering core. Remove the classic Babylon
dependency and adapter, the `PARALLAX_RENDERER` build/development selector, the
engine-neutral `RenderWorkerBackend` interface, and the manifest/telemetry identity
contract that existed only to verify a selected backend. Rendering code may use Lite's
data structures and APIs directly inside `engine/`; it does not preserve parity with a
hypothetical second engine. Keep the game-facing render service, worker message protocol,
frame/telemetry loop, and SAB transport because those are Parallax subsystem and process
boundaries, not renderer-swapping abstractions.

**Context:** D-078's classic adapter was a useful controlled-spike instrument: it let the
same walking skeleton measure Lite and classic at the same worker boundary. It is not a
sustainable product architecture. M1's Lite-specific decoder bootstrap and data flow,
P-002's native WebGPU interop, and later streaming/render data structures would either
grow a common-denominator interface or require a second implementation and fixture
matrix for a renderer that never ships. That cost would also work against the root
constraint forbidding build-time engine abstraction layers. The local D-078 comparison
already supplied the evidence needed to select Lite; preserving its two raw result
artifacts preserves the finding without preserving the tested implementations.

**Consequences:** The render worker is one Lite-specific entrypoint. The preexisting
manifest v4 and telemetry v5 contracts remain sufficient; `smoke@1` still records exact
engine/render-worker artifact paths and bytes, but no longer negotiates or cross-checks a
renderer identity. Future Lite capabilities go directly into the `engine/render` and
render-worker implementation while game code continues to depend only on Parallax
services and typed snapshots. A future Chrome issue that needs cross-engine isolation
gets a bounded reproduction built for that finding; it does not make the product carry a
permanent second backend. If the engine choice itself must be revisited, make a new
measured migration decision rather than maintaining speculative compatibility today.

The final Lite-only production build passed `smoke@1` schema v24 / mandatory-metric-set
v10 on registered dev-01 under Chrome 150.0.7871.115 and the production sandbox: all
three facets, six core runs, and 24 budget checks passed. Artifact
`smoke-1-a4824e1bef7e-dev-01-showcase-2026-07-19T20-33-11-523Z.json` records 581,328
combined engine+render-worker bytes (420,117 + 161,211), 14 fewer than the final
selector-enabled Lite build. One same-artifact schema-v23 attempt was invalidated when
one warm trace produced no chunks before the existing five-second drain bound; its exact
rerun and the final schema-v24 run completed normally. The existing informational
V8-code-cache, compositor,
GPU-memory-attribution, OPFS-repeatability, and trace-drain limitations remain
non-blocking; no new platform finding arose.

**Reopen if:** Lite develops an unbounded roadmap blocker or a measured challenger is
materially better enough to justify an engine migration. Reopening selects or migrates
the rendering core; it does not reinstate standing multi-engine parity by default.

## D-079: Review all versioned dependencies at milestone boundaries and every 28 days  (2026-07-19, accepted)
**Decision:** Generalize D-078's deliberate Babylon Lite upgrade rule to every versioned
external input selected or pinned by the repository: direct and security-relevant
transitive packages, browser/CfT pins, models and their tokenizer/chat-template identity,
decoder/WASM assets, and future Rust toolchains/crates. Run a repository-wide currency
checkpoint at each milestone entry and every 28 calendar days during an active milestone,
whichever comes first; credible security advisories, due deferral triggers/dates, and
releases that credibly fix or unblock an issue affecting planned or implemented work
trigger an immediate review. Exact pins remain mandatory. Each candidate is adopted,
explicitly deferred with evidence plus a recheck trigger/date, or marked not applicable;
nothing auto-merges or refreshes the lockfile unattended. The complete tiering, procedure,
and living review ledger are in [dependencies.md](dependencies.md).

**Context:** D-020 made builds repeatable by exact-pinning dependencies, but defined no
currency mechanism. D-078 similarly said Lite upgrades must be deliberate reviewed
changes without ensuring that a review would recur. Over a multi-month project, those
rules prevent silent drift but can silently fossilize the engine, inference stack,
browser/toolchain, and asset decoders. A calendar-only cadence can interrupt milestone
work, while milestone-only reviews can be months apart; the earlier-of rule bounds both
failure modes. The policy covers non-package inputs because model revisions, decoder
binaries, CfT, and future wasm tooling can change runtime behavior as materially as an
npm package.

**Consequences:** Runtime/platform-critical component families upgrade one at a time
with upstream-note/API review, `pnpm check`, repeatability, relevant subsystem fixtures,
and same-scenario physical-harness comparison against the old pin when performance or
runtime behavior can move. Build/measurement tooling uses a proportionate gate but must
run a physical smoke whenever emitted bytes, browser launch/tracing, serving, or metric
semantics may change. Supporting tools may batch only while bisectable. Transitive pins
move through their owning direct dependency unless a concrete advisory/bug justifies an
isolated change. Every milestone exit requires a checkpoint no more than 28 days old;
one full checkpoint may cover both an exit and the immediately following milestone entry
when they occur in the same transition change. A targeted trigger review does not reset
the full-repository cadence. M0 gains the first full review, due by 2026-08-16. Reviews
and deferrals update the dependency ledger; behavior/constraint changes still update
decisions, architecture, budgets, plan, or findings under the existing rules.

**Reopen if:** the cadence produces churn without catching meaningful changes, a class
of external inputs needs a different interval, official release channels cannot support
same-scenario old/new evaluation, or project automation can safely prepare evidence-
complete upgrade changes without weakening the human commit gate.

## D-078: Adopt Babylon Lite as the rendering core  (2026-07-19, accepted; supersedes D-004's classic-Babylon component choice and concludes D-077; retained classic path superseded by D-080; recurring upgrade cadence generalized by D-079)
**Decision:** Make exactly pinned `@babylonjs/lite` 1.11.0 the default
scene/material/animation core. Keep Parallax's render service, worker protocol, frame
loop, scheduling, streaming, memory ownership, and telemetry boundary unchanged. Retain
the classic-Babylon adapter and exact dependency only as an explicitly selected
comparison path (`PARALLAX_RENDERER=babylon-classic`) in production builds or Vite
development; it is not in the default shipped render worker. The build manifest and
runtime telemetry name the selected renderer, and
`smoke@1` rejects a mismatch.

**Context — measured gate:** Both implementations ran the same schema-v23 / mandatory-
metric-set-v10 production-sandbox physical-console gate on registered dev-01, Chrome
150.0.7871.115 at 3840x2160@60 Hz, three fresh/warm pairs each. Both passed environment,
evidence-completeness, all six core runs, all 24 budget checks, the exact dedicated-
worker topology, and the 100,000/100,000 SAB exchange with zero payload or sequence
errors. Lite's render worker was 161,033 bytes against classic's 5,266,167 (96.94%
smaller); combined engine+render-worker bytes were 581,214 against 5,686,348 (89.78%
smaller). Across the six core runs, Lite reduced mean fresh startup 211.31→170.87 ms
(19.1%), mean warm startup 149.90→123.24 ms (17.8%), mean render CPU p95
0.431→0.203 ms (53.0%), and mean all-realm JS heap 9.37→3.89 MB (58.5%). Render-
callback p95 was effectively equal (16.762 vs. 16.735 ms). Lite's internal worker-init
interval was slower (fresh 97.28→149.04 ms; warm 93.38→112.99 ms), but its much smaller
worker-bootstrap overhead still produced the better end-to-end startup outcome. GPU-memory
attribution remained unsupported for both and is not claimed as a Lite win. Raw
artifacts: `smoke-1-f7e08a362e94-dev-01-showcase-2026-07-19T19-27-01-694Z.json`
(Lite) and `smoke-1-106bd4023874-dev-01-showcase-2026-07-19T19-29-39-539Z.json`
(classic). After the renderer selector was also wired through Vite development, final
default-build replacement artifact
`smoke-1-9f1b9ff3f0f3-dev-01-showcase-2026-07-19T20-10-32-910Z.json` passed the same
three-facet, six-run, 24-check gate at 581,342 combined bytes; the Lite render-worker
artifact remained unchanged.

**Context — roadmap floor:** The official repository/docs and the exact published
package source at tag `npm-lite-v1.11.0` / commit
`b7993d58a709edc4c3299014d300b992ee0b8e7c` were checked 2026-07-19. Uncompressed
glTF/GLB, thin instances (including GPU-culling indirect draw), skeletal animation,
morphs, and animation groups are present. KTX2 (`KHR_texture_basisu`), Draco, and
meshopt decode paths are partial in the selected worker topology: their decoder
bootstraps fall back to `document`, which is absent in a module worker, unless the
expected `KTX2DECODER`, `DracoDecoderModule`, or `MeshoptDecoder` global is already
installed. M1 therefore bundles and preinstalls the pinned decoders before loading one
fixture of each type; if a decoder cannot initialize that way, the bounded fallback is
to patch only its bootstrap to use a worker-safe dynamic import. Meshopt also handles
only canonical single-buffer GLB; M1's exporter/QA gate constrains and fixtures that path,
with upstreaming or a local loader patch if multi-buffer content becomes necessary.
Compute is used internally, but a generic public compute/raw-device/queue API is absent.
Before P-002 needs it, one pinned, isolated native-interop adapter will expose
the internal device with compile-time and runtime guards plus a harness probe while we
seek an upstream supported accessor. Thin-instance indirect draw is present; arbitrary
custom indirect submission shares that bounded native-interop seam. Skeletal animation
is present, but animation events are absent and morph targets are capped at four. Game-
state events remain fixed-timestep simulation data; M3 adds a representative character
fixture and, if visual-only clip callbacks are needed, a small engine-owned timestamp-
marker utility with loop/seek/cross-fade tests. Asset QA enforces the four-active-morph
limit; a character that exceeds it must use skeletal/VAT animation or first justify a
bounded shader-path extension. No required roadmap capability is absent without a
bounded plan.

**Consequences:** D-004's rejection of Unity, Godot, Bevy, and from-scratch and its
ownership boundary still stand; only the classic-Babylon component is superseded. Lite's
unstable API is a real maintenance cost: exact version only, upgrades reviewed as explicit
changes, all Lite calls confined to `engine/`, and no compatibility wrapper beyond the
small renderer/native-interop adapters. The much smaller default artifact is a measured
structural advantage for launch-2+ as well as a CPU/heap win. No Chrome rough-edge entry
is added: the unresolved items here are library API gaps, while the equal GPU-memory
attribution limitation is already represented by the harness's informational evidence.

**Reopen if:** a pinned Lite upgrade breaks outside the bounded adapters, the M1 asset
fixture or P-002 interop probe cannot be supported with a spike-sized patch, M3 animation
requirements expose an unbounded gap, or a same-gate comparison shows classic Babylon or
another web-native core materially better on Parallax's axes.

## D-077: Pull the Babylon Lite evaluation forward into M0 as the next task  (2026-07-19, accepted; concluded by D-078)
**Decision:** Do not wait for D-076's Babylon Lite reopen trigger (API stability + feature
floor) to fire on its own. M0 gains a go/no-go spike, ordered as the next task: port the
walking skeleton to Babylon Lite behind the unchanged `engine/` boundary, run the identical
`smoke@1` physical-console gate on both implementations, audit Lite's feature floor against
the roadmap (M1 asset path: glTF/KTX2/Draco/meshopt, thin instances, compute; M3+: skeletal
animation; interop: raw device/queue access, indirect-draw prospects), and switch the
platform to Lite only if it passes the same gate with materially better or
equal-with-structural-advantage measurements **and** no roadmap feature is absent without a
bounded build-it-ourselves plan. Full criteria in plan.md M0; verdict lands as its own
decision entry either way.
**Context:** Lite's design goals line up with this project's axes point-for-point —
WebGPU-exclusive (D-002/D-004), data-oriented/CPU-lean and tree-shakable (the top classic-
Babylon weaknesses in rendering-engine-research.md §6), OffscreenCanvas-in-worker as a
design goal (D-056 topology) — and its missing systems (LOD, octree culling, particles,
GUI) overlap almost entirely with what we hand-build or cannot use in a worker anyway. The
deciding argument for *now* rather than *later*: switching cost is at its lifetime minimum
at the walking-skeleton stage and grows with every milestone. Known risks the spike must
price rather than assume away: Lite declares its APIs unstable (exact-version pinning, no
compat promise — a real cost against classic Babylon's compat policy), its feature floor
for M3+ animation is unverified, and all headline performance multipliers are vendor
self-reported (root rule 3: the harness decides). Checked 2026-07-19:
github.com/BabylonJS/Babylon-Lite (v1.11.0, Apache-2.0), its feature-comparison doc, and
the June 2026 announcement — full sourcing in rendering-engine-research.md §7.
**Consequences:** plan.md M0 gains the spike (scope change logged per plan.md's own rule);
rendering-engine-research.md §1/§7 updated — the passive watch item becomes an active M0
evaluation. D-075's KV-prefill spike and the remaining M0 items queue behind it.
**Reopen if:** the spike stalls on Lite immaturity for more than a spike-sized effort —
then revert to the passive D-076 trigger and record what blocked it.

## D-076: Consolidate rendering-engine research into rendering-engine-research.md; three.js evaluated post-hoc, choice stands  (2026-07-19, accepted)
**Decision:** All rendering-engine-choice knowledge lives in one living doc,
[rendering-engine-research.md](rendering-engine-research.md), which folds in and replaces
`why-not-unity.md` (D-046's evidence pack) and adds three new sections: a post-hoc three.js
evaluation, an honest Babylon weaknesses / roll-our-own list, and a Babylon Lite watch item.
The doc is maintained by deletion — stale content is removed when corrections or newer
information land; git history is the archive (same model as decision-log culling, D-023).
**Context:** three.js was never considered in D-004 (it appears nowhere in the repo,
including the ideation history) — a real gap, since it is the most popular web 3D library by
~55x npm downloads and "why not three.js?" is the first public question the engine choice
draws. Researched 2026-07-19 (three.js r185, Babylon 9.17.0): the choice stands. three.js
shares all of Babylon's Tier-1 structural advantages over Unity, but loses on our axes —
WebGPURenderer officially "experimental" and opt-in, custom shading locked behind TSL with
no raw-pipeline path, worker/OffscreenCanvas unofficial and broken for a full release in
r179 (issue #31605), breaking changes every release, JS with lagging external types, and
renderer-not-engine scope. It genuinely beats classic Babylon on one axis — a public
indirect-draw API (`IndirectStorageBufferAttribute`) — which is recorded as a Babylon
weakness (roll-our-own area, P-002), not a switch reason. The same research surfaced
**Babylon Lite** (June 2026, verified: WebGPU-exclusive, data-oriented, tree-shakable,
pixel-parity goal, v1.11.0, APIs unstable) — added as a new D-004 reopen trigger with a
harness-measured head-to-head as the gate.
**Consequences:** `why-not-unity.md` is deleted; AGENTS.md doc map and RE-011's reference
updated to point at the new doc. D-004/D-046 status lines annotated. Future engine-state
research (re-verifications, new alternatives, Babylon Lite tracking) updates the doc in
place rather than spawning new files.
**Reopen if:** the doc grows past usefulness as a single file (split by vendor then), or a
future engine decision (e.g., adopting Babylon Lite) warrants its own evidence pack.

## D-075: Measure NPC KV-prefix reuse and OPFS persistence as a separate optimization spike (2026-07-17, accepted)

**Decision:** Keep D-074's app-owned backend qualification unchanged and schedule
context-prefill caching as a distinct M0 optimization spike. The spike first measures
in-process exact-prefix reuse for shared world/persona tokens, with cold-prefill and
warm-prefix TTFT reported separately. It then tests restart-persistent per-character
KV snapshots in OPFS through the smallest practical wllama state/slot extension. A
snapshot is disposable derived data, never authoritative NPC or player state, and is
valid only for an exact model/GGUF, runtime, tokenizer/chat-template, token-prefix,
context, and KV-configuration identity.

**Context:** The pinned `@wllama/wllama` 3.5.1 package exposes `cache_prompt` for live
reuse but its public action surface does not expose llama.cpp state or slot
save/restore, and the current wrapper configures one parallel slot; these points were
verified against the installed source on 2026-07-17. Upstream llama.cpp documents
largest-prefix prompt reuse and server slot save/restore, while its public API exposes
state size/get/set and file save/load operations; the official
[server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
and [`llama.h`](https://github.com/ggml-org/llama.cpp/blob/master/include/llama.h) were
checked the same day. Those capabilities establish feasibility, not a Parallax result:
snapshot size, OPFS transfer behavior, GPU rehydration, multi-character residency, and
render contention remain measurement targets.

**Consequences:** The optimization is not folded into the current D-074 change or its
119.64 ms short-fixture / 15,653.09 ms large-context baseline. The follow-up must retain
uncached controls, measure WebGPU and CPU/WASM placements, and test a bounded hot set
rather than assume every character context can remain resident. Player-derived prompt
content follows save-data privacy and lifecycle rules if it is ever persisted; only
static, non-private character prefixes are candidates for install-time prebuilding.

**Reopen if:** wllama exposes stable persistent-slot APIs before the spike, llama.cpp
changes state compatibility or streaming semantics, exact-prefix reuse does not reduce
the representative prefill outcome, or saved-state restoration costs more than fresh
prefill once storage and graphics contention are included.

---

## D-074: Qualify Gemma 4 E2B QAT GGUF on wllama WebGPU; retain CPU/WASM as a headroom mode (2026-07-17, accepted)

**Decision:** Select `@wllama/wllama` 3.5.1 with Unsloth's QAT-derived Gemma 4 E2B
`UD-Q4_K_XL` GGUF as P-007 phase A's qualifying app-owned backend. Pin
`unsloth/gemma-4-E2B-it-qat-GGUF` at revision
`66a399f68ddd113b06dff02fca9523e55465d11d`. The 2,620,370,976-byte source GGUF has
SHA-256 `e531007218dfab990486a5de7676a6932d6ea8dea233d1f698d7c21cf8a16889`.
`llama-gguf-split` from llama.cpp b10064 deterministically produces five exact-manifest
shards totaling 2,620,371,552 bytes; the largest is 1,321,205,952 bytes, below
wllama's 2 GiB per-file ceiling.

Use all-layer WebGPU offload as the qualifying placement and retain `n_gpu_layers: 0`
as an explicit CPU/WASM measurement mode, never an automatic fallback. wllama's
controller remains window-owned because its URL resolver reads `document.baseURI`;
llama.cpp execution, WebGPU, OPFS access, and pthread work remain in wllama-created
workers. Structured cases use wllama/llama.cpp's native strict JSON-schema response
constraint. D-073's 120-second no-forward-progress load boundary remains unchanged.

**Context / evidence:** Physical-console artifact
`app-owned-llm-spike-1-fd85032d3831-dev-01-2026-07-17T18-57-21-704Z.json` passed the
full unchanged fixture on sandboxed Chrome for Testing 150.0.7871.115. Warm TTFT p95
was 119.64 ms across twenty samples; mean decode throughput across all thirty
generations was 60.27 tokens/s. All schema, grounding, and short/medium/large context
checks passed. The 4,805-token GGUF-tokenized large case completed with 15,653.09 ms
TTFT. Cold and restart-warm model loads were 9,319.87 ms and 3,996.48 ms, with exact
five-shard OPFS write/read evidence. The concurrent render-worker callback diagnostic
retained 2,580 samples at 16.79 ms p95.

The CPU/WASM artifact
`app-owned-llm-spike-1-4e24f4809c68-dev-01-2026-07-17T18-39-34-316Z.json` proved that
the same GGUF loads and completes every context tier without an inference GPU. Warm
TTFT p95 was 383.30 ms and mean decode throughput was 9.60 tokens/s, but the 4,805-token
large-context prefill took 311,200.58 ms. That artifact predates the JSON-schema
constraint and therefore remains a non-qualifying topology measurement rather than a
second pass artifact.

This reverses only D-073's backend-selection conclusion, not its ONNX findings. The
ONNX mobile-QAT graph still fails at its 6,456-token tier on WebGPU, and ORT WASM still
lacks `GatherBlockQuantized`. The GGUF route succeeds because it uses a different model
container and llama.cpp kernels, not because those ONNX gaps disappeared. The current
[wllama documentation](https://github.ngxson.com/wllama/docs/) confirms WebGPU,
CPU-only `n_gpu_layers: 0`, split GGUF, OPFS-backed model management, and the per-file
limit. The pinned
[Unsloth QAT GGUF repository](https://huggingface.co/unsloth/gemma-4-E2B-it-qat-GGUF)
provided the exact source identity; both were checked 2026-07-17 and the local run is
the controlling evidence.

**Consequences:** P-007 phase A now has a qualifying app-owned backend without
weakening the 1.5-second TTFT, structured-output, context, exact-cache, or render
diagnostics. It outperforms the measured Prompt API TTFT and the ONNX E2B TTFT on
dev-01, but page-attributable VRAM remains unavailable, and the walking skeleton is
not evidence of contention against final game assets. WebGPU is the current default
candidate; CPU/WASM is a deliberate graphics-headroom option whose long-context cost
must be acceptable to the calling gameplay system.

**Reopen if:** an official Google GGUF or another quant materially improves quality or
memory at the same fixture, wllama removes its window-bound controller, a later game
workload reveals unacceptable GPU contention, Chrome exposes attributable VRAM, or an
ONNX/LiteRT/WebNN route passes the same gate with a better measured tradeoff.

---

## D-073: Bound app-owned model-load stalls; published Gemma 4 CPU/WASM quantizations are a no-go (2026-07-17, superseded by D-074)

**Decision:** Apply the Prompt spike's fail-closed loading discipline to the app-owned
runner: while `loading-model`, abort after 120 seconds without a strictly higher
aggregate progress value, retain the partial cache/model telemetry, close the browser,
and skip the warm phase when the cold load stalls. The existing 45-minute completion
ceiling remains for phases that continue making load progress or have advanced to
warmup/generation.

Close the published Gemma 4 E2B WASM/CPU experiment as a measured no-go. Preserve a
reproducible CPU diagnostic using the standard repository's smaller q4 graph, pinned at
D-072's revision with nine exact artifacts totaling 3,646,892,071 bytes. It is not a
qualification candidate and is never an automatic fallback. WebGPU remains on D-071's
mobile-QAT q2f16 graph.

**Context / evidence:** The q8 physical-console artifact
`app-owned-llm-spike-1-a6ea4cbdc9e6-dev-01-2026-07-17T17-31-17-052Z.json` stopped at
0.6205 progress after `Array buffer allocation failed`, with 10/12 artifacts verified,
1,797,484,666 bytes written, and zero integrity failures. Its published embedding
external-data shard is 2,348,810,240 bytes. Transformers.js 4.2.0's browser
`readResponse()` preallocates `new Uint8Array(total)` and returns each complete model
file as one buffer; this makes the export's shard size and concurrent model loading a
browser/library allocation problem rather than an OPFS streaming or hash failure. The
120,569 ms watchdog then ended the run and correctly skipped the warm retry.

The smaller-shard q4 artifact
`app-owned-llm-spike-1-5aa7eed16ab4-dev-01-2026-07-17T17-36-44-003Z.json` got past
that allocation cliff but failed session creation in both phases: ORT's WASM CPU
provider has no implementation for `GatherBlockQuantized(1)` in
`/model/embed_tokens/Gather_Quant`. D-071's mobile q2f16 graph fails on the same missing
CPU kernel. The repository's published q4 files top out at 1,864,102,912 and
1,762,656,256 bytes; the file listing and Transformers.js usage surface were checked on
2026-07-17 at
https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/tree/main/onnx.

**Consequences:** M0 has a bounded, evidence-preserving failure path instead of waiting
45 minutes on a dead model load. The CPU topology would need a CPU-specific ONNX export
using supported operators, or an ORT WASM kernel for `GatherBlockQuantized`; QAT itself
is not the blocker. P-007 phase A is a valid negative spike result: E2B WebGPU is fast
but fails the unchanged 6,456-token context, while all tested published CPU
quantizations fail before inference. No backend is selected by this decision.

**Reopen if:** ORT adds the missing WASM kernel, a CPU-targeted Gemma export appears,
Transformers.js gains a path-based/streaming external-data handoff that avoids whole-
file buffers, or a new app-owned candidate can satisfy the unchanged fixture and
budgets.

---

## D-072: Add a CPU/WASM E2B q8 topology branch and a context-first diagnostic (2026-07-17, superseded by D-073)

**Decision:** Keep D-071's E2B mobile-QAT q2f16 graph as the WebGPU branch and add an
explicit WASM/CPU branch using the standard E2B ONNX export's q8 files. Pin
`onnx-community/gemma-4-E2B-it-ONNX` at revision
`9f4bef82ea6e296bc69f8a2f5939f73af81b07a6`, dtype `q8`, with an exact twelve-file
text manifest of 6,240,975,994 bytes and per-file SHA-256. Device selection is part of
the worker request and telemetry; it is never an automatic fallback.

Add a reproducible, explicitly non-gating context-first fixture order. It uses the same
cases and repetitions, but a 256-token short context supplies the excluded warmup and
the unchanged 6,456-token large case runs first. The runner injects a permanent error
for this order so its artifact cannot pass qualification even if all metrics complete.

**Context / evidence:** D-071's normal-order E2B WebGPU artifact
`app-owned-llm-spike-1-2b912b1a0d56-dev-01-2026-07-17T16-39-02-164Z.json` completed
28 generations per phase and then lost a WebGPU buffer on the large case. Context-first
artifact `app-owned-llm-spike-1-767efbd56b0d-dev-01-2026-07-17T16-43-05-283Z.json`
failed the same case immediately after short warmup in both phases, ruling out retained
state from the prior 28 generations. The pinned tokenizer measured short/medium/large
inputs at 256/1,656/6,456 tokens.

Trying the mobile-QAT graph unchanged on WASM was also fail-closed: ONNX Runtime 1.27's
CPU execution provider has no kernel for its custom `com.microsoft.GatherBlockQuantized`
operator. The current Transformers.js guidance identifies q8 as the usual WASM dtype;
the standard E2B repository supplies a `quantized` graph for that path. Its substantially
larger install is recorded rather than hidden behind the mobile model's size.

**Consequences:** the CPU branch can answer whether preserving GPU headroom is worth
CPU/system-memory/latency costs, but it must first prove operator compatibility and the
6,456-token diagnostic before a full cohort. WebGPU and WASM cache evidence are checked
against different pinned identities. E2B WebGPU remains fast at 206.90 ms warm TTFT p95
but cannot qualify at the current context tier.

**Reopen if:** ORT adds a WASM kernel for the mobile operator, a smaller CPU-compatible
QAT export appears, context behavior changes in Chrome/ORT, or measured q8 CPU costs make
the branch clearly nonviable.

---

## D-071: Test Gemma 4 E2B mobile-QAT for game GPU headroom (2026-07-17, superseded by D-072)

**Decision:** Move the P-007 phase-A candidate from E4B to the smaller Gemma 4 E2B
mobile-QAT q2f16 export while retaining ONNX Runtime Web 1.27.0, the standalone-template
adapter, all fixtures, thresholds, topology, and fail-closed cache/result contracts.
Pin `onnx-community/gemma-4-E2B-it-qat-mobile-ONNX` at revision
`5cd5514efd375abf2801c856a3936b259cc00133` and its exact nine-file text manifest:
2,324,194,278 bytes with per-file SHA-256.

**Context / evidence:** the corrected E4B run on ORT 1.27 and the pinned template
completed 28 generations in both phases, measured warm TTFT p95 at 250.95 ms over
twenty samples, and proved all ten 3.36 GB cold writes and warm reads. Both phases then
failed the large-context case with ONNX Runtime `std::bad_alloc`; the warm phase also
reported a render-worker failure after the allocation event. Artifact
`app-owned-llm-spike-1-172a264d5607-dev-01-2026-07-17T16-33-33-429Z.json` is the valid-
environment failed cohort. This directly confirms the GPU/memory-headroom concern that
motivated the user's E2B suggestion; no threshold or context case is being reduced.

The pinned [E2B mobile-QAT ONNX repository](https://huggingface.co/onnx-community/gemma-4-E2B-it-qat-mobile-ONNX/tree/5cd5514efd375abf2801c856a3936b259cc00133)
uses the same q2f16/runtime/template family at 1.04 GB fewer installed bytes. The
repository API tree supplied sizes and LFS SHA-256 values; the small Git-backed files
were downloaded and hashed locally.

**Consequences:** E4B remains strong latency evidence but is not safe for the complete
game-concurrent workload on dev-01. E2B must earn selection on the unchanged grounding,
JSON, context, raw-quality, throughput, cache, and render-impact contract. Its lower
published capability is not assumed acceptable.

**Reopen if:** E2B fails quality or context, a browser/runtime fix makes E4B allocation
stable with sufficient render headroom, or measured shared-device scheduling changes
the memory tradeoff.

---

## D-070: Pin and install Gemma 4 mobile-QAT's standalone chat template (2026-07-17, superseded by D-071)

**Decision:** Extend D-069's exact E4B mobile-QAT install manifest with the ONNX
repository's `chat_template.jinja` at the same pinned revision: 17,336 bytes,
SHA-256 `2f1b4d75d067bae3fe44e676721c7f077d243bc007156cb9c2f8b5836613d082`.
The exact ten-file install is 3,361,444,702 bytes. Cold install fetches, hashes, and
publishes the template through the same OPFS cache; warm launch must read it from OPFS.
After pipeline creation, the worker assigns those verified template bytes to the
tokenizer before warmup or measured generation.

**Context / evidence:** D-069's physical-console ORT 1.27 run proved that the 2-bit
embed and decoder sessions now create: all nine prior artifacts were verified on cold
write and warm read. Both phases then failed before warmup because
`tokenizer.chat_template` was unset. The pinned ONNX repository contains a standalone
[chat_template.jinja](https://huggingface.co/onnx-community/gemma-4-E4B-it-qat-mobile-ONNX/blob/4d18aa8b54e354bec4705e4a4894f5bbf8956c3d/chat_template.jinja),
and the official parent checkpoint uses the same standalone-file layout. Python's
current processor loads that repository file, while Transformers.js 4.2.0 only exposed
the tokenizer without attaching it. Artifact
`app-owned-llm-spike-1-e7e0cdf0b1ac-dev-01-2026-07-17T16-24-33-709Z.json` retains the
fail-closed cold/warm error and complete cache evidence.

**Consequences:** the template is model data, not hand-written application prompt
logic. It is revision-pinned, hash-verified, offline-reavailable, and included in install
size/cache qualification. A future Transformers.js version that loads the standalone
file itself must produce the same bytes or trigger an explicit manifest/decision update.

**Reopen if:** Transformers.js natively loads the pinned template, the ONNX export
embeds it in tokenizer metadata, or a different runtime removes this adapter boundary.

---

## D-069: Retest mobile-QAT Gemma 4 E4B on its required ONNX Runtime 1.27 (2026-07-17, superseded by D-070)

**Decision:** Restore D-067's pinned E4B mobile-QAT q2f16 text manifest and override
Transformers.js's older ONNX Runtime Web dependency with pinned `onnxruntime-web`
1.27.0. The exact nine-file install is 3,361,427,366 bytes. Keep D-067's dedicated
worker, OPFS-integrity, fixture, telemetry, and gate contracts unchanged. Keep E2B
mobile-QAT as the next candidate if E4B fails the complete context run or leaves
impractical GPU headroom; do not switch merely to make this run pass.

**Context / evidence:** the ONNX Community
[mobile-QAT E4B model card](https://huggingface.co/onnx-community/gemma-4-E4B-it-qat-mobile-ONNX)
explicitly requires ONNX Runtime 1.27.0 or newer and shows the q2f16 graphs with the
WebGPU execution provider. The underlying official Google
[mobile-QAT checkpoint](https://huggingface.co/google/gemma-4-E4B-it-qat-mobile-transformers)
describes its custom `wNa8o8` layout as intentionally using targeted two-bit decoder
layers, optimized KV caches, and static activations. The built Parallax AI worker
identified its Transformers.js-supplied runtime as
`1.26.0-dev.20260416-b7804b056c`; that predates the model's stated runtime floor and
explains RE-026's explicit 4/8-bit kernel rejection. ONNX Runtime Web 1.27.0 is now a
published stable browser package, so a pinned override is narrower and more faithful
to the requested model than abandoning mobile-QAT.

The intervening D-068 q4f16 run remains useful evidence. On a valid physical-console
environment it completed all nine cold OPFS writes and nine browser-restart OPFS reads,
measured warm gate-watch TTFT p95 at 302.79 ms over twenty samples, and retained 4,980
render-worker callback intervals at 16.74 ms p95. It failed exact JSON (the model added
Markdown fences in all five cases) and deterministically invalidated a WebGPU buffer
on the large context after completing the 1,656-token medium context. Artifact
`app-owned-llm-spike-1-48812e6c72bd-dev-01-2026-07-17T15-55-10-760Z.json` is a failed
cohort, not a promoted baseline.

**Consequences:** P-007 again tests the user's preferred 3.36 GB mobile export, now on
the runtime version its publisher requires. The dependency override and runtime version
are part of the result identity. If 1.27 still rejects or loses the device, that is
stronger export/runtime evidence and triggers the smaller E2B candidate rather than a
silent fallback.

**Reopen if:** Transformers.js publishes a release on an equal/newer compatible runtime,
the override breaks its public pipeline contract, E4B fails the full gate, or E2B's
measured game-headroom tradeoff is superior.

---

## D-068: P-007 switches Gemma 4 E4B from q2f16 mobile-QAT to q4f16 (2026-07-17, superseded by D-069)

**Decision:** Keep Gemma 4 E4B, Transformers.js 4.2.0, the dedicated AI-worker
topology, fixtures, and fail-closed OPFS contract selected by D-067, but replace the
incompatible mobile-QAT q2f16 export with the standard export's q4f16 text path. Pin
`onnx-community/gemma-4-E4B-it-ONNX` at revision
`843f250f23bc91754def1e0f0db390dacd1e6b05`, dtype `q4f16`, and its exact nine-file
text-only manifest: 4,924,946,442 bytes with a SHA-256 for every file.

**Context / evidence:** the first physical-console diagnostic used pinned Chrome for
Testing 150.0.7871.115 and the normal browser sandbox. ONNX Runtime rejected session
creation for the q2f16 graph at `gather_block_quantized.h:55`: its WebGPU kernel
requires `bits == 4 || bits == 8`. Artifact
`app-owned-llm-spike-1-4ae4fc26627f-dev-01-2026-07-17T15-44-56-168Z.json` retains the
exact error from both the fresh and browser-restart phases. The q2 attempt verified
eight cache entries without hash failures before the session error, but produced no
inference samples and is not qualification evidence. The same run exposed a harness
omission: unlike `smoke@1`, this new runner had not enabled Chrome's WebGPU developer
identity fields, so the environment gate was independently invalid. The runner now
uses the same identity flag; no machine labels or thresholds were relaxed.

The pinned [standard E4B ONNX repository](https://huggingface.co/onnx-community/gemma-4-E4B-it-ONNX/tree/843f250f23bc91754def1e0f0db390dacd1e6b05/onnx)
contains the q4f16 embed and decoder graphs selected here. Its API tree supplied the
LFS object SHA-256 and exact sizes for large files; the three small non-LFS JSON files
were downloaded and SHA-256 hashed locally. q4f16 is the narrowest model-preserving
response to the observed 4-or-8-bit runtime constraint, but it remains a candidate
until the full gate succeeds.

**Consequences:** the exact install grows from 3.36 GB to 4.92 GB. The first q4f16 run
must still prove every runtime, cache, quality, latency, and contention requirement;
selection does not imply compatibility or a pass. The q2f16 failure is RE-026 rather
than hidden by an automatic runtime fallback.

**Reopen if:** q4f16 fails session creation, exceeds practical memory/install costs, or
cannot meet the existing latency/quality contract. In that case test the predeclared
E2B branch or a different measured runtime/export through another decision.

---

## D-067: P-007 phase A starts with mobile-QAT Gemma 4 E4B in a dedicated WebGPU worker (2026-07-17, superseded by D-068)

**Decision:** Run P-007 phase A first with the instruction-tuned Gemma 4 E4B mobile-QAT
text path, converted to ONNX and executed by `@huggingface/transformers` 4.2.0 over
ONNX Runtime Web/WebGPU in a dedicated AI worker. Pin model
`onnx-community/gemma-4-E4B-it-qat-mobile-ONNX` at revision
`4d18aa8b54e354bec4705e4a4894f5bbf8956c3d`, dtype `q2f16`, and the exact nine-file
text-only manifest: 3,361,427,366 bytes with a SHA-256 for every file. The first install
streams each artifact through an incremental hash into an OPFS temporary file and only
publishes the verified cache entry after an OPFS-local move. Warm runs must read all
nine artifacts from OPFS with zero remote misses.

The experiment uses greedy decoding with thinking disabled for performance/schema
samples, twenty repetitions of the exact branded-Prompt gate-watch fixture for a real
nearest-rank p95, plus fixed grounding, JSON-intent, context-size, and raw dialog-quality
cases. Raw outputs and exact input/output token counts remain result evidence. The model
is an install resource, not a multi-gigabyte build artifact; its revision, manifest, and
OPFS evidence are part of the result contract. The engine build gains a content-addressed
AI worker, advancing the build manifest to v4 and the additive telemetry envelope to v5.

Treat device topology honestly. The initial branch is an AI-worker-owned logical
`GPUDevice`, separate from Babylon's render-worker device. A true shared-device branch
requires colocating inference with rendering and assigning Babylon's device to ONNX
Runtime before session creation. A second device on the same adapter is not “shared.” If
Babylon cannot expose the device through a supported boundary, phase A records that
branch as unsupported and scopes the integration/fork rather than fabricating a
comparison.

**Context / evidence checked 2026-07-17:** Google's current
[Gemma 4 documentation](https://ai.google.dev/gemma/docs/core) identifies E4B as the
4.5B-effective/8B-total, 128K-context on-device member and lists mobile/text-only
memory variants. The official
[Gemma 4 E4B model card](https://huggingface.co/google/gemma-4-E4B-it) uses Apache-2.0.
The pinned [mobile-QAT ONNX repository](https://huggingface.co/onnx-community/gemma-4-E4B-it-qat-mobile-ONNX)
is public and reports 3.65 GB including unused audio/vision files; its API manifest and
Transformers.js `ModelRegistry` locally identified the nine text-generation files and
the exact 3,361,427,366-byte total recorded above. Transformers.js 4.1 added Gemma 4;
4.2 exposes worker-compatible WebGPU execution and a custom Cache-like backend. Current
ONNX Runtime Web documentation exposes an existing-device setter, but WebGPU objects do
not cross the current worker boundary.

Chrome's current [Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api)
still names a browser-selected Gemini Nano and explicitly leaves exact model size/version
under browser control. Gemma 4 E4B is therefore a comparable Google on-device
size/capability class and a user-selected challenger, **not** claimed to be Chrome's
exact checkpoint.

**Consequences:** P-007 remains open until physical-console fresh/warm evidence exists;
this decision selects the experiment, not its winner. E4B is tested first as requested.
If it misses memory, frame, or first-token constraints, E2B is the predeclared smaller
candidate; changing model/runtime/quantization or weakening a budget requires another
decision. `onnxruntime-node`, `sharp`, and `protobufjs` install scripts remain disabled:
the browser worker uses their web/runtime artifacts and needs none of those native
postinstall paths.

**Reopen if:** the pinned export is corrupt/incompatible, the mobile quantization loses
required dialog/schema quality, a supported Gemma 4 WebLLM build becomes materially
simpler, Transformers.js gains an app-owned OPFS/integrity contract that supersedes the
adapter, or shared-device evidence changes the preferred placement.

---

## D-066: OPFS spike closes on capability evidence, not a stable microbenchmark baseline  (2026-07-17, accepted)

**Decision:** Close the M0 worker-owned OPFS spike as a qualified go for the planned M1
storage boundary. Every launch must still complete the exact fixture lifecycle, return
every requested byte, validate every word, retain finite read-call and wall timings, and
publish the per-run raw throughput; those checks remain mandatory. Keep the existing
10% cross-repeat throughput calculation unchanged, but classify its result as an
informational platform-research metric in `smoke@1` metric-set v10. An invalid
repeatability result is reported, never converted to measured, trimmed, or promoted as
a baseline. M1's representative OPFS-to-renderable cell-load p95 is the user-outcome
gate.

Advance the public telemetry envelope to v4 and the smoke report to schema v22. Retain
each of the twelve sequential-pass timings, each 256-operation random-read batch, and a
one-second Windows physical-disk activity sample overlapping every OPFS window. The
host sample is attribution-only and non-mandatory because it is currently Windows-
specific and coarser than the sub-second micro-workload.

**Context / evidence:** D-063 correctly refused to promote two sandboxed schema-v20
cohorts that missed the then-mandatory 10% gate, including a 3.45 GiB/s fresh-
sequential outlier. Retrying that unchanged contract until it happened to pass would
have selected a favorable sample. Instead, schema-v21 physical-console artifact
`smoke-1-7d4974355d92-dev-01-showcase-2026-07-17T14-53-51-392Z.json` added the
attribution RE-023 requested. All six sandboxed core runs completed, all reads validated,
all traces drained, the registered environment passed, and all 24 budget checks passed.
Five OPFS cohorts stayed within 3.30-6.03%; warm-random spanned 5.25-5.81 GiB/s and
missed the variance limit at 10.62%.

The low warm-random run was not a sustained storage slowdown: one 256-read batch took
4.925 ms while its other batches took 2.565-3.305 ms; its sequential phase remained
normal at 6.71 GiB/s. The overlapping host sample measured 32,259 B/s physical reads,
88,712 B/s physical writes, zero disk queue, and 1.161 ms average physical-read latency.
Across all six windows, physical reads were only 16-109 KiB/s while the worker reported
5.25-7.15 GiB/s, confirming the intended warm-cache scope and excluding sustained
physical I/O as the attribution for this cohort. The experiment still cannot distinguish
browser broker/service scheduling from other sub-millisecond host scheduling, which is
the platform observability gap RE-023 records.

**Consequences:** M0 no longer claims a stable OPFS throughput baseline. It does claim,
with sandboxed evidence, that a dedicated worker can own a sync access handle, preserve
fresh/warm lifecycle semantics, and deliver validated warm-cache reads with multi-GiB/s
raw throughput under the live renderer. OPFS repeatability remains visible in every
report and in RE-023 without indefinitely blocking unrelated Harness-v1 evidence. The
next sandboxed schema-v22 run must pass every still-mandatory facet before replacing the
unsandboxed aggregate gate; D-066 does not retroactively promote schema v20/v21.

That replacement subsequently passed in physical-console artifact
`smoke-1-7d4974355d92-dev-01-showcase-2026-07-17T15-00-16-046Z.json`: schema v22 /
metric-set v10 passed the registered environment, mandatory evidence, and all 24 budget
checks. Every read validated and every trace drained. Its four OPFS repeatability ranges
were 6.58%, 1.10%, 2.64%, and 2.21%; this favorable cohort does not erase RE-023's
retained invalid cohorts or create a throughput baseline.

**Reopen if:** per-run correctness or throughput evidence becomes invalid; representative
M1 cell-load p95 misses its budget; the batch/host attribution identifies a controlled
project-side source; or Chrome exposes operation/service-queue telemetry that supports a
stable attribution-aware baseline.

---

## D-065: Sandboxed schema-v2 branded Prompt lifecycle qualifies production install  (2026-07-16, accepted)

**Decision:** Accept physical-console artifact
`prompt-api-branded-1-8b5f1c1df68b-dev-01-2026-07-17T02-23-55-286Z.json` as the
current branded-Chrome production-install qualification and close that M0 plan item.
Both independent fresh-profile lineages passed the schema-v2 contract with the normal
Chrome sandbox, measured registered-machine environment, consistent Chrome
150.0.7871.128 identity/hash, exact online/restart/offline fixture, settled availability,
and nonzero privileged model-component evidence.

**Context / evidence:** the uninterrupted profile downloaded in 102.6 s, observed 852
progress events, and measured a 24.0 s longest phase-local forward-progress gap. The
restart/resume profile downloaded in 161.9 s, observed 1,045 progress events, measured a
17.8 s longest phase-local gap, and separately recorded a 4.7 s restart observation
window. Each profile installed 4,269,934,835 bytes across six files, initially reported
`downloading` after the post-install browser restart, settled to `available` after the
fixture, and streamed the same fixture offline with availability `available`. The known
exact `chrome://debug-webuis-disabled` redirect remained explicit `unsupported`
diagnostic evidence under D-061.

The four first-token samples were 3,543.6, 3,682.8, 3,877.2, and 3,603.2 ms. They all
exceed the 1.5 s dialog target and remain RE-021/P-007 backend-selection evidence; this
lifecycle qualification is not a latency pass. Adding this cohort expands the
same-version delivery calibration to eight profiles with true phase-local gaps of
16.7-24.0 s, leaving the unchanged 120-second boundary at 5.00x the largest observation.

**Consequences:** the Prompt production-install checkbox is complete. Schema-v1
artifacts remain diagnostic history, while this schema-v2 artifact is the current
qualification. The OPFS and aggregate smoke gates remain independently open under
D-063/RE-023; this run exercises neither and does not re-qualify them.

**Reopen if:** a later branded-Chrome lifecycle fails the schema-v2 contract, delivery
approaches the 120-second phase-local boundary, model bytes/availability cease to
survive restart/offline use, or the exact internal status page becomes available and
can replace the current unsupported diagnostic.

---

## D-064: Branded Prompt schema v2 separates measured progress from restart observability  (2026-07-16, accepted; qualification fulfilled by D-065)

**Decision:** Advance `prompt-api-branded@1` to report schema v2. Gate the 120-second
download liveness boundary only on the engine's phase-local forward-progress timer,
which advances on every strictly larger normalized progress value. Do not reconstruct
silence from the engine's retained samples: those samples are deliberately quantized at
roughly one-percent progress increments and their spacing is not a no-progress measure.
Record the interval from the last retained pre-restart sample to the first retained
post-restart sample separately as `restartObservationGapMs`. That interval includes
browser shutdown, relaunch, environment probes, and time during which no page observer
exists, so it is a non-gating observability upper bound rather than a Chrome stall.

Schema v2 also records aggregate post-run identity failures without discarding completed
profiles, types and retains every availability phase even when availability is null,
adds the target display mode to branded environment identity, restricts the known
internal-page exception to the exact redirect, and rejects invalid Chrome-version and
availability values. Restart interruption requires the current normalized maximum to
remain strictly between 0 and 1, rather than accepting a historical intermediate sample
after delivery has reached 1. Browser close now detaches live error listeners and escalates to a
browser close on context-close failure. Profile cleanup is non-gating post-measurement
housekeeping, with a guarded startup sweep for stale `run-*` children older than one day.

**Context / evidence:** Review of the four schema-v1 artifacts exposed the retained-
sample error. Across the six same-version profiles used for calibration, it overstated
the engine's actual no-forward-progress maxima by 7.6-10.1 seconds. In the sandboxed lifecycle artifact
`prompt-api-branded-1-2296afdeaa23-dev-01-2026-07-17T01-16-45-160Z.json`, the report
claimed 26.3 s and 25.3 s while raw phase-local telemetry measured 16.7 s and 17.1 s.
Across all six same-version delivering profiles in the `00-31-55`, `00-38-47`, and
`01-16-45` artifacts, phase-local maxima were 16.7-17.3 s and total delivery durations
were 101.3-263.7 s. The 120-second boundary is therefore 6.92x the largest observed
true forward-progress gap. The 263.7-second delivery came from a profile that failed a
separate settled-availability criterion; excluding its valid delivery telemetry would
be selection on an unrelated outcome.

The same review reproduced a false `Infinity` restart gap when the first resumed sample
was already 1, showed that schema-v1 artifacts predated current settled-availability
evidence while retaining the same version stamp, and identified failure paths that
could discard completed evidence or freeze arrays still referenced by page listeners.
Local unit tests now cover the corrected timing semantics, completed-on-resume case,
terminal failure propagation, exact redirect, primitive availability values, nonempty
version floors, and stale-profile pruning.

**Consequences:** schema-v1 artifacts remain raw lifecycle, latency, and browser-
behavior evidence, but none is a current production-install qualification for the
schema-v2 contract. Reopen that plan item until a physical-console schema-v2 sandboxed
run passes both fresh-profile lineages. D-061's 120-second value remains calibrated, but
its rationale and multiplier are corrected here. D-060's result-shape and restart-gap
language are amended by this decision.

**Reopen if:** Chrome exposes a persistent delivery job with timestamps across browser
lifetimes, allowing restart delivery silence to be measured rather than bounded by an
observer-free wall-clock interval; or additional valid delivery profiles approach the
120-second phase-local threshold.

---

## D-063: Sandboxed smoke evidence replaces, rather than inherits, the unsandboxed gate  (2026-07-16, accepted; amended by D-066)

**Decision:** Do not promote the earlier schema-v19 `smoke@1` pass as the reference
result after D-062 changed the browser process topology. The replacement must be a
sandbox-verified schema-v20 run that passes the unchanged metric-set-v8 contract. Two
physical-console schema-v20 attempts are retained as negative evidence rather than
retried until one happens to pass: both verified the sandbox and registered environment,
but both failed mandatory OPFS repeatability; the second also reproduced RE-008. Reopen
the Harness-v1 aggregate gate and OPFS performance qualification in `plan.md`. Do not
change the 10% variance limit or the five-second trace transaction bound to accept this
cohort.

**Context / evidence:** Artifact
`smoke-1-2296afdeaa23-dev-01-showcase-2026-07-17T01-06-27-753Z.json` completed all six
core runs and all trace drains, but fresh-random OPFS read-call throughput varied 10.30%
and warm-sequential varied 10.61%. The unchanged confirmation artifact
`smoke-1-2296afdeaa23-dev-01-showcase-2026-07-17T01-09-09-623Z.json` recorded a fresh
sequential outlier at 3.45 GiB/s versus 5.99 and 6.53 GiB/s (89.44% relative range),
fresh-random variance of 30.84%, and one core trace that acknowledged `Tracing.end` in
2.5 ms but delivered zero events/chunks before the 5,001.6 ms timeout. All reads in both
runs validated, the environment facet passed, `sandboxVerified` was true, and the
effective command line omitted `--no-sandbox`.

**Consequences:** the sandboxed core measurements remain useful subsystem data: WebGPU
rendering, SAB transport, JS heap, Dawn cache behavior in measured traces, and HTTP
serving completed. They are not an aggregate budget pass. RE-023 tracks the new OPFS
instability and RE-008 retains the trace failure. Further work must isolate whether the
OPFS outliers arise from sandbox topology, storage scheduling, or an uncontrolled host
factor before a replacement baseline is promoted.

**Reopen if:** a controlled cause is identified, or a sandbox-verified schema-v20 run
passes the unchanged contract after that cause is addressed.

---

## D-062: Reference Chrome launches keep the process sandbox enabled  (2026-07-16, accepted)

**Decision:** Every Parallax Playwright Chrome launch sets `chromiumSandbox: true`.
The shared launcher rejects caller-supplied `--no-sandbox`; Prompt API launch-contract
inspection also rejects the switch if it appears in Chrome's effective command line.
`smoke@1` schema v20 records that effective command line and a sandbox-verification
field in the environment identity. Sandboxing is part of the measured browser contract,
not an optional automation convenience.

**Context:** Playwright 1.61.1 defaults `chromiumSandbox` to false and consequently
added `--no-sandbox` to every shared harness launch. Branded Chrome surfaced its
unsupported-flag warning, revealing that all prior CfT and branded measurements used a
different child-process security topology from ordinary production Chrome (RE-022).
Chromium's Windows sandbox requires neither elevation nor a special driver, and current
Chromium source assigns the on-device-model execution utility an AppContainer sandbox.
A local disposable probe on dev-01 successfully launched and controlled both ordinary
and persistent branded Chrome 150.0.7871.128 contexts with `chromiumSandbox: true`.

**Sources checked (2026-07-16):** Playwright's current
[BrowserType API](https://playwright.dev/docs/api/class-browsertype) documents the
`chromiumSandbox` option and its false default. Chromium's
[sandbox design](https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md)
documents that the Windows sandbox works without administrator privileges and that
`--no-sandbox` removes renderer target-process isolation. Chromium's
[Windows sandbox launcher](https://chromium.googlesource.com/chromium/src/+/main/sandbox/policy/win/sandbox_win.cc)
shows that the switch bypasses sandbox policy, disables CET compatibility for child
processes, and that on-device-model execution normally selects an AppContainer.

**Consequences:** lifecycle evidence from earlier unsandboxed runs remains useful as
diagnostic history. D-061 now records the passing sandboxed branded-Chrome production
qualification, while D-063 retains two failed sandboxed schema-v20 smoke attempts and
reopens the aggregate/OPFS baseline instead of inheriting its unsandboxed predecessor.
A sandbox-related failure becomes measured platform evidence; it is not bypassed by
restoring `--no-sandbox`.

**Reopen if:** Chrome cannot exercise a required web-platform capability under its
normal Windows sandbox. Any exception requires a new decision, isolated diagnostic
scenario, and explicit non-production label.

---

## D-061: Web-visible availability plus component bytes gate branded model status  (2026-07-16, accepted; amended by D-064)

**Decision:** Refine D-060's model-status requirement after the first physical-console
qualification. `chrome://on-device-internals` remains recorded, but an exact redirect
to `chrome://debug-webuis-disabled/?host=chrome://on-device-internals/` is
`unsupported` diagnostic evidence rather than a production-UX failure. A branded
profile gates model readiness on the web-visible lifecycle instead: `available` after
install, successful streamed inference after browser restart followed by `available`,
and a successful exact-fixture repeat while network-isolated. Chrome 150 may initially
report transient `downloading` immediately after restart even though the installed
session then creates successfully (RE-020); that transition is retained and does not
substitute for the required settled `available`. Post-shutdown privileged
inspection must independently measure nonzero `OptGuideOnDeviceModel` bytes/files.
Other internal-page failures remain invalid; arbitrary or label-only status text never
passes.

The same-version delivery cohorts calibrate and retain the 120-second
no-forward-progress boundary. Raw phase-local telemetry from all six delivering
profiles in the `00-31-55`, `00-38-47`, and sandboxed `01-16-45` artifacts measured
true forward-progress maxima of 16.7-17.3 s while total deliveries ranged from
101.3-263.7 s. The existing threshold is 6.92x the largest observed gap, leaving ample
delivery jitter while still rejecting the 120-second silence reproduced by the CfT
spike. D-064 corrects the schema-v1 retained-sample calculation and changes the
threshold from provisional to calibrated without changing its value.

**Context / evidence:** Sandboxed schema-v1 physical-console lifecycle artifact
`prompt-api-branded-1-2296afdeaa23-dev-01-2026-07-17T01-16-45-160Z.json` installed
4,269,934,835 bytes (6 files) in each independent fresh profile, captured 1,041 and 1,489
normalized progress events, completed initial and post-restart NPC fixtures, and
repeated the fixture offline with settled availability `available`. Both profiles used
branded Chrome 150.0.7871.128 with the same executable hash, and every effective command
line omitted `--no-sandbox`. The initial post-restart availability was transiently
`downloading` before successful inference and a settled `available` check (RE-020). The
internal debug URL was disabled in both automation sessions, matching the already-recorded
RE-018 behavior. Its four first-token samples measured 3,382.3-3,514.5 ms (RE-021).

The earlier unsandboxed schema-v1 passing artifact
`prompt-api-branded-1-2296afdeaa23-dev-01-2026-07-17T00-38-47-623Z.json` remains useful
diagnostic history but is superseded for production qualification by the sandboxed
schema-v1 artifact above. D-064 subsequently reopens production qualification for the
corrected schema-v2 contract.

The earlier diagnostic artifact
`prompt-api-branded-1-2296afdeaa23-dev-01-2026-07-17T00-23-02-899Z.json` installed
4,269,934,835 bytes in each independent branded profile, captured 913 and 747 normalized
progress events, completed the initial and post-restart NPC fixtures, and repeated the
fixture offline with availability `available`. The internal debug URL was disabled in
both automation sessions, matching the already-recorded RE-018 behavior. The overall
artifact failed both because Chrome auto-updated from 150.0.7871.115 to 150.0.7871.128
during the run and because both internal-page redirects were then classified `invalid`.
D-061 deliberately changes the latter exact automation redirect to `unsupported`; it
does not characterize model-status relaxation as unrelated to that failed result.

**Consequences:** the branded runner preserves the internal-page reason in JSON and
Markdown, but does not require a debug-only Chrome surface unavailable to its launch
environment. `budgets.md` records the now-calibrated 120-second boundary. D-060's
same-version/hash rule and all web-visible restart/offline/component requirements remain
unchanged. D-064 later advances the report contract and reopens the branded
production-install plan item; the schema-v1 first-token measurements remain open
backend-selection evidence under RE-021.

**Reopen if:** Chrome enables the internal page under automation (promote it back to a
measured diagnostic), or additional valid installs show a legitimate phase-local
progress gap near 120 seconds.

---

## D-060: Branded Prompt qualification is a two-profile lifecycle scenario  (2026-07-16, accepted; amended by D-064)

**Decision:** Implement the production-install qualification required by D-059 as the
separate versioned scenario `prompt-api-branded@1`. It launches the installed branded
Chrome executable against two independent disposable profiles outside the repository:
one uninterrupted install and one install deliberately interrupted only after a live
intermediate progress update, then resumed with the same profile after browser restart.
Both profiles run the same game-owned NPC-dialog prompt during initial creation, close
and relaunch Chrome after installation, repeat that prompt, isolate the browser from the
network, and repeat the exact prompt again offline. The runner records each availability
transition, phase-local progress telemetry, total download duration across restart, the
  longest phase-local interval without forward progress, the separately labeled
  observer-free restart interval,
the effective Chrome launch contract, `chrome://on-device-internals` status text, and
  post-shutdown `OptGuideOnDeviceModel` bytes/files/versions. It attempts non-gating
  cleanup of each exact child profile only after privileged inspection and writes JSON
  plus Markdown evidence; a guarded later-run sweep removes stale children.
Every browser launch re-hashes the installed executable, the two profiles must retain
the same version/hash, and each profile carries the registered-machine host, GPU,
driver, power, display, remote-session, and post-run identity gate used by the standard
harness. Caller-supplied machine/tier labels cannot make an indirect session valid.

Progress is evaluated per browser lifetime before aggregation: a resumed monitor may
legitimately begin again at normalized 0, so that phase-local reset is not called a
cross-restart regression. The combined evidence still requires a 0 endpoint, at least
one intermediate update, a 1 endpoint, no invalid/regressive event within either
  phase, and the D-059 120-second phase-local liveness bound. The restart profile is not
valid unless the first browser was closed after observable intermediate progress and
the second phase completed. This scenario is backend-selection and production-UX
evidence, not a pinned-CfT performance gate; it still records artifact/source identity
and fails closed on missing lifecycle evidence. The plan checkbox stays open until two
physical-console results exist and the successful-run timings either recalibrate or
confirm the provisional stall threshold through a follow-up decision.

**Context:** Reusing `prompt-api-spike@1` would delete its fresh CfT profile after one
browser lifetime and would either lose restart evidence or weaken that research gate's
digest-pinned environment contract. A manual checklist would also fail the project's
requirement that performance and lifecycle claims land as diffable artifacts. Phase-
aware aggregation is necessary because the browser, page, engine service, and progress
monitor are all recreated at the restart boundary while Chrome-managed model delivery
persists in the profile.

**Sources checked (2026-07-16):** Chrome's current
[Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) requires a
user-activation-backed `LanguageModel.create()` and documents normalized progress
monitoring. Chrome's
[model-management guide](https://developer.chrome.com/docs/ai/understand-built-in-model-management)
states that download continues after a tab closes and resumes after a browser restart
within 30 days. The
[built-in AI setup guide](https://developer.chrome.com/docs/ai/get-started) documents
offline inference after initial delivery, variable model size, the 22 GB free-space
precondition, and `chrome://on-device-internals` as the exact-size/status surface.

**Consequences:** `harness:prompt-api-branded` is the operator command; D-064 advances
its harness result to schema v2, independently of `prompt-api-spike@1` schema v6.
Its branded-only offline fixture intentionally equals its online NPC fixture so "repeat
offline" measures the same workload without changing `prompt-api-spike@1`'s versioned
sentinel fixture. A failure to trigger, expose actionable progress, resume,
remain available after restart, expose model status, or stream offline is retained as
negative backend-selection evidence rather than bypassed.

**Reopen if:** Chrome exposes a supported persistent download job/status API that spans
browser lifetimes, making page-monitor phase aggregation unnecessary; or successful
qualification data requires a different interruption point or liveness threshold.

---

## D-059: Prompt API M0 evidence is a standalone, activation-driven run  (2026-07-16, accepted)

**Decision:** Implement the M0 Prompt API spike as versioned scenario
`prompt-api-spike@1`, separate from `smoke@1`, with a window-owned engine service and
real app buttons for both creation and the offline follow-up. The fixed NPC-dialog
fixture is game-owned and exported for reuse by P-007. Prompt telemetry is an additive
section with its own schema v3 under the existing aggregate telemetry envelope v3, so
the temporary spike does not invalidate unrelated smoke history. The launch-evidence
and progress-liveness shape advances the standalone result schema to v6.

The evidence runner uses the exact digest-gated Chrome for Testing pin and the common
registered-machine environment gate. Every execution creates a distinct temporary
profile under a dedicated external root, records lineage `fresh`, measures the model
component after Chrome exits, then removes that exact child profile. This prevents both
permanent warm-run failures and multi-gigabyte profile accumulation. A run must observe
normalized progress endpoints 0 and 1, at least one intermediate update, monotonic
forward motion, and no invalid events. The recorder retains timestamped samples,
maximum progress, the longest interval between advances, and exact invalid/regressive
event counts while coalescing UI publication. Model bytes are labeled privileged
evidence, never web-visible telemetry.

Prompt model delivery requires three Playwright defaults to be absent (background
networking, component updates, and component-extension background-page suppression)
and requires `OptimizationHints` to remain enabled. Because Playwright combines
`OptimizationHints` with 15 unrelated disabled features, the runner replaces that one
combined switch with the same list minus `OptimizationHints`; it does not re-enable
`PaintHolding`, `RenderDocument`, `DestroyProfileOnBrowserClose`, or the other
automation suppressions. Before measurement it reads the effective command line from
`chrome://version`, records it plus the disabled-feature set in result schema v6, and
fails closed if a model-delivery switch reappears or any preserved suppression is
missing. This runtime assertion detects private Playwright-default churn independently
of the copied exact string.

The Prompt context also enables `--enable-webgpu-developer-features`, the same switch
used by `smoke@1`'s environment inspection, so `GPUAdapter.info` exposes the registered
device, description, backend, and driver fields instead of Chrome's sanitized blanks.
The runner validates and records that effective switch; Parallax requests no
developer-only GPU capability. Adapter identity is read from the inert
`/__parallax/identity` control page rather than the already-running app, while the
unchanged registered-machine comparisons remain authoritative.

The inference window ends before session-pressure probing. The pressure probe attempts
at most eight clones, reports the actual attempt/success counts, and destroys the
primary and every clone before the offline probe. Eight is a bounded M0 pressure sample,
not a claimed platform limit. The run allows 30 minutes for a first model download only
while forward progress remains live. A provisional 120-second watchdog starts at the
activation click and resets only when normalized progress increases; endpoints,
duplicates, invalid values, and regressions do not mask a stall. On expiry the runner
closes Chrome early but preserves the partial telemetry and an exact stall reason in the
failure artifact. The threshold lives in `budgets.md` and is recalibrated from successful
fresh-profile downloads rather than weakened in harness code. The run
gates the existing 1.5 s dialog first-token and main-thread long-task budgets. Render-
worker callback pacing is marker-aligned but remains a **non-gating heuristic** under
D-051: it is not compositor presentation, and dev-01's known idle p95 already exceeds
the presentation threshold. The short generation scenario cannot supply the 1,000
samples needed to distinguish nearest-rank p99.9 from maximum, so it reports p50, p95,
and maximum and explicitly declares p99.9 inapplicable. A full telemetry-batch guard
band prevents pre-inference callbacks entering the window; if it consumes the whole
short window, the metric is invalid with the observed and excluded frame counts.
At least 30 retained marker-aligned intervals are required before callback pacing is
labeled a distribution; smaller samples remain an explicit invalid diagnostic rather
than presenting one or two observations as p50/p95/max evidence.
The main-thread long-task observer attaches before navigation and is valid only when
Chrome advertises `longtask` support, observer installation succeeds, and inference
start/end markers are all verified. Dedicated-worker exposure is evidence,
not a requirement that today's expected `false` remain true. Forced eviction is
`unsupported`: neither the Prompt API surface nor the automation contract provides a
non-destructive eviction control, so offline reavailability is measured after network
isolation while browser-managed deletion remains a separate manual exercise. Engine
compilation pins `@types/dom-chromium-ai@0.0.17`; adapter fakes and all repository tests
are included in a typechecked test project.

The pinned-CfT run is research evidence, not by itself a production-install
qualification. Before resolving P-007 or making Prompt API a required game dependency,
M0 separately exercises the real install UX in at least two independent fresh
branded-Chrome profiles: one uninterrupted download and one browser-restart/resume.
Both must provide actionable monotonic progress with an intermediate update, reach an
available model, stream the shared NPC fixture, survive restart, and repeat offline.
Silent or untriggered delivery is negative backend-selection evidence even if the CfT
gate passes.

**Context:** Folding this into the already dense `smoke@1` contract would make a
potentially multi-gigabyte, activation-bound download part of every change and couple
its profile history to unrelated baselines. Review also found that retaining the online
session cohort contaminated the offline result, a worker diagnostic could block the
primary probe, measured budgets were advisory, download evidence silently vanished on
warm profiles, callback pacing was incorrectly made a presentation gate, and the first
draft advanced the global telemetry schema for an additive field. The standalone
contract isolates those concerns while still sharing Chrome launch, digest,
environment, browser-probe, telemetry-read, and file-walk code with the harness.

**Sources and evidence checked (2026-07-16):** Chrome's current
[Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) documents
window exposure, current worker unavailability, user-activation-bound `create()`, and
the recommended ambient types. Chrome's
[built-in AI setup guide](https://developer.chrome.com/docs/ai/get-started) documents
the 22 GB free-space precondition, variable model size, `chrome://on-device-internals`
as the exact-size surface, and removal below 10 GB free. Chrome's
[model-management guide](https://developer.chrome.com/docs/ai/understand-built-in-model-management)
also documents deletion after 30 days without meeting eligibility, deletion at any time
including mid-session, and application-triggered redownload through a new `create()`
call rather than automatic recovery. The Prompt API page separately documents that
`create()` must be called under user activation.
The WICG [Prompt API proposal](https://github.com/webmachinelearning/prompt-api)
specifies normalized 0..1 progress, mandatory 0/1 events, no exact byte exposure,
session destruction, and current worker scope.

A local investigation found those initial `unavailable` results were invalidated by
Playwright defaults on both launches: `chrome://version` showed component updates,
background networking, component-extension background pages, and `OptimizationHints`
disabled. `chrome://policy` showed no configured policy, `chrome://flags` contributed
no command-line switches, and `chrome://on-device-internals` reported that internal
debug pages were disabled. With the four contaminating defaults removed, an otherwise
equivalent new branded-Chrome 150 profile returned `downloadable` immediately and in
13 consecutive checks over about one minute. RE-018 records this as our harness bug.
The Prompt runner now opts out of only those Prompt-incompatible Playwright defaults,
restores the other disabled features, and verifies the effective command line before
measurement; ordinary smoke launches retain their existing automation contract. The
three necessary service-level switch differences are reported environment evidence,
so Prompt callback diagnostics are not directly comparable with `smoke@1` results as
if their launch environments matched. A local corrected-launch check read back all 15
preserved suppressions, no disabled `OptimizationHints`, a verified model-delivery
switch contract, and fresh-profile availability `downloadable`. At that point these
remained local diagnostics, not the required physical-console evidence run.

The first schema-v5 physical-console attempt then exercised the liveness contract:
fresh-profile availability was `downloadable`, but activation-backed `create()` stayed
pending for 120,683 ms with zero progress events and zero model-component bytes. The
watchdog retained that exact partial state and closed Chrome instead of waiting 30
minutes (RE-019). The run is not promotable M0 evidence because the separate environment
facet was invalid: the Prompt runner's main-window WebGPU adapter probe returned blank
identity fields. That first artifact remains explicitly labeled local diagnostic
evidence; it is not substituted for the corrected environment run below.
The environment root cause was harness placement, not a relaxed machine contract:
`smoke@1` probes WebGPU on the inert `/__parallax/identity` control page before workload
navigation, while the Prompt runner queried the live app after its render worker had
already acquired WebGPU. The Prompt runner now uses the same isolated control-page
probe, enables and validates the same developer identity switch as `smoke@1`, and
retains every existing adapter comparison.

The corrected schema-v6 physical-console run
`prompt-api-spike-1-b68bd86a977a-dev-01-2026-07-16T23-41-28-710Z.json` passed the
registered dev-01 environment gate with the full RTX 4080 Super D3D12 adapter/driver
identity and verified the effective Prompt launch contract. It again began from a fresh
profile with availability `downloadable`; activation-backed `create()` remained
`creating` for 120,723 ms with zero progress events, zero retained samples, and zero
files/bytes under the model-component root. The liveness abort preserved that evidence.
Because model delivery never began, inference, session pressure, and offline
reavailability were invalid or not run; these are explicit downstream consequences of
the failed prerequisite, not passing results.

**Consequences:** the Prompt API research-spike plan item is complete with a measured
no-go for use as a required backend: the valid physical run could neither start
observable delivery nor reach the later inference/session/offline checks. The separate
branded-Chrome production-UX qualification remains open because it tests the actual
player install path rather than CfT automation; it must pass before Prompt API can be a
required game dependency. The P-007 comparison imports the same game fixture and treats
a branded-install failure as evidence favoring the app-owned model.

**Reopen if:** worker exposure lands; the platform exposes attributable byte progress or
a supported eviction test/control; eight clones no longer provide useful pressure
evidence; successful first-download event timing shows the provisional 120-second stall
threshold or 30-minute completion ceiling is inadequate; or Playwright/Chrome changes
the component-delivery launch requirements.

## D-058: Isolate the M0 OPFS sync-read spike and advance worker contracts  (2026-07-15, accepted)

**Decision:** Measure worker-owned OPFS synchronous reads with a dedicated, temporary
storage worker under the live walking-skeleton renderer. `smoke@1` finishes its
privileged display diagnostics and mandatory SAB transport before explicitly starting
the OPFS phase; continuous rendering is the only intentional concurrent workload. A
fresh profile provisions one deterministic 64 MiB fixture, and its paired warm profile
must reuse that exact file. Each launch first performs one untimed, fully validated
sequential preflight, then reads it sequentially twelve measured times in 1 MiB
operations and performs 4,096 deterministic random 64 KiB reads. The fixture stores an
absolute-position `Uint32` pattern, so every returned word is checked against its
requested offset. Short reads, corruption, lifecycle drift, or missing timings make the
mandatory evidence invalid.

Time summed directly around `FileSystemSyncAccessHandle.read()` is the primary API-path
throughput metric and must stay within the existing 10% repeat-variance policy for all
fresh/warm × sequential/random cohorts. Validation-inclusive worker wall throughput and
fixture-provisioning time are retained as diagnostics, not variance gates. The probe is
explicitly a warm OS-cache microbenchmark; cold-disk behavior, N-reader contention, and
representative cell-load latency remain M1 questions.

This change advances the public engine telemetry schema from v2 to v3, `smoke@1`'s
mandatory metric set from v5 to v8, and the result schema from v18 to v19. Metric-set
v6 was the first physical calibration attempt; v7 lengthened only the sequential sample
after v6 showed that three passes produced too little timed work for the unchanged 10%
repeatability gate. Metric-set v8 adds the explicit preflight after v7 isolated the
remaining outlier to the first measured sequential phase. It also
advances build-manifest v2 (D-048) to v3: v3 requires exactly one distinct `render` and
one distinct `storage` worker entrypoint. The storage worker terminates before the
post-measurement all-realm JS-heap window, whose required live topology remains the page
plus render worker.

**Context:** The production streaming worker is planned to own sync access handles, so
testing OPFS in the render worker would validate the wrong ownership boundary. Starting
the first implementation automatically at render-ready also overlapped the privileged
`chrome://gpu` display probe and the SAB spike; review rejected that contaminated timing
before any reference result was retained. Build-manifest v2 deliberately limited its
role vocabulary to the then-only render worker and required an explicit contract change
when topology expanded.

**Evidence checked (2026-07-15):** the assembled local app in the Chromium-based Codex
browser successfully created the worker-only sync access handle, completed the
position-validated fixture reads, and reported no page/worker errors. That is a
compatibility diagnostic only.

The first registered dev-01 physical-console calibration (`smoke@1`, schema v19,
metric-set v6, artifact `9f5107d155d0`, Chrome 150) completed all six fresh/warm core
runs with no OPFS payload errors and would have passed all 24 budget checks. It correctly
failed mandatory-evidence completeness because the fresh sequential read-call cohort
spanned 5.90-6.75 GiB/s, a 14.42% relative range. The three-pass sample accumulated only
about 30 ms inside `read()`, so v7 increases it to twelve passes without changing the
10% variance policy. Fresh random and both warm cohorts were repeatable (1.94%, 3.11%,
and 3.87% relative range respectively).

The second physical calibration (`smoke@1`, schema v19, metric-set v7, artifact
`4dab6c1f7e1b`, Chrome 150) again completed every core run without payload errors and
would have passed all 24 budget checks. Its twelve-pass fresh sequential cohort was
5.92, 6.59, and 6.63 GiB/s (12.03% relative range), while fresh random and both warm
cohorts remained repeatable at 3.11%, 3.98%, and 3.50%. Because only the first measured
sequential phase remains low, v8 adds one untimed, fully validated sequential preflight
to every launch. This preserves the twelve-pass measured workload and existing 10%
gate while making the stated warm-path scope explicit. The registered schema-v19 / v8
rerun was therefore required before accepting the decision.

The final registered dev-01 physical-console gate (`smoke@1`, schema v19, metric-set
v8, artifact `bf83d4c84358`, exact CfT Stable 150.0.7871.115) passed environment,
mandatory-evidence, and budget facets with all 24 checks passing. All six OPFS phases
completed with zero validation errors. Read-call throughput ranged 6.65-6.72 GiB/s for
fresh sequential, 5.48-5.68 GiB/s for fresh random, 6.50-6.69 GiB/s for warm sequential,
and 5.58-5.64 GiB/s for warm random; their relative ranges were 1.08%, 3.62%, 2.95%,
and 1.21% respectively. Fresh fixture provisioning took 40.5-53.9 ms. Two immediately
preceding runs of the unchanged artifact were invalidated only by the existing RE-008
Chrome trace-completion gap; both still completed every OPFS phase without validation
errors and kept every OPFS cohort below 5% relative range. This is a go for
the worker-owned sync-access-handle boundary, within the explicitly limited warm-cache
micro-workload scope.

**Consequences:** Ordinary app and V8-diagnostic launches do not run the destructive
microbenchmark; the harness starts it through the public telemetry control surface after
the contaminating probes finish, waits up to 17 seconds for an explicit completed/failed
state, and still preserves a 10-second warm-up floor before gameplay measurement.
The isolated V8 lifecycle diagnostic advances to `v8-code-cache@6` and excludes the
core-only storage entrypoint, which is intentionally not started during that diagnostic;
all scripts expected there must belong to active realms. Manifest-v2 consumers must
reject v3 rather than
silently interpreting its expanded role vocabulary. The observed reference range is
evidence for this micro-workload, not an M1 minimum-throughput budget; representative
cell bundles still require their own measured latency and contention gates.

**Reopen if:** the physical gate cannot complete within the 17-second completion window,
read-call variance is too noisy to trust, representative M1 bundles require a materially
different operation shape, or controlled cold-cache/multi-reader experiments reverse
the storage placement.

## D-057: Use paired fixed-capacity SPSC SAB rings for high-rate worker transport  (2026-07-15, accepted)

**Decision:** The worker fabric's high-rate primitive is a pair of fixed-capacity,
single-producer/single-consumer `SharedArrayBuffer` rings, one per direction. Setup and
one final result summary use `postMessage`; every workload record uses the rings. Each
ring uses a power-of-two capacity and stores fixed-width `Int32` records behind unsigned
monotonic read/write sequences, uses atomic reads/writes for both control and payload
words, and applies bounded
backpressure rather than allocating or growing. Waiters use atomic wait/notify without
ever synchronously blocking the window.

The M0 spike fixes its test pool at two 256-record x 4-word rings (8,224 bytes total)
and sends 100,000 deterministic command/echo round trips through the existing render
worker while it continues rendering. Telemetry schema v2 exposes allocation size,
elapsed time, cooperative round-trip rate, main/worker stalls and waits, correctness
errors, the maximum window pump duration, and concurrent render-worker callback
diagnostics. The rate includes the bounded window pump's scheduling cadence and is not
raw SAB bandwidth. `smoke@1` result schema v18 / mandatory metric-set v5 requires a
completed, corruption-free SAB
measurement on every core run; missing or corrupt transport evidence fails closed.

**Context:** D-005 selected SAB channels but did not define or test their protocol.
The implementation has unit coverage for ordering, full-queue backpressure, descriptor
validation, asynchronous wakeups, lifecycle cancellation, and unsigned 32-bit sequence
wrap. Power-of-two capacity is enforced because a wrapped unsigned sequence used
directly as a slot cursor aliases records at arbitrary capacities. Exact browser
performance and concurrent-render numbers are deliberately not adopted from development
diagnostics: the registered physical-console result required below is the first retained,
source-identified evidence eligible to support those claims. Worker callback timing in
that result remains diagnostic rather than presentation proof under D-051.

The retained physical-console result is
`smoke-1-04d5015a975e-dev-01-showcase-2026-07-15T23-21-50-551Z.json`: result schema v18,
mandatory metric-set v5, artifact digest
`04d5015a975e31b54f03598558cc99796772a68939740eaaeee96221e1bd558b`, source commit
`2fbcb768873f34f22b982088c3ff418809c6c71b` plus dirty-tree digest
`9dbf35e5054112a133d2b25b67048d0db588726c65a72a633ab9543cae841ad6`, exact pinned CfT
Stable 150.0.7871.115 (executable SHA-256
`c55dc23c0d6c2b87cf3d056959eb1e351bc98dfb3e5fa5d53aff86a25f1b32c5`), Windows
26200.8875, and RTX 4080 Super / D3D12 driver 32.0.16.1074 at the registered
3840x2160@60 Hz target. Environment, mandatory evidence, and all 24 budget checks passed
across three fresh/warm pairs. Every run returned 100,000/100,000 validated echoes with
zero payload and sequence errors from the fixed 8,224-byte pool. Cooperative end-to-end
rate was 45,132-46,708 round trips/s over 2,141-2,216 ms; maximum window pump duration
was 0.58-1.01 ms, and every gameplay measurement window recorded zero main-thread tasks
over 50 ms.

The during-spike render-worker callback maximum was 133.29-166.72 ms even though the
corresponding render/submit maximum was only 2.73-2.92 ms. This does **not** establish
SAB-caused frame impact: the app starts the spike immediately after its first frame, while
`smoke@1` performs the privileged `chrome://gpu` refresh-rate probe before its 10-second
warm-up. RE-001 already measures that probe producing 166.6-216.6 ms launch callback
gaps. The retained SAB interval is therefore attribution-contaminated and remains a
workload-presence diagnostic only, not presentation evidence or a hitch-free claim. After
warm-up, callback maxima were 16.78-17.07 ms with p95 16.72-16.80 ms, but the spike had
already completed, so those values likewise do not establish active-transport impact.

**Consequences:** The paired SPSC abstraction is now the substrate for later input,
streaming-queue, and sim-to-render channels. MPMC needs are represented as multiple
owned SPSC lanes or get a separately measured design; this primitive does not silently
grow into a contended multi-producer queue. The M0 plan item was held open until a
registered physical-console `smoke@1` run proved mandatory SAB evidence across all
fresh/warm repeats without regressing the existing environment, evidence, or budget
facets. The retained result above satisfies that gate, so the M0 SAB spike is a **go**
for transport correctness, fixed-pool behavior, and cooperative main-thread scheduling.
It is not a raw-bandwidth result or proof of hitch-free active transport.

Worker-side spike failures use a dedicated control-plane response and transition SAB
telemetry to `failed`; they do not masquerade as render-worker failures or tear down a
render service that remains healthy.

**Reopen if:** a real channel requires variable-width records or unavoidable multiple
producers/consumers, measured atomic payload access is a bottleneck, sequence-wrap
testing fails under a browser worker, or a controlled active-transport measurement
without RE-001's privileged-diagnostics overlap shows unacceptable frame/main-thread
impact.

## D-056: Keep Babylon WebGPU rendering in the dedicated render worker  (2026-07-15, accepted)

**Decision:** The M0 WebGPU-in-worker spike is a **go**. Parallax keeps the D-005
topology: Babylon.js owns the scene in a dedicated module worker, creates its WebGPU
device there, and renders to an `OffscreenCanvas` transferred from the window. This is
evidence for the rendering core exercised by the walking skeleton, not a claim that
every Babylon subsystem is worker-safe. DOM-bound input, GUI, accessibility, and future
asset-loader paths must cross the engine's explicit protocols or be re-verified when
introduced; they do not move Babylon rendering back to the window implicitly.

The accepted main-thread boundary is narrow and observable: the app shell creates the
worker, transfers the canvas, forwards device-pixel resizes, receives 60-frame telemetry
batches, and updates boot/status UI. Babylon/WebGPU scene construction, frame scheduling,
animation, render submission, and their JavaScript heap remain in the dedicated worker.
These orchestration messages are not treated as a zero-work claim: the budget remains
zero main-thread tasks longer than 50 ms during gameplay.

**Context:** The controlled evidence is retained physical-console result
`smoke-1-56bc808071f1-dev-01-showcase-2026-07-15T15-00-29-040Z.json`: schema v17,
mandatory metric-set v4, exact CfT Stable 150.0.7871.115 (revision 1639810 and executable
SHA-256 pinned), Windows 26200.8875, RTX 4080 Super / D3D12 driver 32.0.16.1074, and the
registered 3840x2160@60 Hz target. The result's source identity and artifact digest tie it
to the exact build; its engine manifest and lockfile pin Babylon.js 9.16.1. Windows
observed the display at 3840x2160/59 Hz, Chrome reported 60 Hz, and the 3841x2161 render
surface passed the descriptor's explicit +/-2-pixel tolerance (RE-003). Its three fresh
and three warm launches passed environment, evidence, and all 24 budget checks. Across
those six launches:

- worker callback-interval p95 was 16.740-16.860 ms and worker render/submit CPU p95 was
  0.480-0.610 ms (callback pacing is a heuristic, not presentation proof per D-051);
- worker-local initialization to first frame was 78.905-85.460 ms; and
- the main thread recorded zero tasks over 50 ms in every measurement window.

The harness did not infer placement from those timings. Its all-realm heap probe required
the browser context to contain exactly the app page and the manifest-declared render-worker
target, attached to both isolates, and retained separately attributed window and
dedicated-worker samples. The first-frame telemetry could therefore arrive only after
Babylon's worker-owned `WebGPUEngine` initialized and submitted the walking-skeleton scene.
The assembled build keeps Babylon imports in the separately built worker artifact; the
window-side render service imports only the worker protocol and owns orchestration.

Current platform documentation agrees with the measured path: MDN's `WorkerNavigator.gpu`
page documents WebGPU as a worker entry point, and Babylon's current `WebGPUEngine`
constructor accepts `HTMLCanvasElement | OffscreenCanvas` (checked 2026-07-15:
`developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/gpu` and
`doc.babylonjs.com/typedoc/classes/BABYLON.WebGPUEngine`). The local result is the deciding
evidence; the documentation is corroboration.

**Consequences:** D-005 stays accepted, architecture.md's M0 open question is closed,
and the worker topology remains the basis for the SAB and later streaming spikes. No new
Chrome rough edge was found in this tested slice. M1 still owns long-run device-loss and
restart handling, and each newly adopted DOM-sensitive Babylon feature must demonstrate a
worker-safe path rather than silently escaping to the main thread.

**Reopen if:** representative M1 content or a required Babylon subsystem cannot run behind
the worker boundary, a pinned-Chrome run produces main-thread long tasks attributable to
rendering, or worker/device-loss behavior makes the topology unreliable over flythrough-
length sessions.

## D-055: Transition-contract prefetch trigger is defined at M4, not before  (2026-07-15, accepted)

**Decision:** The inter-district transition contract in budgets.md deliberately omits
its **prefetch trigger** element (when a transition preload must start, per entrance)
until M4. Defining it is an explicit M4 task: calibrate from greybox transition
measurements, add the element to budgets.md through the normal decision process, and
only then evaluate the M4 exit ("no contract violations") against the completed
contract — the exit cannot be declared against a contract that still lacks the element.

**Context:** architecture.md promised a prefetch trigger "in budgets.md" that budgets.md
never defined — an unverifiable contract element a 2026-07-15 review flagged. Inventing
a threshold now would violate root rule 3 (measure, don't assert): the honest trigger
depends on cell sizes, OPFS read throughput, and traversal speeds that only exist once
M4 greybox content and the M1 streaming path are measurable. plan.md M4 carries the
calibration task and the qualified exit criterion.

**Consequences:** Until M4, the enforced transition contract is: overlap memory peak
(≤ 1.25× steady-state GPU budget), max hitch (≤ 100 ms), total swap (≤ 4 s), proactive
eviction only — all per entrance. The prefetch trigger is the one deferred element.

**Reopen if:** M1 streaming measurements already force a prefetch policy (then define it
early through a decision), or M4 measurements show a per-entrance trigger is the wrong
shape (e.g., it belongs to the streaming manager's budget governor instead).

## D-054: Harness measurement-soundness fixes — schema v17, metric-set v4  (2026-07-15, accepted)

**Decision:** A holistic multi-agent review of the completed Harness v1 found and fixed
several measurement-soundness defects; the result contract advances to **schema v17**
and **mandatory metric-set v4**. The changes:

1. **Deterministic frame window.** Frame statistics previously came from
   `recentFrames.slice(-120)` on a snapshot read *after* the end marker, so the analyzed
   span slid with CDP latency and differed from the trace-marker window used by the
   blocking pipeline/shader checks. The harness now selects exactly frames
   `(start, start+120]` by index (`harness/src/frame-window.ts`, unit-tested); engine
   telemetry retention widens from 120 to 240 recent frames (amends D-029; telemetry
   schema shape and version unchanged) so the window survives snapshot latency, and
   eviction of any in-window frame is a loud measurement-invalid error. Because
   frameCount publishes only per 60-frame batch (`TELEMETRY_FRAME_BATCH_FRAMES`, now an
   exported telemetry-contract constant), the start marker is placed *before* the
   telemetry read and the window begins one full batch after the observed count — every
   counted frame is provably rendered inside the trace-marker window, so pipeline
   activity on counted frames cannot escape the marker-windowed trace gates.
2. **Long-task counter drains pending records.** The injected observer's `count()` now
   folds `takeRecords()` into the total, closing a false-pass window on the zero-limit
   blocking `mainThreadLongTasksOver50Ms` budget (a >50 ms task ending just before the
   read could previously go uncounted).
3. **A core-run failure still produces artifacts.** One failed launch previously aborted
   the process with no JSON/markdown result, discarding completed runs (violating
   harness rules 2/5). Failures are now captured as top-level `coreRunFailure`, the V8
   diagnostic phase is skipped with the reason recorded, and a **mandatory** "core
   measurement run completion" evidence check fails the evidence facet — report written,
   exit code still 1.
4. **Mandatory-metric registry is the single source of truth.** Callback-pacing variance
   was enforced as mandatory but absent from the declared registry; it is now registered,
   and every evidence-check mandatory flag is derived from the registry by name (loud
   failure on an unregistered name). Metric-set v4 = v3 + render-worker callback-pacing
   variance (mandatory), core measurement run completion (mandatory), HTTP serving
   evidence (non-mandatory).
5. **HTTP serving evidence is evaluated and reported** (informational only). The local
   server's metrics endpoint advances to **schema v2** (amends D-028) with per-path-class
   status and byte counters — the v1 aggregate counters could not prove the claims (an
   unrelated 304 could satisfy the document-revalidation check; document bytes could
   satisfy the immutable-body check). Checks: fresh runs fetch every immutable artifact
   as a 200 with bytes; warm runs reach the server with zero immutable requests and at
   least one document request, all revalidated 304 (zero observed documents is a failed
   observation, not a pass); ≥400 statuses flagged. Calibrated against the retained
   passing results; nothing enters the budget facet.
6. **Late page errors fail the run.** Errors raised between the in-window check and the
   JS-heap window (trace end, memory dump, histogram probes) were previously dropped
   silently; they now fail the run through the core-run-failure path (artifacts still
   written, exit code 1), upholding the README/D-031 fail-on-browser-error contract.
   Errors during the JS-heap window itself continue to invalidate only that metric
   (D-047), unchanged.
7. **Run-scoped server metrics.** The before/after server-metric snapshots now bracket
   launch and full context close, so late requests can't bleed into the next run's delta.
8. **Bounded variance values, full repeats required.** `relativeP95Range` is `null`
   (with an explicit reason) instead of `Infinity` when the minimum repeat p95 is 0, so
   JSON and report agree. Variance verdicts also require the full `SMOKE_REPEATS`
   sample count: fewer completed repeats (e.g., after a captured core-run failure) is
   `invalid`, never `measured` — a single run's zero range is not evidence of
   stability.
9. **Served tree must match the manifest.** Manifest validation fails on files present
   in the served dist tree but not listed (allowlist: `build-manifest.json`), so the
   artifact digest cannot silently stamp unlisted bytes.
10. **Repeatability gate covers shipped bytes.** `verify:repeatable` now hashes the
    actual `engine/dist` artifacts the assembler consumes and compares them against one
    independent temp-dir rebuild (previously two throwaway builds whose digests were
    never tied to the shipped artifact) — one fewer build per `pnpm check`, same-host
    level-1 scope per D-020 unchanged. The dirty-tree diff digest is also pinned against
    user git config (`--no-color --no-ext-diff --no-renames --diff-algorithm=myers`,
    neutralized attribute and order files — an empty `diff.orderfile=` is fatal on
    Windows git, so the documented `/dev/null` cancellation value is used; determinism
    verified byte-identical under renames/orderfile/attributesfile config toggles in a
    fixture repo).

**Context:** Found by the 2026-07-15 tech-lead review (six-agent fan-out plus adversarial
challenge, findings verified against code and the retained result JSONs). Items 1–3 were
false-pass or lost-evidence paths inside the checked Harness v1 deliverable; the rest are
declared-surface vs. implementation gaps. Engine-side robustness landed in the same
change: `onmessageerror` handling, per-listener telemetry-publish isolation covering
the initial subscribe delivery too (the D-029 surface is externally consumed), received
frame samples re-frozen at the main-thread boundary (structured clone strips the
worker-side freeze), an explicit failed-is-terminal M0 comment (M1 owns device-loss
recovery — plan.md M1 item), and `engineStrict: true` in `pnpm-workspace.yaml` so the
D-020 Node pin hard-fails on mismatch (a root `.npmrc` `engine-strict` flag is ignored
by pnpm 11 — verified via `pnpm config get` before and after).

**Consequences:** `pnpm check` green (134 unit tests, up from 106; lint clean; shipped
engine bytes verified). No numeric threshold changed; the only informational signal
promoted to blocking is late browser errors (item 6), which restores an already
documented contract. The next dev-01 physical-console `smoke@1` run will emit schema
v17 and is not directly comparable to v16 results on window placement (the frame window
no longer slides), which is a correctness fix, not a regression.

**Reopen if:** telemetry gains per-frame identity/timestamps (making index-based
selection unnecessary), M1 promotes presentation gating (revisit what the frame window
gates), or HTTP evidence proves stable enough to graduate from informational to a
mandatory evidence check.

## D-053: Repository license is Apache-2.0  (2026-07-15, accepted)

**Decision:** The whole repository — code, harness, docs, and generated assets that land
in-tree — is licensed **Apache License 2.0**. The root `LICENSE` file is authoritative;
every `package.json` declares `"license": "Apache-2.0"`, and the README states it. New
packages and the M2+ public game/site deliverables inherit this unless a future decision
says otherwise.

**Context:** The repo has shipped with an Apache-2.0 `LICENSE` since the initial
scaffold, but no decision recorded the choice and no manifest declared it. The license
choice is load-bearing for D-010's Cross-Origin Storage story: shared engine bundles are
consumed (and at level 3, *not* rebuilt) by other publishers, so a permissive license
with an explicit patent grant is the deliberate pick over MIT (no patent grant) or a
copyleft license (would encumber consumers of shared artifacts). Confirmed by the
project owner 2026-07-15.

**Consequences:** `license` fields added to all five package manifests; README notes the
license. Third-party code brought into the tree must be Apache-2.0-compatible.

**Reopen if:** the COS sharing model or a publication decision requires different terms
for some artifact class (e.g., game content vs. engine code).

## D-052: TypeScript 7 (native compiler) is the pinned type toolchain  (2026-07-15, accepted)

**Decision:** The repository pins TypeScript **7.0.2** — the natively-compiled compiler
("tsgo" lineage) — as the type-checking and build toolchain, continuing D-014/D-020's
strict-mode + project-references setup unchanged.

**Context:** D-014 chose "TypeScript strict with project references" in the 5.x era; the
7.x native compiler is a materially different toolchain component (different binary,
different performance characteristics), and it was adopted during M0 without a log
entry — exactly the silent-drift root rule 1 exists to prevent. Recording it
retroactively: the pin has been in `package.json` through the completed Harness v1 work,
`pnpm check` (build, lint, 106 unit tests, engine repeatability gate) is green on it
(verified locally 2026-07-15), and no compiler-attributable issue has surfaced.

**Consequences:** Version selection stays under D-020's exact-pin policy; this entry
exists so the 5.x→7.x toolchain-generation jump is a recorded choice, not drift. The
engine repeatability gate already covers the compiler's contribution to artifact bytes.

**Reopen if:** tsc-native behavior ever affects build determinism or emits differently
across hosts (relevant to D-020 level 2), or a project-references/strict-mode regression
forces a downgrade.

## D-051: Harness-v1 presentation and V8 gaps are informational, not M0 gates  (2026-07-14, accepted; result schema and mandatory metric-set advanced to v17/v4 by D-054)

**Decision:** `smoke@1` mandatory metric-set v3 makes the authoritative compositor-presentation
metric and V8 JavaScript code-cache lifecycle explicitly informational for Harness v1. Their
probes, metric states, raw evidence, repeat contracts, and expected-zero rejection/re-production
diagnostic checks remain intact. Missing, untrustworthy, or negative lifecycle evidence is
emitted in result schema v16's
`informationalFailures` list and in the detailed Markdown sections, but does not affect the
evidence-completeness facet, budget-evaluation facet, aggregate `passed` bit, or process exit
code. V8's former zero-rejection and zero-warm-reproduction budget checks are renamed diagnostic
checks and remain attached to each V8 run; they no longer enter the blocking budget facet.
An auxiliary V8 launch/navigation/telemetry/trace failure is converted into a structured invalid
diagnostic run so it cannot suppress the blocking core report or change the exit code.

This is an M0 scope decision, not a claim that the underlying budgets are satisfied. M1 must
revisit authoritative presentation gating before using the flythrough for player-visible frame
budget claims, and M2 must implement the complete launch/update performance gate when cache
preservation becomes milestone scope. The current signals may be used only as heuristics: render-worker callback
pacing and Viz feedback-callback cadence for presentation behavior; and URL-attributed
production, absence of warm re-production, compile spans, HTTP cache behavior, and worker-startup
timing for V8 behavior. Reports must not relabel those heuristics as successful scan-out or code-
cache consumption. Cache behavior is best-effort: a rejection matters to the gate only when it
causes a user-visible launch/update performance budget to fail. The existing ≤10 s warm-launch
budget remains authoritative; M0's worker-startup timer is only a component diagnostic, while M2
owns the complete in-app launch measurement and asset-only-update comparison. The former
“asset-only update never invalidates V8 code caches” mechanism target is replaced by a
performance contract: post-update warm launch must remain within the existing 10 s ceiling and
record its paired delta from the pre-update warm launch. M2 measurements calibrate any relative-
regression threshold through a new decision rather than inventing one before the lifecycle exists.

**Context:** Chrome 150 exposes regular, page-windowed `Display::FrameDisplayed` callback
timestamps but omits the `PresentationFeedback.kFailure` flag needed to prove successful scan-out
(RE-006). Its ES-module trace path also omits authoritative cache-consumption results, and the
render-worker module exposes no URL-attributed production result (RE-009/RE-010). The maintained
diagnostics already capture the best available signals and bound the current walking-skeleton
cost: warm worker startup normally measured about 144–157 ms against the provisional 10 s launch
budget, while app/engine launch 3 emitted no observed cache re-production. Keeping Harness v1
permanently red cannot create the missing Chrome evidence and obscures regressions in the metrics
the platform does expose. The project therefore accepts visible, non-blocking platform findings
as the correct M0 outcome and gates the eventual cache outcome on performance rather than an
internal mechanism.

**Sources checked (2026-07-14):** local pinned-CfT 150.0.7871.115 remote diagnostics and the
schema-v16 physical-console `smoke@1` run on dev-01; current Chromium
[`Display::DidReceivePresentationFeedback`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/viz/service/display/display.cc),
Blink
[`v8_script_runner.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/bindings/core/v8/v8_script_runner.cc),
and the detailed source/reproduction records in RE-006, RE-009, and RE-010.

Mandatory gates remain unchanged for registered physical-console environment identity,
render-worker callback-pacing variance, all-realm JS heap, Dawn pipeline/cache evidence,
main-thread long tasks, and runtime pipeline/shader compilation. Attributable GPU memory remains
the pre-existing non-mandatory `unsupported` metric from D-050. No numeric performance threshold
is changed. The V8 zero-artifact targets are deliberately reclassified from budgets to expected
diagnostic outcomes, so the harness rule that every actual budget bust fails remains intact.

The Chrome-side requests exposed by these and other findings are synthesized in
[chrome-platform-gaps.md](chrome-platform-gaps.md); [rough-edges.md](rough-edges.md) remains the
evidence and reproduction source of truth.

**Consequences:** Harness v1 can complete on a verified physical-console run when all remaining
M0 gates pass, while the report still calls out every compositor/V8 informational failure. Result
consumers gain a stable top-level list instead of having to infer non-blocking problems from deep
diagnostic structures. D-031/D-035 and D-037–D-045 remain historical rationale but are superseded
where they require these two metrics to block Harness v1.

**Reopen if:** Chrome exposes trustworthy page-correlated presentation success or per-artifact
V8 cache lifecycle outcomes; M1 promotes presentation or M2 defines a stronger cache-performance
contract; the heuristics stop correlating with
the intended behavior; or informational failures become too noisy to be actionable.

## D-050: Retain GPU-process memory dumps without treating them as page VRAM  (2026-07-14, accepted)
**Decision:** `smoke@1` now requests one background global memory dump after its primary gameplay
window and retains the GPU-process allocator inventory, request GUID/duration, exported dump
name/ID, and any Dawn/WebGPU-named allocator paths. The Harness-v1 `attributable GPU memory`
probe is implemented but reports `unsupported`: its evidence is diagnostic and produces no GPU
envelope budget check. Result schema advances from v14 to v15. The metric remains non-mandatory
for M0, so an honest platform `unsupported` result is visible without making the already
fail-closed compositor/V8 evidence state more restrictive.
The top-level metric contract remains provider-neutral and supports all four metric states;
Chrome's CDP/memory-infra request and inventory live in a named, optional provider diagnostic, so
a future non-Chrome benchmark does not need to fabricate Chrome fields.

**Context:** Chrome for Testing 150.0.7871.115 on dev-01 successfully accepted the dump request in
all six core launches, but the walking skeleton's GPU-process dumps exposed no allocator covering
the web-created WebGPU device's buffers or textures. A controlled single-launch detailed dump
showed WebGPU shader-cache and shared-image plumbing, proving that the GPU process and active
WebGPU workload were present, while still exposing no page-device resource total (RE-014). Chromium's
current `gpu/dawn` memory-dump provider calls Dawn's estimated resource-size API for a
`DawnSharedContext`; the web WebGPU decoder owns a separate set of wire-server devices and has no
corresponding memory-dump provider. Even if `gpu/dawn` were present, Dawn's estimate is live
logical buffer/texture bytes, not page-attributed resident VRAM or transient allocator pressure,
so it could not honestly gate budgets.md's resident GPU envelope.

The same experiment found that CDP returned request GUID `0x2`/`0x3`, while JSON trace export
labeled the sole allocator-bearing dump `periodic_interval` with ID `0x0`. The harness therefore
requires exactly one allocator-bearing GPU-process dump and retains both identities rather than
claiming GUID equality that Chrome does not provide (RE-015).

**Sources checked (2026-07-14):** pinned local Chrome runtime traces; CDP
[Tracing.requestMemoryDump](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/);
Chromium's current
[graphics-memory metrics guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/memory/graphics_metrics.md),
[GPU memory tracing guide](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/memory-infra/probe-gpu.md),
[`DawnSharedContext` memory-dump implementation](https://chromium.googlesource.com/chromium/src/gpu/+/bf2b35ebcf902cda172ffaa4faffca8affc539f7/command_buffer/service/dawn_context_provider.cc),
and current Chromium
[`webgpu_decoder_impl.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gpu/command_buffer/service/webgpu_decoder_impl.cc)
device ownership; pinned Chrome 150.0.7871.115
[`DEPS`](https://chromium.googlesource.com/chromium/src/+/25f5b661e5b08141ec24b17d1ce96c5ceb5828da/DEPS)
mapping to Dawn revision `01249a97332468dbdd6cf5edb8dd7bae77875de5`; and that exact Dawn
[`DeviceBase::ComputeEstimatedMemoryUsage`](https://dawn.googlesource.com/dawn/+/01249a97332468dbdd6cf5edb8dd7bae77875de5/src/dawn/native/Device.cpp)
implementation, which sums texture estimated byte sizes and buffer allocated sizes.

**Consequences:** Harness results distinguish three facts that were previously easy to conflate:
Chrome accepted a GPU-process dump, Chrome exposed some GPU-process allocator data, and Chrome did
not expose page-attributed resident WebGPU memory. Adding memory-infra to the core trace also makes
its event/byte/drain cost visible in the existing trace diagnostics. A future Chrome allocator or
WebGPU API can promote this metric only after a controlled allocation test proves its scope,
residency semantics, attribution, and cross-backend behavior; merely finding a byte counter is not
enough.

**Reopen if:** WebGPU exposes memory budgets/usage, Chrome adds per-web-device memory-infra
allocators with documented semantics, or OS/ETW tooling can attribute resident allocations to the
page's WebGPU device across the D3D12 and Metal reference backends.

## D-049: Task-sized work units; AI-led multi-agent review  (2026-07-14, accepted; multi-agent review structure retired by D-155 — task-sized units and the human gate stand)
**Decision:** Two linked amendments to the D-026/D-027 operating models. (1) The
tech-lead unit of work grows from a commit-sized slice to a **full plan.md task** by
default — a full milestone when its tasks are tightly coupled. Work is no longer
fragmented to fit a human line-by-line reader. (2) The human gate is restated to match
how it actually operates: the human manages agents, makes architecture decisions,
guides reviews, gives feedback, and scans changes and results — delegating most
line-level reviewing to AI. To hold review quality at the larger unit size, reviewer
mode becomes **multi-agent**: the reviewing agent acts as review lead — partitioning
the diff into subagent-sized pieces (the lead judges what is bite-sized), spawning
parallel read-only reviewer subagents, merging/deduplicating their findings and
verifying each one itself, then spawning an adversarial challenge subagent briefed to
refute weak findings and hunt for cross-piece misses before the final report. The
tech-lead pre-handoff adversarial review uses the same structure for
task-sized-or-larger diffs. The human commit gate itself is unchanged (root rule 8:
agents never commit).

**Context:** M0 Harness v1 ran for seven commit-sized chunks without completing, each
chunk paying a full review-loop round trip (review → fix-pass → verify-pass → human
gate). The small iterations surfaced real issues, but the human's judgment is that
comparable issues would have surfaced in larger reviews with far fewer interruptions —
and the premise behind commit-sized slices ("one coherent unit the human can review
and commit") no longer holds, because the human is not reading every line before
commit.

**Consequences:** workflow.md's loop, tech-lead mode, and reviewer mode sections are
updated. D-026 and D-027 remain in force except where amended here (unit sizing;
single-context review). Individual review passes cost more (subagent fan-out) but run
far less often. Fix-pass and verify-pass modes (D-030) are unchanged; they operate on
the larger units' findings. Uncommitted working-tree state now lives longer between
commits, raising the stakes on the existing one-stream-of-work and serial-writers
rules.

**Reopen if:** larger units measurably let defects slip through that small-slice
reviews would have caught, long-lived uncommitted trees prove fragile in practice
(lost work, unexplainable state), or the adversarial challenge pass consistently finds
nothing and becomes ceremony.

## D-048: Declare runtime worker entrypoints semantically in build-manifest v2  (2026-07-14, accepted; manifest format advanced to v3 by D-058)
**Decision:** build-manifest schema v2 adds `workerEntrypoints`, whose records name the artifact
path, target type, and runtime role. The walking skeleton declares its one dedicated `worker`
entrypoint with role `render`; harness code consumes that declaration instead of inferring engine
ownership from a `render-worker-*` filename prefix. Manifest validation requires every entrypoint
to name a hashed artifact in the same manifest.

**Context:** the JS-heap gate must compare observed worker targets with a declared runtime topology
without depending on `engine/` bundler naming. Artifact paths and hashes alone do not express which
files create target realms. A semantic entrypoint list is also the place to enumerate planned
decode, streaming, simulation, shared, and service workers as they become launch-required.

**Consequences:** renaming a worker artifact no longer changes harness discovery. The current heap
collector scopes discovery to the app page's browser-context ID and requires its observed target
set to equal the declared page-plus-render-worker topology both before and after sampling. The
page target ID and browser-context ID come directly from that page's CDP session, so another
browser context visiting the same URL cannot be mistaken for the app. Any
additional target—including dedicated/shared/service workers, worklets, OOPIFs, `other`, or future
target types—invalidates the metric instead of being silently omitted. Expanding the topology
requires expanding the manifest role vocabulary and collector aggregation in the same change. The
build-manifest format advances from v1 to v2; this is an explicit contract change, not a silent
filename convention.

**Reopen if:** runtime telemetry can provide a cryptographically tied worker-realm registry that is
more authoritative than the assembled build manifest, or workers are created dynamically from
non-artifact URLs that require a different declaration model.

## D-047: Gate JS used heap as a fixed-deadline cross-isolate estimate  (2026-07-14, accepted)
**Decision:** `smoke@1` replaces its renderer-page-only `Performance.getMetrics`
snapshot with a 100 ms sampler in a dedicated post-trace steady-state window over both current
JavaScript isolates: the
window and the exact immutable render-worker target named by the validated build manifest. Each
sample issues near-concurrent `Runtime.getHeapUsage` requests for both targets. The tier budget
gates the maximum observed sum of `usedSize`; the report retains every isolate's `usedSize`,
`totalSize`, `embedderHeapUsedSize`, and `backingStorageSize`, plus per-realm CDP
response-completion timing,
collection duration, deadline, and start delay. Missing, duplicate, detached, malformed, or
cadence-invalid worker evidence makes this mandatory Harness-v1 metric `invalid` rather than
silently falling back to the window. Cadence-invalid results retain their collected evidence and
reason; experimental diagnostic fields are nullable when Chrome omits them. The mandatory metric
set advances to v2.

`usedSize` is V8 heap occupancy, including unreachable objects awaiting garbage collection; it is
therefore GC-phase-sensitive and is not a retained-live-data measurement. Chrome does not expose a
continuous live-retention high-water counter (RE-012), so "high-water" in this gate means the
largest observed 100 ms used-heap estimate, now stated explicitly in budgets.md. The two CDP
requests are not atomic: the estimate can miss a shorter-lived peak or combine values that did not
coexist. It is neither a guaranteed lower nor upper bound on exact peak residency.

**Context:** CDP defines `Runtime.getHeapUsage` as total usage of the corresponding V8 isolate,
not a value scoped to one execution context. The old `Performance.getMetrics` call therefore
measured only the page session even though 99.84% of decoded JavaScript runs in the dedicated
render worker. A single end snapshot also did not implement budgets.md's high-water definition.
Summing each realm's independent maximum would create an even less time-correlated result, so
aggregation happens per near-concurrent sample before selecting the maximum. `usedSize` alone maps
to the JS-heap sub-budget;
embedder and backing-store bytes remain diagnostics for later CPU-envelope accounting and are not
double-counted here. Result schema advances from v12 to v14: v13 introduced per-sample heap
evidence, and v14 retains that evidence on the invalid metric variant.
The enforced Standard and Showcase ceilings are exactly 2 × 1024³ and 4 × 1024³ bytes; budgets.md
uses GiB so the documented units and byte comparisons cannot drift.

Playwright exposes page and browser CDP sessions but no public child-target session constructor.
The pinned implementation therefore attaches the exact worker target and uses CDP's nested-session
message path inside one small collector. That transport is explicitly contained because CDP marks
`Target.sendMessageToTarget` deprecated in favor of flat session routing, which Playwright's public
`CDPSession.send` surface does not expose.

**Sources checked (2026-07-14):** Chrome DevTools Protocol tip-of-tree `Runtime.getHeapUsage`
(`chromedevtools.github.io/devtools-protocol/tot/Runtime/`) and Target domain
(`chromedevtools.github.io/devtools-protocol/tot/Target/`),
[HeapProfiler domain](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/), and
[Memory domain](https://chromedevtools.github.io/devtools-protocol/tot/Memory/); pinned local
`playwright-core@1.61.1` type declarations for `CDPSession` and `newBrowserCDPSession`; current
[V8 inspector implementation](https://chromium.googlesource.com/v8/v8/+/b339cf019df6e238d0bf5e970e513e941dc6d563/src/inspector/v8-runtime-agent-impl.cc),
which maps `usedSize` to `v8::HeapStatistics::used_heap_size()`.

**Consequences:** the all-worker JS-heap registry entry is implemented, mandatory, and measured
failures can bust the Standard 2 GiB or Showcase 4 GiB limit. Sampling uses fixed start deadlines;
it skips rather than overlaps an overrun, then invalidates any deadline due through the periodic
sampling boundary that lacks a sample. Response-completion skew, sampling start delay, or
collection duration at least as large as the 100 ms interval also invalidates the metric.
The forced measurement-end sample substitutes for the latest deadline at the boundary; any
earlier missing deadline still invalidates the metric. Sampling runs only after trace and primary
frame/Dawn/presentation evidence collection so the CDP requests cannot perturb those zero-tolerance
gates. Realm response-completion skew is Node-side CDP arrival skew only; it is a transport-health
diagnostic and cannot prove or bound V8 read-time simultaneity. The current exact app-context
target-set assertion rejects every unexpected isolate-bearing or unknown target type and is a
walking-skeleton contract, not a permanent topology assumption: when streaming/decode/sim workers
land, the build/run contract must enumerate every required worker target and this metric must sum
all of them. Sampling cost and non-atomic response timing are visible in each result. A
pinned-Chrome remote diagnostic on 2026-07-14 measured both realms in the dedicated post-trace
window across all six core launches: 28 samples per launch, 8.28–12.04 MB aggregate observed
peaks, 13.2–15.7 ms maximum fixed-deadline start delay, 0.0 ms maximum response-completion skew at
report precision, and 1.1–16.2 ms slowest collection. Every launch returned measured cadence evidence and no
heap budget bust. The environment remained invalid under RDP, as required; this validates the
collector integration, not a promoted gate baseline or exact live-retention coverage.

Browser errors raised only during the dedicated heap workload invalidate the heap metric while
retaining any samples already collected; they do not abort report generation or discard the
completed primary trace/frame evidence. CDP session creation, commands, responses, and teardown
are all timeout-bounded, and partial setup detaches any session already acquired.

The required nested-session transport is itself a platform/tooling exposure (RE-013). The pinned
Chrome executable/digest plus mandatory runtime smoke is the version tripwire: a Chrome update that
removes non-flat routing produces explicit invalid evidence and cannot be promoted silently.

**Reopen if:** CDP exposes an aggregate origin/page memory counter with per-isolate attribution,
Playwright exposes flat child sessions, sampling cost affects the measured workload, or the M0 SAB
and wasm spikes require separating backing stores/linear memories from the JS-heap sub-budget.

## D-046: Engine choice re-grounded against Unity 6.5; two D-004/D-005 claims corrected  (2026-07-14, accepted; comparison remains current, while D-004's classic-Babylon component was superseded by D-078; evidence folded into rendering-engine-research.md by D-076)
**Decision:** D-004 stands — TypeScript + Babylon.js, WebGPU-only. Its supporting technology
claims are re-verified against **Unity 6.5 (6000.5)**, the current release, and two of them are
corrected. The sourced differentiator list now lives in
why-not-unity.md (since folded into rendering-engine-research.md by D-076), which at the
time was the canonical artifact for defending the engine
choice; this entry records what changed and why the verdict didn't.
**Context — two corrections, both against us:**
1. **D-005's "No popular engine ships real multithreading on the web today" is wrong as
   written.** Unity 6.4 shipped official Web support for Burst-compiled C# jobs and native
   C/C++ engine threads. The accurate claim is narrower and still decisive: *managed* C#
   threads remain unsupported ("due to the lack of a multithreaded garbage collection feature
   in WebAssembly"), gameplay C# is main-thread-only, and "you must schedule all jobs from the
   main thread." Never assert that Unity is single-threaded on the web — it isn't, and the
   overstatement is trivially refuted.
2. **A WebGPU-limitations argument was raised and withdrawn.** Several headline items on Unity's
   WebGPU-limitations page — no async compute, r32-only read-write storage textures, no
   synchronous readback, no `RWBuffer`, no Int64, uniform-control-flow barriers — are **WebGPU
   spec limits, not Unity gaps**. They bind Parallax exactly as hard. Citing them against Unity
   is a self-own, and the related claim that they "gut GPU-driven culling" is false (culling
   needs compute, storage buffers, atomics, and indirect draw; WebGPU has all four). The
   single-queue/no-async-compute gap is a *platform* finding and is logged as RE-011.
**Context — claims that hardened:** D-004's "unconfirmed wasm64" is now confirmed adverse — the
Unity heap tops out at 4 GB (wasm32), with no Memory64 support and no roadmap commitment.
Unity's WebGPU backend is still labelled Experimental in 6.5 (continuously so since 6.1).
Two new structural gaps were established: Unity Web storage is IndexedDB (`persistentDataPath`
→ `/idbfs/<hash>`; Unity's `Caching` API unsupported on Web; OPFS absent from all 75 Web-section
manual pages; the `.jslib` escape hatch is ES5-only while `createSyncAccessHandle` is
worker-only) — directly against D-003 — and Unity documents **no GPU-timing path on Web** (GPU
Usage Profiler: "Web | All WebGL | Not supported"; FrameTimingManager: "no GPU time is
provided"), which is disqualifying for a project whose harness is a first-class deliverable.
Unity exposes neither WebGPU subgroups (Chrome 134) nor `shader-f16` (Chrome 120).
**Sources checked (2026-07-14):** Unity 6.5 manual + scripting reference (Web technical
limitations, Burst web multithreading, Web memory, Web caching, `Application.persistentDataPath`,
`Caching`, browser-JS interop, WebGPU + WebGPU-limitations, GPU Usage Profiler,
FrameTimingManager); Unity release/EOL data (6.4 EOL 2026-06-17); Chrome WebGPU release notes
(134 subgroups, 120 f16); gpuweb#1065 (multi-queue); Babylon `WebGPUEngineOptions` typedoc
(`requiredFeatures` includes `subgroups`, `shader-f16`, `timestamp-query`). Full URL list in
why-not-unity.md. Two claims rest on *absence* of documentation (Unity GPU timing on WebGPU
specifically; OPFS in the emitted runtime) and are flagged there for a local experiment to
settle — root rule 3 prefers a measurement over a doc search.
**Consequences:** why-not-unity.md is maintained alongside D-004 and re-verified before any
public use; D-004/D-005 status lines are annotated to point here. Any future "Unity can't do X"
claim gets checked against that doc's "Not on this list" section first.
**Reopen if:** Unity ships **all three** of Memory64/wasm64, managed C# threads (which requires
multithreaded GC in wasm), and a non-experimental WebGPU backend. Any one alone does not reopen
D-004; together they would.

## D-045: Split harness verdicts into environment, evidence, and budget facets  (2026-07-14, accepted; partially superseded by D-051 — the compositor-presentation and V8 lifecycle gaps are non-mandatory informational failures, no longer blocking Harness v1)

**Decision:** Result schema v12 exposes three independently named facets while retaining the
fail-closed aggregate `passed` bit:

- `environment` is `passed` only when the registered-machine gate identity is measured;
- `evidenceCompleteness` is `passed` only when every mandatory non-environment metric has
  trustworthy evidence; and
- `budgetEvaluation` is `passed` only when evidence is complete, at least one budget check ran,
  and every executed check passes; it is `failed` when any observed check busts its limit, and
  otherwise `not-evaluated` when mandatory evidence is incomplete or no checks ran.

The aggregate passes only when all three facets pass. An observed budget violation takes
precedence over `not-evaluated`, so partial evidence cannot hide a known regression; conversely,
passing the subset of checks that could execute never produces a green budget facet.

**Context:** Harness v1 intentionally fails on the known compositor-presentation and V8
code-cache observability gaps. The single aggregate bit correctly prevented false success but
could not distinguish a valid physical-console environment from complete evidence or an actual
threshold violation. That made a known evidence gap look the same as an invalid environment and
made the passing subset of `budgetChecks` easy for result consumers to misread as a complete
budget verdict.

**Consequences:** JSON and Markdown reports can now show environment validity, evidence coverage,
and evaluated budgets without weakening any gate. The Markdown failure list is derived from the
same facet reasons as the JSON contract. Schema consumers must move from v11 to v12; the top-level
`passed` field remains as the strict automation exit verdict.

**Reopen if:** a result needs per-metric budget eligibility rather than scenario-level mandatory
evidence, advisory/non-reference results require a fourth comparison-eligibility facet, or a
future result store replaces the aggregate bit with a richer state machine.

## D-044: Keep RE-008 causal attribution open after an active user-timing-only timeout  (2026-07-14, accepted; partially superseded by D-051 where it requires V8/presentation metrics to block Harness v1)

**Decision:** Do not attribute RE-008 to enabled GPU-process trace categories, payload volume,
or a particular process failing to acknowledge `Tracing.end`. Keep the maintained core trace
categories because Dawn and presentation evidence require them; a narrower category set is not
a completion workaround.

**Context:** A controlled pinned-CfT 150.0.7871.115 remote diagnostic kept the real app, render
worker, 4K target, 10 s warmup, 120-frame measurement, measured-page lifetime, browser-level
`ReportEvents` transport, and five-second completion bound unchanged, but traced only
`blink.user_timing`. Core traces completed 5/6. Fresh repeat 3 at ordinal 5 held the trace for
14,163.0 ms, acknowledged `Tracing.end` in 2.3 ms, then delivered zero events, zero chunks, and
no `Tracing.tracingComplete` before the 5,006.3 ms invalidation; ordinal 6 recovered. Successful
traces carried only 221–237 events / 34,744–36,798 serialized bytes and completed in
13.0–13.9 ms. All nine isolated short V8 traces completed.

Those unchanged V8 lineages also measured launch-2 worker startup at 148.7, 150.7, and
150.4 ms versus launch-3 at 145.3, 156.8, and 151.4 ms. Launch 3 was slower in two of three
lineages, directly rebutting a consistent launch-2 → launch-3 saving or a measured ≤5 ms V8
cache bound. The worker still emitted no production event on launch 2, and no controlled cache
toggle exists, so the earlier 789.5 ms launch-2 outlier is not evidence of cache serialization.

The result disproves enabled Dawn/presentation categories and multi-megabyte payload as
necessary conditions for the captured failure. It does not identify which browser participant
withheld completion: browser-level tracing may coordinate processes that emit no enabled events.
Together with D-043's 6/6 long blank-page controls, current evidence points to measured-page
activity or workload/process coordination interacting with a roughly 14 s trace, not lifetime,
category payload, or GPU-category emission alone.

**Sources checked (2026-07-14):** local temporary category-control run on dev-01 under RDP
(non-gating), report
`smoke-1-cb961cbc9d86-dev-01-showcase-2026-07-14T18-42-02-841Z.json`; maintained source was
restored after the predeclared timeout falsifier occurred.

**Consequences:** RE-008 remains fail-closed and its Chromium report must present the
user-timing-only failure alongside the core-category failures. The next discriminating
experiment needs a controlled active-workload toggle or traced-process completion visibility;
another category-removal arm cannot establish the responsible process. RE-010 remains an
observability finding with a modest measured warm worker-startup component, not a measured V8
cache-savings claim.

**Reopen if:** an active-workload toggle separates completion from page/process activity, CDP
exposes per-process trace-stop acknowledgement, or a pinned Chrome change removes the failure.

## D-043: Measure worker startup and trace recording lifetime without inferring causes  (2026-07-14, accepted; partially superseded by D-051 where it requires V8/presentation metrics to block Harness v1)

**Decision:** The isolated diagnostic advances to `v8-code-cache@5` and records the existing
public `workerStartupToFirstFrameMs` telemetry on fresh, produce, and warm launches. The timer
starts immediately before constructing the module worker and ends when its first-frame message
reaches the window, so it includes worker script startup plus render initialization and first
frame; it is a launch component, not the full launch metric and not a V8-only timer. Result
schema v11 also records trace recording lifetime from acknowledged `Tracing.start` through the
`Tracing.end` request for every core and V8 trace.

Neither diagnostic attributes a cause. A fresh/warm startup difference can include HTTP cache,
worker startup, V8, WebGPU/Babylon initialization, Dawn state, GPU scheduling, and first-frame
delivery. Recording lifetime is correlated with all activity accumulated during that interval;
it must be varied in a controlled arm before being blamed for RE-008.

**Context:** A local pinned-CfT 150.0.7871.115 run measured worker startup-to-first-frame at
191.4–204.8 ms fresh, 146.0–149.0 ms on launch 2, and 146.0–154.5 ms warm. The improvement is
already present on launch 2 even though the worker exposes no cache-production prerequisite, so
the launch-3 result cannot be assigned specifically to code-cache consumption. The warm worker
component is about 1.5% of the 10 s launch budget; it de-escalates RE-010's current launch-cost
risk without resolving its mandatory cache-evidence gap.

A second exact-tree run reproduced the fresh and warm bands at 182.4–206.5 ms and
144.2–150.3 ms. Its launch-2 samples were 152.4 ms, 152.9 ms, and one 789.5 ms outlier. That
outlier is retained rather than assigned to V8: this remote, non-gating timer covers the whole
worker-to-first-frame path, and no controlled cache toggle isolates the cause.

The two maintained runs measured core traces open for 13,190.5–14,187.3 ms and V8 traces
normally open for 288.9–387.9 ms; the launch-2 startup outlier extended one V8 recording to
944.8 ms. Each run lost one of six core traces while all nine V8 traces completed. A controlled
fresh-browser `about:blank` matrix then held traces for either 300 ms or 14,100 ms without page
activity. All arms completed 6/6: short core produced 24–29 events / 3,564–4,262 bytes, long core
80–89 events / 13,496–14,645 bytes, and long V8 43–52 events / 6,949–8,074 bytes. Successful
long-arm drains completed in 8.6–20.0 ms. The maintained active core traces at the same lifetime
carried roughly 24,500–25,000 events / 3.9–4.0 MB. Trace lifetime alone therefore does not
reproduce RE-008; page activity and the resulting event/process/volume regime remain in scope.

**Sources checked (2026-07-14):** local render-service timer boundary, pinned CfT
150.0.7871.115 `v8-code-cache@5`/schema-v11 runs, and the three-arm local CDP experiment above on
dev-01 under RDP (all non-gating). Current V8 documentation confirms that post-execution code
caches can contain functions compiled lazily during execution, but does not make either Parallax
timer an authoritative cache result
([V8 code-caching documentation](https://v8.dev/blog/improved-code-caching)).

**Consequences:** Parallax measures the end-to-end worker-startup component it already waited for
and knows the actual recording lifetime of every trace. RE-010 no longer carries an unmeasured
dominant-launch-cost implication, and RE-008 investigation shifts from duration alone toward the
active-page event/process/volume regime. Neither cache nor trace gates are weakened.

**Reopen if:** worker startup becomes a calibrated launch sub-budget, a controlled cache toggle
can isolate its V8 share, or an active-page trace matrix separates event volume, process set, and
category interaction.

## D-042: Retain V8 compile-event duration as a diagnostic, not cache proof  (2026-07-14, accepted; startup and trace-lifetime diagnostics added by D-043; V8 checks made non-blocking by D-051)

**Decision:** The isolated diagnostic advances to `v8-code-cache@4` and retains the finite,
nonnegative `dur` from every attributed complete `v8.compile`/`v8.compileModule` event as
`compileDurationUs`, both per event and summed per artifact. Missing or malformed duration
invalidates the same attribution transaction as missing URL or streaming state. The report emits
raw per-run, per-artifact microsecond values and the result schema advances to v10.

Compile-event duration is a non-gating diagnostic. A shorter warm event may motivate a controlled
reproduction, but does not prove cache consumption; a flat event does not prove reparsing or
cache absence. Streamed compilation overlaps other work, three lineages are a small sample, and
the trace span is not an authoritative cache outcome. D-037/D-041's production, re-production,
and positive consume/reject evidence remain the cache gates.

**Context:** A local pinned-CfT 150.0.7871.115 run retained one compile event per artifact per
launch. The non-streamed render worker measured 24,862–25,262 µs fresh, 25,083–26,496 µs on the
produce launch, and 24,415–26,758 µs warm: overlapping ranges with no consistent warm decrease.
That is consistent with repeated full compile work but does not identify the mechanism. It also
puts the observed event near 25 ms—roughly 0.25% of the 10 s launch budget—so the worker's 99.84%
source-code share is not evidence of proportional launch cost. Streamed app events measured
37–40 µs fresh and 26–30 µs warm; streamed engine events were 3–8 µs in both phases. Those tiny,
overlapping/confounded spans do not turn RE-009 into functional cache proof.

The same run captured one core trace timeout at launch ordinal 5 followed by recovery at ordinal
6. Combined with the prior three-failure ordinal-3–5 burst and other isolated failures, RE-008
can be described as burst-capable with recovery, but the samples do not distinguish transient
shared state from chance clustering.

**Sources checked (2026-07-14):** local pinned CfT 150.0.7871.115
`v8-code-cache@4`/schema-v10 diagnostic on dev-01 under RDP (non-gating), with raw durations
retained in the result; current Chromium DevTools trace-event types, which declare complete-event
`dur` in microseconds
([source](https://chromium.googlesource.com/devtools/devtools-frontend/+/main/front_end/models/trace/types/TraceEvents.ts)).

**Consequences:** Parallax no longer discards already-captured compile spans, and can correlate
them with future artifact growth or controlled cache experiments. The duration diagnostic cannot
make a red cache gate green or replace authoritative cache outcome fields.

**Reopen if:** a controlled micro-repro establishes a calibrated relationship between this trace
span and cache consumption, Chrome documents stronger event semantics, or enough samples support
a variance-aware duration budget.

## D-041: Assert production phase boundaries and measure warm re-production  (2026-07-14, accepted; compile-duration diagnostics added by D-042; zero-count budget gates reclassified as diagnostic checks by D-051)

**Decision:** The isolated diagnostic advances to `v8-code-cache@3` and evaluates
URL-attributed code-cache production on every launch. Fresh launches must emit no production
events; any positive event invalidates the timestamp → produce → consume model directly.
Produce launches retain D-040's requirement that every cacheable required artifact emit positive
production. Warm launches record every positive re-production and gate the count at zero
artifacts. Missing warm production is a measured absence, not proof of consumption; D-037's
positive consume/reject requirement remains independently mandatory. Result schema v9 also adds
an ordinal and elapsed measurement-sequence time to every core and V8 launch so RE-008 samples
can be checked for temporal clustering.

**Context:** `v8-code-cache@2` inspected production only on launch 2, leaving two ambiguity gaps.
An unexpected launch-1 production would contradict the lifecycle but escape direct detection,
and repeated app/engine production on launch 3 would show that their launch-2 cache was not used
as expected rather than merely consumed without trace fields. A three-lineage local CfT
150.0.7871.115 diagnostic with the new assertions observed zero fresh production events and zero
warm re-production events in all repeats. Launch 2 again produced exactly 3,072 app bytes and
6,968 engine bytes while exposing no render-worker production (RE-010). The warm result therefore
does not support repeated production as the explanation for app/engine's missing consumption
fields; it is consistent with silent consumption but cannot prove it, so RE-009 remains open.

The same run's core trace failures occurred at launch ordinals 3, 4, and 5, approximately 30,
50, and 70 seconds after the measurement sequence began; launch 6 completed at approximately
90 seconds. Together with earlier warm-repeat-1 failures, this first timed sample argues against
a simple monotonic late-session cutoff while leaving RE-008's intermittent mechanism open. A
final-tree rerun then repeated the same fresh/produce/warm V8 outcomes with 9/9 completed traces
and completed all 6 core traces, further demonstrating intermittency rather than an ordinal
cutoff.

**Sources checked (2026-07-14):** local pinned CfT 150.0.7871.115 `v8-code-cache@3`/schema-v9
diagnostic on dev-01 under RDP (non-gating), plus the Blink source and Chromium three-fetch test
recorded by D-040.

**Consequences:** the existing nine V8 launches now test all three production phase boundaries
without adding launches. A reported warm re-production is measured negative evidence and fails
the gate even when consumption fields remain unavailable. An absence of re-production narrows
the functional hypotheses but never substitutes for positive consumption evidence. Trace
failures retain their order and elapsed position without inferring that either causes the issue.

**Reopen if:** Blink changes its production lifecycle, repeated production proves compatible
with a valid consumed cache, or temporal fields identify a better boundary than sequence start.

## D-040: V8 code-cache diagnostics use the timestamp/produce/consume lifecycle  (2026-07-14, accepted; production phase assertions amended by D-041; V8 checks made non-blocking by D-051)

**Decision:** The isolated V8 diagnostic advances to `v8-code-cache@2` and gives each of its
three persistent-profile lineages three launches: `fresh` establishes Blink's hot-resource
timestamp, `produce` must emit a URL-attributed `v8.produceCache` or `v8.produceModuleCache`
event with positive `producedCacheSize` for every cacheable immutable JavaScript artifact, and
`warm` is the first launch on which the zero-rejection budget requires URL-attributed cache
consumption. Fresh and produce launches reject unexpected consumption results. The enclosing
result schema advances to v8 and preserves per-artifact production outcomes even when another
artifact makes the aggregate production metric invalid.

**Context:** D-037/D-039 incorrectly modeled the second profile launch as a consumption launch.
Current Blink source selects `kSetTimeStamp` when no hot timestamp exists, selects
`kProduceCodeCache` after that timestamp exists, and only enters the consume path after code
cache exists. Chromium's own module cache test correspondingly loads a module three times and
states that the second fetch produces cache while the third consumes it. A corrected local
three-lineage diagnostic on pinned CfT 150.0.7871.115 then measured the same launch-2 production
in every lineage: 3,072 bytes for the app and 6,968 bytes for the engine. The game module was
below Chrome 150's 1,024-code-unit external-script threshold. The 5,257,345-code-unit render
worker compiled on launch 2 but emitted no URL-attributed production event in any lineage
(RE-010), so production correctly remained mandatory/invalid while retaining the two positive
outcomes. Launch-3 consumption still omitted a usable result for all cacheable artifacts,
strengthening RE-009 now that the maintained harness reaches the correct consumption launch.

**Sources checked (2026-07-14):** current Blink
[`v8_code_cache.cc`](https://chromium.googlesource.com/chromium/src/third_party/+/master/blink/renderer/bindings/core/v8/v8_code_cache.cc),
Chromium's
[three-fetch module cache test](https://chromium.googlesource.com/chromium/src/+/3188edc14a270a65297865a82af20bf4e3c57563%5E%21/),
and the local pinned-CfT diagnostic above on dev-01 under RDP (non-gating).

**Consequences:** each V8 lineage costs one additional short launch. The harness now proves the
cache-write prerequisite independently of cache consumption and cannot mistake a launch-2
production for a missing launch-2 hit. Worker production and warm consumption remain fail-closed
platform findings rather than being hidden behind one aggregate invalid state.

**Reopen if:** Blink changes the code-cache lifecycle, Chrome exposes an authoritative cache
state that removes a launch, or the extra launch becomes a measured throughput problem.

## D-039: Isolate mandatory V8 evidence from the core smoke trace  (2026-07-14, accepted; diagnostic lifecycle amended by D-040; partially superseded by D-051 — an invalid V8 diagnostic result no longer fails the overall verdict)
**Decision:** Harness v1 collects V8 code-cache evidence in the versioned
`v8-code-cache@1` diagnostic rather than co-locating `v8` with the core `smoke@1`
presentation/Dawn trace. The diagnostic owns three independent fresh/warm persistent-profile
lineages, traces only `v8` from before navigation through render readiness, and runs against the
same validated artifact, pinned Chrome executable, inspected environment, and before/after
source identity as the enclosing report. `smoke@1` still runs its three core fresh/warm lineages
with presentation, Dawn, and user-timing categories. Both sets and their trace-drain diagnostics
are emitted in one result; the schema advances to v7.

V8 code-cache evidence remains mandatory for Harness v1. An invalid `v8-code-cache@1` result
still fails the overall verdict; isolation narrows the damage of its trace failure rather than
turning the metric advisory. A V8 timeout can no longer invalidate core presentation or Dawn
evidence, and a core timeout cannot erase V8 attribution.

**Context:** D-038 measured that merely narrowing `devtools.timeline` to `v8` reduced ordinary
collection cost without materially changing the intermittent combined-trace failure rate. A
follow-up `ReturnAsStream` experiment also reproduced two timeouts in six launches: both
acknowledged `Tracing.end` in 1.8–1.9 ms, then never emitted `Tracing.tracingComplete`, so Chrome
never supplied an IO stream handle. The four successes completed in 116–125 ms. Changing the
transfer path therefore did not bypass the captured missing-completion failure and was not kept.

Two unchanged integrated isolation diagnostics then completed 12/12 core traces and 12/12
V8-only traces. Every core launch retained the expected Dawn evidence: fresh 6 shader/3 graphics-
PSO misses, warm 6/3 hits, and zero gameplay-overlap compilation. Core traces delivered
3,915,274–4,013,410 locally reserialized bytes in 111.3–121.3 ms. V8-only traces still attributed
all four immutable JavaScript artifacts while delivering just 173–177 events /
26,434–27,708 bytes in 11.0–12.3 ms. Warm V8 consumption remained invalid for the independent
RE-009 observability reason; isolation fixes evidence coupling, not Chrome's missing cache result.

**Sources checked (2026-07-14):** local CfT 150.0.7871.115 `ReturnAsStream` and integrated
isolation diagnostics above on dev-01 under RDP (non-gating); local Playwright 1.61.1 CDP
protocol declarations for `Tracing.tracingComplete`, `IO.read`, and `IO.close`.

**Consequences:** the report adds six short browser launches for V8's three paired lineages, but
protects the longer core runs and their valid Dawn evidence from a V8-correlated trace failure.
Artifact and source identity are rechecked only after both sets finish, so the shared report
cannot combine different builds. Profile histories remain explicit and are never compared
across the core/V8 boundary. The physical-console Dawn calibration can now obtain a complete
core evidence set even while the mandatory V8 metric remains invalid and keeps Harness v1 red.

**Reopen if:** isolated V8 traces become unreliable, Chrome exposes a stable non-trace
page-correlated cache result, combined tracing becomes reliable on the physical-console gate, or
the additional launches become a measured throughput problem.

## D-038: Narrow V8 tracing and measure trace completion as a first-class diagnostic  (2026-07-14, accepted; shared-trace placement superseded by D-039; V8 checks made non-blocking by D-051)
**Decision:** `smoke@1` enables the `v8` trace category, not the broader
`devtools.timeline` category, for D-037's `v8.compile`/`v8.compileModule` evidence. The
shared presentation/Dawn/V8 trace records its exact categories, event and CDP data-chunk counts,
locally reserialized UTF-8 event bytes, `Tracing.end` command latency, command-to-completion and
total completion latency, configured timeout, and Chrome's data-loss result for every started
trace. Partial diagnostics survive a timeout and appear in both JSON and the human report. The
result schema advances to v6. The five-second completion bound remains unchanged; a timeout
invalidates every probe that depends on the shared trace.

**Context:** A pinned-CfT 150.0.7871.115 remote A/B on the same artifact measured three
six-launch configurations. With `devtools.timeline`, three traces timed out; the three completed
traces delivered 29,383–29,914 events / 5,000,116–5,091,624 serialized bytes and completed in
149.2–152.1 ms. With `v8`, one trace timed out; the five completed traces still attributed every
immutable JavaScript artifact and retained the required compile fields while delivering
25,703–26,095 events / 4,088,465–4,151,565 bytes in 117.4–120.1 ms. With no V8 category, all six
traces completed with 24,770–25,036 events / 3,954,012–3,982,554 bytes in 112.7–117.3 ms. A
second `v8` diagnostic timed out twice; on both failures `Tracing.end` returned in 1.6–2.1 ms,
then Chrome delivered neither `Tracing.tracingComplete` nor any data chunk during the remaining
five-second bound. Its completed traces took 116.8–119.1 ms total. A separate 20-second broad-
category diagnostic completed 6/6, but every completion was still fast (146.5–153.3 ms); it did
not capture a delayed completion and therefore does not establish that a larger bound repairs
the intermittent failure.

These samples correlate V8 tracing with the completion failure, but they do not establish a
volume-driven flush mechanism: completed drains are two orders of magnitude below the bound,
while failures begin only after the end command returns and deliver zero chunks. Narrowing is
still the correct maintained configuration because it preserves the probe with measurably less
trace traffic. Splitting the shared trace would require another navigation/launch and would
change the fresh/warm profile lineage whose atomic evidence the harness is measuring, so that is
not adopted without a replacement lifecycle design.

**Sources checked (2026-07-14):** local CfT 150.0.7871.115 diagnostics above on dev-01 under
RDP (non-gating); exact trace configuration and partial completion diagnostics recorded by
`smoke@1` v6.

**Consequences:** ordinary trace completion cost and failure mode are now observable per run.
The narrower V8 category reduces collection overhead but does not eliminate RE-008, and one
completion failure still invalidates presentation, Dawn, and V8 evidence together. The retained
diagnostics distinguish a `Tracing.end` command stall, missing completion event, data loss, and
large/slow payload if Chrome's behavior changes.

**Reopen if:** `v8` stops carrying the D-037 fields, the trace completion failure reproduces on a
physical-console gate, `ReturnAsStream` or another collection mode proves more reliable, or a
separate-navigation design can preserve the required profile lineage and atomic measurement
contract.

## D-037: Streamed-module V8 cache traces are diagnostic, not cache-hit evidence  (2026-07-13, accepted; trace category amended by D-038, collection isolated by D-039, launch lifecycle corrected by D-040/D-041, duration retained by D-042; zero-rejection budget reclassified as a diagnostic by D-051)
**Decision:** `smoke@1` implements its V8 code-cache probe with URL-attributed
`v8.compile`/`v8.compileModule` events from Chrome's `devtools.timeline` trace category.
Every launch-required immutable JavaScript artifact in the validated build manifest must have at
least one compilation event before any cache outcome is evaluated. Multiple events for one URL
are valid when the same artifact compiles in multiple renderer processes, workers, threads, or
realms; the result retains each event's process/thread identity and requires trustworthy evidence
from every compilation. On a warm profile, a successful consumption requires a positive
`consumedCacheSize` and `cacheRejected: false`; an explicit `cacheRejected: true` is measured
negative evidence even if its size is zero or absent, and fails the zero-rejection budget. A
missing/ambiguous result is `invalid`, while artifacts below Chrome 150's
1,024-decoded-source-code-unit threshold and cold-profile consumption are explicitly
`not-applicable`. If no artifact is cacheable, the aggregate mandatory metric is also
`not-applicable` and fails the gate. The overall smoke result schema advances to v5.

**Context:** All four current Parallax JavaScript artifacts compile as ES modules. In pinned CfT
150.0.7871.115, the three window modules stream and the render-worker module currently reports
non-streamed compilation. Chromium's non-streaming `V8ScriptRunner::CompileModule` branch
serializes a `V8ConsumeCacheResult`, but its `ScriptStreamer` branch does not populate that
result. A local persistent-profile experiment captured the four exact Parallax URLs on each of
five launches; their compile events never included `consumedCacheSize` or `cacheRejected`.
The second launch instead reported producing 3,072 bytes of app cache and 6,968 bytes of engine
cache, so at least those two artifacts demonstrably did not consume code cache on launch 2.
Blink's process-wide `WebCore.Scripts.V8CodeCacheMetadata.Get` histogram later contained four
code-cache-metadata reads, but that surface requires the subprocess-importing Histograms
Internals page and cannot correlate a read, V8 acceptance, or rejection to a page URL. Treating
it as a hit would violate the project's measure-don't-assert rule.

The first maintained six-launch remote diagnostic completed all combined traces within D-035's
bound, attributed all fresh artifacts, and left the already-validated Dawn
fresh-miss/warm-hit evidence unchanged. Two post-review six-launch reruns continued to attribute
all four artifacts in every completed fresh trace and all three cacheable artifacts in each
completed warm trace, but one and then three combined traces exceeded the existing five-second
completion bound. Across these three maintained diagnostics, 14 of 18 traces completed and four
timed out with the measured page kept alive, extending RE-008. No completed trace reported CDP
buffer data loss. Every completed warm V8 result correctly remained `invalid`, so these
diagnostics do not promote a V8 gate baseline. RE-009 records the code-cache observability gap.

**Sources checked (2026-07-13):** local CfT 150.0.7871.115 experiments above; Chromium tag
150.0.7871.115 `third_party/blink/renderer/bindings/core/v8/v8_script_runner.cc`,
`v8_code_cache.cc`, `inspector_trace_events.cc`, and
`tools/metrics/histograms/metadata/v8/enums.xml`; pinned V8 revision
`ce0af5c0d181678bcda077c68d4beaec2854ad16` via Chromium's `DEPS`.

**Follow-up checked (2026-07-14):** the third maintained local CfT 150.0.7871.115 diagnostic
above; three of its six combined traces timed out and none reported trace-buffer data loss.

**Consequences:** the V8 probe is implemented but its mandatory warm metric remains invalid on
the walking skeleton. The trace diagnostic is kept because it is exact, page-correlated, and
will turn measured without a schema change when Chrome exposes successful streamed consumption.
Process-wide metadata-read counts remain supporting diagnostics only. The probe must be extended
separately when a wasm artifact exists; this decision covers JavaScript code caching.
Decoded source length is read from the validated built files before launching Chrome so non-ASCII
bundles use the same UTF-16-code-unit quantity as Blink rather than response byte length; a
leading BOM is removed to match browser decoding. The M0 manifest currently contains only
launch-required JavaScript. Before lazy scenario-specific JavaScript chunks enter it, the build
contract must classify scenario participation so `smoke@1` can keep zero compilation events
invalid for required code without demanding unrelated lazy chunks.

**Reopen if:** Chrome adds consumption/rejection data to streamed-module trace events, exposes a
stable page-correlated code-cache API, changes the pinned cacheability threshold, or Parallax
adds wasm and needs `v8.wasm.moduleCacheHit` evidence.

## D-036: D3D12 Dawn gates combine page-windowed traces with subprocess cache histograms  (2026-07-13, accepted)
**Decision:** `smoke@1` implements the mandatory Dawn pipeline compile/cache metric on the
registered D3D12 gate by combining two independent Chrome surfaces. One browser-wide trace,
started before navigation, adds `disabled-by-default-gpu.dawn` to the D-035 categories.
Renderer user-timing markers bound gameplay; any overlapping synchronous render/compute
pipeline creation, asynchronous `CreatePipelineAsyncEvent::InitializeImpl`, or D3D12 shader
compiler event fails the zero-gameplay-compile budget. After the trace and measurement end,
the harness opens `chrome://histograms/` outside the measurement window while the trace remains
active, synchronizes subprocess counters, then ends the trace and synchronizes them again. It reads
the exact `GPU.WebGPU.D3D12` shader, graphics-PSO, and compute-PSO hit/miss histograms through
CDP. Shader request/miss trace counts must agree exactly with the histogram operation counts;
PSO histogram operations are bounded by the trace's synchronous API requests plus actual
asynchronous initializations, and must cover every traced asynchronous initialization (a
synchronous API request can be an in-device cache hit and therefore have no backend PSO
histogram). Graphics and compute counts also have independent upper bounds: their matching
synchronous requests plus the generic async-initialization count, so one path cannot explain
contradictory evidence from the other. Each synchronization itself uses two stable reads, and the snapshots immediately
before and after trace completion must also match; any late change makes the metric `invalid`.
Any other trace/histogram contradiction does likewise.
Missing hit or miss sides count as zero only when the counterpart proves that cache path was
exercised. Non-D3D12 backends remain explicit `unsupported` for this probe rather than
borrowing D3D12 semantics.

**Context:** Dawn emits page-windowable pipeline/compiler work into Chrome's disabled Dawn
trace category, but its exact backend cache results are GPU-process UMA histograms. A direct
`Browser.getHistograms` call returned no `GPU.WebGPU` entries because CDP reads the browser
process's statistics recorder. Chrome's Histograms Internals page imports shared-memory
subprocess histograms and requests remaining child-process deltas; after that synchronization,
the same CDP call returned Dawn's exact counters. Keeping the trace active through the first
import makes any deferred app Dawn work visible to both surfaces; the stable post-trace snapshot
then establishes their shared observation boundary. The internals tab opens only after the
presentation tail and gameplay marker, so its focus/GPU work cannot contaminate measured
timings, and filtering to Dawn's `GPU.WebGPU` events/counters excludes unrelated diagnostics
work. Each `measureRun` launches a new
browser process, so counters are per launch even though the persistent profile deliberately
survives for its paired warm relaunch.

A non-gating remote diagnostic with pinned CfT 150.0.7871.115 on dev-01 measured the same
result across all three lineages: each fresh launch recorded 6 shader-cache and 3 graphics-PSO
misses; each warm relaunch recorded 6 shader-cache and 3 graphics-PSO hits; compute PSOs were
not exercised; all six marked gameplay windows had zero overlapping pipeline initialization
and zero shader compiler events. The environment correctly remained `invalid` under RDP, so a
physical-console rerun is still required before baseline promotion.

**Consequences:** smoke result schema advances to v4. Harness reports whole-launch cache counts
and durations while using trace markers—not end-of-run UMA—for gameplay-window attribution.
Synchronous API creation is conservatively budgeted even if Dawn could satisfy it from an
in-device cache; Parallax's warmup contract forbids requesting new pipelines during gameplay
regardless. `smoke@1` now marks the D3D12 Dawn metric implemented and continues to fail when the
probe is unsupported, internally inconsistent, or missing. RE-007 records the Chrome
observability gap and internals-page synchronization cost. Each PSO cache subpath carries its
own metric state; an unexercised compute or render path is `not-applicable`, never a measured
zero-hit result.

**Sources checked (2026-07-13):** local CfT 150.0.7871.115 experiments above; Chromium tag
150.0.7871.115 `content/browser/metrics/histograms_internals_ui.cc`,
`content/browser/resources/histograms/histograms_internals.html` and
`histograms_internals.ts`, `content/browser/devtools/protocol/browser_handler.cc`,
`gpu/command_buffer/service/dawn_platform.cc`, and
`gpu/command_buffer/service/webgpu_decoder_impl.cc`; pinned Dawn revision
`01249a97332468dbdd6cf5edb8dd7bae77875de5` `native/d3d12/RenderPipelineD3D12.cpp`,
`native/CacheRequest.h`, and `native/CreatePipelineAsyncEvent.cpp`. A local attempted
page-close boundary was rejected after two of six browser traces exceeded D-035's five-second
completion bound; keeping the app target alive preserved the already-validated bound.

**Reopen if:** Chrome exposes page-correlated Dawn cache events directly, CDP gains a safe
subprocess-histogram option, Dawn trace/histogram semantics change, or another backend is
promoted to a mandatory gate and needs its own verified mapping.

## D-035: Viz presentation-feedback trace is diagnostic, not a presentation gate  (2026-07-13, accepted; partially superseded by D-051 — the authoritative presentation metric is informational and no longer fails Harness v1)
**Decision:** `smoke@1` records GPU-process `Display::FrameDisplayed` intervals as the
explicitly non-gating `vizPresentationFeedbackCallbackIntervalMs` diagnostic. It does not
satisfy budgets.md's compositor-presentation metric, which remains mandatory and invalid.
The collector enables only `disabled-by-default-display.framedisplayed` plus
`blink.user_timing`; renderer `performance.mark()` instants bound the run in Chrome's
shared monotonic trace clock. A usable diagnostic requires no trace loss, exactly one GPU
process/track, and feedback spanning both boundaries. A 100 ms post-marker trace tail sits
outside app/CPU measurement so the final callback can close the boundary interval. Smoke
result schema advances to v3 for the diagnostic and its cross-repeat variance. Trace
end/completion is bounded as one five-second transaction; timeout or CDP disconnect makes
only the diagnostic invalid and always detaches the session.

**Context:** Chromium's Viz `Display::DidReceivePresentationFeedback` sanitizes invalid
feedback to `PresentationFeedback::Failure()`, whose timestamp is the failure time and whose
flags contain `kFailure`, then emits `Display::FrameDisplayed` with only the timestamp/name.
The trace event does not expose that failure flag. Treating every event as successful
scan-out could therefore report a passing cadence when presentation actually failed. A
local diagnostic on branded Chrome Stable 150.0.7871.102, Windows 11, RTX 4080
Super/D3D12, observed one callback track and correlated it with the worker's ~32 Hz pacing;
that validates collection/clock alignment, not display success. RE-005 records the
branded-vs-pinned cadence question and RE-006 the blocking observability gap.

**Consequences:** The harness preserves useful compositor-adjacent evidence without
weakening the true frame gate or substituting worker callbacks. Trace ambiguity/loss makes
only the diagnostic invalid and does not independently fail a run. The mandatory metric's
explicit invalid state continues to fail Harness v1. A browser surface that exposes both
the timestamp and presentation-success flags—or another independently correlated source—is
required before applying frame budgets. External trace markers also remain unsuitable for
D-025's eventual driver-free in-game measurement path.

**Sources checked (2026-07-13):** Chromium
`components/viz/service/display/display.cc` at main (sanitization and trace emission),
`ui/gfx/presentation_feedback.h` at main (`Failure()`, `kFailure`, and timestamp semantics),
`base/trace_event/builtin_categories.h` at main (the dedicated category), and the Chrome
DevTools Protocol Tracing-domain documentation (completion, delivery, and data loss). Local
behavior was checked directly as described above.

**Reopen if:** Chrome exposes the feedback flags in a correlated trace/CDP event, a stable
page-correlated presentation API becomes available, or a separate probe can prove that all
events in the gate window represent successful scan-out.

## D-034: Harness gates versioned observed environments from a physical console  (2026-07-13, accepted)
**Decision:** Reference-machine identities live as versioned descriptors in
`harness/machines/`; `smoke@1` verifies the requested tier against observed state rather
than caller-provided GPU/backend/power/display labels. The initial Windows verifier checks
the exact OS build, CPU topology, minimum RAM, CDP primary-GPU PCI IDs and driver, WebGPU
adapter vendor/architecture/device/driver/backend, active Windows power-scheme GUID, and
display-controller resolution/refresh. Every gate browser launches native fullscreen without
Playwright viewport emulation, ties its own `screen` dimensions at its device-pixel ratio to
the target physical resolution, requires every refresh rate reported by Chrome GPU Internals
to match the tier, and verifies the canvas device-pixel surface equals the tier resolution;
Chrome-internals diagnostics complete before the full warmup, then each measurement browser
samples screen/surface identity at the immediate boundaries of its 120-frame window and
continuously records device-pixel resize events during the window, with any drift invalidating
the result. Windows display adapters are matched to the descriptor by PCI vendor/device IDs,
not mutable display names; any other active adapter is rejected as unregistered. The short-lived
identity browser loads a minimal harness-control document and enables Chrome's WebGPU
developer-features switch solely to read the
non-standard adapter backend and driver;
measurement browsers do not enable that switch. Host identity is sampled before and after
the six measurement launches, and any drift invalidates the result. A remote Windows session,
remote/indirect display adapter, unregistered tier, missing descriptor, or any mismatch makes
the mandatory environment metric `invalid`. Reference gates require advance notice to the
developer and a native local interactive session at the physical machine; remote sessions
remain valid only for explicitly non-gating development diagnostics.

**Context:** Machine/backend/power/display fields in the first `smoke@1` report were
declarations and therefore could not establish gate eligibility (D-031). A local CfT
150.0.7871.115 experiment on dev-01 on 2026-07-13 showed why: under RDP, Windows' physical
NVIDIA controller reported 3840×2160 at 59 Hz while Chrome's GPU Internals accessibility
tree reported three remote displays at 32 Hz; Windows also exposed a Microsoft Remote
Display Adapter. The same pinned Chrome, launched separately with
`--enable-webgpu-developer-features`, exposed the selected adapter as NVIDIA Lovelace,
D3D12, driver 32.0.15.9649. Chrome documents the extended `GPUAdapterInfo.backend` and
`driver` fields as developer-only, and CDP documents GPU PCI/driver fields but not the
selected WebGPU backend, so both probes are needed.

The first physical-console verification later on 2026-07-13 found the installed NVIDIA
driver had advanced to 32.0.16.1074; Windows, CDP, and developer-mode WebGPU adapter info
agreed, so that version is the explicitly promoted dev-01 descriptor baseline. The earlier
RDP evidence retains its observed version rather than being rewritten.

**Consequences:** `PARALLAX_GPU_BACKEND` and `PARALLAX_POWER_MODE` are removed; future
machine registrations add descriptors and platform probes instead of trusting labels. OS,
driver, or power-plan promotion is visible in review. The developer-features switch can
change development-only WebGPU behavior, so isolating it to identity inspection avoids
silently changing the measured runtime. The Harness v1 environment probe is implemented,
and its dev-01 native-console measurement was `measured` across all three fresh/warm pairs on
2026-07-13; other mandatory probes still keep Harness v1 incomplete. The smoke result schema advances to v2 for the observed machine,
adapter, browser-display, and pre/post host-identity fields. Result-contract field names remain
browser-neutral (`executableSha256`, `refreshRatesHz`) even where the current privileged probe
is Chrome-specific; probe failures are retained in browser-neutral `probeFailures` evidence
and invalidate the environment so a completed measurement report is still written. Machine
IDs are accepted case-insensitively and persisted using the descriptor's canonical lowercase
ID. Descriptive CPU/WebGPU strings compare case-insensitively with whitespace normalized;
numeric PCI IDs, OS/driver/browser versions, measured dimensions/rates, and power GUIDs
remain strict.
This supersedes D-031's initial fixed-headed-viewport provision: native fullscreen plus an
explicit render-surface assertion makes each measured browser prove its presentation monitor
instead of accepting an emulated `window.screen`.

The native run also established that Chrome's `devicePixelContentBoxSize` is consistently
3841×2161 on dev-01's 3840×2160 display under its fractional Windows scale. The descriptor's
explicit ±2-pixel physical-dimension tolerance therefore applies to both observed screen and
render-surface checks; the actual surface remains recorded per run (RE-003).

**Sources checked (2026-07-13):** local dev-01 experiments described above;
`chromedevtools.github.io/devtools-protocol/tot/SystemInfo/`;
`developer.chrome.com/docs/web-platform/webgpu/developer-features`; and Chromium's
`gpu/config/gpu_switches.cc` definition of `enable-webgpu-developer-features`.

**Reopen if:** Chrome exposes the selected WebGPU backend through a stable, non-mutating
CDP surface; OS display APIs cannot identify the actual presentation display; a remote
transport can prove unmodified physical display timing; or exact OS/driver pins cause more
baseline churn than research value.

## D-033: NPC context is assembled by a knowledge service in engine/ai  (2026-07-13, accepted)
**Decision:** The AI layer gains a **knowledge service** in `engine/ai`: NPC prompts are
assembled as persona card + context retrieved through an explicit interface — never by
hardcoding all world knowledge into the prompt. Three context tiers, each adopting its
own mechanism independently, on evidence:
1. **Structured game-state queries** — quest state, relationships, location/world-graph
   facts answered from the sim's typed state. Deterministic, no embeddings, debuggable;
   the default tool, and it lands with M3.
2. **Authored lore retrieval** — world backstory chunked + tagged at authoring time,
   shipped as a content-addressed game-specific bundle (D-010). Mechanism open:
   tag/world-graph lookup vs. precomputed embeddings with brute-force similarity (at
   game-scale corpora — thousands of chunks — a linear scan in a wasm simd128 worker
   suffices; no vector database). Build-later.
3. **Episodic memory** — NPC observations embedded at runtime. Requires an app-owned
   embedder: Chrome ships **no built-in Embedding API** (checked 2026-07-13).
   Build-later.
**Ownership (layer rules apply as everywhere):** `engine/ai` owns the *generic
contract* — provider registration, context assembly/ranking/token budgeting, scheduling,
telemetry — and contains no game knowledge. `game/` supplies the providers: game-state
query implementations, retrieval schemas, lore content and its tagging, persona cards.
The tier list above describes what game-supplied providers answer, not what engine code
knows.
Design-now constraints: the M3 prompt/persona-card schema reserves a retrieved-context
slot from day one; lore is authored chunked + tagged in `game/` from the first writing;
embedding precompute, if adopted, is an `assets/` pipeline step. The service is
**backend-independent of D-017/P-007** — whichever generation backend wins, retrieval
infrastructure is app-owned.
**Context:** On-device, prompt-stuffing is triply wrong: prefill cost scales with prompt
length (time-to-first-token is the dialog latency the player feels), Nano session/context
limits are an already-flagged D-017 concern, and small models degrade on long
mostly-irrelevant context. Unlike generic RAG deployments, a game has an authoritative,
queryable ground truth (the sim state and world graph) — so semantic retrieval is the
fallback for freeform lore and memories, not the default mechanism. Persona cards remain
what they always were: curated static context.
**Sources checked (2026-07-13):** developer.chrome.com/docs/ai/built-in lists Prompt,
Summarizer, Translator, Language Detector, Writer, Rewriter, Proofreader — no Embedding
API. App-owned in-browser embedding is feasible today: EmbeddingGemma (~308M on-device
embedder, developers.googleblog.com/en/introducing-embeddinggemma) runs in-browser via
Transformers.js with WebGPU (huggingface.co/docs/transformers.js/guides/webgpu).
**Consequences:** engine/AGENTS.md `ai/` scope; architecture.md NPC AI section and
forward-design constraints; plan.md M3 item; rough-edges.md pre-seeds the missing
Embedding API gap; P-007's "facts stay prompt-context" phrasing refined — facts stay out
of the *weights* and arrive via assembled context.
**Reopen if:** M3 evidence shows persona cards alone suffice at shipped scale (drop the
unused tiers, keep the interface), or a Chrome built-in Embedding API ships (re-evaluate
tier-3 embedder ownership — and update the rough-edges entry).

## D-032: Performance-first technology placement — JS is glue; wasm SIMD/threads baseline  (2026-07-13, accepted)
**Decision:** Per-subsystem language/technology placement is a performance decision made
on harness evidence, with no presumption that TypeScript is the default and wasm/WGSL the
exception. TS/JS is orchestration and glue; compute-heavy paths are presumed Rust→wasm or
WGSL compute until measurement says otherwise — and the reverse presumption is equally
banned: JS↔wasm boundary-crossing cost is real (wasm cannot call WebGPU/OPFS/web APIs
directly; every call bounces through JS glue), so "rewrite it in wasm" is also a claim
the harness must confirm. **Baseline machine/browser requirements:** wasm `simd128` and
threads (atomics + SAB) are required; engine wasm crates enable them unconditionally and
ship no scalar or single-threaded fallback paths. Relaxed-simd is baseline too **except
in crates that feed deterministic simulation state**: relaxed operations are
hardware-dependent by design (FMA contraction, lane-select and min/max edge cases differ
across x86/ARM), which is incompatible with D-016's cross-machine state-hash requirement
— authoritative-sim crates use plain simd128 only. Wasm's SIMD is fixed 128-bit — no
SSE/AVX passthrough, no 256/512-bit path — but what that ceiling costs is
machine-dependent (dev-01's x86 has AVX2-class width to lose; the Standard profile's
M1 Pro is itself 128-bit NEON), and "wider-than-128-bit work moves to WGSL compute" is a
working **hypothesis**, not a placement rule: the standing rough-edges item compares
native (AVX2/NEON), wasm simd128, and WGSL compute on a representative kernel per
reference machine before any rule is fixed. Rust stays the authored language for engine wasm
modules (determinism, D-014/D-020); consuming existing C/C++ libraries compiled to wasm
(e.g., Basis transcoder, meshoptimizer per D-006) is consistent with this.
**Context:** A project-level review against a "maximum performance on the web platform,
JS as glue" principle found the stance already de facto (D-004/D-005 chose Babylon for
AI-iteration speed and attribution, not JS purity; wasm hot paths and custom WGSL passes
were always planned) but nowhere explicit, leaving room for future agents to drift
JS-first out of web idiom. This entry makes the principle a citable rule.
**Sources checked (2026-07-13):** relaxed-simd standardized 2024, shipped in Chrome
(github.com/WebAssembly/relaxed-simd;
platform.uno/blog/the-state-of-webassembly-2025-2026); flexible-vectors (length-agnostic
wider SIMD) still stage-1 design (github.com/WebAssembly/flexible-vectors);
emscripten.org/docs/porting/simd.html (simd128 ↔ SSE/NEON-class mapping).
**Consequences:** engine/AGENTS.md Rust/WASM conventions gain the SIMD/threads baseline,
the no-fallback rule, and the deterministic-sim relaxed-simd carve-out; root AGENTS.md
stack constraint names the baseline; rough-edges.md pre-seeds the CPU SIMD-width-ceiling
measurement (native AVX2/NEON vs. wasm simd128 vs. WGSL compute, per reference machine).
**Reopen if:** flexible-vectors or another wider-SIMD path ships in Chrome (recalibrate
the CPU/GPU split), or measurements show boundary overhead systematically negating wasm
wins for a whole subsystem class (record the placement rule that replaces the
presumption).

## D-031: Harness smoke gates an exact external Chrome for Testing pin  (2026-07-12, accepted; fixed-headed-viewport provision superseded by D-034; partially superseded by D-051 — the presentation metric no longer stays mandatory-and-blocking)
**Decision:** The first Harness v1 scenario is versioned as `smoke@1` and is driven by
exact-pinned `playwright-core`. Gate runs require `PARALLAX_CHROME_PATH` to name an
externally archived Chrome for Testing executable whose full version matches
`harness/chrome/stable.json` and whose executable SHA-256 matches the platform pin; the
runner never downloads a moving browser or silently falls back to installed branded
Chrome. Each of three repeat lineages starts with an
empty persistent profile and is relaunched once warm. Both launches exclude 10 seconds,
then record 120 recent render-worker frames. Worker animation-callback spacing is a
nearest-rank diagnostic, not a presentation-budget metric; true compositor
present-to-present timing stays mandatory and invalid until a validated probe exists,
and callback p95 variance above 10% makes that diagnostic invalid. The versioned
scenario, tier profiles, and single mandatory/incomplete metric registry live together
in `harness/src/runs/`.
As amended by D-034, the requested tier fixes a verified native-fullscreen display and
device-pixel render surface rather than a Playwright-emulated headed viewport. Reports are local ignored artifacts
and fail on measured budgets, browser errors, version mismatch, unverified gate identity,
or any other unfinished Harness-v1-mandatory probe.

**Context:** D-019 requires archived CfT rather than auto-updating branded Chrome, and
D-020 chose Playwright. Playwright's official browser documentation confirms that it
can drive branded Chrome and that browser channels differ from its default Chromium;
Chrome's official CfT documentation provides versioned downloads and JSON endpoints.
On 2026-07-12 the official last-known-good endpoint reported Stable 150.0.7871.115,
revision 1639810; that exact version was downloaded and locally verified before the
first run. The run produced stable callback-pacing evidence recorded as RE-001 and
exposed that callback timestamps cannot satisfy the presentation metric.

**Consequences:** Updating the pin is an explicit baseline-promotion action, not a
package update side effect. Machine-local browser archives stay outside git. Installed
branded Stable remains reserved for D-019 parity smoke work. The overall Harness v1
checkbox remains open until presentation, environment, Dawn/V8 cache, and pipeline
probes land; missing mandatory metrics are explicit invalid states rather than passing
by omission. Local-server metrics exclude their own endpoint and atomically publish
only completed-request deltas, so observation neither contaminates nor blocks a run.
Artifact, executable, tracked-diff, and untracked-file hashes stream rather than buffer
multi-GB inputs. This M0 driver-run window is not a D-025 benchmark result; M1 still moves
scenario boundaries, aggregation, and export in-game before exposing benchmark mode.

**Sources checked (2026-07-12):**
`playwright.dev/docs/browsers` and
`developer.chrome.com/blog/chrome-for-testing/`; the live pin came from
`googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json`.

**Reopen if:** CfT archives cannot reproduce branded Chrome behavior, external browser
bootstrap is too error-prone, or the smoke scene needs an in-app measurement window to
keep later D-025 manual and automated paths identical.

## D-030: Findings handback runs in fix-pass and verify-pass modes  (2026-07-12, accepted; modes retired by D-155)
**Decision:** Two more kickoff prompts get encoded operating models in workflow.md,
completing the review loop started by D-026/D-027. Handing an agent review results or
findings ("here are the review findings — address them") invokes **fix-pass mode**: the
agent independently verifies each finding before acting (findings are claims per D-027,
not orders), fixes confirmed ones at root cause with docs-with-code and re-verification,
rebuts unconfirmed ones with concrete evidence, and ends with a self-contained
per-finding disposition report. Asking an agent to "verify the fixes" invokes
**verify-pass mode**: given the original findings and the fix agent's dispositions, the
agent verifies each fix against the working tree rather than trusting the report,
independently adjudicates each pushback, stays read-only by default (like reviewer
mode), and reports a per-finding verdict (fix verified / fix incomplete / pushback
accepted / pushback rejected).
**Context:** Same motivation as D-026/D-027 — the human was restating these two process
descriptions in every handback and fix-verification prompt. Encoding them makes the full
loop (review → fix or push back → verify) invocable with short prompts, and makes
independent re-verification the default at both steps instead of prompt-dependent.
**Consequences:** workflow.md gains "Findings handback: fix-pass mode" and
"Fix verification: verify-pass mode"; handback and verification prompts need no process
language; fix-pass agents are expected to push back rather than blindly apply findings.
**Reopen if:** the disposition/verdict categories prove too coarse in practice, or the
verify pass consistently finds nothing and becomes ceremony worth dropping.

## D-029: M0 in-app telemetry export surface  (2026-07-12, accepted; recent-frame retention widened 120 → 240 by D-054, schema shape unchanged)
**Decision:** Engine telemetry is exposed on the window as a non-writable
`globalThis.__PARALLAX_TELEMETRY__` object with a versioned snapshot/subscribe contract.
Schema v1 begins with render lifecycle state, initialization-to-first-frame time,
failure detail, engine/game version identity, total frame count, and a fixed 120-sample
recent-frame window; the render worker sends 60-frame batches so instrumentation does
not add per-frame main-thread messages. Initialization has two explicit phases: end-to-end worker startup
(immediately before construction through first frame, including module load/evaluation)
and worker-local initialization (start message through first frame). The harness
consumes only this public surface, never engine internals. Full result aggregation and
mandatory metrics remain Harness v1 scope.
**Context:** The walking skeleton introduces the first runtime subsystem, and project
rules require instrumentation and a harness-facing export from day one. A fixed sample
window prevents telemetry memory from growing during long runs while subscriptions let
the harness collect every batch during a measurement window.
**Consequences:** Changes to the global name or schema are versioned contract changes.
The app installs the export explicitly from the render service; the engine does not use
an implicit main-thread singleton.
**Reopen if:** CDP bindings or another measured transport proves more reliable without
making the harness depend on engine internals.

## D-028: M0 local artifact and serving contract  (2026-07-12, accepted; metrics endpoint schema advanced to v2 — per-path-class counters — by D-054)
**Decision:** The M0 build assembles a static `dist/` tree with an unhashed `index.html`
and all executable modules under `dist/immutable/`. Engine and game
package builds retain stable, independently loadable entry names; the assembler gives
their served copies SHA-256-derived names and connects them to the app with an import
map, so Vite cannot fold either boundary back into the app bundle. The version-controlled
local server lives in `harness/`, uses Node's HTTP implementation, applies
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` to every response (including 304s), serves
content-addressed modules with a one-year immutable policy, and requires revalidation
for unhashed files. Strong SHA-256 ETags drive conditional requests using RFC 9110's
weak comparison, wildcard, and list semantics for `If-None-Match`; the static server
rejects unsupported methods. The generated
`build-manifest.json` records sorted paths, byte counts, and full SHA-256 digests for
the exact assembled artifacts. Served module filenames include the full SHA-256 digest.
The engine's separately built render-worker URL uses the build-time
`__RENDER_WORKER_ARTIFACT__` token: the assembler hashes and writes the worker first,
replaces that token in `engine.js` while retaining its `./` sibling-URL prefix, then
hashes the rewritten engine artifact. The build-contract test gates this two-sided
engine/assembler contract.
The local server caches validated ETag metadata across requests and exposes versioned
request/cache counters at `/__parallax/metrics`; conditional 304 responses therefore do
not reread or rehash unchanged artifacts.
**Context:** D-011 deliberately left the local serving-config location to M0. D-010
requires a real packaging boundary, not merely separate source directories, and the
harness must be able to identify exact bytes. Automated local tests on 2026-07-12
verified isolation/cache headers on 200 and 304 responses and the conditional-request
cases defined by RFC 9110 (`datatracker.ietf.org/doc/html/rfc9110`, checked 2026-07-12);
the assembled-build contract gate verified references and content digests, and a
same-host double build verified identical engine bytes. Dependency versions were checked against the npm
registry on 2026-07-12; Node 24's LTS status was checked against the official Node.js
release table (`nodejs.org/en/about/previous-releases`, checked 2026-07-12) the same
day.
**Consequences:** `pnpm start` is the local build-and-serve entry point, and `pnpm build`
includes the same-host engine repeatability gate. Production
nginx remains deferred to M2 per D-011/D-022, and `site/` remains untouched. The M0
repeatability gate covers engine artifact bytes; cross-host reproducibility remains the
later D-020 level-2 gate.
**Reopen if:** the local server diverges from production semantics, import maps prevent
a required cache/code-cache experiment, or the assembled artifact contract cannot
represent a new common/game-specific resource class without ambiguity.

## D-027: Review passes run in reviewer mode  (2026-07-12, accepted; amended by D-049 — review is multi-agent; mode retired by D-155 — reviews are on-demand, one agent, one pass)
**Decision:** A kickoff prompt asking for a review of current changes ("review the
current changes") invokes the **reviewer operating model** in workflow.md: the unit
under review is the entire uncommitted working tree (diff against last commit plus
untracked files, including docs-moved-with-code); the reviewer is **read-only by
default** (the implementing agent owns fixes; the reviewer edits only when the human
says to fix directly); review scope covers correctness, AGENTS.md rule compliance,
missing decision/rough-edges entries, budget implications, and better-approach
suggestions clearly labeled as suggestions rather than defects; findings are verified
with cheap checks before being reported (root rule 3); and the report is written for
verbatim handback to the implementing agent — self-contained findings (file:line, what,
why, severity, suggested fix) phrased as claims to verify or rebut with evidence,
ranked most-severe first. A clean review is a valid result.
**Context:** Companion to D-026 — the human runs review passes from separate agent
sessions (workflow step 2) and was specifying the process in each prompt; encoding it
makes "review the current changes" sufficient. Read-only-by-default keeps the handback
loop clean: one agent's understanding of the change stays authoritative for fixes.
**Consequences:** workflow.md gains "Review passes: reviewer mode"; review kickoff
prompts need no process language; findings-as-verifiable-claims matches tech-lead
mode's duty to address or rebut every finding.
**Reopen if:** the handback loop proves slower than reviewers fixing in place — then
define when a reviewer may fix directly (and how the implementing agent is informed).

## D-026: Milestone work runs in tech-lead mode  (2026-07-12, accepted; amended by D-049 — unit of work is task-sized, not commit-sized; operating model replaced by D-155's lean loop)
**Decision:** A kickoff prompt naming a milestone ("start work on M0") invokes the
**tech-lead operating model** defined in workflow.md: the lead agent scopes a
commit-sized slice from plan.md in dependency order; delegates well-scoped pieces to
subagents with per-task model/reasoning-effort choices; serializes writing subagents
(shared working tree) while parallelizing read-only work; owns acceptance with evidence
(runs the checks itself — subagent success reports are assertions, not measurements);
retains the cross-cutting duties (decision log, rough-edges, docs-with-code, budgets)
regardless of delegation; and, once it believes the slice complete, spawns a
fresh-context **adversarial reviewer** over the full working-tree diff briefed to find
problems, addressing findings before handoff.
**Context:** The human was pasting this operating model into every milestone kickoff
prompt; encoding it in workflow.md (universally required reading, D-023) reduces the
prompt to naming the milestone and makes the collaboration contract reviewable and
evolvable like everything else.
**Consequences:** workflow.md gains the "Milestone work: tech-lead mode" section;
kickoff prompts need no process language.
**Reopen if:** orchestration tooling changes materially (e.g., per-subagent isolated
worktrees become standard, relaxing the serial-writers rule).

## D-025: In-game benchmark mode is a public front end to the harness  (2026-07-12, accepted)
**Decision:** Parallax ships a benchmark mode that runs the same versioned,
deterministic scenarios and consumes the same telemetry/result schema as the automated
harness. It is launched and run **entirely in-game**: scenario control, warm-up,
repeats, measurement-window boundaries, metric collection, aggregation, environment
capture, and result export require no external automation. It provides fixed
quality/resolution controls, seed and camera/input path, warm-up and repeat policy, and
exports both machine-readable JSON and a human-readable summary. Results identify the
exact game artifact, scenario, browser/engine version, OS, GPU/driver, display/power
state, and metric support. It reports distributions and phase timings, not a synthetic
single score. External automation may navigate to or start benchmark mode and collect
the finished artifact for CI, but stays outside the measured path; a manually launched
run is equally valid under the same eligibility rules. The mode is usable in other
browsers for engine comparisons, but Chrome on the reference machines remains the only
budget gate; non-Chrome runs are advisory. Benchmark mode adds no compatibility paths:
an unchanged build either runs, marks individual metrics `unsupported`, or produces a
capability-failure result identifying the missing surface.
**Context:** The harness is already an independently useful deliverable and the game
already needs deterministic flythroughs, stable telemetry, environment identity, and
repeat/variance rules. Exposing those through the game makes Parallax useful for
comparing browser engines and hardware without building a second measurement system.
A single score would conceal whether a difference came from presentation pacing, CPU,
GPU, streaming, compilation, or unsupported observability, undermining the project's
attribution goal. Cross-browser measurement is not cross-browser support (D-002).
**Consequences:** the M0 result contract stays browser-engine-neutral even though the
automation initially drives Chrome; its schema includes provenance distinguishing
in-game measurements from optional launcher/collector timings. M1 exposes the canonical
D1 flythrough as a self-contained in-game benchmark; later canonical scenarios join it
as they land. Public results are comparable only when artifact, scenario, settings, and
environment fields match, and unsupported metrics remain visible rather than being
imputed.
**Reopen if:** the in-game runner cannot reproduce harness scenario semantics closely
enough to compare results; keep the export/telemetry UI but label manual runs separately.

## D-024: Uninstall joins the lifecycle — confirmed, dual-mechanism, measured  (2026-07-12, accepted)
**Decision:** The install/launch/run/update lifecycle gains a fifth stage, **uninstall**,
in scope for M2. The app shell (D-012) offers user-initiated uninstall behind an
**explicit confirmation** that states what will be deleted (installed assets, caches,
service worker, saves) and offers save export first (architecture.md's
export-before-destructive-storage-op rule). Two mechanisms are built and measured
against each other: (1) **client-side teardown** — service-worker unregister, OPFS
clear, Cache Storage + IndexedDB deletion, quota-release verification via
`navigator.storage.estimate()`; (2) a **`Clear-Site-Data` endpoint** — a static nginx
location (`/uninstall`) attaching `Clear-Site-Data: "storage", "cache"`, within D-011's
static-serving preference. Actual coverage of each is a measurement, not an assumption:
does `"storage"` clear OPFS; does `"cache"` clear the V8 code cache and GPU/shader
caches (which would also make the endpoint a useful harness "reset origin to cold"
primitive); asymmetries go to rough-edges.md. The Gemini Nano model is Chrome-managed
and browser-wide, not origin storage (D-017): uninstall does not remove it, and the
confirmation UX must not imply it does.
**Context:** A native-title lifecycle demo is incomplete if the only removal path is
digging through browser settings. Checked 2026-07-12 (MDN Clear-Site-Data reference;
web.dev OPFS article): MDN lists `"storage"` as clearing DOM storage incl. IndexedDB
and service-worker registrations — OPFS not explicitly named — and `"cache"` as
clearing cached data incl. script and shader caches; web.dev states OPFS is deleted
when site data is cleared. That documentation gap is itself why coverage gets measured
locally (root rules 3/10) rather than trusted.
**Consequences:** architecture.md lifecycle stage 5; plan.md M2 uninstall item;
features.md install-lifecycle row includes uninstall; harness gains an
uninstall-verification check (storage actually released).
**Reopen if:** measurement shows one mechanism strictly dominates — collapse to it then
and record the numbers.

## D-023: Context-lean doc policy — on-demand doc map, scan-first logs, decision culling  (2026-07-12, accepted)
**Decision:** Agent context is managed pull-based, not push-based. (1) Root AGENTS.md's
"required reading" mandate (vision + architecture + workflow before any non-trivial
work) is replaced by a **doc map**: workflow.md stays universally required (~30 lines);
every other doc is read on demand, routed by a one-line "read when the task needs"
description. (2) decisions.md and rough-edges.md are **scan-first** documents: grep or
scan headings, read only relevant entries; full reads reserved for structural or
cross-cutting work. (3) decisions.md drops strict append-only in favor of **periodic
culling**: superseded or moot entries that no longer inform anything current are
deleted; git history is the archive; D-numbers are never reused. (4) New root rule 9:
root AGENTS.md is the only always-loaded file, so it stays lean — detail belongs in
docs/ behind the map.
**Context:** Every conversation pays for what's mandated up front. The old blanket
mandate cost ~300 lines/~23 KB per task, mostly unread-in-anger; decisions.md (400+
lines, growing weekly) made "read it before structural changes" increasingly expensive.
**Consequences:** Root AGENTS.md restructured (doc map section, new rule 9, later rules
renumbered — the technology-claims rule is now rule 10); decisions.md header documents
the reading and culling policy; architecture.md's "required reading for every agent"
self-description softened to match.
**Reopen if:** on-demand reading measurably causes agents to miss constraints they'd
have caught under mandatory reading — tighten the map's routing lines first, the
mandate only as a last resort.

## D-022: Publish script retired; placeholder landing page frozen as published  (2026-07-12, accepted; amends D-021)
**Decision:** The machine-local `publish.ps1` from D-021 is deleted (along with the
`.gitignore` whose only entry it was). The static landing page was published once to
parallax-web.com (2026-07-12) and is intentionally **frozen** — it will not be updated
(not even milestone status) between now and M2. `site/` stays in the repo as the
versioned source of what is live. When M2's harness-owned production deployment lands
(D-011), the game's own landing page replaces the placeholder, and the harness pipeline
becomes the origin's only publish path — no separate site-publishing mechanism returns.
Should the placeholder need an emergency fix before then (broken link), that's an ad-hoc
manual `scp` to `/var/www/parallax-web.com`, acceptable at its expected frequency of
approximately zero.
**Context:** Maintaining a machine-specific deploy script for a page that will never
change is upkeep with no benefit, and keeping it invited scope creep (publishing
in-progress game builds through it, which would bypass the versioned, measured deploy
path the M2 research requires — deploying the game *is* the experiment, so it must go
through the harness).
**Consequences:** `publish.ps1` and `.gitignore` deleted; plan.md M0 item reworded.
D-021's publish-script provisions no longer apply; its `site/` placement and
distinct-from-`app/` framing stand.
**Reopen if:** the placeholder turns out to need recurring updates before M2 exists.

## D-021: Public landing page in top-level `site/`; machine-local publish script  (2026-07-12, accepted; publish-script provisions amended by D-022)
**Decision:** The project gets a public face in M0: a static landing page (what Parallax
is + a link to the GitHub repo, https://github.com/pmeenan/parallax) living in a new
top-level `site/` directory. `site/` carries project-facing web content only — plain
static HTML/CSS with no build step, no engine or game code — and is distinct from the
app shell (`app/`, D-012), which is the installer/boot/launch entry point of the game
itself. Publishing to production (`/var/www/parallax-web.com` over SSH per D-011
hosting) is done by a machine-local `publish.ps1` at the repo root that copies `site/`
via OpenSSH `scp` (key-based auth through a local `parallax` SSH host alias). The script
is **gitignored**: it encodes one machine's SSH configuration, not project
infrastructure. It is an explicit stopgap — when M2's production-deployment work lands
(versioned nginx config, harness-driven deploys, D-011), site publishing folds into that
pipeline.
**Context:** A public description of the project is wanted before M2's production
serving exists. `scp` over the Windows built-in OpenSSH client was chosen over
WSL-hosted `rsync` to avoid a WSL dependency for a copy of a handful of static files
(verified working against the server on 2026-07-12).
**Consequences:** Root AGENTS.md layout table gains `site/`; plan.md M0 gains a
landing-page item; `.gitignore` created with `publish.ps1`. The landing page is
plain static content — the header discipline / COOP-COEP requirements of D-011 apply to
the game's serving, and are unaffected by it.
**Reopen if:** the site needs a build step or more than a few pages, or when the M2
deployment pipeline exists — supersede with a unified publish path then.

## D-020: Toolchain refinements — Rollup, exact pins, reproducibility levels  (2026-07-11, accepted; supersedes D-014; currency cadence added by D-079)
**Decision:** As D-014, with three refinements. (1) The engine library bundler is
**Rollup** (chosen over esbuild for deterministic, timestamp-free output; exact version
pinned in the lockfile). (2) Pinning is by **exact version** everywhere (`.nvmrc` +
`packageManager` — "LTS" is a policy, the pin is a version); builds normalize locale,
timezone, and path inputs. (3) Playwright drives the pinned Chrome for Testing binary
for gate runs and `channel: 'chrome'` (installed branded stable) for parity smokes —
see D-019. **Reproducibility levels (ties to D-010):** (1) *repeatable* — same-host
double-build hash check, required from M0; (2) *reproducible* — cross-host
bit-identical builds (dev-01 ↔ mac-01), required before the M8 COS exercise, likely
needing a hermetic/containerized build definition; (3) *canonical* — published engine
artifacts that platform publishers consume rather than rebuild, the end-state COS
actually needs (hash-sharing works even if independent rebuilds don't match, because
nobody rebuilds). Level 3 is the fallback if level 2 proves impractical.
**Context:** Review found D-014 left the bundler ambiguous and "repeatable vs.
reproducible vs. canonical" undefined, which D-010's cross-publisher hash-sharing goal
requires.
**Consequences:** M0 scaffolds to this shape; D-010's hash check targets the Rollup
engine artifact.
**Reopen if:** any component proves inadequate in practice — supersede, don't drift.

## D-019: Chrome pinning mechanism — Chrome for Testing archives  (2026-07-11, accepted; supersedes D-013)
**Decision:** As D-013 (stable-only targeting; Canary solely for Chrome-side changes,
always labeled), with the operational mechanism defined: reproducible runs (budget
gates, cross-machine determinism, baselines) use archived **Chrome for Testing**
binaries pinned to the current stable milestone — versioned, non-auto-updating,
retained per platform so any past result can be re-run. A periodic parity smoke run on
the real installed stable channel guards against CfT-vs-branded divergence (any
divergence found is a finding). **"Same version" across platforms** means same
milestone + V8 revision — platform build/patch numbers may legitimately differ.
**Context:** D-013's "pinned per run" was aspirational: installed branded stable
auto-updates independently and cannot serve reproducible baselines or the M3
cross-machine determinism criterion.
**Consequences:** harness/AGENTS.md rule 1 and machines/README.md updated; budgets.md
baseline-promotion policy operates on CfT milestone advances.
**Reopen if:** a committed feature needs an API that hasn't reached stable, or CfT
proves behaviorally divergent from branded stable in a way that matters to findings.

## D-018: Hardware gates — capable-consumer baseline; Showcase calibrated to dev-01; Standard gate is a target profile  (2026-07-11, accepted; Standard-gate provisions superseded by D-150; supersedes D-009's hardware/tier provisions)
**Decision:** D-009's install-scale provisions stand unchanged (≤ 12 GB experiment
content; ≥ 100 GB architecture floor, not ceiling; synthetic scale tests). Its hardware
and tier provisions are replaced:
- Hardware baseline is **capable consumer hardware** (not "gaming rig"); low-end and
  mobile stay out of scope.
- **Showcase** — 4K, gated on and **calibrated to dev-01 itself** (i9-14900KF, 128 GB,
  RTX 4080 Super 16 GB, 4K @ 60 Hz display, Chrome/D3D12). The abstract 16 GB RAM /
  12 GB GPU reference machine is retired: envelope enforcement on dissimilar hardware
  cannot prove transfer, and the transfer story belongs to the Standard tier. Showcase
  envelopes: GPU ≤ 14 GB, CPU-side ≤ 16 GB — provisional ceilings, rebalanceable within
  the envelope by decision-log note. (These ceilings do not by themselves exercise
  wasm64 — D-117 later resolved P-001 with no current adoption; aggregate envelopes
  still cannot justify a wider single-module address space.)
- **Standard** — 1440p @ 120 Hz, defined by the **standard-target profile**: M1 Pro
  MacBook Pro (2021), 16 GB unified memory, ProMotion. This is a *profile, not a pinned
  machine*: it registers as `standard-01` only when the physical unit is recorded with
  exact model/size, GPU-core configuration, display mode with verified 120 Hz behavior
  under Chrome, and OS build. Until then Standard runs execute on dev-01 with envelope
  enforcement, labeled provisional, and satisfy no Standard-tier exit criteria.
- The two gates intentionally span Dawn's Metal and D3D12 backends. Quota reality
  (correcting D-009): a Chromium origin may use up to ~60% of **total** disk size, and
  `estimate()` can over-report writable space — preflight is best-effort; the guarantee
  is `QuotaExceededError`-aware incremental writing with resume.
**Context:** Review rounds found D-009's 16/12 reference contradicted by dev-01's
actual hardware, the free-disk quota claim wrong against current docs, and the Standard
machine underspecified.
**Sources checked (2026-07-11):** web.dev/articles/storage-for-the-web + MDN storage
quota docs (total-disk quota, `estimate()` caveats); user-confirmed machine facts
(dev-01 display 4K @ 60 Hz; Standard profile M1 Pro/120 Hz).
**Consequences:** budgets.md hardware-baseline, quality-tier, frame-gate (per-tier,
refresh-quantized), and memory-envelope sections; harness/machines/README.md.
**Reopen if:** a physical Standard machine is registered (records specs, no new entry
needed); or a mid-range Windows rig joins the fleet and a transfer-focused Showcase
variant becomes worth gating.

## D-017: Prompt API operational model — window broker, activation-correct download, authored fallback  (2026-07-11, superseded by D-096; supersedes D-007)
**Decision:** As D-007 (Prompt API for NPC dialog; schema-gated state effects), with
the operational model corrected against current platform behavior:
- The Prompt API is **not available in Web Workers**, so inference runs as a
  **window-owned broker** behind a worker-shaped `engine/ai` interface (migrates when
  worker support lands); broker main-thread impact is a mandatory harness metric.
- Model download starts **directly in the install-button click handler** —
  `LanguageModel.create()` is called within the transient-activation window and
  downloads in parallel with the asset pull (transient activation expires in seconds;
  it does not survive a multi-GB install). Model size varies by version — never
  hardcoded; download requires ~22 GB free on the profile volume.
- **Eviction policy:** Chrome may evict the model under storage pressure. Every NPC
  carries authored fallback dialog; the game stays fully playable offline with reduced
  conversational depth; restoring the model **requires a fresh user gesture** (the
  launch screen offers a "restore AI dialog" action when online — it cannot be
  automatic); evictions are logged as findings.
**Context:** D-007 assumed an `ai worker`, a fixed ~4.3 GB model, and
activation-at-install-time — all contradicted by current documentation and
transient-activation semantics.
**Sources checked (2026-07-11, Chrome 150 era):** developer.chrome.com/docs/ai/prompt-api
(worker unavailability, user activation, 22 GB requirement, variable model size); MDN
transient-activation semantics. M0 spike re-verifies locally.
**Consequences:** no `ai worker` in the topology; fallback lines are part of every
persona card from M3; quest-critical interactions never require the model.
**Reopen if:** worker support lands (move the broker; new entry), quality is unusable
for even constrained NPC dialog, or session limits make per-NPC state impractical
(either outcome is itself a finding).

## D-016: Multiplayer infrastructure and determinism scope  (2026-07-11, accepted; cross-machine verification gate superseded by D-150)
**Decision:** M7 multiplayer means **reliable internet co-play**: self-hosted signaling
on the D-011 host and STUN are permitted; TURN relay is permitted if measured direct-
connectivity failure rates warrant it. "Serverless" in project language means **no
game-simulation servers** — peers run the sim; infrastructure is limited to connection
establishment/relay. **Determinism scope:** cross-machine within a pinned Chrome
version — same command log ⇒ same state hash across OS/CPU (dev-01 Windows ↔ mac-01
macOS), verified by the harness from M3. Chrome-only helps: one engine (V8), one wasm
runtime; the sim additionally avoids known nondeterminism sources (unseeded RNG,
wall-clock, iteration-order, NaN-bit-pattern-sensitive wasm paths).
**Context:** Real-world WebRTC requires signaling and frequently TURN
(webrtc.org/getting-started/turn-server, checked 2026-07-11); a single-host determinism
check says nothing about cross-peer lockstep suitability.
**Consequences:** features.md multiplayer wording qualified; M3 determinism exit
criterion is cross-machine; offline single-player continues to require zero server
infrastructure.
**Reopen if:** cross-machine determinism proves unachievable at reasonable cost (then
choose rollback/authoritative-state sync over lockstep at M7 — log the evidence).

## D-015: Service worker owns the offline app shell  (2026-07-11, accepted)
**Decision:** A service worker precaches the app shell and serves navigations offline,
with atomic activation + rollback and boot-time version-compatibility checks
(shell/engine/manifest/save schema). Cached navigation responses must preserve
COOP/COEP (verified by harness) or SAB dies offline.
**Context:** The HTTP cache alone does not guarantee offline navigation — eviction is
permitted and navigation needs a controlled response source
(web.dev/articles/service-worker-caching-and-http-caching, checked 2026-07-11). The
offline-launch budget was unimplementable without this.
**Consequences:** SW lifecycle in architecture.md; M2 offline fault suite (offline hard
reload, restart, corrupt cache, interrupted update, disk-full); SW-vs-V8-code-cache
interplay pre-seeded as a rough-edges question (wasm/JS should stay HTTP-cache-served
for code-cache friendliness where possible — measure, don't assume).
**Reopen if:** SW-served responses measurably break V8 code caching for the shell and
no split-serving arrangement resolves it (that's a headline finding).

## D-014: Toolchain  (2026-07-11, superseded by D-020)
**Decision:** pnpm workspaces monorepo (`app`, `engine`, `game`, `harness` packages);
TypeScript strict with project references (references enforce the layer import
direction at compile time); Vite for dev server/HMR and app/game builds; the engine
bundle built as a separately versioned library artifact (Rollup or esbuild) as the
target of D-010's double-build hash check; Node LTS + pnpm pinned (`packageManager`
field + `.nvmrc`); Rust pinned via `rust-toolchain.toml` with wasm-bindgen, pinned
binaryen/wasm-opt, and `--remap-path-prefix`; Vitest for unit tests; Playwright
(`channel: 'chrome'` — drives installed stable Chrome per D-013) as the harness browser
driver with raw CDP as the escape hatch; Biome for lint+format.
**Context:** Determinism (D-010) and agent iteration speed drive every pick.
**Consequences:** M0 scaffolds to this shape.
**Reopen if:** any component proves inadequate in practice — swaps are expected to be
cheap early; supersede with a new entry, don't drift silently.

## D-013: Harness targets Chrome stable; Canary only for Chrome-side changes  (2026-07-11, superseded by D-019)
**Decision:** All harness runs and budgets target **Chrome stable** (pinned per run,
recorded in results). Canary/dev channels are permitted only when testing Chrome-side
changes (e.g., COS work), always labeled as such and never mixed into stable baselines.
**Context:** Nothing in the current feature matrix requires pre-stable APIs; stable
keeps findings maximally credible/reportable.
**Reopen if:** a committed feature needs an API that hasn't reached stable.

## D-012: App shell lives in top-level `app/`  (2026-07-11, accepted)
**Decision:** The installer/boot/launch shell is a top-level `app/` package — the entry
point that drives install/update UX and boots the engine + game. It imports `engine/`
services (storage, install, telemetry) and may use branded assets from the asset
library, but contains **no gameplay logic or game rules**.
**Context:** The shell is the core loader, not part of the game; it also carries the
lifecycle UX that M2's research lives in, so it deserves first-class structure. Using
game-branded visuals doesn't make it game logic — assets come from the library like any
consumer.
**Consequences:** root AGENTS.md layout table; layer rules extended: `app/` may import
`engine/` (and game manifest/branding data), never `game/` sim internals.

## D-011: Deployment — parallax-web.com on self-controlled nginx; local-first dev  (2026-07-11, accepted)
**Decision:** Production origin is **https://parallax-web.com**, served from
user-controlled hosting (nginx, direct SSH). Additional owned domains are available for
cross-origin work when needed (M8 COS exercise, multi-origin probes). Development runs
fully local against a real local server (never `file://`), with the same header
discipline (COOP/COEP, immutable caching, 304 behavior) as production. Static/
client-side is strongly preferred; the server may exceed static hosting only when a
finding requires it (e.g., signaling for M7), logged here when it happens. Serving
config (nginx + local dev server headers) is versioned in the repo (location settled in
M0). Cloudflare is available but stays **out of the path for cache experiments** unless
it is itself the subject — an intermediary cache would contaminate 304/code-cache
findings.
**Context:** M2's cache research is only credible against real serving infrastructure;
the harness needs both local and production targets.
**Consequences:** M0 builds the local server + header discipline; production serving
lands before M2 cache work; harness runs record which target they measured.
**Reopen if:** hosting constraints prevent required header/protocol control.

## D-010: COS-ready packaging — common/game split, deterministic versioned engine builds  (2026-07-11, accepted)
**Decision:** The isolation model for the north-star platform is **cross-origin
isolation with sharing via Cross-Origin Storage (COS)**: each published game is its own
origin; engine code, shared asset packs, AI models, and (as the platform work matures)
code/Dawn caches are shared across origins by content hash. COS APIs don't exist yet, so
Parallax builds **COS-ready now**:
1. All packaged resources are split into **common** (engine code, shared asset packs,
   kits) and **game-specific** (world data, game logic, unique assets) — separate
   bundles, separately addressed in the manifest — so the common set can move to a
   hash-based COS index without repackaging.
2. **Engine builds are deterministic and versioned:** same source + toolchain ⇒
   byte-identical artifacts (pinned toolchain, no embedded timestamps/build paths,
   stable chunking/minification), because hash-based sharing only works if two
   publishers building the same engine version produce the same bytes. Engine artifacts
   carry explicit versions and never mix game code (the existing layer boundary, now
   also a packaging boundary).
**Context:** User's Chrome-side COS work targets exactly this sharing (including code
caches). Parallax is the realistic consumer that proves the packaging discipline and
quantifies the win.
**Consequences:** Build pipeline emits engine and game bundles separately (M0);
manifest schema distinguishes common vs. game-specific from day one (M2); engine/
AGENTS.md build-determinism rules; the other platform-of-games probes (multi-game quota
contention, instant-play, origin-model comparison) are **dropped from scope** — the
origin model is decided by this entry, and the rest isn't needed for this exploration.
**Reopen if:** COS's shipped shape diverges from hash-based content addressing, or
deterministic builds prove impractical for some artifact class (log why — that's a
finding about the sharing model's feasibility).

## D-009: Install scale — 12 GB content, ≥100 GB architecture floor; gaming-rig baseline; 4K showcase tier  (2026-07-11, hardware/tier provisions superseded by D-018; install-scale provisions remain in force per D-018)
**Decision:** The two-district experiment ships ≤ 12 GB of content, but every lifecycle
system (manifest, resumable install, integrity, update, streaming/eviction) must support
**at least** 50–100 GB installs — a floor, not a ceiling; no architectural limit may
exist short of disk/OPFS quota. Verified by a synthetic-asset scale test in the harness
(M2), grown until it finds a platform limit or proves there isn't one. Hardware baseline
is a **gaming rig** — low-end devices are out of scope for this experiment (hardware is
an evolving target; the question is what the platform supports given sufficient
hardware). Rendering budgets are tiered: Standard (1440p, gaming-rig baseline) and
Showcase (4K photorealistic, high-end rig), each independently held to frame budgets.
Showcase reference machine: **16 GB system RAM, 12 GB GPU**; showcase memory budgets are
envelope-based (CPU-side ≤ 9 GB, GPU ≤ 10 GB, with OS/browser/compositor headroom
reserved), and the category split inside an envelope may be rebalanced as measurements
come in, with a decision-log note.
**Context:** The project must demonstrate that the web can host super-detailed,
photoreal titles at real AAA-and-beyond install sizes, not just that a 12 GB demo fits.
Testing scale synthetically decouples the architecture proof from content production.
**Consequences:** budgets.md hardware-baseline, quality-tier, and scale-test sections;
pre-install quota check and failure UX designed for ≥100 GB against OPFS's
~60%-of-free-disk quota; per-tier harness runs on both reference machines; memory
budgets in budgets.md are calibrated to the gaming-rig baseline, not lowest-common
hardware.
**Reopen if:** OPFS quota or install-time realities cap installs below ~100 GB on a
gaming rig (that outcome is itself a headline rough-edges finding).

## D-008: Two districts, surface + underground, designed for N  (2026-07-11, accepted)
**Decision:** World ships with District 1 (surface) and District 2 (underground),
connected by choke-point hard transitions. All world/streaming/save code treats district
count and topology as data.
**Context:** Two districts are the minimum to exercise inter-district streaming, which
fundamentally shapes asset packaging and the streaming manager. Underground as D2 gives a
natural full-occlusion boundary — the hardest streaming case (total resident-set swap)
without requiring horizon-scale streaming first.
**Consequences:** Transition contract in budgets.md; D2 exercised in greybox (M4) before
any art exists for it.
**Reopen if:** never for the design-for-N property; district count/theme may change freely.

## D-007: NPC dialog via Chrome built-in Prompt API (on-device Gemini Nano)  (2026-07-11, superseded by D-017)
**Decision:** NPC conversation uses Chrome's Prompt API; model download is an
install-phase step. Structured-output JSON schemas gate anything that affects game state.
**Context:** Shipped in Chrome 148 for web pages. The ~4.3 GB model download is
disqualifying for normal sites but folds naturally into our install model — and it is
exactly the kind of capability this demo exists to showcase.
**Consequences:** `ai worker` in the topology; inference/render contention is a standing
measurement target; NPC design must tolerate nano-class model quality.
**Reopen if:** quality is unusable for even constrained NPC dialog, or the API's session
limits make per-NPC state impractical (either outcome is itself a finding).

## D-006: Asset formats — glTF/GLB, KTX2 (BasisU), meshopt; content-addressed per-cell bundles  (2026-07-11, accepted; technology claims re-grounded by D-089)
**Decision:** Packaging is per streaming cell with shared kits deduplicated. Geometry is
glTF/GLB with optional `KHR_draco_mesh_compression` or `EXT_meshopt_compression`;
textures use KTX2 through `KHR_texture_basisu`. D-089 owns exact decoder pins, module-
worker injection, fixtures, and Lite's canonical single-buffer meshopt constraint.
**Context:** The Khronos extension specifications define the interoperable compressed
payloads; the exact pinned Babylon Lite source and D-089's Chrome fixture establish the
implemented subset. Content addressing enables asset-only updates that do not change
code artifacts. Sources rechecked 2026-07-20: Khronos `KHR_texture_basisu`,
`KHR_draco_mesh_compression`, and `EXT_meshopt_compression` specifications plus the
installed Babylon Lite 1.12.0 loaders; no broader “native Babylon.js” claim is relied on.
**Reopen if:** harness shows decode/transcode dominating cell-load p95.

## D-005: Multithreading via explicit worker topology (SAB + OffscreenCanvas + WebGPU-in-worker)  (2026-07-11, accepted; the "no engine ships web multithreading" claim below is corrected by D-046 — Unity 6.4 ships Burst/Job-System threads; the decision is unaffected)
**Decision:** Parallax designs its own thread architecture (see architecture.md) rather
than inheriting an engine's. Rust→WASM modules (with wasm threads) for compute-heavy
paths.
**Context:** No popular engine ships real multithreading on the web today; on this
platform, threading is an application architecture. Owning the topology is also where
much of the platform research lives.
**Sources checked (2026-07-11):** Unity web technical limitations (docs.unity3d.com —
no managed C# threads on web), Bevy wasm multithreading tracking issue
(github.com/bevyengine/bevy/issues/4078), Godot web export docs; M0 spikes re-verify
WebGPU-in-worker and SAB channels locally.
**Consequences:** COOP/COEP required everywhere, including the harness's serving
infrastructure; every queue/boundary instrumented.
**Reopen if:** WebGPU-in-worker or Babylon-in-worker spikes (M0) fail — fallback is
render on main thread with everything else in workers, logged as a major finding.

## D-004: Engine — TypeScript + Babylon.js (WebGPU only); not Unity, Godot, Bevy, or from-scratch  (2026-07-11, accepted except classic-Babylon component superseded by D-078; technology claims re-grounded by D-046 and evidence consolidated by D-076)
**Decision:** Babylon.js as scene/material/animation core; Parallax owns scheduling,
streaming, memory, and the worker fabric. WebGPU backend exclusively — no WebGL2 path.
**Context:** Unity's web export blocks the project's core needs (no C# threads on web,
experimental WebGPU backend, unconfirmed wasm64) and hides the platform behind an opaque
layer, breaking finding-attribution. Godot/Bevy web paths are experimental or
single-threaded (as of 2026-07). Babylon has years-mature WebGPU support, is fully
inspectable, and is the strongest AI-agent target (TypeScript, instant iteration, no
editor round-trips). From-scratch rejected: scene graph/materials/animation/glTF are
solved problems that don't advance either goal.
**Sources checked (2026-07-11):** Unity WebGPU manual (experimental status), Unity web
technical limitations, Godot 4.7 web export status (WebGPU experimental behind flag),
Bevy WebGPU/wasm-threading issues, Babylon.js WebGPU support docs
(doc.babylonjs.com/setup/support/webGPU).
**Consequences:** We hand-build LOD, occlusion/culling, and world partitioning — accepted
because those systems had to be browser-custom anyway and building them *is* the
research. Where Babylon blocks a WebGPU feature: fork locally or bypass, and log the gap.
**Reopen if:** Babylon proves unable to run in a worker or blocks required WebGPU
features at a structural level; Bevy becomes interesting if/when wasm multithreading
lands there.

## D-003: Install/launch/run lifecycle; OPFS as primary asset store  (2026-07-11, accepted)
**Decision:** The game is an installed application: user-initiated multi-GB install into
OPFS, offline-capable, warm-launch optimized. Storage map in architecture.md; placement
is benchmark-driven per asset class.
**Context:** Origin ideation (docs/history/); OPFS gives worker-side sync access handles
and quota headroom for multi-GB installs.
**Sources checked (2026-07-11):** web.dev/articles/storage-for-the-web + MDN storage
quota docs (~60% of total disk per origin; `estimate()` caveats; `persist()` semantics
— protects the origin, not specific files). Offline shell requires a service worker on
top of this — see D-015. M0 OPFS throughput spike verifies read performance locally.
**Reopen if:** harness shows a better-performing store for a given asset class (move it,
log numbers here).

## D-002: Chrome-only, latest stable or newer; no fallbacks  (2026-07-11, accepted)
**Decision:** Target the newest Chrome (including Canary/Origin-Trial features when
needed). No Firefox/Safari support, no WebGL2 fallback, no compat shims. Missing API =
logged finding, not a workaround.
**Context:** The project is partly a Chrome capabilities demo and rough-edges probe;
compatibility layers would blur attribution and cap the ceiling.
**Reopen if:** project goals change to include distribution beyond the demo audience.

## D-001: Working name "Parallax"  (2026-07-11, accepted)
**Decision:** Project/repo name is Parallax.
**Context:** docs/history/name_history.md. Known minor collisions (a Skyrim texture mod,
a small portfolio site) judged negligible.

---

## Proposed / open

*(Move to accepted with a date when resolved; spikes in plan.md M0 feed these.)*

- **P-003: Multiplayer topology** — pure P2P mesh vs. host-authoritative peer for the
  M7 exploration. Decide when M3 determinism results are in.
- **P-004: Binary asset storage** — git LFS vs. external content store + manifest for
  `assets/source/` and `assets/library/`. Decide when the first real (non-greybox)
  assets exist (M5 at the latest).
- **P-006: Storage Buckets for saves vs. assets** — whether separating critical saves
  from replaceable assets into distinct buckets (with different eviction/durability
  characteristics) buys real protection beyond origin `persist()`, or is complexity
  without benefit. Decide during M2 with measurements; interim protection is origin
  persistence + explicit save export (architecture.md).
*(P-008, game UI substrate, was resolved by D-160: render world anchors and heavy
screens in-canvas, and HUD/dialog in DOM/CSS.)*
*(P-007, app-owned NPC inference vs. Prompt API, was resolved in favor of the measured
app-owned backend by D-096 after D-074's phase-A qualification.)*
*(P-002, geometry representation, was resolved by D-098: retain the incumbent triangle
LOD path because neither bounded challenger supplied fully eligible displacement
evidence; this was not a valid triangle-performance win.)*
*(P-005, toolchain, was accepted as D-014 and refined by D-020.)*
