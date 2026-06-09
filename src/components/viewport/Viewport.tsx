import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../stores/useStore';
import {
  project, projectPoints, fitProjection, unprojectToFloor, viewDepth,
  type ViewMode, type Camera,
} from '../../utils/iso';
import { splColor, clarityColor, arrivalColor, t30Color, extractContour } from '../../engine/acoustics';
import { bboxOf, pointInPolygon } from '../../utils/geometry';
import { getMaterial } from '../../constants/materials';
import { renderWallTexture, renderFloorTexture, renderCeilingTexture, shade as shadeMat } from './surfaceTextures';
import type { EquipmentItem, EquipmentTemplate, Point, HeatmapData, Connection } from '../../types';
import { buildItemFromTemplate, snapToGrid } from '../../utils/itemBuilder';
import { ceilingPanels, wallTopProfile } from '../../utils/ceiling';
import { CABLE_SPECS } from '../../constants/cables';
import { Icon } from '../Icon';
import { shape3DFor, renderShape3D } from './equipment3d';
import { renderPanelPattern, DEFAULT_PANEL_COLOR } from './panelPatterns';

interface PewRow { x: number; y: number; w: number; d: number; }

function buildPews(roomShape: Point[], stageDepth: number): PewRow[] {
  const bb = bboxOf(roomShape);
  const w = bb.width, d = bb.depth;
  const rowSpacing = 3.2;
  const pewDepth = 1.6;
  const aisleW = Math.min(5, w * 0.08);
  const sideMargin = Math.min(4, w * 0.06);
  const pewLen = (w - aisleW - sideMargin * 2) / 2;
  const startY = stageDepth + 4;
  const availableD = d - startY - 3;
  const rows = Math.max(0, Math.floor(availableD / rowSpacing));
  const pews: PewRow[] = [];
  for (let r = 0; r < rows; r++) {
    const y = bb.minY + startY + r * rowSpacing;
    pews.push({ x: bb.minX + sideMargin, y, w: pewLen, d: pewDepth });
    pews.push({ x: bb.minX + sideMargin + pewLen + aisleW, y, w: pewLen, d: pewDepth });
  }
  return pews;
}

interface Proj {
  p: (x: number, y: number, z: number) => [number, number];
  pp: (pts: [number, number, number][]) => string;
  depth: (x: number, y: number, z: number) => number;
}
function makeProj(scale: number, mode: ViewMode, camera: Camera): Proj {
  return {
    p: (x, y, z) => project(x, y, z, scale, mode, camera),
    pp: (pts) => projectPoints(pts, scale, mode, camera),
    depth: (x, y, z) => viewDepth(x, y, z, mode, camera),
  };
}

// Average depth of a polygon's vertices — used for painter's-order z-sorting.
function polyDepth(pts: [number, number, number][], mode: ViewMode, camera: Camera): number {
  let s = 0;
  for (const [x, y, z] of pts) s += viewDepth(x, y, z, mode, camera);
  return s / pts.length;
}

function Defs() {
  return (
    <defs>
      <linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1c2230" stopOpacity="1"/>
        <stop offset="1" stopColor="#0f141a" stopOpacity="1"/>
      </linearGradient>
      <linearGradient id="wallGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#222a36" stopOpacity="1"/>
        <stop offset="1" stopColor="#13181f" stopOpacity="1"/>
      </linearGradient>
      <linearGradient id="ceilGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1a212c" stopOpacity="1"/>
        <stop offset="1" stopColor="#0e131a" stopOpacity="1"/>
      </linearGradient>
      <linearGradient id="stageGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3a2f1f" stopOpacity="1"/>
        <stop offset="1" stopColor="#1a140a" stopOpacity="1"/>
      </linearGradient>
      <pattern id="planks" width="40" height="80" patternUnits="userSpaceOnUse">
        <rect width="40" height="80" fill="url(#floorGrad)"/>
        <line x1="0" y1="0" x2="40" y2="0" stroke="rgba(255,255,255,.04)" strokeWidth="1"/>
        <line x1="20" y1="0" x2="20" y2="80" stroke="rgba(255,255,255,.025)" strokeWidth="1"/>
      </pattern>
      <radialGradient id="vignette" cx="50%" cy="50%" r="65%">
        <stop offset="60%" stopColor="rgba(0,0,0,0)"/>
        <stop offset="100%" stopColor="rgba(0,0,0,.55)"/>
      </radialGradient>
    </defs>
  );
}

interface RoomShellProps {
  scale: number; viewMode: ViewMode; camera: Camera;
  showMesh: boolean; occupied: boolean; showPews: boolean;
}
function RoomShell({ scale, viewMode, camera, showMesh, occupied, showPews }: RoomShellProps) {
  const room = useStore(s => s.room);
  const selectedSurface = useStore(s => s.selectedSurface);
  const selectSurface = useStore(s => s.selectSurface);
  // Suppress surface selection while a drawing / measuring / wiring tool owns
  // the canvas — clicking a wall there should do the tool's job, not select.
  const toolBusy = useStore(s =>
    s.measureMode || s.drawingZone || s.editingRoomShape || s.droppingAnnotation || s.wiringMode);
  // Surface selection helpers — click a wall / floor / ceiling to select it
  // (highlighted amber) and edit its material in the Inspector. stopPropagation
  // keeps the canvas-level click from immediately clearing the selection.
  const isSurfSel = (kind: 'wall' | 'floor' | 'ceiling', segmentIndex: number) =>
    selectedSurface?.kind === kind && selectedSurface?.segmentIndex === segmentIndex;
  const onSurfClick = (kind: 'wall' | 'floor' | 'ceiling', segmentIndex: number) =>
    (e: React.MouseEvent) => {
      if (toolBusy) return;           // let the active tool handle the click
      e.stopPropagation();
      selectSurface({ kind, segmentIndex });
    };
  const SURF_SEL_FILL = 'rgba(245,166,35,.20)';
  const SURF_SEL_STROKE = '#F5A623';
  const stage = room.stage;
  const shape = room.shape;
  const hMin = room.height;
  const isOutdoor = room.roomType === 'outdoor' || hMin === 0;
  const bb = bboxOf(shape);
  const stageDepth = stage?.depth ?? 0;
  const { p, pp } = makeProj(scale, viewMode, camera);

  const floorPts = pp(shape.map(p2 => [p2.x, p2.y, 0] as [number, number, number]));

  // Walls — render in iso/walk mode, z-sorted so far walls paint first.
  //
  // Realism model: walls on the FAR side of the room (the faces you're
  // looking at the inside of) render with their material's true color and
  // a procedural texture (brick courses, wood grain, glass mullions…).
  // NEAR-side walls keep the legacy dark "ghost" treatment so the camera
  // can still see into the room — they read as a frame, not a slab. In
  // walk mode the eye is inside, so every visible wall is an interior
  // face and gets the full material treatment.
  const wallNodes: React.ReactNode[] = [];
  if (!isOutdoor && viewMode !== 'top') {
    type WallEntry = { node: React.ReactNode; depth: number };
    const walls: WallEntry[] = [];
    const centroidDepth = viewDepth(
      (bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, hMin / 2, viewMode, camera);
    for (let i = 0; i < shape.length; i++) {
      const a = shape[i];
      const b = shape[(i + 1) % shape.length];
      const seg = room.surfaces.find(s => s.kind === 'wall' && s.segmentIndex === i);
      const matId = seg?.materialId ?? 'drywall';
      const mat = getMaterial(matId);
      // Top profile follows the ceiling so gable walls rise to a peak.
      const topProfile = wallTopProfile(room, a, b);
      // Wall polygon: floor edge (a → b at z=0) then top profile from b → a.
      const pts: [number, number, number][] = [
        [a.x, a.y, 0],
        [b.x, b.y, 0],
        ...topProfile.slice().reverse(),
      ];
      const polyStr = pp(pts);
      const depth = polyDepth(pts, viewMode, camera);
      const isFarFace = viewMode === 'walk' || depth >= centroidDepth;
      let hMax = 0;
      for (const tp of topProfile) if (tp[2] > hMax) hMax = tp[2];
      const clipId = `rsw-${i}`;
      walls.push({
        depth,
        node: (
          <g key={`wall-${i}`} data-surface-kind="wall" data-surface-seg={i} style={{ cursor: 'pointer' }} onClick={onSurfClick('wall', i)}>
            {isFarFace ? (
              <>
                <clipPath id={clipId}><polygon points={polyStr}/></clipPath>
                {/* True material color, dimmed to sit in the scene's lighting */}
                <polygon points={polyStr} fill={shadeMat(mat.color, 0.52)} stroke="rgba(0,0,0,.35)" strokeWidth="0.6"/>
                <g clipPath={`url(#${clipId})`} pointerEvents="none">
                  {renderWallTexture(matId, mat.color, a, b, hMax, p, i * 7919 + 13)}
                </g>
                {/* Vertical depth falloff keeps the moody read */}
                <polygon points={polyStr} fill="url(#wallGrad)" fillOpacity="0.35" stroke="rgba(255,255,255,.07)" strokeWidth="0.5" pointerEvents="none"/>
              </>
            ) : (
              <>
                <polygon points={polyStr} fill="url(#wallGrad)" stroke="rgba(255,255,255,.08)" strokeWidth="0.6"/>
                <polygon points={polyStr} fill={mat.color} fillOpacity="0.10" stroke="none"/>
              </>
            )}
            {isSurfSel('wall', i) && (
              <polygon points={polyStr} fill={SURF_SEL_FILL} stroke={SURF_SEL_STROKE} strokeWidth="1.4" strokeDasharray="4 2.5" pointerEvents="none"/>
            )}
          </g>
        ),
      });
    }
    walls.sort((a, b) => b.depth - a.depth); // far first
    for (const w of walls) wallNodes.push(w.node);
  }

  // Top-down: draw wall outlines as colored segments (showing material)
  const topWallOutlines: React.ReactNode[] = [];
  if (viewMode === 'top' && !isOutdoor) {
    for (let i = 0; i < shape.length; i++) {
      const a = shape[i];
      const b = shape[(i + 1) % shape.length];
      const seg = room.surfaces.find(s => s.kind === 'wall' && s.segmentIndex === i);
      const mat = seg ? getMaterial(seg.materialId) : getMaterial('drywall');
      const [ax, ay] = p(a.x, a.y, 0);
      const [bx, by] = p(b.x, b.y, 0);
      const sel = isSurfSel('wall', i);
      topWallOutlines.push(
        <g key={`wall-top-${i}`} data-surface-kind="wall" data-surface-seg={i} style={{ cursor: 'pointer' }} onClick={onSurfClick('wall', i)}>
          {/* Fat transparent hit area so thin wall lines are easy to click */}
          <line x1={ax} y1={ay} x2={bx} y2={by} stroke="transparent" strokeWidth="12" strokeLinecap="round"/>
          <line x1={ax} y1={ay} x2={bx} y2={by} stroke={sel ? SURF_SEL_STROKE : mat.color} strokeWidth={sel ? 5 : 3} strokeLinecap="round"/>
        </g>
      );
    }
  }

  // Ceiling — render in iso/walk mode using the new panels helper.
  let ceilingNode: React.ReactNode = null;
  if (!isOutdoor && viewMode !== 'top') {
    const panels = ceilingPanels(room);
    const isFlat = room.ceilingShape === 'flat' || room.ceilingShape === 'coffered';
    type Entry = { node: React.ReactNode; depth: number };
    const entries: Entry[] = [];
    for (const cp of panels) {
      const ceilSeg = room.surfaces.find(s => s.kind === 'ceiling' && s.segmentIndex === cp.segmentIndex);
      const ceilMatId = ceilSeg?.materialId ?? 'drywall';
      const mat = getMaterial(ceilMatId);
      for (let fi = 0; fi < cp.facets.length; fi++) {
        const f = cp.facets[fi];
        const polyStr = pp(f.vertices);
        const depth = polyDepth(f.vertices, viewMode, camera);
        const sel = isSurfSel('ceiling', cp.segmentIndex);
        const clipId = `rsc-${cp.segmentIndex}-${fi}`;
        entries.push({
          depth,
          node: (
            <g key={`ceil-${cp.segmentIndex}-${fi}`} data-surface-kind="ceiling" data-surface-seg={cp.segmentIndex} style={{ cursor: 'pointer' }} onClick={onSurfClick('ceiling', cp.segmentIndex)}>
              <clipPath id={clipId}><polygon points={polyStr}/></clipPath>
              <polygon points={polyStr}
                fill={shadeMat(mat.color, 0.40)} fillOpacity={isFlat ? 0.55 : 1}
                stroke="rgba(255,255,255,.06)" strokeWidth="0.6"/>
              <g clipPath={`url(#${clipId})`} pointerEvents="none" opacity={isFlat ? 0.55 : 1}>
                {renderCeilingTexture(ceilMatId, mat.color, f.vertices, p, cp.segmentIndex * 131 + fi)}
              </g>
              <polygon points={polyStr} fill="url(#ceilGrad)" fillOpacity={isFlat ? 0.25 : 0.45} stroke="none" pointerEvents="none"/>
              {sel && (
                <polygon points={polyStr} fill={SURF_SEL_FILL} stroke={SURF_SEL_STROKE} strokeWidth="1.4" strokeDasharray="4 2.5" pointerEvents="none"/>
              )}
            </g>
          ),
        });
      }
    }
    entries.sort((a, b) => b.depth - a.depth);
    ceilingNode = <>{entries.map((e, i) => <React.Fragment key={i}>{e.node}</React.Fragment>)}</>;
  }

  // Stage block
  let stageNodes: React.ReactNode = null;
  if (stage) {
    const sx = (bb.minX + bb.maxX) / 2 - stage.width / 2;
    const sy = bb.minY;
    const sz = stage.height;
    const sd = stage.depth;
    const sw = stage.width;
    if (viewMode === 'iso') {
      const top = pp([
        [sx, sy, sz], [sx + sw, sy, sz], [sx + sw, sy + sd, sz], [sx, sy + sd, sz],
      ]);
      const front = pp([
        [sx, sy + sd, 0], [sx + sw, sy + sd, 0], [sx + sw, sy + sd, sz], [sx, sy + sd, sz],
      ]);
      stageNodes = (
        <g>
          <polygon points={front} fill="url(#stageGrad)" stroke="rgba(245,166,35,.3)" strokeWidth="0.6"/>
          <polygon points={top} fill="rgba(120,90,50,.4)" stroke="rgba(245,166,35,.5)" strokeWidth="0.7"/>
        </g>
      );
    } else {
      const top = pp([
        [sx, sy, 0], [sx + sw, sy, 0], [sx + sw, sy + sd, 0], [sx, sy + sd, 0],
      ]);
      stageNodes = (
        <polygon points={top} fill="rgba(245,166,35,.2)" stroke="rgba(245,166,35,.6)" strokeWidth="1"/>
      );
    }
  }

  // Pews — z-sorted in iso mode so the back rows render before the front rows.
  const pewNodes: React.ReactNode[] = [];
  if (showPews && room.roomType !== 'outdoor' && room.roomType !== 'gym') {
    type PewEntry = { node: React.ReactNode; depth: number };
    const pewEntries: PewEntry[] = [];
    const pews = buildPews(shape, stageDepth + (stage?.height ?? 0));
    for (let i = 0; i < pews.length; i++) {
      const pew = pews[i];
      const z = 1.5;
      const cellDepth = viewDepth(pew.x + pew.w / 2, pew.y + pew.d / 2, z / 2, viewMode, camera);
      const cellNodes: React.ReactNode[] = [];
      if (viewMode !== 'top') {
        // Real bench geometry — reuse the furniture pewShape recipe via a
        // synthesized item so procedural rows match placed pews exactly.
        // Rows run along x and face the stage (−y → rotation −90°).
        const fakePew = {
          id: `procpew-${i}`, templateId: 'proc-pew', kind: 'pew', category: 'furniture',
          label: 'Pew', x: pew.x + pew.w / 2, y: pew.y + pew.d / 2, z: 0,
          rotation: -90, width: pew.w, depth: pew.d, panelColor: '#4a3522',
        } as EquipmentItem;
        const shape = shape3DFor(fakePew);
        if (shape) {
          cellNodes.push(
            <g key={`pew-${i}`} pointerEvents="none">
              {renderShape3D(shape, pp, {})}
            </g>
          );
        }
      } else {
        const top = pp([
          [pew.x, pew.y, 0],
          [pew.x + pew.w, pew.y, 0],
          [pew.x + pew.w, pew.y + pew.d, 0],
          [pew.x, pew.y + pew.d, 0],
        ]);
        cellNodes.push(
          <polygon key={`pew-${i}`} points={top} fill="rgba(58,44,28,.7)" stroke="rgba(245,166,35,.3)" strokeWidth="0.5"/>
        );
      }

      if (occupied && viewMode === 'iso') {
        const headsCount = Math.max(2, Math.round(pew.w / 1.6));
        for (let k = 0; k < headsCount; k++) {
          const fx = (k + 0.5) / headsCount;
          const px = pew.x + fx * pew.w;
          const py = pew.y + pew.d * 0.5;
          const [hx, hy] = p(px, py, 3.6);
          cellNodes.push(
            <ellipse key={`p${i}-${k}`} cx={hx} cy={hy} rx={2.8} ry={3.4}
              fill="rgba(255,255,255,.55)" stroke="rgba(0,0,0,.4)" strokeWidth="0.4"/>
          );
        }
      }
      pewEntries.push({ depth: cellDepth, node: <g key={`pew-grp-${i}`}>{cellNodes}</g> });
    }
    pewEntries.sort((a, b) => b.depth - a.depth);
    for (const pe of pewEntries) pewNodes.push(pe.node);
  }

  // Mesh overlay — endpoints can project to NaN in walk mode (behind the
  // camera); skip those lines rather than feeding NaN attributes to React.
  const meshNodes: React.ReactNode[] = [];
  if (showMesh) {
    const sx = 6, sy = 8;
    const finite4 = (...ns: number[]) => ns.every(Number.isFinite);
    for (let i = 0; i <= sx; i++) {
      const t = i / sx;
      const x = bb.minX + t * bb.width;
      const [ax, ay] = p(x, bb.minY, 0);
      const [bx2, by2] = p(x, bb.maxY, 0);
      if (!finite4(ax, ay, bx2, by2)) continue;
      meshNodes.push(<line key={`mx-${i}`} x1={ax} y1={ay} x2={bx2} y2={by2} stroke="rgba(46,135,245,.18)" strokeWidth="0.4"/>);
    }
    for (let j = 0; j <= sy; j++) {
      const t = j / sy;
      const y = bb.minY + t * bb.depth;
      const [ax, ay] = p(bb.minX, y, 0);
      const [bx2, by2] = p(bb.maxX, y, 0);
      if (!finite4(ax, ay, bx2, by2)) continue;
      meshNodes.push(<line key={`my-${j}`} x1={ax} y1={ay} x2={bx2} y2={by2} stroke="rgba(46,135,245,.18)" strokeWidth="0.4"/>);
    }
  }

  // Sprint C12 — render interior wall obstacles (balcony fronts, riser
  // fronts, half-walls). Iso/walk: a solid rectangle in 3D between
  // (start, bottomZ) and (end, topZ). Top-down: a thick colored line.
  const wallObstacleNodes: React.ReactNode[] = [];
  const obstacles = room.wallObstacles ?? [];
  if (obstacles.length > 0 && viewMode !== 'top') {
    type Entry = { node: React.ReactNode; depth: number };
    const entries: Entry[] = [];
    obstacles.forEach((w, idx) => {
      const mat = getMaterial(w.materialId);
      const tint = mat?.color ?? '#a89c84';
      const pts: [number, number, number][] = [
        [w.start.x, w.start.y, w.bottomZ],
        [w.end.x,   w.end.y,   w.bottomZ],
        [w.end.x,   w.end.y,   w.topZ],
        [w.start.x, w.start.y, w.topZ],
      ];
      const polyStr = pp(pts);
      const depth = polyDepth(pts, viewMode, camera);
      entries.push({
        depth,
        node: (
          <g key={`wallobs-${w.id}-${idx}`}>
            <polygon points={polyStr} fill={tint} fillOpacity={0.65}
              stroke="rgba(0,0,0,.30)" strokeWidth={0.7}/>
            <polygon points={polyStr} fill="url(#wallGrad)" fillOpacity={0.4} stroke="none"/>
          </g>
        ),
      });
    });
    entries.sort((a, b) => b.depth - a.depth);
    for (const e of entries) wallObstacleNodes.push(e.node);
  } else if (obstacles.length > 0 && viewMode === 'top') {
    obstacles.forEach((w, idx) => {
      const mat = getMaterial(w.materialId);
      const tint = mat?.color ?? '#a89c84';
      const [ax, ay] = p(w.start.x, w.start.y, 0);
      const [bx, by] = p(w.end.x, w.end.y, 0);
      wallObstacleNodes.push(
        <g key={`wallobs-top-${w.id}-${idx}`}>
          <line x1={ax} y1={ay} x2={bx} y2={by} stroke={tint} strokeWidth={4} strokeLinecap="round"/>
          <line x1={ax} y1={ay} x2={bx} y2={by} stroke="rgba(0,0,0,.35)" strokeWidth={1} strokeLinecap="round"/>
        </g>
      );
    });
  }

  const floorMatId = room.surfaces.find(s => s.kind === 'floor')?.materialId ?? 'carpet-thick';
  const floorMat = getMaterial(floorMatId);
  const floorSelected = isSurfSel('floor', 0);

  return (
    <g>
      <g data-surface-kind="floor" data-surface-seg={0} style={{ cursor: 'pointer' }} onClick={onSurfClick('floor', 0)}>
        <clipPath id="rsf-0"><polygon points={floorPts}/></clipPath>
        {/* True material color, dimmed into the scene's dark lighting, with a
            procedural texture (planks / carpet stipple / tile / joints). */}
        <polygon points={floorPts} fill={shadeMat(floorMat.color, 0.45)} stroke="rgba(46,135,245,.25)" strokeWidth="0.6"/>
        <g clipPath="url(#rsf-0)" pointerEvents="none">
          {renderFloorTexture(floorMatId, floorMat.color, shape, p, 4242)}
        </g>
        <polygon points={floorPts} fill="url(#floorGrad)" fillOpacity="0.30" stroke="none" pointerEvents="none"/>
        {floorSelected && (
          <polygon points={floorPts} fill={SURF_SEL_FILL} stroke={SURF_SEL_STROKE} strokeWidth="1.4" strokeDasharray="4 2.5" pointerEvents="none"/>
        )}
      </g>
      {ceilingNode}
      {wallNodes}
      {topWallOutlines}
      {wallObstacleNodes}
      {stageNodes}
      {pewNodes}
      {meshNodes}
    </g>
  );
}

interface HeatmapLayerProps {
  scale: number; viewMode: ViewMode; camera: Camera;
  /** If set, render this heatmap instead of the live one (used by the A/B compare layer). */
  override?: { spl: HeatmapData | null; clarity: HeatmapData | null; arrival: HeatmapData | null };
  /** SVG clipPath ID — wraps the cells so they only render on one side of the wipe. */
  clipId?: string;
  keyPrefix?: string;
}
function HeatmapLayer({ scale, viewMode, camera, override, clipId, keyPrefix = 'hm' }: HeatmapLayerProps) {
  const metric = useStore(s => s.heatmapMetric);
  const liveSpl = useStore(s => s.heatmap);
  const liveClarity = useStore(s => s.clarityHeatmap);
  const liveArrival = useStore(s => s.arrivalHeatmap);
  const liveT30 = useStore(s => s.t30Heatmap);
  const liveModal = useStore(s => s.modalHeatmap);
  const opacity = useStore(s => s.heatmapOpacity);
  const liveSpeakers = useStore(s => s.equipment).filter(e => e.category === 'audio-speaker');
  const { pp } = makeProj(scale, viewMode, camera);
  // For the compare layer, treat the partner snapshot as having speakers (we only have its results).
  if (!override && !liveSpeakers.length) return null;
  const splHeatmap = override ? override.spl : liveSpl;
  const clarityHm = override ? override.clarity : liveClarity;
  const arrivalHm = override ? override.arrival : liveArrival;
  const t30Hm = override ? null : liveT30; // T30 not supported in compare yet
  const modalHm = override ? null : liveModal; // modal not supported in compare yet
  const heatmap =
    metric === 'spl' ? splHeatmap :
    metric === 'arrival' ? arrivalHm :
    metric === 't30' ? t30Hm :
    metric === 'modal' ? modalHm :
    clarityHm;
  if (!heatmap) return null;
  // Modal field is SPL-like, so reuse the SPL colormap.
  const colorFor =
    metric === 'spl' ? splColor :
    metric === 'arrival' ? arrivalColor :
    metric === 't30' ? t30Color :
    metric === 'modal' ? splColor :
    clarityColor;
  const cells: React.ReactNode[] = [];
  const { grid, cellW, cellH, minX, minY, gridX, gridY } = heatmap;
  for (let j = 0; j < gridY; j++) {
    for (let i = 0; i < gridX; i++) {
      const v = grid[j][i];
      if (!isFinite(v)) continue;
      const x0 = minX + i * cellW;
      const y0 = minY + j * cellH;
      const pts = pp([
        [x0, y0, 4],
        [x0 + cellW, y0, 4],
        [x0 + cellW, y0 + cellH, 4],
        [x0, y0 + cellH, 4],
      ]);
      cells.push(<polygon key={`${keyPrefix}-${i}-${j}`} points={pts} fill={colorFor(v)} fillOpacity={opacity} stroke="none"/>);
    }
  }
  return <g style={{ pointerEvents: 'none' }} clipPath={clipId ? `url(#${clipId})` : undefined}>{cells}</g>;
}

interface SpeakerGlyphProps { item: EquipmentItem; scale: number; viewMode: ViewMode; camera: Camera; selected: boolean; showCones: boolean; onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void; onMouseDown: (e: React.MouseEvent) => void; }
function SpeakerGlyph({ item, scale, viewMode, camera, selected, showCones, onClick, onMouseDown, onContextMenu }: SpeakerGlyphProps) {
  const { p, pp } = makeProj(scale, viewMode, camera);
  const [sx, sy] = p(item.x, item.y, item.z);
  const [bx, by] = p(item.x, item.y, 0);
  // Behind the walk camera — the projection returns NaN; skip entirely
  // (React warns on NaN circle/line attributes, and there's nothing to draw).
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
  const aimDeg = item.aim ?? 90;
  const aimRad = aimDeg * Math.PI / 180;
  const half = (item.horiz ?? 90) / 2 * Math.PI / 180;
  const splAt1m = (item.sensitivity != null && item.power != null)
    ? item.sensitivity + 10 * Math.log10(Math.max(1, item.power))
    : (item.maxSPL ?? 130) - 28;
  const dropTo65 = Math.max(splAt1m - 65, 0);
  const reach = Math.min(80, Math.max(15, Math.pow(10, dropTo65 / 20) * 3.28));
  const lx = Math.cos(aimRad + half) * reach;
  const ly = Math.sin(aimRad + half) * reach;
  const rx = Math.cos(aimRad - half) * reach;
  const ry = Math.sin(aimRad - half) * reach;
  const conePts = pp([
    [item.x, item.y, 0.05],
    [item.x + lx, item.y + ly, 0.05],
    [item.x + rx, item.y + ry, 0.05],
  ]);

  const isSub = item.kind === 'speaker-sub' || item.kind === 'speaker-sub-flown';
  const fillColor = selected ? '#F5A623' : (isSub ? '#143F99' : '#1A4FBF');
  const opacity = item.muted ? 0.35 : 1;

  // 3D shape body (iso/walk views). Top-down keeps the simpler 2D icon
  // since a 3D box projected straight down is just a rectangle.
  const shape = viewMode !== 'top' ? shape3DFor(item) : null;

  return (
    <g style={{ cursor: 'move', opacity }}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}>
      {showCones && !isSub && !item.muted && (
        <polygon points={conePts}
          fill={selected ? 'rgba(245,166,35,.15)' : 'rgba(46,135,245,.10)'}
          stroke={selected ? 'rgba(245,166,35,.6)' : 'rgba(46,135,245,.4)'}
          strokeWidth="0.5" strokeDasharray="3 2" pointerEvents="none"/>
      )}
      <circle cx={bx} cy={by} r={2.5} fill="rgba(26,79,191,.3)" stroke="rgba(26,79,191,.6)" strokeWidth="0.5"/>
      <line x1={bx} y1={by} x2={sx} y2={sy} stroke={selected ? '#F5A623' : 'rgba(46,135,245,.45)'} strokeWidth="0.8" strokeDasharray="2 2"/>
      {shape ? (
        <>
          {renderShape3D(shape, pp, { selected, muted: item.muted })}
          {item.soloed && (
            <circle cx={sx} cy={sy} r={16} fill="none" stroke="#F5A623" strokeWidth="1.5" strokeDasharray="2 2" pointerEvents="none"/>
          )}
          {item.muted && (
            <line x1={sx - 10} y1={sy - 12} x2={sx + 10} y2={sy + 12} stroke="#C53030" strokeWidth="2" pointerEvents="none"/>
          )}
        </>
      ) : (
        <g transform={`translate(${sx}, ${sy})`}>
          {item.soloed && (
            <circle r={13} fill="none" stroke="#F5A623" strokeWidth="2" strokeDasharray="2 2"/>
          )}
          <rect x={-7} y={-9} width={14} height={18} rx={2} fill={fillColor} stroke="#fff" strokeWidth="0.8"/>
          <circle cx={0} cy={-3} r={3.2} fill="#0B0E12" stroke="rgba(255,255,255,.5)" strokeWidth="0.5"/>
          <circle cx={0} cy={4} r={2.0} fill="#0B0E12" stroke="rgba(255,255,255,.4)" strokeWidth="0.4"/>
          {item.muted && (
            <line x1={-9} y1={-11} x2={9} y2={11} stroke="#C53030" strokeWidth="2"/>
          )}
        </g>
      )}
    </g>
  );
}

