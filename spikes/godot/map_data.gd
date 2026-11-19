# Карта района из файла игры (src/map/format.ts, ADR 0004 «Диспетчера»): заголовок ASCII и массивы целых чисел.
# Координаты — «полуметры» (0,5 м) от северо-западного угла района. Данные: © участники OpenStreetMap, ODbL 1.0.
class_name MapData
extends RefCounted

const MAGIC := 0x4d505344

var width := 0
var height := 0
var edge_cls := PackedInt32Array()
var edge_shapes: Array[PackedVector2Array] = []
var water: Array[PackedVector2Array] = []
var green: Array[PackedVector2Array] = []
var rail: Array[PackedVector2Array] = []


static func load_file(path: String) -> MapData:
	var m := MapData.new()
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.size() < 12 or bytes.decode_u32(0) != MAGIC:
		push_error("not a map file: " + path)
		return m
	var head_len := bytes.decode_u32(8)
	var head := bytes.slice(12, 12 + head_len).get_string_from_ascii()
	var data_start := (12 + head_len + 3) & ~3
	var parts := head.split(";")
	m.width = int(parts[1])
	m.height = int(parts[2])
	var sec := {}
	for item in parts[3].split(","):
		var f := item.split(":")
		sec[f[0]] = [f[1], data_start + int(f[2]), int(f[3])]
	m.edge_cls = _read(bytes, sec["edges.cls"])
	m.edge_shapes = _lines(_read(bytes, sec["edges.shape.starts"]), _read(bytes, sec["edges.shape.pts"]))
	m.water = _lines(_read(bytes, sec["water.starts"]), _read(bytes, sec["water.pts"]))
	m.green = _lines(_read(bytes, sec["green.starts"]), _read(bytes, sec["green.pts"]))
	m.rail = _lines(_read(bytes, sec["rail.starts"]), _read(bytes, sec["rail.pts"]))
	return m


static func _read(bytes: PackedByteArray, s: Array) -> PackedInt32Array:
	var kind: String = s[0]
	var at: int = s[1]
	var n: int = s[2]
	var out := PackedInt32Array()
	out.resize(n)
	if kind == "u8":
		for i in n:
			out[i] = bytes[at + i]
	elif kind == "u16":
		for i in n:
			out[i] = bytes.decode_u16(at + 2 * i)
	else:
		for i in n:
			out[i] = bytes.decode_u32(at + 4 * i)
	return out


static func _lines(starts: PackedInt32Array, pts: PackedInt32Array) -> Array[PackedVector2Array]:
	var out: Array[PackedVector2Array] = []
	for i in starts.size() - 1:
		var a := starts[i]
		var b := starts[i + 1]
		var line := PackedVector2Array()
		line.resize(b - a)
		for k in range(a, b):
			line[k - a] = Vector2(pts[2 * k], pts[2 * k + 1])
		out.append(line)
	return out
