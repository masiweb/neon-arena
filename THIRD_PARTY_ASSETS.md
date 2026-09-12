# Third-party assets

Neon Arena ships all runtime assets locally. No model, texture, or engine file
is fetched from a CDN during play.

## three.js

- Version: 0.186.0
- Project: https://threejs.org/
- Source: https://github.com/mrdoob/three.js
- License: MIT
- Bundled license: server/static/assets/licenses/THREE-LICENSE.txt

## Toon Shooter Game Kit

- Creator: Quaternius
- Original pack: https://quaternius.com/packs/toonshootergamekit.html
- License: CC0 1.0 / public domain
- Files used: animated soldier, AK, SMG, shotgun, short cannon, rocket
  launcher, grenade, crates, barrel, sandbags, container, broken car,
  streetlight, trees, tires, and pallet.
- Retrieval mirror used during the build:
  https://github.com/Mtjan18/3DGameZombieShooter

The retrieval mirror is not treated as the licensing authority; the original
Quaternius pack page is the authoritative source for the CC0 release.

## ambientCG materials

- Source: https://ambientcg.com/
- License: CC0 1.0 / public domain
- Asset IDs: Asphalt031, Bricks051, Concrete034, Grass005, Ground054
- Distributed derivatives: resized WebP color, OpenGL normal, and roughness
  maps under server/static/assets/textures/.