interface PanelGlyphProps { item: EquipmentItem; scale: number; viewMode: ViewMode; camera: Camera; selected: boolean; onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void; onMouseDown: (e: React.MouseEvent) => void; }
function PanelGlyph({ item, scale, viewMode, camera, selected, onClick, onMouseDown, onContextMenu }: PanelGlyphProps) {
  const room = useStore(s => s.room);
  const { pp } = makeProj(scale, viewMode, camera);
  const w = item.panelW ?? 4;
  const h = item.panelH ?? 2;
  const wall = item.wall ?? 'L';
  const z = item.z;
  const bb = bboxOf(room.shape);
  let pts: [number, number, number][];
  if (wall === 'L') {
    pts = [[bb.minX, item.y, z], [bb.minX, item.y + w, z], [bb.minX, item.y + w, z + h], [bb.minX, item.y, z + h]];
  } else if (wall === 'R') {
    pts = [[bb.maxX, item.y, z], [bb.maxX, item.y + w, z], [bb.maxX, item.y + w, z + h], [bb.maxX, item.y, z + h]];
  } else if (wall === 'B') {
    pts = [[item.x, bb.maxY, z], [item.x + w, bb.maxY, z], [item.x + w, bb.maxY, z + h], [item.x, bb.maxY, z + h]];
  } else if (wall === 'F') {
    pts = [[item.x, bb.minY, z], [item.x + w, bb.minY, z], [item.x + w, bb.minY, z + h], [item.x, bb.minY, z + h]];
  } else {
    pts = [
      [item.x, item.y, room.height - 0.1],
      [item.x + w, item.y, room.height - 0.1],
      [item.x + w, item.y + h, room.height - 0.1],
      [item.x, item.y + h, room.height - 0.1],
    ];
  }
  const poly = pp(pts);
  // Brand-aware base color: prefer the template's panelColor (fabric color
  // chosen by the manufacturer's product line) over the legacy per-kind
  // amber fallback. Selection still wins.
  const isTrap = item.kind === 'bass-trap';
  const isDiff = item.kind === 'diffuser';
  const baseColor = item.panelColor
    ?? (isTrap ? '#3F4451' : isDiff ? '#7A4A2A' : DEFAULT_PANEL_COLOR);
  // For viewport top-down view the pattern is invisible (we're looking
  // straight down on a wall-mounted panel from above), so we still paint
  // the base polygon but skip the heavy pattern overlay.
  const patternNodes = viewMode === 'top'
    ? null
    : renderPanelPattern(item.panelPattern, pts, pp, baseColor);
  return (
    <g style={{ cursor: 'move' }} onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}>
      <polygon
        points={poly}
        fill={selected ? '#F5A623' : baseColor}
        fillOpacity={selected ? 0.85 : 1}
        stroke={selected ? '#F5A623' : 'rgba(0,0,0,.45)'}
        strokeWidth="0.6"
      />
      {patternNodes}
      {selected && (
        // Re-stroke the panel outline on top of the pattern so the
        // selection highlight stays visible.
        <polygon
          points={poly}
          fill="none"
          stroke="#F5A623"
          strokeWidth="0.9"
          pointerEvents="none"
        />
      )}
    </g>
  );
}

/**
 * Compute the polygon where a lighting fixture's beam cone hits the floor (z=0).
 * Returns null if the beam doesn't reach the floor (e.g. fixture pointing up,
 * or fixture is at floor level). Used to draw beam pools in the viewport.
 */
function lightingBeamPool(item: EquipmentItem): [number, number, number][] | null {
  if (item.z <= 0.05) return null;
  const beamDeg = item.beamAngleDeg
    ?? (item.kind === 'mh-spot' ? 15
       : item.kind === 'mh-wash' ? 35
       : item.kind === 'followspot' ? 8
       : 30);
  const tiltDeg = item.tilt ?? -45;
  const aimDeg = item.aim ?? 90;
  if (tiltDeg >= -2) return null; // fixture not aimed downward enough — no floor pool

  const aim = aimDeg * Math.PI / 180;
  const tilt = tiltDeg * Math.PI / 180;
  const halfBeam = (beamDeg / 2) * Math.PI / 180;

  // Forward axis (the cone's centerline) in world coords
  const Fx = Math.cos(aim) * Math.cos(tilt);
  const Fy = Math.sin(aim) * Math.cos(tilt);
  const Fz = Math.sin(tilt);
  // Right axis (horizontal, perpendicular to aim direction)
  const Rx = -Math.sin(aim);
  const Ry = Math.cos(aim);
  const Rz = 0;
  // Up = R × F  (the cone's local "up" in fixture frame)
  const Ux = Ry * Fz - Rz * Fy;
  const Uy = Rz * Fx - Rx * Fz;
  const Uz = Rx * Fy - Ry * Fx;

  const N = 24;
  const cb = Math.cos(halfBeam), sb = Math.sin(halfBeam);
  const points: [number, number, number][] = [];
  for (let i = 0; i < N; i++) {
    const phi = (i / N) * 2 * Math.PI;
    const cphi = Math.cos(phi), sphi = Math.sin(phi);
    const rayX = cb * Fx + sb * (cphi * Rx + sphi * Ux);
    const rayY = cb * Fy + sb * (cphi * Ry + sphi * Uy);
    const rayZ = cb * Fz + sb * (cphi * Rz + sphi * Uz);
    if (rayZ >= -0.001) continue; // ray pointing up — won't hit floor
    const t = -item.z / rayZ;
    if (t <= 0 || t > 250) continue;
    points.push([item.x + rayX * t, item.y + rayY * t, 0.02]);
  }
  return points.length >= 3 ? points : null;
}

