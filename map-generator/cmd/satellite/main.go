// Command satellite derives the realistic terrain assets of the six Natural
// Earth maps from public NASA data:
//
//   - relief:  writes real elevation (NASA / GEBCO 2008 topography) into the
//     blue channel of each map's source image.png, so the terrain generator
//     turns lowlands, highlands and mountain ranges into plains, highland and
//     mountain tiles. Land/water pixels are never changed.
//   - imagery: reprojects NASA Blue Marble Next Generation (July 2004,
//     topography + bathymetry) onto each map's tile grid, bends its coastline
//     to the game's own land mask (so a drawn beach is always a playable
//     tile), and writes an overview image plus 512-pixel detail tiles to
//     resources/maps/<map>/satellite/.
//
// The raw rasters are downloaded once into map-generator/.cache/nasa (see
// map-generator/sources/nasa-blue-marble/PROVENANCE.md). Run from the
// map-generator directory:
//
//	go run ./cmd/satellite -mode relief
//	go run . --maps=<the six maps> --terrain-only
//	go run ./cmd/satellite -mode imagery
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gen2brain/webp"
)

// Projection maps tile coordinates (tile centres at integers) to degrees.
type Projection interface {
	LonLat(tx, ty float64) (lon, lat float64)
}

// World: plate carrée over the whole globe, x = round((lon+180)(W-1)/360).
type worldProjection struct{ w, h int }

func (p worldProjection) LonLat(tx, ty float64) (float64, float64) {
	return tx*360/float64(p.w-1) - 180, 90 - ty*180/float64(p.h-1)
}

// Regions: linear lon/lat inside a 24-tile water margin.
type regionProjection struct {
	w, h                     int
	west, south, east, north float64
}

const edgeWaterMargin = 24

func (p regionProjection) LonLat(tx, ty float64) (float64, float64) {
	usableW := float64(p.w - edgeWaterMargin*2 - 1)
	usableH := float64(p.h - edgeWaterMargin*2 - 1)
	lon := p.west + (tx-edgeWaterMargin)*(p.east-p.west)/usableW
	lat := p.north - (ty-edgeWaterMargin)*(p.north-p.south)/usableH
	return lon, lat
}

type mapSpec struct {
	folder string
	width  int
	height int
	proj   Projection
	// World imagery comes from the 1.85 km mosaic; regions from the 500 m tiles.
	fullResolution bool
}

func specs() []mapSpec {
	region := func(folder string, w, h int, west, south, east, north float64) mapSpec {
		return mapSpec{folder, w, h, regionProjection{w, h, west, south, east, north}, true}
	}
	return []mapSpec{
		{"naturalearthworld", 2000, 1000, worldProjection{2000, 1000}, false},
		region("europemediterranean", 1600, 1100, -16, 28, 48, 72),
		region("northamericacaribbean", 1800, 1100, -172, 4, -48, 79),
		region("naturalearthsouthamerica", 1200, 1400, -94, -58, -30, 16),
		region("africamiddleeast", 1500, 1280, -27, -40, 66, 40),
		region("asiapacific", 1520, 1520, 54, -50, 180, 76),
	}
}

var (
	modeFlag    = flag.String("mode", "all", "relief | imagery | all")
	mapsFlag    = flag.String("maps", "", "comma-separated map folders (default: all six)")
	cacheFlag   = flag.String("cache", ".cache/nasa", "directory holding the NASA rasters")
	scaleFlag   = flag.Int("scale", 8, "detail texels per map tile")
	qualityFlag = flag.Int("quality", 72, "WebP quality of the imagery")
)

