# NASA Blue Marble and GEBCO topography — provenance

Raw rasters used by `map-generator/cmd/satellite` to build the realistic
terrain of the six Natural Earth maps (`naturalearthworld`,
`europemediterranean`, `northamericacaribbean`, `naturalearthsouthamerica`,
`africamiddleeast`, `asiapacific`). They are not committed; download them
into the ignored `map-generator/.cache/nasa/` and check the hashes.

Downloaded 2026-09-27 from NASA Earth Observatory / Visible Earth
(`https://eoimages.gsfc.nasa.gov/images/imagerecords/`):

| File (record)                                                        | Bytes    | SHA-256                                                            |
| -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `73000/73751/world.topo.bathy.200407.3x21600x10800.jpg`              | 27201049 | `d225f1f35a6448a4d1d8f6de6e48f3433e470085b70a35800e64f384f269a7b0` |
| `73000/73751/world.topo.bathy.200407.3x21600x21600.A1.jpg`           | 54085715 | `cda310b5a180c7a7da95a605bc3a3a3fa082ecf870e0d9ea48994813216bcb70` |
| `73000/73751/world.topo.bathy.200407.3x21600x21600.B1.jpg`           | 54665612 | `15d8ceb55676e6b3e7fdcd72217d1edd665b5e7f7396c606e7b98c427b28558e` |
| `73000/73751/world.topo.bathy.200407.3x21600x21600.C1.jpg`           | 87763762 | `ee8490ab1eb35d620d8d1ad8e69b3234c0b050e4eddb80e7232a2d165e475aa0` |
| `73000/73751/world.topo.bathy.200407.3x21600x21600.D1.jpg`           | 68470337 | `47480a4e98289d830adc689c32356771a83cd55a003cdbf32db7ade2a6609b56` |
| `73000/73751/world.topo.bathy.200407.3x21600x21600.A2.jpg`           | 24327568 | `1f0b66979774a6a5704d6e597024e80b9e1fe71ab64ca871d195763ae625ad02` |
| `73000/73751/world.topo.bathy.200407.3x21600x21600.B2.jpg`           | 46982733 | `37ce4c49ff093781eb1da10c14876cea317dfdf4d93af44d8e0c3b394bcd86d7` |
| `73000/73751/world.topo.bathy.200407.3x21600x21600.C2.jpg`           | 39543838 | `3237e61c6ed8eaab15d7cdf797b6de3ee5c62314aa05381478b76dabcba2660b` |
| `73000/73751/world.topo.bathy.200407.3x21600x21600.D2.jpg`           | 43643468 | `6883c2d0141b8165e0c336a3df7535bd494d56e75b0d1bce6d25719644237ea5` |
| `73000/73934/gebco_08_rev_elev_21600x10800.png`                      | 18414843 | `4a70590d40dd7b9c69b9ab359d1dc4475ce97c1d2d13625223b248364112c699` |
| `73000/73963/gebco_08_rev_bath_21600x10800.png` (downloaded, unused) | 35097740 | `b3a67076fccfbee73ebe437fd66a8ed4969fbc5ce949033b50675d43f379e403` |

## Licence

- Blue Marble Next Generation: "NASA Earth Observatory image by Reto Stöckli,
  based on data from NASA and NOAA." NASA imagery is not copyrighted (NASA
  media usage guidelines); credit is given here, in `CREDITS.md` and in
  `THIRD_PARTY_NOTICES.md`. It may be used commercially; it does not imply
  NASA endorsement.
- Topography: NASA's rendering of the GEBCO 2008 grid (General Bathymetric
  Chart of the Oceans), free for any use with attribution to GEBCO.

## What is derived

1. `-mode relief`: the blue channel of each map's
   `map-generator/assets/maps/<map>/image.png` land pixels becomes
   `140 + 2 × magnitude`, magnitude from the elevation under the tile (mean
   pulled halfway to the highest point; 25 m per GEBCO step): 0–9 below
   500 m, 10–19 up to 1800 m, 20–30 above. Water pixels and the land/water
   mask are untouched, so coastlines, straits and nations stay exactly as the
   Natural Earth rasteriser drew them. The terrain generator then writes the
   runtime `map*.bin`, thumbnails and manifests.
2. `-mode imagery`: Blue Marble reprojected onto the tile grid at 8 texels
   per tile (world from the 1.85 km mosaic, regions from the 500 m tiles),
   coast pixels conformed to the game's land mask, written as
   `resources/maps/<map>/satellite/{index.json,overview.webp,tiles/*.webp}`
   (WebP q72).