interface VideoLightingGlyphProps { item: EquipmentItem; scale: number; viewMode: ViewMode; camera: Camera; selected: boolean; showCones: boolean; onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void; onMouseDown: (e: React.MouseEvent) => void; }
function VideoLightingGlyph({ item, scale, viewMode, camera, selected, showCones, onClick, onMouseDown, onContextMenu }: VideoLightingGlyphProps) {
  const { p, pp } = makeProj(scale, viewMode, camera);
  const [sx, sy] = p(item.x, item.y, item.z);
  const [bx, by] = p(item.x, item.y, 0);
  // Behind the walk camera — nothing to draw, and NaN attrs trip React.
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
  const colorMap: Record<string, string> = {
    'projector': '#2E87F5', 'led-wall': '#1E6FD9',
    'ptz-camera': '#A855F7', 'cam-handheld': '#A855F7',
    'confidence-monitor': '#10B981',
    'mh-spot': '#FBBF24', 'mh-wash': '#F59E0B',
    'led-par': '#F97316', 'followspot': '#FCD34D',
    'lx-console': '#EAB308', 'dimmer-rack': '#65A30D',
    'foh-console': '#3B82F6', 'monitor-console': '#06B6D4',
    'amp-rack': '#6366F1', 'snake': '#94A3B8', 'dsp': '#0EA5E9',
    'rack': '#475569', 'pdu': '#22D3EE', 'cable-run': '#94A3B8',
  };
  const fill = selected ? '#F5A623' : (colorMap[item.kind] ?? '#3B82F6');
  const isLight = item.kind === 'mh-spot' || item.kind === 'mh-wash'
    || item.kind === 'led-par' || item.kind === 'followspot';
  const pool = (isLight && showCones && !item.muted) ? lightingBeamPool(item) : null;
  // 3D shape body (iso/walk views). Top-down falls back to flat icon.
  const shape = viewMode !== 'top' ? shape3DFor(item) : null;
  return (
    <g style={{ cursor: 'move' }} onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}>
      {pool && (() => {
        const pts = pp(pool);
        return (
          <>
            <polygon points={pts}
              fill={selected ? 'rgba(245,166,35,.28)' : `${fill}40`}
              stroke={selected ? 'rgba(245,166,35,.7)' : fill}
              strokeOpacity={0.55}
              strokeWidth="0.6" strokeDasharray="2.5 2" pointerEvents="none"/>
            {/* Centerline from fixture to pool centroid */}
            {(() => {
              const cx = pool.reduce((s, p2) => s + p2[0], 0) / pool.length;
              const cy = pool.reduce((s, p2) => s + p2[1], 0) / pool.length;
              const [tx, ty] = p(cx, cy, 0);
              return (
                <line x1={sx} y1={sy} x2={tx} y2={ty}
                  stroke={fill} strokeOpacity={0.5} strokeWidth="0.6"
                  strokeDasharray="1.5 1.5" pointerEvents="none"/>
              );
            })()}
          </>
        );
      })()}
      <circle cx={bx} cy={by} r={2.5} fill={fill} fillOpacity="0.3" stroke={fill} strokeWidth="0.5"/>
      <line x1={bx} y1={by} x2={sx} y2={sy} stroke={fill} strokeWidth="0.8" strokeDasharray="2 2"/>
      {shape ? (
        renderShape3D(shape, pp, { selected, muted: item.muted })
      ) : (
        <g transform={`translate(${sx}, ${sy})`}>
          <rect x={-6} y={-6} width={12} height={12} rx={2} fill={fill} stroke="#fff" strokeWidth="0.7"/>
        </g>
      )}
    </g>
  );
}

interface ReferencePointGlyphProps { item: EquipmentItem; scale: number; viewMode: ViewMode; camera: Camera; selected: boolean; onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void; onMouseDown: (e: React.MouseEvent) => void; }
function ReferencePointGlyph({ item, scale, viewMode, camera, selected, onClick, onMouseDown, onContextMenu }: ReferencePointGlyphProps) {
  const { p } = makeProj(scale, viewMode, camera);
  const [sx, sy] = p(item.x, item.y, item.z);
  const [bx, by] = p(item.x, item.y, 0);
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
  return (
    <g pointerEvents="auto" style={{ cursor: 'move' }} onMouseDown={onMouseDown}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}>
      <line x1={bx} y1={by} x2={sx} y2={sy} stroke="rgba(245,166,35,.5)" strokeWidth="0.5" strokeDasharray="1.5 1"/>
      <circle cx={bx} cy={by} r={2} fill="rgba(245,166,35,.3)" stroke="#F5A623" strokeWidth="0.5"/>
      <circle cx={sx} cy={sy} r={4} fill={selected ? '#fff' : '#F5A623'} stroke="#fff" strokeWidth="0.7"/>
      <circle cx={sx} cy={sy} r={1.5} fill="#12151A"/>
    </g>
  );
}

/** Perimeter / total length of a truss in linear feet (for BOM math). */
export function trussLengthFt(item: EquipmentItem): number {
  if (item.kind === 'truss-straight') return item.trussLengthFt ?? 10;
  if (item.kind === 'truss-square') {
    const w = item.trussWidthFt ?? 16;
    const d = item.trussDepthFt ?? 16;
    return 2 * (w + d);
  }
  if (item.kind === 'truss-circle') {
    const dia = item.trussDiameterFt ?? 12;
    return Math.PI * dia;
  }
  return 0;
}

/** Returns the (x,y,z) corners that define the truss in world coords — used both for
 *  rendering and for hit-testing the parentage drag-children logic. */
export function trussWorldPoints(item: EquipmentItem): [number, number, number][] {
  const aimRad = (item.rotation ?? 0) * Math.PI / 180;
  const c = Math.cos(aimRad), s = Math.sin(aimRad);
  if (item.kind === 'truss-straight') {
    const L = item.trussLengthFt ?? 10;
    const half = L / 2;
    const dx = c * half, dy = s * half;
    return [[item.x - dx, item.y - dy, item.z], [item.x + dx, item.y + dy, item.z]];
  }
  if (item.kind === 'truss-square') {
    const w = (item.trussWidthFt ?? 16) / 2;
    const d = (item.trussDepthFt ?? 16) / 2;
    // Local corners (CCW): (+w,+d) (-w,+d) (-w,-d) (+w,-d)
    const corners: [number, number][] = [[+w, +d], [-w, +d], [-w, -d], [+w, -d]];
    return corners.map(([lx, ly]) => {
      const wx = item.x + (c * lx - s * ly);
      const wy = item.y + (s * lx + c * ly);
      return [wx, wy, item.z];
    });
  }
  if (item.kind === 'truss-circle') {
    const r = (item.trussDiameterFt ?? 12) / 2;
    const N = 24;
    const out: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 2 * Math.PI;
      out.push([item.x + r * Math.cos(a), item.y + r * Math.sin(a), item.z]);
    }
    return out;
  }
  return [[item.x, item.y, item.z]];
}

/** True iff this item is a truss kind that can host hung equipment. */
export function isTrussKind(kind: string): boolean {
  return kind === 'truss-straight' || kind === 'truss-square' || kind === 'truss-circle';
}

/** Items that should NEVER snap to a truss — walls/panels, references,
 *  cables, the trusses themselves, and IEM transmitters (they go in racks). */
function canSnapToTruss(item: EquipmentItem): boolean {
  if (isTrussKind(item.kind)) return false;
  if (item.category === 'acoustic') return false;
  if (item.category === 'reference') return false;
  if (item.kind === 'cable-run') return false;
  if (item.kind === 'speaker-iem') return false;
  if (item.kind === 'speaker-ceiling') return false;
  if (item.kind === 'speaker-sub' || item.kind === 'speaker-sub-flown') {
    // Subs ground-stack typically; flown subs CAN go on a truss but
    // most subs are placed on stage floor. Allow only flown subs.
    return item.kind === 'speaker-sub-flown';
  }
  return true;
}

/**
 * Closest point on a truss to a given (x, y) — works for all 3 truss
 * shapes. Returns the snap point in world coords + the distance to it.
 *
 *  • Straight: segment between trussWorldPoints[0..1]
 *  • Square:   perimeter of the rotated rectangle (4 segments)
 *  • Circle:   nearest point on the ring at the given radius
 */
export function closestPointOnTruss(
  truss: EquipmentItem,
  x: number, y: number,
): { x: number; y: number; z: number; dist: number } {
  if (truss.kind === 'truss-straight') {
    const pts = trussWorldPoints(truss);
    const [a, b] = pts;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 < 1e-6 ? 0 : ((x - a[0]) * dx + (y - a[1]) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = a[0] + t * dx, py = a[1] + t * dy;
    return { x: px, y: py, z: truss.z, dist: Math.hypot(x - px, y - py) };
  }
  if (truss.kind === 'truss-square') {
    const corners = trussWorldPoints(truss);
    let bestDist = Infinity;
    let bestX = corners[0][0], bestY = corners[0][1];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      let t = len2 < 1e-6 ? 0 : ((x - a[0]) * dx + (y - a[1]) * dy) / len2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = a[0] + t * dx, py = a[1] + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d < bestDist) { bestDist = d; bestX = px; bestY = py; }
    }
    return { x: bestX, y: bestY, z: truss.z, dist: bestDist };
  }
  if (truss.kind === 'truss-circle') {
    // TODO(3D-tilt): assumes the circle's plane is horizontal (parallel
    // to the floor) — only x/y are projected onto the ring and z is taken
    // straight from truss.z. If circular trusses ever gain a tilt /
    // rotation-axis spec (e.g. a banked DJ ring), this needs to project
    // the click point onto the truss's local plane and use the in-plane
    // closest point. For now trusses are flat in the world XY plane so
    // the simpler radial math is correct.
    const r = (truss.trussDiameterFt ?? 12) / 2;
    const dx = x - truss.x, dy = y - truss.y;
    const distFromCenter = Math.hypot(dx, dy);
    if (distFromCenter < 1e-3) {
      // Point is at center — snap to "right" side of ring as a default.
      return { x: truss.x + r, y: truss.y, z: truss.z, dist: r };
    }
    const px = truss.x + (dx / distFromCenter) * r;
    const py = truss.y + (dy / distFromCenter) * r;
    return { x: px, y: py, z: truss.z, dist: Math.abs(distFromCenter - r) };
  }
  return { x: truss.x, y: truss.y, z: truss.z, dist: Infinity };
}

/** Snap radius in world feet — when an item is being dragged within this
 *  distance of any truss, it auto-attaches. ~2.5 ft is generous enough that
 *  the snap "catches" naturally on drop without requiring pixel-perfect aim. */
export const TRUSS_SNAP_RADIUS_FT = 2.5;

/** Tolerance in world feet for alignment-guide snap (item-to-item x/y align).
 *  Tight enough that snap doesn't feel magnetic everywhere; loose enough to
 *  catch when the user is going for clean alignment. ~7 inches. */
export const ALIGNMENT_SNAP_TOLERANCE_FT = 0.6;

export interface AlignmentSnapResult {
  /** When set, the dragged item's x should snap to this world value
   *  (matching alignedToXId's x). */
  x?: number;
  /** When set, the dragged item's y should snap to this world value. */
  y?: number;
  /** The item whose x value drove the snap. */
  alignedToXId?: string;
  /** The item whose y value drove the snap. */
  alignedToYId?: string;
}

/**
 * Find the nearest other item whose x and/or y matches the dragged item's
 * candidate position within `toleranceFt`. Returns the snap coords + the
 * source-item ids so the AlignmentGuidesLayer can render guide lines and
 * mark the source item.
 *
 * Excludes:
 *   • The dragged item itself
 *   • Items that are children of the dragged item (truss-mounted gear
 *     moves with its parent and shouldn't drag the parent into alignment
 *     with itself)
 *   • Reference points (logical-only — would feel weird to align to)
 */
export function findAlignmentSnap(
  draggedId: string,
  newX: number,
  newY: number,
  equipment: EquipmentItem[],
  toleranceFt: number = ALIGNMENT_SNAP_TOLERANCE_FT,
): AlignmentSnapResult {
  let bestX: { x: number; id: string; dist: number } | null = null;
  let bestY: { y: number; id: string; dist: number } | null = null;
  for (const it of equipment) {
    if (it.id === draggedId) continue;
    if (it.parentId === draggedId) continue;
    if (it.category === 'reference') continue;
    const dx = Math.abs(newX - it.x);
    const dy = Math.abs(newY - it.y);
    if (dx < toleranceFt && (!bestX || dx < bestX.dist)) {
      bestX = { x: it.x, id: it.id, dist: dx };
    }
    if (dy < toleranceFt && (!bestY || dy < bestY.dist)) {
      bestY = { y: it.y, id: it.id, dist: dy };
    }
  }
  return {
    x: bestX?.x,
    y: bestY?.y,
    alignedToXId: bestX?.id,
    alignedToYId: bestY?.id,
  };
}

/**
 * Find the nearest truss to a given world (x, y) and return the snap result
 * if it's within `TRUSS_SNAP_RADIUS_FT`. Returns null if no truss is close
 * enough or the item isn't trussable.
 */
export function findTrussSnap(
  item: EquipmentItem,
  x: number, y: number,
  equipment: EquipmentItem[],
): { trussId: string; snapX: number; snapY: number; snapZ: number; dist: number } | null {
  if (!canSnapToTruss(item)) return null;
  let best: { trussId: string; snapX: number; snapY: number; snapZ: number; dist: number } | null = null;
  for (const t of equipment) {
    if (!isTrussKind(t.kind)) continue;
    if (t.id === item.id) continue;
    const r = closestPointOnTruss(t, x, y);
    if (r.dist > TRUSS_SNAP_RADIUS_FT) continue;
    if (!best || r.dist < best.dist) {
      best = { trussId: t.id, snapX: r.x, snapY: r.y, snapZ: r.z, dist: r.dist };
    }
  }
  return best;
}

interface TrussGlyphProps {
  item: EquipmentItem; scale: number; viewMode: ViewMode; camera: Camera; selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}
function TrussGlyph({ item, scale, viewMode, camera, selected, onClick, onMouseDown, onContextMenu }: TrussGlyphProps) {
  const { p, pp } = makeProj(scale, viewMode, camera);
  const [bx, by] = p(item.x, item.y, 0);
  const [sx, sy] = p(item.x, item.y, item.z);
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
  const stroke = selected ? '#F5A623' : '#9CA3AF';   // grey aluminum / amber when selected
  const fill   = selected ? 'rgba(245,166,35,.10)' : 'rgba(156,163,175,.10)';

  let shapeNode: React.ReactNode = null;
  if (item.kind === 'truss-straight') {
    const pts = trussWorldPoints(item);
    const [a, b] = pts.map(pt => p(pt[0], pt[1], pt[2]));
    // Render as a thicker bar with dashes that read as truss chords.
    shapeNode = (
      <>
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={stroke} strokeWidth={5} strokeLinecap="square"/>
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#fff" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="3 3"/>
        {/* End caps */}
        {[a, b].map((pt, i) => (
          <circle key={i} cx={pt[0]} cy={pt[1]} r={2.5} fill={stroke} stroke="#fff" strokeWidth={0.8}/>
        ))}
      </>
    );
  } else if (item.kind === 'truss-square') {
    const corners = trussWorldPoints(item);
    const polyStr = pp(corners);
    shapeNode = (
      <>
        <polygon points={polyStr} fill={fill} stroke={stroke} strokeWidth={3} strokeLinejoin="miter"/>
        <polygon points={polyStr} fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={0.8} strokeDasharray="3 3"/>
      </>
    );
  } else if (item.kind === 'truss-circle') {
    const corners = trussWorldPoints(item);
    const polyStr = pp(corners);
    shapeNode = (
      <>
        <polygon points={polyStr} fill={fill} stroke={stroke} strokeWidth={3}/>
        <polygon points={polyStr} fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={0.8} strokeDasharray="3 3"/>
      </>
    );
  }

  return (
    <g
      style={{ cursor: 'move' }}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}>
      {/* Floor projection / hang line */}
      <line x1={bx} y1={by} x2={sx} y2={sy} stroke="rgba(156,163,175,.45)" strokeWidth={0.6} strokeDasharray="2 2"/>
      <circle cx={bx} cy={by} r={2} fill="rgba(156,163,175,.4)" stroke="rgba(156,163,175,.7)" strokeWidth={0.5}/>
      {shapeNode}
    </g>
  );
}

/**
 * MountingPointsLayer — draws a small "clamp" marker at the attachment
 * point of every truss-mounted item. The clamp is a horizontal bar with
 * two short tabs reaching down to the item's body, suggesting a real
 * truss-to-fixture clamp (e.g., Atom or Doughty mini clamp).
 *
 * Clamps appear automatically whenever an item has `parentId` set — which
 * happens during snap-to-truss drag and persists after drop. Walking
 * away from the truss (drag > TRUSS_SNAP_RADIUS_FT) clears parentId, and
 * the clamp disappears.
 */
function MountingPointsLayer({ scale, viewMode, camera }: { scale: number; viewMode: ViewMode; camera: Camera }) {
  const equipment = useStore(s => s.equipment);
  const isWalk = viewMode === 'walk';
  const { p } = makeProj(scale, viewMode, camera);
  const children = equipment.filter(e => e.parentId);
  if (children.length === 0) return null;
  // Top-down view: render a small dot. Iso/walk: render a horizontal
  // clamp bar at the truss z, with two short straps descending to the
  // mounted item's body.
  return (
    <g pointerEvents="none">
      {children.map(item => {
        const truss = equipment.find(e => e.id === item.parentId);
        if (!truss) return null;
        const trussZ = truss.z;
        const [tx, ty] = p(item.x, item.y, trussZ);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null; // behind walk camera
        if (viewMode === 'top') {
          return (
            <circle key={`mnt-${item.id}`} cx={tx} cy={ty} r={1.6}
              fill="#4B5563" stroke="#9CA3AF" strokeWidth={0.4}/>
          );
        }
        // Iso/walk: clamp bar at truss z + straps reaching down to item
        const ang = (truss.kind === 'truss-straight' ? (truss.rotation ?? 0) : 0) * Math.PI / 180;
        const c = Math.cos(ang), s = Math.sin(ang);
        // Build a small horizontal bar oriented along the truss direction
        // (for circles/squares we just use the world axis since the bar
        // is small enough that it reads ok regardless).
        const halfBarLen = 0.55;     // ft — bar straddles the mount point
        const barEndA = p(item.x - c * halfBarLen, item.y - s * halfBarLen, trussZ);
        const barEndB = p(item.x + c * halfBarLen, item.y + s * halfBarLen, trussZ);
        // Strap end-points just above the item body
        const strapZ = isWalk ? trussZ : trussZ - 0.25;
        const strapL = p(item.x - c * 0.35, item.y - s * 0.35, strapZ);
        const strapR = p(item.x + c * 0.35, item.y + s * 0.35, strapZ);
        return (
          <g key={`mnt-${item.id}`}>
            {/* Clamp bar */}
            <line x1={barEndA[0]} y1={barEndA[1]} x2={barEndB[0]} y2={barEndB[1]}
              stroke="#1F2937" strokeWidth={1.6} strokeLinecap="round"/>
            <line x1={barEndA[0]} y1={barEndA[1]} x2={barEndB[0]} y2={barEndB[1]}
              stroke="#9CA3AF" strokeWidth={0.6} strokeLinecap="round"/>
            {/* Two thin straps reaching from the bar down to the item body */}
            <line x1={strapL[0]} y1={strapL[1]} x2={tx} y2={ty}
              stroke="#1F2937" strokeWidth={0.6}/>
            <line x1={strapR[0]} y1={strapR[1]} x2={tx} y2={ty}
              stroke="#1F2937" strokeWidth={0.6}/>
            {/* Bolt heads at the top of each strap */}
            <circle cx={strapL[0]} cy={strapL[1]} r={0.7} fill="#374151" stroke="#9CA3AF" strokeWidth={0.3}/>
            <circle cx={strapR[0]} cy={strapR[1]} r={0.7} fill="#374151" stroke="#9CA3AF" strokeWidth={0.3}/>
          </g>
        );
      })}
    </g>
  );
}