func main() {
	flag.Parse()
	selected := map[string]bool{}
	for _, name := range strings.Split(*mapsFlag, ",") {
		if name = strings.TrimSpace(name); name != "" {
			selected[name] = true
		}
	}
	for _, spec := range specs() {
		if len(selected) > 0 && !selected[spec.folder] {
			continue
		}
		start := time.Now()
		switch *modeFlag {
		case "relief":
			must(writeRelief(spec))
		case "imagery":
			must(writeImagery(spec))
		case "all":
			must(writeRelief(spec))
			must(writeImagery(spec))
		default:
			log.Fatalf("unknown mode %q", *modeFlag)
		}
		log.Printf("%s done in %v", spec.folder, time.Since(start).Round(time.Second))
	}
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

// ---------------------------------------------------------------------------
// Relief
// ---------------------------------------------------------------------------

// gebco is the NASA-rendered GEBCO 2008 topography: 8-bit, 21600x10800 plate
// carrée, 0 = sea level, about 25 m per step (Denver ~64, Tibet ~203,
// Everest clipped at 255).
type gebco struct{ pix *image.Gray }

const gebcoMetresPerStep = 25.0

func loadGebco(cache string) (*gebco, error) {
	img, err := decodeFile(filepath.Join(cache, "gebco_08_rev_elev_21600x10800.png"))
	if err != nil {
		return nil, err
	}
	gray, ok := img.(*image.Gray)
	if !ok {
		return nil, fmt.Errorf("topography is %T, expected *image.Gray", img)
	}
	return &gebco{gray}, nil
}

// footprintMetres summarises the elevation under one tile: the mean pulled
// halfway towards the highest point, so ranges narrower than a tile still
// read as mountains and a lone peak does not lift a whole plain.
func (g *gebco) footprintMetres(proj Projection, x, y int) float64 {
	lon0, lat0 := proj.LonLat(float64(x)-0.5, float64(y)-0.5)
	lon1, lat1 := proj.LonLat(float64(x)+0.5, float64(y)+0.5)
	w, h := g.pix.Rect.Dx(), g.pix.Rect.Dy()
	px0 := int(math.Floor((lon0 + 180) / 360 * float64(w)))
	px1 := int(math.Ceil((lon1 + 180) / 360 * float64(w)))
	py0 := int(math.Floor((90 - lat0) / 180 * float64(h)))
	py1 := int(math.Ceil((90 - lat1) / 180 * float64(h)))
	if px1 <= px0 {
		px1 = px0 + 1
	}
	if py1 <= py0 {
		py1 = py0 + 1
	}
	sum, count, highest := 0.0, 0.0, 0.0
	for py := py0; py < py1; py++ {
		cy := clampInt(py, 0, h-1)
		for px := px0; px < px1; px++ {
			cx := ((px % w) + w) % w
			v := float64(g.pix.Pix[cy*g.pix.Stride+cx])
			sum += v
			count++
			highest = math.Max(highest, v)
		}
	}
	mean := sum / count
	return (mean + 0.5*(highest-mean)) * gebcoMetresPerStep
}

// terrainMagnitude maps metres to the generator's 0-30 magnitude: plains
// (0-9) up to 500 m, highland (10-19) up to 1800 m, mountains (20-30) above.
func terrainMagnitude(metres float64) int {
	switch {
	case metres <= 0:
		return 0
	case metres < 500:
		return clampInt(int(metres/500*10), 0, 9)
	case metres < 1800:
		return clampInt(10+int((metres-500)/1300*10), 10, 19)
	default:
		return clampInt(20+int((metres-1800)/3200*11), 20, 30)
	}
}

func isGeneratorLand(c color.NRGBA) bool {
	// Mirrors map_generator.go: alpha < 20 or blue 106 is water; pure black
	// is impassable and must stay untouched.
	if c.A < 20 || c.B == 106 {
		return false
	}
	return !(c.R == 0 && c.G == 0 && c.B == 0)
}

func writeRelief(spec mapSpec) error {
	path := filepath.Join("assets", "maps", spec.folder, "image.png")
	img, err := decodeFile(path)
	if err != nil {
		return err
	}
	b := img.Bounds()
	if b.Dx() != spec.width || b.Dy() != spec.height {
		return fmt.Errorf("%s: image is %dx%d, expected %dx%d", spec.folder, b.Dx(), b.Dy(), spec.width, spec.height)
	}
	src := image.NewNRGBA(b)
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			src.SetNRGBA(x, y, color.NRGBAModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA))
		}
	}
	topo, err := loadGebco(*cacheFlag)
	if err != nil {
		return err
	}
	histogram := [3]int{}
	parallelRows(spec.height, func(y int) {
		for x := 0; x < spec.width; x++ {
			c := src.NRGBAAt(x, y)
			if !isGeneratorLand(c) {
				continue
			}
			magnitude := terrainMagnitude(topo.footprintMetres(spec.proj, x, y))
			c.B = uint8(140 + 2*magnitude)
			src.SetNRGBA(x, y, c)
		}
	})
	for y := 0; y < spec.height; y++ {
		for x := 0; x < spec.width; x++ {
			c := src.NRGBAAt(x, y)
			if !isGeneratorLand(c) {
				continue
			}
			magnitude := (int(c.B) - 140) / 2
			switch {
			case magnitude < 10:
				histogram[0]++
			case magnitude < 20:
				histogram[1]++
			default:
				histogram[2]++
			}
		}
	}
	var out bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestCompression}
	if err := encoder.Encode(&out, src); err != nil {
		return err
	}
	log.Printf("%s relief: plains %d, highland %d, mountain %d", spec.folder, histogram[0], histogram[1], histogram[2])
	return os.WriteFile(path, out.Bytes(), 0o644)
}

