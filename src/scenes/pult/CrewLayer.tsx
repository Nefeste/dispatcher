// Слой смены на карте пульта (части П3, П5): подстанции, больницы, вызовы, пути едущих бригад и сами бригады.
// Место бригад — общее значение `pos` (x, y по очереди), его каждый кадр пишет экран пульта.
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import { type SkPath, Skia, useFont } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import { type Crew, free } from '../../engine/crews';
import type { Route } from '../../engine/road/pos';
import type { Shift, ShiftCtx } from '../../engine/shift';
import type { MapData } from '../../map/format';
import { crewNo } from '../../state/callView';
import { CallMark, CrewMark, PlaceMark, RouteLine } from '../../ui/map/Marks';
import { CREW, FORM_MARK, UNDECIDED } from '../../ui/map/palette';
import { slots } from './slots';

/** Путь по улицам — одна линия по формам рёбер в порядке проезда. */
export function routePath(m: MapData, r: Route): SkPath {
  const b = Skia.PathBuilder.Make();
  const { starts, pts } = m.edges.shape;
  b.moveTo(m.nodes.x[r.nodes[0]], m.nodes.y[r.nodes[0]]);
  for (let i = 0; i < r.edges.length; i++) {
    const e = r.edges[i];
    const forward = m.edges.a[e] === r.nodes[i];
    const s0 = starts[e], s1 = starts[e + 1];
    for (let k = 1; k < s1 - s0; k++) {
      const j = forward ? s0 + k : s1 - 1 - k;
      b.lineTo(pts[j * 2], pts[j * 2 + 1]);
    }
  }
  return b.detach();
}

function RouteOf({ map, route, zoom, color }: { map: MapData; route: Route; zoom: SharedValue<number>; color: string }) {
  const path = useMemo(() => routePath(map, route), [map, route]);
  return <RouteLine path={path} zoom={zoom} color={color} />;
}

const colorOf = (c: Crew) => CREW[c.state];
const busy = (c: Crew) => !free(c);

export function CrewLayer({ ctx, shift, pos, zoom }: { ctx: ShiftCtx; shift: Shift; pos: SharedValue<number[]>; zoom: SharedValue<number> }) {
  const font = useFont(Onest_600SemiBold, 12);
  const { map, city } = ctx;
  const off = slots(shift.crews);
  // вызов на карте — пока его ждут, бригада едет к нему или работает на нём
  const active = shift.calls.filter(c => c.state !== 'ring' && c.state !== 'done' && c.state !== 'transport' && c.state !== 'hospital');
  const at = (node: number) => [map.nodes.x[node], map.nodes.y[node]] as const;
  return (
    <>
      {shift.crews.map(c => (c.route ? <RouteOf key={`r${c.id}`} map={map} route={c.route} zoom={zoom} color={colorOf(c)} /> : null))}
      {city.hospitals.map(h => <PlaceMark key={h.id} x={at(h.node)[0]} y={at(h.node)[1]} zoom={zoom} kind="hospital" font={font} />)}
      {city.bases.map(b => <PlaceMark key={b.id} x={at(b.node)[0]} y={at(b.node)[1]} zoom={zoom} kind="base" font={font} />)}
      {active.map(c => {
        const form = c.form === 'emergency' || c.form === 'urgent' ? c.form : null;
        return <CallMark key={c.id} x={at(c.node)[0]} y={at(c.node)[1]} zoom={zoom} color={form ? FORM_MARK[form] : UNDECIDED} emergency={form === 'emergency'} />;
      })}
      {shift.crews.map((c, i) => (
        <CrewMark key={c.id} i={i} pos={pos} zoom={zoom} label={String(crewNo(c.id))} color={colorOf(c)} busy={busy(c)} font={font} dx={off[i][0]} dy={off[i][1]} />
      ))}
    </>
  );
}