/**
 * AlignmentGuidesLayer — renders the dashed amber guides that appear
 * during a drag whenever the dragged item is aligned with another item's
 * x or y. A small ring marker on the source item shows what's driving
 * the alignment so the user knows what they're snapping to.
 *
 * Lines span the room's bounding box at the drawn axis. Guides only
 * render while alignment is active; they disappear on drag-end.
 */
function AlignmentGuidesLayer({
  snap, scale, viewMode, camera,
}: {
  snap: AlignmentSnapResult | null;
  scale: number;
  viewMode: ViewMode;
  camera: Camera;
}) {
  const equipment = useStore(s => s.equipment);
  const room = useStore(s => s.room);
  if (!snap) return null;
  const hasX = snap.x != null && snap.alignedToXId;
  const hasY = snap.y != null && snap.alignedToYId;
  if (!hasX && !hasY) return null;
  const { p } = makeProj(scale, viewMode, camera);
  const bb = bboxOf(room.shape);
  // Padding so guides extend slightly past the room edge for clarity.
  const PAD = 4;
  const minX = bb.minX - PAD, maxX = bb.maxX + PAD;
  const minY = bb.minY - PAD, maxY = bb.maxY + PAD;
  const ELEMENTS: React.ReactNode[] = [];

  // Vertical guide (constant x)
  if (hasX) {
    const sourceItem = equipment.find(e => e.id === snap.alignedToXId);
    const guideZ = 0.05;     // floor plane
    const a = p(snap.x!, minY, guideZ);
    const b = p(snap.x!, maxY, guideZ);
    ELEMENTS.push(
      <line key="align-x" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
        stroke="#F5A623" strokeWidth={0.6}
        strokeDasharray="4 3"
        strokeOpacity={0.85}
        pointerEvents="none"/>,
    );
    // Source-item ring marker
    if (sourceItem) {
      const [tx, ty] = p(sourceItem.x, sourceItem.y, sourceItem.z);
      ELEMENTS.push(
        <circle key="align-x-src" cx={tx} cy={ty} r={9}
          fill="none" stroke="#F5A623" strokeWidth={1.4}
          strokeDasharray="2 2"
          pointerEvents="none"/>,
      );
    }
  }

  // Horizontal guide (constant y)
  if (hasY) {
    const sourceItem = equipment.find(e => e.id === snap.alignedToYId);
    const guideZ = 0.05;
    const a = p(minX, snap.y!, guideZ);
    const b = p(maxX, snap.y!, guideZ);
    ELEMENTS.push(
      <line key="align-y" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
        stroke="#F5A623" strokeWidth={0.6}
        strokeDasharray="4 3"
        strokeOpacity={0.85}
        pointerEvents="none"/>,
    );
    if (sourceItem) {
      const [tx, ty] = p(sourceItem.x, sourceItem.y, sourceItem.z);
      ELEMENTS.push(
        <circle key="align-y-src" cx={tx} cy={ty} r={9}
          fill="none" stroke="#F5A623" strokeWidth={1.4}
          strokeDasharray="2 2"
          pointerEvents="none"/>,
      );
    }
  }

  return <g>{ELEMENTS}</g>;
}

interface ConnectionsLayerProps { scale: number; viewMode: ViewMode; camera: Camera; }
function ConnectionsLayer({ scale, viewMode, camera }: ConnectionsLayerProps) {
  const connections = useStore(s => s.connections);
  const equipment = useStore(s => s.equipment);
  const wiringMode = useStore(s => s.wiringMode);
  const wiringStartId = useStore(s => s.wiringStartId);
  const setSelected = useStore(s => s.setSelected);
  const deleteConnection = useStore(s => s.deleteConnection);
  const { p } = makeProj(scale, viewMode, camera);
  if (connections.length === 0 && !wiringStartId) return null;

  const lineFor = (conn: Connection) => {
    const a = equipment.find(e => e.id === conn.fromId);
    const b = equipment.find(e => e.id === conn.toId);
    if (!a || !b) return null;
    const spec = CABLE_SPECS[conn.cableType];
    const [ax, ay] = p(a.x, a.y, a.z);
    const [bx, by] = p(b.x, b.y, b.z);
    // Mid-control point pulls the cable into a slight curve so overlapping
    // links don't render as a single straight line.
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const bow = Math.min(40, len * 0.12);
    const mx = (ax + bx) / 2 + nx * bow;
    const my = (ay + by) / 2 + ny * bow;
    return (
      <g key={conn.id}
        style={{ cursor: wiringMode ? 'default' : 'pointer', pointerEvents: 'auto' }}
        onClick={(e) => {
          e.stopPropagation();
          if (wiringMode) return;
          setSelected(conn.toId);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Undoable — delete directly, no blocking confirm.
          deleteConnection(conn.id);
          useStore.getState().setHint(`${spec.label} connection deleted — Cmd+Z to undo`);
        }}>
        <path d={`M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`}
          stroke={spec.color} strokeWidth={2.4} fill="none" strokeLinecap="round"
          opacity={0.85}/>
        <path d={`M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`}
          stroke="transparent" strokeWidth={10} fill="none"/>
        {/* Cable type label at the curve apex */}
        <g transform={`translate(${mx}, ${my})`} style={{ pointerEvents: 'none' }}>
          <rect x={-14} y={-7} width={28} height={14} rx={3}
            fill={spec.color} opacity={0.92}/>
          <text x={0} y={3} textAnchor="middle"
            fontFamily="Montserrat" fontWeight={700} fontSize={9}
            fill="#fff" letterSpacing="0.5">
            {spec.label.toUpperCase()}
          </text>
        </g>
      </g>
    );
  };

  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Active connections */}
      {connections.map(lineFor)}
      {/* Hint glow on the wiring start point */}
      {wiringStartId && (() => {
        const a = equipment.find(e => e.id === wiringStartId);
        if (!a) return null;
        const [ax, ay] = p(a.x, a.y, a.z);
        return (
          <g style={{ pointerEvents: 'none' }}>
            <circle cx={ax} cy={ay} r={14} fill="none" stroke="#F5A623" strokeWidth={2}
              strokeDasharray="3 2" opacity={0.9}>
              <animate attributeName="r" from="10" to="18" dur="1.2s" repeatCount="indefinite"/>
              <animate attributeName="opacity" from="0.9" to="0" dur="1.2s" repeatCount="indefinite"/>
            </circle>
            <circle cx={ax} cy={ay} r={5} fill="#F5A623" stroke="#fff" strokeWidth={1.5}/>
          </g>
        );
      })()}
    </g>
  );
}

function AnnotationsLayer({ scale, viewMode, camera }: { scale: number; viewMode: ViewMode; camera: Camera }) {
  const annotations = useStore(s => s.annotations);
  const updateAnnotation = useStore(s => s.updateAnnotation);
  const deleteAnnotation = useStore(s => s.deleteAnnotation);
  const { p } = makeProj(scale, viewMode, camera);
  return (
    <g>
      {annotations.map(a => {
        const [tipX, tipY] = p(a.x, a.y, 0);
        const [topX, topY] = p(a.x, a.y, a.z + 2);
        return (
          <g key={a.id} style={{ cursor: 'pointer', pointerEvents: 'auto' }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const next = window.prompt('Annotation note', a.text);
              if (next === null) return;
              if (next.trim() === '') deleteAnnotation(a.id);
              else updateAnnotation(a.id, { text: next });
            }}>
            <line x1={tipX} y1={tipY} x2={topX} y2={topY}
              stroke={a.color} strokeWidth="0.8" strokeDasharray="2 2"/>
            <circle cx={tipX} cy={tipY} r={2.5} fill={a.color} stroke="#fff" strokeWidth="0.8"/>
            <circle cx={topX} cy={topY} r={6} fill={a.color} stroke="#fff" strokeWidth="1.4"/>
            <text x={topX} y={topY + 1.5} fill="#fff" fontSize="8" fontFamily="Montserrat" fontWeight="700"
              textAnchor="middle">!</text>
            {a.text && (
              <foreignObject x={topX + 8} y={topY - 14} width={200} height={28}>
                <div style={{
                  display: 'inline-block',
                  background: 'rgba(18,21,26,0.92)', color: '#fff',
                  border: `1px solid ${a.color}`,
                  padding: '3px 9px', borderRadius: 999,
                  fontFamily: 'Open Sans', fontSize: 11.5,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  maxWidth: 200,
                }}>{a.text}</div>
              </foreignObject>
            )}
          </g>
        );
      })}
    </g>
  );
}

function FloorPlanLayer({ scale, viewMode, camera }: { scale: number; viewMode: ViewMode; camera: Camera }) {
  const fp = useStore(s => s.room.floorPlan);
  const { p } = makeProj(scale, viewMode, camera);
  if (!fp) return null;
  // Compute the projected positions of the 4 image corners on the floor.
  const x0 = fp.offsetX, y0 = fp.offsetY;
  const x1 = fp.offsetX + fp.widthFt, y1 = fp.offsetY + fp.heightFt;
  // Apply rotation around the image's center in world space
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rad = (fp.rotation || 0) * Math.PI / 180;
  const rot = (px: number, py: number): [number, number] => {
    const dx = px - cx, dy = py - cy;
    return [cx + dx * Math.cos(rad) - dy * Math.sin(rad), cy + dx * Math.sin(rad) + dy * Math.cos(rad)];
  };
  const [aX, aY] = rot(x0, y0);
  const [bX, bY] = rot(x1, y0);
  const [dX, dY] = rot(x0, y1);
  // Now project each into screen coords
  const [pAx, pAy] = p(aX, aY, 0.02);
  const [pBx, pBy] = p(bX, bY, 0.02);
  const [pDx, pDy] = p(dX, dY, 0.02);
  // Build an affine transform that maps the unit square (0..1, 0..1) to (A, B, D, C=B+D-A) in screen space.
  // For an SVG <image> sized W×H starting at (0,0), the transform is:
  //   matrix(a, b, c, d, e, f)
  // where (a, b) = (B - A) / W, (c, d) = (D - A) / H, (e, f) = A
  // Use a consistent W=H=1 by setting width="1" height="1" on the image and scaling via matrix.
  const a = (pBx - pAx);
  const b = (pBy - pAy);
  const c = (pDx - pAx);
  const d = (pDy - pAy);
  const transform = `matrix(${a} ${b} ${c} ${d} ${pAx} ${pAy})`;
  return (
    <g pointerEvents="none">
      <image href={fp.dataUrl} x="0" y="0" width="1" height="1"
        preserveAspectRatio="none"
        transform={transform}
        opacity={fp.opacity}/>
    </g>
  );
}

function RoomEditLayer({ scale, viewMode, camera }: { scale: number; viewMode: ViewMode; camera: Camera }) {
  const editingRoomShape = useStore(s => s.editingRoomShape);
  const editingRoomPoints = useStore(s => s.editingRoomPoints);
  const { p } = makeProj(scale, viewMode, camera);
  if (!editingRoomShape || editingRoomPoints.length === 0) return null;
  const projected = editingRoomPoints.map(pt => p(pt.x, pt.y, 0.05));
  const path = projected.map((pp2, i) => `${i === 0 ? 'M' : 'L'}${pp2[0]},${pp2[1]}`).join(' ');
  return (
    <g pointerEvents="none">
      <path d={path} fill="rgba(46,135,245,.10)" stroke="#2E87F5" strokeWidth="1.6" strokeDasharray="6 4"/>
      {projected.map(([px, py], i) => (
        <circle key={i} cx={px} cy={py} r={5} fill="#2E87F5" stroke="#fff" strokeWidth="1.5"/>
      ))}
      {projected.length >= 3 && (() => {
        const first = projected[0];
        const last = projected[projected.length - 1];
        return (
          <line x1={last[0]} y1={last[1]} x2={first[0]} y2={first[1]}
            stroke="rgba(46,135,245,.6)" strokeWidth="1" strokeDasharray="2 4"/>
        );
      })()}
    </g>
  );
}

interface ContoursLayerProps {
  scale: number; viewMode: ViewMode; camera: Camera;
}
function ContoursLayer({ scale, viewMode, camera }: ContoursLayerProps) {
  const heatmap = useStore(s => s.heatmap);
  const showContours = useStore(s => s.showContours);
  const showHeatmap = useStore(s => s.showHeatmap);
  const metric = useStore(s => s.heatmapMetric);
  const { p } = makeProj(scale, viewMode, camera);
  if (!showContours || !showHeatmap || !heatmap || metric !== 'spl') return null;

  // Contour at avg ±3 dB and avg ±6 dB (the standard install-sound uniformity bands).
  const levels: { v: number; color: string; width: number }[] = [
    { v: heatmap.avg + 3, color: '#F5A623', width: 1.0 },
    { v: heatmap.avg - 3, color: '#F5A623', width: 1.0 },
    { v: heatmap.avg + 6, color: '#C53030', width: 1.4 },
    { v: heatmap.avg - 6, color: '#C53030', width: 1.4 },
  ];
  const lines: React.ReactNode[] = [];
  let key = 0;
  for (const lvl of levels) {
    const segs = extractContour(heatmap, lvl.v);
    for (const [x0, y0, x1, y1] of segs) {
      const [ax, ay] = p(x0, y0, 4.05);
      const [bx, by] = p(x1, y1, 4.05);
      lines.push(
        <line key={key++} x1={ax} y1={ay} x2={bx} y2={by}
          stroke={lvl.color} strokeWidth={lvl.width}
          strokeOpacity="0.8"
          strokeLinecap="round"/>
      );
    }
  }
  return <g pointerEvents="none">{lines}</g>;
}

interface ZonesLayerProps {
  scale: number; viewMode: ViewMode; camera: Camera;
}
function ZonesLayer({ scale, viewMode, camera }: ZonesLayerProps) {
  const zones = useStore(s => s.zones);
  const drawingZone = useStore(s => s.drawingZone);
  const drawingPoints = useStore(s => s.drawingZonePoints);
  const { p, pp } = makeProj(scale, viewMode, camera);
  return (
    <g pointerEvents="none">
      {zones.map(z => {
        if (z.shape.length < 3) return null;
        const poly = pp(z.shape.map(pt => [pt.x, pt.y, 0.05] as [number, number, number]));
        // Centroid label in screen coords
        const cx = z.shape.reduce((s, pt) => s + pt.x, 0) / z.shape.length;
        const cy = z.shape.reduce((s, pt) => s + pt.y, 0) / z.shape.length;
        const [lx, ly] = p(cx, cy, 0.05);
        return (
          <g key={z.id}>
            <polygon points={poly} fill={z.color} fillOpacity="0.18"
              stroke={z.color} strokeWidth="1.4" strokeOpacity="0.9"
              strokeDasharray="4 3"/>
            <foreignObject x={lx - 80} y={ly - 12} width={160} height={22}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <span style={{
                  fontFamily: 'Montserrat', fontWeight: 700, fontSize: 10.5,
                  letterSpacing: '0.10em', textTransform: 'uppercase',
                  background: 'rgba(18,21,26,.85)', color: '#fff',
                  padding: '3px 9px', borderRadius: 999,
                  border: `1px solid ${z.color}`,
                  whiteSpace: 'nowrap',
                }}>{z.name}</span>
              </div>
            </foreignObject>
          </g>
        );
      })}
      {drawingZone && drawingPoints.length > 0 && (() => {
        const projected = drawingPoints.map(pt => p(pt.x, pt.y, 0.05));
        const path = projected.map((pp2, i) => `${i === 0 ? 'M' : 'L'}${pp2[0]},${pp2[1]}`).join(' ');
        return (
          <g>
            <path d={path} fill="rgba(245,166,35,.10)" stroke="#F5A623" strokeWidth="1.6"
              strokeDasharray="4 3"/>
            {projected.map(([px, py], i) => (
              <circle key={i} cx={px} cy={py} r={4} fill="#F5A623" stroke="#fff" strokeWidth="1"/>
            ))}
            {projected.length >= 3 && (() => {
              const first = projected[0];
              const last = projected[projected.length - 1];
              return (
                <line x1={last[0]} y1={last[1]} x2={first[0]} y2={first[1]}
                  stroke="rgba(245,166,35,.5)" strokeWidth="1" strokeDasharray="2 4"/>
              );
            })()}
          </g>
        );
      })()}
    </g>
  );
}

interface MeasureLayerProps { scale: number; viewMode: ViewMode; camera: Camera; points: Point[]; }
function MeasureLayer({ scale, viewMode, camera, points }: MeasureLayerProps) {
  const { p } = makeProj(scale, viewMode, camera);
  if (!points.length) return null;
  const [a] = points;
  const [aPx, aPy] = p(a.x, a.y, 0);
  return (
    <g pointerEvents="none">
      {points.map((pt, i) => {
        const [px, py] = p(pt.x, pt.y, 0);
        return <circle key={i} cx={px} cy={py} r={5} fill="#F5A623" stroke="#fff" strokeWidth="1.5"/>;
      })}
      {points.length === 2 && (() => {
        const [a2, b2] = points;
        const [bPx, bPy] = p(b2.x, b2.y, 0);
        const dist = Math.hypot(b2.x - a2.x, b2.y - a2.y);
        const mx = (aPx + bPx) / 2;
        const my = (aPy + bPy) / 2;
        return (
          <g>
            <line x1={aPx} y1={aPy} x2={bPx} y2={bPy} stroke="#F5A623" strokeWidth="2" strokeDasharray="4 3"/>
            <foreignObject x={mx - 60} y={my - 14} width={120} height={28}>
              <div style={{
                display: 'flex', justifyContent: 'center',
              }}>
                <span className="placed-label amber" style={{ pointerEvents: 'none' }}>
                  {dist.toFixed(2)} ft  ·  {(dist * 0.3048).toFixed(2)} m
                </span>
              </div>
            </foreignObject>
          </g>
        );
      })()}
    </g>
  );
}