// ---------------------------------------------------------------------------
// Imagery
// ---------------------------------------------------------------------------

type rgb struct{ r, g, b float64 }

// raster is a decoded source image with fast bilinear sampling.
type raster struct {
	img  image.Image
	ycc  *image.YCbCr
	w, h int
}

func newRaster(img image.Image) *raster {
	r := &raster{img: img, w: img.Bounds().Dx(), h: img.Bounds().Dy()}
	if ycc, ok := img.(*image.YCbCr); ok {
		r.ycc = ycc
	}
	return r
}

func (r *raster) at(x, y int) rgb {
	if r.ycc != nil {
		yi := r.ycc.YOffset(x, y)
		ci := r.ycc.COffset(x, y)
		cr, cg, cb := color.YCbCrToRGB(r.ycc.Y[yi], r.ycc.Cb[ci], r.ycc.Cr[ci])
		return rgb{float64(cr), float64(cg), float64(cb)}
	}
	cr, cg, cb, _ := r.img.At(x, y).RGBA()
	return rgb{float64(cr >> 8), float64(cg >> 8), float64(cb >> 8)}
}

// bilinear samples at pixel-space (x, y) with pixel centres at integers.
func (r *raster) bilinear(x, y float64, wrapX bool) rgb {
	x0 := int(math.Floor(x))
	y0 := int(math.Floor(y))
	fx, fy := x-float64(x0), y-float64(y0)
	fix := func(px, py int) (int, int) {
		if wrapX {
			px = ((px % r.w) + r.w) % r.w
		} else {
			px = clampInt(px, 0, r.w-1)
		}
		return px, clampInt(py, 0, r.h-1)
	}
	ax, ay := fix(x0, y0)
	bx, by := fix(x0+1, y0)
	cx, cy := fix(x0, y0+1)
	dx, dy := fix(x0+1, y0+1)
	a, b, c, d := r.at(ax, ay), r.at(bx, by), r.at(cx, cy), r.at(dx, dy)
	lerp := func(p, q rgb, t float64) rgb {
		return rgb{p.r + (q.r-p.r)*t, p.g + (q.g-p.g)*t, p.b + (q.b-p.b)*t}
	}
	return lerp(lerp(a, b, fx), lerp(c, d, fx), fy)
}

// canvas is the full-resolution output (S texels per tile).
type canvas struct {
	w, h int
	pix  []uint8 // RGB
}

func (c *canvas) set(x, y int, v rgb) {
	i := (y*c.w + x) * 3
	c.pix[i] = uint8(clampFloat(v.r, 0, 255) + 0.5)
	c.pix[i+1] = uint8(clampFloat(v.g, 0, 255) + 0.5)
	c.pix[i+2] = uint8(clampFloat(v.b, 0, 255) + 0.5)
}

