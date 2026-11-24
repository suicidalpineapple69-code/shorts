# Which Armor Will Save Him?

A 34.5 s Teardown-style voxel Short (1080x1920, 30 fps). A moss golem destroys a blocky hero seven
times, each time in a stronger armor tier. A chestplate HUD crosses off each tier that fails and a row
of hearts drains on every hit. The last tier, obsidian, survives with half a heart and the hero
shatters the golem with one punch. The format follows popular "which armor survives" voxel-physics
Shorts. The hero, golem, world, HUD art, music and sound effects are all original and generated in code.

```sh
armor/make.sh preview   # half-res, 15 fps  -> out/armor_preview.mp4  (~4 min)
armor/make.sh           # final, 30 fps      -> out/armor.mp4          (~15 min on 4 cores)
node render/render.mjs --project armor --scale 0.5 --stills 4.5,12.9   # single frames -> build/armor/stills/
```

| File | What it does |
| --- | --- |
| `plan.js` | Edit plan: armor tiers, round timings, hits and hearts left, HUD hearts curve, sound cues |
| `acting.js` | Golem keyframes (IK hand/foot targets, lean, hips), camera moves per round |
| `voxel.js` | Voxel grid, chunked mesher with ambient occlusion, small voxel models |
| `models.js` | Floating island + ravine + stone wall + trees, the hero (6 parts + armor shell), the golem |
| `main.js` | Scene, two-bone IK rig, hero animation, crater carving, debris/blood/body physics, dust, camera |
| `hud.js` | Pixel chestplates with red X stamps, hearts bar, round labels, title and ending |
| `export.mjs` | Writes `build/armor/timeline.json` (duration + sound cues) |
| `compose.py` | 120 BPM phonk-style beat in E minor + every effect, ducking and limiter -> `build/armor/mix.wav` |

The physics is deterministic: it re-simulates from zero if a frame earlier than the last one is
requested, so stills and split renders (`--jobs 2`) give the same result.

## Upload kit

**Title:** Which Armor Will Save Him? 🛡️  (or: Only ONE Armor Survives This Golem…)

**Description**
```
7 armors. 1 giant golem. Only one survives 💀
Leather, Copper, Gold, Chainmail, Iron, Diamond or Obsidian?
Which one would YOU pick? 👇

#minecraft #teardown #shorts #gaming #physics
```

**Pinned comment:** `Diamond should NOT have lost that 💀 which one would you pick?`