function AxisGizmo({ x, y, viewMode }: { x: number; y: number; viewMode: ViewMode }) {
  if (viewMode === 'top') {
    return (
      <g transform={`translate(${x}, ${y})`} pointerEvents="none">
        <circle cx={0} cy={0} r={28} fill="rgba(18,21,26,.6)" stroke="rgba(255,255,255,.12)" strokeWidth="0.8"/>
        <line x1={0} y1={0} x2={20} y2={0} stroke="#2E87F5" strokeWidth="1.4"/>
        <text x={22} y={4} fill="#2E87F5" fontSize="9" fontFamily="Montserrat" fontWeight="700">X</text>
        <line x1={0} y1={0} x2={0} y2={20} stroke="#F5A623" strokeWidth="1.4"/>
        <text x={3} y={26} fill="#F5A623" fontSize="9" fontFamily="Montserrat" fontWeight="700">Y</text>
        <text x={-9} y={-12} fill="#fff" fontSize="8" fontFamily="Montserrat" fontWeight="700">TOP</text>
      </g>
    );
  }
  return (
    <g transform={`translate(${x}, ${y})`} pointerEvents="none">
      <circle cx={0} cy={0} r={28} fill="rgba(18,21,26,.6)" stroke="rgba(255,255,255,.12)" strokeWidth="0.8"/>
      <line x1={0} y1={0} x2={20} y2={10} stroke="#2E87F5" strokeWidth="1.4"/>
      <text x={22} y={14} fill="#2E87F5" fontSize="9" fontFamily="Montserrat" fontWeight="700">X</text>
      <line x1={0} y1={0} x2={-20} y2={10} stroke="#F5A623" strokeWidth="1.4"/>
      <text x={-26} y={14} fill="#F5A623" fontSize="9" fontFamily="Montserrat" fontWeight="700">Y</text>
      <line x1={0} y1={0} x2={0} y2={-22} stroke="#fff" strokeWidth="1.4"/>
      <text x={3} y={-22} fill="#fff" fontSize="9" fontFamily="Montserrat" fontWeight="700">Z</text>
    </g>
  );
}

type DragMode = 'pan' | 'orbit' | 'item' | 'select';
interface DragState {
  dragging: boolean; mode: DragMode; moved: boolean;
  startX: number; startY: number;
  basePanX: number; basePanY: number;
  baseYaw: number; basePitch: number;
  // Item-drag fields
  itemId?: string;
  itemStartX?: number; itemStartY?: number;
  worldStartX?: number; worldStartY?: number;
  itemKind?: string;
  itemWall?: 'L' | 'R' | 'B' | 'F' | 'C';
  /** Snapshot of children-hung-from-this-truss at drag start (for parent-drag). */
  childrenStart?: Array<{ id: string; startX: number; startY: number }>;
  /** Snapshot of OTHER selected items at drag start (for multi-select drag).
   *  When the user drags one item from a multi-selection, all selected items
   *  move together by the same delta. */
  multiDragStart?: Array<{ id: string; startX: number; startY: number }>;
  // Selection-rectangle fields (screen coords)
  rectX0?: number; rectY0?: number;
  rectX1?: number; rectY1?: number;
  additive?: boolean; // Shift held → add to existing selection
}

