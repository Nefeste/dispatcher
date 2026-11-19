# Карта района: те же слои и цвета, что у игры на Skia (src/ui/map/palette.ts, docs/13-art.md «Диспетчера»).
# Ширина улиц на экране не зависит от масштаба; издалека — тоньше, до трети. Перерисовка — только при смене масштаба.
extends Node2D

const LAND := Color("#ecede6")
const WATER := Color("#b9cdd5")
const GREEN := Color("#d4dcc6")
const RAIL := Color("#a3a69c")
const CASING := Color("#c8cabd")
const ROAD := [Color("#ffffff"), Color("#ffffff"), Color("#fcfcf8"), Color("#f6f6f1")]
const ROAD_PX := [5.0, 4.0, 3.0, 1.8]
const CASING_PX := 1.5
const DETAIL := 4.0

var map: MapData
var fit := 1.0
var zoom := 1.0
var roads := [[], [], [], []]
var fills := []


func setup(m: MapData) -> void:
	map = m
	for e in m.edge_shapes.size():
		roads[m.edge_cls[e]].append(m.edge_shapes[e])
	_add_fills(m.green, GREEN)
	_add_fills(m.water, WATER)


# «Чёт-нечет», как в Skia: кольцо внутри нечётного числа других колец — остров, он закрашивается землёй.
func _add_fills(rings: Array[PackedVector2Array], color: Color) -> void:
	var items := []
	for i in rings.size():
		var depth := 0
		for j in rings.size():
			if i != j and Geometry2D.is_point_in_polygon(rings[i][0], rings[j]):
				depth += 1
		items.append([depth, i])
	items.sort_custom(func(a, b): return a[0] < b[0])
	for it in items:
		var poly: PackedVector2Array = rings[it[1]]
		if poly.size() < 3 or Geometry2D.triangulate_polygon(poly).is_empty():
			continue
		fills.append([poly, color if it[0] % 2 == 0 else LAND])


func _width(px: float) -> float:
	var k := clampf(zoom / (fit * DETAIL), 0.35, 1.0)
	return px * k / zoom


func _draw() -> void:
	if map == null:
		return
	draw_rect(Rect2(0, 0, map.width, map.height), LAND)
	for f in fills:
		draw_colored_polygon(f[0], f[1])
	var rw := _width(1.2)
	for l in map.rail:
		draw_polyline(l, RAIL, rw, true)
	var w3 := _width(ROAD_PX[3])
	for l in roads[3]:
		draw_polyline(l, ROAD[3], w3, true)
	for c in [2, 1, 0]:
		var wc := _width(ROAD_PX[c] + CASING_PX * 2)
		for l in roads[c]:
			draw_polyline(l, CASING, wc, true)
	for c in [2, 1, 0]:
		var w := _width(ROAD_PX[c])
		for l in roads[c]:
			draw_polyline(l, ROAD[c], w, true)