func writeImagery(spec mapSpec) error {
	scale := *scaleFlag
	out := &canvas{w: spec.width * scale, h: spec.height * scale}
	out.pix = make([]uint8, out.w*out.h*3)
	lonLat := func(px, py int) (float64, float64) {
		tx := (float64(px)+0.5)/float64(scale) - 0.5
		ty := (float64(py)+0.5)/float64(scale) - 0.5
		return spec.proj.LonLat(tx, ty)
	}

	if !spec.fullResolution {
		img, err := decodeFile(filepath.Join(*cacheFlag, "world.topo.bathy.200407.3x21600x10800.jpg"))
		if err != nil {
			return err
		}
		src := newRaster(img)
		parallelRows(out.h, func(py int) {
			for px := 0; px < out.w; px++ {
				lon, lat := lonLat(px, py)
				sx := (lon+180)/360*float64(src.w) - 0.5
				sy := (90-lat)/180*float64(src.h) - 0.5
				out.set(px, py, src.bilinear(sx, sy, true))
			}
		})
	} else {
		// 500 m mosaic: eight 21600^2 tiles, A-D west to east (90 deg each),
		// 1 north / 2 south. Decode one at a time and fill the output pixels
		// whose sample falls inside it.
		const tilePx = 21600
		const pxPerDeg = 240.0
		for col := 0; col < 4; col++ {
			for row := 0; row < 2; row++ {
				lonW, lonE := -180+90*float64(col), -90+90*float64(col)
				latN, latS := 90-90*float64(row), -90*float64(row)
				if !overlaps(spec, scale, lonW, lonE, latS, latN) {
					continue
				}
				name := fmt.Sprintf("world.topo.bathy.200407.3x21600x21600.%c%d.jpg", 'A'+col, row+1)
				img, err := decodeFile(filepath.Join(*cacheFlag, name))
				if err != nil {
					return err
				}
				src := newRaster(img)
				parallelRows(out.h, func(py int) {
					for px := 0; px < out.w; px++ {
						lon, lat := lonLat(px, py)
						gx := (lon + 180) * pxPerDeg
						gy := (90 - lat) * pxPerDeg
						if int(math.Floor(gx/tilePx)) != col || int(math.Floor(gy/tilePx)) != row {
							continue
						}
						out.set(px, py, src.bilinear(gx-float64(col*tilePx)-0.5, gy-float64(row*tilePx)-0.5, false))
					}
				})
				src = nil
				img = nil
				runtime.GC()
			}
		}
	}

	land, err := loadLandMask(spec)
	if err != nil {
		return err
	}
	fixed := conformToLandMask(out, land, spec, scale)
	log.Printf("%s imagery %dx%d, %d coast pixels conformed", spec.folder, out.w, out.h, fixed)
	return writeTiles(spec, out, scale)
}

func overlaps(spec mapSpec, scale int, lonW, lonE, latS, latN float64) bool {
	minLon, maxLon, minLat, maxLat := math.Inf(1), math.Inf(-1), math.Inf(1), math.Inf(-1)
	for _, c := range [][2]float64{{-0.5, -0.5}, {float64(spec.width) - 0.5, -0.5}, {-0.5, float64(spec.height) - 0.5}, {float64(spec.width) - 0.5, float64(spec.height) - 0.5}} {
		lon, lat := spec.proj.LonLat(c[0], c[1])
		minLon, maxLon = math.Min(minLon, lon), math.Max(maxLon, lon)
		minLat, maxLat = math.Min(minLat, lat), math.Max(maxLat, lat)
	}
	return maxLon >= lonW && minLon <= lonE && maxLat >= latS && minLat <= latN
}

// loadLandMask reads the generated runtime terrain (bit 7 = land).
func loadLandMask(spec mapSpec) ([]bool, error) {
	data, err := os.ReadFile(filepath.Join("..", "resources", "maps", spec.folder, "map.bin"))
	if err != nil {
		return nil, err
	}
	if len(data) != spec.width*spec.height {
		return nil, fmt.Errorf("%s: map.bin has %d bytes, expected %d", spec.folder, len(data), spec.width*spec.height)
	}
	land := make([]bool, len(data))
	for i, v := range data {
		land[i] = v&0x80 != 0
	}
	return land, nil
}

// looksLikeWater classifies a Blue Marble pixel: oceans, seas and lakes are
// blue-dominant; snow and ice are near-neutral and stay land.
func looksLikeWater(r, g, b uint8) bool {
	rf, gf, bf := float64(r), float64(g), float64(b)
	return bf > rf*1.18+6 && bf >= gf*0.92 && rf < 150
}