export function Viewport() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null);
  /** Alignment snap state — populated during item drag whenever the
   *  dragged item is aligned to another item's x or y. Cleared on
   *  mouseup. Drives the AlignmentGuidesLayer overlay. */
  const [alignmentSnap, setAlignmentSnap] = useState<AlignmentSnapResult | null>(null);

  const room = useStore(s => s.room);
  const equipment = useStore(s => s.equipment);
  const selectedId = useStore(s => s.selectedId);
  const selectedIds = useStore(s => s.selectedIds);
  const toggleSelection = useStore(s => s.toggleSelection);
  const setSelection = useStore(s => s.setSelection);
  const showHeatmap = useStore(s => s.showHeatmap);
  const showCones = useStore(s => s.showCones);
  const showMesh = useStore(s => s.showMesh);
  const gridSnap = useStore(s => s.gridSnap);
  const setSelected = useStore(s => s.setSelected);
  const viewMode = useStore(s => s.viewMode);
  const cameraYaw = useStore(s => s.cameraYaw);
  const cameraPitch = useStore(s => s.cameraPitch);
  const setCamera = useStore(s => s.setCamera);
  const fitVersion = useStore(s => s.fitVersion);
  const layers = useStore(s => s.layerVisibility);
  const measureMode = useStore(s => s.measureMode);
  const measurePoints = useStore(s => s.measurePoints);
  const pushMeasurePoint = useStore(s => s.pushMeasurePoint);
  const drawingZone = useStore(s => s.drawingZone);
  const pushZonePoint = useStore(s => s.pushZonePoint);
  const finishDrawingZone = useStore(s => s.finishDrawingZone);
  const droppingAnnotation = useStore(s => s.droppingAnnotation);
  const addAnnotation = useStore(s => s.addAnnotation);
  const setDroppingAnnotation = useStore(s => s.setDroppingAnnotation);
  const wiringMode = useStore(s => s.wiringMode);
  const wiringStartId = useStore(s => s.wiringStartId);
  const wiringCableType = useStore(s => s.wiringCableType);
  const setWiringMode = useStore(s => s.setWiringMode);
  const setWiringStartId = useStore(s => s.setWiringStartId);
  const addConnection = useStore(s => s.addConnection);
  const editingRoomShape = useStore(s => s.editingRoomShape);
  const editingRoomPoints = useStore(s => s.editingRoomPoints);
  const pushRoomPoint = useStore(s => s.pushRoomPoint);
  const finishEditingRoomShape = useStore(s => s.finishEditingRoomShape);
  const cancelEditingRoomShape = useStore(s => s.cancelEditingRoomShape);
  const tool = useStore(s => s.tool);
  const zoom = useStore(s => s.viewportZoom);
  const panX = useStore(s => s.viewportPanX);
  const panY = useStore(s => s.viewportPanY);
  const setViewportZoom = useStore(s => s.setViewportZoom);
  const setViewportPan = useStore(s => s.setViewportPan);
  const updateEquipmentLive = useStore(s => s.updateEquipmentLive);
  const beginHistoryGroup = useStore(s => s.beginHistoryGroup);
  const addEquipment = useStore(s => s.addEquipment);
  const setHint = useStore(s => s.setHint);
  const setSurfaceMaterialAction = useStore(s => s.setSurfaceMaterial);
  const selectSurfaceAction = useStore(s => s.selectSurface);

  // ===== A/B comparison wipe =====
  const compareScenarioId = useStore(s => s.compareScenarioId);
  const compareWipeX = useStore(s => s.compareWipeX);
  const compareSpl = useStore(s => s.compareHeatmap);
  const compareClarity = useStore(s => s.compareClarityHeatmap);
  const compareArrival = useStore(s => s.compareArrivalHeatmap);
  const setCompareWipeX = useStore(s => s.setCompareWipeX);
  const scenarios = useStore(s => s.scenarios);
  const activeScenarioId = useStore(s => s.activeScenarioId);
  const [draggingWipe, setDraggingWipe] = useState(false);

  const walkEyeX = useStore(s => s.walkEyeX);
  const walkEyeY = useStore(s => s.walkEyeY);
  const walkEyeZ = useStore(s => s.walkEyeZ);
  const walkYaw = useStore(s => s.walkYaw);
  const walkPitch = useStore(s => s.walkPitch);
  const setWalkPose = useStore(s => s.setWalkPose);
  const setViewMode = useStore(s => s.setViewMode);

  const isWalk = viewMode === 'walk';
  // Focal length scales with viewport size for ~75° vertical FOV.
  const walkFocal = useMemo(() => size.h / (2 * Math.tan((75 / 2) * Math.PI / 180)), [size.h]);

  const camera: Camera = useMemo(
    () => isWalk
      ? { yaw: walkYaw, pitch: walkPitch, eyeX: walkEyeX, eyeY: walkEyeY, eyeZ: walkEyeZ, focal: walkFocal }
      : { yaw: cameraYaw, pitch: cameraPitch },
    [isWalk, cameraYaw, cameraPitch, walkYaw, walkPitch, walkEyeX, walkEyeY, walkEyeZ, walkFocal]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Space-to-pan / shift-to-orbit modifiers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inField = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT';
      if (e.code === 'Space' && !inField) { e.preventDefault(); setSpaceHeld(true); }
      if (e.shiftKey) setShiftHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
      if (!e.shiftKey) setShiftHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  // Wipe-handle dragging — document-level so the cursor doesn't have to stay over the handle.
  useEffect(() => {
    if (!draggingWipe) return;
    const onMove = (e: MouseEvent) => {
      const svg = svgRef.current; if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = (e.clientX - rect.left) / Math.max(1, rect.width);
      setCompareWipeX(x);
    };
    const onUp = () => setDraggingWipe(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingWipe, setCompareWipeX]);

  // ===== Walk-through: WASD/arrow movement and Esc-to-exit =====
  useEffect(() => {
    if (!isWalk) return;
    const held = new Set<string>();
    let raf = 0;
    const SPEED = 0.18; // ft / frame at full press

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (held.size === 0) return;
      const st = useStore.getState();
      const yaw = st.walkYaw;
      let dx = 0, dy = 0, dz = 0;
      const fwdX = Math.cos(yaw), fwdY = Math.sin(yaw);
      // Right vector matches the convention in iso.ts:cameraBasis so that
      // 'D' strafes toward the same world direction the projection treats
      // as the camera's right side.
      const rightX = -Math.sin(yaw), rightY = Math.cos(yaw);
      if (held.has('w') || held.has('arrowup'))    { dx += fwdX; dy += fwdY; }
      if (held.has('s') || held.has('arrowdown'))  { dx -= fwdX; dy -= fwdY; }
      if (held.has('d') || held.has('arrowright')) { dx += rightX; dy += rightY; }
      if (held.has('a') || held.has('arrowleft'))  { dx -= rightX; dy -= rightY; }
      if (held.has('e') || held.has('pageup'))     { dz += 1; }
      if (held.has('q') || held.has('pagedown'))   { dz -= 1; }
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        const k = held.has('shift') ? SPEED * 2.5 : SPEED;
        st.setWalkPose({
          eyeX: st.walkEyeX + dx * k,
          eyeY: st.walkEyeY + dy * k,
          eyeZ: Math.max(1, Math.min(60, st.walkEyeZ + dz * k * 0.5)),
        });
      }
    };
    raf = requestAnimationFrame(tick);

    const onKey = (e: KeyboardEvent, down: boolean) => {
      const t = e.target as HTMLElement;
      const inField = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT';
      if (inField) return;
      if (e.key === 'Escape' && down) { setViewMode('iso'); return; }
      const k = e.key.toLowerCase();
      if ([
        'w', 'a', 's', 'd', 'q', 'e', 'shift',
        'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
        'pageup', 'pagedown',
      ].includes(k)) {
        if (down) held.add(k); else held.delete(k);
        e.preventDefault();
      }
    };
    const onDown = (e: KeyboardEvent) => onKey(e, true);
    const onUp = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [isWalk, setViewMode]);

  // ===== Walk-through: mouse-drag in the canvas to look around =====
  const walkLookRef = useRef<{ startX: number; startY: number; baseYaw: number; basePitch: number } | null>(null);
  useEffect(() => {
    if (!isWalk) return;
    const onMove = (e: MouseEvent) => {
      const r = walkLookRef.current; if (!r) return;
      const dx = e.clientX - r.startX, dy = e.clientY - r.startY;
      const SENS = 0.0035;
      setWalkPose({ yaw: r.baseYaw + dx * SENS, pitch: r.basePitch - dy * SENS });
    };
    const onUp = () => { walkLookRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isWalk, setWalkPose]);

  const corners = useMemo(() => {
    const bb = bboxOf(room.shape);
    const hMin = Math.max(1, room.height);
    const hMax = room.peakHeight ?? hMin;
    const cs: [number, number, number][] = [];
    for (const p2 of room.shape) {
      cs.push([p2.x, p2.y, 0]);
      cs.push([p2.x, p2.y, hMin]);
    }
    cs.push([(bb.minX + bb.maxX) / 2, bb.minY, hMax]);
    cs.push([(bb.minX + bb.maxX) / 2, bb.maxY, hMax]);
    return cs;
  }, [room.shape, room.height, room.peakHeight]);

  // Fit-base scale + offset (reset by Fit button via fitVersion). Recomputes on
  // camera change so the room stays framed during orbit.
  const base = useMemo(
    () => fitProjection(corners, size.w, size.h, 80, viewMode, camera),
    [corners, size.w, size.h, viewMode, camera, fitVersion]
  );

  // Effective values with zoom + pan applied
  const scale = base.scale * zoom;
  const offsetX = base.offsetX + panX;
  const offsetY = base.offsetY + panY;

  const selected = selectedId ? equipment.find(e => e.id === selectedId) ?? null : null;

  const isTruss = (e: EquipmentItem) =>
    e.kind === 'truss-straight' || e.kind === 'truss-square' || e.kind === 'truss-circle';

  const visibleEquip = equipment.filter(e => layers[e.category as keyof typeof layers] !== false);
  const speakers = visibleEquip.filter(e => e.category === 'audio-speaker');
  const panels = visibleEquip.filter(e => e.category === 'acoustic');
  const trusses = visibleEquip.filter(isTruss);
  const others = visibleEquip.filter(e =>
    !isTruss(e) && (
      e.category === 'video' || e.category === 'lighting' ||
      e.category === 'audio-signal' || e.category === 'infrastructure'
    )
  );
  const refs = visibleEquip.filter(e => e.category === 'reference');

  const orbitTrigger = (e: React.MouseEvent) => {
    // Right-click drag orbits in iso. Shift+left-drag orbits ONLY when not in select tool
    // (select-tool + Shift+drag is reserved for additive marquee).
    if (viewMode === 'top') return false;
    if (e.button === 2) return true;
    if (e.button === 0 && e.shiftKey && tool !== 'select') return true;
    return false;
  };

  const canPanWith = (e: React.MouseEvent) => {
    return tool === 'hand' || spaceHeld || e.button === 1 || (e.button === 0 && e.altKey && !e.shiftKey);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isWalk) {
      // In walk-through, left-drag = look around. WASD handles movement.
      if (e.button === 0) {
        e.preventDefault();
        walkLookRef.current = {
          startX: e.clientX, startY: e.clientY,
          baseYaw: walkYaw, basePitch: walkPitch,
        };
        (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
      }
      return;
    }
    if (orbitTrigger(e)) {
      e.preventDefault();
      dragRef.current = {
        dragging: true, mode: 'orbit', moved: false,
        startX: e.clientX, startY: e.clientY,
        basePanX: panX, basePanY: panY,
        baseYaw: cameraYaw, basePitch: cameraPitch,
      };
      (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
    } else if (canPanWith(e)) {
      e.preventDefault();
      dragRef.current = {
        dragging: true, mode: 'pan', moved: false,
        startX: e.clientX, startY: e.clientY,
        basePanX: panX, basePanY: panY,
        baseYaw: cameraYaw, basePitch: cameraPitch,
      };
      (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
    } else if (
      e.button === 0 && tool === 'select' &&
      !drawingZone && !measureMode && !editingRoomShape && !droppingAnnotation &&
      !e.metaKey && !e.ctrlKey
    ) {
      // Plain or Shift+drag on empty canvas starts a marquee. (Item glyphs stop propagation.)
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      dragRef.current = {
        dragging: true, mode: 'select', moved: false,
        startX: e.clientX, startY: e.clientY,
        basePanX: 0, basePanY: 0, baseYaw: 0, basePitch: 0,
        rectX0: sx, rectY0: sy, rectX1: sx, rectY1: sy,
        additive: shiftHeld,
      };
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d?.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.mode === 'pan') {
      setViewportPan(d.basePanX + dx, d.basePanY + dy);
    } else if (d.mode === 'orbit') {
      // Inverted axes — drag in the direction you want the model to rotate.
      const yaw = d.baseYaw - dx * 0.005;
      const pitch = d.basePitch + dy * 0.005;
      setCamera(yaw, pitch);
    } else if (d.mode === 'select') {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      d.rectX1 = sx;
      d.rectY1 = sy;
      setMarquee({ x0: d.rectX0!, y0: d.rectY0!, x1: sx, y1: sy });
    } else if (d.mode === 'item' && d.itemId != null) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = unprojectToFloor(sx, sy, scale, offsetX, offsetY, viewMode, camera);
      let newX = (d.itemStartX ?? 0) + (world.x - (d.worldStartX ?? 0));
      let newY = (d.itemStartY ?? 0) + (world.y - (d.worldStartY ?? 0));
      // Grid snap — applied to the dragged item's xy. Holding Shift
      // disables it for fine-tuning. Default step is 1 ft.
      const fineMode = e.shiftKey;
      if (gridSnap && !fineMode) {
        newX = snapToGrid(newX, 1);
        newY = snapToGrid(newY, 1);
      }
      // Alignment snap — when the dragged item's xy comes within ~0.6 ft
      // of another item's x or y, snap to that exact value. Provides
      // automatic clean alignment with visible guide lines. Disabled by
      // Shift (same fine-mode as gridSnap).
      if (!fineMode && d.itemId) {
        const align = findAlignmentSnap(d.itemId, newX, newY, equipment);
        if (align.x != null) newX = align.x;
        if (align.y != null) newY = align.y;
        const hasAnySnap = align.alignedToXId || align.alignedToYId;
        if (hasAnySnap) {
          setAlignmentSnap(align);
        } else if (alignmentSnap) {
          setAlignmentSnap(null);
        }
      } else if (alignmentSnap) {
        setAlignmentSnap(null);
      }
      const dx = newX - (d.itemStartX ?? 0);
      const dy = newY - (d.itemStartY ?? 0);
      // Constrain wall-attached panels to slide along their wall.
      const isPanel = d.itemKind === 'acoustic-panel' || d.itemKind === 'bass-trap' || d.itemKind === 'diffuser';
      const isTrussDrag = d.itemKind && isTrussKind(d.itemKind);
      if (isPanel) {
        const wall = d.itemWall ?? 'L';
        if (wall === 'L' || wall === 'R')      updateEquipmentLive(d.itemId, { y: newY });
        else if (wall === 'B' || wall === 'F') updateEquipmentLive(d.itemId, { x: newX });
        else                                    updateEquipmentLive(d.itemId, { x: newX, y: newY });
      } else if (isTrussDrag) {
        // Truss is moving — don't snap-to-self; just translate.
        updateEquipmentLive(d.itemId, { x: newX, y: newY });
      } else {
        // Snap-to-truss: when the item is dragged within snap radius of any
        // truss, snap its xy onto the closest point on the truss line, lift
        // its z to match the truss height, and set parentId so the item
        // becomes a child that will move with the truss next time the
        // truss is dragged. If the item was previously on a truss and is
        // now dragged out of range, clear parentId.
        const draggedItem = equipment.find(e => e.id === d.itemId);
        const snap = draggedItem
          ? findTrussSnap(draggedItem, newX, newY, equipment)
          : null;
        const patch: Partial<EquipmentItem> = snap
          ? { x: snap.snapX, y: snap.snapY, z: snap.snapZ, parentId: snap.trussId }
          : { x: newX, y: newY, ...(draggedItem?.parentId ? { parentId: undefined } : {}) };
        updateEquipmentLive(d.itemId, patch);
      }
      // Multi-select drag: when the user grabbed a selected item AND there
      // are other selected items, move them all by the same delta. Skip
      // wall-attached panels (they have constrained movement anyway).
      if (d.multiDragStart && d.multiDragStart.length > 0) {
        for (const m of d.multiDragStart) {
          updateEquipmentLive(m.id, { x: m.startX + dx, y: m.startY + dy });
        }
      }
      // Carry every child item along with the same delta (truss drag).
      if (d.childrenStart && d.childrenStart.length > 0) {
        for (const c of d.childrenStart) {
          updateEquipmentLive(c.id, { x: c.startX + dx, y: c.startY + dy });
        }
      }
    }
  };

  const onMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const wasDrag = d?.dragging && d?.moved;

    // Finalize marquee selection
    if (d?.dragging && d.mode === 'select' && d.rectX0 != null && d.rectX1 != null) {
      const svg = svgRef.current;
      if (svg && d.moved) {
        // Project each item to screen coords; collect those inside the marquee box.
        const xMin = Math.min(d.rectX0, d.rectX1);
        const xMax = Math.max(d.rectX0, d.rectX1);
        const yMin = Math.min(d.rectY0!, d.rectY1!);
        const yMax = Math.max(d.rectY0!, d.rectY1!);
        const hits: string[] = [];
        for (const item of equipment) {
          const [px, py] = project(item.x, item.y, item.z, scale, viewMode, camera);
          const sx = px + offsetX;
          const sy = py + offsetY;
          if (sx >= xMin && sx <= xMax && sy >= yMin && sy <= yMax) {
            hits.push(item.id);
          }
        }
        if (d.additive) {
          // Merge with existing selection
          const set = new Set(selectedIds);
          for (const id of hits) set.add(id);
          setSelection(Array.from(set));
        } else {
          setSelection(hits);
        }
      } else if (svg && !d.moved) {
        // Click without drag → clear (handled by the canvas onClick already)
      }
    }

    if (d) d.dragging = false;
    setMarquee(null);
    if (alignmentSnap) setAlignmentSnap(null);
    (e.currentTarget as HTMLElement).style.cursor = cursorFor();
    if (wasDrag) e.stopPropagation();
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    // Right-click is used for orbit — suppress the browser menu.
    if (viewMode !== 'top') e.preventDefault();
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (isWalk) return;
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('application/x-beacon-equip') || types.includes('application/x-beacon-material')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  /** Resolve which room surface is under a screen point — first via the
   *  surface polygon's data attributes (works for walls/ceiling/floor in any
   *  view), then falling back to the floor when the point is inside the room
   *  footprint (e.g. dropped on the heatmap or a pew). */
  const surfaceAtClientPoint = (clientX: number, clientY: number): { kind: 'wall' | 'floor' | 'ceiling'; segmentIndex: number } | null => {
    const el = document.elementFromPoint(clientX, clientY) as Element | null;
    const surfEl = el?.closest('[data-surface-kind]');
    if (surfEl) {
      const kind = surfEl.getAttribute('data-surface-kind') as 'wall' | 'floor' | 'ceiling';
      const segmentIndex = parseInt(surfEl.getAttribute('data-surface-seg') ?? '0', 10);
      return { kind, segmentIndex };
    }
    // Fallback — floor if the unprojected point lands inside the room polygon.
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const world = unprojectToFloor(clientX - rect.left, clientY - rect.top, scale, offsetX, offsetY, viewMode, camera);
    if (pointInPolygon({ x: world.x, y: world.y }, room.shape)) return { kind: 'floor', segmentIndex: 0 };
    return null;
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (isWalk) return;

    // ----- Material drop: paint the surface under the cursor -----
    const matData = e.dataTransfer.getData('application/x-beacon-material');
    if (matData) {
      e.preventDefault();
      let materialId: string;
      try { materialId = (JSON.parse(matData) as { materialId: string }).materialId; } catch { return; }
      const surf = surfaceAtClientPoint(e.clientX, e.clientY);
      if (!surf) { setHint('Drop a material onto a wall, floor, or ceiling.'); return; }
      // Floor only accepts floor materials; walls/ceilings accept the rest.
      const mat = getMaterial(materialId);
      if (surf.kind === 'floor' && mat.category !== 'floor') {
        setHint(`${mat.name} isn't a floor material — try a wall or ceiling.`);
        return;
      }
      if (surf.kind !== 'floor' && mat.category === 'floor') {
        setHint(`${mat.name} is a floor material — drop it on the floor.`);
        return;
      }
      setSurfaceMaterialAction(surf.kind, surf.segmentIndex, materialId);
      selectSurfaceAction(surf);
      setHint(`${mat.name} applied to ${surf.kind}`);
      return;
    }

    const data = e.dataTransfer.getData('application/x-beacon-equip');
    if (!data) return;
    e.preventDefault();
    let template: EquipmentTemplate;
    try { template = JSON.parse(data) as EquipmentTemplate; } catch { return; }
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    let world = unprojectToFloor(sx, sy, scale, offsetX, offsetY, viewMode, camera);

    // Apply grid snap if enabled — drops land on the 1 ft grid for clean
    // alignment.
    if (gridSnap) {
      world = { x: snapToGrid(world.x, 1), y: snapToGrid(world.y, 1) };
    }

    // Build the item with ALL fields populated (including lf, polar,
    // panelPattern, throwRatio, etc.) so the dropped item is identical to
    // a catalog-placed one. Smart default rotation aims it toward the
    // room centroid based on the drop position.
    const item = buildItemFromTemplate(template, { x: world.x, y: world.y }, room);

    // Snap-to-truss on drop: if the drop lands within snap radius of a
    // truss, attach immediately so the user doesn't have to drag again.
    const snap = findTrussSnap(item, world.x, world.y, equipment);
    if (snap) {
      item.x = snap.snapX;
      item.y = snap.snapY;
      item.z = snap.snapZ;
      item.parentId = snap.trussId;
    }

    addEquipment(item);
    setHint(snap
      ? `${template.brand ?? ''} ${template.label} mounted on truss`
      : `${template.brand ?? ''} ${template.label} placed at (${item.x.toFixed(1)}, ${item.y.toFixed(1)})`);
  };

  const onItemClick = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    if (wiringMode) {
      if (!wiringStartId) {
        setWiringStartId(itemId);
      } else if (wiringStartId !== itemId) {
        addConnection({ fromId: wiringStartId, toId: itemId, cableType: wiringCableType });
        setHint(`${wiringCableType.toUpperCase()} cable wired`);
        // Stay in wiring mode but reset start so the user can wire another link.
        setWiringStartId(null);
      }
      return;
    }
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleSelection(itemId);
    } else {
      setSelected(itemId);
    }
  };

  const onItemContextMenu = (e: React.MouseEvent, itemId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // If item isn't selected, select it; otherwise leave selection alone (multi-select aware)
    if (!selectedIds.includes(itemId)) setSelected(itemId);
    setContextMenu({ x: e.clientX, y: e.clientY, itemId });
  };

  const onItemMouseDown = (e: React.MouseEvent, item: EquipmentItem) => {
    if (isWalk) return; // walk-through mode: clicks fall through to the canvas mouse-look handler
    if (wiringMode) return; // wiring tool: let onItemClick run, no drag
    if (item.locked) return;
    if (e.button !== 0) return; // only left-mouse drags items
    if (e.shiftKey || e.altKey || spaceHeld) return; // modifiers go to pan/orbit/multi-select
    if (drawingZone || measureMode) return; // those tools own canvas clicks
    e.stopPropagation();
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = unprojectToFloor(sx, sy, scale, offsetX, offsetY, viewMode, camera);
    // Preserve the existing selection when the user grabs one of the
    // already-selected items (so multi-select drag is intuitive — clicking
    // a selected item without modifier doesn't collapse the selection).
    // Only collapse to a single selection when grabbing an UNSELECTED item.
    const wasInSelection = selectedIds.includes(item.id);
    if (!wasInSelection) {
      setSelected(item.id);
    }
    beginHistoryGroup(); // single undo entry for the entire drag
    // If we're dragging a truss, snapshot every child's start position so they
    // move 1:1 with the truss (no drift across mousemoves).
    const isTrussItem = item.kind === 'truss-straight' || item.kind === 'truss-square' || item.kind === 'truss-circle';
    const childrenStart = isTrussItem
      ? equipment.filter(e => e.parentId === item.id).map(e => ({ id: e.id, startX: e.x, startY: e.y }))
      : undefined;
    // If the grabbed item is part of a multi-selection, snapshot the
    // OTHER selected items so they move 1:1 with the grabbed item.
    // Excludes the grabbed item itself + its truss children (those move
    // via childrenStart already) + wall-attached panels (constrained slide).
    const multiDragStart = wasInSelection && selectedIds.length > 1
      ? equipment
          .filter(e =>
            e.id !== item.id &&
            selectedIds.includes(e.id) &&
            e.parentId !== item.id &&
            e.category !== 'acoustic')
          .map(e => ({ id: e.id, startX: e.x, startY: e.y }))
      : undefined;
    dragRef.current = {
      dragging: true, mode: 'item', moved: false,
      startX: e.clientX, startY: e.clientY,
      basePanX: 0, basePanY: 0,
      baseYaw: 0, basePitch: 0,
      itemId: item.id,
      itemStartX: item.x, itemStartY: item.y,
      worldStartX: world.x, worldStartY: world.y,
      itemKind: item.kind,
      itemWall: item.wall,
      childrenStart,
      multiDragStart,
    };
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isWalk) return; // walk-through mode owns the canvas
    // Suppress click after a drag-pan
    if (dragRef.current && dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    if (measureMode || drawingZone || editingRoomShape || droppingAnnotation) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = unprojectToFloor(sx, sy, scale, offsetX, offsetY, viewMode, camera);
      if (measureMode) pushMeasurePoint(world);
      else if (drawingZone) pushZonePoint(world);
      else if (editingRoomShape) pushRoomPoint(world);
      else if (droppingAnnotation) {
        const id = addAnnotation(world.x, world.y);
        setTimeout(() => {
          const text = window.prompt('Annotation note (leave blank to delete)');
          const st = useStore.getState();
          if (text == null || text.trim() === '') st.deleteAnnotation(id);
          else st.updateAnnotation(id, { text });
        }, 0);
      }
      return;
    }
    setSelected(null);
  };

  const onCanvasDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drawingZone) {
      e.preventDefault();
      e.stopPropagation();
      finishDrawingZone();
    } else if (editingRoomShape) {
      e.preventDefault();
      e.stopPropagation();
      finishEditingRoomShape();
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // Smooth exponential zoom
    const factor = Math.pow(1.0015, -e.deltaY);
    const oldZoom = zoom;
    const newZoom = Math.max(0.1, Math.min(8, oldZoom * factor));
    if (newZoom === oldZoom) return;
    // Cursor-anchored: keep the world point under the cursor stationary
    const effScaleOld = base.scale * oldZoom;
    const effOXOld = base.offsetX + panX;
    const effOYOld = base.offsetY + panY;
    const worldX = (cx - effOXOld) / effScaleOld;
    const worldY = (cy - effOYOld) / effScaleOld;
    const effScaleNew = base.scale * newZoom;
    const newPanX = cx - base.offsetX - worldX * effScaleNew;
    const newPanY = cy - base.offsetY - worldY * effScaleNew;
    setViewportZoom(newZoom);
    setViewportPan(newPanX, newPanY);
  };

  const cursorFor = () => {
    if (isWalk) return 'grab';
    if (measureMode || drawingZone || droppingAnnotation) return 'crosshair';
    if (shiftHeld && viewMode !== 'top') return 'grab';
    if (tool === 'hand' || spaceHeld) return 'grab';
    return 'default';
  };

  return (
    <div
      className="viewport-canvas"
      ref={containerRef}
      onClick={onCanvasClick}
      onDoubleClick={onCanvasDoubleClick}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ cursor: cursorFor() }}
    >
      <svg ref={svgRef} width={size.w} height={size.h} style={{ position: 'absolute', inset: 0 }}>
        <Defs />
        {!isWalk && compareScenarioId && (
          <defs>
            {/* clipPath rects live in the translated coord-space of the parent <g>,
                so subtract offsetX/Y to express them in screen pixels. */}
            <clipPath id="compare-clip-left">
              <rect x={-offsetX} y={-offsetY} width={Math.max(0, compareWipeX * size.w)} height={size.h}/>
            </clipPath>
            <clipPath id="compare-clip-right">
              <rect
                x={compareWipeX * size.w - offsetX}
                y={-offsetY}
                width={Math.max(0, size.w - compareWipeX * size.w)}
                height={size.h}/>
            </clipPath>
          </defs>
        )}
        <g transform={`translate(${offsetX}, ${offsetY})`}>
          <RoomShell scale={scale} viewMode={viewMode} camera={camera}
            showMesh={showMesh && layers.mesh !== false}
            occupied={room.occupied}
            showPews={layers.pews !== false}/>
          <FloorPlanLayer scale={scale} viewMode={viewMode} camera={camera}/>
          {!isWalk && showHeatmap && layers.heatmap !== false && (compareScenarioId || speakers.length > 0) && (
            compareScenarioId
              ? (
                <>
                  <HeatmapLayer scale={scale} viewMode={viewMode} camera={camera}
                    clipId="compare-clip-left" keyPrefix="hm-a"/>
                  <HeatmapLayer scale={scale} viewMode={viewMode} camera={camera}
                    override={{ spl: compareSpl, clarity: compareClarity, arrival: compareArrival }}
                    clipId="compare-clip-right" keyPrefix="hm-b"/>
                </>
              )
              : <HeatmapLayer scale={scale} viewMode={viewMode} camera={camera} />
          )}
          {!isWalk && speakers.length > 0 && <ContoursLayer scale={scale} viewMode={viewMode} camera={camera} />}
          {panels.map(p2 => (
            <PanelGlyph key={p2.id} item={p2} scale={scale} viewMode={viewMode} camera={camera}
              selected={selectedIds.includes(p2.id)}
              onClick={(e) => onItemClick(e, p2.id)}
              onMouseDown={(e) => onItemMouseDown(e, p2)}
              onContextMenu={(e) => onItemContextMenu(e, p2.id)}/>
          ))}
          {/* Trusses go BEFORE other equipment so child items render on top of them. */}
          {trusses.map(tr => (
            <TrussGlyph key={tr.id} item={tr} scale={scale} viewMode={viewMode} camera={camera}
              selected={selectedIds.includes(tr.id)}
              onClick={(e) => onItemClick(e, tr.id)}
              onMouseDown={(e) => onItemMouseDown(e, tr)}
              onContextMenu={(e) => onItemContextMenu(e, tr.id)}/>
          ))}
          {/* Mounting clamps: small marker at every truss-mounted item so the
              attachment point is visible. Renders BEFORE the equipment glyph
              so the glyph sits on top of the clamp. */}
          <MountingPointsLayer scale={scale} viewMode={viewMode} camera={camera}/>
          {/* Alignment guides: dashed amber lines that appear during a drag
              whenever the dragged item snaps to another item's x or y. */}
          <AlignmentGuidesLayer snap={alignmentSnap} scale={scale} viewMode={viewMode} camera={camera}/>
          {/* Sort equipment glyphs by depth so near items overdraw far ones */}
          {[...others, ...speakers].sort((a, b) =>
            viewDepth(b.x, b.y, b.z, viewMode, camera) - viewDepth(a.x, a.y, a.z, viewMode, camera)
          ).map(it => (
            it.category === 'audio-speaker' ? (
              <SpeakerGlyph key={it.id} item={it} scale={scale} viewMode={viewMode} camera={camera}
                selected={selectedIds.includes(it.id)}
                showCones={showCones && layers.cones !== false}
                onClick={(e) => onItemClick(e, it.id)}
                onMouseDown={(e) => onItemMouseDown(e, it)}
                onContextMenu={(e) => onItemContextMenu(e, it.id)}/>
            ) : (
              <VideoLightingGlyph key={it.id} item={it} scale={scale} viewMode={viewMode} camera={camera}
                selected={selectedIds.includes(it.id)}
                showCones={showCones && layers.cones !== false}
                onClick={(e) => onItemClick(e, it.id)}
                onMouseDown={(e) => onItemMouseDown(e, it)}
                onContextMenu={(e) => onItemContextMenu(e, it.id)}/>
            )
          ))}
          {refs.map(rp => (
            <ReferencePointGlyph key={rp.id} item={rp} scale={scale} viewMode={viewMode} camera={camera}
              selected={selectedIds.includes(rp.id)}
              onClick={(e) => onItemClick(e, rp.id)}
              onMouseDown={(e) => onItemMouseDown(e, rp)}
              onContextMenu={(e) => onItemContextMenu(e, rp.id)}/>
          ))}
          <ZonesLayer scale={scale} viewMode={viewMode} camera={camera}/>
          {!isWalk && <ConnectionsLayer scale={scale} viewMode={viewMode} camera={camera}/>}
          <AnnotationsLayer scale={scale} viewMode={viewMode} camera={camera}/>
          <RoomEditLayer scale={scale} viewMode={viewMode} camera={camera}/>
          <MeasureLayer scale={scale} viewMode={viewMode} camera={camera} points={measurePoints}/>
          {selected && (() => {
            const [lx, ly] = project(selected.x, selected.y, selected.z + 1.5, scale, viewMode, camera);
            return (
              <foreignObject x={lx - 80} y={ly - 28} width={160} height={22} style={{ pointerEvents: 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <span className="placed-label selected">{selected.label}</span>
                </div>
              </foreignObject>
            );
          })()}
        </g>
        <AxisGizmo x={size.w - 56} y={size.h - 60} viewMode={viewMode}/>
        {marquee && (() => {
          const x = Math.min(marquee.x0, marquee.x1);
          const y = Math.min(marquee.y0, marquee.y1);
          const w = Math.abs(marquee.x1 - marquee.x0);
          const h = Math.abs(marquee.y1 - marquee.y0);
          return (
            <rect x={x} y={y} width={w} height={h}
              fill="rgba(245,166,35,.12)" stroke="#F5A623" strokeWidth="1"
              strokeDasharray="4 3" pointerEvents="none"/>
          );
        })()}
        <rect x="0" y="0" width={size.w} height={size.h} fill="url(#vignette)" pointerEvents="none"/>
        {!isWalk && compareScenarioId && (() => {
          const wipePx = compareWipeX * size.w;
          const partner = scenarios.find(sc => sc.id === compareScenarioId);
          const activeSc = scenarios.find(sc => sc.id === activeScenarioId);
          const leftLabel = activeSc ? activeSc.name : 'Live';
          const rightLabel = partner ? partner.name : '';
          return (
            <g pointerEvents="auto">
              {/* Vertical wipe line */}
              <line x1={wipePx} y1={0} x2={wipePx} y2={size.h}
                stroke="#F5A623" strokeWidth={draggingWipe ? 2.5 : 1.5}
                pointerEvents="none"/>
              {/* Drag grip */}
              <g
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setDraggingWipe(true); }}>
                <circle cx={wipePx} cy={size.h / 2} r={18}
                  fill="rgba(20,24,32,0.92)" stroke="#F5A623" strokeWidth={2}/>
                <path d={`M ${wipePx - 6} ${size.h / 2 - 5} L ${wipePx - 10} ${size.h / 2} L ${wipePx - 6} ${size.h / 2 + 5}`}
                  stroke="#F5A623" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d={`M ${wipePx + 6} ${size.h / 2 - 5} L ${wipePx + 10} ${size.h / 2} L ${wipePx + 6} ${size.h / 2 + 5}`}
                  stroke="#F5A623" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </g>
              {/* Side labels */}
              <foreignObject x={8} y={8} width={Math.max(40, wipePx - 16)} height={28} style={{ pointerEvents: 'none' }}>
                <div style={{ display: 'inline-block', background: 'rgba(20,24,32,0.85)', color: '#fff',
                  padding: '4px 10px', borderRadius: 999, fontFamily: 'Montserrat', fontWeight: 600, fontSize: 11,
                  letterSpacing: '0.06em', textTransform: 'uppercase', border: '1px solid rgba(245,166,35,0.5)' }}>
                  A · {leftLabel}
                </div>
              </foreignObject>
              <foreignObject x={wipePx + 8} y={8} width={Math.max(40, size.w - wipePx - 16)} height={28} style={{ pointerEvents: 'none' }}>
                <div style={{ display: 'inline-block', background: 'rgba(20,24,32,0.85)', color: '#fff',
                  padding: '4px 10px', borderRadius: 999, fontFamily: 'Montserrat', fontWeight: 600, fontSize: 11,
                  letterSpacing: '0.06em', textTransform: 'uppercase', border: '1px solid rgba(245,166,35,0.5)' }}>
                  B · {rightLabel}
                </div>
              </foreignObject>
            </g>
          );
        })()}
      </svg>

      {isWalk && (
        <>
          <div style={{
            position: 'absolute', top: 16, left: 16, zIndex: 20, pointerEvents: 'auto',
            background: 'rgba(20,24,32,0.92)', color: '#fff',
            padding: '10px 14px', borderRadius: 'var(--radius-md)',
            border: '1px solid rgba(245,166,35,0.4)',
            fontFamily: 'Montserrat', fontSize: 11.5,
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <strong style={{ letterSpacing: '0.06em', textTransform: 'uppercase', color: '#F5A623' }}>
              Walk-through
            </strong>
            <span className="muted" style={{ color: 'rgba(255,255,255,.7)' }}>
              <strong style={{ color: '#fff' }}>WASD</strong> move ·
              {' '}<strong style={{ color: '#fff' }}>Q/E</strong> down/up ·
              {' '}<strong style={{ color: '#fff' }}>Drag</strong> to look ·
              {' '}<strong style={{ color: '#fff' }}>Shift</strong> sprint
            </span>
            <button
              onClick={() => setViewMode('iso')}
              style={{
                background: 'transparent', color: '#fff',
                border: '1px solid rgba(255,255,255,.3)', borderRadius: 999,
                padding: '4px 10px', fontFamily: 'Montserrat', fontWeight: 600, fontSize: 11,
                cursor: 'pointer',
              }}>
              Exit (Esc)
            </button>
          </div>
          <div style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 20, pointerEvents: 'none',
            background: 'rgba(20,24,32,0.85)', color: 'rgba(255,255,255,.85)',
            padding: '6px 10px', borderRadius: 'var(--radius-md)',
            fontFamily: 'Montserrat', fontSize: 11, letterSpacing: '0.04em',
          }}
          className="tabular">
            x {walkEyeX.toFixed(1)} · y {walkEyeY.toFixed(1)} · z {walkEyeZ.toFixed(1)} ft
            {' · '}{Math.round((walkYaw * 180 / Math.PI + 360) % 360)}°
          </div>
          {/* Crosshair */}
          <div style={{
            position: 'absolute', left: '50%', top: '50%', zIndex: 20,
            pointerEvents: 'none', transform: 'translate(-50%, -50%)',
            width: 14, height: 14,
          }}>
            <div style={{ position: 'absolute', left: 6, top: 0, width: 2, height: 14, background: 'rgba(245,166,35,0.7)' }}/>
            <div style={{ position: 'absolute', top: 6, left: 0, height: 2, width: 14, background: 'rgba(245,166,35,0.7)' }}/>
          </div>
        </>
      )}

      {wiringMode && !isWalk && <WiringHud/>}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} itemId={contextMenu.itemId}
          onClose={() => setContextMenu(null)}/>
      )}
    </div>
  );
}

