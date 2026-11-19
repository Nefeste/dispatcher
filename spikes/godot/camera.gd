# Камера карты: сдвиг одним пальцем, масштаб двумя вокруг точки между ними (и колесом мыши); карта заполняет экран,
# приблизить — до 12 раз. Как у MapView на Skia в игре.
extends Camera2D

signal zoomed(z: float)

const MAX_ZOOM := 12.0

var map_size := Vector2.ONE
var fit := 1.0
var touches := {}
var spread := 0.0


func setup(size: Vector2) -> void:
	map_size = size
	var vp := get_viewport_rect().size
	fit = maxf(vp.x / size.x, vp.y / size.y)
	zoom = Vector2(fit, fit)
	position = size / 2.0
	_clamp()


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventScreenTouch:
		if e.pressed:
			touches[e.index] = e.position
		else:
			touches.erase(e.index)
		spread = _spread()
	elif e is InputEventScreenDrag:
		touches[e.index] = e.position
		if touches.size() >= 2:
			var d := _spread()
			if spread > 0.0 and d > 0.0:
				zoom_at(_middle(), d / spread)
			spread = d
		else:
			position -= e.relative / zoom.x
			_clamp()
	elif e is InputEventMouseButton and e.pressed:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP:
			zoom_at(e.position, 1.1)
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			zoom_at(e.position, 1.0 / 1.1)
	elif e is InputEventMagnifyGesture:
		zoom_at(e.position, e.factor)


func zoom_at(p: Vector2, f: float) -> void:
	var vp := get_viewport_rect().size
	var before := position + (p - vp / 2.0) / zoom.x
	var z := clampf(zoom.x * f, fit, fit * MAX_ZOOM)
	zoom = Vector2(z, z)
	position = before - (p - vp / 2.0) / z
	_clamp()
	zoomed.emit(z)


func _clamp() -> void:
	var half := get_viewport_rect().size / 2.0 / zoom.x
	position.x = map_size.x / 2.0 if half.x * 2.0 >= map_size.x else clampf(position.x, half.x, map_size.x - half.x)
	position.y = map_size.y / 2.0 if half.y * 2.0 >= map_size.y else clampf(position.y, half.y, map_size.y - half.y)


func _spread() -> float:
	if touches.size() < 2:
		return 0.0
	var p: Array = touches.values()
	return (p[0] as Vector2).distance_to(p[1])


func _middle() -> Vector2:
	var p: Array = touches.values()
	return ((p[0] as Vector2) + (p[1] as Vector2)) / 2.0