// conformToLandMask makes the picture agree with the playable coastline:
// where the game has land the picture must show land and vice versa. The
// game coastline is the smooth half-level of its bilinear land field (the
// same anti-aliased edge the renderer draws). Disagreeing pixels take the
// colour of the nearest agreeing pixel of their class (breadth-first).
// fillFromLandAverage sets every pixel still needing a land colour to the
// mean of the agreeing land pixels within `radius` (a direct window average;
// these pixels are a thin coastal minority). Filled pixels are marked done
// only after the pass, so fills never feed each other.
func fillFromLandAverage(c *canvas, state []uint8, gameLand []bool, radius int) {
	w, h := c.w, c.h
	done := make([]int32, 0)
	var mu sync.Mutex
	parallelRows(h, func(y int) {
		var local []int32
		for x := 0; x < w; x++ {
			i := y*w + x
			if state[i] != 1 {
				continue
			}
			var r, g, b, count float64
			for yy := clampInt(y-radius, 0, h-1); yy <= clampInt(y+radius, 0, h-1); yy++ {
				for xx := clampInt(x-radius, 0, w-1); xx <= clampInt(x+radius, 0, w-1); xx++ {
					j := yy*w + xx
					if state[j] != 0 || !gameLand[j] {
						continue
					}
					r += float64(c.pix[j*3])
					g += float64(c.pix[j*3+1])
					b += float64(c.pix[j*3+2])
					count++
				}
			}
			if count < 1 {
				continue
			}
			c.pix[i*3] = uint8(r/count + 0.5)
			c.pix[i*3+1] = uint8(g/count + 0.5)
			c.pix[i*3+2] = uint8(b/count + 0.5)
			local = append(local, int32(i))
		}
		mu.Lock()
		done = append(done, local...)
		mu.Unlock()
	})
	for _, i := range done {
		state[i] = 3
	}
}

func conformToLandMask(c *canvas, land []bool, spec mapSpec, scale int) int {
	n := c.w * c.h
	// state: 0 = agrees, 1 = needs land colour, 3 = filled
	state := make([]uint8, n)
	gameLand := make([]bool, n)
	landAt := func(x, y int) float64 {
		x = clampInt(x, 0, spec.width-1)
		y = clampInt(y, 0, spec.height-1)
		if land[y*spec.width+x] {
			return 1
		}
		return 0
	}
	parallelRows(c.h, func(py int) {
		ty := (float64(py)+0.5)/float64(scale) - 0.5
		y0 := int(math.Floor(ty))
		fy := ty - float64(y0)
		for px := 0; px < c.w; px++ {
			tx := (float64(px)+0.5)/float64(scale) - 0.5
			x0 := int(math.Floor(tx))
			fx := tx - float64(x0)
			field := (landAt(x0, y0)*(1-fx)+landAt(x0+1, y0)*fx)*(1-fy) +
				(landAt(x0, y0+1)*(1-fx)+landAt(x0+1, y0+1)*fx)*fy
			i := py*c.w + px
			isLand := field >= 0.5
			gameLand[i] = isLand
			water := looksLikeWater(c.pix[i*3], c.pix[i*3+1], c.pix[i*3+2])
			if isLand && water {
				state[i] = 1
			} else if !isLand && !water {
				// Real land the game floods (ice shelves, generalised
				// straits): tint the picture itself into shallow sea so
				// its texture survives instead of smearing a distant
				// colour across it.
				r, g, b := float64(c.pix[i*3]), float64(c.pix[i*3+1]), float64(c.pix[i*3+2])
				lum := (r*0.3 + g*0.59 + b*0.11) / 255
				c.pix[i*3] = uint8(clampFloat(14+lum*30, 0, 255))
				c.pix[i*3+1] = uint8(clampFloat(40+lum*55, 0, 255))
				c.pix[i*3+2] = uint8(clampFloat(78+lum*70, 0, 255))
			}
		}
	})

	// Sea the game turns into land takes the average colour of the real land
	// around it (agreeing land pixels within one map tile, then three),
	// which blends instead of streaking.
	fixed := 0
	for i := 0; i < n; i++ {
		if state[i] == 1 {
			fixed++
		}
	}
	for _, radius := range []int{scale, 3 * scale} {
		fillFromLandAverage(c, state, gameLand, radius)
	}
	for i := 0; i < n; i++ {
		if state[i] == 1 {
			c.pix[i*3], c.pix[i*3+1], c.pix[i*3+2] = 112, 104, 78
		}
	}
	return fixed
}

type satelliteIndex struct {
	Version       int    `json:"version"`
	Source        string `json:"source"`
	TexelsPerTile int    `json:"texelsPerTile"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
	TileSize      int    `json:"tileSize"`
	Cols          int    `json:"cols"`
	Rows          int    `json:"rows"`
	Overview      struct {
		File   string `json:"file"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
	} `json:"overview"`
}

const detailTileSize = 512

