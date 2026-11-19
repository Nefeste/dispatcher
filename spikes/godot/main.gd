# Проба Godot (uprava#121): карта района из того же файла, что у игры на Skia, и счётчик кадров для сравнения.
# Аргумент `-- --sweep` — сам сдвигает и приближает карту, чтобы снять кадры без пальцев (Movie Maker, xvfb).
extends Node2D

@onready var map_view: Node2D = $Map
@onready var cam: Camera2D = $Camera
@onready var fps: Label = $UI/Fps

var sweep := false
var t := 0.0


func _ready() -> void:
	var m := MapData.load_file("res://map/nn-center.bin")
	map_view.setup(m)
	cam.setup(Vector2(m.width, m.height))
	map_view.fit = cam.fit
	map_view.zoom = cam.zoom.x
	map_view.queue_redraw()
	cam.zoomed.connect(_on_zoomed)
	sweep = OS.get_cmdline_user_args().has("--sweep")


func _on_zoomed(z: float) -> void:
	map_view.zoom = z
	map_view.queue_redraw()


func _process(delta: float) -> void:
	fps.text = "%d к/с" % Engine.get_frames_per_second()
	if sweep:
		t += delta
		var vp := get_viewport_rect().size
		if t < 1.0:
			cam.position.y -= 900.0 * delta
		elif t < 2.0:
			cam.zoom_at(vp / 2.0, 1.0 + 1.2 * delta)
		cam._clamp()