function WiringHud() {
  const cableType = useStore(s => s.wiringCableType);
  const setCableType = useStore(s => s.setWiringCableType);
  const setWiringMode = useStore(s => s.setWiringMode);
  const startId = useStore(s => s.wiringStartId);
  const setStartId = useStore(s => s.setWiringStartId);
  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 22,
      background: 'rgba(20,24,32,0.94)', color: '#fff',
      padding: '8px 12px', borderRadius: 'var(--radius-md)',
      border: '1px solid rgba(245,166,35,0.4)',
      display: 'flex', alignItems: 'center', gap: 12, pointerEvents: 'auto',
      maxWidth: 'calc(100% - 32px)',
    }}>
      <strong style={{
        fontFamily: 'Montserrat', fontSize: 11, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: '#F5A623',
      }}>Wiring</strong>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {(Object.values(CABLE_SPECS)).map(spec => {
          const active = cableType === spec.id;
          return (
            <button key={spec.id}
              onClick={() => setCableType(spec.id)}
              title={spec.longLabel}
              style={{
                background: active ? spec.color : 'rgba(255,255,255,0.06)',
                color: active ? '#fff' : 'rgba(255,255,255,0.85)',
                border: `1px solid ${active ? spec.color : 'rgba(255,255,255,0.18)'}`,
                borderRadius: 999,
                padding: '3px 9px',
                fontFamily: 'Montserrat', fontWeight: 600, fontSize: 11,
                letterSpacing: '0.04em',
                cursor: 'pointer',
              }}>
              {spec.label}
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
        {startId ? 'Click destination · Esc to cancel' : 'Click source · Esc to exit'}
      </span>
      <button
        onClick={() => { setStartId(null); setWiringMode(false); }}
        style={{
          background: 'transparent', color: '#fff',
          border: '1px solid rgba(255,255,255,.3)', borderRadius: 999,
          padding: '3px 9px', fontFamily: 'Montserrat', fontWeight: 600, fontSize: 11,
          cursor: 'pointer',
        }}>
        Done
      </button>
    </div>
  );
}

function ContextMenu({ x, y, itemId, onClose }: { x: number; y: number; itemId: string; onClose: () => void }) {
  const equipment = useStore(s => s.equipment);
  const updateEquipment = useStore(s => s.updateEquipment);
  const duplicateEquipment = useStore(s => s.duplicateEquipment);
  const deleteEquipment = useStore(s => s.deleteEquipment);
  const selectedIds = useStore(s => s.selectedIds);

  // Targets are: every item in the current selection if itemId is part of it, else just itemId.
  const targetIds = selectedIds.includes(itemId) ? selectedIds : [itemId];
  const items = targetIds.map(id => equipment.find(e => e.id === id)).filter(Boolean) as EquipmentItem[];
  const primary = items[0];
  if (!primary) return null;

  const close = () => onClose();
  const each = (fn: (it: EquipmentItem) => void) => { for (const it of items) fn(it); close(); };

  // Anchor menu inside viewport bounds
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 320);
  const isSpeaker = primary.category === 'audio-speaker';

  // Click-outside / Escape to close
  useEffect(() => {
    const onDown = () => onClose();
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    // Defer mousedown registration so the click that opened the menu doesn't immediately close it.
    const t = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const Item = ({ icon, label, onClick, danger, disabled }: {
    icon: string; label: string; onClick: () => void; danger?: boolean; disabled?: boolean;
  }) => (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '7px 10px',
        background: 'transparent', border: 0, borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left',
        color: danger ? '#A52A2A' : 'var(--fg1)',
        fontFamily: 'Open Sans', fontSize: 13,
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.background = 'var(--bg-alt)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
      <span style={{ width: 14 }}><Icon name={icon} size={13}/></span>
      <span>{label}</span>
    </button>
  );

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left, top,
        width: 210,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 100,
        padding: 6,
      }}>
      <div style={{
        padding: '6px 10px 8px', borderBottom: '1px solid var(--border)',
        marginBottom: 4,
        fontFamily: 'Montserrat', fontWeight: 700, fontSize: 11,
        letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg3)',
      }}>
        {items.length === 1 ? primary.label : `${items.length} items`}
      </div>
      <Item icon="copy" label="Duplicate" onClick={() => each(it => duplicateEquipment(it.id))}/>
      <Item icon="trash" label="Delete" danger onClick={() => each(it => deleteEquipment(it.id))}/>
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }}/>
      {isSpeaker && (
        <>
          <Item icon="speaker" label={primary.muted ? 'Unmute' : 'Mute'}
            onClick={() => each(it => updateEquipment(it.id, { muted: !primary.muted, soloed: false }))}/>
          <Item icon="speaker" label={primary.soloed ? 'Unsolo' : 'Solo'}
            onClick={() => each(it => updateEquipment(it.id, { soloed: !primary.soloed, muted: false }))}/>
          <Item icon="rotate" label="Reset aim & tilt"
            onClick={() => each(it => updateEquipment(it.id, { aim: 90, tilt: -8 }))}/>
        </>
      )}
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }}/>
      <Item icon={primary.locked ? 'unlock' : 'lock'} label={primary.locked ? 'Unlock' : 'Lock'}
        onClick={() => each(it => updateEquipment(it.id, { locked: !primary.locked }))}/>
    </div>
  );
}

// ===== Controls cheat-sheet =====
const HELP_STORAGE_KEY = 'beacon-room-designer.helpDismissed.v1';

interface ControlGroup { title: string; items: { keys: string; desc: string }[] }
const HELP_GROUPS: ControlGroup[] = [
  { title: 'Camera', items: [
    { keys: 'Right-drag · Shift+drag', desc: 'Orbit (yaw + pitch)' },
    { keys: 'Hand tool · Space+drag · Alt+drag', desc: 'Pan' },
    { keys: 'Scroll wheel', desc: 'Zoom (anchored on cursor)' },
    { keys: 'Ctrl+0 · Fit button', desc: 'Reset view' },
  ]},
  { title: 'Selection & editing', items: [
    { keys: 'Click', desc: 'Select / deselect' },
    { keys: 'Ctrl+D', desc: 'Duplicate selected' },
    { keys: 'Delete · Backspace', desc: 'Delete selected' },
    { keys: 'Ctrl+Z · Ctrl+Shift+Z', desc: 'Undo / redo' },
  ]},
  { title: 'Toggles', items: [
    { keys: 'G', desc: 'Grid mesh' },
    { keys: 'H', desc: 'SPL heatmap' },
    { keys: 'C', desc: 'Coverage cones' },
    { keys: 'F', desc: 'Presentation mode' },
    { keys: 'R', desc: 'Re-run simulation' },
    { keys: '1–4', desc: 'Switch tabs' },
    { keys: 'Esc', desc: 'Cancel / clear / exit' },
  ]},
];

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: 60, right: 16,
        width: 320, maxHeight: 'calc(100% - 80px)', overflowY: 'auto',
        background: 'rgba(18,21,26,.92)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,.10)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 16px',
        color: '#fff',
        zIndex: 12, pointerEvents: 'auto',
        boxShadow: '0 20px 40px rgba(0,0,0,.55)',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{
            fontFamily: 'Montserrat', fontWeight: 700, fontSize: 11, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,.55)',
          }}>How to navigate</div>
          <div style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: 15, marginTop: 2 }}>Controls</div>
        </div>
        <button onClick={onClose} style={{
          background: 'transparent', border: 0, color: 'rgba(255,255,255,.7)',
          cursor: 'pointer', padding: 4, borderRadius: 4,
        }}>
          <Icon name="x" size={14}/>
        </button>
      </div>
      {HELP_GROUPS.map(g => (
        <div key={g.title} style={{ marginBottom: 12 }}>
          <div style={{
            fontFamily: 'Montserrat', fontWeight: 600, fontSize: 10.5,
            letterSpacing: '0.10em', textTransform: 'uppercase',
            color: 'var(--amber-gold)', marginBottom: 6,
          }}>{g.title}</div>
          {g.items.map(it => (
            <div key={it.keys} style={{
              display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10,
              padding: '3px 0', fontSize: 12,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 11.5,
                color: 'rgba(255,255,255,.85)',
              }}>{it.keys}</span>
              <span style={{ color: 'rgba(255,255,255,.65)' }}>{it.desc}</span>
            </div>
          ))}
        </div>
      ))}
      <div style={{
        marginTop: 10, paddingTop: 10,
        borderTop: '1px solid rgba(255,255,255,.08)',
        fontSize: 11, color: 'rgba(255,255,255,.5)',
      }}>
        Tip: switch to the <strong style={{ color: '#fff' }}>top-down plan view</strong> with the
        grid icon — measurements snap to the floor in that mode.
      </div>
    </div>
  );
}