func writeTiles(spec mapSpec, c *canvas, scale int) error {
	dir := filepath.Join("..", "resources", "maps", spec.folder, "satellite")
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dir, "tiles"), 0o755); err != nil {
		return err
	}
	cols := (c.w + detailTileSize - 1) / detailTileSize
	rows := (c.h + detailTileSize - 1) / detailTileSize
	type job struct{ col, row int }
	jobs := make(chan job)
	errs := make(chan error, cols*rows)
	var total int64
	var mu sync.Mutex
	var wg sync.WaitGroup
	for w := 0; w < runtime.NumCPU(); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				tile := image.NewNRGBA(image.Rect(0, 0, detailTileSize, detailTileSize))
				for y := 0; y < detailTileSize; y++ {
					sy := clampInt(j.row*detailTileSize+y, 0, c.h-1)
					for x := 0; x < detailTileSize; x++ {
						sx := clampInt(j.col*detailTileSize+x, 0, c.w-1)
						i := (sy*c.w + sx) * 3
						o := tile.PixOffset(x, y)
						tile.Pix[o], tile.Pix[o+1], tile.Pix[o+2], tile.Pix[o+3] = c.pix[i], c.pix[i+1], c.pix[i+2], 255
					}
				}
				data, err := encodeWebp(tile)
				if err != nil {
					errs <- err
					continue
				}
				name := filepath.Join(dir, "tiles", fmt.Sprintf("%d_%d.webp", j.col, j.row))
				if err := os.WriteFile(name, data, 0o644); err != nil {
					errs <- err
					continue
				}
				mu.Lock()
				total += int64(len(data))
				mu.Unlock()
			}
		}()
	}
	for row := 0; row < rows; row++ {
		for col := 0; col < cols; col++ {
			jobs <- job{col, row}
		}
	}
	close(jobs)
	wg.Wait()
	close(errs)
	for err := range errs {
		return err
	}

	// Overview: box-filtered to two texels per tile (one texture, mipmapped
	// by the client) for every zoom below the detail tiles.
	const overviewPerTile = 2
	factor := scale / overviewPerTile
	ow, oh := c.w/factor, c.h/factor
	overview := image.NewNRGBA(image.Rect(0, 0, ow, oh))
	parallelRows(oh, func(y int) {
		for x := 0; x < ow; x++ {
			var r, g, b int
			for dy := 0; dy < factor; dy++ {
				for dx := 0; dx < factor; dx++ {
					i := ((y*factor+dy)*c.w + x*factor + dx) * 3
					r += int(c.pix[i])
					g += int(c.pix[i+1])
					b += int(c.pix[i+2])
				}
			}
			n := factor * factor
			o := overview.PixOffset(x, y)
			overview.Pix[o], overview.Pix[o+1], overview.Pix[o+2], overview.Pix[o+3] = uint8(r/n), uint8(g/n), uint8(b/n), 255
		}
	})
	data, err := encodeWebp(overview)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "overview.webp"), data, 0o644); err != nil {
		return err
	}
	index := satelliteIndex{
		Version:       1,
		Source:        "NASA Earth Observatory, Blue Marble Next Generation, July 2004 (topography and bathymetry)",
		TexelsPerTile: scale,
		Width:         c.w,
		Height:        c.h,
		TileSize:      detailTileSize,
		Cols:          cols,
		Rows:          rows,
	}
	index.Overview.File = "overview.webp"
	index.Overview.Width, index.Overview.Height = ow, oh
	encoded, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return err
	}
	log.Printf("%s tiles: %dx%d (%.1f MB) + overview %dx%d (%.1f MB)", spec.folder, cols, rows, float64(total)/1e6, ow, oh, float64(len(data))/1e6)
	return os.WriteFile(filepath.Join(dir, "index.json"), append(encoded, '\n'), 0o644)
}

func encodeWebp(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := webp.Encode(&buf, img, webp.Options{Quality: *qualityFlag, Method: 4}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func decodeFile(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return img, nil
}

func parallelRows(rows int, fn func(y int)) {
	workers := runtime.NumCPU()
	var wg sync.WaitGroup
	next := make(chan int, workers*4)
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for y := range next {
				fn(y)
			}
		}()
	}
	for y := 0; y < rows; y++ {
		next <- y
	}
	close(next)
	wg.Wait()
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}