// ===== Floating overlays =====
export function ViewportOverlays() {
  const room = useStore(s => s.room);
  const equipment = useStore(s => s.equipment);
  const showHeatmap = useStore(s => s.showHeatmap);
  const heatmap = useStore(s => s.heatmap);
  const clarityHeatmap = useStore(s => s.clarityHeatmap);
  const arrivalHeatmap = useStore(s => s.arrivalHeatmap);
  const heatmapMetric = useStore(s => s.heatmapMetric);
  const setHeatmapMetric = useStore(s => s.setHeatmapMetric);
  const rt60 = useStore(s => s.rt60);
  const activeFreq = useStore(s => s.activeFreq);
  const modalFreqLegend = useStore(s => s.modalFreq);
  const showMesh = useStore(s => s.showMesh);
  const showRays = useStore(s => s.showRays);
  const showContours = useStore(s => s.showContours);
  const toggleMesh = useStore(s => s.toggleMesh);
  const toggleRays = useStore(s => s.toggleRays);
  const toggleContours = useStore(s => s.toggleContours);
  const presentationMode = useStore(s => s.presentationMode);
  // Trigger the auto-treat modal rather than firing the planner with default
  // settings — gives the user a chance to pick target RT60 and strategy.
  const openAutoTreat = useStore(s => s.setOpenModal);
  const viewMode = useStore(s => s.viewMode);
  const applyCameraPreset = useStore(s => s.applyCameraPreset);
  const bumpFit = useStore(s => s.bumpFit);
  const measureMode = useStore(s => s.measureMode);
  const measurePoints = useStore(s => s.measurePoints);
  const setMeasureMode = useStore(s => s.setMeasureMode);
  const clearMeasure = useStore(s => s.clearMeasure);
  const setHint = useStore(s => s.setHint);
  const drawingZone = useStore(s => s.drawingZone);
  const drawingZonePoints = useStore(s => s.drawingZonePoints);
  const finishDrawingZone = useStore(s => s.finishDrawingZone);
  const cancelDrawingZone = useStore(s => s.cancelDrawingZone);
  const editingRoomShape = useStore(s => s.editingRoomShape);
  const editingRoomPoints = useStore(s => s.editingRoomPoints);
  const finishEditingRoomShape = useStore(s => s.finishEditingRoomShape);
  const cancelEditingRoomShape = useStore(s => s.cancelEditingRoomShape);

  // Help overlay — auto-shown on first launch, dismissed flag persisted in localStorage.
  const [helpOpen, setHelpOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(HELP_STORAGE_KEY) !== '1'; } catch { return true; }
  });
  const closeHelp = () => {
    setHelpOpen(false);
    try { localStorage.setItem(HELP_STORAGE_KEY, '1'); } catch { /* noop */ }
  };

  const speakerCount = equipment.filter(e => e.category === 'audio-speaker').length;
  const panelCount = equipment.filter(e => e.category === 'acoustic').length;
  const selectedIds = useStore(s => s.selectedIds);
  const selectionCount = selectedIds.length;

  const rt60at1k = rt60?.byBand[1000];
  const targetRt60 = room.roomType === 'sanctuary' ? 1.0 : 1.2;

  if (presentationMode) {
    return (
      <div className="vp-overlay vp-info" style={{ top: 24, left: 24 }}>
        <span className="chip-info"><span className="dot"/> {room.name}</span>
        {showHeatmap && <span className="chip-info amber"><span className="dot"/> SPL @ {labelForFreq(activeFreq)}</span>}
      </div>
    );
  }

  return (
    <>
      <div className="vp-overlay vp-info">
        <span className="chip-info"><span className="dot"/>
          {Math.round(room.width * room.depth)} sq ft · {room.occupancy} seats
        </span>
        <span className="chip-info"><span className="dot"/>
          {speakerCount} sources · {panelCount} panels
        </span>
        {showHeatmap && (
          <span className="chip-info amber"><span className="dot"/>
            {metricLabel(heatmapMetric)} @ {labelForFreq(activeFreq)}
          </span>
        )}
        {measureMode && (
          <span className="chip-info" style={{ color: '#F5A623', borderColor: 'rgba(245,166,35,.4)' }}>
            <span className="dot" style={{ background: '#F5A623' }}/>
            Measure mode — click two points
          </span>
        )}
        {/* Shortcuts hint — only when something is selected. Discoverability
            for the keyboard interactions. Hold Shift for fine-step. */}
        {selectionCount > 0 && !measureMode && !drawingZone && !editingRoomShape && (
          <span className="chip-info" style={{
            color: 'rgba(255,255,255,.85)',
            background: 'rgba(245,166,35,.18)',
            borderColor: 'rgba(245,166,35,.45)',
          }}>
            <span className="dot" style={{ background: '#F5A623' }}/>
            {selectionCount} selected · arrows nudge · R rotate · [ ] tilt · PgUp/Dn z · ⌫ delete
          </span>
        )}
      </div>

      <div className="vp-overlay vp-tools">
        <button className={`vp-tool-btn ${showMesh ? 'active' : ''}`} title="Show grid mesh (G)" onClick={toggleMesh}>
          <Icon name="grid" size={16}/>
        </button>
        <button className={`vp-tool-btn ${showRays ? 'active' : ''}`} title="Ray traces" onClick={toggleRays}>
          <Icon name="ray" size={16}/>
        </button>
        <button className={`vp-tool-btn ${showContours ? 'active' : ''}`} title="±3/±6 dB SPL contour lines" onClick={toggleContours}>
          <Icon name="heatmap" size={16}/>
        </button>
        <button
          className={`vp-tool-btn ${viewMode === 'top' ? 'active' : ''}`}
          title="Top-down plan view"
          onClick={() => applyCameraPreset(viewMode === 'top' ? 'iso' : 'top')}>
          <Icon name="grid" size={16}/>
        </button>
        <button
          className="vp-tool-btn"
          title="Iso view (right-drag or Shift+drag to orbit)"
          onClick={() => applyCameraPreset('iso')}>
          <Icon name="cube" size={16}/>
        </button>
        <button
          className={`vp-tool-btn ${viewMode === 'walk' ? 'active' : ''}`}
          title="First-person walk-through (WASD to move, drag to look)"
          onClick={() => useStore.getState().enterWalkthrough()}>
          <Icon name="user" size={16}/>
        </button>
        <button className="vp-tool-btn" title="Fit to view (Ctrl+0)" onClick={() => { bumpFit(); setHint('View fit to room'); }}>
          <Icon name="fit" size={16}/>
        </button>
        <button className={`vp-tool-btn ${helpOpen ? 'active' : ''}`} title="Controls cheat-sheet"
          onClick={() => setHelpOpen(v => !v)}>
          <Icon name="info" size={16}/>
        </button>
      </div>

      {helpOpen && <HelpOverlay onClose={closeHelp} />}

      {/* Subtle persistent hint at bottom-center when help is dismissed */}
      {!helpOpen && (
        <div style={{
          position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(18,21,26,.6)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,.08)',
          color: 'rgba(255,255,255,.65)',
          padding: '5px 12px', borderRadius: 999,
          fontFamily: 'Open Sans', fontSize: 11,
          pointerEvents: 'none',
          display: 'flex', gap: 12,
        }}>
          <span><kbd style={kbdStyle}>Right-drag</kbd> orbit</span>
          <span><kbd style={kbdStyle}>Space+drag</kbd> pan</span>
          <span><kbd style={kbdStyle}>Scroll</kbd> zoom</span>
        </div>
      )}

      {measureMode && measurePoints.length > 0 && (
        <button
          onClick={() => clearMeasure()}
          style={{
            position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(245,166,35,.95)', color: '#12151A',
            border: 0, borderRadius: 999, padding: '6px 14px',
            fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12,
            cursor: 'pointer', pointerEvents: 'auto', zIndex: 11,
          }}>
          Clear measurement
        </button>
      )}
      {measureMode && (
        <button
          onClick={() => { setMeasureMode(false); setHint('Measure mode off'); }}
          style={{
            position: 'absolute', top: 60, right: 16,
            background: 'rgba(18,21,26,.9)', color: '#fff',
            border: '1px solid rgba(255,255,255,.2)', borderRadius: 999, padding: '6px 14px',
            fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12,
            cursor: 'pointer', pointerEvents: 'auto', zIndex: 11,
          }}>
          Exit measure (Esc)
        </button>
      )}

      {editingRoomShape && (
        <>
          <div className="vp-overlay" style={{
            top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'rgba(46,135,245,.92)', color: '#fff',
            padding: '10px 18px', borderRadius: 999,
            fontFamily: 'Montserrat', fontWeight: 600, fontSize: 13,
            pointerEvents: 'none', zIndex: 11,
            boxShadow: '0 8px 24px rgba(0,0,0,.3)',
          }}>
            {editingRoomPoints.length === 0 ? 'Click vertices to outline the room'
              : editingRoomPoints.length < 3 ? `Click more vertices (${editingRoomPoints.length}/3 minimum)`
              : 'Double-click to close · Esc to cancel'}
          </div>
          <div style={{
            position: 'absolute', top: 60, right: 16,
            display: 'flex', gap: 6, zIndex: 11,
          }}>
            {editingRoomPoints.length >= 3 && (
              <button onClick={finishEditingRoomShape} style={{
                background: 'rgba(46,135,245,.95)', color: '#fff',
                border: 0, borderRadius: 999, padding: '6px 14px',
                fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12,
                cursor: 'pointer',
              }}>Apply shape</button>
            )}
            <button onClick={cancelEditingRoomShape} style={{
              background: 'rgba(18,21,26,.9)', color: '#fff',
              border: '1px solid rgba(255,255,255,.2)', borderRadius: 999, padding: '6px 14px',
              fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12,
              cursor: 'pointer',
            }}>Cancel (Esc)</button>
          </div>
        </>
      )}

      {drawingZone && (
        <>
          <div className="vp-overlay" style={{
            top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'rgba(245,166,35,.92)', color: '#12151A',
            padding: '10px 18px', borderRadius: 999,
            fontFamily: 'Montserrat', fontWeight: 600, fontSize: 13,
            pointerEvents: 'none',
            zIndex: 11,
            boxShadow: '0 8px 24px rgba(0,0,0,.3)',
          }}>
            {drawingZonePoints.length === 0 ? 'Click vertices to outline a zone'
              : drawingZonePoints.length < 3 ? `Click more vertices (${drawingZonePoints.length}/3 minimum)`
              : 'Double-click to close · Esc to cancel'}
          </div>
          <div style={{
            position: 'absolute', top: 60, right: 16,
            display: 'flex', gap: 6, zIndex: 11,
          }}>
            {drawingZonePoints.length >= 3 && (
              <button onClick={finishDrawingZone} style={{
                background: 'rgba(245,166,35,.95)', color: '#12151A',
                border: 0, borderRadius: 999, padding: '6px 14px',
                fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12,
                cursor: 'pointer',
              }}>Close zone</button>
            )}
            <button onClick={cancelDrawingZone} style={{
              background: 'rgba(18,21,26,.9)', color: '#fff',
              border: '1px solid rgba(255,255,255,.2)', borderRadius: 999, padding: '6px 14px',
              fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12,
              cursor: 'pointer',
            }}>Cancel (Esc)</button>
          </div>
        </>
      )}

      {showHeatmap && (
        <div className="vp-overlay vp-legend">
          {/* Metric selector */}
          <div style={{
            display: 'flex', gap: 2, marginBottom: 10,
            background: 'rgba(255,255,255,.05)', padding: 3, borderRadius: 999,
          }}>
            {(['spl','c50','c80','arrival','t30','modal'] as const).map(m => (
              <button key={m}
                onClick={() => setHeatmapMetric(m)}
                title={
                  m === 't30'
                    ? 'Per-cell T30 reverberation time. Requires Ray-trace tail enabled — switching to T30 kicks off a per-cell ray pass (5–30 s).'
                    : m === 'modal'
                    ? 'Low-frequency standing-wave field (room modes). Requires Modal LF enabled — wave-accurate bass behavior the ray model cannot show.'
                    : undefined
                }
                style={{
                  flex: 1,
                  fontFamily: 'Montserrat', fontWeight: 600, fontSize: 10.5,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  background: heatmapMetric === m ? 'var(--royal-blue)' : 'transparent',
                  color: heatmapMetric === m ? '#fff' : 'rgba(255,255,255,.65)',
                  border: 0, borderRadius: 999,
                  padding: '3px 6px', cursor: 'pointer',
                }}>
                {m === 'spl' ? 'SPL' : m === 'c50' ? 'C50' : m === 'c80' ? 'C80' : m === 'arrival' ? 'ToF' : m === 't30' ? 'T30' : 'LF'}
              </button>
            ))}
          </div>
          <div className="legend-title">
            {heatmapMetric === 'spl' ? 'SPL coverage'
             : heatmapMetric === 'arrival' ? 'Time of arrival'
             : heatmapMetric === 't30' ? 'Reverb time (T30)'
             : heatmapMetric === 'modal' ? 'LF standing-wave field'
             : `Clarity (${heatmapMetric.toUpperCase()})`}
            {heatmapMetric === 'modal' ? ` · ${modalFreqLegend} Hz`
             : heatmapMetric !== 'arrival' ? ` · ${labelForFreq(activeFreq)}` : ''}
          </div>
          {heatmapMetric === 'modal' ? (
            <ModalLegendBody />
          ) : heatmapMetric === 't30' ? (
            <T30LegendBody />
          ) : heatmapMetric === 'arrival' ? (
            <>
              <div style={{
                height: 8,
                background: 'linear-gradient(90deg, #1A4FBF 0%, #2E87F5 30%, #2F9E5E 55%, #F5A623 80%, #C53030 100%)',
                borderRadius: 999, marginBottom: 6,
              }}/>
              <div className="legend-scale">
                <span>0</span><span>20</span><span>40</span><span>60</span><span>80+ ms</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,.65)' }}>
                Avg <strong className="tabular" style={{ color: '#fff' }}>
                  {arrivalHeatmap ? arrivalHeatmap.avg.toFixed(1) : '—'}</strong> ms · spread <strong className="tabular" style={{ color: '#F5A623' }}>
                  {arrivalHeatmap ? (arrivalHeatmap.max - arrivalHeatmap.min).toFixed(1) : '—'}</strong> ms
              </div>
              <div style={{ marginTop: 4, fontSize: 10.5, color: 'rgba(255,255,255,.55)' }}>
                Earliest arrival per cell. Watch for {'>'} 30 ms steps (Haas threshold).
              </div>
            </>
          ) : heatmapMetric === 'spl' ? (
            <>
              <div className="gradient-bar"/>
              <div className="legend-scale">
                <span>65</span><span>75</span><span>85</span><span>92</span><span>100+</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,.65)' }}>
                Avg <strong className="tabular" style={{ color: '#fff' }}>
                  {heatmap ? heatmap.avg.toFixed(1) : '—'}</strong> dB · ±<strong className="tabular" style={{ color: '#F5A623' }}>
                  {heatmap ? heatmap.std.toFixed(1) : '—'}</strong> dB
              </div>
            </>
          ) : (
            <>
              <div style={{
                height: 8,
                background: 'linear-gradient(90deg, #C53030 0%, #F5A623 30%, #C8BE50 55%, #2F9E5E 75%, #1A4FBF 100%)',
                borderRadius: 999, marginBottom: 6,
              }}/>
              <div className="legend-scale">
                <span>-10</span><span>-3</span><span>0</span><span>5</span><span>15+</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,.65)' }}>
                Avg <strong className="tabular" style={{ color: '#fff' }}>
                  {clarityHeatmap ? clarityHeatmap.avg.toFixed(1) : '—'}</strong> dB · ±<strong className="tabular" style={{ color: '#F5A623' }}>
                  {clarityHeatmap ? clarityHeatmap.std.toFixed(1) : '—'}</strong> dB
              </div>
              <div style={{ marginTop: 4, fontSize: 10.5, color: 'rgba(255,255,255,.55)' }}>
                {heatmapMetric === 'c50' ? 'Speech: ≥ 0 dB target' : 'Music: ≥ -2 dB target'}
              </div>
            </>
          )}
        </div>
      )}

      <div className="vp-overlay rt60-card">
        {/* Outdoor / unenclosed rooms have no statistical reverberant field —
            the engine returns a 99s sentinel; show "outdoor" instead. */}
        {rt60at1k != null && rt60at1k >= 90 ? (
          <>
            <div className="head"><span className="label">RT60 · 1kHz</span></div>
            <div className="value"><span className="tabular">—</span></div>
            <div className="target">Outdoor / unenclosed — reverberation N/A</div>
          </>
        ) : (
          <>
            <div className="head">
              <span className="label">RT60 · 1kHz</span>
              {panelCount > 0 && rt60at1k != null && (
                <span className="delta">treatment applied</span>
              )}
            </div>
            <div className="value">
              <span className="tabular">{rt60at1k != null ? rt60at1k.toFixed(2) : '—'}</span>
              <span className="unit">s</span>
            </div>
            <div className="target">
              Target {targetRt60.toFixed(2)}s
              {rt60at1k != null && (rt60at1k <= targetRt60 + 0.15
                ? <span className="ok"> · within target</span>
                : <span style={{ color: 'rgba(255,255,255,.7)' }}> · {(rt60at1k - targetRt60).toFixed(2)}s over</span>
              )}
            </div>
            {panelCount === 0 && (
              <button className="auto-treat" onClick={() => openAutoTreat('auto-treat')}>
                Auto-treat room →
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

const kbdStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10.5,
  background: 'rgba(255,255,255,.10)',
  padding: '0 5px', borderRadius: 3,
  color: 'rgba(255,255,255,.95)',
  marginRight: 4,
};

function metricLabel(m: 'spl' | 'c50' | 'c80' | 'arrival' | 't30' | 'modal'): string {
  if (m === 'spl') return 'SPL';
  if (m === 'c50') return 'C50 clarity';
  if (m === 'c80') return 'C80 clarity';
  if (m === 't30') return 'T30 reverb';
  if (m === 'modal') return 'LF modes';
  return 'Time of arrival';
}

/** Legend body for the T30 heatmap. Reads the cached t30Heatmap so it can
 *  show the live avg/spread numbers + a hint when the per-cell pass hasn't
 *  produced data yet (e.g. ray tracing disabled). */
function ModalLegendBody() {
  const useModalLF = useStore(s => s.useModalLF);
  const modalHeatmap = useStore(s => s.modalHeatmap);
  const modalAnalysis = useStore(s => s.modalAnalysis);
  if (!useModalLF) {
    return (
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', marginTop: 4 }}>
        Enable <strong style={{ color: '#F5A623' }}>Modal LF</strong> in the bottom
        strip to compute the low-frequency standing-wave field.
      </div>
    );
  }
  if (!modalHeatmap) {
    return (
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', marginTop: 4 }}>
        Add a low-frequency source (sub/main) to see the modal field.
      </div>
    );
  }
  return (
    <>
      <div className="gradient-bar"/>
      <div className="legend-scale">
        <span>null</span><span>−6</span><span>avg</span><span>+6</span><span>peak</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,.65)' }}>
        Modal spread <strong className="tabular" style={{ color: '#F5A623' }}>
          ±{modalHeatmap.std.toFixed(1)}</strong> dB · range <strong className="tabular" style={{ color: '#fff' }}>
          {(modalHeatmap.max - modalHeatmap.min).toFixed(0)}</strong> dB
        {modalAnalysis && <> · Schroeder <strong className="tabular" style={{ color: '#fff' }}>{modalAnalysis.schroeder.toFixed(0)}</strong> Hz</>}
      </div>
      <div style={{ marginTop: 4, fontSize: 10.5, color: 'rgba(255,255,255,.55)' }}>
        Peaks &amp; nulls are standing waves — big swings mean uneven bass. {modalAnalysis?.approximate ? 'Bounding-box approximation.' : ''}
      </div>
    </>
  );
}

function T30LegendBody() {
  const t30Heatmap = useStore(s => s.t30Heatmap);
  const useRayTracing = useStore(s => s.useRayTracing);
  if (!useRayTracing) {
    return (
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', marginTop: 4 }}>
        Enable <strong style={{ color: '#F5A623' }}>Ray-trace tail</strong> in the
        bottom strip to compute T30 per cell.
      </div>
    );
  }
  if (!t30Heatmap) {
    return (
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', marginTop: 4 }}>
        Computing per-cell decay (ray-tracing each cell)…
      </div>
    );
  }
  return (
    <>
      <div style={{
        height: 8,
        background: 'linear-gradient(90deg, #1A4FBF 0%, #2F9E5E 25%, #C8BE50 50%, #F5A623 70%, #C53030 100%)',
        borderRadius: 999, marginBottom: 6,
      }}/>
      <div className="legend-scale">
        <span>0.4s</span><span>1.0s</span><span>1.5s</span><span>2.0s</span><span>2.5s+</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,.65)' }}>
        Avg <strong className="tabular" style={{ color: '#fff' }}>
          {t30Heatmap.avg.toFixed(2)}</strong> s · spread ±<strong className="tabular" style={{ color: '#F5A623' }}>
          {t30Heatmap.std.toFixed(2)}</strong> s
      </div>
      <div style={{ marginTop: 4, fontSize: 10.5, color: 'rgba(255,255,255,.55)' }}>
        Speech target ~ 0.6–1.2 s · per-cell from ray tracing
      </div>
    </>
  );
}

function labelForFreq(f: '125'|'1k'|'4k'|'broadband'): string {
  if (f === '125') return '125 Hz';
  if (f === '1k') return '1 kHz';
  if (f === '4k') return '4 kHz';
  return 'broadband';
}
